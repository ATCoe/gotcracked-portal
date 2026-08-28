-- Consolidate overlapping permissive RLS policies without changing their effective access.
-- Read access is the exact logical union of the former SELECT + management policy USING
-- expressions; management write access remains explicit per command.

-- intake_templates
DROP POLICY IF EXISTS "management can manage intake templates" ON public.intake_templates;
DROP POLICY IF EXISTS "staff can read intake templates" ON public.intake_templates;
CREATE POLICY "staff can read intake templates" ON public.intake_templates FOR SELECT TO authenticated
USING (((location_id IS NULL) OR location_id = (SELECT public.current_location_id())) AND (active = true OR (SELECT public.has_permission('reference.manage'))));
CREATE POLICY "management can insert intake templates" ON public.intake_templates FOR INSERT TO authenticated
WITH CHECK ((SELECT public.has_permission('reference.manage')) AND ((location_id IS NULL) OR location_id = (SELECT public.current_location_id())));
CREATE POLICY "management can update intake templates" ON public.intake_templates FOR UPDATE TO authenticated
USING ((SELECT public.has_permission('reference.manage')) AND ((location_id IS NULL) OR location_id = (SELECT public.current_location_id())))
WITH CHECK ((SELECT public.has_permission('reference.manage')) AND ((location_id IS NULL) OR location_id = (SELECT public.current_location_id())));
CREATE POLICY "management can delete intake templates" ON public.intake_templates FOR DELETE TO authenticated
USING ((SELECT public.has_permission('reference.manage')) AND ((location_id IS NULL) OR location_id = (SELECT public.current_location_id())));

-- inventory_items
DROP POLICY IF EXISTS "permissioned staff can edit inventory" ON public.inventory_items;
DROP POLICY IF EXISTS "permissioned staff can view inventory" ON public.inventory_items;
CREATE POLICY "permissioned staff can view inventory" ON public.inventory_items FOR SELECT TO authenticated
USING (location_id = (SELECT public.current_location_id()) AND ((SELECT public.has_permission('inventory.view')) OR (SELECT public.has_permission('inventory.manage'))));
CREATE POLICY "permissioned staff can insert inventory" ON public.inventory_items FOR INSERT TO authenticated
WITH CHECK (location_id = (SELECT public.current_location_id()) AND (SELECT public.has_permission('inventory.manage')));
CREATE POLICY "permissioned staff can update inventory" ON public.inventory_items FOR UPDATE TO authenticated
USING (location_id = (SELECT public.current_location_id()) AND (SELECT public.has_permission('inventory.manage')))
WITH CHECK (location_id = (SELECT public.current_location_id()) AND (SELECT public.has_permission('inventory.manage')));
CREATE POLICY "permissioned staff can delete inventory" ON public.inventory_items FOR DELETE TO authenticated
USING (location_id = (SELECT public.current_location_id()) AND (SELECT public.has_permission('inventory.manage')));

-- inventory_reservations
DROP POLICY IF EXISTS inventory_reservations_staff_manage ON public.inventory_reservations;
DROP POLICY IF EXISTS inventory_reservations_staff_read ON public.inventory_reservations;
CREATE POLICY inventory_reservations_staff_read ON public.inventory_reservations FOR SELECT TO authenticated
USING (location_id = (SELECT public.current_location_id()) AND (
  COALESCE((SELECT public.has_permission('inventory.view')), false) OR
  COALESCE((SELECT public.has_permission('repairs.view')), false) OR
  COALESCE((SELECT public.has_permission('inventory.manage')), false) OR
  COALESCE((SELECT public.has_permission('purchasing.manage')), false)
));
CREATE POLICY inventory_reservations_staff_insert ON public.inventory_reservations FOR INSERT TO authenticated
WITH CHECK (location_id = (SELECT public.current_location_id()) AND (COALESCE((SELECT public.has_permission('inventory.manage')), false) OR COALESCE((SELECT public.has_permission('purchasing.manage')), false)));
CREATE POLICY inventory_reservations_staff_update ON public.inventory_reservations FOR UPDATE TO authenticated
USING (location_id = (SELECT public.current_location_id()) AND (COALESCE((SELECT public.has_permission('inventory.manage')), false) OR COALESCE((SELECT public.has_permission('purchasing.manage')), false)))
WITH CHECK (location_id = (SELECT public.current_location_id()) AND (COALESCE((SELECT public.has_permission('inventory.manage')), false) OR COALESCE((SELECT public.has_permission('purchasing.manage')), false)));
CREATE POLICY inventory_reservations_staff_delete ON public.inventory_reservations FOR DELETE TO authenticated
USING (location_id = (SELECT public.current_location_id()) AND (COALESCE((SELECT public.has_permission('inventory.manage')), false) OR COALESCE((SELECT public.has_permission('purchasing.manage')), false)));

