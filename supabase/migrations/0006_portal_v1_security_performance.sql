-- GotCracked Portal 1.0 production security/performance hardening.
-- Mirrors the final live Supabase cleanup performed during the 1.0 rollout.

-- Lock mutable search paths on trigger/helper functions.
alter function public.touch_operational_record() set search_path = public;
alter function public.touch_workforce_row() set search_path = public;
alter function public.set_ticket_updated_at() set search_path = public;
alter function public.touch_lead() set search_path = public;
alter function public.assign_inventory_sku() set search_path = public;
alter function public.assign_service_sku() set search_path = public;
alter function public.role_default_permission(public.staff_role,text) set search_path = public;

-- Trigger/event-trigger functions are internal and must not be callable as RPCs.
revoke execute on function public.apply_default_repair_warranty() from public, anon, authenticated;
revoke execute on function public.authorize_work_order_price_change() from public, anon, authenticated;
revoke execute on function public.enforce_repair_status_flow() from public, anon, authenticated;
revoke execute on function public.enqueue_discord_lead_event() from public, anon, authenticated;
revoke execute on function public.enqueue_discord_work_order_event() from public, anon, authenticated;
revoke execute on function public.record_shipping_event() from public, anon, authenticated;
revoke execute on function public.record_ticket_event() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.work_order_item_effects() from public, anon, authenticated;

-- Authenticated RLS helper only; never anonymous.
revoke execute on function public.current_location_id() from public, anon;
grant execute on function public.current_location_id() to authenticated, service_role;

-- Internal totals helper is not called by anonymous clients.
revoke execute on function public.recalculate_ticket_totals(uuid) from public, anon;
grant execute on function public.recalculate_ticket_totals(uuid) to authenticated, service_role;

-- High-value indexes for Portal 1.0 operational paths.
create index if not exists devices_customer_id_idx on public.devices(customer_id);
create index if not exists repair_tickets_device_id_idx on public.repair_tickets(device_id);
create index if not exists repair_tickets_assigned_user_id_idx on public.repair_tickets(assigned_user_id);
create index if not exists leads_assigned_user_id_idx on public.leads(assigned_user_id);
create index if not exists leads_customer_id_idx on public.leads(customer_id);
create index if not exists leads_device_id_idx on public.leads(device_id);
create index if not exists leads_converted_ticket_id_idx on public.leads(converted_ticket_id);
create index if not exists lead_events_actor_user_id_idx on public.lead_events(actor_user_id);
create index if not exists intake_sessions_location_id_idx on public.intake_sessions(location_id);
create index if not exists intake_sessions_completed_by_idx on public.intake_sessions(completed_by);
create index if not exists intake_templates_location_id_idx on public.intake_templates(location_id);
create index if not exists purchase_orders_location_id_idx on public.purchase_orders(location_id);
create index if not exists purchase_orders_supplier_id_idx on public.purchase_orders(supplier_id);
create index if not exists purchase_orders_created_by_idx on public.purchase_orders(created_by);
create index if not exists purchase_order_items_purchase_order_id_idx on public.purchase_order_items(purchase_order_id);
create index if not exists purchase_order_items_inventory_item_id_idx on public.purchase_order_items(inventory_item_id);
create index if not exists discord_notification_outbox_location_id_idx on public.discord_notification_outbox(location_id);
create index if not exists repair_suggestion_rules_guide_id_idx on public.repair_suggestion_rules(guide_id);
create index if not exists work_order_item_events_ticket_id_idx on public.work_order_item_events(ticket_id);
create index if not exists work_order_item_events_actor_user_id_idx on public.work_order_item_events(actor_user_id);
create index if not exists work_order_items_inventory_item_id_idx on public.work_order_items(inventory_item_id);
create index if not exists work_order_items_service_id_idx on public.work_order_items(service_id);
create index if not exists ticket_events_actor_user_id_idx on public.ticket_events(actor_user_id);
