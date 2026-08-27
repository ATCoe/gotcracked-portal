-- Appointment command-center integrity follow-up.
-- Use the location timezone everywhere and match the actual customer name schema.

create or replace function public.get_appointment_command_center(range_start date, range_end date)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  loc uuid:=public.current_location_id();
  tz text:='America/New_York';
  can_manage boolean:=coalesce(public.has_permission('appointments.manage'),false);
  result jsonb;
begin
  if auth.uid() is null or loc is null or not coalesce(public.has_permission('appointments.view'),false) then
    raise exception 'You do not have permission to view appointments.';
  end if;
  if range_end < range_start or range_end-range_start > 62 then raise exception 'Invalid appointment range.'; end if;
  select coalesce(l.timezone,'America/New_York') into tz from public.locations l where l.id=loc;

  select jsonb_build_object(
    'can_manage',can_manage,
    'timezone',tz,
    'appointments',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',a.id,'customer_id',a.customer_id,'lead_id',a.lead_id,'device_description',a.device_description,
        'service_requested',a.service_requested,'starts_at',a.starts_at,'preferred_date',a.preferred_date,
        'preferred_time',a.preferred_time,'status',a.status,'notes',a.notes,'service_mode',a.service_mode,
        'duration_minutes',a.duration_minutes,'assigned_user_id',a.assigned_user_id,'assigned_name',p.display_name,
        'source',a.source,'created_at',a.created_at,'updated_at',a.updated_at,
        'lead_name',l.name,'lead_phone',l.phone,'lead_email',l.email,'lead_status',l.status,
        'customer_name',nullif(btrim(concat_ws(' ',c.first_name,c.last_name)),''),
        'customer_phone',c.phone,'customer_email',c.email
      ) order by coalesce(a.starts_at,a.preferred_date::timestamptz),a.created_at)
      from public.appointments a
      left join public.leads l on l.id=a.lead_id
      left join public.customers c on c.id=a.customer_id
      left join public.profiles p on p.id=a.assigned_user_id
      where a.location_id=loc
        and coalesce((a.starts_at at time zone tz)::date,a.preferred_date,(a.created_at at time zone tz)::date) between range_start and range_end
    ),'[]'::jsonb),
    'staff',case when can_manage then coalesce((
      select jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'role',p.role) order by p.display_name)
      from public.profiles p where p.location_id=loc and p.active=true
    ),'[]'::jsonb) else '[]'::jsonb end,
    'conflicts',case when can_manage then coalesce((
      select jsonb_agg(jsonb_build_object(
        'appointment_id',a.id,'other_appointment_id',b.id,'assigned_user_id',a.assigned_user_id,
        'assigned_name',p.display_name,'starts_at',a.starts_at,'message','Assigned technician has overlapping appointments'
      ))
      from public.appointments a
      join public.appointments b on b.location_id=a.location_id and b.assigned_user_id=a.assigned_user_id and b.id>a.id
        and b.status not in ('cancelled','completed','no_show') and a.status not in ('cancelled','completed','no_show')
        and a.starts_at is not null and b.starts_at is not null
        and a.starts_at < b.starts_at + make_interval(mins=>b.duration_minutes)
        and b.starts_at < a.starts_at + make_interval(mins=>a.duration_minutes)
      left join public.profiles p on p.id=a.assigned_user_id
      where a.location_id=loc and a.assigned_user_id is not null
        and (a.starts_at at time zone tz)::date between range_start and range_end
    ),'[]'::jsonb) else '[]'::jsonb end
  ) into result;
  return result;
end;
$$;

create or replace function public.create_staff_appointment(
  customer_name_input text,
  phone_input text,
  email_input text,
  device_input text,
  service_input text,
  starts_at_input timestamptz,
  duration_input integer default 60,
  assigned_user_input uuid default null,
  notes_input text default null
)
returns public.appointments
language plpgsql
security definer
set search_path=public
as $$
declare
  loc uuid:=public.current_location_id();
  tz text:='America/New_York';
  lead_row public.leads%rowtype;
  saved public.appointments;
