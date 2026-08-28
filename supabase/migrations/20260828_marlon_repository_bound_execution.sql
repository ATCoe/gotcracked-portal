create or replace function public.claim_next_marlon_execution(p_executor text,p_repository text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  t public.support_tickets%rowtype;
  r public.marlon_execution_runs%rowtype;
  v_repo text := btrim(coalesce(p_repository,''));
begin
  if nullif(btrim(coalesce(p_executor,'')),'') is null then raise exception 'Executor identity is required.'; end if;
  if v_repo not in ('ATCoe/gotcracked-portal','ATCoe/gotcracked-site') then raise exception 'Unsupported Marlon executor repository.'; end if;

  select er.* into r
  from public.marlon_execution_runs er
  join public.support_tickets st on st.id=er.ticket_id
  where er.status='waiting_window'
    and er.repository=v_repo
    and ((v_repo='ATCoe/gotcracked-portal' and st.surface in ('portal','repository')) or (v_repo='ATCoe/gotcracked-site' and st.surface='website'))
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
    set status='deploying',executor=btrim(p_executor),heartbeat_at=now(),metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('resumed_at',now(),'resumed_by',btrim(p_executor),'repository',v_repo)
    where id=r.id returning * into r;
    update public.support_tickets set status='in_progress',updated_at=now() where id=t.id returning * into t;
    insert into public.support_ticket_events(ticket_id,actor,event_type,message)
    values(t.id,'marlon','execution_resumed','Marlon resumed the exact tested deployment after the maintenance window opened or an Owner approved immediate deployment.');
    return jsonb_build_object('ok',true,'ticket',to_jsonb(t),'run',to_jsonb(r),'resume',true,'repository',v_repo);
  end if;

  select * into t
  from public.support_tickets st
  where st.managed_by='Marlon'
    and st.status='open'
    and st.source in ('marlon_chat','marlon_call','runtime_error','repository_audit','system')
    and ((v_repo='ATCoe/gotcracked-portal' and st.surface in ('portal','repository')) or (v_repo='ATCoe/gotcracked-site' and st.surface='website'))
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

  if not found then return jsonb_build_object('ok',true,'ticket',null,'run',null,'resume',false,'repository',v_repo); end if;

  insert into public.marlon_execution_runs(ticket_id,location_id,repository,executor,metadata)
  values(t.id,t.location_id,v_repo,btrim(p_executor),jsonb_build_object('claimed_from_status',t.status,'ticket_number',t.ticket_number,'repository',v_repo))
  returning * into r;

  update public.support_tickets
  set status='in_progress',
      context=coalesce(context,'{}'::jsonb)||jsonb_build_object(
        'execution_run_id',r.id,
        'execution_executor',r.executor,
        'execution_repository',v_repo,
        'execution_started_at',r.started_at
      ),
      updated_at=now()
  where id=t.id;

  insert into public.support_ticket_events(ticket_id,actor,event_type,message)
  values(t.id,'marlon','execution_claimed','Marlon execution worker claimed this ticket in '||v_repo||' and began diagnosis.');
  return jsonb_build_object('ok',true,'ticket',to_jsonb(t),'run',to_jsonb(r),'resume',false,'repository',v_repo);
end;
$$;

revoke all on function public.claim_next_marlon_execution(text,text) from public,anon,authenticated;
grant execute on function public.claim_next_marlon_execution(text,text) to service_role;
