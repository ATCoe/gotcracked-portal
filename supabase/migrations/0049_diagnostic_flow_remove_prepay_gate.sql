-- GotCracked Portal: diagnostic-only workflow + intake prepay retirement.
-- Payment remains enforced only at the Ready for Pickup -> Sale Complete boundary.

alter type public.ticket_status add value if not exists 'awaiting_diagnostic';
alter type public.ticket_status add value if not exists 'testing_in_progress';

alter table public.repair_tickets
  alter column prepay_required set default false;

update public.business_settings
set prepay_required_default = false,
    updated_at = now()
where prepay_required_default is distinct from false;

update public.repair_tickets
set prepay_required = false
where prepay_required is distinct from false;

drop trigger if exists repair_ticket_prepayment_guard on public.repair_tickets;

create or replace function public.get_payment_configuration()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare cfg public.business_settings;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into cfg from public.business_settings where location_id = public.current_location_id();
  if cfg.location_id is null then raise exception 'Business settings are not configured'; end if;
  return jsonb_build_object(
    'prepay_required', false,
    'routing_mode', cfg.payment_routing_mode,
    'methods', jsonb_build_object(
      'cash', cfg.payments_cash_enabled,
      'external_pos_card', cfg.payments_external_card_enabled,
      'external_pos_other', cfg.payments_external_other_enabled,
      'cash_app', cfg.payments_cash_app_enabled,
      'zelle', cfg.payments_zelle_enabled,
      'chime', cfg.payments_chime_enabled,
      'paypal', cfg.payments_paypal_enabled
    ),
    'paypal_automatic_verification', cfg.paypal_automatic_verification_enabled
  );
end;
$$;

