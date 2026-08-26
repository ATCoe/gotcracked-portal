create table if not exists public.google_integrations (
  location_id uuid primary key references public.locations(id) on delete cascade,
  connected_email text,
  refresh_token text not null,
  scopes text[] not null default '{}',
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.google_integrations enable row level security;
revoke all on public.google_integrations from anon, authenticated;

create table if not exists public.google_oauth_states (
  state text primary key,
  location_id uuid not null references public.locations(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes')
);
alter table public.google_oauth_states enable row level security;
revoke all on public.google_oauth_states from anon, authenticated;
create index if not exists google_oauth_states_expires_idx on public.google_oauth_states(expires_at);

comment on table public.google_integrations is 'Server-only Google OAuth connection state. Access only through service-role Edge Functions.';
comment on column public.google_integrations.refresh_token is 'Google OAuth refresh token; never expose through PostgREST or browser code.';

update public.business_settings
set website_url = coalesce(website_url, 'https://gotcracked.co/'),
    google_search_console_property = coalesce(google_search_console_property, 'sc-domain:gotcracked.co'),
    updated_at = now();
