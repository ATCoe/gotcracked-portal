-- GotCracked Portal: hard accounting guardrails for finalized End Day closeouts.
create or replace function public.validate_daily_closeout_integrity()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  calculated_net integer;
begin
  if new.status='closed' and (tg_op='INSERT' or coalesce(old.status,'')<>'closed') then
    if not exists(
      select 1 from public.business_day_sessions s
      where s.location_id=new.location_id
        and s.business_date=new.business_date
        and s.status='open'
    ) then
      raise exception 'Start Day must be completed before End Day reconciliation.';
    end if;
    if nullif(trim(coalesce(new.pos_reference,'')),'') is null then
      raise exception 'A printed POS closeout/report reference is required.';
    end if;
    calculated_net:=coalesce(new.pos_gross_sales_cents,0)-coalesce(new.pos_discount_cents,0)-coalesce(new.pos_refund_cents,0);
    if abs(coalesce(new.pos_net_sales_cents,0)-calculated_net)>1 then
      raise exception 'POS net sales must match gross sales minus discounts and refunds.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_daily_closeout_integrity on public.daily_closeouts;
create trigger trg_daily_closeout_integrity
before insert or update of status,pos_reference,pos_gross_sales_cents,pos_discount_cents,pos_refund_cents,pos_net_sales_cents
on public.daily_closeouts
for each row execute function public.validate_daily_closeout_integrity();

revoke all on function public.validate_daily_closeout_integrity() from public,anon,authenticated;