begin
  if auth.uid() is null or loc is null or not coalesce(public.has_permission('appointments.manage'),false) then
    raise exception 'You do not have permission to create appointments.';
  end if;
  if nullif(btrim(coalesce(customer_name_input,'')),'') is null then raise exception 'Customer name is required.'; end if;
  if nullif(btrim(coalesce(service_input,'')),'') is null then raise exception 'Service requested is required.'; end if;
  if starts_at_input is null then raise exception 'Appointment time is required.'; end if;
  if coalesce(duration_input,60) not between 15 and 480 then raise exception 'Appointment duration is invalid.'; end if;
  if assigned_user_input is not null and not exists(select 1 from public.profiles where id=assigned_user_input and location_id=loc and active=true) then
    raise exception 'Assigned staff member is unavailable.';
  end if;
  select coalesce(l.timezone,'America/New_York') into tz from public.locations l where l.id=loc;

  insert into public.leads(location_id,name,phone,email,service,source,notes,status,pipeline_status,device_model,customer_issue,preferred_date,expected_arrival_at)
  values(
    loc,btrim(customer_name_input),nullif(btrim(coalesce(phone_input,'')),''),nullif(lower(btrim(coalesce(email_input,''))),''),
    btrim(service_input),'portal-appointment',nullif(btrim(coalesce(notes_input,'')),''),'qualified','qualified',
    nullif(btrim(coalesce(device_input,'')),''),btrim(service_input),(starts_at_input at time zone tz)::date,starts_at_input
  )
  returning * into lead_row;

  insert into public.appointments(location_id,lead_id,device_description,service_requested,starts_at,preferred_date,status,notes,service_mode,duration_minutes,assigned_user_id,source,confirmed_at)
  values(
    loc,lead_row.id,nullif(btrim(coalesce(device_input,'')),''),btrim(service_input),starts_at_input,
    (starts_at_input at time zone tz)::date,'confirmed',nullif(btrim(coalesce(notes_input,'')),''),'walk_in',
    coalesce(duration_input,60),assigned_user_input,'portal',now()
  )
  returning * into saved;

  update public.leads set appointment_id=saved.id,updated_at=now() where id=lead_row.id;
  return saved;
end;
$$;

create or replace function public.reschedule_appointment(
  appointment_id_input uuid,
  starts_at_input timestamptz,
  duration_input integer,
  assigned_user_input uuid default null,
  note_input text default null
)
returns public.appointments
language plpgsql
security definer
set search_path=public
as $$
declare
  saved public.appointments;
  loc uuid:=public.current_location_id();
  tz text:='America/New_York';
begin
  if auth.uid() is null or loc is null or not coalesce(public.has_permission('appointments.manage'),false) then raise exception 'Appointment management permission is required.'; end if;
  if starts_at_input is null or duration_input not between 15 and 480 then raise exception 'Choose a valid appointment time and duration.'; end if;
  if assigned_user_input is not null and not exists(select 1 from public.profiles where id=assigned_user_input and location_id=loc and active=true) then raise exception 'Assigned staff member is unavailable.'; end if;
  select coalesce(l.timezone,'America/New_York') into tz from public.locations l where l.id=loc;

  update public.appointments set
    starts_at=starts_at_input,duration_minutes=duration_input,assigned_user_id=assigned_user_input,
    status=case when status='requested' then 'confirmed' else status end,
    confirmed_at=case when status='requested' then now() else confirmed_at end,
    notes=case when nullif(btrim(coalesce(note_input,'')),'') is null then notes else concat_ws(E'\n',notes,btrim(note_input)) end,
    updated_at=now()
  where id=appointment_id_input and location_id=loc and status not in ('completed','cancelled')
  returning * into saved;
  if saved.id is null then raise exception 'Appointment not found or no longer editable.'; end if;
  update public.leads set expected_arrival_at=starts_at_input,preferred_date=(starts_at_input at time zone tz)::date,updated_at=now() where id=saved.lead_id;
  return saved;
end;
$$;

revoke all on function public.get_appointment_command_center(date,date) from public,anon;
revoke all on function public.create_staff_appointment(text,text,text,text,text,timestamptz,integer,uuid,text) from public,anon;
revoke all on function public.reschedule_appointment(uuid,timestamptz,integer,uuid,text) from public,anon;
grant execute on function public.get_appointment_command_center(date,date) to authenticated;
grant execute on function public.create_staff_appointment(text,text,text,text,text,timestamptz,integer,uuid,text) to authenticated;
grant execute on function public.reschedule_appointment(uuid,timestamptz,integer,uuid,text) to authenticated;
