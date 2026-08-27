alter table public.support_tickets
  add column if not exists change_level text not null default 'standard',
  add column if not exists approval_state text not null default 'not_required',
  add column if not exists approval_decided_by uuid references public.profiles(id) on delete set null,
  add column if not exists approval_decided_at timestamptz;

do $$ begin
  alter table public.support_tickets add constraint support_tickets_change_level_check check (change_level in ('standard','high_level'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.support_tickets add constraint support_tickets_approval_state_check check (approval_state in ('not_required','pending','approved','denied'));
exception when duplicate_object then null; end $$;

create or replace function public.enforce_marlon_ui_approval_gate()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.category='ui_update' and new.change_level='high_level' then
    new.requires_approval := true;
    if tg_op='INSERT' then
      if new.approval_state not in ('approved','denied') then new.approval_state := 'pending'; end if;
      if new.approval_state='pending' then new.status := 'waiting_approval'; end if;
    else
      if old.change_level='high_level' and new.change_level<>'high_level' then
        raise exception 'High-level UI requests cannot be downgraded to bypass Owner approval.';
      end if;
      if new.status in ('in_progress','resolved') and new.approval_state<>'approved' then
        raise exception 'Owner click approval is required before Marlon can execute a high-level UI change.';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_marlon_ui_approval_gate on public.support_tickets;
create trigger trg_marlon_ui_approval_gate
before insert or update on public.support_tickets
for each row execute function public.enforce_marlon_ui_approval_gate();

create or replace function public.create_ui_update_request(
  p_title text,
  p_description text,
  p_surface text default 'portal',
  p_priority text default 'normal',
  p_context jsonb default '{}'::jsonb,
  p_change_level text default 'high_level'
)
returns public.support_tickets
language plpgsql
security definer
set search_path=public
as $$
declare
  saved public.support_tickets;
  requester_role text;
  level text := case when p_change_level='standard' then 'standard' else 'high_level' end;
begin
  if auth.uid() is null then raise exception 'Sign in required.'; end if;
  select role::text into requester_role from public.profiles where id=auth.uid() and active=true;
  if requester_role is distinct from 'owner' then raise exception 'Only an Owner can submit UI update requests to Marlon.'; end if;
  if p_surface not in ('portal','website','repository','cloudflare') then raise exception 'Invalid UI update surface.'; end if;
  if p_priority not in ('low','normal','high','critical') then raise exception 'Invalid priority.'; end if;

  insert into public.support_tickets(
    location_id,created_by,title,description,category,priority,status,source,surface,managed_by,
    requires_approval,change_level,approval_state,context
  ) values(
    public.current_location_id(),auth.uid(),btrim(p_title),btrim(p_description),'ui_update',p_priority,
    case when level='high_level' then 'waiting_approval' else 'open' end,
    'marlon_chat',p_surface,'Marlon',level='high_level',level,
    case when level='high_level' then 'pending' else 'not_required' end,
    coalesce(p_context,'{}'::jsonb) || jsonb_build_object('owner_requested',true,'approval_gate_version',1)
  ) returning * into saved;

  insert into public.support_ticket_events(ticket_id,actor_user_id,actor,event_type,message)
  values(saved.id,auth.uid(),'employee',
    case when level='high_level' then 'owner_ui_request_pending_approval' else 'owner_ui_request' end,
    case when level='high_level' then 'Owner requested a high-level UI change. Final Yes/No click approval is required before execution.' else 'Owner-authorized standard UI update request created for Marlon.' end);
  return saved;
end;
$$;

create or replace function public.decide_marlon_ui_update(p_ticket uuid, p_approve boolean)
returns public.support_tickets
language plpgsql
security definer
set search_path=public
as $$
declare
  saved public.support_tickets;
  requester_role text;
begin
  if auth.uid() is null then raise exception 'Sign in required.'; end if;
  select role::text into requester_role from public.profiles where id=auth.uid() and active=true;
  if requester_role is distinct from 'owner' then raise exception 'Only an Owner can approve or deny a high-level Marlon UI change.'; end if;

  select * into saved from public.support_tickets
  where id=p_ticket and location_id=public.current_location_id() for update;
  if not found then raise exception 'UI update request not found.'; end if;
  if saved.category<>'ui_update' or saved.change_level<>'high_level' then raise exception 'This request does not require high-level UI approval.'; end if;
  if saved.approval_state<>'pending' then raise exception 'This UI update request has already been decided.'; end if;

  update public.support_tickets
  set approval_state=case when p_approve then 'approved' else 'denied' end,
      approval_decided_by=auth.uid(),
      approval_decided_at=now(),
      status=case when p_approve then 'open' else 'closed' end,
      context=coalesce(context,'{}'::jsonb) || jsonb_build_object(
        'owner_final_approval',p_approve,
        'owner_final_approval_at',now(),
        'owner_final_approval_by',auth.uid()
      ),
      updated_at=now()
  where id=p_ticket
  returning * into saved;

  insert into public.support_ticket_events(ticket_id,actor_user_id,actor,event_type,message)
  values(saved.id,auth.uid(),'owner',
    case when p_approve then 'high_level_ui_approved' else 'high_level_ui_denied' end,
    case when p_approve then 'Owner clicked Yes. Marlon may proceed with the described high-level UI change, subject to protected-system and maintenance safeguards.' else 'Owner clicked No. The proposed high-level UI change was cancelled before execution.' end);
  return saved;
end;
$$;

create or replace function public.marlon_ui_execution_allowed(p_ticket uuid)
returns boolean
language sql
security definer
set search_path=public
stable
as $$
  select coalesce((
    select case
      when category<>'ui_update' then false
      when change_level='standard' then true
      when change_level='high_level' then approval_state='approved'
      else false end
    from public.support_tickets
    where id=p_ticket and location_id=public.current_location_id()
  ),false)
$$;

grant execute on function public.create_ui_update_request(text,text,text,text,jsonb,text) to authenticated;
grant execute on function public.decide_marlon_ui_update(uuid,boolean) to authenticated;
grant execute on function public.marlon_ui_execution_allowed(uuid) to authenticated;
