-- GotCracked: provider-ready payment architecture.
-- No processor credentials are stored in Postgres or browser-visible settings.
-- Provider secrets remain in protected Edge Function secrets when connected later.

alter table public.business_settings
  add column if not exists online_payment_provider_key text,
  add column if not exists customer_online_payments_enabled boolean not null default false,
  add column if not exists customer_online_partial_payments boolean not null default false,
  add column if not exists customer_online_payment_stages jsonb not null default '["quality_inspection","repaired","ready_for_pickup"]'::jsonb,
  add column if not exists payment_auto_apply_verified boolean not null default true,
  add column if not exists payment_checkout_expiry_minutes integer not null default 30;

alter table public.business_settings drop constraint if exists business_settings_payment_checkout_expiry_check;
alter table public.business_settings add constraint business_settings_payment_checkout_expiry_check
  check (payment_checkout_expiry_minutes between 5 and 1440);

create table if not exists public.payment_provider_connections (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  provider_key text not null,
  display_name text not null,
  connection_status text not null default 'disconnected',
  environment text not null default 'test',
  merchant_reference text,
  public_configuration jsonb not null default '{}'::jsonb,
  capabilities jsonb not null default '{}'::jsonb,
  connected_at timestamptz,
  last_verified_at timestamptz,
  last_error text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique(location_id,provider_key),
  constraint payment_provider_connection_status_check check (connection_status in ('disconnected','configured','connected','degraded','disabled','error')),
  constraint payment_provider_environment_check check (environment in ('test','live'))
);

alter table public.payment_provider_connections enable row level security;
drop policy if exists "staff can view payment provider connections" on public.payment_provider_connections;
create policy "staff can view payment provider connections"
  on public.payment_provider_connections for select to authenticated
  using (location_id=public.current_location_id() and (
    coalesce(public.has_permission('settings.manage'),false)
    or coalesce(public.has_permission('ready_pickup.checkout'),false)
    or coalesce(public.has_permission('reports.view'),false)
  ));
revoke insert,update,delete on public.payment_provider_connections from anon,authenticated;
grant select on public.payment_provider_connections to authenticated;

create table if not exists public.payment_checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null references public.payment_requests(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  provider_connection_id uuid references public.payment_provider_connections(id) on delete set null,
  provider_key text not null,
  provider_session_id text,
  provider_payment_id text,
  status text not null default 'created',
  amount_cents integer not null check (amount_cents > 0),
  currency_code text not null default 'USD',
  checkout_url text,
  return_url text,
  cancel_url text,
  idempotency_key text not null unique,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_checkout_session_status_check check (status in ('created','pending','requires_action','processing','paid','failed','expired','cancelled'))
);
create unique index if not exists payment_checkout_provider_session_idx on public.payment_checkout_sessions(provider_key,provider_session_id) where provider_session_id is not null;
create index if not exists payment_checkout_request_idx on public.payment_checkout_sessions(payment_request_id,created_at desc);
create index if not exists payment_checkout_location_status_idx on public.payment_checkout_sessions(location_id,status,created_at desc);

alter table public.payment_checkout_sessions enable row level security;
drop policy if exists "staff can view payment checkout sessions" on public.payment_checkout_sessions;
create policy "staff can view payment checkout sessions"
  on public.payment_checkout_sessions for select to authenticated
  using (location_id=public.current_location_id() and (
    coalesce(public.has_permission('repairs.view'),false)
    or coalesce(public.has_permission('ready_pickup.checkout'),false)
    or coalesce(public.has_permission('reports.view'),false)
  ));
revoke insert,update,delete on public.payment_checkout_sessions from anon,authenticated;
grant select on public.payment_checkout_sessions to authenticated;

create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  ticket_id uuid references public.repair_tickets(id) on delete set null,
  payment_request_id uuid references public.payment_requests(id) on delete set null,
  checkout_session_id uuid references public.payment_checkout_sessions(id) on delete set null,
  provider_key text not null,
  provider_transaction_id text not null,
  transaction_type text not null,
  status text not null,
  amount_cents integer not null check (amount_cents >= 0),
  currency_code text not null default 'USD',
  payment_method text,
  card_brand text,
  card_last4 text,
  provider_fee_cents integer,
  reference text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(provider_key,provider_transaction_id,transaction_type),
  constraint payment_transaction_type_check check (transaction_type in ('authorization','capture','sale','refund','void')),
  constraint payment_transaction_status_check check (status in ('pending','succeeded','failed','cancelled'))
);
create index if not exists payment_transactions_ticket_idx on public.payment_transactions(ticket_id,occurred_at desc);
create index if not exists payment_transactions_request_idx on public.payment_transactions(payment_request_id,occurred_at desc);

