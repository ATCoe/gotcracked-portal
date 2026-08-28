alter table public.staff_compensation add column if not exists commission_percent numeric(5,2) not null default 0;
alter table public.staff_compensation add column if not exists commission_scope text not null default 'none';

alter table public.staff_compensation drop constraint if exists staff_compensation_commission_percent_check;
alter table public.staff_compensation add constraint staff_compensation_commission_percent_check
  check (commission_percent >= 0 and commission_percent <= 100);

alter table public.staff_compensation drop constraint if exists staff_compensation_commission_scope_check;
alter table public.staff_compensation add constraint staff_compensation_commission_scope_check
  check (commission_scope in ('none','store_sales'));

create or replace function public.get_staff_commission_summary(
  target_profile uuid,
  range_start date,
  range_end date
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  loc uuid:=public.current_location_id();
  actor_role text:=public.current_staff_role();
  comp public.staff_compensation;
  sales_cents bigint:=0;
  commission_cents bigint:=0;
begin  if auth.uid() is null or loc is null then
    raise exception 'Active staff access is required.';
  end if;
  if actor_role <> 'owner' then
    raise exception 'Owner access is required to view compensation.';
  end if;
  if range_start is null or range_end is null or range_end < range_start then
    raise exception 'Choose a valid date range.';
  end if;

  select * into comp
  from public.staff_compensation
  where profile_id=target_profile and location_id=loc;

  if comp.profile_id is null then
    raise exception 'Compensation profile not found.';
  end if;

  if comp.commission_scope='store_sales' and comp.commission_percent>0 then
    select coalesce(sum(coalesce(r.subtotal_cents,0)),0)
      into sales_cents
    from public.receipts r
    where r.location_id=loc
      and r.business_date between range_start and range_end;

    sales_cents:=greatest(0,sales_cents);
    commission_cents:=round(sales_cents * comp.commission_percent / 100.0);
  end if;
  return jsonb_build_object(
    'profile_id',target_profile,
    'range_start',range_start,
    'range_end',range_end,
    'weekly_salary_cents',comp.weekly_salary_cents,
    'commission_percent',comp.commission_percent,
    'commission_scope',comp.commission_scope,
    'commissionable_store_sales_cents',sales_cents,
    'commission_earned_cents',commission_cents,
    'basis','receipt subtotal before tax; discounts/refunds reflected in finalized receipt subtotal'
  );
end;
$$;

revoke all on function public.get_staff_commission_summary(uuid,date,date) from public,anon;
grant execute on function public.get_staff_commission_summary(uuid,date,date) to authenticated;
