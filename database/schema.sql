-- GotCracked Portal: initial PostgreSQL data model
-- This is intentionally vendor-neutral; apply it through Prisma/Drizzle migrations later.

create type user_role as enum ('owner', 'manager', 'technician', 'front_desk');
create type ticket_status as enum ('checked_in', 'in_diagnosis', 'awaiting_approval', 'waiting_on_parts', 'in_repair', 'ready_for_pickup', 'completed', 'cancelled');
create type appointment_status as enum ('scheduled', 'confirmed', 'arrived', 'no_show', 'cancelled', 'completed');
create type payment_status as enum ('unpaid', 'deposit_paid', 'paid', 'refunded', 'voided');

create table locations (
  id uuid primary key,
  name text not null,
  phone text,
  address_line_1 text,
  city text,
  state text,
  postal_code text,
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key,
  location_id uuid references locations(id),
  name text not null,
  email text not null unique,
  role user_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table customers (
  id uuid primary key,
  location_id uuid not null references locations(id),
  first_name text not null,
  last_name text not null,
  phone text not null,
  email text,
  preferred_contact text check (preferred_contact in ('sms', 'email', 'phone')) default 'sms',
  notes text,
  created_at timestamptz not null default now(),
  unique(location_id, phone)
);

create table devices (
  id uuid primary key,
  customer_id uuid not null references customers(id),
  category text not null,
  manufacturer text,
  model text not null,
  color text,
  serial_number text,
  imei text,
  passcode_supplied boolean not null default false,
  created_at timestamptz not null default now()
);

create table repair_tickets (
  id uuid primary key,
  ticket_number text not null unique,
  location_id uuid not null references locations(id),
  customer_id uuid not null references customers(id),
  device_id uuid not null references devices(id),
  assigned_user_id uuid references users(id),
  status ticket_status not null default 'checked_in',
  customer_issue text not null,
  diagnosis text,
  estimate_cents integer,
  approved_at timestamptz,
  promised_at timestamptz,
  checked_in_at timestamptz not null default now(),
  completed_at timestamptz,
  pickup_at timestamptz,
  payment_status payment_status not null default 'unpaid',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ticket_events (
  id uuid primary key,
  ticket_id uuid not null references repair_tickets(id) on delete cascade,
  actor_user_id uuid references users(id),
  event_type text not null,
  message text,
  created_at timestamptz not null default now()
);

create table appointments (
  id uuid primary key,
  location_id uuid not null references locations(id),
  customer_id uuid references customers(id),
  device_description text,
  service_requested text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status appointment_status not null default 'scheduled',
  notes text,
  created_at timestamptz not null default now()
);

create table inventory_items (
  id uuid primary key,
  location_id uuid not null references locations(id),
  sku text,
  name text not null,
  compatible_models text,
  quantity_on_hand integer not null default 0 check (quantity_on_hand >= 0),
  reorder_point integer not null default 0 check (reorder_point >= 0),
  cost_cents integer,
  sell_price_cents integer,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(location_id, sku)
);

create table ticket_parts (
  id uuid primary key,
  ticket_id uuid not null references repair_tickets(id) on delete cascade,
  inventory_item_id uuid not null references inventory_items(id),
  quantity integer not null check (quantity > 0),
  reserved_at timestamptz not null default now(),
  used_at timestamptz
);

create index repair_tickets_location_status_idx on repair_tickets(location_id, status);
create index repair_tickets_customer_idx on repair_tickets(customer_id);
create index appointments_location_starts_at_idx on appointments(location_id, starts_at);
create index ticket_events_ticket_created_at_idx on ticket_events(ticket_id, created_at);