alter table public.payment_transactions enable row level security;
drop policy if exists "staff can view payment transactions" on public.payment_transactions;
create policy "staff can view payment transactions"
  on public.payment_transactions for select to authenticated
  using (location_id=public.current_location_id() and (
    coalesce(public.has_permission('ready_pickup.checkout'),false)
    or coalesce(public.has_permission('reports.view'),false)
    or coalesce(public.has_permission('settings.manage'),false)
  ));
revoke insert,update,delete on public.payment_transactions from anon,authenticated;
grant select on public.payment_transactions to authenticated;

create table if not exists public.payment_provider_events (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references public.locations(id) on delete set null,
  provider_key text not null,
  provider_event_id text not null,
  event_type text not null,
  payment_request_id uuid references public.payment_requests(id) on delete set null,
  checkout_session_id uuid references public.payment_checkout_sessions(id) on delete set null,
  payload_sha256 text,
  signature_verified boolean not null default false,
  processing_status text not null default 'received',
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(provider_key,provider_event_id),
  constraint payment_provider_event_status_check check (processing_status in ('received','processed','ignored','error'))
);
alter table public.payment_provider_events enable row level security;
revoke all on public.payment_provider_events from public,anon,authenticated;
drop policy if exists "payment provider events deny browser" on public.payment_provider_events;
create policy "payment provider events deny browser" on public.payment_provider_events for all to anon,authenticated using (false) with check (false);

-- Multiple verified requests may legitimately exist for one repair (deposit + balance).
drop index if exists public.payment_requests_ticket_unique_idx;
create index if not exists payment_requests_ticket_idx on public.payment_requests(ticket_id,created_at desc) where ticket_id is not null;
alter table public.payment_requests drop constraint if exists payment_requests_method_check;
alter table public.payment_requests add constraint payment_requests_method_check check (payment_method in ('cash','external_pos_card','external_pos_other','cash_app','zelle','chime','paypal','online_checkout'));
alter table public.payment_requests drop constraint if exists payment_requests_status_check;
alter table public.payment_requests add constraint payment_requests_status_check check (status in ('pending','awaiting_external_confirmation','partial','verified','failed','cancelled','refunded'));

insert into public.payment_method_routes(location_id,payment_method,payment_channel,requires_reference,cash_drawer,active)
select id,'online_checkout','internal',false,false,true from public.locations
on conflict(location_id,payment_method) do update set payment_channel='internal',requires_reference=false,cash_drawer=false,active=true,updated_at=now();

create or replace function public.get_payment_configuration()
returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  cfg public.business_settings;
  conn public.payment_provider_connections;
  routes jsonb;
  online_available boolean := false;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into cfg from public.business_settings where location_id=public.current_location_id();
  if cfg.location_id is null then raise exception 'Business settings are not configured'; end if;
  if nullif(cfg.online_payment_provider_key,'') is not null then
    select * into conn from public.payment_provider_connections
    where location_id=cfg.location_id and provider_key=cfg.online_payment_provider_key;
  end if;
  online_available := coalesce(cfg.customer_online_payments_enabled,false) and conn.id is not null and conn.connection_status='connected';
  select coalesce(jsonb_object_agg(r.payment_method,jsonb_build_object('channel',r.payment_channel,'requires_reference',r.requires_reference,'cash_drawer',r.cash_drawer)),'{}'::jsonb)
    into routes from public.payment_method_routes r where r.location_id=cfg.location_id and r.active=true;
  return jsonb_build_object(
    'prepay_required',false,
    'routing_mode',cfg.payment_routing_mode,
    'methods',jsonb_build_object('cash',cfg.payments_cash_enabled,'external_pos_card',cfg.payments_external_card_enabled,'external_pos_other',cfg.payments_external_other_enabled,'cash_app',cfg.payments_cash_app_enabled,'zelle',cfg.payments_zelle_enabled,'chime',cfg.payments_chime_enabled,'paypal',cfg.payments_paypal_enabled),
    'routes',routes,
    'paypal_automatic_verification',cfg.paypal_automatic_verification_enabled,
    'online',jsonb_build_object('architecture_ready',true,'provider_key',cfg.online_payment_provider_key,'provider_label',conn.display_name,'connection_status',coalesce(conn.connection_status,'disconnected'),'environment',coalesce(conn.environment,'test'),'customer_enabled',cfg.customer_online_payments_enabled,'available',online_available,'partial_payments',cfg.customer_online_partial_payments,'stages',cfg.customer_online_payment_stages,'auto_apply_verified',cfg.payment_auto_apply_verified,'checkout_expiry_minutes',cfg.payment_checkout_expiry_minutes,'capabilities',coalesce(conn.capabilities,'{}'::jsonb))
  );
