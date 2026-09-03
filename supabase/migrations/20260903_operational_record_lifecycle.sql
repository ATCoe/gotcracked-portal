-- Production records need an intentional close path. Do not hard-delete work
-- orders, leads, or booked appointments: they can be linked to inventory,
-- payments, staff activity, and customer communication. These routines close
-- the operational record, preserve its history, and release only resources
-- that are still safely releasable.

alter table public.repair_tickets
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id) on delete set null,
  add column if not exists cancellation_note text;

create or replace function public.cancel_work_order(
  target_ticket uuid,
  cancellation_note_input text
)
returns public.repair_tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  current_ticket public.repair_tickets;
  saved public.repair_tickets;
  note_text text := nullif(btrim(coalesce(cancellation_note_input, '')), '');
begin
  if auth.uid() is null or not coalesce(public.has_permission('repairs.workflow'), false) then
    raise exception 'Repair workflow permission is required to cancel a work order.';
  end if;
  if note_text is null or length(note_text) < 3 then
    raise exception 'Add a brief cancellation reason.';
  end if;

  select * into current_ticket
  from public.repair_tickets
  where id = target_ticket
    and location_id = public.current_location_id()
  for update;
  if current_ticket.id is null then raise exception 'Work order not found.'; end if;
  if current_ticket.status::text in ('sale_complete', 'completed', 'cancelled') then
    raise exception 'This work order is already closed and cannot be cancelled.';
  end if;
  if coalesce(current_ticket.amount_paid_cents, 0) > 0
     or current_ticket.payment_status in ('partial', 'paid')
     or exists (
       select 1 from public.payment_requests
       where ticket_id = current_ticket.id and status in ('partial', 'verified')
     )
     or exists (select 1 from public.receipts where ticket_id = current_ticket.id) then
    raise exception 'Refund or void the recorded payment before cancelling this work order.';
  end if;

  -- Never leave an open checkout path or reserved physical stock behind.
  update public.payment_requests
  set status = 'cancelled', updated_at = now()
  where ticket_id = current_ticket.id
    and status in ('pending', 'awaiting_external_confirmation');

  update public.inventory_reservations
  set status = 'released', released_at = now(), updated_at = now(),
      note = concat_ws(' · ', nullif(note, ''), 'Released because the work order was cancelled')
  where demand_id in (
    select id from public.part_demands
    where ticket_id = current_ticket.id and status not in ('fulfilled', 'cancelled')
  ) and status = 'reserved';

  update public.part_demands
  set status = 'cancelled', quantity_reserved = 0, updated_at = now(),
      notes = concat_ws(E'\n', nullif(notes, ''), 'Cancelled with work order: ' || note_text)
  where ticket_id = current_ticket.id and status not in ('fulfilled', 'cancelled');

  perform set_config('app.repair_status_advance', 'allowed', true);
  update public.repair_tickets
  set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
      cancellation_note = note_text, updated_at = now()
  where id = current_ticket.id
  returning * into saved;

  insert into public.ticket_events(ticket_id, actor_user_id, event_type, message)
  values (saved.id, auth.uid(), 'cancelled', 'Work order cancelled · ' || note_text);
  return saved;
end;
$$;

create or replace function public.cancel_lead(
  target_lead uuid,
  cancellation_note_input text
)
returns public.leads
language plpgsql
security definer
set search_path = public
as $$
declare
  current_lead public.leads;
  saved public.leads;
  note_text text := nullif(btrim(coalesce(cancellation_note_input, '')), '');
begin
  if auth.uid() is null or not coalesce(public.has_permission('leads.manage'), false) then
    raise exception 'Lead management permission is required to close a lead.';
  end if;
  if note_text is null or length(note_text) < 3 then
    raise exception 'Add a brief closure reason.';
  end if;

  select * into current_lead
  from public.leads
  where id = target_lead
    and (location_id is null or location_id = public.current_location_id())
  for update;
  if current_lead.id is null then raise exception 'Lead not found.'; end if;
  if current_lead.converted_ticket_id is not null or current_lead.pipeline_status = 'converted' then
    raise exception 'This lead has a work order. Cancel that work order instead so the repair history stays connected.';
  end if;

  update public.appointments
  set status = 'cancelled', cancelled_at = coalesce(cancelled_at, now()),
      notes = concat_ws(E'\n', nullif(notes, ''), 'Cancelled with lead: ' || note_text), updated_at = now()
  where lead_id = current_lead.id and status not in ('cancelled', 'completed', 'no_show');

  update public.inventory_reservations
  set status = 'released', released_at = now(), updated_at = now(),
      note = concat_ws(' · ', nullif(note, ''), 'Released because the lead was closed')
  where demand_id in (
    select id from public.part_demands
    where lead_id = current_lead.id and status not in ('fulfilled', 'cancelled')
  ) and status = 'reserved';

  update public.part_demands
  set status = 'cancelled', quantity_reserved = 0, updated_at = now(),
      notes = concat_ws(E'\n', nullif(notes, ''), 'Cancelled with lead: ' || note_text)
  where lead_id = current_lead.id and status not in ('fulfilled', 'cancelled');

  update public.leads
  set pipeline_status = 'lost', status = 'lost', updated_at = now(),
      last_contact_note = note_text
  where id = current_lead.id
  returning * into saved;

  insert into public.lead_events(lead_id, actor_user_id, event_type, message)
  values (saved.id, auth.uid(), 'cancelled', 'Lead closed · ' || note_text);
  return saved;
end;
$$;

revoke all on function public.cancel_work_order(uuid, text) from public, anon;
revoke all on function public.cancel_lead(uuid, text) from public, anon;
grant execute on function public.cancel_work_order(uuid, text) to authenticated;
grant execute on function public.cancel_lead(uuid, text) to authenticated;