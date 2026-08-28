create or replace function public.enforce_marlon_ui_approval_gate()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  scope_changed boolean := false;
  next_fingerprint text;
begin
  if coalesce(new.managed_by,'Marlon')='Marlon' and new.change_level='high_level' then
    new.requires_approval := true;
    next_fingerprint := public.marlon_scope_fingerprint(new.surface,new.title,new.description);
    if tg_op='INSERT' then
      new.approval_state := 'pending';
      new.approval_status := 'pending';
      new.approval_requested_at := coalesce(new.approval_requested_at,now());
      new.approval_decided_at := null;
      new.approval_decided_by := null;
      new.approval_fingerprint := next_fingerprint;
      new.approval_summary := coalesce(nullif(btrim(new.approval_summary),''),new.title);
      new.status := 'waiting_approval';
    else
      if old.change_level='high_level' and new.change_level<>'high_level' then
        raise exception 'High-level Marlon requests cannot be downgraded to bypass Owner approval.';
      end if;
      scope_changed := new.surface is distinct from old.surface
        or new.title is distinct from old.title
        or new.description is distinct from old.description;
      if scope_changed then
        new.approval_state := 'pending';
        new.approval_status := 'pending';
        new.approval_requested_at := now();
        new.approval_decided_at := null;
        new.approval_decided_by := null;
        new.approval_fingerprint := next_fingerprint;
        new.approval_summary := new.title;
        new.status := 'waiting_approval';
      else
        new.approval_fingerprint := coalesce(new.approval_fingerprint,next_fingerprint);
        if new.approval_state='approved' or new.approval_status='approved' then
          new.approval_state := 'approved';
          new.approval_status := 'approved';
        elsif new.approval_state='denied' or new.approval_status='denied' then
          new.approval_state := 'denied';
          new.approval_status := 'denied';
        else
          new.approval_state := 'pending';
          new.approval_status := 'pending';
        end if;
      end if;
      if new.status in ('in_progress','resolved') and (new.approval_state<>'approved' or new.approval_status<>'approved') then
        raise exception 'Owner click approval is required before Marlon can execute a high-level change.';
      end if;
    end if;
  elsif new.category='ui_update' then
    new.requires_approval := false;
    new.approval_state := 'not_required';    new.approval_status := 'not_required';
  end if;
  return new;
end;
$$;

create or replace function public.decide_marlon_high_level_change(p_ticket uuid, p_approve boolean)
returns public.support_tickets
language plpgsql
security definer
set search_path=public
as $$
declare
  saved public.support_tickets;
  requester_role text;
  portal_child public.support_tickets;
  website_child public.support_tickets;
  child_title text;