end; $$;

create or replace function public.save_online_payment_configuration(
  provider_key text,
  provider_label text,
  provider_environment text,
  customer_enabled boolean,
  partial_enabled boolean,
  auto_apply_verified boolean,
  checkout_expiry_minutes integer
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare loc uuid; normalized text; label_text text; existing_status text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if public.current_staff_role() not in ('owner','manager') or not coalesce(public.has_permission('settings.manage'),false) then
    raise exception 'Management permission is required to change payment settings';
  end if;
  normalized:=lower(nullif(btrim(coalesce(provider_key,'')),''));
  if normalized is not null and normalized !~ '^[a-z0-9][a-z0-9_-]{1,39}$' then raise exception 'Invalid payment provider key'; end if;
  if provider_environment not in ('test','live') then raise exception 'Choose test or live payment environment'; end if;
  if coalesce(checkout_expiry_minutes,0) not between 5 and 1440 then raise exception 'Checkout expiry must be between 5 and 1440 minutes'; end if;
  loc:=public.current_location_id(); label_text:=coalesce(nullif(btrim(provider_label),''),initcap(replace(coalesce(normalized,'Payment provider'),'_',' ')));
  if normalized is not null then
    select connection_status into existing_status from public.payment_provider_connections where location_id=loc and provider_key=normalized;
    insert into public.payment_provider_connections(location_id,provider_key,display_name,connection_status,environment,updated_by)
    values(loc,normalized,label_text,coalesce(existing_status,'disconnected'),provider_environment,auth.uid())
    on conflict(location_id,provider_key) do update set display_name=excluded.display_name,environment=excluded.environment,updated_by=auth.uid(),updated_at=now();
  end if;
  update public.business_settings set
    online_payment_provider_key=normalized,
    customer_online_payments_enabled=case when normalized is null then false else coalesce(customer_enabled,false) end,
    customer_online_partial_payments=coalesce(partial_enabled,false),
    payment_auto_apply_verified=coalesce(auto_apply_verified,true),
    payment_checkout_expiry_minutes=checkout_expiry_minutes,
    updated_at=now()
  where location_id=loc;
  return public.get_payment_configuration();
end; $$;

create or replace function public.set_payment_provider_connection_state(
  target_location uuid,
  target_provider text,
  target_status text,
  merchant_ref text default null,
  target_capabilities jsonb default '{}'::jsonb,
  target_public_configuration jsonb default '{}'::jsonb,
  error_text text default null
) returns public.payment_provider_connections
language plpgsql security definer set search_path=public as $$
declare saved public.payment_provider_connections; provider text:=lower(btrim(target_provider));
begin
  if target_status not in ('disconnected','configured','connected','degraded','disabled','error') then raise exception 'Invalid connection status'; end if;
  if provider !~ '^[a-z0-9][a-z0-9_-]{1,39}$' then raise exception 'Invalid payment provider key'; end if;
  insert into public.payment_provider_connections(location_id,provider_key,display_name,connection_status,environment,merchant_reference,public_configuration,capabilities,connected_at,last_verified_at,last_error,updated_at)
  values(target_location,provider,initcap(replace(provider,'_',' ')),target_status,'test',nullif(btrim(merchant_ref),''),coalesce(target_public_configuration,'{}'::jsonb),coalesce(target_capabilities,'{}'::jsonb),case when target_status='connected' then now() else null end,case when target_status in ('connected','degraded') then now() else null end,nullif(btrim(error_text),''),now())
  on conflict(location_id,provider_key) do update set
    connection_status=excluded.connection_status,
    merchant_reference=coalesce(excluded.merchant_reference,payment_provider_connections.merchant_reference),
    public_configuration=excluded.public_configuration,
    capabilities=excluded.capabilities,
    connected_at=case when excluded.connection_status='connected' then coalesce(payment_provider_connections.connected_at,now()) else payment_provider_connections.connected_at end,
    last_verified_at=case when excluded.connection_status in ('connected','degraded') then now() else payment_provider_connections.last_verified_at end,
    last_error=excluded.last_error,
    updated_at=now()
  returning * into saved;
  return saved;
end; $$;

create or replace function public.ensure_online_payment_request(target_ticket uuid,target_provider text,requested_amount_cents integer)
returns public.payment_requests
language plpgsql security definer set search_path=public as $$
declare t public.repair_tickets; cfg public.business_settings; conn public.payment_provider_connections; saved public.payment_requests; verified_total integer:=0; balance integer:=0; provider text:=lower(btrim(target_provider));
begin
  select * into t from public.repair_tickets where id=target_ticket for update;
  if t.id is null then raise exception 'Repair not found'; end if;
  select * into cfg from public.business_settings where location_id=t.location_id;
  if cfg.location_id is null or not cfg.customer_online_payments_enabled then raise exception 'Customer online payment is not enabled'; end if;
  if cfg.online_payment_provider_key is distinct from provider then raise exception 'Payment provider is not active for this location'; end if;
  select * into conn from public.payment_provider_connections where location_id=t.location_id and provider_key=provider;
  if conn.id is null or conn.connection_status<>'connected' then raise exception 'Payment provider is not connected'; end if;
  if not (cfg.customer_online_payment_stages ? t.status::text) then raise exception 'This repair is not eligible for online payment yet'; end if;
  select coalesce(sum(amount_verified_cents),0) into verified_total from public.payment_requests where ticket_id=t.id and status in ('partial','verified');
  balance:=greatest(coalesce(t.total_cents,0)-greatest(verified_total,coalesce(t.amount_paid_cents,0)),0);
  if balance<=0 then raise exception 'This repair has no remaining balance'; end if;
  if requested_amount_cents<=0 or requested_amount_cents>balance then raise exception 'Invalid payment amount'; end if;
  if not cfg.customer_online_partial_payments and requested_amount_cents<>balance then raise exception 'Partial online payments are not enabled'; end if;
  select * into saved from public.payment_requests where ticket_id=t.id and provider=provider and payment_method='online_checkout' and status='pending' and amount_due_cents=requested_amount_cents and created_at>now()-make_interval(mins=>cfg.payment_checkout_expiry_minutes) order by created_at desc limit 1;
  if saved.id is not null then return saved; end if;
  insert into public.payment_requests(location_id,ticket_id,customer_id,purpose,amount_due_cents,currency_code,payment_method,provider,verification_mode,status,metadata)
  values(t.location_id,t.id,t.customer_id,'repair_balance',requested_amount_cents,coalesce(cfg.currency_code,'USD'),'online_checkout',provider,'provider_callback','pending',jsonb_build_object('source','customer_account')) returning * into saved;
  return saved;
end; $$;

create or replace function public.refresh_ticket_verified_payment_total(target_ticket uuid)
returns public.repair_tickets
language plpgsql security definer set search_path=public as $$
declare t public.repair_tickets; online_paid integer:=0; legacy_paid integer:=0; combined integer:=0; method_text text; ref_text text;
begin
  select * into t from public.repair_tickets where id=target_ticket for update;
  if t.id is null then raise exception 'Repair not found'; end if;
  select coalesce(sum(amount_verified_cents),0),
         case when count(distinct payment_method)>1 then 'split' else max(payment_method) end,
         string_agg(distinct payment_reference,' | ' order by payment_reference) filter(where payment_reference is not null)
    into online_paid,method_text,ref_text
  from public.payment_requests where ticket_id=t.id and status in ('partial','verified');
  legacy_paid:=case when coalesce(t.payment_method,'') in ('online_checkout','online','paypal') then 0 else greatest(coalesce(t.amount_paid_cents,0),0) end;
  combined:=least(greatest(coalesce(t.total_cents,0),0),legacy_paid+online_paid);
  update public.repair_tickets set
    amount_paid_cents=combined,
    payment_status=case when combined<=0 then 'unpaid' when combined>=greatest(coalesce(total_cents,0),0) and total_cents>0 then 'paid' else 'partial' end,
    payment_method=case when legacy_paid>0 and online_paid>0 then 'split' when online_paid>0 then coalesce(method_text,'online_checkout') else payment_method end,
    payment_reference=case when online_paid>0 then coalesce(ref_text,payment_reference) else payment_reference end,
    paid_at=case when combined>=greatest(coalesce(total_cents,0),0) and total_cents>0 then coalesce(paid_at,now()) else null end,
    updated_at=now()
  where id=t.id returning * into t;
  return t;
end; $$;

create or replace function public.apply_provider_payment(
  target_provider text,target_event_id text,target_request uuid,target_transaction_id text,target_amount_cents integer,
  target_currency text default 'USD',target_payment_method text default 'online_checkout',target_card_brand text default null,
  target_card_last4 text default null,target_fee_cents integer default null,target_reference text default null,
  target_provider_session_id text default null,target_occurred_at timestamptz default now(),target_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare req public.payment_requests; session_row public.payment_checkout_sessions; net integer:=0; t public.repair_tickets;
begin
  if coalesce(target_amount_cents,0)<=0 then raise exception 'Provider payment amount must be positive'; end if;
  select * into req from public.payment_requests where id=target_request for update;
  if req.id is null or req.provider is distinct from lower(btrim(target_provider)) then raise exception 'Payment request/provider mismatch'; end if;
  insert into public.payment_provider_events(location_id,provider_key,provider_event_id,event_type,payment_request_id,payload_sha256,signature_verified,processing_status,metadata,processed_at)
  values(req.location_id,lower(btrim(target_provider)),target_event_id,'payment_succeeded',req.id,target_metadata->>'payload_sha256',true,'processed',coalesce(target_metadata,'{}'::jsonb),now())
  on conflict(provider_key,provider_event_id) do nothing;
  select * into session_row from public.payment_checkout_sessions where payment_request_id=req.id and provider_key=lower(btrim(target_provider)) and (target_provider_session_id is null or provider_session_id=target_provider_session_id) order by created_at desc limit 1 for update;
  insert into public.payment_transactions(location_id,ticket_id,payment_request_id,checkout_session_id,provider_key,provider_transaction_id,transaction_type,status,amount_cents,currency_code,payment_method,card_brand,card_last4,provider_fee_cents,reference,metadata,occurred_at)
  values(req.location_id,req.ticket_id,req.id,session_row.id,lower(btrim(target_provider)),target_transaction_id,'sale','succeeded',target_amount_cents,upper(coalesce(target_currency,'USD')),target_payment_method,nullif(btrim(target_card_brand),''),nullif(btrim(target_card_last4),''),target_fee_cents,nullif(btrim(target_reference),''),coalesce(target_metadata,'{}'::jsonb),coalesce(target_occurred_at,now()))
  on conflict(provider_key,provider_transaction_id,transaction_type) do nothing;
  if session_row.id is not null then update public.payment_checkout_sessions set status='paid',provider_payment_id=coalesce(provider_payment_id,target_transaction_id),updated_at=now() where id=session_row.id; end if;
  select greatest(coalesce(sum(case when transaction_type in ('sale','capture') and status='succeeded' then amount_cents when transaction_type='refund' and status='succeeded' then -amount_cents else 0 end),0),0) into net from public.payment_transactions where payment_request_id=req.id;
  update public.payment_requests set amount_verified_cents=net,status=case when net>=amount_due_cents then 'verified' when net>0 then 'partial' else 'pending' end,payment_reference=coalesce(nullif(btrim(target_reference),''),target_transaction_id),provider_event_id=target_event_id,verified_at=case when net>0 then coalesce(verified_at,now()) else null end,updated_at=now() where id=req.id returning * into req;
  if req.ticket_id is not null then t:=public.refresh_ticket_verified_payment_total(req.ticket_id); end if;
  return jsonb_build_object('ok',true,'payment_request_id',req.id,'ticket_id',req.ticket_id,'verified_cents',net,'request_status',req.status,'ticket_payment_status',t.payment_status,'ticket_amount_paid_cents',t.amount_paid_cents);
end; $$;

create or replace function public.apply_provider_refund(
  target_provider text,target_event_id text,target_request uuid,target_refund_transaction_id text,target_amount_cents integer,
  target_currency text default 'USD',target_reference text default null,target_occurred_at timestamptz default now(),target_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare req public.payment_requests; session_row public.payment_checkout_sessions; net integer:=0; paid_total integer:=0; t public.repair_tickets;
begin
  if coalesce(target_amount_cents,0)<=0 then raise exception 'Provider refund amount must be positive'; end if;
  select * into req from public.payment_requests where id=target_request for update;
  if req.id is null or req.provider is distinct from lower(btrim(target_provider)) then raise exception 'Payment request/provider mismatch'; end if;
  select coalesce(sum(case when transaction_type in ('sale','capture') and status='succeeded' then amount_cents else 0 end),0) into paid_total from public.payment_transactions where payment_request_id=req.id;
  if target_amount_cents>paid_total then raise exception 'Refund exceeds captured provider payment'; end if;
  insert into public.payment_provider_events(location_id,provider_key,provider_event_id,event_type,payment_request_id,payload_sha256,signature_verified,processing_status,metadata,processed_at)
  values(req.location_id,lower(btrim(target_provider)),target_event_id,'refund_succeeded',req.id,target_metadata->>'payload_sha256',true,'processed',coalesce(target_metadata,'{}'::jsonb),now())
  on conflict(provider_key,provider_event_id) do nothing;
  select * into session_row from public.payment_checkout_sessions where payment_request_id=req.id and provider_key=lower(btrim(target_provider)) order by created_at desc limit 1;
  insert into public.payment_transactions(location_id,ticket_id,payment_request_id,checkout_session_id,provider_key,provider_transaction_id,transaction_type,status,amount_cents,currency_code,payment_method,reference,metadata,occurred_at)
  values(req.location_id,req.ticket_id,req.id,session_row.id,lower(btrim(target_provider)),target_refund_transaction_id,'refund','succeeded',target_amount_cents,upper(coalesce(target_currency,'USD')),'online_checkout',nullif(btrim(target_reference),''),coalesce(target_metadata,'{}'::jsonb),coalesce(target_occurred_at,now()))
  on conflict(provider_key,provider_transaction_id,transaction_type) do nothing;
  select greatest(coalesce(sum(case when transaction_type in ('sale','capture') and status='succeeded' then amount_cents when transaction_type='refund' and status='succeeded' then -amount_cents else 0 end),0),0) into net from public.payment_transactions where payment_request_id=req.id;
  update public.payment_requests set amount_verified_cents=net,status=case when net<=0 then 'refunded' when net>=amount_due_cents then 'verified' else 'partial' end,verified_at=case when net>0 then verified_at else null end,updated_at=now() where id=req.id returning * into req;
  if req.ticket_id is not null then t:=public.refresh_ticket_verified_payment_total(req.ticket_id); end if;
  return jsonb_build_object('ok',true,'payment_request_id',req.id,'ticket_id',req.ticket_id,'verified_cents',net,'request_status',req.status,'ticket_payment_status',t.payment_status,'ticket_amount_paid_cents',t.amount_paid_cents);
end; $$;

create or replace function public.get_checkout_payment_summary(target_ticket uuid)
returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare loc uuid:=public.current_location_id(); t public.repair_tickets; request_paid integer:=0; prepaid integer:=0; balance integer:=0; overpayment integer:=0; method_text text; ref_text text; payments jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if loc is null or not coalesce(public.has_permission('ready_pickup.checkout'),false) then raise exception 'Checkout permission required.'; end if;
  select * into t from public.repair_tickets where id=target_ticket and location_id=loc;
  if t.id is null then raise exception 'Work order not found.'; end if;
  select coalesce(sum(amount_verified_cents),0),case when count(distinct payment_method)>1 then 'split' else max(payment_method) end,string_agg(distinct payment_reference,' | ' order by payment_reference) filter(where payment_reference is not null),
         coalesce(jsonb_agg(jsonb_build_object('id',id,'method',payment_method,'provider',provider,'amount_cents',amount_verified_cents,'reference',payment_reference,'status',status,'verified_at',verified_at) order by created_at) filter(where amount_verified_cents>0),'[]'::jsonb)
    into request_paid,method_text,ref_text,payments from public.payment_requests where ticket_id=t.id and status in ('partial','verified');
  prepaid:=greatest(request_paid,greatest(coalesce(t.amount_paid_cents,0),0));
  overpayment:=greatest(prepaid-greatest(coalesce(t.total_cents,0),0),0);
  balance:=greatest(greatest(coalesce(t.total_cents,0),0)-prepaid,0);
  return jsonb_build_object('ticket_id',t.id,'total_cents',greatest(coalesce(t.total_cents,0),0),'prepayment_amount_cents',prepaid,'prepayment_method',coalesce(method_text,t.payment_method),'prepayment_reference',coalesce(ref_text,t.payment_reference),'balance_due_cents',balance,'overpayment_cents',overpayment,'payment_request_id',t.payment_request_id,'prepay_required',coalesce(t.prepay_required,false),'verified_payments',coalesce(payments,'[]'::jsonb));
end; $$;

create or replace function public.finalize_repair_sale(target_ticket uuid,payment_method text,payment_reference text default null,paid_amount_cents integer default null)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  loc uuid:=public.current_location_id(); t public.repair_tickets; c public.customers; d public.devices; r public.receipts;
  biz_date date; expected integer:=0; request_paid integer:=0; prepaid integer:=0; balance_due integer:=0; checkout_paid integer:=0;
  tender text:=coalesce(nullif(trim(payment_method),''),'external_pos_card'); reference_text text:=nullif(trim(coalesce(payment_reference,'')),'');
  prepaid_method text; prepaid_reference text; combined_method text; combined_reference text; lines jsonb; route_row public.payment_method_routes;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if loc is null or not coalesce(public.has_permission('ready_pickup.checkout'),false) then raise exception 'Checkout permission required.'; end if;
  select * into t from public.repair_tickets where id=target_ticket and location_id=loc for update;
  if t.id is null then raise exception 'Work order not found.'; end if;
  if t.status::text not in ('repaired','ready_for_pickup') then raise exception 'Work order must be Ready for Pickup before Sale Complete.'; end if;
  if exists(select 1 from public.receipts where ticket_id=t.id) then raise exception 'This work order already has a completed sale receipt.'; end if;
  expected:=greatest(coalesce(t.total_cents,0),0);
  select coalesce(sum(amount_verified_cents),0),case when count(distinct payment_method)>1 then 'split' else max(payment_method) end,string_agg(distinct payment_reference,' | ' order by payment_reference) filter(where payment_reference is not null)
    into request_paid,prepaid_method,prepaid_reference from public.payment_requests where ticket_id=t.id and status in ('partial','verified');
  prepaid:=greatest(request_paid,greatest(coalesce(t.amount_paid_cents,0),0));
  if coalesce(t.payment_method,'')='split' or coalesce(t.amount_paid_cents,0)>request_paid then prepaid_method:=coalesce(t.payment_method,prepaid_method); end if;
  if coalesce(t.payment_reference,'')<>'' and (prepaid_reference is null or coalesce(t.amount_paid_cents,0)>request_paid) then prepaid_reference:=t.payment_reference; end if;
  if prepaid>expected then raise exception 'Verified payment exceeds the final work-order total. Resolve/refund the excess payment before completing the sale.'; end if;
  balance_due:=expected-prepaid; checkout_paid:=coalesce(paid_amount_cents,balance_due);
  if checkout_paid<0 or checkout_paid<>balance_due then raise exception 'Checkout amount must equal the remaining balance after verified payment.'; end if;
  if balance_due>0 then
    if not public.is_payment_method_enabled(loc,tender) then raise exception 'That payment method is not enabled for this location.'; end if;
    select * into route_row from public.payment_method_routes where location_id=loc and payment_method=tender and active=true;
    if route_row.payment_method is null then raise exception 'Payment route is not configured for this method.'; end if;
    if route_row.requires_reference and reference_text is null then raise exception 'Enter the payment receipt, confirmation, or transaction reference.'; end if;
  else tender:='prepaid'; reference_text:=null; end if;

  select * into c from public.customers where id=t.customer_id;
  select * into d from public.devices where id=t.device_id;
  biz_date:=public.current_business_date(loc);
  select coalesce(jsonb_agg(jsonb_build_object('item_type',w.item_type,'sku',w.sku,'description',w.description,'quantity',w.quantity,'unit_price_cents',coalesce(w.unit_price_cents,0),'unit_cost_cents',coalesce(w.unit_cost_cents,0),'line_total_cents',round(coalesce(w.quantity,1)*coalesce(w.unit_price_cents,0))::integer,'part_pricing_mode',w.part_pricing_mode) order by w.created_at),'[]'::jsonb)
    into lines from public.work_order_items w where w.ticket_id=t.id;
  combined_method:=case when prepaid>0 and checkout_paid>0 then 'split' when prepaid>0 then coalesce(prepaid_method,'prepaid') else tender end;
  combined_reference:=case when prepaid>0 and checkout_paid>0 then concat_ws(' | ',case when prepaid_reference is not null then 'Prepay '||prepaid_reference end,case when reference_text is not null then 'Checkout '||reference_text end) when prepaid>0 then prepaid_reference else reference_text end;
  perform set_config('app.repair_status_advance','allowed',true);
  update public.repair_tickets set payment_status='paid',amount_paid_cents=expected,payment_method=combined_method,payment_reference=combined_reference,paid_at=coalesce(paid_at,now()),status='sale_complete',pickup_at=coalesce(pickup_at,now()),completed_at=coalesce(completed_at,now()),sale_completed_at=now(),sale_business_date=biz_date,updated_at=now() where id=t.id;
  insert into public.ticket_events(ticket_id,actor_user_id,event_type,message,visibility)
  values(t.id,auth.uid(),'sale_complete','Sale complete · total '||(expected::numeric/100)::text||' · verified before pickup '||(prepaid::numeric/100)::text||' · checkout '||(checkout_paid::numeric/100)::text,'internal');
  insert into public.receipts(location_id,ticket_id,ticket_number,business_date,customer_id,customer_name,customer_email,device_description,subtotal_cents,tax_cents,total_cents,amount_paid_cents,payment_method,payment_reference,line_items,created_by,prepayment_amount_cents,prepayment_method,prepayment_reference,checkout_amount_cents,checkout_payment_method,checkout_payment_reference)
  values(loc,t.id,t.ticket_number,biz_date,t.customer_id,trim(coalesce(c.first_name,'')||' '||coalesce(c.last_name,'')),nullif(trim(c.email),''),nullif(trim(concat_ws(' ',d.manufacturer,d.model)),''),coalesce(t.subtotal_cents,0),coalesce(t.tax_cents,0),expected,expected,combined_method,combined_reference,lines,auth.uid(),prepaid,case when prepaid>0 then coalesce(prepaid_method,'prepaid') else null end,case when prepaid>0 then prepaid_reference else null end,checkout_paid,case when checkout_paid>0 then tender else null end,case when checkout_paid>0 then reference_text else null end)
  returning * into r;
  perform public.post_receipt_to_sales_ledger(r.id);
  return jsonb_build_object('receipt_id',r.id,'receipt_number',r.receipt_number,'ticket_id',r.ticket_id,'ticket_number',r.ticket_number,'business_date',r.business_date,'customer_name',r.customer_name,'customer_email',r.customer_email,'device_description',r.device_description,'subtotal_cents',r.subtotal_cents,'tax_cents',r.tax_cents,'total_cents',r.total_cents,'amount_paid_cents',r.amount_paid_cents,'payment_method',r.payment_method,'payment_reference',r.payment_reference,'line_items',r.line_items,'created_at',r.created_at,'prepayment_amount_cents',r.prepayment_amount_cents,'prepayment_method',r.prepayment_method,'prepayment_reference',r.prepayment_reference,'checkout_amount_cents',r.checkout_amount_cents,'checkout_payment_method',r.checkout_payment_method,'checkout_payment_reference',r.checkout_payment_reference,'checkout_payment_channel',case when checkout_paid>0 then public.payment_channel_for_method(loc,tender) else null end);
end; $$;

comment on table public.payment_provider_connections is 'Non-secret payment provider connection state. Credentials live only in protected Edge Function secrets.';
comment on table public.payment_checkout_sessions is 'Provider-agnostic hosted checkout sessions. A redirect never verifies payment; trusted provider callbacks do.';
comment on table public.payment_transactions is 'Canonical trusted provider payment/refund transaction ledger used by Portal reconciliation.';
comment on table public.payment_provider_events is 'Service-only idempotent provider event audit log; browser access is explicitly denied.';

revoke all on function public.save_online_payment_configuration(text,text,text,boolean,boolean,boolean,integer) from public,anon;
grant execute on function public.save_online_payment_configuration(text,text,text,boolean,boolean,boolean,integer) to authenticated;
revoke all on function public.set_payment_provider_connection_state(uuid,text,text,text,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.set_payment_provider_connection_state(uuid,text,text,text,jsonb,jsonb,text) to service_role;
revoke all on function public.ensure_online_payment_request(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.ensure_online_payment_request(uuid,text,integer) to service_role;
revoke all on function public.refresh_ticket_verified_payment_total(uuid) from public,anon,authenticated;
grant execute on function public.refresh_ticket_verified_payment_total(uuid) to service_role;
revoke all on function public.apply_provider_payment(text,text,uuid,text,integer,text,text,text,text,integer,text,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.apply_provider_payment(text,text,uuid,text,integer,text,text,text,text,integer,text,text,timestamptz,jsonb) to service_role;
revoke all on function public.apply_provider_refund(text,text,uuid,text,integer,text,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.apply_provider_refund(text,text,uuid,text,integer,text,text,timestamptz,jsonb) to service_role;
grant execute on function public.get_checkout_payment_summary(uuid) to authenticated;
grant execute on function public.finalize_repair_sale(uuid,text,text,integer) to authenticated;
