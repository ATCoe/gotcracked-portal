-- GotCracked Portal: shared master-data access.
-- Customers, devices, and inventory are global records. Operational records
-- (tickets, appointments, payments, and leads) remain location-scoped.

drop policy if exists "staff can view customers at their location" on public.customers;
drop policy if exists "staff can view devices for location customers" on public.devices;
drop policy if exists "staff can view inventory at their location" on public.inventory_items;

create policy "staff can view global customers" on public.customers
  for select to authenticated
  using (
    public.has_permission('customers.view')
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true)
  );

create policy "staff can view devices for global customers" on public.devices
  for select to authenticated
  using (
    public.has_permission('customers.view')
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true)
  );

create policy "staff can view global inventory" on public.inventory_items
  for select to authenticated
  using (
    public.has_permission('inventory.view')
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true)
  );

comment on table public.customers is 'Global customer master data. Operational activity remains location-scoped.';
comment on table public.devices is 'Global device master data linked to global customers.';
comment on table public.inventory_items is 'Global parts and inventory catalog; physical stock fields remain location-aware.';

