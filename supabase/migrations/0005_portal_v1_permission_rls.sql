-- GotCracked Portal 1.0 database permission hardening.
-- UI visibility is convenience; these policies make the permission model
-- authoritative at the database layer for core customer/repair/inventory data.

-- Customers -----------------------------------------------------------------
drop policy if exists "staff can view customers at their location" on public.customers;
drop policy if exists "staff can add customers at their location" on public.customers;
drop policy if exists "staff can update customers at their location" on public.customers;
drop policy if exists "permissioned staff can view customers" on public.customers;
drop policy if exists "permissioned staff can add customers" on public.customers;
drop policy if exists "permissioned staff can update customers" on public.customers;

create policy "permissioned staff can view customers"
  on public.customers for select to authenticated
  using (
    location_id = public.current_location_id()
    and (public.has_permission('customers.view') or public.has_permission('repairs.view'))
  );

create policy "permissioned staff can add customers"
  on public.customers for insert to authenticated
  with check (
    location_id = public.current_location_id()
    and (public.has_permission('customers.edit') or public.has_permission('repairs.intake'))
  );

create policy "permissioned staff can update customers"
  on public.customers for update to authenticated
  using (
    location_id = public.current_location_id()
    and (public.has_permission('customers.edit') or public.has_permission('repairs.intake'))
  )
  with check (
    location_id = public.current_location_id()
    and (public.has_permission('customers.edit') or public.has_permission('repairs.intake'))
  );

-- Devices -------------------------------------------------------------------
drop policy if exists "staff can view devices for location customers" on public.devices;
drop policy if exists "staff can add devices for location customers" on public.devices;
drop policy if exists "staff can update devices for location customers" on public.devices;
drop policy if exists "permissioned staff can view devices" on public.devices;
drop policy if exists "permissioned staff can add devices" on public.devices;
drop policy if exists "permissioned staff can update devices" on public.devices;

create policy "permissioned staff can view devices"
  on public.devices for select to authenticated
  using (
    (public.has_permission('customers.view') or public.has_permission('repairs.view'))
    and exists (
      select 1 from public.customers c
      where c.id = customer_id and c.location_id = public.current_location_id()
    )
  );

create policy "permissioned staff can add devices"
  on public.devices for insert to authenticated
  with check (
    public.has_permission('repairs.intake')
    and exists (
      select 1 from public.customers c
      where c.id = customer_id and c.location_id = public.current_location_id()
    )
  );

create policy "permissioned staff can update devices"
  on public.devices for update to authenticated
  using (
    public.has_permission('repairs.intake')
    and exists (
      select 1 from public.customers c
      where c.id = customer_id and c.location_id = public.current_location_id()
    )
  )
  with check (
    public.has_permission('repairs.intake')
    and exists (
      select 1 from public.customers c
      where c.id = customer_id and c.location_id = public.current_location_id()
    )
  );

-- Repair tickets -------------------------------------------------------------
drop policy if exists "staff can view tickets at their location" on public.repair_tickets;
drop policy if exists "staff can add tickets at their location" on public.repair_tickets;
drop policy if exists "staff can update tickets at their location" on public.repair_tickets;
drop policy if exists "permissioned staff can view tickets" on public.repair_tickets;
drop policy if exists "permissioned staff can add tickets" on public.repair_tickets;
drop policy if exists "permissioned staff can update tickets" on public.repair_tickets;

create policy "permissioned staff can view tickets"
  on public.repair_tickets for select to authenticated
  using (
    location_id = public.current_location_id()
    and public.has_permission('repairs.view')
  );

create policy "permissioned staff can add tickets"
  on public.repair_tickets for insert to authenticated
  with check (
    location_id = public.current_location_id()
    and public.has_permission('repairs.intake')
  );

create policy "permissioned staff can update tickets"
  on public.repair_tickets for update to authenticated
  using (
    location_id = public.current_location_id()
    and public.has_permission('repairs.workflow')
  )
  with check (
    location_id = public.current_location_id()
    and public.has_permission('repairs.workflow')
  );

-- Ticket events --------------------------------------------------------------
drop policy if exists "staff can view ticket events" on public.ticket_events;
drop policy if exists "staff can add ticket events" on public.ticket_events;
drop policy if exists "permissioned staff can view ticket events" on public.ticket_events;
drop policy if exists "permissioned staff can add ticket events" on public.ticket_events;

create policy "permissioned staff can view ticket events"
  on public.ticket_events for select to authenticated
  using (
    public.has_permission('repairs.view')
    and exists (
      select 1 from public.repair_tickets t
      where t.id = ticket_id and t.location_id = public.current_location_id()
    )
  );

create policy "permissioned staff can add ticket events"
  on public.ticket_events for insert to authenticated
  with check (
    public.has_permission('repairs.workflow')
    and exists (
      select 1 from public.repair_tickets t
      where t.id = ticket_id and t.location_id = public.current_location_id()
    )
  );

-- Inventory -----------------------------------------------------------------
drop policy if exists "staff can view inventory at their location" on public.inventory_items;
drop policy if exists "permissioned staff can view inventory" on public.inventory_items;

create policy "permissioned staff can view inventory"
  on public.inventory_items for select to authenticated
  using (
    location_id = public.current_location_id()
    and public.has_permission('inventory.view')
  );

-- Existing mutation policy was replaced in migration 0002; recreate here to
-- make this migration safe if migrations are applied to a database with a
-- slightly different historical policy set.
drop policy if exists "managers can edit inventory" on public.inventory_items;
drop policy if exists "permissioned staff can edit inventory" on public.inventory_items;

create policy "permissioned staff can edit inventory"
  on public.inventory_items for all to authenticated
  using (
    location_id = public.current_location_id()
    and public.has_permission('inventory.manage')
  )
  with check (
    location_id = public.current_location_id()
    and public.has_permission('inventory.manage')
  );
