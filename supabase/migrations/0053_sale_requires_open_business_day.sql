-- GotCracked Portal: no sale can post outside an explicitly opened business day.
create or replace function public.enforce_open_business_day_for_sale()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  biz_date date;
begin
  if new.status::text='sale_complete' and coalesce(old.status::text,'')<>'sale_complete' then
    biz_date:=coalesce(new.sale_business_date,public.current_business_date(new.location_id));
    if not exists(
      select 1 from public.business_day_sessions s
      where s.location_id=new.location_id and s.business_date=biz_date and s.status='open'
    ) then
      raise exception 'Start Day must be completed before a sale can be posted.';
    end if;
    if exists(
      select 1 from public.daily_closeouts c
      where c.location_id=new.location_id and c.business_date=biz_date and c.status='closed'
    ) then
      raise exception 'This business day is closed. Reopen it before posting another sale.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_repair_ticket_requires_open_business_day on public.repair_tickets;
create trigger trg_repair_ticket_requires_open_business_day
before update of status on public.repair_tickets
for each row execute function public.enforce_open_business_day_for_sale();

revoke all on function public.enforce_open_business_day_for_sale() from public,anon,authenticated;
