-- Keep the public intake's lead/appointment relationship atomic. This is an
-- internal service-role RPC; the browser can only reach public-intake.
create or replace function public.create_public_intake_records(
  p_lead jsonb,
  p_appointment jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead public.leads;
  v_appointment public.appointments;
begin
  insert into public.leads(
    external_id, client_request_id, public_reference, location_id, name, phone,
    email, service, source, notes, device_type, device_model, intake_method,
    shipping_address, preferred_date, preferred_time, consent_at, status
  ) values (
    p_lead->>'external_id',
    nullif(p_lead->>'client_request_id','')::uuid,
    p_lead->>'public_reference',
    (p_lead->>'location_id')::uuid,
    p_lead->>'name', p_lead->>'phone', p_lead->>'email', p_lead->>'service',
    p_lead->>'source', p_lead->>'notes', p_lead->>'device_type',
    p_lead->>'device_model', p_lead->>'intake_method', p_lead->'shipping_address',
    nullif(p_lead->>'preferred_date','')::date,
    nullif(p_lead->>'preferred_time',''),
    (p_lead->>'consent_at')::timestamptz,
    coalesce(p_lead->>'status','new')
  ) returning * into v_lead;

  if p_appointment is not null then
    insert into public.appointments(
      location_id, lead_id, device_description, service_requested,
      preferred_date, preferred_time, service_mode, status, notes
    ) values (
      (p_appointment->>'location_id')::uuid, v_lead.id,
      p_appointment->>'device_description', p_appointment->>'service_requested',
      nullif(p_appointment->>'preferred_date','')::date,
      nullif(p_appointment->>'preferred_time',''),
      coalesce(p_appointment->>'service_mode','walk_in'),
      coalesce(p_appointment->>'status','requested'),
      p_appointment->>'notes'
    ) returning * into v_appointment;

    update public.leads set appointment_id = v_appointment.id
    where id = v_lead.id;
    v_lead.appointment_id := v_appointment.id;
  end if;

  return jsonb_build_object(
    'lead', to_jsonb(v_lead),
    'appointment_id', v_appointment.id
  );
end;
$$;

revoke all on function public.create_public_intake_records(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.create_public_intake_records(jsonb,jsonb) to service_role;

