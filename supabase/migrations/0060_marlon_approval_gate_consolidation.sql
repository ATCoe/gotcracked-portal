create or replace function public.marlon_scope_fingerprint(p_surface text,p_title text,p_description text)
returns text language sql immutable as $$
  select md5(coalesce(p_surface,'') || E'\n' || coalesce(p_title,'') || E'\n' || coalesce(p_description,''));
$$;

create or replace function public.enforce_marlon_ui_approval_gate()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  scope_changed boolean := false;
  next_fingerprint text;
begin
  if new.category='ui_update' and new.change_level='high_level' then
    new.requires_approval := true;
    next_fingerprint := public.marlon_scope_fingerprint(new.surface,new.title,new.description);
    if tg_op='INSERT' then
      new.approval_state := 'pending'; new.approval_status := 'pending';
      new.approval_requested_at := coalesce(new.approval_requested_at,now());
      new.approval_decided_at := null; new.approval_decided_by := null;
      new.approval_fingerprint := next_fingerprint;
      new.approval_summary := coalesce(nullif(btrim(new.approval_summary),''),new.title);
      new.status := 'waiting_approval';
    else
      if old.change_level='high_level' and new.change_level<>'high_level' then raise exception 'High-level UI requests cannot be downgraded to bypass Owner approval.'; end if;
      scope_changed := new.surface is distinct from old.surface or new.title is distinct from old.title or new.description is distinct from old.description;
      if scope_changed then
        new.approval_state := 'pending'; new.approval_status := 'pending'; new.approval_requested_at := now();
        new.approval_decided_at := null; new.approval_decided_by := null; new.approval_fingerprint := next_fingerprint;
        new.approval_summary := new.title; new.status := 'waiting_approval';
      else
        new.approval_fingerprint := coalesce(new.approval_fingerprint,next_fingerprint);
        if new.approval_state='approved' or new.approval_status='approved' then new.approval_state := 'approved'; new.approval_status := 'approved';
        elsif new.approval_state='denied' or new.approval_status='denied' then new.approval_state := 'denied'; new.approval_status := 'denied';
        else new.approval_state := 'pending'; new.approval_status := 'pending'; end if;
      end if;
      if new.status in ('in_progress','resolved') and (new.approval_state<>'approved' or new.approval_status<>'approved') then raise exception 'Owner click approval is required before Marlon can execute a high-level UI change.'; end if;
    end if;
  elsif new.category='ui_update' then
    new.requires_approval := false; new.approval_state := 'not_required'; new.approval_status := 'not_required';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_marlon_ui_approval_gate on public.support_tickets;
create trigger trg_marlon_ui_approval_gate before insert or update on public.support_tickets for each row execute function public.enforce_marlon_ui_approval_gate();

create or replace function public.create_ui_update_request(p_title text,p_description text,p_surface text default 'portal',p_priority text default 'normal',p_context jsonb default '{}'::jsonb,p_change_level text default 'high_level')
returns public.support_tickets language plpgsql security definer set search_path=public as $$
declare saved public.support_tickets; requester_role text; level text := case when p_change_level='standard' then 'standard' else 'high_level' end;
begin
  if auth.uid() is null then raise exception 'Sign in required.'; end if;
  select role::text into requester_role from public.profiles where id=auth.uid() and active=true;
  if requester_role is distinct from 'owner' then raise exception 'Only an Owner can submit UI update requests to Marlon.'; end if;
  if p_surface not in ('portal','website','repository','cloudflare') then raise exception 'Invalid UI update surface.'; end if;
  if p_priority not in ('low','normal','high','critical') then raise exception 'Invalid priority.'; end if;
  insert into public.support_tickets(location_id,created_by,title,description,category,priority,status,source,surface,managed_by,requires_approval,change_level,approval_state,approval_status,approval_requested_at,approval_fingerprint,approval_summary,context)
  values(public.current_location_id(),auth.uid(),btrim(p_title),btrim(p_description),'ui_update',p_priority,case when level='high_level' then 'waiting_approval' else 'open' end,'marlon_chat',p_surface,'Marlon',level='high_level',level,case when level='high_level' then 'pending' else 'not_required' end,case when level='high_level' then 'pending' else 'not_required' end,case when level='high_level' then now() else null end,case when level='high_level' then public.marlon_scope_fingerprint(p_surface,btrim(p_title),btrim(p_description)) else null end,btrim(p_title),coalesce(p_context,'{}'::jsonb)||jsonb_build_object('owner_requested',true,'approval_gate_version',2)) returning * into saved;
  insert into public.support_ticket_events(ticket_id,actor_user_id,actor,event_type,message) values(saved.id,auth.uid(),'employee',case when level='high_level' then 'owner_ui_request_pending_approval' else 'owner_ui_request' end,case when level='high_level' then 'Owner requested a high-level change. Explicit click approval is required before execution.' else 'Owner-authorized standard UI update request created for Marlon.' end);
  return saved;
