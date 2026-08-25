-- GotCracked Portal 1.0 operations upgrade
-- Additive migration for the live Supabase/PostgreSQL database.
-- Introduces guided intake, repair reference, lead pipeline, permissions,
-- purchase-order receiving, and DYMO label-aware inventory workflows.

-- ---------------------------------------------------------------------------
-- 1. Existing records: richer customer/device/work-order metadata
-- ---------------------------------------------------------------------------

alter table if exists public.customers add column if not exists contact_phone text;
alter table if exists public.customers add column if not exists address_line_1 text;
alter table if exists public.customers add column if not exists address_line_2 text;
alter table if exists public.customers add column if not exists city text;
alter table if exists public.customers add column if not exists state text;
alter table if exists public.customers add column if not exists postal_code text;
alter table if exists public.customers add column if not exists phone_normalized text;

update public.customers
set phone_normalized = regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')
where phone_normalized is null;

create index if not exists customers_location_phone_normalized_idx
  on public.customers(location_id, phone_normalized);
create index if not exists customers_location_email_lower_idx
  on public.customers(location_id, lower(email));

alter table if exists public.devices add column if not exists storage_size text;
alter table if exists public.devices add column if not exists device_condition text;
alter table if exists public.devices add column if not exists model_number text;
alter table if exists public.devices add column if not exists device_image_key text;
alter table if exists public.devices add column if not exists accessories jsonb not null default '[]'::jsonb;
alter table if exists public.devices add column if not exists last_seen_at timestamptz;
alter table if exists public.devices add column if not exists device_notes text;

-- Add the pre-arrival work-order stage to the existing enum when present.
do $$
begin
  if exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'ticket_status'
  ) then
    alter type public.ticket_status add value if not exists 'awaiting_customer';
  end if;
end $$;

alter table if exists public.repair_tickets add column if not exists lead_id uuid;
alter table if exists public.repair_tickets add column if not exists intake_session_id uuid;
alter table if exists public.repair_tickets add column if not exists intake_summary text;
alter table if exists public.repair_tickets add column if not exists arrived_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Lead pipeline. Keep legacy status for compatibility with existing bot/UI.
--    pipeline_status is the canonical 1.0 operational stage.
-- ---------------------------------------------------------------------------

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references public.locations(id),
  name text not null,
  phone text,
  email text,
  service text,
  source text,
  status text not null default 'new',
  assigned_user_id uuid references public.profiles(id),
  intake_method text,
  shipping_address jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.leads add column if not exists pipeline_status text not null default 'need_to_contact';
alter table public.leads add column if not exists contact_attempted_at timestamptz;
alter table public.leads add column if not exists last_contact_note text;
alter table public.leads add column if not exists customer_id uuid references public.customers(id);
alter table public.leads add column if not exists device_id uuid references public.devices(id);
alter table public.leads add column if not exists converted_ticket_id uuid references public.repair_tickets(id);
alter table public.leads add column if not exists appointment_id uuid;
alter table public.leads add column if not exists device_category text;
alter table public.leads add column if not exists manufacturer text;
alter table public.leads add column if not exists model text;
alter table public.leads add column if not exists customer_issue text;
alter table public.leads add column if not exists device_details jsonb not null default '{}'::jsonb;
alter table public.leads add column if not exists expected_arrival_at timestamptz;
alter table public.leads add column if not exists updated_at timestamptz not null default now();

update public.leads
set pipeline_status = case
  when status = 'won' then 'converted'
  when status = 'lost' then 'lost'
  when status in ('claimed','qualified') then 'awaiting_customer'
  else 'need_to_contact'
end
where pipeline_status = 'need_to_contact' and status <> 'new';

create index if not exists leads_pipeline_status_idx on public.leads(pipeline_status, created_at desc);
create index if not exists leads_contact_idx on public.leads(contact_attempted_at);

create table if not exists public.lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  actor_user_id uuid references public.profiles(id),
  event_type text not null,
  message text,
  created_at timestamptz not null default now()
);
create index if not exists lead_events_lead_created_idx on public.lead_events(lead_id, created_at);

