create or replace function public.route_marlon_repository_child_scope()
returns trigger
language plpgsql
set search_path='public'
as $function$
declare
  scope_text text;
begin
  if new.parent_ticket_id is null
     or coalesce(new.context->>'derived_from_both_surface','false') <> 'true'
     or nullif(btrim(coalesce(new.context->>'repository_execution_scope','')),'') is not null then
    return new;
  end if;

  if new.surface='portal' then
    scope_text := 'Execute only the Portal portion of the approved parent request in ATCoe/gotcracked-portal. Portal-specific requirements remain in scope. Requirements that belong only to the public customer website must not block this repository task.';
  elsif new.surface='website' then
    scope_text := 'Execute only the public customer website portion of the approved parent request in ATCoe/gotcracked-site. Audit and repair website bugs, UI issues, and incomplete code. Portal-only requirements, including Portal directory controls, must not block this repository task.';
  else
    return new;
  end if;

  new.context := coalesce(new.context,'{}'::jsonb)
    || jsonb_build_object('repository_execution_scope',scope_text);
  return new;
end;
$function$;

drop trigger if exists trg_route_marlon_repository_child_scope on public.support_tickets;
create trigger trg_route_marlon_repository_child_scope
before insert or update of parent_ticket_id,surface,context on public.support_tickets
for each row execute function public.route_marlon_repository_child_scope();
-- Backfill repository routing on existing multi-surface child tickets.
update public.support_tickets
set context=context
where parent_ticket_id is not null
  and coalesce(context->>'derived_from_both_surface','false')='true'
  and nullif(btrim(coalesce(context->>'repository_execution_scope','')),'') is null;

-- Retry website children that were blocked only because a Portal-only requirement
-- leaked into the website repository planner.
update public.support_tickets
set status='open',
    diagnosis=null,
    action_taken=null,
    resolution=null,
    context=(coalesce(context,'{}'::jsonb)
      - 'execution_error' - 'execution_blocked' - 'execution_failed')
      || jsonb_build_object(
        'routing_retry',true,
        'routing_retry_reason','Repository-specific scope now prevents Portal-only requirements from blocking website execution.',
        'routing_retry_at',now()
      ),
    updated_at=now()
where parent_ticket_id is not null
  and surface='website'
  and approval_status='approved'
  and coalesce(context->>'derived_from_both_surface','false')='true'
  and status='waiting'
  and lower(coalesce(context->>'execution_error','')) like '%master directory%';

create or replace function public.claim_next_marlon_execution(
  p_executor text,
  p_repository text default 'ATCoe/gotcracked-portal'
)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare
  t public.support_tickets%rowtype;
  r public.marlon_execution_runs%rowtype;
  repo text := btrim(coalesce(p_repository,''));
begin
  if nullif(btrim(coalesce(p_executor,'')),'') is null then
    raise exception 'Executor identity is required.';
  end if;
  if repo not in ('ATCoe/gotcracked-portal','ATCoe/gotcracked-site') then
    raise exception 'Unsupported Marlon repository.';
  end if;

  select er.* into r
  from public.marlon_execution_runs er
  join public.support_tickets st on st.id=er.ticket_id
  where er.status='waiting_window'
    and er.repository=repo
    and (
      not public.marlon_store_is_open(st.location_id)
      or (st.maintenance_override_state='approved'
          and st.maintenance_override_commit_sha=er.commit_sha)
    )
  order by er.started_at
  for update of er skip locked
  limit 1;

  if found then
    select * into t from public.support_tickets where id=r.ticket_id for update;
    update public.marlon_execution_runs
    set status='deploying',executor=btrim(p_executor),heartbeat_at=now(),
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('resumed_at',now(),'resumed_by',btrim(p_executor))
    where id=r.id returning * into r;
    update public.support_tickets
    set status='in_progress',updated_at=now()
    where id=t.id returning * into t;
    insert into public.support_ticket_events(ticket_id,actor,event_type,message)
    values(t.id,'marlon','execution_resumed','Marlon resumed the tested deployment after the maintenance window opened or an Owner approved immediate deployment.');
    return jsonb_build_object('ok',true,'ticket',to_jsonb(t),'run',to_jsonb(r),'resume',true);
  end if;

  select * into t
  from public.support_tickets st
  where st.managed_by='Marlon'
    and st.status='open'
    and st.source in ('marlon_chat','marlon_call','runtime_error','repository_audit','system')
    and (
      (repo='ATCoe/gotcracked-portal' and st.surface in ('portal','repository'))
      or (repo='ATCoe/gotcracked-site' and st.surface='website')
    )
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
  order by
    case st.priority when 'critical' then 1 when 'high' then 2 when 'normal' then 3 else 4 end,
    case
      when coalesce(st.context->>'owner_requested','false')='true' then 0
      when st.source in ('marlon_chat','marlon_call') then 0
      else 1
    end,
    st.created_at
  for update skip locked
  limit 1;

  if not found then
    return jsonb_build_object('ok',true,'ticket',null,'run',null,'resume',false);
  end if;

  insert into public.marlon_execution_runs(ticket_id,location_id,repository,executor,metadata)
  values(
    t.id,t.location_id,repo,btrim(p_executor),
    jsonb_build_object(
      'claimed_from_status',t.status,
      'ticket_number',t.ticket_number,
      'repository',repo,
      'owner_requested',coalesce(t.context->>'owner_requested','false')='true'
    )
  ) returning * into r;
  update public.support_tickets
  set status='in_progress',
      context=coalesce(context,'{}'::jsonb)||jsonb_build_object(
        'execution_run_id',r.id,
        'execution_executor',r.executor,
        'execution_repository',repo,
        'execution_started_at',r.started_at
      ),
      updated_at=now()
  where id=t.id;

  insert into public.support_ticket_events(ticket_id,actor,event_type,message)
  values(t.id,'marlon','execution_claimed','Marlon execution worker claimed this ticket and began diagnosis in '||repo||'.');

  return jsonb_build_object('ok',true,'ticket',to_jsonb(t),'run',to_jsonb(r),'resume',false);
end;
$function$;
