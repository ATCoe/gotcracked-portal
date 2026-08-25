-- Owner-only staff account management audit trail.
-- Privileged Auth actions are performed by the manage-staff Edge Function.

create table if not exists public.staff_account_events (
  id bigint generated always as identity primary key,
  actor_user_id uuid not null references public.profiles(id),
  target_user_id uuid references public.profiles(id),
  event_type text not null check (event_type in (
    'account_created',
    'temporary_password_issued',
    'account_enabled',
    'account_disabled',
    'role_changed'
  )),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists staff_account_events_target_idx
  on public.staff_account_events (target_user_id, created_at desc);

create index if not exists staff_account_events_actor_idx
  on public.staff_account_events (actor_user_id, created_at desc);

alter table public.staff_account_events enable row level security;

-- No browser policy is intentional. Only the server-side function's secret key
-- can write or read the audit trail.
