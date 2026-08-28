-- Launch security: non-human workstation trust + Discord-first employee onboarding.

create table if not exists public.trusted_workstations (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  workstation_profile_id uuid not null references public.profiles(id) on delete cascade,
  auth_session_id uuid not null unique,
  device_id_hash text not null,
  device_label text not null default 'Front Desk Workstation',
  enrolled_by uuid not null references public.profiles(id),
  enrolled_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id),
  revoke_reason text,
  created_at timestamptz not null default now()
);
create index if not exists trusted_workstations_profile_active_idx on public.trusted_workstations(workstation_profile_id,last_seen_at desc) where revoked_at is null;
create index if not exists trusted_workstations_location_active_idx on public.trusted_workstations(location_id,last_seen_at desc) where revoked_at is null;

create table if not exists public.workstation_enrollment_grants (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  workstation_profile_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique,
  device_id_hash text,
  created_by uuid not null references public.profiles(id),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists workstation_enrollment_grants_active_idx on public.workstation_enrollment_grants(workstation_profile_id,expires_at desc) where consumed_at is null;
alter table public.trusted_workstations enable row level security;
alter table public.workstation_enrollment_grants enable row level security;
revoke all on public.trusted_workstations from anon,authenticated;
revoke all on public.workstation_enrollment_grants from anon,authenticated;

alter table public.staff_invitations add column if not exists discord_username text;
alter table public.staff_invitations add column if not exists recovery_email text;
alter table public.staff_invitations add column if not exists portal_email text;
alter table public.staff_invitations add column if not exists job_title text;
alter table public.staff_invitations add column if not exists first_day date;
alter table public.staff_invitations add column if not exists welcome_message text;
alter table public.staff_invitations add column if not exists welcome_payload jsonb not null default '{}'::jsonb;
alter table public.staff_invitations add column if not exists cancelled_at timestamptz;
create index if not exists staff_invitations_discord_pending_idx on public.staff_invitations(location_id,lower(discord_username),expires_at desc) where used_at is null and cancelled_at is null;

create table if not exists public.staff_onboarding_progress (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  invitation_id uuid references public.staff_invitations(id) on delete set null,
  status text not null default 'in_progress' check (status in ('in_progress','ready','completed','cancelled')),
  welcome_payload jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  welcome_ack_at timestamptz,
  profile_confirmed_at timestamptz,
  security_ack_at timestamptz,
  workflow_ack_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.staff_onboarding_progress enable row level security;
revoke all on public.staff_onboarding_progress from anon,authenticated;

create table if not exists public.staff_account_events (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references public.locations(id) on delete cascade,
  invitation_id uuid references public.staff_invitations(id) on delete set null,
  actor_user_id uuid,
  target_user_id uuid,
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.staff_account_events enable row level security;
revoke all on public.staff_account_events from anon,authenticated;

alter table public.profiles drop constraint if exists profiles_onboarding_status_check;
alter table public.profiles add constraint profiles_onboarding_status_check check (onboarding_status=any(array['invite_created','discord_pending','onboarding','password_change_required','active','disabled']::text[]));
update public.profiles set onboarding_complete=true,must_change_password=false,updated_at=now() where coalesce(account_type,'staff')='staff' and onboarding_status='active';
update public.profiles set onboarding_complete=true,must_change_password=false,updated_at=now() where account_type='shared_workstation';

create or replace function public.portal_session_authorized()
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select coalesce((select case
    when coalesce(p.account_type,'staff')='shared_workstation' then exists(
      select 1 from public.trusted_workstations tw where tw.workstation_profile_id=p.id and tw.location_id=p.location_id
        and tw.auth_session_id=nullif(auth.jwt()->>'session_id','')::uuid and tw.revoked_at is null)
    when coalesce(p.account_type,'staff')='staff' then (p.role='owner' or p.discord_user_id is not null)
    else false end from public.profiles p where p.id=auth.uid() and p.active=true),false)
$function$;

create or replace function public.current_actor_profile_id()
returns uuid language plpgsql stable security definer set search_path to 'public','extensions' as $function$
declare p public.profiles; raw_headers jsonb:='{}'::jsonb; operator_token text; token_digest text; operator_id uuid;
begin
  if auth.uid() is null or not public.portal_session_authorized() then return null; end if;
  select * into p from public.profiles where id=auth.uid() and active=true;
  if p.id is null then return null; end if;
  if coalesce(p.account_type,'staff')<>'shared_workstation' then return p.id; end if;
  begin raw_headers:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb); exception when others then raw_headers:='{}'::jsonb; end;
  operator_token:=nullif(raw_headers->>'x-gc-operator-token','');
  if operator_token is null then return null; end if;
  token_digest:=encode(extensions.digest(operator_token,'sha256'),'hex');
  select ws.operator_profile_id into operator_id from public.workstation_operator_sessions ws join public.profiles op on op.id=ws.operator_profile_id
  where ws.workstation_profile_id=p.id and ws.location_id=p.location_id and ws.token_hash=token_digest and ws.revoked_at is null and ws.expires_at>now()
    and op.active=true and coalesce(op.account_type,'staff')='staff' order by ws.created_at desc limit 1;
  return operator_id;
end;$function$;

create or replace function public.require_current_actor_profile_id()
returns uuid language plpgsql stable security definer set search_path to 'public' as $function$
declare actor_id uuid;
begin
  actor_id:=public.current_actor_profile_id();
  if actor_id is null then
    if exists(select 1 from public.profiles where id=auth.uid() and account_type='shared_workstation') then raise exception 'Choose your name and enter your operator PIN before continuing.'; end if;
    raise exception 'Authorized staff session required.';
  end if;
  return actor_id;
end;$function$;

create or replace function public.current_location_id()
returns uuid language sql stable security definer set search_path to 'public' as $function$
  select p.location_id from public.profiles p where p.id=auth.uid() and p.active=true and public.portal_session_authorized()
$function$;
create or replace function public.current_staff_role()
returns public.staff_role language sql stable security definer set search_path to 'public' as $function$
  select p.role from public.profiles p where p.id=auth.uid() and p.active=true and public.portal_session_authorized()
$function$;
create or replace function public.current_account_type()
returns text language sql stable security definer set search_path to 'public' as $function$
  select p.account_type from public.profiles p where p.id=auth.uid() and p.active=true and public.portal_session_authorized()
$function$;
create or replace function public.portal_human_session()
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select public.portal_session_authorized() and coalesce((select account_type from public.profiles where id=auth.uid() and active=true),'')='staff'
$function$;

create or replace function public.has_permission(permission_key text)
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select coalesce((select case
    when p.account_type='shared_workstation' then public.portal_session_authorized() and (
      $1=any(array['dashboard.view','repairs.view','ready_pickup.view','leads.view','appointments.view','customers.view','inventory.view','reference.view','labels.work_order'])
      or (public.current_actor_profile_id() is not null and $1=any(array['repairs.intake','ready_pickup.checkout','leads.manage','appointments.manage','customers.edit'])))
    when not public.portal_session_authorized() then false
    when p.role='owner' then true
    when p.role in ('technician','front_desk') and $1=any(array['reports.view','staff.manage','settings.manage','pricing.override','schedule.manage']) then false
    when o.enabled is not null then o.enabled else public.role_default_permission(p.role,$1) end
    from public.profiles p left join public.staff_permission_overrides o on o.profile_id=p.id and o.permission_key=$1 where p.id=auth.uid() and p.active=true),false)
$function$;

create or replace function public.complete_workstation_enrollment(enrollment_token text,device_id text,device_label text default 'Front Desk Workstation')
returns jsonb language plpgsql security definer set search_path to 'public','extensions' as $function$
declare p public.profiles; grant_row public.workstation_enrollment_grants; sid uuid; digest_text text; device_digest text; trusted_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  select * into p from public.profiles where id=auth.uid() and active=true for update;
  if p.id is null or coalesce(p.account_type,'staff')<>'shared_workstation' then raise exception 'Shared workstation session required.'; end if;
  sid:=nullif(auth.jwt()->>'session_id','')::uuid;
  if sid is null or length(coalesce(enrollment_token,''))<32 or length(coalesce(device_id,''))<16 then raise exception 'Enrollment proof is invalid.'; end if;
  digest_text:=encode(extensions.digest(enrollment_token,'sha256'),'hex'); device_digest:=encode(extensions.digest(device_id,'sha256'),'hex');
  select * into grant_row from public.workstation_enrollment_grants where token_hash=digest_text and workstation_profile_id=p.id and location_id=p.location_id
    and consumed_at is null and expires_at>now() and (device_id_hash is null or device_id_hash=device_digest) order by created_at desc limit 1 for update;
  if grant_row.id is null then raise exception 'This workstation enrollment has expired, was already used, or belongs to another browser.'; end if;
  update public.trusted_workstations set revoked_at=now(),revoke_reason='Re-enrolled from the same browser' where workstation_profile_id=p.id and device_id_hash=device_digest and revoked_at is null;
  insert into public.trusted_workstations(location_id,workstation_profile_id,auth_session_id,device_id_hash,device_label,enrolled_by)
  values(p.location_id,p.id,sid,device_digest,left(coalesce(nullif(btrim(device_label),''),'Front Desk Workstation'),120),grant_row.created_by) returning id into trusted_id;
  update public.workstation_enrollment_grants set consumed_at=now() where id=grant_row.id;
  return jsonb_build_object('ok',true,'trusted_workstation_id',trusted_id,'device_label',left(coalesce(nullif(btrim(device_label),''),'Front Desk Workstation'),120));
end;$function$;

create or replace function public.get_my_trusted_workstation_status()
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare p public.profiles; sid uuid; tw public.trusted_workstations;
begin
  if auth.uid() is null then return jsonb_build_object('trusted',false,'reason','not_authenticated'); end if;
  select * into p from public.profiles where id=auth.uid() and active=true;
  if p.id is null or coalesce(p.account_type,'staff')<>'shared_workstation' then return jsonb_build_object('trusted',false,'workstation',false); end if;
  sid:=nullif(auth.jwt()->>'session_id','')::uuid;
  select * into tw from public.trusted_workstations where workstation_profile_id=p.id and auth_session_id=sid and revoked_at is null limit 1;
  if tw.id is null then return jsonb_build_object('trusted',false,'workstation',true,'display_name',p.display_name); end if;
  update public.trusted_workstations set last_seen_at=now() where id=tw.id;
  return jsonb_build_object('trusted',true,'workstation',true,'id',tw.id,'device_label',tw.device_label,'enrolled_at',tw.enrolled_at,'last_seen_at',now(),'display_name',p.display_name);
end;$function$;

create or replace function public.list_trusted_workstations()
returns table(id uuid,workstation_profile_id uuid,workstation_name text,device_label text,enrolled_by uuid,enrolled_by_name text,enrolled_at timestamptz,last_seen_at timestamptz,revoked_at timestamptz,revoke_reason text)
language plpgsql security definer set search_path to 'public' as $function$
declare actor public.profiles;
begin
  select * into actor from public.profiles where id=auth.uid() and active=true;
  if actor.id is null or coalesce(actor.account_type,'staff')<>'staff' or actor.role::text not in ('owner','manager') or not coalesce(public.has_permission('staff.manage'),false) then raise exception 'Management permission required.'; end if;
  return query select tw.id,tw.workstation_profile_id,wp.display_name,tw.device_label,tw.enrolled_by,ep.display_name,tw.enrolled_at,tw.last_seen_at,tw.revoked_at,tw.revoke_reason
    from public.trusted_workstations tw join public.profiles wp on wp.id=tw.workstation_profile_id left join public.profiles ep on ep.id=tw.enrolled_by
    where tw.location_id=actor.location_id order by (tw.revoked_at is null) desc,tw.last_seen_at desc;
end;$function$;

create or replace function public.revoke_trusted_workstation(target_id uuid,reason text default 'Revoked by management')
returns boolean language plpgsql security definer set search_path to 'public' as $function$
declare actor public.profiles; target_profile uuid;
begin
  select * into actor from public.profiles where id=auth.uid() and active=true;
  if actor.id is null or coalesce(actor.account_type,'staff')<>'staff' or actor.role::text not in ('owner','manager') or not coalesce(public.has_permission('staff.manage'),false) then raise exception 'Management permission required.'; end if;
  update public.trusted_workstations set revoked_at=coalesce(revoked_at,now()),revoked_by=actor.id,revoke_reason=left(coalesce(nullif(btrim(reason),''),'Revoked by management'),240)
    where id=target_id and location_id=actor.location_id returning workstation_profile_id into target_profile;
  if target_profile is null then return false; end if;
  update public.workstation_operator_sessions set revoked_at=coalesce(revoked_at,now()) where workstation_profile_id=target_profile and revoked_at is null;
  return true;
end;$function$;

create or replace function public.get_my_onboarding_package()
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare p public.profiles; progress public.staff_onboarding_progress; pin_ready boolean:=false;
begin
  if auth.uid() is null or not public.portal_session_authorized() then raise exception 'Authorized staff session required.'; end if;
  select * into p from public.profiles where id=auth.uid() and active=true;
  if p.id is null or coalesce(p.account_type,'staff')<>'staff' then return jsonb_build_object('required',false,'eligible',false); end if;
  select * into progress from public.staff_onboarding_progress where profile_id=p.id;
  select exists(select 1 from public.staff_operator_pins s where s.profile_id=p.id and s.pin_hash is not null and not coalesce(s.reset_required,true)) into pin_ready;
  return jsonb_build_object('required',not coalesce(p.onboarding_complete,false),'eligible',true,
    'profile',jsonb_build_object('id',p.id,'display_name',p.display_name,'role',p.role,'job_title',p.job_title,'phone',p.phone,'bio',p.bio,'portal_email',p.portal_email,'discord_username',p.discord_username,'discord_linked',p.discord_user_id is not null),
    'progress',case when progress.profile_id is null then jsonb_build_object('status','not_started') else jsonb_build_object('status',progress.status,'welcome_payload',progress.welcome_payload,'started_at',progress.started_at,'welcome_ack_at',progress.welcome_ack_at,'profile_confirmed_at',progress.profile_confirmed_at,'security_ack_at',progress.security_ack_at,'workflow_ack_at',progress.workflow_ack_at,'completed_at',progress.completed_at) end,
    'pin_ready',pin_ready);
end;$function$;

create or replace function public.acknowledge_my_onboarding_step(step text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare p public.profiles; pin_ready boolean:=false; normalized text:=lower(trim(coalesce(step,''))); progress public.staff_onboarding_progress;
begin
  if auth.uid() is null or not public.portal_session_authorized() then raise exception 'Authorized staff session required.'; end if;
  select * into p from public.profiles where id=auth.uid() and active=true;
  if p.id is null or coalesce(p.account_type,'staff')<>'staff' then raise exception 'Human staff account required.'; end if;
  if normalized not in ('welcome','profile','security','workflow') then raise exception 'Unknown onboarding step.'; end if;
  insert into public.staff_onboarding_progress(profile_id,location_id,status) values(p.id,p.location_id,'in_progress') on conflict(profile_id) do nothing;
  if normalized='security' then select exists(select 1 from public.staff_operator_pins s where s.profile_id=p.id and s.pin_hash is not null and not coalesce(s.reset_required,true)) into pin_ready;
    if p.discord_user_id is null or not pin_ready then raise exception 'Link Discord and create your workstation PIN before finishing security setup.'; end if; end if;
  update public.staff_onboarding_progress set welcome_ack_at=case when normalized='welcome' then coalesce(welcome_ack_at,now()) else welcome_ack_at end,
    profile_confirmed_at=case when normalized='profile' then coalesce(profile_confirmed_at,now()) else profile_confirmed_at end,
    security_ack_at=case when normalized='security' then coalesce(security_ack_at,now()) else security_ack_at end,
    workflow_ack_at=case when normalized='workflow' then coalesce(workflow_ack_at,now()) else workflow_ack_at end,updated_at=now()
    where profile_id=p.id returning * into progress;
  return jsonb_build_object('ok',true,'step',normalized,'progress',to_jsonb(progress)-'profile_id'-'location_id');
end;$function$;

create or replace function public.complete_my_onboarding()
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare p public.profiles; progress public.staff_onboarding_progress; pin_ready boolean:=false;
begin
  if auth.uid() is null or not public.portal_session_authorized() then raise exception 'Authorized staff session required.'; end if;
  select * into p from public.profiles where id=auth.uid() and active=true for update;
  if p.id is null or coalesce(p.account_type,'staff')<>'staff' then raise exception 'Human staff account required.'; end if;
  if p.onboarding_complete then return jsonb_build_object('ok',true,'already_complete',true); end if;
  select * into progress from public.staff_onboarding_progress where profile_id=p.id for update;
  select exists(select 1 from public.staff_operator_pins s where s.profile_id=p.id and s.pin_hash is not null and not coalesce(s.reset_required,true)) into pin_ready;
  if progress.profile_id is null or progress.welcome_ack_at is null or progress.profile_confirmed_at is null or progress.security_ack_at is null or progress.workflow_ack_at is null or p.discord_user_id is null or not pin_ready then raise exception 'Finish every onboarding step before marking the account ready.'; end if;
  update public.staff_onboarding_progress set status='completed',completed_at=coalesce(completed_at,now()),updated_at=now() where profile_id=p.id;
  update public.profiles set onboarding_complete=true,onboarding_status='active',must_change_password=false,updated_at=now() where id=p.id;
  insert into public.staff_account_events(location_id,invitation_id,actor_user_id,target_user_id,event_type,details) values(p.location_id,progress.invitation_id,p.id,p.id,'onboarding_completed',jsonb_build_object('completed_at',now()));
  return jsonb_build_object('ok',true,'completed',true,'display_name',p.display_name);
end;$function$;

create or replace function public.get_staff_onboarding_overview()
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare actor public.profiles; employees jsonb; invites jsonb;
begin
  select * into actor from public.profiles where id=auth.uid() and active=true;
  if actor.id is null or not public.portal_human_session() or actor.role::text not in ('owner','manager') or not public.has_permission('staff.manage') then raise exception 'Management permission required.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('profile_id',p.id,'display_name',p.display_name,'role',p.role,'job_title',p.job_title,'portal_email',p.portal_email,'discord_username',p.discord_username,'discord_linked',p.discord_user_id is not null,'onboarding_complete',p.onboarding_complete,'onboarding_status',p.onboarding_status,'progress_status',coalesce(op.status,case when p.onboarding_complete then 'completed' else 'not_started' end),'welcome_ack_at',op.welcome_ack_at,'profile_confirmed_at',op.profile_confirmed_at,'security_ack_at',op.security_ack_at,'workflow_ack_at',op.workflow_ack_at,'completed_at',op.completed_at,'pin_ready',exists(select 1 from public.staff_operator_pins s where s.profile_id=p.id and s.pin_hash is not null and not coalesce(s.reset_required,true))) order by p.display_name),'[]'::jsonb) into employees
    from public.profiles p left join public.staff_onboarding_progress op on op.profile_id=p.id where p.location_id=actor.location_id and p.active=true and coalesce(p.account_type,'staff')='staff';
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'display_name',i.display_name,'role',i.role,'job_title',i.job_title,'discord_username',i.discord_username,'recovery_email',i.recovery_email,'portal_email',i.portal_email,'first_day',i.first_day,'created_at',i.created_at,'expires_at',i.expires_at,'used_at',i.used_at,'cancelled_at',i.cancelled_at,'status',case when i.cancelled_at is not null then 'cancelled' when i.used_at is not null then 'accepted' when i.expires_at<=now() then 'expired' else 'pending' end) order by i.created_at desc),'[]'::jsonb) into invites from public.staff_invitations i where i.location_id=actor.location_id;
  return jsonb_build_object('employees',employees,'invitations',invites);
