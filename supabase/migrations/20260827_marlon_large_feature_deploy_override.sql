alter table public.support_tickets add column if not exists maintenance_override_required boolean not null default false;
alter table public.support_tickets add column if not exists maintenance_override_state text not null default 'not_required';
alter table public.support_tickets add column if not exists maintenance_override_requested_at timestamptz;
alter table public.support_tickets add column if not exists maintenance_override_decided_at timestamptz;
alter table public.support_tickets add column if not exists maintenance_override_decided_by uuid references public.profiles(id) on delete set null;
alter table public.support_tickets add column if not exists maintenance_override_commit_sha text;

alter table public.support_tickets drop constraint if exists support_tickets_maintenance_override_state_check;
alter table public.support_tickets add constraint support_tickets_maintenance_override_state_check
check (maintenance_override_state in ('not_required','pending','approved','denied'));

alter table public.marlon_execution_runs drop constraint if exists marlon_execution_runs_status_check;
alter table public.marlon_execution_runs add constraint marlon_execution_runs_status_check
check (status in ('claimed','diagnosing','patching','testing','waiting_window','deploying','verifying','completed','blocked','failed'));

drop index if exists public.marlon_execution_runs_one_active_ticket;
create unique index marlon_execution_runs_one_active_ticket
on public.marlon_execution_runs(ticket_id)
where status in ('claimed','diagnosing','patching','testing','waiting_window','deploying','verifying');

create or replace function public.marlon_store_is_open(p_location uuid)
returns boolean
language plpgsql
security definer
stable
set search_path=public
as $$
declare
  s public.business_settings%rowtype;
  v_local timestamp;
  v_day text;
  v_hours jsonb;
  v_open time;
  v_close time;
begin
  select * into s from public.business_settings where location_id=p_location limit 1;
  if not found then return false; end if;
  v_local := now() at time zone coalesce(nullif(s.store_timezone,''),'America/New_York');
  v_day := lower(trim(to_char(v_local,'Dy')));
  v_hours := s.store_hours -> v_day;
  if v_hours is null or jsonb_typeof(v_hours)<>'array' or jsonb_array_length(v_hours)<>2 then return false; end if;
  begin
    v_open := (v_hours->>0)::time;
    v_close := (v_hours->>1)::time;
  exception when others then
    return false;
  end;
  return v_local::time >= v_open and v_local::time < v_close;
end;
$$;

