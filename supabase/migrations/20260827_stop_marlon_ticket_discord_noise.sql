drop trigger if exists discord_support_ticket_outbox on public.support_tickets;

create or replace function public.enqueue_discord_support_ticket_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Normal Marlon support tickets are tracked in the Portal Support Desk only.
  -- Discord is reserved for operational alerts such as maintenance and outages.
  return new;
end;
$$;

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
  if new.entity_type <> 'work_order' then
    return new;
  end if;
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