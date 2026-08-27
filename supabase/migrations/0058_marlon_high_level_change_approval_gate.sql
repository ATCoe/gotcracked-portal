alter table public.support_tickets
  add column if not exists approval_status text not null default 'not_required',
  add column if not exists approval_requested_at timestamptz,
  add column if not exists approval_decided_at timestamptz,
  add column if not exists approval_decided_by uuid references public.profiles(id) on delete set null,
  add column if not exists approval_fingerprint text,
  add column if not exists approval_summary text;

alter table public.support_tickets drop constraint if exists support_tickets_approval_status_check;
alter table public.support_tickets add constraint support_tickets_approval_status_check
  check (approval_status in ('not_required','pending','approved','denied'));

create or replace function public.create_ui_update_request(
  p_title text,
  p_description text,
  p_surface text default 'portal'::text,
  p_priority text default 'normal'::text,
  p_context jsonb default '{}'::jsonb
)
returns public.support_tickets
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  saved public.support_tickets;
  requester_role text;
  fingerprint text;
begin
  if auth.uid() is null then raise exception 'Sign in required.'; end if;
  select role::text into requester_role from public.profiles where id=auth.uid() and active=true;
  if requester_role is distinct from 'owner' then raise exception 'Only an Owner can submit UI update requests to Marlon.'; end if;
  if p_surface not in ('portal','website','repository','cloudflare') then raise exception 'Invalid UI update surface.'; end if;
  if p_priority not in ('low','normal','high','critical') then raise exception 'Invalid priority.'; end if;

  fingerprint := md5(coalesce(p_surface,'') || E'\n' || coalesce(p_title,'') || E'\n' || coalesce(p_description,'') || E'\n' || coalesce(p_context,'{}'::jsonb)::text);

  insert into public.support_tickets(
    location_id,created_by,title,description,category,priority,status,source,surface,managed_by,
    requires_approval,approval_status,approval_requested_at,approval_fingerprint,approval_summary,context
  ) values(
    public.current_location_id(),auth.uid(),btrim(p_title),btrim(p_description),'ui_update',p_priority,'waiting_approval','marlon_chat',p_surface,'Marlon',
    true,'pending',now(),fingerprint,btrim(p_title),coalesce(p_context,'{}'::jsonb)
  ) returning * into saved;

  insert into public.support_ticket_events(ticket_id,actor_user_id,actor,event_type,message)
  values(saved.id,auth.uid(),'employee','approval_requested','High-level change queued for explicit Owner approval. No execution is authorized until the Approve button is clicked.');
  return saved;
end;
$$;

create or replace function public.decide_marlon_change_approval(p_ticket_id uuid,p_approved boolean)
returns public.support_tickets
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  saved public.support_tickets;
  requester_role text;
begin
  if auth.uid() is null then raise exception 'Sign in required.'; end if;
  select role::text into requester_role from public.profiles where id=auth.uid() and active=true;
  if requester_role is distinct from 'owner' then raise exception 'Only an Owner can approve or deny Marlon high-level changes.'; end if;

  select * into saved from public.support_tickets
  where id=p_ticket_id and location_id=public.current_location_id() for update;
  if saved.id is null then raise exception 'Approval request not found.'; end if;
  if not saved.requires_approval then raise exception 'This change does not require approval.'; end if;
  if saved.approval_status is distinct from 'pending' then raise exception 'This approval has already been decided.'; end if;

  update public.support_tickets
  set approval_status=case when p_approved then 'approved' else 'denied' end,
      approval_decided_at=now(),approval_decided_by=auth.uid(),
      status=case when p_approved then 'open' else 'closed' end,
      resolution=case when p_approved then resolution else coalesce(resolution,'Denied by Owner before execution.') end,
      updated_at=now()
  where id=p_ticket_id returning * into saved;

  insert into public.support_ticket_events(ticket_id,actor_user_id,actor,event_type,message)
  values(saved.id,auth.uid(),'owner',case when p_approved then 'approval_granted' else 'approval_denied' end,
    case when p_approved then 'Owner clicked Approve. Marlon may execute only the exact approved scope and must request new approval if scope changes.'
    else 'Owner clicked Deny. Marlon is not authorized to execute this change.' end);
  return saved;
end;
$$;

create or replace function public.marlon_change_is_approved(p_ticket_id uuid,p_expected_fingerprint text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists(select 1 from public.support_tickets t where t.id=p_ticket_id and t.requires_approval=true and t.approval_status='approved' and t.approval_fingerprint=p_expected_fingerprint);
$$;

revoke all on function public.decide_marlon_change_approval(uuid,boolean) from public;
grant execute on function public.decide_marlon_change_approval(uuid,boolean) to authenticated;
revoke all on function public.marlon_change_is_approved(uuid,text) from public, anon, authenticated;
