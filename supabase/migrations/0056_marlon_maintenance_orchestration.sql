create table if not exists public.marlon_maintenance_events (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  surface text not null check (surface in ('portal','website','both')),
  change_class text not null check (change_class in ('quick_patch','disruptive')),
  status text not null check (status in ('scheduled','deferred','started','completed','failed')),
  requires_downtime boolean not null default false,
  reason text,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  dm_recipients integer not null default 0,
  details jsonb not null default '{}'::jsonb
);

alter table public.marlon_maintenance_events enable row level security;
revoke all on table public.marlon_maintenance_events from anon, authenticated;

create index if not exists marlon_maintenance_events_location_time_idx
  on public.marlon_maintenance_events(location_id, requested_at desc);

insert into public.internal_runtime_secrets(key,secret)
values ('marlon_operations_signing', encode(extensions.gen_random_bytes(32),'hex'))
on conflict (key) do nothing;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.invoke_marlon_operation(p_action text, p_body jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_secret text;
  v_ts text := extract(epoch from now())::bigint::text;
  v_sig text;
  v_body jsonb := coalesce(p_body,'{}'::jsonb) || jsonb_build_object('action',p_action);
  v_id bigint;
begin
  select secret into strict v_secret
  from public.internal_runtime_secrets
  where key='marlon_operations_signing';

  v_sig := encode(
    extensions.hmac(
      convert_to(v_ts||':'||p_action,'UTF8'),
      convert_to(v_secret,'UTF8'),
      'sha256'
    ),
    'hex'
  );

  select net.http_post(
    url := 'https://uvpmmbioerejeyybfntb.supabase.co/functions/v1/marlon-operations',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-gc-ts',v_ts,
      'x-gc-action',p_action,
      'x-gc-signature',v_sig
    ),
    body := v_body
  ) into v_id;

  return v_id;
end;
$$;

revoke all on function private.invoke_marlon_operation(text,jsonb)
  from public, anon, authenticated;
