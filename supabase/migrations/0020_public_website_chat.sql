-- Token-authenticated public website chat. Browser clients never access these
-- tables directly; the public-chat Edge Function owns validation and Discord sync.
create table if not exists public.website_chat_sessions (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  public_token_hash text not null,
  customer_name text not null,
  customer_email text,
  status text not null default 'open' check (status in ('open','closed')),
  discord_message_id text,
  discord_thread_id text,
  last_discord_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.website_chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.website_chat_sessions(id) on delete cascade,
  sender text not null check (sender in ('customer','staff','system')),
  body text not null check (char_length(body) between 1 and 1600),
  discord_message_id text unique,
  created_at timestamptz not null default now()
);

create index if not exists website_chat_messages_session_created_idx
  on public.website_chat_messages(session_id, created_at);

alter table public.website_chat_sessions enable row level security;
alter table public.website_chat_messages enable row level security;

-- No anon/authenticated policies are intentional. Service-role Edge Functions
-- are the only public chat data path.
revoke all on public.website_chat_sessions from anon, authenticated;
revoke all on public.website_chat_messages from anon, authenticated;
