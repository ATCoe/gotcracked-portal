-- Pre-registration session liveness only. This does not grant Portal access,
-- register a human/operator session, enroll a workstation, or change any user.
-- The Discord verifier still requires OAuth, guild membership, an active staff
-- profile and its existing identity-binding checks after calling this helper.
create function public.portal_auth_session_active()
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  session_id uuid;
begin
  if caller_id is null then return false; end if;
  begin
    session_id := nullif(auth.jwt()->>'session_id', '')::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  if session_id is null then return false; end if;
  return exists (
    select 1 from auth.sessions s
    where s.id = session_id
      and s.user_id = caller_id
      and (s.not_after is null or s.not_after > now())
  );
end;
$function$;

revoke all on function public.portal_auth_session_active() from public, anon, service_role;
grant execute on function public.portal_auth_session_active() to authenticated;
comment on function public.portal_auth_session_active() is
  'Checks only the calling user''s current Supabase session. Not Portal, staff, or operator authorization.';
