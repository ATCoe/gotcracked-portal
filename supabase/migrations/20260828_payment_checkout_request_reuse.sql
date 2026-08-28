-- Reuse an active online checkout request across retries/refreshes.
create or replace function public.ensure_online_payment_request(target_ticket uuid,target_provider text,requested_amount_cents integer)
returns public.payment_requests
language plpgsql security definer set search_path=public as $$
declare t public.repair_tickets; cfg public.business_settings; conn public.payment_provider_connections; saved public.payment_requests; verified_total integer:=0; balance integer:=0; provider text:=lower(btrim(target_provider));
begin
  select * into t from public.repair_tickets where id=target_ticket for update;
  if t.id is null then raise exception 'Repair not found'; end if;
  select * into cfg from public.business_settings where location_id=t.location_id;
  if cfg.location_id is null or not cfg.customer_online_payments_enabled then raise exception 'Customer online payment is not enabled'; end if;
  if cfg.online_payment_provider_key is distinct from provider then raise exception 'Payment provider is not active for this location'; end if;
  select * into conn from public.payment_provider_connections where location_id=t.location_id and provider_key=provider;
  if conn.id is null or conn.connection_status<>'connected' then raise exception 'Payment provider is not connected'; end if;
  if not (cfg.customer_online_payment_stages ? t.status::text) then raise exception 'This repair is not eligible for online payment yet'; end if;
  select coalesce(sum(amount_verified_cents),0) into verified_total from public.payment_requests where ticket_id=t.id and status in ('partial','verified');
  balance:=greatest(coalesce(t.total_cents,0)-greatest(verified_total,coalesce(t.amount_paid_cents,0)),0);
  if balance<=0 then raise exception 'This repair has no remaining balance'; end if;
  if requested_amount_cents<=0 or requested_amount_cents>balance then raise exception 'Invalid payment amount'; end if;
  if not cfg.customer_online_partial_payments and requested_amount_cents<>balance then raise exception 'Partial online payments are not enabled'; end if;
  select * into saved from public.payment_requests
  where ticket_id=t.id and provider=provider and payment_method='online_checkout'
    and status in ('pending','awaiting_external_confirmation')
    and amount_due_cents=requested_amount_cents
    and created_at>now()-make_interval(mins=>cfg.payment_checkout_expiry_minutes)
  order by created_at desc limit 1;
  if saved.id is not null then return saved; end if;
  insert into public.payment_requests(location_id,ticket_id,customer_id,purpose,amount_due_cents,currency_code,payment_method,provider,verification_mode,status,metadata)
  values(t.location_id,t.id,t.customer_id,'repair_balance',requested_amount_cents,coalesce(cfg.currency_code,'USD'),'online_checkout',provider,'provider_callback','pending',jsonb_build_object('source','customer_account'))
  returning * into saved;
  return saved;
end; $$;

revoke all on function public.ensure_online_payment_request(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.ensure_online_payment_request(uuid,text,integer) to service_role;