-- part_demands
DROP POLICY IF EXISTS part_demands_staff_manage ON public.part_demands;
DROP POLICY IF EXISTS part_demands_staff_read ON public.part_demands;
CREATE POLICY part_demands_staff_read ON public.part_demands FOR SELECT TO authenticated
USING (location_id = (SELECT public.current_location_id()) AND (
  COALESCE((SELECT public.has_permission('inventory.view')), false) OR
  COALESCE((SELECT public.has_permission('repairs.view')), false) OR
  COALESCE((SELECT public.has_permission('inventory.manage')), false) OR
  COALESCE((SELECT public.has_permission('purchasing.manage')), false) OR
  COALESCE((SELECT public.has_permission('repairs.workflow')), false)
));
CREATE POLICY part_demands_staff_insert ON public.part_demands FOR INSERT TO authenticated
WITH CHECK (location_id = (SELECT public.current_location_id()) AND (COALESCE((SELECT public.has_permission('inventory.manage')), false) OR COALESCE((SELECT public.has_permission('purchasing.manage')), false) OR COALESCE((SELECT public.has_permission('repairs.workflow')), false)));
CREATE POLICY part_demands_staff_update ON public.part_demands FOR UPDATE TO authenticated
USING (location_id = (SELECT public.current_location_id()) AND (COALESCE((SELECT public.has_permission('inventory.manage')), false) OR COALESCE((SELECT public.has_permission('purchasing.manage')), false) OR COALESCE((SELECT public.has_permission('repairs.workflow')), false)))
WITH CHECK (location_id = (SELECT public.current_location_id()) AND (COALESCE((SELECT public.has_permission('inventory.manage')), false) OR COALESCE((SELECT public.has_permission('purchasing.manage')), false) OR COALESCE((SELECT public.has_permission('repairs.workflow')), false)));
CREATE POLICY part_demands_staff_delete ON public.part_demands FOR DELETE TO authenticated
USING (location_id = (SELECT public.current_location_id()) AND (COALESCE((SELECT public.has_permission('inventory.manage')), false) OR COALESCE((SELECT public.has_permission('purchasing.manage')), false) OR COALESCE((SELECT public.has_permission('repairs.workflow')), false)));

-- portal_releases
DROP POLICY IF EXISTS "owners manage releases" ON public.portal_releases;
DROP POLICY IF EXISTS "staff view releases" ON public.portal_releases;
CREATE POLICY "staff view releases" ON public.portal_releases FOR SELECT TO authenticated
USING ((SELECT public.portal_human_session()) OR EXISTS (
  SELECT 1 FROM public.profiles p
  WHERE p.id = (SELECT auth.uid()) AND p.active AND p.role::text = 'owner'
));
CREATE POLICY "owners insert releases" ON public.portal_releases FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.active AND p.role::text = 'owner'));
CREATE POLICY "owners update releases" ON public.portal_releases FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.active AND p.role::text = 'owner'))
WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.active AND p.role::text = 'owner'));
CREATE POLICY "owners delete releases" ON public.portal_releases FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.active AND p.role::text = 'owner'));

