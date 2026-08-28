create table if not exists public.customer_access_challenges (
  id uuid primary key default gen_random_uuid(),
  lookup_hash text not null,
  lookup_kind text not null check (lookup_kind in ('email','phone')),
  customer_ids uuid[] not null check (cardinality(customer_ids) > 0),
  destination_email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 12),
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists customer_access_challenges_lookup_idx
  on public.customer_access_challenges(lookup_hash, created_at desc);
create index if not exists customer_access_challenges_expiry_idx
  on public.customer_access_challenges(expires_at);

alter table public.customer_access_challenges enable row level security;
revoke all on table public.customer_access_challenges from public, anon, authenticated;
drop policy if exists "customer access challenges deny browser" on public.customer_access_challenges;
create policy "customer access challenges deny browser"
  on public.customer_access_challenges for all to anon, authenticated
  using (false) with check (false);

create table if not exists public.customer_access_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  customer_ids uuid[] not null check (cardinality(customer_ids) > 0),
  verified_email text not null,
  lookup_kind text not null check (lookup_kind in ('email','phone')),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists customer_access_sessions_expiry_idx
  on public.customer_access_sessions(expires_at) where revoked_at is null;

alter table public.customer_access_sessions enable row level security;
revoke all on table public.customer_access_sessions from public, anon, authenticated;
drop policy if exists "customer access sessions deny browser" on public.customer_access_sessions;
create policy "customer access sessions deny browser"
  on public.customer_access_sessions for all to anon, authenticated
  using (false) with check (false);

comment on table public.customer_access_challenges is
  'Service-role-only one-time-code challenges for the customer-facing GotCracked account.';
comment on table public.customer_access_sessions is
  'Service-role-only opaque sessions for customer-facing repair history access.';

alter table public.customers
  add column if not exists email_normalized text
  generated always as (lower(btrim(email))) stored;

update public.customers
set phone_normalized = regexp_replace(coalesce(phone,''),'\D','','g')
where nullif(phone_normalized,'') is null
  and nullif(phone,'') is not null;

create index if not exists customers_email_normalized_idx
  on public.customers(email_normalized)
  where email_normalized is not null;

create index if not exists customers_phone_normalized_idx
  on public.customers(phone_normalized)
  where phone_normalized is not null;
