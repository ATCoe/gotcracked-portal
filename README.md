# GotCracked Portal

The product foundation for GotCracked’s internal repair-shop operations system.

## Product direction

This is an original operations portal informed by common repair-shop workflows: device intake, appointment scheduling, repair status tracking, parts awareness, customer communication, and owner reporting. It is not a copy of uBreakiFix branding, content, or implementation.

## Foundation included

- A responsive owner/manager dashboard with current work, daily schedule, KPI cards, and attention items.
- A repair-ticket workspace with status filters and search.
- A working new-repair intake flow that adds a ticket to the queue.
- Placeholder modules that establish the information architecture for appointments, customer history, inventory, and reports.
- A deliberate data vocabulary for the next build phase: `Customer`, `Device`, `RepairTicket`, `Appointment`, `InventoryItem`, `Supplier`, `User`, `Location`, and `Payment`.
- Mandatory first-login password creation for new staff profiles, enforced before the dashboard loads.

## Proposed production stack

When we turn this interactive prototype into the live system, use:

- Next.js + TypeScript for the application.
- PostgreSQL with Prisma or Drizzle for durable business data.
- Auth.js (or Clerk) for role-based staff access.
- Stripe Terminal / Square integration only after the checkout workflow is defined.
- Resend / Twilio for customer email and SMS notifications.

## Suggested delivery order

1. Authentication, roles, locations, and real repair/customer/device records.
2. Intake, estimates, status history, technician assignment, and customer notifications.
3. Appointment calendar, inventory, vendors, and parts reservations.
4. Payments, invoices, warranty records, reporting, and customer repair tracking.

## Running the prototype

Open `index.html` in a browser. No development server or dependencies are required for this initial interface foundation.
