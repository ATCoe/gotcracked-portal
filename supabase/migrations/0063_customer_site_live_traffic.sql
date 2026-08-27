-- First-party, privacy-conscious customer website traffic telemetry.
-- No raw IP address, customer name, email, phone, form contents, or full user-agent string is stored.

create table if not exists public.customer_site_sessions (
  location_id uuid not null references public.locations(id) on delete cascade,
  session_id text not null,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  landing_path text not null default '/',
  current_path text not null default '/',
  referrer_host text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  device_class text not null default 'desktop' check (device_class in ('desktop','mobile','tablet')),
  os_family text not null default 'other' check (os_family in ('android','ios','windows','macos','linux','chromeos','other')),
  browser_family text not null default 'other' check (browser_family in ('chrome','safari','edge','firefox','other')),
  viewport_width integer,
  viewport_height integer,
  page_views integer not null default 1,
  primary key(location_id, session_id)
);

create index if not exists customer_site_sessions_live_idx
  on public.customer_site_sessions(location_id, last_seen_at desc);
create index if not exists customer_site_sessions_started_idx
  on public.customer_site_sessions(location_id, started_at desc);

create table if not exists public.customer_site_events (
  id bigint generated always as identity primary key,
  location_id uuid not null references public.locations(id) on delete cascade,
  session_id text not null,
  event_type text not null default 'page_view' check (event_type in ('page_view')),
  path text not null default '/',
  occurred_at timestamptz not null default now()
);

create index if not exists customer_site_events_location_time_idx
  on public.customer_site_events(location_id, occurred_at desc);
create index if not exists customer_site_events_session_time_idx
  on public.customer_site_events(location_id, session_id, occurred_at desc);

alter table public.customer_site_sessions enable row level security;
alter table public.customer_site_events enable row level security;

drop policy if exists customer_site_sessions_management_read on public.customer_site_sessions;
create policy customer_site_sessions_management_read
  on public.customer_site_sessions for select to authenticated
  using (location_id=public.current_location_id() and coalesce(public.has_permission('reports.view'),false));

drop policy if exists customer_site_events_management_read on public.customer_site_events;
create policy customer_site_events_management_read
  on public.customer_site_events for select to authenticated
  using (location_id=public.current_location_id() and coalesce(public.has_permission('reports.view'),false));

grant select on public.customer_site_sessions to authenticated;
grant select on public.customer_site_events to authenticated;

create or replace function public.record_customer_site_traffic(
  p_location_id uuid,
  p_session_id text,
  p_event_type text,
  p_path text,
  p_referrer_host text,
  p_utm_source text,
  p_utm_medium text,
  p_utm_campaign text,
  p_device_class text,
  p_os_family text,
  p_browser_family text,
  p_viewport_width integer,
  p_viewport_height integer
) returns void
language plpgsql
security definer
set search_path='public'
as $function$
declare
  event_name text := case when p_event_type='page_view' then 'page_view' else 'heartbeat' end;
  path_value text := left(coalesce(nullif(btrim(p_path),''),'/'),300);
  session_value text := left(btrim(coalesce(p_session_id,'')),100);
  device_value text := case when p_device_class in ('desktop','mobile','tablet') then p_device_class else 'desktop' end;
  os_value text := case when p_os_family in ('android','ios','windows','macos','linux','chromeos','other') then p_os_family else 'other' end;
  browser_value text := case when p_browser_family in ('chrome','safari','edge','firefox','other') then p_browser_family else 'other' end;
begin
  if p_location_id is null or length(session_value)<8 then return; end if;

  insert into public.customer_site_sessions(
    location_id,session_id,started_at,last_seen_at,landing_path,current_path,referrer_host,
    utm_source,utm_medium,utm_campaign,device_class,os_family,browser_family,
    viewport_width,viewport_height,page_views
  ) values (
    p_location_id,session_value,now(),now(),path_value,path_value,left(nullif(btrim(p_referrer_host),''),180),
    left(nullif(btrim(p_utm_source),''),120),left(nullif(btrim(p_utm_medium),''),120),left(nullif(btrim(p_utm_campaign),''),160),
    device_value,os_value,browser_value,greatest(0,least(coalesce(p_viewport_width,0),10000)),
    greatest(0,least(coalesce(p_viewport_height,0),10000)),case when event_name='page_view' then 1 else 0 end
  )
  on conflict(location_id,session_id) do update set
    last_seen_at=now(),
    current_path=excluded.current_path,
    referrer_host=coalesce(public.customer_site_sessions.referrer_host,excluded.referrer_host),
    utm_source=coalesce(public.customer_site_sessions.utm_source,excluded.utm_source),
    utm_medium=coalesce(public.customer_site_sessions.utm_medium,excluded.utm_medium),
    utm_campaign=coalesce(public.customer_site_sessions.utm_campaign,excluded.utm_campaign),
    device_class=excluded.device_class,
    os_family=excluded.os_family,
    browser_family=excluded.browser_family,
    viewport_width=excluded.viewport_width,
    viewport_height=excluded.viewport_height,
    page_views=public.customer_site_sessions.page_views + case when event_name='page_view' then 1 else 0 end;

  if event_name='page_view' then
    insert into public.customer_site_events(location_id,session_id,event_type,path)
    values(p_location_id,session_value,'page_view',path_value);
  end if;
