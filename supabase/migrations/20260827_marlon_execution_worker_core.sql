create table if not exists public.marlon_execution_runs (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  repository text not null default 'ATCoe/gotcracked-portal',
  status text not null default 'claimed' check (status in ('claimed','diagnosing','patching','testing','deploying','verifying','completed','blocked','failed')),
  executor text not null,
  started_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  finished_at timestamptz,
  branch text,
  commit_sha text,
  deployment_url text,
  diagnosis text,
  patch_summary text,
  resolution text,
  verification jsonb not null default '{}'::jsonb,
  error text,
  metadata jsonb not null default '{}'::jsonb
);

create unique index if not exists marlon_execution_runs_one_active_ticket
on public.marlon_execution_runs(ticket_id)
where status in ('claimed','diagnosing','patching','testing','deploying','verifying');

create index if not exists marlon_execution_runs_ticket_started_idx
on public.marlon_execution_runs(ticket_id, started_at desc);

alter table public.marlon_execution_runs enable row level security;

drop policy if exists marlon_execution_runs_read on public.marlon_execution_runs;
create policy marlon_execution_runs_read
on public.marlon_execution_runs for select to authenticated
using (location_id = public.current_location_id());

grant select on public.marlon_execution_runs to authenticated;

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
  if nullif(btrim(coalesce(p_executor,'')),'') is null then
    raise exception 'Executor identity is required.';
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
    and not exists (
      select 1 from public.marlon_execution_runs er
      where er.ticket_id=st.id
        and er.status in ('claimed','diagnosing','patching','testing','deploying','verifying')
    )
  order by
    case st.priority when 'critical' then 1 when 'high' then 2 when 'normal' then 3 else 4 end,
    st.created_at
  for update skip locked
  limit 1;

  if not found then
    return jsonb_build_object('ok',true,'ticket',null,'run',null);
  end if;

  insert into public.marlon_execution_runs(ticket_id,location_id,executor,metadata)
  values(t.id,t.location_id,btrim(p_executor),jsonb_build_object('claimed_from_status',t.status,'ticket_number',t.ticket_number))
  returning * into r;

  update public.support_tickets
  set status='in_progress',
      context=coalesce(context,'{}'::jsonb)||jsonb_build_object(
        'execution_run_id',r.id,
        'execution_executor',r.executor,
        'execution_started_at',r.started_at
      ),
      updated_at=now()
  where id=t.id;

  insert into public.support_ticket_events(ticket_id,actor,event_type,message)
  values(t.id,'marlon','execution_claimed','Marlon execution worker claimed this ticket and began diagnosis.');

  return jsonb_build_object('ok',true,'ticket',to_jsonb(t),'run',to_jsonb(r));
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
  if p_status not in ('diagnosing','patching','testing','deploying','verifying','completed','blocked','failed') then
    raise exception 'Invalid execution status.';
  end if;

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
  where id=p_run_id
  returning * into r;

  if p_status='completed' then
    next_ticket_status := 'resolved';
    update public.support_tickets
    set status='resolved',
        diagnosis=coalesce(nullif(btrim(p_diagnosis),''),diagnosis),
        action_taken=coalesce(nullif(btrim(p_patch_summary),''),action_taken),
        resolution=coalesce(nullif(btrim(p_resolution),''),'Implemented and verified by Marlon execution worker.'),
        resolved_at=now(),
        context=coalesce(context,'{}'::jsonb)||jsonb_build_object(
          'execution_run_id',r.id,
          'execution_commit_sha',r.commit_sha,
          'execution_deployment_url',r.deployment_url,
          'execution_verification',r.verification,
          'execution_finished_at',r.finished_at
        ),
        updated_at=now()
    where id=r.ticket_id;
  elsif p_status in ('blocked','failed') then
    next_ticket_status := 'waiting';
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
          'execution_finished_at',r.finished_at
        ),
        updated_at=now()
    where id=r.ticket_id;
  else
    next_ticket_status := 'in_progress';
    update public.support_tickets
    set context=coalesce(context,'{}'::jsonb)||jsonb_build_object('execution_run_id',r.id,'execution_stage',p_status,'execution_heartbeat_at',r.heartbeat_at),updated_at=now()
    where id=r.ticket_id;
  end if;

  insert into public.support_ticket_events(ticket_id,actor,event_type,message)
  values(
    r.ticket_id,
    'marlon',
    'execution_'||p_status,
    case p_status
      when 'completed' then 'Marlon completed implementation and recorded verification evidence.'
      when 'blocked' then 'Marlon paused execution because a required capability or safe execution condition is unavailable.'
      when 'failed' then 'Marlon execution failed and the ticket was moved to Waiting for follow-up.'
      else 'Marlon execution advanced to '||p_status||'.'
    end
  );

  return jsonb_build_object('ok',true,'run',to_jsonb(r),'ticket_status',next_ticket_status);
end;
$$;

revoke all on function public.claim_next_marlon_execution(text) from public,anon,authenticated;
revoke all on function public.report_marlon_execution(uuid,text,text,text,text,text,text,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.claim_next_marlon_execution(text) to service_role;
grant execute on function public.report_marlon_execution(uuid,text,text,text,text,text,text,jsonb,text,jsonb) to service_role;
