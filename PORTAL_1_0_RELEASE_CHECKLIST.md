# GotCracked Portal 1.0 release checklist

This document separates **code-complete** from **production-ready**. Do not remove the Beta designation until the production migration, workflow smoke tests, visual pass, and hard bug pass are complete.

## 1. Database upgrade

Apply these Supabase migrations in order to the production project:

1. `supabase/migrations/0002_portal_v1_operations.sql`
2. `supabase/migrations/0003_portal_v1_permission_admin.sql`
3. `supabase/migrations/0004_portal_v1_discord_outbox.sql`
4. `supabase/migrations/0005_portal_v1_permission_rls.sql`

After applying them, verify:

- `permission_definitions` is populated.
- `staff_permission_overrides` exists.
- `intake_templates` contains Phone, Tablet, Laptop, Desktop, and Console templates.
- `repair_guides` contains the seeded internal reference entries.
- `purchase_orders` and `purchase_order_items` exist.
- `discord_notification_outbox` exists.
- `repair_tickets` accepts `awaiting_customer`.
- Lead rows expose `pipeline_status`, `contact_attempted_at`, and conversion-link fields.

## 2. Training Store isolation test

Before testing production writes:

1. Switch the top bar from Main Store to **Training Store**.
2. Confirm the yellow Training Store banner remains visible.
3. Create a fake lead.
4. Attempt to move it out of Need to Contact without a contact note — it must be blocked.
5. Record a contact attempt and move it to Awaiting Device or Awaiting Customer.
6. Convert it to a fake pending work order.
7. Open Walk-In, search the fake customer, and confirm the pending Awaiting Customer work order is offered for resume.
8. Complete the device-specific intake checklist.
9. Confirm a readable intake summary is generated.
10. Add a fake part/service to the work order.
11. Mark a fake part damaged and remove another line.
12. Move the work order through repair/QC/ready states.
13. Scan/type the fake work-order barcode in Ready for Pickup.
14. Complete fake checkout.
15. Create a fake MobileSentrix/Amazon PO, add multiple lines, receive inventory, and print test SKU labels.
16. Adjust and cycle-count Training Store inventory.
17. Confirm production customers, leads, inventory quantities, reports, and POs did not change.
18. Reset Training Store data from Settings and repeat one abbreviated workflow.

## 3. Production lead workflow

- New website/manual leads default to **Need to Contact**.
- Lead cannot advance without a contact-attempt activity note.
- Search/filter works for every lead stage.
- Awaiting Customer vs Awaiting Device is used consistently.
- Need to Order Part and Awaiting Parts preserve activity history.
- Lead conversion reuses an existing customer by normalized phone/email when possible.
- Lead conversion reuses a matching saved device when possible.
- Converted lead creates a work order in **Awaiting Customer**.
- Original lead remains linked for reporting/audit history.
- Discord outbox receives rich lead events.

## 4. Production Walk-In intake

- Walk-In button is visible beside New Work Order for permitted roles.
- Search by formatted/unformatted phone number and email.
- New customer onboarding requires name, address, email, primary phone, and contact phone.
- Existing customer shows saved devices.
- Existing Awaiting Customer work orders are clearly offered for resume.
- Device category controls the correct diagnostic checklist.
- Device metadata persists: manufacturer, model, model number, color, storage, condition, serial, IMEI, accessories.
- Structured visual/functional findings are saved.
- Generated narrative accurately reflects the checklist.
- Work order is created only after review for a direct Walk-In.
- A resumed pending work order moves from Awaiting Customer to Awaiting Repair when physical intake completes.
- Device/work-order DYMO label prompt appears after physical intake.

## 5. Work-order workspace

- Correct device/category reference graphic appears.
- Customer and device information is correct.
- Intake summary is visible.
- Suggested repair references are relevant and clearly advisory.
- Part barcode scanning resolves exact inventory SKU.
- Text search resolves both inventory and service SKUs.
- Added parts/services appear with snapshotted pricing.
- Removing a consumed part restores stock through the existing work-order function.
- Mark Damaged requires a note and creates the intended audit record.
- Workflow drawer collapses/reopens without losing unsaved context unexpectedly.
- Every status change requires a note.
- Ready status moves device into Ready for Pickup.
- Checkout requires/records payment and moves to Sale Complete.