end;
$$;

create or replace function public.decide_marlon_ui_update(p_ticket uuid,p_approve boolean)
returns public.support_tickets language plpgsql security definer set search_path=public as $$
declare saved public.support_tickets; requester_role text;
begin
  if auth.uid() is null then raise exception 'Sign in required.'; end if;
  select role::text into requester_role from public.profiles where id=auth.uid() and active=true;
  if requester_role is distinct from 'owner' then raise exception 'Only an Owner can approve or deny a high-level Marlon change.'; end if;
  select * into saved from public.support_tickets where id=p_ticket and location_id=public.current_location_id() for update;
  if not found then raise exception 'Change request not found.'; end if;
  if saved.category<>'ui_update' or saved.change_level<>'high_level' or not saved.requires_approval then raise exception 'This request does not require high-level approval.'; end if;
  if saved.approval_state<>'pending' or saved.approval_status<>'pending' then raise exception 'This change request has already been decided.'; end if;
  if saved.approval_fingerprint is distinct from public.marlon_scope_fingerprint(saved.surface,saved.title,saved.description) then raise exception 'The proposed scope changed. A new approval request is required.'; end if;
  update public.support_tickets set approval_state=case when p_approve then 'approved' else 'denied' end,approval_status=case when p_approve then 'approved' else 'denied' end,approval_decided_by=auth.uid(),approval_decided_at=now(),status=case when p_approve then 'open' else 'closed' end,resolution=case when p_approve then resolution else coalesce(resolution,'Denied by Owner before execution.') end,context=coalesce(context,'{}'::jsonb)||jsonb_build_object('owner_final_approval',p_approve,'owner_final_approval_at',now(),'owner_final_approval_by',auth.uid()),updated_at=now() where id=p_ticket returning * into saved;
  insert into public.support_ticket_events(ticket_id,actor_user_id,actor,event_type,message) values(saved.id,auth.uid(),'owner',case when p_approve then 'high_level_change_approved' else 'high_level_change_denied' end,case when p_approve then 'Owner clicked Approve. Marlon may proceed only with the exact fingerprinted scope, subject to protected-system and maintenance safeguards.' else 'Owner clicked Deny. The proposed high-level change was cancelled before execution.' end);
  return saved;
end;
$$;

create or replace function public.decide_marlon_change_approval(p_ticket_id uuid,p_approved boolean)
returns public.support_tickets language sql security definer set search_path=public as $$ select public.decide_marlon_ui_update(p_ticket_id,p_approved); $$;

create or replace function public.marlon_change_is_approved(p_ticket_id uuid,p_expected_fingerprint text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.support_tickets t where t.id=p_ticket_id and t.category='ui_update' and t.change_level='high_level' and t.requires_approval=true and t.approval_state='approved' and t.approval_status='approved' and t.approval_fingerprint=p_expected_fingerprint and t.approval_fingerprint=public.marlon_scope_fingerprint(t.surface,t.title,t.description));
$$;

create or replace function public.marlon_ui_execution_allowed(p_ticket uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select case when category<>'ui_update' then false when change_level='standard' then true when change_level='high_level' then approval_state='approved' and approval_status='approved' and approval_fingerprint=public.marlon_scope_fingerprint(surface,title,description) else false end from public.support_tickets where id=p_ticket and location_id=public.current_location_id()),false);
$$;

revoke all on function public.marlon_scope_fingerprint(text,text,text) from public,anon,authenticated;
revoke all on function public.enforce_marlon_ui_approval_gate() from public,anon,authenticated;
revoke all on function public.marlon_change_is_approved(uuid,text) from public,anon,authenticated;
revoke all on function public.marlon_ui_execution_allowed(uuid) from public,anon;
grant execute on function public.create_ui_update_request(text,text,text,text,jsonb,text) to authenticated;
grant execute on function public.decide_marlon_ui_update(uuid,boolean) to authenticated;
grant execute on function public.decide_marlon_change_approval(uuid,boolean) to authenticated;
grant execute on function public.marlon_ui_execution_allowed(uuid) to authenticated;