begin
  if auth.uid() is null then raise exception 'Sign in required.'; end if;
  select role::text into requester_role from public.profiles where id=auth.uid() and active=true;
  if requester_role is distinct from 'owner' then raise exception 'Only an Owner can approve or deny a high-level Marlon change.'; end if;
  select * into saved from public.support_tickets where id=p_ticket and location_id=public.current_location_id() for update;
  if not found then raise exception 'Change request not found.'; end if;
  if saved.change_level<>'high_level' or not saved.requires_approval then raise exception 'This request does not require high-level approval.'; end if;
  if saved.approval_state<>'pending' or saved.approval_status<>'pending' then raise exception 'This change request has already been decided.'; end if;
  if saved.approval_fingerprint is distinct from public.marlon_scope_fingerprint(saved.surface,saved.title,saved.description) then raise exception 'The proposed scope changed. A new approval request is required.'; end if;

  update public.support_tickets
  set approval_state=case when p_approve then 'approved' else 'denied' end,      approval_status=case when p_approve then 'approved' else 'denied' end,
      approval_decided_by=auth.uid(),approval_decided_at=now(),
      status=case when p_approve and surface='both' then 'in_progress' when p_approve then 'open' else 'closed' end,
      resolution=case when p_approve then resolution else coalesce(resolution,'Denied by Owner before execution.') end,
      context=coalesce(context,'{}'::jsonb)||jsonb_build_object('owner_final_approval',p_approve,'owner_final_approval_at',now(),'owner_final_approval_by',auth.uid()),
      updated_at=now()
  where id=p_ticket returning * into saved;

  if p_approve and saved.surface='both' then
    child_title := left(saved.title || ' [Portal]',180);
    insert into public.support_tickets(location_id,created_by,parent_ticket_id,title,description,category,priority,status,source,surface,managed_by,requires_approval,change_level,approval_state,approval_status,approval_requested_at,approval_fingerprint,approval_summary,context)
    values(saved.location_id,saved.created_by,saved.id,child_title,saved.description,saved.category,saved.priority,'waiting_approval','system','portal','Marlon',true,'high_level','pending','pending',saved.approval_requested_at,public.marlon_scope_fingerprint('portal',child_title,saved.description),child_title,coalesce(saved.context,'{}'::jsonb)||jsonb_build_object('parent_ticket_id',saved.id,'parent_ticket_number',saved.ticket_number,'target_repository','ATCoe/gotcracked-portal','derived_from_both_surface',true,'approval_inherited_from_parent',true)) returning * into portal_child;
    update public.support_tickets set approval_state='approved',approval_status='approved',approval_decided_by=auth.uid(),approval_decided_at=now(),status='open',context=coalesce(context,'{}'::jsonb)||jsonb_build_object('parent_approval_inherited_at',now(),'parent_approval_inherited_by',auth.uid()),updated_at=now() where id=portal_child.id returning * into portal_child;
    insert into public.support_ticket_events(ticket_id,actor_user_id,actor,event_type,message) values(portal_child.id,auth.uid(),'owner','parent_approval_inherited','This Portal execution item inherited the exact Owner approval from its multi-surface parent request.');

    child_title := left(saved.title || ' [Website]',180);
    insert into public.support_tickets(location_id,created_by,parent_ticket_id,title,description,category,priority,status,source,surface,managed_by,requires_approval,change_level,approval_state,approval_status,approval_requested_at,approval_fingerprint,approval_summary,context)
    values(saved.location_id,saved.created_by,saved.id,child_title,saved.description,saved.category,saved.priority,'waiting_approval','system','website','Marlon',true,'high_level','pending','pending',saved.approval_requested_at,public.marlon_scope_fingerprint('website',child_title,saved.description),child_title,coalesce(saved.context,'{}'::jsonb)||jsonb_build_object('parent_ticket_id',saved.id,'parent_ticket_number',saved.ticket_number,'target_repository','ATCoe/gotcracked-site','derived_from_both_surface',true,'approval_inherited_from_parent',true)) returning * into website_child;
    update public.support_tickets set approval_state='approved',approval_status='approved',approval_decided_by=auth.uid(),approval_decided_at=now(),status='open',context=coalesce(context,'{}'::jsonb)||jsonb_build_object('parent_approval_inherited_at',now(),'parent_approval_inherited_by',auth.uid()),updated_at=now() where id=website_child.id returning * into website_child;
    insert into public.support_ticket_events(ticket_id,actor_user_id,actor,event_type,message) values(website_child.id,auth.uid(),'owner','parent_approval_inherited','This Website execution item inherited the exact Owner approval from its multi-surface parent request.');

    update public.support_tickets set context=coalesce(context,'{}'::jsonb)||jsonb_build_object('child_ticket_ids',jsonb_build_array(portal_child.id,website_child.id),'child_ticket_numbers',jsonb_build_array(portal_child.ticket_number,website_child.ticket_number)),updated_at=now() where id=saved.id returning * into saved;
    insert into public.support_ticket_events(ticket_id,actor,event_type,message) values(saved.id,'marlon','multi_surface_execution_queued','Marlon split the approved Portal + Website scope into separately executable repository work items while preserving the single Owner approval.');
  end if;

  insert into public.support_ticket_events(ticket_id,actor_user_id,actor,event_type,message)
  values(saved.id,auth.uid(),'owner',case when p_approve then 'high_level_change_approved' else 'high_level_change_denied' end,case when p_approve then 'Owner clicked Approve. Marlon may proceed only with the exact fingerprinted scope, subject to protected-system and maintenance safeguards.' else 'Owner clicked Deny. The proposed high-level change was cancelled before execution.' end);
  return saved;
