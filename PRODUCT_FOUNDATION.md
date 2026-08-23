# GotCracked Portal — Product Foundation

## Purpose

GotCracked Portal is the internal operating system for a device-repair business. It gives the team one current view of the customer, device, repair, promised timing, technician work, needed parts, and payment state.

It is a distinct GotCracked product. The design goal is a calm, fast repair-shop workflow, not a replica of another company’s portal.

## First-release roles

| Role | Core abilities |
| --- | --- |
| Owner | All settings, reporting, locations, financial visibility, staff access |
| Manager | Repairs, appointments, customers, inventory, technician assignment |
| Technician | Assigned repair queue, diagnoses, status updates, parts usage |
| Front desk | Check-in, customer records, appointments, estimates, pickup |

## Ticket lifecycle

`Checked in → In diagnosis → Awaiting approval → Waiting on parts → In repair → Ready for pickup → Completed`

The system must record every status change and customer-contact event, never simply overwrite it. That gives GotCracked a defensible repair history and a clear handoff between staff.

## Build phases

1. **Core operations:** staff login, locations, customers, devices, tickets, timeline, estimates, status changes.
2. **Shop execution:** calendar, technician queue, inventory, parts reservations, reorder prompts.
3. **Checkout and communication:** invoices, deposits/payments, pickup notifications, approval links, warranty records.
4. **Customer access and growth:** self-service repair tracking, multi-location analytics, integrations.

## Data foundation

`database/schema.sql` defines the initial PostgreSQL entities and relationships. The schema already supports a single shop while keeping `location_id` on operational data for future expansion.

## Guardrails

- Do not retain device passcodes or sensitive customer data unless genuinely needed.
- Use role-based permissions from the beginning.
- Keep financial records append-only/auditable.
- Add payment processing through an established provider rather than storing card data.
