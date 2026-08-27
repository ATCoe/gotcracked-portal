-- Marlon visual monitoring foundation
-- Tracks rendered Portal/website health across desktop, Android Chrome, and iOS/WebKit-class profiles.

create table if not exists public.marlon_visual_monitor_settings (
  location_id uuid primary key references public.locations(id) on delete cascade,
  enabled boolean not null default true,
  cadence_minutes integer not null default 5 check (cadence_minutes between 1 and 60),
  portal_enabled boolean not null default true,
  website_enabled boolean not null default true,
  desktop_enabled boolean not null default true,
  android_enabled boolean not null default true,
  ios_enabled boolean not null default true,
  auto_fix_safe boolean not null default true,
  notify_on_detection boolean not null default true,
  notify_on_resolution boolean not null default true,
  portal_url text not null default 'https://portal.gotcracked.co',
  website_url text not null default 'https://gotcracked.co',
  updated_at timestamptz not null default now()
);

insert into public.marlon_visual_monitor_settings(location_id, website_url)
select bs.location_id, coalesce(nullif(btrim(bs.website_url),''),'https://gotcracked.co')
from public.business_settings bs
on conflict (location_id) do update
set website_url = excluded.website_url,
    updated_at = now();

create table if not exists public.marlon_visual_monitor_runs (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  surface text not null check (surface in ('portal','website')),
  browser_profile text not null check (browser_profile in ('desktop_chrome','android_chrome','ios_safari')),
  browser_engine text not null default 'chromium',
  route text not null default '/',
  url text not null,
  status text not null check (status in ('healthy','bug','error')),
  http_status integer,
  duration_ms integer,
  screenshot_path text,
  screenshot_sha256 text,
  console_errors jsonb not null default '[]'::jsonb,
  network_errors jsonb not null default '[]'::jsonb,
  layout_metrics jsonb not null default '{}'::jsonb,
  analysis jsonb not null default '{}'::jsonb,
  fingerprint text,
  created_at timestamptz not null default now()
);

create index if not exists marlon_visual_monitor_runs_location_created_idx
  on public.marlon_visual_monitor_runs(location_id, created_at desc);
create index if not exists marlon_visual_monitor_runs_surface_profile_idx
  on public.marlon_visual_monitor_runs(location_id, surface, browser_profile, created_at desc);
create index if not exists marlon_visual_monitor_runs_fingerprint_idx
  on public.marlon_visual_monitor_runs(location_id, fingerprint)
  where fingerprint is not null;

create table if not exists public.marlon_visual_findings (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  ticket_id uuid references public.support_tickets(id) on delete set null,
  fingerprint text not null,
  surface text not null check (surface in ('portal','website')),
  browser_profile text not null check (browser_profile in ('desktop_chrome','android_chrome','ios_safari')),
  browser_engine text not null default 'chromium',
  route text not null default '/',
  severity text not null default 'normal' check (severity in ('low','normal','high','critical')),
  title text not null,
  description text not null,
  status text not null default 'detected' check (status in ('detected','fixing','verifying','resolved','ignored')),
  occurrence_count integer not null default 1,
  verification_passes integer not null default 0,
  confidence numeric(5,4),
  before_screenshot_path text,
  after_screenshot_path text,
  diagnosis text,
  action_taken text,
  fix_commit_sha text,
  verification jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(location_id, fingerprint)
);

create index if not exists marlon_visual_findings_active_idx
  on public.marlon_visual_findings(location_id, status, last_seen_at desc);
create index if not exists marlon_visual_findings_ticket_idx
  on public.marlon_visual_findings(ticket_id)
  where ticket_id is not null;

alter table public.marlon_visual_monitor_settings enable row level security;
alter table public.marlon_visual_monitor_runs enable row level security;
alter table public.marlon_visual_findings enable row level security;

drop policy if exists marlon_visual_monitor_settings_read on public.marlon_visual_monitor_settings;
create policy marlon_visual_monitor_settings_read
  on public.marlon_visual_monitor_settings for select to authenticated
  using (location_id = public.current_location_id());

drop policy if exists marlon_visual_monitor_settings_owner_update on public.marlon_visual_monitor_settings;
create policy marlon_visual_monitor_settings_owner_update
  on public.marlon_visual_monitor_settings for update to authenticated
  using (location_id = public.current_location_id() and coalesce(public.has_permission('staff.manage'), false))
  with check (location_id = public.current_location_id() and coalesce(public.has_permission('staff.manage'), false));

drop policy if exists marlon_visual_monitor_runs_read on public.marlon_visual_monitor_runs;
create policy marlon_visual_monitor_runs_read
  on public.marlon_visual_monitor_runs for select to authenticated
  using (location_id = public.current_location_id());

drop policy if exists marlon_visual_findings_read on public.marlon_visual_findings;
create policy marlon_visual_findings_read
  on public.marlon_visual_findings for select to authenticated
  using (location_id = public.current_location_id());

grant select on public.marlon_visual_monitor_settings to authenticated;
grant update on public.marlon_visual_monitor_settings to authenticated;
grant select on public.marlon_visual_monitor_runs to authenticated;
grant select on public.marlon_visual_findings to authenticated;

-- Screenshots can contain internal Portal content, so this bucket stays private.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('marlon-visual-monitor','marlon-visual-monitor',false,3500000,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists marlon_visual_monitor_screenshot_read on storage.objects;
create policy marlon_visual_monitor_screenshot_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'marlon-visual-monitor'
    and split_part(name,'/',1) = public.current_location_id()::text
  );

comment on table public.marlon_visual_monitor_runs is 'Rendered visual health checks performed by Marlon across Portal and website browser/device profiles.';
comment on table public.marlon_visual_findings is 'Deduplicated visible defects found by Marlon and linked to Portal support tickets.';