end;
$$;
grant execute on function public.decide_marlon_high_level_change(uuid,boolean) to authenticated;

create or replace function public.decide_marlon_ui_update(p_ticket uuid, p_approve boolean)
returns public.support_tickets
language plpgsql
security definer
set search_path=public
as $$
begin
  return public.decide_marlon_high_level_change(p_ticket,p_approve);
end;
$$;

create or replace function public.escalate_marlon_protected_execution(p_run_id uuid, p_reason text default null, p_diagnosis text default null)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  r public.marlon_execution_runs%rowtype;
  t public.support_tickets%rowtype;
  reason_text text := coalesce(nullif(btrim(p_reason),''),'Protected execution requires explicit Owner approval.');
begin
  select * into r from public.marlon_execution_runs where id=p_run_id for update;
  if not found then raise exception 'Execution run not found.'; end if;
  if r.status in ('completed','blocked','failed') then raise exception 'Execution run is already final.'; end if;
  select * into t from public.support_tickets where id=r.ticket_id for update;
  if not found then raise exception 'Support ticket not found.'; end if;

  update public.marlon_execution_runs  set status='blocked',heartbeat_at=now(),finished_at=now(),error=reason_text,
      diagnosis=coalesce(nullif(btrim(p_diagnosis),''),diagnosis),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('owner_approval_escalation',true,'escalated_at',now())
  where id=r.id returning * into r;

  update public.support_tickets
  set change_level='high_level',requires_approval=true,approval_state='pending',approval_status='pending',approval_requested_at=now(),approval_decided_at=null,approval_decided_by=null,
      approval_fingerprint=public.marlon_scope_fingerprint(surface,title,description),approval_summary=coalesce(nullif(btrim(approval_summary),''),title),
      status='waiting_approval',priority=case when priority in ('low','normal') then 'high' else priority end,
      diagnosis=coalesce(nullif(btrim(p_diagnosis),''),diagnosis),
      context=coalesce(context,'{}'::jsonb)||jsonb_build_object('protected_execution_escalated',true,'protected_execution_reason',reason_text,'protected_execution_run_id',r.id,'protected_execution_escalated_at',now()),updated_at=now()
  where id=t.id returning * into t;

  insert into public.support_ticket_events(ticket_id,actor,event_type,message)
  values(t.id,'marlon','owner_approval_requested','Marlon identified a protected change, stopped execution, and requested explicit Owner approval for the exact fingerprinted scope.');
  return jsonb_build_object('ok',true,'run',to_jsonb(r),'ticket',to_jsonb(t),'ticket_status',t.status);
end;
$$;

revoke all on function public.escalate_marlon_protected_execution(uuid,text,text) from public,anon,authenticated;
grant execute on function public.escalate_marlon_protected_execution(uuid,text,text) to service_role;

update public.support_tickets st
set change_level='high_level',requires_approval=true,approval_state='pending',approval_status='pending',approval_requested_at=now(),approval_decided_at=null,approval_decided_by=null,
    approval_fingerprint=public.marlon_scope_fingerprint(st.surface,st.title,st.description),approval_summary=coalesce(nullif(btrim(st.approval_summary),''),st.title),
    status='waiting_approval',priority=case when st.priority in ('low','normal') then 'high' else st.priority end,
    context=coalesce(st.context,'{}'::jsonb)||jsonb_build_object('protected_execution_escalated',true,'protected_execution_recovered',true,'protected_execution_escalated_at',now()),updated_at=now()
where st.managed_by='Marlon' and st.status='waiting' and st.change_level='standard'
  and exists(select 1 from public.marlon_execution_runs er where er.ticket_id=st.id and er.status='blocked' and er.error ilike 'Protected execution requires%');