end;
$function$;

revoke all on function public.record_customer_site_traffic(uuid,text,text,text,text,text,text,text,text,text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.record_customer_site_traffic(uuid,text,text,text,text,text,text,text,text,text,text,integer,integer) to service_role;

create or replace function public.get_customer_site_live_traffic(
  p_live_minutes integer default 2,
  p_history_hours integer default 24
) returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare
  loc uuid;
  live_window interval;
  history_window interval;
  result jsonb;
begin
  if auth.uid() is null or not coalesce(public.has_permission('reports.view'),false) then
    raise exception 'Management reports permission required.';
  end if;
  loc := public.current_location_id();
  live_window := make_interval(mins => greatest(1,least(coalesce(p_live_minutes,2),15)));
  history_window := make_interval(hours => greatest(1,least(coalesce(p_history_hours,24),720)));

  select jsonb_build_object(
    'generated_at',now(),
    'active_visitors',(select count(*) from public.customer_site_sessions s where s.location_id=loc and s.last_seen_at>=now()-live_window),
    'sessions_today',(select count(*) from public.customer_site_sessions s where s.location_id=loc and s.started_at>=date_trunc('day',now())),
    'pageviews_history',(select count(*) from public.customer_site_events e where e.location_id=loc and e.occurred_at>=now()-history_window),
    'sessions_history',(select count(*) from public.customer_site_sessions s where s.location_id=loc and s.started_at>=now()-history_window),
    'active',coalesce((select jsonb_agg(to_jsonb(x) order by x.last_seen_at desc) from (
      select s.session_id,s.current_path,s.referrer_host,s.utm_source,s.device_class,s.os_family,s.browser_family,s.viewport_width,s.viewport_height,s.page_views,s.started_at,s.last_seen_at
      from public.customer_site_sessions s
      where s.location_id=loc and s.last_seen_at>=now()-live_window
      order by s.last_seen_at desc limit 50
    ) x),'[]'::jsonb),
    'top_pages',coalesce((select jsonb_agg(to_jsonb(x) order by x.views desc) from (
      select e.path,count(*)::int as views,count(distinct e.session_id)::int as sessions
      from public.customer_site_events e where e.location_id=loc and e.occurred_at>=now()-history_window
      group by e.path order by views desc limit 10
    ) x),'[]'::jsonb),
    'sources',coalesce((select jsonb_agg(to_jsonb(x) order by x.sessions desc) from (
      select coalesce(nullif(s.utm_source,''),nullif(s.referrer_host,''),'Direct') as source,count(*)::int as sessions
      from public.customer_site_sessions s where s.location_id=loc and s.started_at>=now()-history_window
      group by 1 order by sessions desc limit 10
    ) x),'[]'::jsonb),
    'devices',coalesce((select jsonb_agg(to_jsonb(x) order by x.sessions desc) from (
      select s.device_class,s.os_family,s.browser_family,count(*)::int as sessions
      from public.customer_site_sessions s where s.location_id=loc and s.started_at>=now()-history_window
      group by s.device_class,s.os_family,s.browser_family order by sessions desc limit 12
    ) x),'[]'::jsonb),
    'hourly',coalesce((select jsonb_agg(to_jsonb(x) order by x.hour) from (
      select date_trunc('hour',e.occurred_at) as hour,count(*)::int as pageviews,count(distinct e.session_id)::int as sessions
      from public.customer_site_events e where e.location_id=loc and e.occurred_at>=now()-history_window
      group by 1 order by 1
    ) x),'[]'::jsonb)
  ) into result;
  return result;
end;
$function$;

grant execute on function public.get_customer_site_live_traffic(integer,integer) to authenticated;

comment on table public.customer_site_sessions is 'Anonymous first-party website sessions for management live traffic monitoring. No raw IP or customer PII.';
comment on table public.customer_site_events is 'Anonymous first-party page-view events used for GotCracked management traffic analytics.';
