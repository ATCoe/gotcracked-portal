-- Align active human staff profiles with their real GotCracked Workspace address.
-- Shared workstation and automation identities remain intentionally separate.
update public.profiles p
set portal_email=lower(u.email),
    updated_at=now()
from auth.users u
where p.id=u.id
  and p.account_type='staff'
  and p.active=true
  and p.portal_email is null
  and lower(u.email) like '%@gotcracked.co'
  and not exists (
    select 1 from public.profiles other
    where other.id<>p.id
      and lower(coalesce(other.portal_email,''))=lower(u.email)
  );

create or replace function public.current_portal_human_verification_method()
returns text
language plpgsql
stable
security definer
set search_path=pg_catalog
as $function$
declare caller_id uuid:=auth.uid(); session_id uuid; method text;
begin
  if caller_id is null then return null; end if;
  begin session_id:=nullif(auth.jwt()->>'session_id','')::uuid;
  exception when invalid_text_representation then return null; end;
  if session_id is null then return null; end if;
  select hs.verification_method into method
  from public.portal_human_sessions hs
  join auth.sessions s on s.id=hs.auth_session_id
  where hs.auth_session_id=session_id
    and hs.profile_id=caller_id
    and s.user_id=caller_id
    and (s.not_after is null or s.not_after>now())
  limit 1;
  return method;
end;
$function$;

revoke all on function public.current_portal_human_verification_method()
  from public,anon,service_role;
grant execute on function public.current_portal_human_verification_method()
  to authenticated;
comment on function public.current_portal_human_verification_method() is
  'Returns the server-registered human verification method for the calling live Auth session.';
