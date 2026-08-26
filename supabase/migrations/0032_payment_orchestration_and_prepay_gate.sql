-- GotCracked Portal: unified payment orchestration + work-order prepay gate
-- Online providers must be verified by a trusted server callback. Cash and physical
-- POS tenders may be confirmed by authorized intake staff and are fully audited.

alter table public.business_settings
  add column if not exists prepay_required_default boolean not null default true,
  add column if not exists payment_routing_mode text not null default 'hybrid',
  add column if not exists payments_cash_enabled boolean not null default true,
  add column if not exists payments_external_card_enabled boolean not null default true,
  add column if not exists payments_external_other_enabled boolean not null default true,
  add column if not exists payments_cash_app_enabled boolean not null default true,
  add column if not exists payments_zelle_enabled boolean not null default true,
  add column if not exists payments_chime_enabled boolean not null default true,
  add column if not exists payments_paypal_enabled boolean not null default false,
  add column if not exists paypal_automatic_verification_enabled boolean not null default false;

alter table public.business_settings
  drop constraint if exists business_settings_payment_routing_mode_check;
alter table public.business_settings
  add constraint business_settings_payment_routing_mode_check
  check (payment_routing_mode in ('internal','external','hybrid'));

create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  ticket_id uuid references public.repair_tickets(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  intake_session_id uuid references public.intake_sessions(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  purpose text not null default 'repair_prepay',
  amount_due_cents integer not null check (amount_due_cents > 0),
  amount_verified_cents integer not null default 0 check (amount_verified_cents >= 0),
  currency_code text not null default 'USD',
  payment_method text not null,
  provider text,
  verification_mode text not null,
  status text not null default 'pending',
  payment_reference text,
  provider_event_id text,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  requested_by uuid references public.profiles(id) on delete set null,
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_requests_method_check check (payment_method in (
    'cash','external_pos_card','external_pos_other','cash_app','zelle','chime','paypal'
  )),
  constraint payment_requests_verification_mode_check check (verification_mode in (
    'manual_staff','provider_callback','manager_override'
  )),
  constraint payment_requests_status_check check (status in (
    'pending','awaiting_external_confirmation','verified','failed','cancelled','refunded'
  )),
  constraint payment_requests_verified_amount_check check (
    status <> 'verified' or amount_verified_cents >= amount_due_cents
  )
);

create unique index if not exists payment_requests_ticket_unique_idx
  on public.payment_requests(ticket_id) where ticket_id is not null;
create unique index if not exists payment_requests_provider_event_unique_idx
  on public.payment_requests(provider, provider_event_id)
  where provider is not null and provider_event_id is not null;
create index if not exists payment_requests_location_status_idx
  on public.payment_requests(location_id,status,created_at desc);
create index if not exists payment_requests_lead_idx
  on public.payment_requests(lead_id) where lead_id is not null;
create index if not exists payment_requests_intake_idx
  on public.payment_requests(intake_session_id) where intake_session_id is not null;
create index if not exists payment_requests_customer_idx
  on public.payment_requests(customer_id) where customer_id is not null;

alter table public.payment_requests enable row level security;

drop policy if exists "permissioned staff can view payment requests" on public.payment_requests;
create policy "permissioned staff can view payment requests"
on public.payment_requests for select to authenticated
using (
  location_id = public.current_location_id()
  and (
    coalesce(public.has_permission('repairs.view'),false)
    or coalesce(public.has_permission('ready_pickup.checkout'),false)
    or coalesce(public.has_permission('reports.view'),false)
    or coalesce(public.has_permission('settings.manage'),false)
  )
);

-- Writes are intentionally RPC/server-only. A browser cannot forge a verified payment
-- by inserting or updating payment_requests directly.
revoke insert, update, delete on public.payment_requests from anon, authenticated;
grant select on public.payment_requests to authenticated;

alter table public.repair_tickets
  add column if not exists prepay_required boolean,
  add column if not exists payment_request_id uuid references public.payment_requests(id) on delete set null;

create unique index if not exists repair_tickets_payment_request_unique_idx
  on public.repair_tickets(payment_request_id) where payment_request_id is not null;
create index if not exists repair_tickets_payment_confirmed_by_idx
  on public.repair_tickets(payment_confirmed_by) where payment_confirmed_by is not null;

-- Existing work orders predate the prepay policy and must remain operable.
update public.repair_tickets
set prepay_required = false
where prepay_required is null;

create or replace function public.payment_method_enabled(method_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case method_key
    when 'cash' then coalesce(bs.payments_cash_enabled,true)
    when 'external_pos_card' then coalesce(bs.payments_external_card_enabled,true)
    when 'external_pos_other' then coalesce(bs.payments_external_other_enabled,true)
    when 'cash_app' then coalesce(bs.payments_cash_app_enabled,true)
    when 'zelle' then coalesce(bs.payments_zelle_enabled,true)
    when 'chime' then coalesce(bs.payments_chime_enabled,true)
    when 'paypal' then coalesce(bs.payments_paypal_enabled,false)
    else false
  end
  from public.business_settings bs
  where bs.location_id = public.current_location_id()
  limit 1;
$$;

create or replace function public.get_payment_configuration()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare cfg public.business_settings;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into cfg from public.business_settings where location_id = public.current_location_id();
  if cfg.location_id is null then raise exception 'Business settings are not configured'; end if;
  return jsonb_build_object(
    'prepay_required', cfg.prepay_required_default,
    'routing_mode', cfg.payment_routing_mode,
    'methods', jsonb_build_object(
      'cash', cfg.payments_cash_enabled,
      'external_pos_card', cfg.payments_external_card_enabled,
      'external_pos_other', cfg.payments_external_other_enabled,
      'cash_app', cfg.payments_cash_app_enabled,
      'zelle', cfg.payments_zelle_enabled,
      'chime', cfg.payments_chime_enabled,
      'paypal', cfg.payments_paypal_enabled
    ),
    'paypal_automatic_verification', cfg.paypal_automatic_verification_enabled
  );
end;
$$;

create or replace function public.save_payment_configuration(
  required_default boolean,
  routing_mode text,
  cash_enabled boolean,
  external_card_enabled boolean,
  external_other_enabled boolean,
  cash_app_enabled boolean,
  zelle_enabled boolean,
  chime_enabled boolean,
  paypal_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare role_name text; loc uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  role_name := public.current_staff_role();
  if role_name not in ('owner','manager') or not coalesce(public.has_permission('settings.manage'),false) then
    raise exception 'Management permission is required to change payment settings';
  end if;
  if routing_mode not in ('internal','external','hybrid') then raise exception 'Choose a valid payment routing mode'; end if;
  loc := public.current_location_id();
  update public.business_settings set
    prepay_required_default = coalesce(required_default,true),
    payment_routing_mode = routing_mode,
    payments_cash_enabled = coalesce(cash_enabled,false),
    payments_external_card_enabled = coalesce(external_card_enabled,false),
    payments_external_other_enabled = coalesce(external_other_enabled,false),
    payments_cash_app_enabled = coalesce(cash_app_enabled,false),
    payments_zelle_enabled = coalesce(zelle_enabled,false),
    payments_chime_enabled = coalesce(chime_enabled,false),
    payments_paypal_enabled = coalesce(paypal_enabled,false),
    updated_at = now()
  where location_id = loc;
  return public.get_payment_configuration();
end;
$$;

create or replace function public.record_manual_prepayment(
  paid_amount_cents integer,
  paid_method text,
  paid_reference text default null,
  payment_note text default null
)
returns public.payment_requests
language plpgsql
security definer
set search_path = public
as $$
declare saved public.payment_requests; loc uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not coalesce(public.has_permission('repairs.intake'),false) then
    raise exception 'You do not have permission to take repair intake payments';
  end if;
  if paid_method not in ('cash','external_pos_card','external_pos_other','cash_app','zelle','chime') then
    raise exception 'This payment method requires automatic provider verification';
  end if;
  if coalesce(paid_amount_cents,0) <= 0 then raise exception 'Enter the amount received'; end if;
  if not public.payment_method_enabled(paid_method) then raise exception 'That payment method is disabled'; end if;
  if paid_method in ('external_pos_card','external_pos_other','cash_app','zelle','chime')
     and nullif(btrim(coalesce(paid_reference,'')),'') is null then
    raise exception 'A transaction or confirmation reference is required for this payment method';
  end if;
  loc := public.current_location_id();
  insert into public.payment_requests(
    location_id,purpose,amount_due_cents,amount_verified_cents,currency_code,
    payment_method,provider,verification_mode,status,payment_reference,note,
    requested_by,verified_by,verified_at
  ) values (
    loc,'repair_prepay',paid_amount_cents,paid_amount_cents,'USD',paid_method,
    case when paid_method in ('cash_app','zelle','chime') then paid_method else 'external_pos' end,
    'manual_staff','verified',nullif(btrim(coalesce(paid_reference,'')),''),
    nullif(btrim(coalesce(payment_note,'')),''),auth.uid(),auth.uid(),now()
  ) returning * into saved;
  return saved;
end;
$$;

create or replace function public.create_provider_payment_request(
  requested_amount_cents integer,
  requested_method text,
  payment_note text default null
)
returns public.payment_requests
language plpgsql
security definer
set search_path = public
as $$
declare saved public.payment_requests; cfg jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not coalesce(public.has_permission('repairs.intake'),false) then
    raise exception 'You do not have permission to create repair payment requests';
  end if;
  if requested_method <> 'paypal' then raise exception 'This method does not use automatic provider verification'; end if;
  if coalesce(requested_amount_cents,0) <= 0 then raise exception 'Enter the amount due'; end if;
  cfg := public.get_payment_configuration();
  if not coalesce((cfg->'methods'->>'paypal')::boolean,false) then raise exception 'PayPal is not enabled'; end if;
  if not coalesce((cfg->>'paypal_automatic_verification')::boolean,false) then
    raise exception 'PayPal automatic verification is not connected yet';
  end if;
  insert into public.payment_requests(
    location_id,purpose,amount_due_cents,currency_code,payment_method,provider,
    verification_mode,status,note,requested_by
  ) values (
    public.current_location_id(),'repair_prepay',requested_amount_cents,'USD','paypal','paypal',
    'provider_callback','pending',nullif(btrim(coalesce(payment_note,'')),''),auth.uid()
  ) returning * into saved;
  return saved;
end;
$$;

create or replace function public.guard_new_work_order_prepayment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare required_now boolean := true; paid public.payment_requests;
begin
  -- Trusted server/service-role jobs have no auth.uid() and are allowed to perform
  -- controlled imports. Browser staff creation is always subject to the policy.
  if auth.uid() is null then return new; end if;

  select coalesce(prepay_required_default,true) into required_now
  from public.business_settings where location_id = new.location_id;
  new.prepay_required := required_now;
  if not required_now then return new; end if;

  if new.payment_request_id is null then
    raise exception 'Pre-payment is required before a work order can be created';
  end if;

  select * into paid from public.payment_requests
  where id = new.payment_request_id
    and location_id = new.location_id
    and status = 'verified'
    and amount_verified_cents >= amount_due_cents
    and ticket_id is null
  for update;

  if paid.id is null then
    raise exception 'The selected pre-payment has not been verified or has already been used';
  end if;
  return new;
end;
$$;

drop trigger if exists repair_ticket_prepayment_guard on public.repair_tickets;
create trigger repair_ticket_prepayment_guard
before insert on public.repair_tickets
for each row execute function public.guard_new_work_order_prepayment();

create or replace function public.link_payment_request_to_ticket()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.payment_request_id is not null then
    update public.payment_requests
    set ticket_id = new.id,
        customer_id = coalesce(customer_id,new.customer_id),
        lead_id = coalesce(lead_id,new.lead_id),
        intake_session_id = coalesce(intake_session_id,new.intake_session_id),
        updated_at = now()
    where id = new.payment_request_id and location_id = new.location_id and ticket_id is null;
  end if;
  return new;
end;
$$;

drop trigger if exists repair_ticket_payment_link on public.repair_tickets;
create trigger repair_ticket_payment_link
after insert on public.repair_tickets
for each row execute function public.link_payment_request_to_ticket();

revoke all on function public.payment_method_enabled(text) from public, anon;
revoke all on function public.get_payment_configuration() from public, anon;
revoke all on function public.save_payment_configuration(boolean,text,boolean,boolean,boolean,boolean,boolean,boolean,boolean) from public, anon;
revoke all on function public.record_manual_prepayment(integer,text,text,text) from public, anon;
revoke all on function public.create_provider_payment_request(integer,text,text) from public, anon;
grant execute on function public.get_payment_configuration() to authenticated;
grant execute on function public.save_payment_configuration(boolean,text,boolean,boolean,boolean,boolean,boolean,boolean,boolean) to authenticated;
grant execute on function public.record_manual_prepayment(integer,text,text,text) to authenticated;
grant execute on function public.create_provider_payment_request(integer,text,text) to authenticated;
