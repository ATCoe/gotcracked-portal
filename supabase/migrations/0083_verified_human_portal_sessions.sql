-- Human profiles are not considered authenticated for Portal data merely because a profile exists.
-- Normal access must be verified by Discord for the current Supabase session. Password auth is
-- retained only as a break-glass owner recovery path and is registered explicitly by the owner.

create table if not exists public.portal_human_sessions (
  auth_session_id uuid primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  verification_method text not null check (verification_method in ('discord','owner_recovery')),
  verified_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists portal_human_sessions_profile_idx on public.portal_human_sessions(profile_id,last_seen_at desc);
alter table public.portal_human_sessions enable row level security;
revoke all on public.portal_human_sessions from anon,authenticated;
comment on table public.portal_human_sessions is 'Server-verified human Portal sessions. Discord is normal auth; password sessions are owner-only break-glass recovery.';

create or replace function public.register_owner_recovery_session()
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  p public.profiles;
  sid uuid;
  methods jsonb;
  has_password boolean:=false;
begin
  if auth.uid() is null then return false; end if;
  select * into p from public.profiles where id=auth.uid() and active=true;
  if p.id is null or coalesce(p.account_type,'staff')<>'staff' or p.role::text<>'owner' then return false; end if;
  sid:=nullif(auth.jwt()->>'session_id','')::uuid;
  if sid is null then return false; end if;
  methods:=coalesce(auth.jwt()->'amr','[]'::jsonb);
  select exists(select 1 from jsonb_array_elements(methods) e where e->>'method'='password') into has_password;
  if not has_password then return false; end if;
  insert into public.portal_human_sessions(auth_session_id,profile_id,location_id,verification_method,verified_at,last_seen_at)
  values(sid,p.id,p.location_id,'owner_recovery',now(),now())
  on conflict(auth_session_id) do update set
    profile_id=excluded.profile_id,
    location_id=excluded.location_id,
    verification_method='owner_recovery',
    verified_at=now(),
    last_seen_at=now();
  return true;
end;
$function$;

create or replace function public.touch_portal_human_session()
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare sid uuid;
begin
  if auth.uid() is null then return false; end if;
  sid:=nullif(auth.jwt()->>'session_id','')::uuid;
  if sid is null then return false; end if;
  update public.portal_human_sessions set last_seen_at=now()
  where auth_session_id=sid and profile_id=auth.uid();
  return found;
end;
$function$;

create or replace function public.portal_session_authorized()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((
    select case
      when coalesce(p.account_type,'staff')='shared_workstation' then
        exists(
          select 1 from public.trusted_workstations tw
          where tw.workstation_profile_id=p.id
            and tw.location_id=p.location_id
            and tw.auth_session_id=nullif(auth.jwt()->>'session_id','')::uuid
            and tw.revoked_at is null
        )
      when coalesce(p.account_type,'staff')='staff' then
        exists(
          select 1 from public.portal_human_sessions hs
          where hs.profile_id=p.id
            and hs.location_id=p.location_id
            and hs.auth_session_id=nullif(auth.jwt()->>'session_id','')::uuid
            and (hs.verification_method='discord' or (hs.verification_method='owner_recovery' and p.role::text='owner'))
        )
      else false
    end
    from public.profiles p
    where p.id=auth.uid() and p.active=true
  ),false)
$function$;

revoke all on function public.register_owner_recovery_session() from public,anon;
revoke all on function public.touch_portal_human_session() from public,anon;
grant execute on function public.register_owner_recovery_session() to authenticated;
grant execute on function public.touch_portal_human_session() to authenticated;