-- promo_codes
DROP POLICY IF EXISTS "management can manage promo codes" ON public.promo_codes;
CREATE POLICY "management can insert promo codes" ON public.promo_codes FOR INSERT TO authenticated
WITH CHECK (location_id = (SELECT public.current_location_id()) AND (SELECT public.current_staff_role()) = ANY (ARRAY['owner'::public.staff_role,'manager'::public.staff_role]));
CREATE POLICY "management can update promo codes" ON public.promo_codes FOR UPDATE TO authenticated
USING (location_id = (SELECT public.current_location_id()) AND (SELECT public.current_staff_role()) = ANY (ARRAY['owner'::public.staff_role,'manager'::public.staff_role]))
WITH CHECK (location_id = (SELECT public.current_location_id()) AND (SELECT public.current_staff_role()) = ANY (ARRAY['owner'::public.staff_role,'manager'::public.staff_role]));
CREATE POLICY "management can delete promo codes" ON public.promo_codes FOR DELETE TO authenticated
USING (location_id = (SELECT public.current_location_id()) AND (SELECT public.current_staff_role()) = ANY (ARRAY['owner'::public.staff_role,'manager'::public.staff_role]));

-- purchase_order_item_allocations
DROP POLICY IF EXISTS po_item_allocations_staff_manage ON public.purchase_order_item_allocations;
DROP POLICY IF EXISTS po_item_allocations_staff_read ON public.purchase_order_item_allocations;
CREATE POLICY po_item_allocations_staff_read ON public.purchase_order_item_allocations FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.purchase_order_items poi JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
  WHERE poi.id = purchase_order_item_allocations.purchase_order_item_id AND po.location_id = (SELECT public.current_location_id())
) AND (
  COALESCE((SELECT public.has_permission('inventory.view')), false) OR
  COALESCE((SELECT public.has_permission('purchasing.view')), false) OR
  COALESCE((SELECT public.has_permission('purchasing.manage')), false)
));
CREATE POLICY po_item_allocations_staff_insert ON public.purchase_order_item_allocations FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.purchase_order_items poi JOIN public.purchase_orders po ON po.id = poi.purchase_order_id WHERE poi.id = purchase_order_item_allocations.purchase_order_item_id AND po.location_id = (SELECT public.current_location_id())) AND COALESCE((SELECT public.has_permission('purchasing.manage')), false));
CREATE POLICY po_item_allocations_staff_update ON public.purchase_order_item_allocations FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.purchase_order_items poi JOIN public.purchase_orders po ON po.id = poi.purchase_order_id WHERE poi.id = purchase_order_item_allocations.purchase_order_item_id AND po.location_id = (SELECT public.current_location_id())) AND COALESCE((SELECT public.has_permission('purchasing.manage')), false))
WITH CHECK (EXISTS (SELECT 1 FROM public.purchase_order_items poi JOIN public.purchase_orders po ON po.id = poi.purchase_order_id WHERE poi.id = purchase_order_item_allocations.purchase_order_item_id AND po.location_id = (SELECT public.current_location_id())) AND COALESCE((SELECT public.has_permission('purchasing.manage')), false));
CREATE POLICY po_item_allocations_staff_delete ON public.purchase_order_item_allocations FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.purchase_order_items poi JOIN public.purchase_orders po ON po.id = poi.purchase_order_id WHERE poi.id = purchase_order_item_allocations.purchase_order_item_id AND po.location_id = (SELECT public.current_location_id())) AND COALESCE((SELECT public.has_permission('purchasing.manage')), false));

-- purchase_order_items
DROP POLICY IF EXISTS "management can manage purchase order items" ON public.purchase_order_items;
DROP POLICY IF EXISTS "management can view purchase order items" ON public.purchase_order_items;
CREATE POLICY "management can view purchase order items" ON public.purchase_order_items FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.purchase_orders po WHERE po.id = purchase_order_items.purchase_order_id AND po.location_id = (SELECT public.current_location_id())) AND ((SELECT public.has_permission('purchasing.view')) OR (SELECT public.has_permission('purchasing.manage'))));
CREATE POLICY "management can insert purchase order items" ON public.purchase_order_items FOR INSERT TO authenticated
WITH CHECK ((SELECT public.has_permission('purchasing.manage')) AND EXISTS (SELECT 1 FROM public.purchase_orders po WHERE po.id = purchase_order_items.purchase_order_id AND po.location_id = (SELECT public.current_location_id())));
CREATE POLICY "management can update purchase order items" ON public.purchase_order_items FOR UPDATE TO authenticated
USING ((SELECT public.has_permission('purchasing.manage')) AND EXISTS (SELECT 1 FROM public.purchase_orders po WHERE po.id = purchase_order_items.purchase_order_id AND po.location_id = (SELECT public.current_location_id())))
WITH CHECK ((SELECT public.has_permission('purchasing.manage')) AND EXISTS (SELECT 1 FROM public.purchase_orders po WHERE po.id = purchase_order_items.purchase_order_id AND po.location_id = (SELECT public.current_location_id())));
CREATE POLICY "management can delete purchase order items" ON public.purchase_order_items FOR DELETE TO authenticated
USING ((SELECT public.has_permission('purchasing.manage')) AND EXISTS (SELECT 1 FROM public.purchase_orders po WHERE po.id = purchase_order_items.purchase_order_id AND po.location_id = (SELECT public.current_location_id())));

