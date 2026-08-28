-- Targeted covering indexes for operational relationships expected to grow with normal
-- store traffic. Avoid blanket indexing of low-value audit/actor foreign keys.

CREATE INDEX IF NOT EXISTS devices_catalog_model_id_idx
  ON public.devices (catalog_model_id)
  WHERE catalog_model_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS devices_catalog_variant_id_idx
  ON public.devices (catalog_variant_id)
  WHERE catalog_variant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS inventory_audit_items_inventory_item_id_idx
  ON public.inventory_audit_items (inventory_item_id);

CREATE INDEX IF NOT EXISTS inventory_reservations_inventory_item_id_idx
  ON public.inventory_reservations (inventory_item_id);

CREATE INDEX IF NOT EXISTS inventory_transactions_ticket_id_idx
  ON public.inventory_transactions (ticket_id)
  WHERE ticket_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS inventory_transactions_work_order_item_id_idx
  ON public.inventory_transactions (work_order_item_id)
  WHERE work_order_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS part_demands_inventory_item_id_idx
  ON public.part_demands (inventory_item_id)
  WHERE inventory_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS part_demands_registry_part_id_idx
  ON public.part_demands (registry_part_id)
  WHERE registry_part_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS repair_work_intervals_assigned_user_started_idx
  ON public.repair_work_intervals (assigned_user_id, started_at DESC)
  WHERE assigned_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS portal_human_sessions_location_seen_idx
  ON public.portal_human_sessions (location_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS staff_compensation_location_id_idx
  ON public.staff_compensation (location_id);
