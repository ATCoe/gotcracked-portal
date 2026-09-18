-- A linked Google identity alone must not elevate a password session.
create or replace function public.register_google_human_session()
returns boolean language plpgsql security definer set search_path=pg_catalog
as $function$
declare p public.profiles; sid uuid;
begin
 if auth.uid() is null then return false; end if;
 begin sid:=nullif(auth.jwt()->>'session_id','')::uuid;
 exception when invalid_text_representation then return false; end;
 if sid is null or not exists(
   select 1 from auth.sessions s join auth.mfa_amr_claims a on a.session_id=s.id
   where s.id=sid and s.user_id=auth.uid()
     and (s.not_after is null or s.not_after>now()) and a.authentication_method='oauth'
 ) then return false; end if;
 select * into p from public.profiles where id=auth.uid() and active=true;
 if p.id is null or coalesce(p.account_type,'staff') not in ('staff','shared_workstation') then return false; end if;
 if not exists(select 1 from auth.identities i where i.user_id=p.id and i.provider='google'
   and i.identity_data->>'email_verified'='true'
   and lower(split_part(i.identity_data->>'email','@',2))='gotcracked.co') then return false; end if;
 insert into public.portal_human_sessions(auth_session_id,profile_id,location_id,verification_method,verified_at,last_seen_at)
 values(sid,p.id,p.location_id,'google',now(),now())
 on conflict(auth_session_id) do update set profile_id=excluded.profile_id,location_id=excluded.location_id,
 verification_method='google',verified_at=now(),last_seen_at=now();
 return true;
end;
$function$;
revoke all on function public.register_google_human_session() from public,anon;
grant execute on function public.register_google_human_session() to authenticated;
