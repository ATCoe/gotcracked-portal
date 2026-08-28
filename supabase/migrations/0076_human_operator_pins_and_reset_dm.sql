create table if not exists public.staff_operator_pins (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  pin_hash text,
  reset_required boolean not null default true,
  set_at timestamptz,
  reset_requested_at timestamptz,
  last_verified_at timestamptz,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.workstation_operator_sessions (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  workstation_profile_id uuid not null references public.profiles(id) on delete cascade,
  operator_profile_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique,
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists workstation_operator_sessions_workstation_idx
  on public.workstation_operator_sessions(workstation_profile_id,expires_at desc)
  where revoked_at is null;
create index if not exists workstation_operator_sessions_operator_idx
  on public.workstation_operator_sessions(operator_profile_id,expires_at desc)
  where revoked_at is null;

alter table public.staff_operator_pins enable row level security;
alter table public.workstation_operator_sessions enable row level security;
revoke all on public.staff_operator_pins from anon,authenticated;
revoke all on public.workstation_operator_sessions from anon,authenticated;

comment on table public.staff_operator_pins is
  'Hashed human operator PINs used only to attribute activity on authenticated shared workstations.';
comment on table public.workstation_operator_sessions is
  'Short-lived verified human operator context for an already-authenticated shared workstation.';

create or replace function public.get_my_operator_pin_status()
returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions'
as $function$
declare
  p public.profiles;
  s public.staff_operator_pins;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into p from public.profiles where id=auth.uid() and active=true;
  if p.id is null then raise exception 'Active staff profile required'; end if;
  if coalesce(p.account_type,'staff') <> 'staff' then
    return jsonb_build_object('eligible',false,'configured',false,'reset_required',false);
  end if;
  select * into s from public.staff_operator_pins where profile_id=p.id;
  return jsonb_build_object(
    'eligible',true,
    'configured',s.pin_hash is not null and not coalesce(s.reset_required,true),
    'reset_required',coalesce(s.reset_required,true),
    'set_at',s.set_at,
    'reset_requested_at',s.reset_requested_at,
    'locked_until',s.locked_until
  );
end;
$function$;

create or replace function public.set_my_operator_pin(pin text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions'
as $function$
declare
  p public.profiles;
  v_pin text:=trim(coalesce(pin,''));
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if v_pin !~ '^[0-9]{4,6}$' then raise exception 'PIN must contain 4 to 6 digits.'; end if;
  select * into p from public.profiles where id=auth.uid() and active=true;
  if p.id is null or coalesce(p.account_type,'staff') <> 'staff' then
    raise exception 'A human staff account is required.';
  end if;

  insert into public.staff_operator_pins(profile_id,location_id,pin_hash,reset_required,set_at,failed_attempts,locked_until,updated_at)
  values(p.id,p.location_id,extensions.crypt(v_pin,extensions.gen_salt('bf',10)),false,now(),0,null,now())
  on conflict(profile_id) do update set
    location_id=excluded.location_id,
    pin_hash=excluded.pin_hash,
    reset_required=false,
    set_at=now(),
    failed_attempts=0,
    locked_until=null,
    updated_at=now();

  update public.workstation_operator_sessions
  set revoked_at=coalesce(revoked_at,now())
  where operator_profile_id=p.id and revoked_at is null;

  return jsonb_build_object('ok',true,'configured',true,'reset_required',false,'set_at',now());
end;
$function$;

create or replace function public.get_workstation_operator_roster()
returns table(
  profile_id uuid,
  display_name text,
  job_title text,
  role text,
  avatar_url text,
  pin_configured boolean,
  reset_required boolean,
  discord_linked boolean
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  actor public.profiles;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into actor from public.profiles where id=auth.uid() and active=true;
  if actor.id is null then raise exception 'Active Portal profile required'; end if;
  if coalesce(actor.account_type,'staff') <> 'shared_workstation'
     and actor.role::text not in ('owner','manager') then
    raise exception 'Operator roster access denied.';
  end if;

  return query
  select p.id,p.display_name,p.job_title,p.role::text,p.avatar_url,
         (s.pin_hash is not null and not coalesce(s.reset_required,true)) as pin_configured,
         coalesce(s.reset_required,true) as reset_required,
         (p.discord_user_id is not null) as discord_linked
  from public.profiles p
  left join public.staff_operator_pins s on s.profile_id=p.id
  where p.location_id=actor.location_id
    and p.active=true
    and coalesce(p.account_type,'staff')='staff'
  order by p.display_name;
end;
$function$;

create or replace function public.verify_workstation_operator_pin(target_profile uuid,pin text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions'
as $function$
declare
  actor public.profiles;
  target public.profiles;
  s public.staff_operator_pins;
  v_pin text:=trim(coalesce(pin,''));
  attempts integer;
  token text;
  token_digest text;
  session_expiry timestamptz:=now()+interval '4 hours';
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if v_pin !~ '^[0-9]{4,6}$' then return jsonb_build_object('ok',false,'reason','invalid_format'); end if;
  select * into actor from public.profiles where id=auth.uid() and active=true;
  if actor.id is null or coalesce(actor.account_type,'staff') <> 'shared_workstation' then
    raise exception 'Shared workstation authentication required.';
  end if;
  select * into target from public.profiles
  where id=target_profile and location_id=actor.location_id and active=true
    and coalesce(account_type,'staff')='staff';
  if target.id is null then return jsonb_build_object('ok',false,'reason','operator_unavailable'); end if;

  select * into s from public.staff_operator_pins where profile_id=target.id for update;
  if s.profile_id is null or s.pin_hash is null or coalesce(s.reset_required,true) then
    return jsonb_build_object('ok',false,'reason','pin_setup_required');
  end if;
  if s.locked_until is not null and s.locked_until>now() then
    return jsonb_build_object('ok',false,'reason','locked','locked_until',s.locked_until);
  end if;

  if s.pin_hash <> extensions.crypt(v_pin,s.pin_hash) then
    attempts:=coalesce(s.failed_attempts,0)+1;
    update public.staff_operator_pins set
      failed_attempts=case when attempts>=5 then 0 else attempts end,
      locked_until=case when attempts>=5 then now()+interval '5 minutes' else null end,
      updated_at=now()
    where profile_id=target.id;
    return jsonb_build_object(
      'ok',false,
      'reason',case when attempts>=5 then 'locked' else 'incorrect_pin' end,
      'attempts_remaining',greatest(5-attempts,0),
      'locked_until',case when attempts>=5 then now()+interval '5 minutes' else null end
    );
  end if;

  update public.staff_operator_pins set failed_attempts=0,locked_until=null,last_verified_at=now(),updated_at=now()
  where profile_id=target.id;
  update public.workstation_operator_sessions set revoked_at=now()
  where workstation_profile_id=actor.id and revoked_at is null;

  token:=encode(extensions.gen_random_bytes(32),'hex');
  token_digest:=encode(extensions.digest(token,'sha256'),'hex');
  insert into public.workstation_operator_sessions(location_id,workstation_profile_id,operator_profile_id,token_hash,expires_at)
  values(actor.location_id,actor.id,target.id,token_digest,session_expiry);

  return jsonb_build_object(
    'ok',true,'session_token',token,'expires_at',session_expiry,
    'operator',jsonb_build_object('id',target.id,'display_name',target.display_name,'job_title',target.job_title,'role',target.role,'avatar_url',target.avatar_url)
  );
end;
$function$;

create or replace function public.validate_workstation_operator_session(session_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions'
as $function$
declare
  actor public.profiles;
  ws public.workstation_operator_sessions;
  op public.profiles;
  token_digest text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into actor from public.profiles where id=auth.uid() and active=true;
  if actor.id is null or coalesce(actor.account_type,'staff') <> 'shared_workstation' then
    raise exception 'Shared workstation authentication required.';
  end if;
  if coalesce(session_token,'')='' then return jsonb_build_object('ok',false); end if;
  token_digest:=encode(extensions.digest(session_token,'sha256'),'hex');
  select * into ws from public.workstation_operator_sessions
  where workstation_profile_id=actor.id and token_hash=token_digest
    and revoked_at is null and expires_at>now()
  order by created_at desc limit 1;
  if ws.id is null then return jsonb_build_object('ok',false); end if;
  select * into op from public.profiles where id=ws.operator_profile_id and active=true and coalesce(account_type,'staff')='staff';
  if op.id is null then
    update public.workstation_operator_sessions set revoked_at=now() where id=ws.id;
    return jsonb_build_object('ok',false);
  end if;
  update public.workstation_operator_sessions set last_seen_at=now() where id=ws.id;
  return jsonb_build_object('ok',true,'expires_at',ws.expires_at,
    'operator',jsonb_build_object('id',op.id,'display_name',op.display_name,'job_title',op.job_title,'role',op.role,'avatar_url',op.avatar_url));
end;
$function$;

create or replace function public.end_workstation_operator_session(session_token text)
returns boolean
language plpgsql
security definer
set search_path to 'public','extensions'
as $function$
declare
  actor public.profiles;
  token_digest text;
begin
  if auth.uid() is null then return false; end if;
  select * into actor from public.profiles where id=auth.uid() and active=true;
  if actor.id is null or coalesce(actor.account_type,'staff') <> 'shared_workstation' then return false; end if;
  token_digest:=encode(extensions.digest(coalesce(session_token,''),'sha256'),'hex');
  update public.workstation_operator_sessions set revoked_at=now()
  where workstation_profile_id=actor.id and token_hash=token_digest and revoked_at is null;
  return found;
end;
$function$;

create or replace function public.request_operator_pin_reset(target_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  actor public.profiles;
  target public.profiles;
  s public.staff_operator_pins;
  queue_dm boolean:=false;
  event_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into actor from public.profiles where id=auth.uid() and active=true;
  if actor.id is null then raise exception 'Active Portal profile required'; end if;
  select * into target from public.profiles where id=target_profile and active=true;
  if target.id is null or target.location_id<>actor.location_id or coalesce(target.account_type,'staff')<>'staff' then
    raise exception 'Human staff member not found for this location.';
  end if;
  if actor.id<>target.id
     and coalesce(actor.account_type,'staff')<>'shared_workstation'
     and actor.role::text not in ('owner','manager') then
    raise exception 'PIN reset permission denied.';
  end if;

  select * into s from public.staff_operator_pins where profile_id=target.id for update;
  queue_dm:=target.discord_user_id is not null
    and (s.reset_requested_at is null or s.reset_requested_at<now()-interval '5 minutes');

  insert into public.staff_operator_pins(profile_id,location_id,pin_hash,reset_required,reset_requested_at,failed_attempts,locked_until,updated_at)
  values(target.id,target.location_id,null,true,case when queue_dm then now() else null end,0,null,now())
  on conflict(profile_id) do update set
    location_id=excluded.location_id,
    pin_hash=null,
    reset_required=true,
    reset_requested_at=case when queue_dm then now() else public.staff_operator_pins.reset_requested_at end,
    failed_attempts=0,
    locked_until=null,
    updated_at=now();

  update public.workstation_operator_sessions set revoked_at=now()
  where operator_profile_id=target.id and revoked_at is null;

  if queue_dm then
    insert into public.discord_notification_outbox(location_id,event_key,event_type,entity_type,entity_id,payload)
    values(
      target.location_id,
      'operator-pin-reset:'||target.id::text||':'||floor(extract(epoch from clock_timestamp())*1000)::bigint::text,
      'operator_pin_reset_requested','operator_pin_reset',target.id,
      jsonb_build_object(
        'target_profile_id',target.id,
        'target_display_name',target.display_name,
        'target_discord_user_id',target.discord_user_id,
        'requested_by_profile_id',actor.id,
        'requested_by_name',actor.display_name,
        'portal_url','https://portal.gotcracked.co/#profile'
      )
    ) returning id into event_id;
  end if;

  return jsonb_build_object(
    'ok',true,'reset_required',true,'dm_queued',queue_dm,'outbox_id',event_id,
    'discord_linked',target.discord_user_id is not null,
    'message',case when target.discord_user_id is null then 'PIN reset. Discord is not linked, so Marlon could not send a DM.'
                   when queue_dm then 'PIN reset. Marlon is sending the employee a Discord DM.'
                   else 'PIN reset. A recent reset DM was already sent.' end
  );
end;
$function$;

do $constraint$
begin
  if exists(select 1 from pg_constraint where conrelid='public.discord_notification_outbox'::regclass and conname='discord_notification_outbox_entity_type_check') then
    alter table public.discord_notification_outbox drop constraint discord_notification_outbox_entity_type_check;
  end if;
  alter table public.discord_notification_outbox add constraint discord_notification_outbox_entity_type_check
    check (entity_type=any(array['lead','work_order','purchase_order','support_ticket','pc_build_request','portal_release','operator_pin_reset']::text[]));
end $constraint$;

create or replace function public.dispatch_discord_outbox()
returns trigger
language plpgsql
security definer
set search_path to 'public','extensions'
as $function$
declare
  signing_secret text;
  ts bigint;
  signature text;
begin
  if new.entity_type not in ('work_order','support_ticket','lead','pc_build_request','operator_pin_reset') then
    return new;
  end if;
  select secret into signing_secret from public.internal_runtime_secrets where key='discord_outbox_signing';
  if signing_secret is null then return new; end if;
  ts:=floor(extract(epoch from clock_timestamp()))::bigint;
  signature:=encode(extensions.hmac(convert_to(new.id::text||':'||ts::text,'UTF8'),convert_to(signing_secret,'UTF8'),'sha256'),'hex');
  perform net.http_post(
    url:='https://uvpmmbioerejeyybfntb.supabase.co/functions/v1/discord-outbox-delivery',
    headers:=jsonb_build_object('Content-Type','application/json','x-gc-signature',signature),
    body:=jsonb_build_object('outbox_id',new.id,'ts',ts),
    timeout_milliseconds:=5000
  );
  return new;
exception when others then return new;
end;
$function$;

revoke all on function public.get_my_operator_pin_status() from public,anon;
revoke all on function public.set_my_operator_pin(text) from public,anon;
revoke all on function public.get_workstation_operator_roster() from public,anon;
revoke all on function public.verify_workstation_operator_pin(uuid,text) from public,anon;
revoke all on function public.validate_workstation_operator_session(text) from public,anon;
revoke all on function public.end_workstation_operator_session(text) from public,anon;
revoke all on function public.request_operator_pin_reset(uuid) from public,anon;
grant execute on function public.get_my_operator_pin_status() to authenticated;
grant execute on function public.set_my_operator_pin(text) to authenticated;
grant execute on function public.get_workstation_operator_roster() to authenticated;
grant execute on function public.verify_workstation_operator_pin(uuid,text) to authenticated;
grant execute on function public.validate_workstation_operator_session(text) to authenticated;
grant execute on function public.end_workstation_operator_session(text) to authenticated;
grant execute on function public.request_operator_pin_reset(uuid) to authenticated;
