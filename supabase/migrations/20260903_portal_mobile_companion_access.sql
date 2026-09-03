-- Private Portal Companion access gate.
-- The client calls this only from the installed app. It verifies the current
-- auth session, the active staff profile, and the Portal's verified-human
-- session record in one server-side decision.
create or replace function public.portal_mobile_access_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_session_id uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('allowed', false, 'reason', 'unauthenticated');
  end if;

  begin
    current_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_session');
  end;

  if current_session_id is null then
    return jsonb_build_object('allowed', false, 'reason', 'missing_session');
  end if;

  if exists (
    select 1
    from public.profiles profile
    join auth.sessions auth_session
      on auth_session.id = current_session_id
     and auth_session.user_id = profile.id
    join public.portal_human_sessions human_session
      on human_session.auth_session_id = current_session_id
     and human_session.profile_id = profile.id
     and human_session.location_id = profile.location_id
    where profile.id = auth.uid()
      and profile.active = true
      and coalesce(profile.account_type, 'staff') = 'staff'
      and (
        human_session.verification_method = 'discord'
        or (human_session.verification_method = 'owner_recovery' and profile.role::text = 'owner')
      )
      and (auth_session.not_after is null or auth_session.not_after > now())
  ) then
    return jsonb_build_object('allowed', true);
  end if;

  return jsonb_build_object('allowed', false, 'reason', 'access_revoked');
end;
$$;

revoke all on function public.portal_mobile_access_status() from public, anon;
grant execute on function public.portal_mobile_access_status() to authenticated;

