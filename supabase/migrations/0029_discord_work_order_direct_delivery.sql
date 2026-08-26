create extension if not exists pg_net with schema extensions;

create table if not exists public.internal_runtime_secrets (
  key text primary key,
  secret text not null,
  created_at timestamptz not null default now()
);
alter table public.internal_runtime_secrets enable row level security;
revoke all on public.internal_runtime_secrets from anon, authenticated;
insert into public.internal_runtime_secrets(key,secret)
values('discord_outbox_signing',encode(gen_random_bytes(32),'hex'))
on conflict(key) do nothing;

create or replace function public.dispatch_discord_outbox()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  signing_secret text;
  ts bigint;
  signature text;
begin
  -- Lead creators already deliver their own Discord alerts with Open Lead /
  -- Open Appointment buttons. Restrict this path to work orders so those
  -- notifications are never duplicated.
  if new.entity_type is distinct from 'work_order' then return new; end if;

  select secret into signing_secret
  from public.internal_runtime_secrets
  where key='discord_outbox_signing';
  if signing_secret is null then return new; end if;

  ts := floor(extract(epoch from clock_timestamp()))::bigint;
  signature := encode(
    extensions.hmac(
      convert_to(new.id::text || ':' || ts::text,'UTF8'),
      convert_to(signing_secret,'UTF8'),
      'sha256'
    ),
    'hex'
  );

  perform net.http_post(
    url := 'https://uvpmmbioerejeyybfntb.supabase.co/functions/v1/discord-outbox-delivery',
    headers := jsonb_build_object('Content-Type','application/json','x-gc-signature',signature),
    body := jsonb_build_object('outbox_id',new.id,'ts',ts),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function public.dispatch_discord_outbox() from public, anon, authenticated;

drop trigger if exists discord_outbox_direct_delivery on public.discord_notification_outbox;
create trigger discord_outbox_direct_delivery
after insert on public.discord_notification_outbox
for each row execute function public.dispatch_discord_outbox();