-- purchase_orders
DROP POLICY IF EXISTS "management can manage purchase orders" ON public.purchase_orders;
DROP POLICY IF EXISTS "management can view purchase orders" ON public.purchase_orders;
CREATE POLICY "management can view purchase orders" ON public.purchase_orders FOR SELECT TO authenticated
USING (location_id = (SELECT public.current_location_id()) AND ((SELECT public.has_permission('purchasing.view')) OR (SELECT public.has_permission('purchasing.manage'))));
CREATE POLICY "management can insert purchase orders" ON public.purchase_orders FOR INSERT TO authenticated
WITH CHECK (location_id = (SELECT public.current_location_id()) AND (SELECT public.has_permission('purchasing.manage')));
CREATE POLICY "management can update purchase orders" ON public.purchase_orders FOR UPDATE TO authenticated
USING (location_id = (SELECT public.current_location_id()) AND (SELECT public.has_permission('purchasing.manage')))
WITH CHECK (location_id = (SELECT public.current_location_id()) AND (SELECT public.has_permission('purchasing.manage')));
CREATE POLICY "management can delete purchase orders" ON public.purchase_orders FOR DELETE TO authenticated
USING (location_id = (SELECT public.current_location_id()) AND (SELECT public.has_permission('purchasing.manage')));

-- repair_guides
DROP POLICY IF EXISTS "management can manage repair guides" ON public.repair_guides;
DROP POLICY IF EXISTS "staff can read repair guides" ON public.repair_guides;
CREATE POLICY "staff can read repair guides" ON public.repair_guides FOR SELECT TO authenticated
USING (((location_id IS NULL) OR location_id = (SELECT public.current_location_id())) AND (((active = true) AND (SELECT public.has_permission('reference.view'))) OR (SELECT public.has_permission('reference.manage'))));
CREATE POLICY "management can insert repair guides" ON public.repair_guides FOR INSERT TO authenticated
WITH CHECK ((SELECT public.has_permission('reference.manage')) AND ((location_id IS NULL) OR location_id = (SELECT public.current_location_id())));
CREATE POLICY "management can update repair guides" ON public.repair_guides FOR UPDATE TO authenticated
USING ((SELECT public.has_permission('reference.manage')) AND ((location_id IS NULL) OR location_id = (SELECT public.current_location_id())))
WITH CHECK ((SELECT public.has_permission('reference.manage')) AND ((location_id IS NULL) OR location_id = (SELECT public.current_location_id())));
CREATE POLICY "management can delete repair guides" ON public.repair_guides FOR DELETE TO authenticated
USING ((SELECT public.has_permission('reference.manage')) AND ((location_id IS NULL) OR location_id = (SELECT public.current_location_id())));

-- repair_part_requirement_rules
DROP POLICY IF EXISTS repair_part_requirement_rules_staff_write ON public.repair_part_requirement_rules;
CREATE POLICY repair_part_requirement_rules_staff_insert ON public.repair_part_requirement_rules FOR INSERT TO authenticated
WITH CHECK (location_id = (SELECT public.current_location_id()) AND (COALESCE((SELECT public.has_permission('inventory.manage')), false) OR COALESCE((SELECT public.has_permission('settings.manage')), false)));
CREATE POLICY repair_part_requirement_rules_staff_update ON public.repair_part_requirement_rules FOR UPDATE TO authenticated
USING (location_id = (SELECT public.current_location_id()) AND (COALESCE((SELECT public.has_permission('inventory.manage')), false) OR COALESCE((SELECT public.has_permission('settings.manage')), false)))
WITH CHECK (location_id = (SELECT public.current_location_id()) AND (COALESCE((SELECT public.has_permission('inventory.manage')), false) OR COALESCE((SELECT public.has_permission('settings.manage')), false)));
CREATE POLICY repair_part_requirement_rules_staff_delete ON public.repair_part_requirement_rules FOR DELETE TO authenticated
USING (location_id = (SELECT public.current_location_id()) AND (COALESCE((SELECT public.has_permission('inventory.manage')), false) OR COALESCE((SELECT public.has_permission('settings.manage')), false)));

