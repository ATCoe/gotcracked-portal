-- GotCracked Portal production foundation for Supabase/PostgreSQL.
-- Run this migration in a new Supabase project. All portal tables use Row Level Security.

create type public.staff_role as enum ('owner', 'manager', 'technician', 'front_desk');
create type public.ticket_status as enum ('checked_in', 'in_diagnosis', 'awaiting_approval', 'waiting_on_parts', 'in_repair', 'ready_for_pickup', 'completed', 'cancelled');
create type public.appointment_status as enum ('scheduled', 'confirmed', 'arrived', 'no_show', 'cancelled', 'completed');

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  location_id uuid references public.locations(id),
  display_name text not null,
  role public.staff_role not null default 'front_desk',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  first_name text not null,
  last_name text not null,
  phone text not null,
  email text,
  preferred_contact text not null default 'sms' check (preferred_contact in ('sms', 'email', 'phone')),
  notes text,
  created_at timestamptz not null default now(),
  unique (location_id, phone)
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  category text not null,
  manufacturer text,
  model text not null,
  color text,
  serial_number text,
  imei text,
  created_at timestamptz not null default now()
);

create table public.repair_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number bigint generated always as identity unique,
  location_id uuid not null references public.locations(id),
  customer_id uuid not null references public.customers(id),
  device_id uuid not null references public.devices(id),
  assigned_user_id uuid references public.profiles(id),
  status public.ticket_status not null default 'checked_in',
  customer_issue text not null,
  diagnosis text,
  estimate_cents integer check (estimate_cents >= 0),
  approved_at timestamptz,
  promised_at timestamptz,
  checked_in_at timestamptz not null default now(),
  completed_at timestamptz,
  pickup_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.repair_tickets(id) on delete cascade,
  actor_user_id uuid references public.profiles(id),
  event_type text not null,
  message text,
  created_at timestamptz not null default now()
);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  sku text,
  name text not null,
  quantity_on_hand integer not null default 0 check (quantity_on_hand >= 0),
  reorder_point integer not null default 0 check (reorder_point >= 0),
  cost_cents integer check (cost_cents >= 0),
  sell_price_cents integer check (sell_price_cents >= 0),
  active boolean not null default true,
  unique (location_id, sku)
);

create index repair_tickets_location_status_idx on public.repair_tickets(location_id, status);
create index repair_tickets_customer_idx on public.repair_tickets(customer_id);
create index ticket_events_ticket_created_idx on public.ticket_events(ticket_id, created_at);

alter table public.locations enable row level security;
alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.devices enable row level security;
alter table public.repair_tickets enable row level security;
alter table public.ticket_events enable row level security;
alter table public.inventory_items enable row level security;

-- Signed-in staff can access only the location stored on their profile.
create function public.current_location_id() returns uuid language sql stable security definer set search_path = public as
  $$ select location_id from public.profiles where id = auth.uid() and active = true $$;

create policy "staff can read their profile" on public.profiles for select to authenticated using (id = auth.uid());
create policy "staff can read their location" on public.locations for select to authenticated using (id = public.current_location_id());
create policy "staff can view customers at their location" on public.customers for select to authenticated using (location_id = public.current_location_id());
create policy "staff can add customers at their location" on public.customers for insert to authenticated with check (location_id = public.current_location_id());
create policy "staff can update customers at their location" on public.customers for update to authenticated using (location_id = public.current_location_id()) with check (location_id = public.current_location_id());
create policy "staff can view devices for location customers" on public.devices for select to authenticated using (exists (select 1 from public.customers c where c.id = customer_id and c.location_id = public.current_location_id()));
create policy "staff can add devices for location customers" on public.devices for insert to authenticated with check (exists (select 1 from public.customers c where c.id = customer_id and c.location_id = public.current_location_id()));
create policy "staff can view tickets at their location" on public.repair_tickets for select to authenticated using (location_id = public.current_location_id());
create policy "staff can add tickets at their location" on public.repair_tickets for insert to authenticated with check (location_id = public.current_location_id());
create policy "staff can update tickets at their location" on public.repair_tickets for update to authenticated using (location_id = public.current_location_id()) with check (location_id = public.current_location_id());
create policy "staff can view ticket events" on public.ticket_events for select to authenticated using (exists (select 1 from public.repair_tickets t where t.id = ticket_id and t.location_id = public.current_location_id()));
create policy "staff can add ticket events" on public.ticket_events for insert to authenticated with check (exists (select 1 from public.repair_tickets t where t.id = ticket_id and t.location_id = public.current_location_id()));
create policy "staff can view inventory at their location" on public.inventory_items for select to authenticated using (location_id = public.current_location_id());
create policy "managers can edit inventory" on public.inventory_items for all to authenticated using (location_id = public.current_location_id() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner', 'manager'))) with check (location_id = public.current_location_id() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner', 'manager')));

-- Keep an audit timeline without allowing application code to forge it.
create function public.set_ticket_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

create function public.record_ticket_event() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.ticket_events(ticket_id, actor_user_id, event_type, message) values (new.id, auth.uid(), 'created', 'Ticket checked in');
  elsif new.status is distinct from old.status then
    insert into public.ticket_events(ticket_id, actor_user_id, event_type, message) values (new.id, auth.uid(), 'status_changed', 'Status changed from ' || old.status || ' to ' || new.status);
  end if;
  return new;
end; $$;

create trigger repair_ticket_touch before update on public.repair_tickets for each row execute function public.set_ticket_updated_at();
create trigger repair_ticket_audit after insert or update on public.repair_tickets for each row execute function public.record_ticket_event();
