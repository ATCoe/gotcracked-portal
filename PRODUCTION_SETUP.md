# Connecting GotCracked Portal to secure staff accounts

## Chosen platform

The production build uses **Supabase** for staff authentication and the PostgreSQL database. It is a strong fit because every repair record, customer, and ticket is enforced by database-level access rules—not only by the screen a staff member sees.

## What is already prepared

- `supabase/migrations/0001_gotcracked_portal.sql` creates the secure production database foundation.
- `.env.example` lists the two browser-safe connection values the web application needs.
- No keys, passwords, customer information, or secret URLs are included in this project.

## One-time owner setup

1. Create a new Supabase project at [database.new](https://database.new).
2. In the project’s SQL Editor, run `supabase/migrations/0001_gotcracked_portal.sql`.
3. From the project’s **Connect** panel, copy the project URL and publishable key into a local `.env.local` file based on `.env.example`.
4. Create the first staff account in Supabase Authentication, then add its matching row to `public.profiles` with the `owner` role and the correct location.

The URL and publishable key are connection settings; they are not the database password. Never place a Supabase `service_role` key in a browser application or share it in chat.

## Next implementation slice

Once the project connection values are present, replace the demo sign-in and browser storage with Supabase cookie-based sessions, then wire the intake form into the `customers`, `devices`, and `repair_tickets` tables.