create or replace function public.save_payment_configuration(
  required_default boolean,
  routing_mode text,
  cash_enabled boolean,
  external_card_enabled boolean,
  external_other_enabled boolean,
  cash_app_enabled boolean,
  zelle_enabled boolean,
  chime_enabled boolean,
  paypal_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare role_name text; loc uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  role_name := public.current_staff_role();
  if role_name not in ('owner','manager') or not coalesce(public.has_permission('settings.manage'),false) then
    raise exception 'Management permission is required to change payment settings';
  end if;
  if routing_mode not in ('internal','external','hybrid') then raise exception 'Choose a valid payment routing mode'; end if;
  loc := public.current_location_id();
  update public.business_settings set
    prepay_required_default = false,
    payment_routing_mode = routing_mode,
    payments_cash_enabled = coalesce(cash_enabled,false),
    payments_external_card_enabled = coalesce(external_card_enabled,false),
    payments_external_other_enabled = coalesce(external_other_enabled,false),
    payments_cash_app_enabled = coalesce(cash_app_enabled,false),
    payments_zelle_enabled = coalesce(zelle_enabled,false),
    payments_chime_enabled = coalesce(chime_enabled,false),
    payments_paypal_enabled = coalesce(paypal_enabled,false),
    updated_at = now()
  where location_id = loc;
  return public.get_payment_configuration();
end;
$$;

create or replace function public.guard_pending_intake_arrival_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare old_rest jsonb; new_rest jsonb;
begin
  if auth.uid() is null then return new; end if;
  if coalesce(public.has_permission('repairs.workflow'),false) then return new; end if;
  if not coalesce(public.has_permission('repairs.intake'),false) then return new; end if;
  if old.status::text <> 'awaiting_customer' or new.status::text not in ('awaiting_repair','awaiting_diagnostic') then return new; end if;
  if new.intake_session_id is null or new.arrived_at is null then raise exception 'Completed intake and arrival time are required.'; end if;
  old_rest := to_jsonb(old)-array['status','arrived_at','intake_summary','intake_session_id','customer_id','device_id','customer_issue','intake_method','updated_at'];
  new_rest := to_jsonb(new)-array['status','arrived_at','intake_summary','intake_session_id','customer_id','device_id','customer_issue','intake_method','updated_at'];
  if old_rest is distinct from new_rest then raise exception 'Intake-only staff may only update physical intake fields on a pending arrival.'; end if;
  return new;
end;
$$;

create or replace function public.enforce_repair_status_flow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_status text:=old.status::text;
  new_status text:=new.status::text;
  allowed boolean:=false;
begin
  if new.status is not distinct from old.status then return new; end if;

  if old_status='awaiting_customer' and new_status in ('awaiting_repair','awaiting_diagnostic')
     and coalesce(public.has_permission('repairs.intake'),false)
     and new.intake_session_id is not null and new.arrived_at is not null then
    return new;
  end if;

  if coalesce(current_setting('app.repair_status_advance',true),'')<>'allowed' then
    raise exception 'Repair stages must be advanced through the controlled workflow';
  end if;

  if new_status='repaired' and new.ready_for_pickup_at is null then
    new.ready_for_pickup_at:=now();
  end if;

  if new_status='awaiting_callback'
     and old_status not in ('repaired','sale_complete','unrepairable','customer_declined','abandoned','completed','cancelled') then
    new.status_before_callback:=old.status;
    return new;
  end if;

  if old_status='awaiting_callback' then
    allowed:=new.status=old.status_before_callback or new_status in ('unrepairable','customer_declined','cancelled');
    if not allowed then
      raise exception 'Awaiting callback must return to the paused stage or close with a documented outcome';
    end if;
    return new;
  end if;

  allowed:=case old_status
    when 'checked_in' then new_status in ('awaiting_repair','awaiting_diagnostic','need_to_order_parts','awaiting_parts','awaiting_callback','unrepairable','customer_declined','cancelled')
    when 'awaiting_approval' then new_status in ('awaiting_repair','awaiting_diagnostic','need_to_order_parts','awaiting_parts','awaiting_callback','unrepairable','customer_declined','cancelled')
    when 'waiting_on_parts' then new_status in ('awaiting_parts','diagnostic_in_progress','testing_in_progress','repair_in_progress','awaiting_callback','unrepairable','customer_declined','cancelled')
    when 'in_diagnosis' then new_status in ('diagnostic_in_progress','testing_in_progress','need_to_order_parts','awaiting_parts','quality_inspection','awaiting_callback','unrepairable','customer_declined','cancelled')
    when 'in_repair' then new_status in ('repair_in_progress','testing_in_progress','need_to_order_parts','awaiting_parts','quality_inspection','awaiting_callback','unrepairable','customer_declined','cancelled')
    when 'ready_for_pickup' then
      case
        when new_status='sale_complete' then new.payment_status in ('paid','waived') and new.paid_at is not null
        else new_status in ('repaired','unrepairable','customer_declined','completed','cancelled')
      end
    when 'awaiting_repair' then new_status in ('awaiting_diagnostic','need_to_order_parts','awaiting_parts','diagnostic_in_progress','testing_in_progress','repair_in_progress','awaiting_callback','unrepairable','customer_declined','cancelled')
    when 'awaiting_diagnostic' then new_status in ('testing_in_progress','diagnostic_in_progress','awaiting_callback','unrepairable','cancelled')
    when 'need_to_order_parts' then new_status in ('awaiting_parts','awaiting_callback','unrepairable','customer_declined','cancelled')
    when 'awaiting_parts' then new_status in ('diagnostic_in_progress','testing_in_progress','repair_in_progress','awaiting_callback','unrepairable','customer_declined','cancelled')
    when 'diagnostic_in_progress' then new_status in ('need_to_order_parts','awaiting_parts','testing_in_progress','repair_in_progress','quality_inspection','awaiting_callback','unrepairable','customer_declined','cancelled')
    when 'testing_in_progress' then new_status in ('awaiting_diagnostic','diagnostic_in_progress','quality_inspection','repaired','awaiting_callback','unrepairable','cancelled')
    when 'repair_in_progress' then new_status in ('need_to_order_parts','awaiting_parts','testing_in_progress','quality_inspection','awaiting_callback','unrepairable','customer_declined','cancelled')
    when 'quality_inspection' then new_status in ('diagnostic_in_progress','testing_in_progress','repair_in_progress','repaired','awaiting_callback','unrepairable','customer_declined','cancelled')
    when 'repaired' then
      case
        when new_status='sale_complete' then new.payment_status in ('paid','waived') and new.paid_at is not null
        when new_status='abandoned' then public.current_staff_role() in ('owner','manager')
          and now()>=coalesce(old.ready_for_pickup_at,old.updated_at)
            +coalesce((select abandoned_after_days from public.business_settings where location_id=old.location_id),30)*interval '1 day'
        else false
      end
    else false
  end;

  if not allowed then
    raise exception 'Invalid repair stage transition from % to %',replace(old_status,'_',' '),replace(new_status,'_',' ');
  end if;
  return new;
end;
$$;

insert into public.services(location_id,sku,name,description,category,cost_cents,price_cents,taxable,quote_required,active)
select location_id,'SVC-THOROUGH-DIAG','Thorough Diagnostic',
       'Extended bench diagnostic for issues that cannot be fully evaluated during quick intake. Uses the Awaiting Diagnostic -> Testing in Progress workflow and remains part of the normal repair lifecycle.',
       'Diagnostics',0,0,false,false,true
from public.business_settings
where not exists (
  select 1 from public.services s
  where s.location_id=business_settings.location_id and s.sku='SVC-THOROUGH-DIAG'
);

revoke all on function public.get_payment_configuration() from public, anon;
revoke all on function public.save_payment_configuration(boolean,text,boolean,boolean,boolean,boolean,boolean,boolean,boolean) from public, anon;
grant execute on function public.get_payment_configuration() to authenticated;
grant execute on function public.save_payment_configuration(boolean,text,boolean,boolean,boolean,boolean,boolean,boolean,boolean) to authenticated;
