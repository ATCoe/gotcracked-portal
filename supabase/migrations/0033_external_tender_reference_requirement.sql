-- Every manual intake tender is finalized outside the Portal. Require the employee
-- to record the external POS/provider confirmation before a work order can use it.
create or replace function public.record_manual_prepayment(
  paid_amount_cents integer,
  paid_method text,
  paid_reference text default null,
  payment_note text default null
)
returns public.payment_requests
language plpgsql
security definer
set search_path = public
as $$
declare saved public.payment_requests; loc uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not coalesce(public.has_permission('repairs.intake'),false) then
    raise exception 'You do not have permission to take repair intake payments';
  end if;
  if paid_method not in ('cash','external_pos_card','external_pos_other','cash_app','zelle','chime') then
    raise exception 'This payment method requires automatic provider verification';
  end if;
  if coalesce(paid_amount_cents,0) <= 0 then raise exception 'Enter the amount received'; end if;
  if not public.payment_method_enabled(paid_method) then raise exception 'That payment method is disabled'; end if;
  if nullif(btrim(coalesce(paid_reference,'')),'') is null then
    raise exception 'Enter the external POS or provider transaction/receipt reference';
  end if;

  loc := public.current_location_id();
  insert into public.payment_requests(
    location_id,purpose,amount_due_cents,amount_verified_cents,currency_code,
    payment_method,provider,verification_mode,status,payment_reference,note,
    requested_by,verified_by,verified_at
  ) values (
    loc,'repair_prepay',paid_amount_cents,paid_amount_cents,'USD',paid_method,
    case when paid_method in ('cash_app','zelle','chime') then paid_method else 'external_pos' end,
    'manual_staff','verified',btrim(paid_reference),
    nullif(btrim(coalesce(payment_note,'')),''),auth.uid(),auth.uid(),now()
  ) returning * into saved;
  return saved;
end;
$$;

revoke all on function public.record_manual_prepayment(integer,text,text,text) from public, anon;
grant execute on function public.record_manual_prepayment(integer,text,text,text) to authenticated;