end;$function$;

create or replace function public.cancel_staff_invitation(invitation_id uuid)
returns boolean language plpgsql security definer set search_path to 'public' as $function$
declare actor public.profiles;
begin
  select * into actor from public.profiles where id=auth.uid() and active=true;
  if actor.id is null or not public.portal_human_session() or actor.role::text not in ('owner','manager') or not public.has_permission('staff.manage') then raise exception 'Management permission required.'; end if;
  update public.staff_invitations set cancelled_at=coalesce(cancelled_at,now()) where id=invitation_id and location_id=actor.location_id and used_at is null;
  if found then insert into public.staff_account_events(location_id,invitation_id,actor_user_id,event_type,details) values(actor.location_id,invitation_id,actor.id,'invitation_cancelled','{}'::jsonb); end if;
  return found;
end;$function$;

revoke all on function public.portal_session_authorized() from public,anon;
revoke all on function public.current_actor_profile_id() from public,anon;
revoke all on function public.require_current_actor_profile_id() from public,anon;
revoke all on function public.current_account_type() from public,anon;
revoke all on function public.portal_human_session() from public,anon;
revoke all on function public.complete_workstation_enrollment(text,text,text) from public,anon;
revoke all on function public.get_my_trusted_workstation_status() from public,anon;
revoke all on function public.list_trusted_workstations() from public,anon;
revoke all on function public.revoke_trusted_workstation(uuid,text) from public,anon;
revoke all on function public.get_my_onboarding_package() from public,anon;
revoke all on function public.acknowledge_my_onboarding_step(text) from public,anon;
revoke all on function public.complete_my_onboarding() from public,anon;
revoke all on function public.get_staff_onboarding_overview() from public,anon;
revoke all on function public.cancel_staff_invitation(uuid) from public,anon;
grant execute on function public.portal_session_authorized() to authenticated;
grant execute on function public.current_actor_profile_id() to authenticated;
grant execute on function public.require_current_actor_profile_id() to authenticated;
grant execute on function public.current_account_type() to authenticated;
grant execute on function public.portal_human_session() to authenticated;
grant execute on function public.complete_workstation_enrollment(text,text,text) to authenticated;
grant execute on function public.get_my_trusted_workstation_status() to authenticated;
grant execute on function public.list_trusted_workstations() to authenticated;
grant execute on function public.revoke_trusted_workstation(uuid,text) to authenticated;
grant execute on function public.get_my_onboarding_package() to authenticated;
grant execute on function public.acknowledge_my_onboarding_step(text) to authenticated;
grant execute on function public.complete_my_onboarding() to authenticated;
grant execute on function public.get_staff_onboarding_overview() to authenticated;
grant execute on function public.cancel_staff_invitation(uuid) to authenticated;
