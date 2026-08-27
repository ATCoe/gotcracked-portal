alter table public.business_settings
  add column if not exists marlon_display_name text not null default 'Marlon',
  add column if not exists marlon_role_label text not null default 'Employee Support',
  add column if not exists marlon_avatar_url text,
  add column if not exists marlon_launcher_label text not null default 'Need Help?',
  add column if not exists marlon_discord_avatar_sync boolean not null default true;

comment on column public.business_settings.marlon_avatar_url is
  'Canonical HTTPS image URL used by the Portal Marlon avatar and optional Discord bot avatar sync.';

comment on column public.business_settings.marlon_launcher_label is
  'Compact Portal launcher label; mobile renders as a question mark.';
