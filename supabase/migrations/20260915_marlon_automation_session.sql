alter table public.profiles drop constraint if exists profiles_account_type_check;
alter table public.profiles add constraint profiles_account_type_check check (account_type = any (array['staff','shared_workstation','automation']));

create or replace function public.portal_session_authorized()
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select coalesce((
    select case
      when coalesce(p.account_type,'staff')='shared_workstation' then exists(select 1 from public.trusted_workstations tw where tw.workstation_profile_id=p.id and tw.location_id=p.location_id and tw.auth_session_id=nullif(auth.jwt()->>'session_id','')::uuid and tw.revoked_at is null)
      when coalesce(p.account_type,'staff')='automation' then p.role='automation'::public.staff_role and coalesce(auth.jwt()->'app_metadata'->>'portal_automation','false')='true'
      when coalesce(p.account_type,'staff')='staff' then exists(select 1 from public.portal_human_sessions hs where hs.profile_id=p.id and hs.location_id=p.location_id and hs.auth_session_id=nullif(auth.jwt()->>'session_id','')::uuid and (hs.verification_method='discord' or (hs.verification_method='owner_recovery' and p.role::text='owner')))
      else false end
    from public.profiles p where p.id=auth.uid() and p.active=true
  ),false)
$function$;