-- ---------------------------------------------------------------------------
-- 3. Guided intake templates and completed intake sessions
-- ---------------------------------------------------------------------------

create table if not exists public.intake_templates (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references public.locations(id) on delete cascade,
  device_category text not null,
  manufacturer text,
  model_pattern text,
  name text not null,
  version integer not null default 1,
  checklist jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists intake_templates_lookup_idx
  on public.intake_templates(device_category, manufacturer, active);

create table if not exists public.intake_sessions (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  customer_id uuid not null references public.customers(id),
  device_id uuid not null references public.devices(id),
  lead_id uuid,
  ticket_id uuid references public.repair_tickets(id) on delete set null,
  intake_method text not null default 'walk_in',
  customer_complaint text not null,
  visual_findings jsonb not null default '{}'::jsonb,
  functional_findings jsonb not null default '{}'::jsonb,
  generated_summary text,
  completed_by uuid references public.profiles(id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists intake_sessions_customer_idx on public.intake_sessions(customer_id, created_at desc);
create index if not exists intake_sessions_device_idx on public.intake_sessions(device_id, created_at desc);
create index if not exists intake_sessions_ticket_idx on public.intake_sessions(ticket_id);

-- ---------------------------------------------------------------------------
-- 4. Internal repair knowledge base and deterministic suggestion rules
-- ---------------------------------------------------------------------------

create table if not exists public.repair_guides (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references public.locations(id) on delete cascade,
  slug text not null,
  device_category text not null,
  manufacturer text,
  model_family text,
  symptom text not null,
  title text not null,
  summary text,
  intake_questions jsonb not null default '[]'::jsonb,
  diagnostic_steps jsonb not null default '[]'::jsonb,
  likely_causes jsonb not null default '[]'::jsonb,
  tools_notes text,
  parts_notes text,
  cautions text,
  tags text[] not null default '{}',
  difficulty text,
  bench_time_minutes integer,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(location_id, slug)
);
create index if not exists repair_guides_search_idx on public.repair_guides(device_category, manufacturer, active);
create index if not exists repair_guides_tags_idx on public.repair_guides using gin(tags);

create table if not exists public.repair_suggestion_rules (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references public.repair_guides(id) on delete cascade,
  device_category text not null,
  manufacturer text,
  model_family text,
  required_findings jsonb not null default '{}'::jsonb,
  score integer not null default 50 check (score between 0 and 100),
  suggested_service_sku text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists repair_suggestion_rules_category_idx
  on public.repair_suggestion_rules(device_category, manufacturer, active);

-- ---------------------------------------------------------------------------
-- 5. Role defaults plus per-user permission overrides
-- ---------------------------------------------------------------------------

create table if not exists public.permission_definitions (
  permission_key text primary key,
  label text not null,
  group_name text not null,
  description text
);

insert into public.permission_definitions(permission_key,label,group_name,description) values
  ('dashboard.view','View dashboard','General','View operational dashboard tables and metrics.'),
  ('repairs.view','View work orders','Repairs','Search and open work orders.'),
  ('repairs.intake','Create intake / work orders','Repairs','Run Walk-In intake and create work orders.'),
  ('repairs.workflow','Update repair workflow','Repairs','Change repair status, assignments, notes and diagnostics.'),
  ('ready_pickup.view','View ready-for-pickup queue','Front counter','View completed devices awaiting pickup.'),
  ('ready_pickup.checkout','Checkout ready devices','Front counter','Confirm payment and complete customer pickup.'),
  ('leads.view','View leads','Leads','Search and open lead records.'),
  ('leads.manage','Contact and advance leads','Leads','Record contact attempts and move lead stages.'),
  ('customers.view','View customers','Customers','View customer contact and device history.'),
  ('customers.edit','Edit customers','Customers','Create and update customer profiles.'),
  ('inventory.view','View inventory','Inventory','Search parts and see stock levels.'),
  ('inventory.manage','Manage inventory','Inventory','Add/edit parts and adjust stock.'),
  ('inventory.count','Perform inventory counts','Inventory','Run physical inventory counts and reconcile stock.'),
  ('purchasing.view','View purchase orders','Purchasing','View supplier purchase orders.'),
  ('purchasing.manage','Manage purchase orders','Purchasing','Create POs, receive items and update costs.'),
  ('reference.view','View repair reference','Knowledge','Search internal repair guides.'),
  ('reference.manage','Manage repair reference','Knowledge','Create and edit internal repair guides/templates.'),
  ('reports.view','View reports','Management','View shop financial and operational reporting.'),
  ('staff.manage','Manage staff access','Management','Change roles and per-user permission overrides.'),
  ('settings.manage','Manage settings','Management','Change shop, pricing and operational settings.'),
  ('pricing.override','Override prices / discounts','Management','Override catalog pricing and apply manual discounts.'),
  ('labels.work_order','Print work-order labels','Labels','Print device/work-order barcode labels.'),
  ('labels.inventory','Print inventory labels','Labels','Print part SKU and receiving labels.')
on conflict (permission_key) do update set
  label = excluded.label,
  group_name = excluded.group_name,
  description = excluded.description;

create table if not exists public.staff_permission_overrides (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  permission_key text not null references public.permission_definitions(permission_key) on delete cascade,
  enabled boolean not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key(profile_id, permission_key)
);

create or replace function public.role_default_permission(target_role public.staff_role, permission_key text)
returns boolean
language sql immutable
as $$
  select case
    when target_role = 'owner' then true
    when target_role = 'manager' then permission_key = any(array[
      'dashboard.view','repairs.view','repairs.intake','repairs.workflow',
      'ready_pickup.view','ready_pickup.checkout','leads.view','leads.manage',
      'customers.view','customers.edit','inventory.view','inventory.manage','inventory.count',
      'purchasing.view','purchasing.manage','reference.view','reference.manage',
      'reports.view','staff.manage','settings.manage','pricing.override',
      'labels.work_order','labels.inventory'
    ])
    when target_role = 'technician' then permission_key = any(array[
      'dashboard.view','repairs.view','repairs.intake','repairs.workflow',
      'ready_pickup.view','leads.view','leads.manage','customers.view',
      'inventory.view','reference.view','labels.work_order'
    ])
    when target_role = 'front_desk' then permission_key = any(array[
      'dashboard.view','repairs.view','repairs.intake','ready_pickup.view','ready_pickup.checkout',
      'leads.view','leads.manage','customers.view','customers.edit','inventory.view',
      'reference.view','labels.work_order'
    ])
    else false
  end;
$$;

create or replace function public.current_staff_role()
returns public.staff_role
language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() and active = true $$;

create or replace function public.has_permission(permission_key text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    case when p.role = 'owner' then true else o.enabled end,
    public.role_default_permission(p.role, permission_key),
    false
  )
  from public.profiles p
  left join public.staff_permission_overrides o
    on o.profile_id = p.id and o.permission_key = permission_key
  where p.id = auth.uid() and p.active = true;
$$;

revoke all on function public.current_staff_role() from public;
revoke all on function public.has_permission(text) from public;
grant execute on function public.current_staff_role() to authenticated;
grant execute on function public.has_permission(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Purchase orders and receiving
-- ---------------------------------------------------------------------------

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number bigint generated always as identity unique,
  location_id uuid not null references public.locations(id),
  supplier_id uuid,
  supplier_name text not null,
  external_order_number text,
  status text not null default 'draft' check (status in ('draft','ordered','partial','received','cancelled')),
  ordered_at timestamptz,
  received_at timestamptz,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists purchase_orders_location_status_idx
  on public.purchase_orders(location_id, status, created_at desc);

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id),
  supplier_sku text,
  description text not null,
  quantity_ordered integer not null check (quantity_ordered > 0),
  quantity_received integer not null default 0 check (quantity_received >= 0),
  unit_cost_cents integer check (unit_cost_cents >= 0),
  label_printed_qty integer not null default 0 check (label_printed_qty >= 0),
  created_at timestamptz not null default now()
);
create index if not exists purchase_order_items_po_idx on public.purchase_order_items(purchase_order_id);

-- Track damaged work-order parts without double-decrementing stock already consumed.
alter table if exists public.work_order_items add column if not exists damaged boolean not null default false;
alter table if exists public.work_order_items add column if not exists damaged_at timestamptz;
alter table if exists public.work_order_items add column if not exists damaged_by uuid;
alter table if exists public.work_order_items add column if not exists damage_note text;

create table if not exists public.work_order_item_events (
  id uuid primary key default gen_random_uuid(),
  work_order_item_id uuid not null,
  ticket_id uuid references public.repair_tickets(id) on delete cascade,
  actor_user_id uuid references public.profiles(id),
  event_type text not null,
  note text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 7. RLS for new 1.0 tables + tighter baseline permissions where possible
-- ---------------------------------------------------------------------------

alter table public.permission_definitions enable row level security;
alter table public.staff_permission_overrides enable row level security;
alter table public.intake_templates enable row level security;
alter table public.intake_sessions enable row level security;
alter table public.repair_guides enable row level security;
alter table public.repair_suggestion_rules enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.work_order_item_events enable row level security;
alter table public.leads enable row level security;
alter table public.lead_events enable row level security;

create policy "authenticated staff can read permission definitions"
  on public.permission_definitions for select to authenticated using (true);
create policy "staff can read own or managed permission overrides"
  on public.staff_permission_overrides for select to authenticated
  using (profile_id = auth.uid() or public.has_permission('staff.manage'));
create policy "management can insert permission overrides"
  on public.staff_permission_overrides for insert to authenticated
  with check (public.has_permission('staff.manage'));
create policy "management can update permission overrides"
  on public.staff_permission_overrides for update to authenticated
  using (public.has_permission('staff.manage')) with check (public.has_permission('staff.manage'));
create policy "management can delete permission overrides"
  on public.staff_permission_overrides for delete to authenticated
  using (public.has_permission('staff.manage'));

create policy "staff can read intake templates"
  on public.intake_templates for select to authenticated using (active = true and (location_id is null or location_id = public.current_location_id()));
create policy "management can manage intake templates"
  on public.intake_templates for all to authenticated
  using (public.has_permission('reference.manage') and (location_id is null or location_id = public.current_location_id()))
  with check (public.has_permission('reference.manage') and (location_id is null or location_id = public.current_location_id()));

create policy "staff can read intake sessions"
  on public.intake_sessions for select to authenticated
  using (location_id = public.current_location_id() and public.has_permission('repairs.view'));
create policy "staff can create intake sessions"
  on public.intake_sessions for insert to authenticated
  with check (location_id = public.current_location_id() and public.has_permission('repairs.intake'));
create policy "staff can update intake sessions"
  on public.intake_sessions for update to authenticated
  using (location_id = public.current_location_id() and public.has_permission('repairs.intake'))
  with check (location_id = public.current_location_id() and public.has_permission('repairs.intake'));

create policy "staff can read repair guides"
  on public.repair_guides for select to authenticated
  using (active = true and public.has_permission('reference.view') and (location_id is null or location_id = public.current_location_id()));
create policy "management can manage repair guides"
  on public.repair_guides for all to authenticated
  using (public.has_permission('reference.manage') and (location_id is null or location_id = public.current_location_id()))
  with check (public.has_permission('reference.manage') and (location_id is null or location_id = public.current_location_id()));
create policy "staff can read suggestion rules"
  on public.repair_suggestion_rules for select to authenticated
  using (public.has_permission('reference.view'));
create policy "management can manage suggestion rules"
  on public.repair_suggestion_rules for all to authenticated
  using (public.has_permission('reference.manage')) with check (public.has_permission('reference.manage'));

create policy "staff with lead access can view leads"
  on public.leads for select to authenticated
  using ((location_id is null or location_id = public.current_location_id()) and public.has_permission('leads.view'));
create policy "staff with lead access can create leads"
  on public.leads for insert to authenticated
  with check ((location_id is null or location_id = public.current_location_id()) and public.has_permission('leads.manage'));
create policy "staff with lead access can update leads"
  on public.leads for update to authenticated
  using ((location_id is null or location_id = public.current_location_id()) and public.has_permission('leads.manage'))
  with check ((location_id is null or location_id = public.current_location_id()) and public.has_permission('leads.manage'));
create policy "staff can read lead events"
  on public.lead_events for select to authenticated
  using (public.has_permission('leads.view') and exists (
    select 1 from public.leads l where l.id = lead_id and (l.location_id is null or l.location_id = public.current_location_id())
  ));
create policy "staff can add lead events"
  on public.lead_events for insert to authenticated
  with check (public.has_permission('leads.manage') and exists (
    select 1 from public.leads l where l.id = lead_id and (l.location_id is null or l.location_id = public.current_location_id())
  ));

create policy "management can view purchase orders"
  on public.purchase_orders for select to authenticated
  using (location_id = public.current_location_id() and public.has_permission('purchasing.view'));
create policy "management can manage purchase orders"
  on public.purchase_orders for all to authenticated
  using (location_id = public.current_location_id() and public.has_permission('purchasing.manage'))
  with check (location_id = public.current_location_id() and public.has_permission('purchasing.manage'));
create policy "management can view purchase order items"
  on public.purchase_order_items for select to authenticated
  using (public.has_permission('purchasing.view') and exists (
    select 1 from public.purchase_orders po where po.id = purchase_order_id and po.location_id = public.current_location_id()
  ));
create policy "management can manage purchase order items"
  on public.purchase_order_items for all to authenticated
  using (public.has_permission('purchasing.manage') and exists (
    select 1 from public.purchase_orders po where po.id = purchase_order_id and po.location_id = public.current_location_id()
  )) with check (public.has_permission('purchasing.manage') and exists (
    select 1 from public.purchase_orders po where po.id = purchase_order_id and po.location_id = public.current_location_id()
  ));

create policy "staff can read work order item events"
  on public.work_order_item_events for select to authenticated
  using (public.has_permission('repairs.view'));
create policy "repair staff can add work order item events"
  on public.work_order_item_events for insert to authenticated
  with check (public.has_permission('repairs.workflow'));

-- Replace the broad baseline inventory/ticket mutation policies where they exist.
drop policy if exists "managers can edit inventory" on public.inventory_items;
create policy "permissioned staff can edit inventory"
  on public.inventory_items for all to authenticated
  using (location_id = public.current_location_id() and public.has_permission('inventory.manage'))
  with check (location_id = public.current_location_id() and public.has_permission('inventory.manage'));

-- ---------------------------------------------------------------------------
-- 8. RPCs that enforce workflow requirements server-side
-- ---------------------------------------------------------------------------

create or replace function public.advance_lead_status(
  target_lead uuid,
  next_status text,
  update_note text,
  contact_attempt boolean default false
) returns public.leads
language plpgsql security definer set search_path = public as $$
declare
  current_lead public.leads;
  legacy_status text;
begin
  if not public.has_permission('leads.manage') then
    raise exception 'You do not have permission to update leads.';
  end if;

  if next_status not in ('need_to_contact','awaiting_customer','awaiting_device','need_to_order_part','awaiting_parts','converted','lost') then
    raise exception 'Invalid lead stage.';
  end if;

  select * into current_lead from public.leads
  where id = target_lead and (location_id is null or location_id = public.current_location_id())
  for update;

  if not found then raise exception 'Lead not found.'; end if;
  if nullif(trim(update_note), '') is null then raise exception 'A lead activity note is required.'; end if;

  if current_lead.pipeline_status = 'need_to_contact'
     and next_status <> 'need_to_contact'
     and current_lead.contact_attempted_at is null
     and not contact_attempt then
    raise exception 'Record a customer contact attempt before moving this lead forward.';
  end if;

  legacy_status := case
    when next_status = 'converted' then 'won'
    when next_status = 'lost' then 'lost'
    when next_status = 'need_to_contact' then 'new'
    else 'qualified'
  end;

  update public.leads set
    pipeline_status = next_status,
    status = legacy_status,
    assigned_user_id = coalesce(assigned_user_id, auth.uid()),
    contact_attempted_at = case when contact_attempt then now() else contact_attempted_at end,
    last_contact_note = case when contact_attempt then trim(update_note) else last_contact_note end,
    updated_at = now()
  where id = target_lead
  returning * into current_lead;

  insert into public.lead_events(lead_id, actor_user_id, event_type, message)
  values (target_lead, auth.uid(), case when contact_attempt then 'contact_attempt' else 'status_changed' end, trim(update_note));

  return current_lead;
end; $$;

revoke all on function public.advance_lead_status(uuid,text,text,boolean) from public;
grant execute on function public.advance_lead_status(uuid,text,text,boolean) to authenticated;

create or replace function public.receive_purchase_order_item(
  target_item uuid,
  receive_quantity integer
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  line public.purchase_order_items;
  po public.purchase_orders;
  inv public.inventory_items;
  remaining integer;
  all_received boolean;
  any_received boolean;
begin
  if not public.has_permission('purchasing.manage') then
    raise exception 'You do not have permission to receive purchase orders.';
  end if;
  if receive_quantity <= 0 then raise exception 'Receive quantity must be positive.'; end if;

  select * into line from public.purchase_order_items where id = target_item for update;
  if not found then raise exception 'Purchase-order item not found.'; end if;
  select * into po from public.purchase_orders where id = line.purchase_order_id for update;
  if po.location_id <> public.current_location_id() then raise exception 'Purchase order not found.'; end if;

  remaining := line.quantity_ordered - line.quantity_received;
  if receive_quantity > remaining then raise exception 'Receive quantity exceeds the quantity still open.'; end if;

  update public.inventory_items
  set quantity_on_hand = quantity_on_hand + receive_quantity,
      cost_cents = coalesce(line.unit_cost_cents, cost_cents)
  where id = line.inventory_item_id
  returning * into inv;

  update public.purchase_order_items
  set quantity_received = quantity_received + receive_quantity
  where id = target_item;

  select bool_and(quantity_received >= quantity_ordered), bool_or(quantity_received > 0)
    into all_received, any_received
  from public.purchase_order_items where purchase_order_id = po.id;

  update public.purchase_orders set
    status = case when all_received then 'received' when any_received then 'partial' else status end,
    received_at = case when all_received then now() else received_at end,
    updated_at = now()
  where id = po.id;

  return jsonb_build_object(
    'inventory_item_id', inv.id,
    'name', inv.name,
    'sku', inv.sku,
    'quantity_received', receive_quantity,
    'quantity_on_hand', inv.quantity_on_hand,
    'sell_price_cents', inv.sell_price_cents
  );
end; $$;

revoke all on function public.receive_purchase_order_item(uuid,integer) from public;
grant execute on function public.receive_purchase_order_item(uuid,integer) to authenticated;

create or replace function public.mark_work_order_item_damaged(
  target_line uuid,
  damage_note text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  line record;
begin
  if not public.has_permission('repairs.workflow') then
    raise exception 'You do not have permission to update repair parts.';
  end if;
  if nullif(trim(damage_note), '') is null then raise exception 'A damage note is required.'; end if;

  select w.*, t.location_id into line
  from public.work_order_items w
  join public.repair_tickets t on t.id = w.ticket_id
  where w.id = target_line and t.location_id = public.current_location_id()
  for update;
  if not found then raise exception 'Work-order item not found.'; end if;
  if line.item_type <> 'part' then raise exception 'Only physical parts can be marked damaged.'; end if;

  update public.work_order_items set
    damaged = true,
    damaged_at = now(),
    damaged_by = auth.uid(),
    damage_note = trim(damage_note)
  where id = target_line;

  insert into public.work_order_item_events(work_order_item_id,ticket_id,actor_user_id,event_type,note)
  values(target_line,line.ticket_id,auth.uid(),'damaged',trim(damage_note));
end; $$;

revoke all on function public.mark_work_order_item_damaged(uuid,text) from public;
grant execute on function public.mark_work_order_item_damaged(uuid,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Seed category-specific FOH intake checklists
-- ---------------------------------------------------------------------------

insert into public.intake_templates(device_category,name,checklist) values
('Phone','Phone intake', '[
  {"group":"Visual inspection","items":["screen_glass","display_image","frame_condition","back_glass","camera_lenses","charging_port","liquid_signs","previous_repair"]},
  {"group":"Functional pre-check","items":["power","boot","touch","charging","buttons","cameras","speaker","microphone","biometrics","wifi_bluetooth","battery_symptoms"]}
]'::jsonb),
('Tablet','Tablet intake', '[
  {"group":"Visual inspection","items":["screen_glass","display_image","frame_condition","back_panel","camera_lenses","charging_port","liquid_signs","previous_repair"]},
  {"group":"Functional pre-check","items":["power","boot","touch","charging","buttons","cameras","speaker","microphone","wifi_bluetooth","battery_symptoms"]}
]'::jsonb),
('Laptop','Laptop intake', '[
  {"group":"Visual inspection","items":["display_panel","hinges","chassis","keyboard_condition","trackpad_condition","charging_port","other_ports","liquid_signs","previous_repair"]},
  {"group":"Functional pre-check","items":["power","post_boot","internal_display","external_display","keyboard","trackpad","charging","battery_symptoms","usb_ports","wifi","camera","speaker","fan_thermals","storage_symptoms"]}
]'::jsonb),
('Desktop','Desktop intake', '[
  {"group":"Visual inspection","items":["case_condition","ports","cables_received","liquid_signs","previous_repair"]},
  {"group":"Functional pre-check","items":["power","post_boot","display_output","fans","usb_ports","network","audio","storage_symptoms","thermal_symptoms"]}
]'::jsonb),
('Console','Console intake', '[
  {"group":"Visual inspection","items":["housing_condition","hdmi_port","usb_ports","power_port","disc_drive_condition","liquid_signs","previous_repair","missing_panels_screws"]},
  {"group":"Functional pre-check","items":["power","boot","display_output","hdmi_stability","usb_function","controller_pairing","disc_read","fan_noise","unexpected_shutdown","network"]}
]'::jsonb)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 10. Seed the first internal repair-reference entries.
--     These are staff-only reference records, not customer DIY content.
-- ---------------------------------------------------------------------------

insert into public.repair_guides(
  slug,device_category,symptom,title,summary,intake_questions,diagnostic_steps,likely_causes,tools_notes,parts_notes,cautions,tags,difficulty,bench_time_minutes
) values
('phone-cracked-display','Phone','Cracked glass / display / touch','Phone display damage','Use when glass, image quality, or touch behavior changed after impact.',
 '["Does the device still show an image?","Is touch responsive across the full panel?","Did the issue begin immediately after an impact?"]'::jsonb,
 '["Document frame and glass condition before disassembly.","Verify image and touch behavior before repair.","Inspect frame alignment and connector area when opened.","Complete full post-repair display, touch, biometric and proximity testing."]'::jsonb,
 '["Damaged display assembly","Display connector damage","Frame deformation"]'::jsonb,
 'ESD-safe bench, heat/control tools appropriate to model, display test capability.',
 'Match display technology and model/region. Confirm adhesive/seal requirements before quoting.',
 'Severely damaged lithium batteries or exposed cells require battery safety handling before display work.',
 array['screen','cracked','display','touch','glass','oled','lcd'],'moderate',60),
('phone-battery-health','Phone','Rapid drain / shutdown / swelling','Phone battery degradation','Reference for batteries with reduced runtime, shutdowns, heat, or physical swelling.',
 '["How quickly does charge drop?","Does it shut down at a reported percentage?","Is the enclosure separating or screen lifting?"]'::jsonb,
 '["Document battery-health information when the OS exposes it.","Check for enclosure or display lift before charging.","Confirm charging behavior and abnormal heat.","After replacement verify charging, temperature, and normal boot behavior."]'::jsonb,
 '["Degraded battery","Swollen battery","Charging-system issue","High background power draw"]'::jsonb,
 'Battery-safe tools, ESD protection, model-appropriate adhesive and removal method.',
 'Use the correct battery revision and replacement adhesive. Do not reuse damaged battery adhesive.',
 'Do not continue charging a visibly swollen, punctured, smoking, or unusually hot battery.',
 array['battery','drain','shutdown','swollen','heat','charging'],'moderate',45),
('device-charging-failure','Phone','Will not charge / intermittent charging','Charging failure diagnosis','Use for devices that do not charge, charge intermittently, or require cable movement.',
 '["Has more than one known-good charger/cable been tried?","Does the connector feel loose?","Was there recent liquid or impact damage?"]'::jsonb,
 '["Verify complaint with known-good power source.","Inspect port for debris and physical connector damage.","Confirm battery response and charging behavior.","Escalate to board-level power diagnosis when port/battery causes are excluded."]'::jsonb,
 '["Contaminated charging port","Damaged charging port","Battery failure","Charging/power-management fault"]'::jsonb,
 'Known-good chargers/cables, magnification, ESD-safe cleaning/inspection tools.',
 'Confirm whether the port is modular or board-attached before quoting.',
 'Stop testing if liquid damage, battery swelling, or abnormal heat is observed.',
 array['charging','port','usb-c','lightning','power','intermittent'],'moderate',45),
('laptop-overheating','Laptop','Hot / loud fan / shutdown under load','Laptop thermal diagnosis','Reference for thermal throttling, loud fans, excessive heat, or thermal shutdowns.',
 '["Does shutdown occur under load or at idle?","Are fans audible/spinning?","Has the device been serviced or opened before?"]'::jsonb,
 '["Inspect intake/exhaust obstruction and fan operation.","Confirm temperatures and throttling under controlled load.","Inspect cooling assembly seating and contamination when opened.","Retest thermals after service before closeout."]'::jsonb,
 '["Dust restriction","Fan failure","Degraded thermal interface","Cooling assembly issue","High background load"]'::jsonb,
 'ESD-safe bench, temperature/diagnostic software, compressed-air/cleaning tools as appropriate.',
 'Fan assemblies and thermal materials are model-specific.',
 'Disconnect power/battery before internal cleaning. Avoid uncontrolled fan overspeed during air cleaning.',
 array['laptop','heat','thermal','fan','shutdown','throttle'],'moderate',60),
('liquid-exposure','Phone','Liquid exposure','Liquid exposure triage','Reference for devices exposed to water or other liquids. Prioritize safety and data-preservation decisions.',
 '["What liquid was involved?","When did exposure occur?","Was the device powered or charged afterward?"]'::jsonb,
 '["Document external condition and customer timeline.","Do not promise recovery before internal inspection.","Disconnect power source/battery as appropriate after opening.","Inspect for corrosion/residue and determine whether repair, cleaning, or board escalation is appropriate."]'::jsonb,
 '["Connector corrosion","Board corrosion","Battery damage","Display/camera/module damage"]'::jsonb,
 'ESD-safe inspection, magnification and model-appropriate cleaning equipment.',
 'Parts needs often cannot be known until inspection; quote in stages when appropriate.',
 'Do not charge devices showing active liquid, corrosion, battery damage, smoke, or abnormal heat.',
 array['liquid','water','corrosion','no power','intermittent'],'advanced',90),
('console-no-display-hdmi','Console','No display / HDMI damage','Console no-display / HDMI diagnosis','Use for consoles that power on but do not produce stable video output.',
 '["Does the console power on and remain on?","Was the HDMI cable pulled or impacted?","Is the HDMI port visibly loose or damaged?"]'::jsonb,
 '["Confirm power/boot behavior separately from video output.","Test with known-good display/cable/input.","Inspect HDMI connector condition and mechanical stability.","If connector damage is not the full cause, escalate through board-level video-path diagnosis.","Verify stable output and resolution negotiation after repair."]'::jsonb,
 '["Damaged HDMI connector","Lifted/damaged pads or traces","HDMI/video encoder fault","Board-level video-path failure"]'::jsonb,
 'Known-good HDMI setup, magnification and board-repair equipment when connector replacement is required.',
 'Connector and board revision must match the console model/revision.',
 'Board-level HDMI work requires appropriate microsoldering skill; inspect pads/traces before committing to connector-only repair.',
 array['console','ps5','xbox','hdmi','no display','video','port'],'advanced',90)
on conflict (location_id, slug) do nothing;
