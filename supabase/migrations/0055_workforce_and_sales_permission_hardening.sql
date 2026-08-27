-- GotCracked Portal: workforce + sales permission hardening.
-- Retire the obsolete clock RPC, align time-clock policy with permission overrides,
-- and make location-scoped business settings resilient for newly created stores.

-- Production uses time_clock_action(text). The legacy workforce_clock(text)
-- bypasses the current timeclock.use authorization and must not remain callable.
revoke all on function public.workforce_clock(text) from public, anon, authenticated;

create or replace function public.save_workforce_settings(
  early_minutes integer,
  late_minutes integer,
  overtime_hours numeric,
  require_schedule boolean,
  enforce_early boolean
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  loc uuid:=public.current_location_id();
begin
  if auth.uid() is null or loc is null
     or not coalesce(public.has_permission('timeclock.manage'),false) then
    raise exception 'Time-clock management permission is required.';
  end if;
  if early_minutes not between 0 and 240 or late_minutes not between 0 and 240 then
    raise exception 'Clock-in windows must be between 0 and 240 minutes.';
  end if;
  if overtime_hours < 1 or overtime_hours > 168 then
    raise exception 'Overtime warning hours are invalid.';
  end if;

  insert into public.business_settings(
    location_id,
    timeclock_early_clock_in_minutes,
    timeclock_late_grace_minutes,
    timeclock_overtime_warning_hours,
    timeclock_require_scheduled_shift,
    timeclock_enforce_early_window,
    updated_at
  ) values (
    loc,early_minutes,late_minutes,overtime_hours,
    coalesce(require_schedule,false),coalesce(enforce_early,false),now()
  )
  on conflict(location_id) do update set
    timeclock_early_clock_in_minutes=excluded.timeclock_early_clock_in_minutes,
    timeclock_late_grace_minutes=excluded.timeclock_late_grace_minutes,
    timeclock_overtime_warning_hours=excluded.timeclock_overtime_warning_hours,
    timeclock_require_scheduled_shift=excluded.timeclock_require_scheduled_shift,
    timeclock_enforce_early_window=excluded.timeclock_enforce_early_window,
    updated_at=now();

  return jsonb_build_object(
    'early_clock_in_minutes',early_minutes,
    'late_grace_minutes',late_minutes,
    'overtime_warning_hours',overtime_hours,
    'require_scheduled_shift',coalesce(require_schedule,false),
    'enforce_early_window',coalesce(enforce_early,false)
  );
end;
$$;

create or replace function public.save_predictive_sales_settings(
  target_splh_value numeric,
  growth_target_pct numeric default 0,
  adaptive_enabled boolean default true
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  loc uuid:=public.current_location_id();
begin
  if loc is null or not coalesce(public.has_permission('settings.manage'),false) then
    raise exception 'Management permission required.';
  end if;
  if target_splh_value is null or target_splh_value<=0 or target_splh_value>10000 then
    raise exception 'Target sales per labor hour must be greater than zero.';
  end if;
  if growth_target_pct<-50 or growth_target_pct>200 then
    raise exception 'Growth target is outside the allowed range.';
  end if;

  insert into public.business_settings(location_id,target_splh,updated_at)
  values(loc,target_splh_value,now())
  on conflict(location_id) do update set
    target_splh=excluded.target_splh,
    updated_at=now();

  insert into public.sales_goal_settings(
    location_id,launch_daily_goal_cents,adaptive_enabled,
    growth_target_pct,updated_by,updated_at
  ) values (
    loc,null,coalesce(adaptive_enabled,true),
    coalesce(growth_target_pct,0),auth.uid(),now()
  )
  on conflict(location_id) do update set
    launch_daily_goal_cents=null,
    adaptive_enabled=excluded.adaptive_enabled,
    growth_target_pct=excluded.growth_target_pct,
    updated_by=auth.uid(),
    updated_at=now();
end;
$$;

revoke all on function public.save_workforce_settings(integer,integer,numeric,boolean,boolean)
  from public,anon;
grant execute on function public.save_workforce_settings(integer,integer,numeric,boolean,boolean)
  to authenticated;

revoke all on function public.save_predictive_sales_settings(numeric,numeric,boolean)
  from public,anon;
grant execute on function public.save_predictive_sales_settings(numeric,numeric,boolean)
  to authenticated;

-- workforce_clock(text) intentionally receives no authenticated grant.
-- time_clock_action(text) is the sole production staff clock write RPC.