## 6. Purchase orders and inventory

- Management can create PO for MobileSentrix, Amazon, or another vendor.
- External supplier order number is stored.
- Multiple inventory items can be added to a PO.
- Partial receiving works.
- Full receiving closes the PO.
- Received quantity increases inventory exactly once.
- Updated received cost is correct.
- Receiving offers one DYMO SKU label per received unit.
- Technicians cannot create/edit inventory or receive POs unless explicitly granted an override.
- Managers/Owners can add parts, adjust stock, perform counts, and manage POs.

## 7. Roles and permissions

Test one account for each role:

### Front Desk
Expected default access:
- dashboard
- customer search/edit
- Walk-In intake
- leads/contact workflow
- work-order view
- Ready for Pickup/checkout
- inventory lookup
- Repair Reference
- work-order labels

No default inventory mutation, purchasing, reports, staff admin, pricing override, or global settings.

### Technician
Expected default access:
- dashboard
- work orders
- intake
- repair workflow/status notes
- lead view/contact workflow
- customer lookup
- inventory lookup
- Repair Reference
- work-order labels

No default inventory mutation/counts, purchasing, reports, staff administration, pricing override, or global settings.

### Manager
Expected default access to all operational/management permissions, including inventory/counts, POs, pricing, reports, staff permissions, and settings.

### Owner
Full access. Individual owner permissions cannot be disabled.

Also verify:
- Management sees every staff member and role.
- Per-user permission switches persist.
- Overrides visibly distinguish themselves from role defaults.
- Managers cannot modify Owner permissions or peer Manager permissions.
- Database RLS rejects unauthorized direct mutations, not only the UI.

## 8. Discord operational events

Verify production events are written to `discord_notification_outbox` for:

- new lead
- contact attempt / lead stage change
- lead conversion
- work-order creation
- work-order status changes
- ready-for-pickup transition

Then connect/update the existing Discord bot consumer so it posts the richer payloads into the established staff notification channel. Portal is the authoritative record; Discord is the alert surface.

## 9. DYMO LabelWriter 550 Turbo commissioning

Follow `LABEL_PRINTING.md` using the actual printer and loaded label stock.

Minimum pass criteria:

- printer reachable from intended workstation(s)
- Portal test label prints at correct size/orientation
- work-order Code 39 scans to the exact work-order number
- part SKU label scans to the exact inventory item
- PO receiving prints the requested quantity of labels
- Training labels are visibly marked TRAINING
- barcode quiet space/margins scan reliably

## 10. Final 1.0 visual/CSS pass

Test desktop and mobile at minimum:

- 360–390 px phone
- 750 px breakpoint
- tablet / small laptop
- 1366×768 desktop
- 1920×1080 desktop

Review:

- sidebar and mobile drawer
- no blur/filter regression
- table horizontal behavior
- intake wizard
- lead drawer
- work-order right panel
- Ready for Pickup
- Repair Reference
- Purchasing/PO receiving
- permission matrix
- Training Store banner/switch
- modals/dialog scrolling and keyboard focus

## 11. Hard bug pass

- Run GitHub Portal CI and require success.
- Exercise browser Back/Forward navigation.
- Test refresh/deep links while authenticated and signed out.
- Test stale-cache deployment behavior.
- Test permission-denied paths.
- Test duplicate customer/device prevention.
- Test lead/contact transition validation.
- Test partial PO receiving twice to ensure no double-receipt.
- Test inventory write-off/damaged-part accounting.
- Test payment/checkout failures.
- Test real-time updates between two sessions.
- Check browser console for uncaught errors.
- Verify Cloudflare deployment from the final `main` head.

## Exit criteria

Portal can be labeled **GotCracked Portal 1.0** and the Beta designation removed when:

- migrations are live and verified,
- Training Store isolation passes,
- role/RLS tests pass,
- lead → pending work order → arrival/intake works without duplicate entry,
- work-order/parts/pickup/PO paths pass,
- DYMO commissioning passes when hardware is connected,
- Discord consumer is verified,
- final visual/CSS pass is approved,
- final hard bug pass has no release-blocking defects.
