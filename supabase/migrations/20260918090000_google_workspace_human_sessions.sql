-- Allow approved Google Workspace identities to establish the same server-verified
-- human Portal session used by Discord, without bypassing profile/active checks.
alter table public.portal_human_sessions
  drop constraint if exists portal_human_sessions_verification_method_check;
alter table public.portal_human_sessions
  add constraint portal_human_sessions_verification_method_check
  check (verification_method in ('discord','google','owner_recovery'));

create or replace function public.register_google_human_session()
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  p public.profiles;
  sid uuid;
  has_google boolean:=false;
begin
  if auth.uid() is null then return false; end if;
  if not public.portal_auth_session_active() then return false; end if;
  select * into p from public.profiles where id=auth.uid() and active=true;
  if p.id is null or coalesce(p.account_type,'staff')<>'staff' then return false; end if;
  select exists(select 1 from auth.identities i where i.user_id=auth.uid() and i.provider='google') into has_google;
  if not has_google then return false; end if;
  sid:=nullif(auth.jwt()->>'session_id','')::uuid;
  if sid is null then return false; end if;
  insert into public.portal_human_sessions(auth_session_id,profile_id,location_id,verification_method,verified_at,last_seen_at)
  values(sid,p.id,p.location_id,'google',now(),now())
  on conflict(auth_session_id) do update set
    profile_id=excluded.profile_id,
    location_id=excluded.location_id,
    verification_method='google',
    verified_at=now(),
    last_seen_at=now();
  return true;
end;
$function$;

revoke all on function public.register_google_human_session() from public,anon;
grant execute on function public.register_google_human_session() to authenticated;

create or replace function public.portal_session_authorized()
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select public.portal_auth_session_active() and coalesce((
    select case
      when coalesce(p.account_type,'staff')='shared_workstation' then exists(select 1 from public.trusted_workstations tw where tw.workstation_profile_id=p.id and tw.location_id=p.location_id and tw.auth_session_id=nullif(auth.jwt()->>'session_id','')::uuid and tw.revoked_at is null)
      when coalesce(p.account_type,'staff')='automation' then p.role='automation'::public.staff_role and coalesce(auth.jwt()->'app_metadata'->>'portal_automation','false')='true'
      when coalesce(p.account_type,'staff')='staff' then exists(select 1 from public.portal_human_sessions hs where hs.profile_id=p.id and hs.location_id=p.location_id and hs.auth_session_id=nullif(auth.jwt()->>'session_id','')::uuid and (hs.verification_method in ('discord','google') or (hs.verification_method='owner_recovery' and p.role::text='owner')))
      else false end
    from public.profiles p where p.id=auth.uid() and p.active=true
  ),false)
$function$;
revoke all on function public.portal_session_authorized() from public,anon;
grant execute on function public.portal_session_authorized() to authenticated,service_role;