-- repair_suggestion_rules
DROP POLICY IF EXISTS "management can manage suggestion rules" ON public.repair_suggestion_rules;
DROP POLICY IF EXISTS "staff can read suggestion rules" ON public.repair_suggestion_rules;
CREATE POLICY "staff can read suggestion rules" ON public.repair_suggestion_rules FOR SELECT TO authenticated
USING ((SELECT public.has_permission('reference.view')) OR (SELECT public.has_permission('reference.manage')));
CREATE POLICY "management can insert suggestion rules" ON public.repair_suggestion_rules FOR INSERT TO authenticated
WITH CHECK ((SELECT public.has_permission('reference.manage')));
CREATE POLICY "management can update suggestion rules" ON public.repair_suggestion_rules FOR UPDATE TO authenticated
USING ((SELECT public.has_permission('reference.manage'))) WITH CHECK ((SELECT public.has_permission('reference.manage')));
CREATE POLICY "management can delete suggestion rules" ON public.repair_suggestion_rules FOR DELETE TO authenticated
USING ((SELECT public.has_permission('reference.manage')));

-- repair_tickets: exact logical union of the two prior permissive UPDATE policies.
DROP POLICY IF EXISTS "intake staff can receive pending arrivals" ON public.repair_tickets;
DROP POLICY IF EXISTS "permissioned staff can update tickets" ON public.repair_tickets;
CREATE POLICY "permissioned staff can update tickets" ON public.repair_tickets FOR UPDATE TO authenticated
USING (
  location_id = (SELECT public.current_location_id()) AND (
    (SELECT public.has_permission('repairs.workflow')) OR
    (status::text = 'awaiting_customer' AND (SELECT public.has_permission('repairs.intake')))
  )
)
WITH CHECK (
  location_id = (SELECT public.current_location_id()) AND (
    (SELECT public.has_permission('repairs.workflow')) OR
    (status::text = 'awaiting_repair' AND intake_session_id IS NOT NULL AND arrived_at IS NOT NULL AND (SELECT public.has_permission('repairs.intake')))
  )
);

-- schedule_weeks
DROP POLICY IF EXISTS "permissioned management can manage schedule weeks" ON public.schedule_weeks;
DROP POLICY IF EXISTS "permissioned staff can view published schedule weeks" ON public.schedule_weeks;
CREATE POLICY "permissioned staff can view published schedule weeks" ON public.schedule_weeks FOR SELECT TO authenticated
USING (location_id = (SELECT public.current_location_id()) AND ((SELECT public.has_permission('schedule.manage')) OR ((SELECT public.has_permission('schedule.view')) AND status = 'published')));
CREATE POLICY "permissioned management can insert schedule weeks" ON public.schedule_weeks FOR INSERT TO authenticated
WITH CHECK (location_id = (SELECT public.current_location_id()) AND (SELECT public.has_permission('schedule.manage')));
CREATE POLICY "permissioned management can update schedule weeks" ON public.schedule_weeks FOR UPDATE TO authenticated
USING (location_id = (SELECT public.current_location_id()) AND (SELECT public.has_permission('schedule.manage')))
WITH CHECK (location_id = (SELECT public.current_location_id()) AND (SELECT public.has_permission('schedule.manage')));
CREATE POLICY "permissioned management can delete schedule weeks" ON public.schedule_weeks FOR DELETE TO authenticated
USING (location_id = (SELECT public.current_location_id()) AND (SELECT public.has_permission('schedule.manage')));

