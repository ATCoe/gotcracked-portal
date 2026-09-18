-- Bind Portal human-session labels to the OAuth provider that actually
-- created the Supabase Auth session. GoTrue writes the login audit row and
-- auth.sessions row in the same auth transaction; require one unambiguous
-- provider audit event within 250ms of session creation or fail closed.

create or replace function public.auth_session_oauth_provider(
  target_session_id uuid,
  target_user_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path=pg_catalog
as $function$
declare
  session_created timestamptz;
  provider_count integer;
  resolved_provider text;
begin
  if target_session_id is null or target_user_id is null then return null; end if;

  select s.created_at
    into session_created
  from auth.sessions s
  where s.id=target_session_id
    and s.user_id=target_user_id
    and (s.not_after is null or s.not_after>now());

  if session_created is null then return null; end if;

  select count(*), min(l.payload->'traits'->>'provider')
    into provider_count, resolved_provider
  from auth.audit_log_entries l
  where l.payload->>'action'='login'
    and l.payload->>'actor_id'=target_user_id::text
    and l.payload->'traits'->>'provider' in ('google','discord')
    and abs(extract(epoch from (l.created_at-session_created)))<=0.25;

  if provider_count<>1 then return null; end if;
  return resolved_provider;
end;
$function$;

revoke all on function public.auth_session_oauth_provider(uuid,uuid)
  from public,anon,authenticated,service_role;

create or replace function public.enforce_portal_human_session_provider()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $function$
declare
  actual_provider text;
  profile_row public.profiles;
begin
  if new.verification_method not in ('google','discord') then
    return new;
  end if;

  actual_provider:=public.auth_session_oauth_provider(new.auth_session_id,new.profile_id);
  if actual_provider is null or actual_provider<>new.verification_method then
    raise exception 'Portal human-session provider does not match the Auth login provider.';
  end if;

  select * into profile_row
  from public.profiles
  where id=new.profile_id and active=true;

  if profile_row.id is null or coalesce(profile_row.account_type,'staff')<>'staff' then
    raise exception 'Only active human staff profiles can register OAuth human sessions.';
  end if;

  if actual_provider='google' then
    if not exists(
      select 1
      from auth.identities i
      where i.user_id=new.profile_id
        and i.provider='google'
        and i.identity_data->>'email_verified'='true'
        and lower(split_part(i.identity_data->>'email','@',2))='gotcracked.co'
        and (
          profile_row.portal_email is null
          or lower(profile_row.portal_email)=lower(i.identity_data->>'email')
        )
    ) then
      raise exception 'The Google Workspace identity does not match this staff profile.';
    end if;
  elsif not exists(
    select 1 from auth.identities i
    where i.user_id=new.profile_id and i.provider='discord'
  ) then
    raise exception 'A linked Discord identity is required for Discord verification.';
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_portal_human_session_provider()
  from public,anon,authenticated,service_role;

drop trigger if exists portal_human_sessions_provider_guard
  on public.portal_human_sessions;
create trigger portal_human_sessions_provider_guard
before insert or update of auth_session_id,profile_id,verification_method
on public.portal_human_sessions
for each row execute function public.enforce_portal_human_session_provider();

create or replace function public.register_workspace_human_session(invite_token text default null)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $function$
declare
  caller_id uuid:=auth.uid();
  session_id uuid;
  workspace_email text;
  profile_row public.profiles;
  invite_row public.staff_invitations;
  token_digest text;
  invitation_accepted boolean:=false;
begin
  if caller_id is null then
    return jsonb_build_object('authorized',false,'error','Sign in with Google Workspace to continue.');
  end if;

  begin
    session_id:=nullif(auth.jwt()->>'session_id','')::uuid;
  exception when invalid_text_representation then
    return jsonb_build_object('authorized',false,'error','This Portal session cannot be verified.');
  end;

  if session_id is null
     or public.auth_session_oauth_provider(session_id,caller_id)<>'google' then
    return jsonb_build_object('authorized',false,'error','This session was not created by Google Workspace.');
  end if;

  select lower(i.identity_data->>'email')
    into workspace_email
  from auth.identities i
  where i.user_id=caller_id
    and i.provider='google'
    and i.identity_data->>'email_verified'='true'
    and lower(split_part(i.identity_data->>'email','@',2))='gotcracked.co'
  order by i.last_sign_in_at desc nulls last
  limit 1;

  if workspace_email is null then
    return jsonb_build_object('authorized',false,'error','A verified @gotcracked.co Google Workspace identity is required.');
  end if;

  select * into profile_row
  from public.profiles
  where id=caller_id
  for update;

  if profile_row.id is null then
    if coalesce(btrim(invite_token),'')='' then
      return jsonb_build_object('authorized',false,'error','This Workspace account does not have an active Portal staff profile.');
    end if;

    token_digest:=encode(extensions.digest(invite_token,'sha256'),'hex');

    select * into invite_row
    from public.staff_invitations
    where token_hash=token_digest
      and used_at is null
      and cancelled_at is null
      and expires_at>now()
    for update;

    if invite_row.id is null
       or lower(coalesce(invite_row.portal_email,''))<>workspace_email then
      return jsonb_build_object('authorized',false,'error','This onboarding package is invalid, expired, or belongs to another Workspace account.');
    end if;

    if exists(
      select 1 from public.profiles p
      where p.id<>caller_id
        and lower(coalesce(p.portal_email,''))=workspace_email
    ) then
      return jsonb_build_object('authorized',false,'error','This Workspace address is already assigned to another Portal profile.');
    end if;

    update public.staff_invitations
    set used_at=now(),used_by=caller_id
    where id=invite_row.id
      and used_at is null
      and cancelled_at is null
      and expires_at>now();

    if not found then
      return jsonb_build_object('authorized',false,'error','This onboarding package was already used.');
    end if;

    insert into public.profiles(
      id,location_id,display_name,role,active,account_type,recovery_email,
      portal_email,job_title,discord_username,must_change_password,
      onboarding_complete,onboarding_status,discord_invite_expires_at,
      last_portal_login_at,updated_at
    )
    values(
      caller_id,invite_row.location_id,
      coalesce(nullif(invite_row.display_name,''),split_part(workspace_email,'@',1)),
      invite_row.role,true,'staff',invite_row.recovery_email,
      workspace_email,invite_row.job_title,invite_row.discord_username,false,
      false,'onboarding',invite_row.expires_at,now(),now()
    )
    returning * into profile_row;

    insert into public.staff_onboarding_progress(
      profile_id,location_id,invitation_id,status,welcome_payload
    )
    values(
      caller_id,invite_row.location_id,invite_row.id,'in_progress',
      coalesce(invite_row.welcome_payload,'{}'::jsonb)
    )
    on conflict(profile_id) do update
    set location_id=excluded.location_id,
        invitation_id=excluded.invitation_id,
        status='in_progress',
        welcome_payload=excluded.welcome_payload,
        updated_at=now();

    insert into public.staff_account_events(
      location_id,invitation_id,actor_user_id,target_user_id,event_type,details
    )
    values(
      invite_row.location_id,invite_row.id,caller_id,caller_id,
      'workspace_invitation_accepted',
      jsonb_build_object('workspace_email',workspace_email)
    );
    invitation_accepted:=true;
  end if;

  if not coalesce(profile_row.active,false)
     or coalesce(profile_row.account_type,'staff')<>'staff' then
    return jsonb_build_object('authorized',false,'error','Your GotCracked staff account is not active.');
  end if;

  if profile_row.portal_email is not null
     and lower(profile_row.portal_email)<>workspace_email then
    return jsonb_build_object('authorized',false,'error','This Portal profile is assigned to a different Workspace address.');
  end if;

  update public.profiles
  set portal_email=workspace_email,
      last_portal_login_at=now(),
      updated_at=now()
  where id=caller_id
  returning * into profile_row;

  insert into public.portal_human_sessions(
    auth_session_id,profile_id,location_id,verification_method,verified_at,last_seen_at
  )
  values(session_id,caller_id,profile_row.location_id,'google',now(),now())
  on conflict(auth_session_id) do update
  set profile_id=excluded.profile_id,
      location_id=excluded.location_id,
      verification_method='google',
      verified_at=now(),
      last_seen_at=now();

  return jsonb_build_object(
    'authorized',true,
    'role',profile_row.role,
    'workspaceEmail',workspace_email,
    'onboardingRequired',not coalesce(profile_row.onboarding_complete,false),
    'invitationAccepted',invitation_accepted,
    'sessionVerified',true
  );
end;
$function$;

revoke all on function public.register_workspace_human_session(text)
  from public,anon,service_role;
grant execute on function public.register_workspace_human_session(text)
  to authenticated;

create or replace function public.sync_discord_fallback_identity()
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $function$
declare
  caller_id uuid:=auth.uid();
  profile_row public.profiles;
  discord_id text;
  linked_discord_username text;
  discord_avatar text;
begin
  if caller_id is null or not public.portal_session_authorized() then
    return jsonb_build_object('authorized',false,'error','A verified Portal staff session is required.');
  end if;

  select * into profile_row
  from public.profiles
  where id=caller_id and active=true
  for update;

  if profile_row.id is null or coalesce(profile_row.account_type,'staff')<>'staff' then
    return jsonb_build_object('authorized',false,'error','A human staff profile is required.');
  end if;

  select
    coalesce(
      nullif(i.identity_data->>'provider_id',''),
      nullif(i.identity_data->>'sub',''),
      i.provider_id
    ),
    lower(coalesce(
      nullif(i.identity_data->>'user_name',''),
      nullif(i.identity_data->>'preferred_username',''),
      nullif(i.identity_data->>'name','')
    )),
    nullif(i.identity_data->>'avatar_url','')
  into discord_id,linked_discord_username,discord_avatar
  from auth.identities i
  where i.user_id=caller_id and i.provider='discord'
  order by i.last_sign_in_at desc nulls last
  limit 1;

  if coalesce(discord_id,'')='' then
    return jsonb_build_object('authorized',false,'error','No linked Discord identity was found.');
  end if;

  if profile_row.discord_user_id is not null
     and profile_row.discord_user_id<>discord_id then
    return jsonb_build_object('authorized',false,'error','This Portal profile is already linked to a different Discord identity.');
  end if;

  if profile_row.discord_user_id is null
     and profile_row.discord_username is not null
     and lower(profile_row.discord_username)<>linked_discord_username then
    return jsonb_build_object(
      'authorized',false,
      'error',format('This Portal profile expects Discord @%s.',profile_row.discord_username)
    );
  end if;

  update public.profiles
  set discord_user_id=discord_id,
      discord_username=coalesce(nullif(linked_discord_username,''),profile_row.discord_username),
      discord_avatar_url=coalesce(discord_avatar,discord_avatar_url),
      discord_verified_at=coalesce(discord_verified_at,now()),
      updated_at=now()
  where id=caller_id;

  insert into public.staff_account_events(
    location_id,actor_user_id,target_user_id,event_type,details
  )
  values(
    profile_row.location_id,caller_id,caller_id,'discord_fallback_linked',
    jsonb_build_object('discord_user_id',discord_id,'discord_username',linked_discord_username)
  );

  return jsonb_build_object(
    'authorized',true,
    'fallbackLinked',true,
    'discordUserId',discord_id,
    'discordUsername',linked_discord_username
  );
end;
$function$;

revoke all on function public.sync_discord_fallback_identity()
  from public,anon,service_role;
grant execute on function public.sync_discord_fallback_identity()
  to authenticated;

-- Repair historical labels only where the Auth audit/session pair resolves
-- unambiguously to the actual provider.
update public.portal_human_sessions hs
set verification_method=public.auth_session_oauth_provider(hs.auth_session_id,hs.profile_id),
    last_seen_at=greatest(hs.last_seen_at,now())
where public.auth_session_oauth_provider(hs.auth_session_id,hs.profile_id) in ('google','discord')
  and hs.verification_method is distinct from
      public.auth_session_oauth_provider(hs.auth_session_id,hs.profile_id);
