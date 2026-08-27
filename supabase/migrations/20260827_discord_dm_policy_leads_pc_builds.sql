alter table public.marlon_discord_config
  add column if not exists lead_dm_profile_id uuid references public.profiles(id) on delete set null;

alter table public.discord_notification_outbox
  drop constraint if exists discord_notification_outbox_entity_type_check;
alter table public.discord_notification_outbox
  add constraint discord_notification_outbox_entity_type_check
  check (entity_type = any (array['lead'::text,'work_order'::text,'purchase_order'::text,'support_ticket'::text,'pc_build_request'::text]));

create or replace function public.enqueue_discord_pc_build_request_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' then return new; end if;
  insert into public.discord_notification_outbox(
    location_id,event_key,event_type,entity_type,entity_id,payload
  ) values (
    new.location_id,
    'pc-build:' || new.id::text || ':created',
    'pc_build_request_created',
    'pc_build_request',
    new.id,
    jsonb_build_object(
      'request_id',new.id,
      'public_reference',new.public_reference,
      'lead_id',new.lead_id,
      'customer_name',new.customer_name,
      'customer_email',new.customer_email,
      'customer_phone',new.customer_phone,
      'preferred_contact',new.preferred_contact,
      'status',new.status,
      'estimated_total_cents',new.estimated_total_cents,
      'marlon_summary',new.marlon_summary,
      'portal_hash','#leads/' || coalesce(new.lead_id::text,new.id::text),
      'portal_url','https://portal.gotcracked.co/#leads/' || coalesce(new.lead_id::text,new.id::text)
    )
  ) on conflict(event_key) do nothing;
  return new;
end;
$$;

drop trigger if exists discord_pc_build_request_outbox on public.pc_build_requests;
create trigger discord_pc_build_request_outbox
after insert on public.pc_build_requests
for each row execute function public.enqueue_discord_pc_build_request_event();

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
  if new.entity_type not in ('work_order','support_ticket','lead','pc_build_request') then
    return new;
  end if;
  select secret into signing_secret from public.internal_runtime_secrets where key='discord_outbox_signing';
  if signing_secret is null then return new; end if;
  ts := floor(extract(epoch from clock_timestamp()))::bigint;
  signature := encode(extensions.hmac(convert_to(new.id::text || ':' || ts::text,'UTF8'),convert_to(signing_secret,'UTF8'),'sha256'),'hex');
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

update public.discord_notification_outbox
set delivered_at=coalesce(delivered_at,now()),
    last_error=case when delivered_at is null then 'Historical lead event suppressed when DM policy was enabled.' else last_error end
where entity_type='lead' and delivered_at is null and created_at < now() - interval '5 minutes';