-- services
DROP POLICY IF EXISTS "permissioned management can manage services" ON public.services;
DROP POLICY IF EXISTS "permissioned staff can view services" ON public.services;
CREATE POLICY "permissioned staff can view services" ON public.services FOR SELECT TO authenticated
USING (location_id = (SELECT public.current_location_id()) AND ((SELECT public.has_permission('repairs.view')) OR (SELECT public.has_permission('inventory.view')) OR (SELECT public.has_permission('inventory.manage'))));
CREATE POLICY "permissioned management can insert services" ON public.services FOR INSERT TO authenticated
WITH CHECK (location_id = (SELECT public.current_location_id()) AND (SELECT public.has_permission('inventory.manage')));
CREATE POLICY "permissioned management can update services" ON public.services FOR UPDATE TO authenticated
USING (location_id = (SELECT public.current_location_id()) AND (SELECT public.has_permission('inventory.manage')))
WITH CHECK (location_id = (SELECT public.current_location_id()) AND (SELECT public.has_permission('inventory.manage')));
CREATE POLICY "permissioned management can delete services" ON public.services FOR DELETE TO authenticated
USING (location_id = (SELECT public.current_location_id()) AND (SELECT public.has_permission('inventory.manage')));

-- shifts
DROP POLICY IF EXISTS "permissioned management can manage shifts" ON public.shifts;
DROP POLICY IF EXISTS "permissioned staff can view published shifts" ON public.shifts;
CREATE POLICY "permissioned staff can view published shifts" ON public.shifts FOR SELECT TO authenticated
USING (location_id = (SELECT public.current_location_id()) AND (
  (SELECT public.has_permission('schedule.manage')) OR
  ((SELECT public.has_permission('schedule.view')) AND EXISTS (
    SELECT 1 FROM public.schedule_weeks w
    WHERE w.id = shifts.schedule_week_id
      AND w.location_id = (SELECT public.current_location_id())
      AND w.status = 'published'
  ))
));
CREATE POLICY "permissioned management can insert shifts" ON public.shifts FOR INSERT TO authenticated
WITH CHECK (location_id = (SELECT public.current_location_id()) AND (SELECT public.has_permission('schedule.manage')));
CREATE POLICY "permissioned management can update shifts" ON public.shifts FOR UPDATE TO authenticated
USING (location_id = (SELECT public.current_location_id()) AND (SELECT public.has_permission('schedule.manage')))
WITH CHECK (location_id = (SELECT public.current_location_id()) AND (SELECT public.has_permission('schedule.manage')));
CREATE POLICY "permissioned management can delete shifts" ON public.shifts FOR DELETE TO authenticated
USING (location_id = (SELECT public.current_location_id()) AND (SELECT public.has_permission('schedule.manage')));

-- shipping_shipments
DROP POLICY IF EXISTS shipping_shipments_manager_write ON public.shipping_shipments;
CREATE POLICY shipping_shipments_staff_insert ON public.shipping_shipments FOR INSERT TO authenticated
WITH CHECK (location_id = (SELECT public.current_location_id()) AND (COALESCE((SELECT public.has_permission('repairs.workflow')), false) OR COALESCE((SELECT public.has_permission('repairs.intake')), false)));
CREATE POLICY shipping_shipments_staff_update ON public.shipping_shipments FOR UPDATE TO authenticated
USING (location_id = (SELECT public.current_location_id()) AND (COALESCE((SELECT public.has_permission('repairs.workflow')), false) OR COALESCE((SELECT public.has_permission('repairs.intake')), false)))
WITH CHECK (location_id = (SELECT public.current_location_id()) AND (COALESCE((SELECT public.has_permission('repairs.workflow')), false) OR COALESCE((SELECT public.has_permission('repairs.intake')), false)));
CREATE POLICY shipping_shipments_staff_delete ON public.shipping_shipments FOR DELETE TO authenticated
USING (location_id = (SELECT public.current_location_id()) AND (COALESCE((SELECT public.has_permission('repairs.workflow')), false) OR COALESCE((SELECT public.has_permission('repairs.intake')), false)));

