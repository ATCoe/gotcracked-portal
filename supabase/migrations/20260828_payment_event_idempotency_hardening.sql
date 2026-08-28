-- Harden provider event retries and refund accounting.
create or replace function public.apply_provider_payment(
  target_provider text,target_event_id text,target_request uuid,target_transaction_id text,target_amount_cents integer,
  target_currency text default 'USD',target_payment_method text default 'online_checkout',target_card_brand text default null,
  target_card_last4 text default null,target_fee_cents integer default null,target_reference text default null,
  target_provider_session_id text default null,target_occurred_at timestamptz default now(),target_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  req public.payment_requests; session_row public.payment_checkout_sessions; t public.repair_tickets;
  net integer:=0; provider text:=lower(btrim(target_provider)); prior_event_status text; prior_tx_request uuid;
begin
  if coalesce(target_amount_cents,0)<=0 then raise exception 'Provider payment amount must be positive'; end if;
  select * into req from public.payment_requests where id=target_request for update;
  if req.id is null or req.provider is distinct from provider then raise exception 'Payment request/provider mismatch'; end if;
  select processing_status into prior_event_status from public.payment_provider_events where provider_key=provider and provider_event_id=target_event_id;
  if prior_event_status='processed' then
    if req.ticket_id is not null then select * into t from public.repair_tickets where id=req.ticket_id; end if;
    return jsonb_build_object('ok',true,'duplicate',true,'payment_request_id',req.id,'ticket_id',req.ticket_id,'verified_cents',req.amount_verified_cents,'request_status',req.status,'ticket_payment_status',t.payment_status,'ticket_amount_paid_cents',t.amount_paid_cents);
  end if;
  select payment_request_id into prior_tx_request from public.payment_transactions where provider_key=provider and provider_transaction_id=target_transaction_id and transaction_type='sale';
  if prior_tx_request is not null and prior_tx_request<>req.id then raise exception 'Provider transaction is already linked to a different payment request'; end if;
  insert into public.payment_provider_events(location_id,provider_key,provider_event_id,event_type,payment_request_id,payload_sha256,signature_verified,processing_status,metadata,processed_at,error_message)
  values(req.location_id,provider,target_event_id,'payment_succeeded',req.id,target_metadata->>'payload_sha256',true,'processed',coalesce(target_metadata,'{}'::jsonb),now(),null)
  on conflict(provider_key,provider_event_id) do update set
    location_id=excluded.location_id,event_type=excluded.event_type,payment_request_id=excluded.payment_request_id,
    payload_sha256=excluded.payload_sha256,signature_verified=true,processing_status='processed',metadata=excluded.metadata,processed_at=now(),error_message=null;
  select * into session_row from public.payment_checkout_sessions
  where payment_request_id=req.id and provider_key=provider
    and (target_provider_session_id is null or provider_session_id=target_provider_session_id)
  order by created_at desc limit 1 for update;
  insert into public.payment_transactions(location_id,ticket_id,payment_request_id,checkout_session_id,provider_key,provider_transaction_id,transaction_type,status,amount_cents,currency_code,payment_method,card_brand,card_last4,provider_fee_cents,reference,metadata,occurred_at)
  values(req.location_id,req.ticket_id,req.id,session_row.id,provider,target_transaction_id,'sale','succeeded',target_amount_cents,upper(coalesce(target_currency,'USD')),target_payment_method,nullif(btrim(target_card_brand),''),nullif(btrim(target_card_last4),''),target_fee_cents,nullif(btrim(target_reference),''),coalesce(target_metadata,'{}'::jsonb),coalesce(target_occurred_at,now()))
  on conflict(provider_key,provider_transaction_id,transaction_type) do nothing;
  if session_row.id is not null then
    update public.payment_checkout_sessions set status='paid',provider_payment_id=coalesce(provider_payment_id,target_transaction_id),updated_at=now() where id=session_row.id;
  end if;
  select greatest(coalesce(sum(case when transaction_type in ('sale','capture') and status='succeeded' then amount_cents when transaction_type='refund' and status='succeeded' then -amount_cents else 0 end),0),0)
    into net from public.payment_transactions where payment_request_id=req.id;
  update public.payment_requests set amount_verified_cents=net,
    status=case when net>=amount_due_cents then 'verified' when net>0 then 'partial' else 'pending' end,
    payment_reference=coalesce(nullif(btrim(target_reference),''),target_transaction_id),provider_event_id=target_event_id,
    verified_at=case when net>0 then coalesce(verified_at,now()) else null end,updated_at=now()
  where id=req.id returning * into req;
  if req.ticket_id is not null then t:=public.refresh_ticket_verified_payment_total(req.ticket_id); end if;
  return jsonb_build_object('ok',true,'duplicate',prior_tx_request=req.id,'payment_request_id',req.id,'ticket_id',req.ticket_id,'verified_cents',net,'request_status',req.status,'ticket_payment_status',t.payment_status,'ticket_amount_paid_cents',t.amount_paid_cents);
end; $$;

create or replace function public.apply_provider_refund(
  target_provider text,target_event_id text,target_request uuid,target_refund_transaction_id text,target_amount_cents integer,
  target_currency text default 'USD',target_reference text default null,target_occurred_at timestamptz default now(),target_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  req public.payment_requests; session_row public.payment_checkout_sessions; t public.repair_tickets;
  net integer:=0; captured integer:=0; refunded integer:=0; provider text:=lower(btrim(target_provider)); prior_event_status text; prior_tx_request uuid;
begin
  if coalesce(target_amount_cents,0)<=0 then raise exception 'Provider refund amount must be positive'; end if;
  select * into req from public.payment_requests where id=target_request for update;
  if req.id is null or req.provider is distinct from provider then raise exception 'Payment request/provider mismatch'; end if;
  select processing_status into prior_event_status from public.payment_provider_events where provider_key=provider and provider_event_id=target_event_id;
  if prior_event_status='processed' then
    if req.ticket_id is not null then select * into t from public.repair_tickets where id=req.ticket_id; end if;
    return jsonb_build_object('ok',true,'duplicate',true,'payment_request_id',req.id,'ticket_id',req.ticket_id,'verified_cents',req.amount_verified_cents,'request_status',req.status,'ticket_payment_status',t.payment_status,'ticket_amount_paid_cents',t.amount_paid_cents);
  end if;
  select payment_request_id into prior_tx_request from public.payment_transactions
  where provider_key=provider and provider_transaction_id=target_refund_transaction_id and transaction_type='refund';
  if prior_tx_request is not null and prior_tx_request<>req.id then raise exception 'Provider refund is already linked to a different payment request'; end if;
  if prior_tx_request=req.id then
    insert into public.payment_provider_events(location_id,provider_key,provider_event_id,event_type,payment_request_id,payload_sha256,signature_verified,processing_status,metadata,processed_at,error_message)
    values(req.location_id,provider,target_event_id,'refund_succeeded',req.id,target_metadata->>'payload_sha256',true,'processed',coalesce(target_metadata,'{}'::jsonb),now(),null)
    on conflict(provider_key,provider_event_id) do update set signature_verified=true,processing_status='processed',processed_at=now(),error_message=null;
    if req.ticket_id is not null then select * into t from public.repair_tickets where id=req.ticket_id; end if;
    return jsonb_build_object('ok',true,'duplicate',true,'payment_request_id',req.id,'ticket_id',req.ticket_id,'verified_cents',req.amount_verified_cents,'request_status',req.status,'ticket_payment_status',t.payment_status,'ticket_amount_paid_cents',t.amount_paid_cents);
  end if;
  select coalesce(sum(case when transaction_type in ('sale','capture') and status='succeeded' then amount_cents else 0 end),0),
         coalesce(sum(case when transaction_type='refund' and status='succeeded' then amount_cents else 0 end),0)
    into captured,refunded from public.payment_transactions where payment_request_id=req.id;
  if target_amount_cents>greatest(captured-refunded,0) then raise exception 'Refund exceeds the remaining captured provider payment'; end if;
  insert into public.payment_provider_events(location_id,provider_key,provider_event_id,event_type,payment_request_id,payload_sha256,signature_verified,processing_status,metadata,processed_at,error_message)
  values(req.location_id,provider,target_event_id,'refund_succeeded',req.id,target_metadata->>'payload_sha256',true,'processed',coalesce(target_metadata,'{}'::jsonb),now(),null)
  on conflict(provider_key,provider_event_id) do update set
    location_id=excluded.location_id,event_type=excluded.event_type,payment_request_id=excluded.payment_request_id,
    payload_sha256=excluded.payload_sha256,signature_verified=true,processing_status='processed',metadata=excluded.metadata,processed_at=now(),error_message=null;
  select * into session_row from public.payment_checkout_sessions where payment_request_id=req.id and provider_key=provider order by created_at desc limit 1;
  insert into public.payment_transactions(location_id,ticket_id,payment_request_id,checkout_session_id,provider_key,provider_transaction_id,transaction_type,status,amount_cents,currency_code,payment_method,reference,metadata,occurred_at)
  values(req.location_id,req.ticket_id,req.id,session_row.id,provider,target_refund_transaction_id,'refund','succeeded',target_amount_cents,upper(coalesce(target_currency,'USD')),'online_checkout',nullif(btrim(target_reference),''),coalesce(target_metadata,'{}'::jsonb),coalesce(target_occurred_at,now()))
  on conflict(provider_key,provider_transaction_id,transaction_type) do nothing;
  select greatest(coalesce(sum(case when transaction_type in ('sale','capture') and status='succeeded' then amount_cents when transaction_type='refund' and status='succeeded' then -amount_cents else 0 end),0),0)
    into net from public.payment_transactions where payment_request_id=req.id;
  update public.payment_requests set amount_verified_cents=net,
    status=case when net<=0 then 'refunded' when net>=amount_due_cents then 'verified' else 'partial' end,
    verified_at=case when net>0 then verified_at else null end,provider_event_id=target_event_id,updated_at=now()
  where id=req.id returning * into req;
  if req.ticket_id is not null then t:=public.refresh_ticket_verified_payment_total(req.ticket_id); end if;
  return jsonb_build_object('ok',true,'duplicate',prior_tx_request=req.id,'payment_request_id',req.id,'ticket_id',req.ticket_id,'verified_cents',net,'request_status',req.status,'ticket_payment_status',t.payment_status,'ticket_amount_paid_cents',t.amount_paid_cents);
end; $$;

revoke all on function public.apply_provider_payment(text,text,uuid,text,integer,text,text,text,text,integer,text,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.apply_provider_payment(text,text,uuid,text,integer,text,text,text,text,integer,text,text,timestamptz,jsonb) to service_role;
revoke all on function public.apply_provider_refund(text,text,uuid,text,integer,text,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.apply_provider_refund(text,text,uuid,text,integer,text,text,timestamptz,jsonb) to service_role;