create or replace function public.marlon_deployment_gate(
  p_ticket uuid,
  p_commit_sha text,
  p_change_size text default 'small',
  p_feature_update boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  t public.support_tickets%rowtype;
  v_open boolean;
  v_sha text := nullif(btrim(coalesce(p_commit_sha,'')),'');
  v_size text := lower(btrim(coalesce(p_change_size,'small')));
  v_large_feature boolean;
begin
  select * into t from public.support_tickets where id=p_ticket for update;
  if not found then raise exception 'Support ticket not found.'; end if;
  if v_sha is null then raise exception 'Tested commit SHA is required.'; end if;
  if v_size not in ('small','medium','large') then raise exception 'Invalid change size.'; end if;
  if t.change_level='high_level' and (t.approval_state<>'approved' or t.approval_status<>'approved') then
    raise exception 'Owner change approval is required before deployment planning.';
  end if;

  v_large_feature := (v_size='large' and coalesce(p_feature_update,false));
  v_open := public.marlon_store_is_open(t.location_id);

  update public.support_tickets
  set context=coalesce(context,'{}'::jsonb)||jsonb_build_object(
        'tested_commit_sha',v_sha,
        'deployment_change_size',v_size,
        'deployment_feature_update',coalesce(p_feature_update,false),
        'business_hours_override_applicable',v_large_feature
      ),
      updated_at=now()
  where id=t.id;

  if not v_large_feature or not v_open then
    if not v_large_feature then
      update public.support_tickets
      set maintenance_override_required=false,
          maintenance_override_state='not_required',
          maintenance_override_requested_at=null,
          maintenance_override_decided_at=null,
          maintenance_override_decided_by=null,
          maintenance_override_commit_sha=null,
          updated_at=now()
      where id=t.id;
    end if;
    return jsonb_build_object('allowed',true,'store_open',v_open,'change_size',v_size,'feature_update',coalesce(p_feature_update,false),'large_feature_update',v_large_feature,'override_required',false,'override_used',false,'state',case when v_large_feature then t.maintenance_override_state else 'not_required' end);
  end if;

  if t.maintenance_override_state='approved' and t.maintenance_override_commit_sha=v_sha then
    return jsonb_build_object('allowed',true,'store_open',true,'change_size',v_size,'feature_update',true,'large_feature_update',true,'override_required',true,'override_used',true,'state','approved');
  end if;

  if t.maintenance_override_commit_sha is distinct from v_sha
     or t.maintenance_override_state not in ('pending','denied') then
    update public.support_tickets
    set maintenance_override_required=true,
        maintenance_override_state='pending',
        maintenance_override_requested_at=now(),
        maintenance_override_decided_at=null,
        maintenance_override_decided_by=null,
        maintenance_override_commit_sha=v_sha,
        status='waiting_approval',
        context=coalesce(context,'{}'::jsonb)||jsonb_build_object(
          'maintenance_override_reason','Large feature update during business hours',
          'maintenance_override_commit_sha',v_sha
        ),
        updated_at=now()
    where id=t.id;

    insert into public.support_ticket_events(ticket_id,actor,event_type,message)
    values(t.id,'marlon','maintenance_override_requested','A large feature update passed testing while the store is open. Marlon requested Owner approval to deploy this exact tested commit immediately.');
    t.maintenance_override_state := 'pending';
  end if;

  return jsonb_build_object('allowed',false,'store_open',true,'change_size',v_size,'feature_update',true,'large_feature_update',true,'override_required',true,'override_used',false,'state',t.maintenance_override_state,'commit_sha',v_sha);
end;
$$;

drop function if exists public.marlon_deployment_gate(uuid,text);

create or replace function public.decide_marlon_maintenance_override(p_ticket uuid,p_approve boolean)
returns public.support_tickets
language plpgsql
security definer
set search_path=public
as $$
declare
  saved public.support_tickets%rowtype;
  profile public.profiles%rowtype;
begin
  select * into profile from public.profiles where id=auth.uid() and active=true;
  if not found or profile.role<>'owner' then raise exception 'Only an active Owner can decide a business-hours deployment override.'; end if;
  select * into saved from public.support_tickets where id=p_ticket and location_id=profile.location_id for update;
  if not found then raise exception 'Support ticket not found for this location.'; end if;
  if saved.maintenance_override_state<>'pending' or saved.maintenance_override_commit_sha is null then
    raise exception 'No pending business-hours deployment override exists.';
  end if;

  update public.support_tickets
  set maintenance_override_state=case when p_approve then 'approved' else 'denied' end,
      maintenance_override_decided_at=now(),
      maintenance_override_decided_by=auth.uid(),
      status=case when p_approve then 'open' else 'waiting' end,
      context=coalesce(context,'{}'::jsonb)||jsonb_build_object(
        'maintenance_override_owner_decision',p_approve,
        'maintenance_override_decided_at',now(),
        'maintenance_override_decided_by',auth.uid()
      ),
      updated_at=now()
  where id=p_ticket returning * into saved;

  insert into public.support_ticket_events(ticket_id,actor,event_type,message)
  values(saved.id,'employee',case when p_approve then 'maintenance_override_approved' else 'maintenance_override_denied' end,
    case when p_approve then 'Owner approved immediate business-hours deployment for the exact tested commit.' else 'Owner denied immediate deployment. Marlon will wait for the normal maintenance window.' end);
  return saved;
end;
$$;

create or replace function public.claim_next_marlon_execution(p_executor text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  t public.support_tickets%rowtype;
  r public.marlon_execution_runs%rowtype;
begin
  if nullif(btrim(coalesce(p_executor,'')),'') is null then raise exception 'Executor identity is required.'; end if;

  select er.* into r
  from public.marlon_execution_runs er
  join public.support_tickets st on st.id=er.ticket_id
  where er.status='waiting_window'
    and (
      not public.marlon_store_is_open(st.location_id)
      or (st.maintenance_override_state='approved' and st.maintenance_override_commit_sha=er.commit_sha)
    )
  order by er.started_at
  for update of er skip locked
  limit 1;

  if found then
    select * into t from public.support_tickets where id=r.ticket_id for update;
    update public.marlon_execution_runs
    set status='deploying',executor=btrim(p_executor),heartbeat_at=now(),metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('resumed_at',now(),'resumed_by',btrim(p_executor))
    where id=r.id returning * into r;
    update public.support_tickets set status='in_progress',updated_at=now() where id=t.id returning * into t;
    insert into public.support_ticket_events(ticket_id,actor,event_type,message)
    values(t.id,'marlon','execution_resumed','Marlon resumed the tested deployment after the maintenance window opened or an Owner approved immediate deployment.');
    return jsonb_build_object('ok',true,'ticket',to_jsonb(t),'run',to_jsonb(r),'resume',true);
  end if;

  select * into t
  from public.support_tickets st
  where st.managed_by='Marlon'
    and st.status='open'
    and st.source in ('marlon_chat','marlon_call','runtime_error','repository_audit','system')
    and st.surface in ('portal','website','repository')
    and (
      st.change_level='standard'
      or (
        st.change_level='high_level'
        and st.requires_approval=true
        and st.approval_state='approved'
        and st.approval_status='approved'
        and st.approval_fingerprint is not null
        and st.approval_fingerprint=public.marlon_scope_fingerprint(st.surface,st.title,st.description)
      )
    )
    and not exists(
      select 1 from public.marlon_execution_runs er
      where er.ticket_id=st.id
        and er.status in ('claimed','diagnosing','patching','testing','waiting_window','deploying','verifying')
    )
  order by case st.priority when 'critical' then 1 when 'high' then 2 when 'normal' then 3 else 4 end,st.created_at
  for update skip locked
  limit 1;

  if not found then return jsonb_build_object('ok',true,'ticket',null,'run',null,'resume',false); end if;

  insert into public.marlon_execution_runs(ticket_id,location_id,executor,metadata)
  values(t.id,t.location_id,btrim(p_executor),jsonb_build_object('claimed_from_status',t.status,'ticket_number',t.ticket_number))
  returning * into r;

  update public.support_tickets
  set status='in_progress',
      context=coalesce(context,'{}'::jsonb)||jsonb_build_object('execution_run_id',r.id,'execution_executor',r.executor,'execution_started_at',r.started_at),
      updated_at=now()
  where id=t.id;

  insert into public.support_ticket_events(ticket_id,actor,event_type,message)
  values(t.id,'marlon','execution_claimed','Marlon execution worker claimed this ticket and began diagnosis.');
  return jsonb_build_object('ok',true,'ticket',to_jsonb(t),'run',to_jsonb(r),'resume',false);
end;
$$;

create or replace function public.report_marlon_execution(
  p_run_id uuid,
  p_status text,
  p_diagnosis text default null,
  p_patch_summary text default null,
  p_resolution text default null,
  p_commit_sha text default null,
  p_deployment_url text default null,
  p_verification jsonb default '{}'::jsonb,
  p_error text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  r public.marlon_execution_runs%rowtype;
  next_ticket_status text;
begin
  if p_status not in ('diagnosing','patching','testing','waiting_window','deploying','verifying','completed','blocked','failed') then raise exception 'Invalid execution status.'; end if;
  select * into r from public.marlon_execution_runs where id=p_run_id for update;
  if not found then raise exception 'Execution run not found.'; end if;
  if r.status in ('completed','blocked','failed') then raise exception 'Execution run is already final.'; end if;

  update public.marlon_execution_runs
  set status=p_status,
      heartbeat_at=now(),
      finished_at=case when p_status in ('completed','blocked','failed') then now() else finished_at end,
      diagnosis=coalesce(nullif(btrim(p_diagnosis),''),diagnosis),
      patch_summary=coalesce(nullif(btrim(p_patch_summary),''),patch_summary),
      resolution=coalesce(nullif(btrim(p_resolution),''),resolution),
      commit_sha=coalesce(nullif(btrim(p_commit_sha),''),commit_sha),
      deployment_url=coalesce(nullif(btrim(p_deployment_url),''),deployment_url),
      verification=coalesce(verification,'{}'::jsonb)||coalesce(p_verification,'{}'::jsonb),
      error=coalesce(nullif(btrim(p_error),''),error),
      metadata=coalesce(metadata,'{}'::jsonb)||coalesce(p_metadata,'{}'::jsonb)
  where id=p_run_id returning * into r;

  if p_status='completed' then
    next_ticket_status:='resolved';
    update public.support_tickets
    set status='resolved',
        diagnosis=coalesce(nullif(btrim(p_diagnosis),''),diagnosis),
        action_taken=coalesce(nullif(btrim(p_patch_summary),''),action_taken),
        resolution=coalesce(nullif(btrim(p_resolution),''),'Implemented and verified by Marlon execution worker.'),
        resolved_at=now(),
        context=coalesce(context,'{}'::jsonb)||jsonb_build_object('execution_run_id',r.id,'execution_commit_sha',r.commit_sha,'execution_deployment_url',r.deployment_url,'execution_verification',r.verification,'execution_finished_at',r.finished_at),
        updated_at=now()
    where id=r.ticket_id;
  elsif p_status='waiting_window' then
    select case when maintenance_override_state='pending' then 'waiting_approval' else 'waiting' end
    into next_ticket_status from public.support_tickets where id=r.ticket_id;
    update public.support_tickets
    set status=next_ticket_status,
        diagnosis=coalesce(nullif(btrim(p_diagnosis),''),diagnosis),
        action_taken=coalesce(nullif(btrim(p_patch_summary),''),action_taken),
        context=coalesce(context,'{}'::jsonb)||jsonb_build_object('execution_run_id',r.id,'execution_stage','waiting_window','tested_commit_sha',r.commit_sha,'maintenance_deferred',true,'execution_metadata',coalesce(p_metadata,'{}'::jsonb)),
        updated_at=now()
    where id=r.ticket_id;
  elsif p_status in ('blocked','failed') then
    next_ticket_status:='waiting';
    update public.support_tickets
    set status='waiting',
        diagnosis=coalesce(nullif(btrim(p_diagnosis),''),diagnosis),
        action_taken=coalesce(nullif(btrim(p_patch_summary),''),action_taken),
        context=coalesce(context,'{}'::jsonb)||jsonb_build_object(
          'execution_run_id',r.id,
          'execution_blocked',p_status='blocked',
          'execution_failed',p_status='failed',
          'execution_error',r.error,
          'execution_verification',r.verification,
          'execution_finished_at',r.finished_at,
          'execution_metadata',coalesce(p_metadata,'{}'::jsonb)
        ),
        updated_at=now()
    where id=r.ticket_id;
  else
    next_ticket_status:='in_progress';
    update public.support_tickets
    set status='in_progress',
        context=coalesce(context,'{}'::jsonb)||jsonb_build_object(
          'execution_run_id',r.id,
          'execution_stage',p_status,
          'execution_heartbeat_at',r.heartbeat_at,
          'execution_metadata',coalesce(p_metadata,'{}'::jsonb)
        ),
        updated_at=now()
    where id=r.ticket_id;
  end if;

  insert into public.support_ticket_events(ticket_id,actor,event_type,message)
  values(
    r.ticket_id,
    'marlon',
    'execution_'||p_status,
    case p_status
      when 'completed' then 'Marlon completed implementation and recorded verification evidence.'
      when 'waiting_window' then 'Marlon finished testing and is waiting for the maintenance window or Owner Deploy Now approval.'
      when 'blocked' then 'Marlon paused execution because a required capability or safe execution condition is unavailable.'
      when 'failed' then 'Marlon execution failed and the ticket was moved to Waiting for follow-up.'
      else 'Marlon execution advanced to '||p_status||'.'
    end
  );

  return jsonb_build_object('ok',true,'run',to_jsonb(r),'ticket_status',next_ticket_status);
end;
$$;

revoke all on function public.marlon_store_is_open(uuid) from public,anon,authenticated;
revoke all on function public.marlon_deployment_gate(uuid,text,text,boolean) from public,anon,authenticated;
revoke all on function public.claim_next_marlon_execution(text) from public,anon,authenticated;
revoke all on function public.report_marlon_execution(uuid,text,text,text,text,text,text,jsonb,text,jsonb) from public,anon,authenticated;

grant execute on function public.marlon_store_is_open(uuid) to service_role;
grant execute on function public.marlon_deployment_gate(uuid,text,text,boolean) to service_role;
grant execute on function public.claim_next_marlon_execution(text) to service_role;
grant execute on function public.report_marlon_execution(uuid,text,text,text,text,text,text,jsonb,text,jsonb) to service_role;
grant execute on function public.decide_marlon_maintenance_override(uuid,boolean) to authenticated;