-- suppliers
DROP POLICY IF EXISTS "permissioned management can manage suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "permissioned staff can view suppliers" ON public.suppliers;
CREATE POLICY "permissioned staff can view suppliers" ON public.suppliers FOR SELECT TO authenticated
USING (location_id = (SELECT public.current_location_id()) AND ((SELECT public.has_permission('purchasing.view')) OR (SELECT public.has_permission('inventory.view')) OR (SELECT public.has_permission('purchasing.manage'))));
CREATE POLICY "permissioned management can insert suppliers" ON public.suppliers FOR INSERT TO authenticated
WITH CHECK (location_id = (SELECT public.current_location_id()) AND (SELECT public.has_permission('purchasing.manage')));
CREATE POLICY "permissioned management can update suppliers" ON public.suppliers FOR UPDATE TO authenticated
USING (location_id = (SELECT public.current_location_id()) AND (SELECT public.has_permission('purchasing.manage')))
WITH CHECK (location_id = (SELECT public.current_location_id()) AND (SELECT public.has_permission('purchasing.manage')));
CREATE POLICY "permissioned management can delete suppliers" ON public.suppliers FOR DELETE TO authenticated
USING (location_id = (SELECT public.current_location_id()) AND (SELECT public.has_permission('purchasing.manage')));

-- time_off_requests
DROP POLICY IF EXISTS "permissioned management can manage time off" ON public.time_off_requests;
DROP POLICY IF EXISTS "staff can request time off" ON public.time_off_requests;
DROP POLICY IF EXISTS "staff can view own time off" ON public.time_off_requests;
CREATE POLICY "staff can view own time off" ON public.time_off_requests FOR SELECT TO authenticated
USING (location_id = (SELECT public.current_location_id()) AND (
  (SELECT public.has_permission('schedule.manage')) OR
  employee_id = (SELECT auth.uid()) OR
  (SELECT public.current_staff_role()) = ANY (ARRAY['owner'::public.staff_role,'manager'::public.staff_role])
));
CREATE POLICY "staff can request time off" ON public.time_off_requests FOR INSERT TO authenticated
WITH CHECK (location_id = (SELECT public.current_location_id()) AND ((SELECT public.has_permission('schedule.manage')) OR employee_id = (SELECT auth.uid())));
CREATE POLICY "permissioned management can update time off" ON public.time_off_requests FOR UPDATE TO authenticated
USING (location_id = (SELECT public.current_location_id()) AND (SELECT public.has_permission('schedule.manage')))
WITH CHECK (location_id = (SELECT public.current_location_id()) AND (SELECT public.has_permission('schedule.manage')));
CREATE POLICY "permissioned management can delete time off" ON public.time_off_requests FOR DELETE TO authenticated
USING (location_id = (SELECT public.current_location_id()) AND (SELECT public.has_permission('schedule.manage')));

-- work_order_items
DROP POLICY IF EXISTS "permissioned staff can manage work order items" ON public.work_order_items;
DROP POLICY IF EXISTS "permissioned staff can view work order items" ON public.work_order_items;
CREATE POLICY "permissioned staff can view work order items" ON public.work_order_items FOR SELECT TO authenticated
USING (((SELECT public.has_permission('repairs.view')) OR (SELECT public.has_permission('repairs.workflow'))) AND EXISTS (
  SELECT 1 FROM public.repair_tickets t
  WHERE t.id = work_order_items.ticket_id AND t.location_id = (SELECT public.current_location_id())
));
CREATE POLICY "permissioned staff can insert work order items" ON public.work_order_items FOR INSERT TO authenticated
WITH CHECK ((SELECT public.has_permission('repairs.workflow')) AND EXISTS (SELECT 1 FROM public.repair_tickets t WHERE t.id = work_order_items.ticket_id AND t.location_id = (SELECT public.current_location_id())));
CREATE POLICY "permissioned staff can update work order items" ON public.work_order_items FOR UPDATE TO authenticated
USING ((SELECT public.has_permission('repairs.workflow')) AND EXISTS (SELECT 1 FROM public.repair_tickets t WHERE t.id = work_order_items.ticket_id AND t.location_id = (SELECT public.current_location_id())))
WITH CHECK ((SELECT public.has_permission('repairs.workflow')) AND EXISTS (SELECT 1 FROM public.repair_tickets t WHERE t.id = work_order_items.ticket_id AND t.location_id = (SELECT public.current_location_id())));
CREATE POLICY "permissioned staff can delete work order items" ON public.work_order_items FOR DELETE TO authenticated
USING ((SELECT public.has_permission('repairs.workflow')) AND EXISTS (SELECT 1 FROM public.repair_tickets t WHERE t.id = work_order_items.ticket_id AND t.location_id = (SELECT public.current_location_id())));
