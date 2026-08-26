alter table public.profiles add column if not exists portal_email text;
alter table public.profiles add column if not exists onboarding_status text not null default 'active'
  check (onboarding_status in ('invite_created','discord_pending','password_change_required','active','disabled'));
alter table public.profiles add column if not exists discord_invite_expires_at timestamptz;

create unique index if not exists profiles_portal_email_unique_idx
  on public.profiles (lower(portal_email)) where portal_email is not null;

comment on column public.profiles.portal_email is 'Automatically assigned GotCracked Portal login address.';
comment on column public.profiles.onboarding_status is 'Current staff onboarding checkpoint shared across Portal users.';

