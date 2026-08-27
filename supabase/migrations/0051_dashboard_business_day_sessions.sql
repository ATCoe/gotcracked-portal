-- GotCracked Portal: explicit business-day lifecycle used by dashboard Start Day / End Day.
create table if not exists public.business_day_sessions (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  business_date date not null,
  status text not null default 'open' check (status in ('open','closed')),
  started_by uuid references public.profiles(id),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(location_id,business_date)
);

alter table public.business_day_sessions enable row level security;
drop policy if exists business_day_sessions_staff_read on public.business_day_sessions;
create policy business_day_sessions_staff_read on public.business_day_sessions
for select to authenticated
using (
  location_id=public.current_location_id()
  and (coalesce(public.has_permission('dashboard.view'),false) or coalesce(public.has_permission('settings.manage'),false))
);

revoke all on public.business_day_sessions from anon;
grant select on public.business_day_sessions to authenticated;

create or replace function public.start_business_day(target_date date default null)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  loc uuid:=public.current_location_id();
  biz_date date;
  row_item public.business_day_sessions;
begin
  if loc is null or not coalesce(public.has_permission('settings.manage'),false) then
    raise exception 'Management permission required to start a business day.';
  end if;
  biz_date:=coalesce(target_date,public.current_business_date(loc));
  if exists(select 1 from public.daily_closeouts where location_id=loc and business_date=biz_date and status='closed') then
    raise exception 'This business day is already closed. Reopen it before starting it again.';
  end if;
  insert into public.business_day_sessions(location_id,business_date,status,started_by,started_at,updated_at)
  values(loc,biz_date,'open',auth.uid(),now(),now())
  on conflict(location_id,business_date) do update set
    status='open',
    started_by=coalesce(public.business_day_sessions.started_by,excluded.started_by),
    started_at=coalesce(public.business_day_sessions.started_at,excluded.started_at),
    updated_at=now()
  returning * into row_item;
  return jsonb_build_object('business_date',row_item.business_date,'status','open','started_at',row_item.started_at,'started_by',row_item.started_by);
end;
$$;

create or replace function public.get_business_day_state(target_date date default null)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  loc uuid:=public.current_location_id();
  biz_date date;
  session_row public.business_day_sessions;
  close_row public.daily_closeouts;
begin
  if loc is null or not coalesce(public.has_permission('dashboard.view'),false) then
    raise exception 'You do not have permission to view business-day state.';
  end if;
  biz_date:=coalesce(target_date,public.current_business_date(loc));
  select * into session_row from public.business_day_sessions where location_id=loc and business_date=biz_date limit 1;
  select * into close_row from public.daily_closeouts where location_id=loc and business_date=biz_date limit 1;
  if close_row.id is not null and close_row.status='closed' then
    return jsonb_build_object('business_date',biz_date,'status','closed','started_at',session_row.started_at,'closed_at',close_row.closed_at,'started_by',session_row.started_by);
  end if;
  if session_row.id is not null or (close_row.id is not null and close_row.status='reopened') then
    return jsonb_build_object('business_date',biz_date,'status','open','started_at',session_row.started_at,'closed_at',null,'started_by',session_row.started_by);
  end if;
  return jsonb_build_object('business_date',biz_date,'status','not_started','started_at',null,'closed_at',null,'started_by',null);
end;
$$;

revoke all on function public.start_business_day(date) from public,anon;
revoke all on function public.get_business_day_state(date) from public,anon;
grant execute on function public.start_business_day(date) to authenticated;
grant execute on function public.get_business_day_state(date) to authenticated;
