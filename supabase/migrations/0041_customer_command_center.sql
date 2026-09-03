-- GotCracked Portal: customer command center.
-- Adds a permission-aware customer search/detail RPC and normalized profile save path.

create unique index if not exists customers_location_phone_normalized_unique_idx
  on public.customers(location_id, phone_normalized)
  where nullif(phone_normalized,'') is not null;

create index if not exists customers_location_created_idx
  on public.customers(location_id, created_at desc);

create or replace function public.get_customer_command_center(
  search_input text default null,
  customer_id_input uuid default null,
  limit_input integer default 50,
  offset_input integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  loc uuid:=public.current_location_id();
  q text:=nullif(btrim(coalesce(search_input,'')),'');
  q_digits text:=regexp_replace(coalesce(search_input,''),'\D','','g');
  lim integer:=least(greatest(coalesce(limit_input,50),1),100);
  off integer:=greatest(coalesce(offset_input,0),0);
  can_edit boolean:=coalesce(public.has_permission('customers.edit'),false);
  can_intake boolean:=coalesce(public.has_permission('repairs.intake'),false);
  can_schedule boolean:=coalesce(public.has_permission('appointments.manage'),false);
  can_financial boolean:=coalesce(public.has_permission('repairs.view'),false)
    or coalesce(public.has_permission('ready_pickup.checkout'),false)
    or coalesce(public.has_permission('reports.view'),false);
  result jsonb;
  detail jsonb:=null;
begin
  if auth.uid() is null or loc is null or not coalesce(public.has_permission('customers.view'),false) then
    raise exception 'You do not have permission to view customers.';
  end if;

  if customer_id_input is not null then
    select jsonb_build_object(
      'customer',to_jsonb(c),
      'devices',coalesce((
        select jsonb_agg(to_jsonb(d) order by d.last_seen_at desc,d.created_at desc)
        from public.devices d
        where d.customer_id=c.id
      ),'[]'::jsonb),
      'repairs',coalesce((
        select jsonb_agg(jsonb_build_object(
          'id',t.id,
          'ticket_number',t.ticket_number,
          'status',t.status,
          'customer_issue',t.customer_issue,
          'diagnosis',t.diagnosis,
          'priority',t.priority,
          'total_cents',t.total_cents,
          'amount_paid_cents',t.amount_paid_cents,
          'payment_status',t.payment_status,
          'checked_in_at',t.checked_in_at,
          'ready_for_pickup_at',t.ready_for_pickup_at,
          'completed_at',t.completed_at,
          'pickup_at',t.pickup_at,
          'created_at',t.created_at,
          'updated_at',t.updated_at,
          'device_id',t.device_id,
          'device',jsonb_build_object(
            'category',d.category,
            'manufacturer',d.manufacturer,
            'model',d.model,
            'model_number',d.model_number,
            'serial_number',d.serial_number,
            'imei',d.imei
          ),
          'assigned_name',p.display_name
        ) order by t.created_at desc)
        from public.repair_tickets t
        left join public.devices d on d.id=t.device_id
        left join public.profiles p on p.id=t.assigned_user_id
        where t.location_id=loc and t.customer_id=c.id
      ),'[]'::jsonb),
      'appointments',coalesce((
        select jsonb_agg(jsonb_build_object(
          'id',a.id,
          'status',a.status,
          'starts_at',a.starts_at,
          'preferred_date',a.preferred_date,
          'preferred_time',a.preferred_time,
          'duration_minutes',a.duration_minutes,
          'device_description',a.device_description,
          'service_requested',a.service_requested,
          'assigned_name',p.display_name,
          'source',a.source,
          'notes',a.notes,
          'created_at',a.created_at
        ) order by coalesce(a.starts_at,a.created_at) desc)
        from public.appointments a
        left join public.profiles p on p.id=a.assigned_user_id
        where a.location_id=loc and a.customer_id=c.id
      ),'[]'::jsonb),
      'leads',coalesce((
        select jsonb_agg(jsonb_build_object(
          'id',l.id,
          'status',l.status,
          'pipeline_status',l.pipeline_status,
          'service',l.service,
          'device_category',l.device_category,
          'manufacturer',l.manufacturer,
          'model',l.model,
          'customer_issue',l.customer_issue,
          'source',l.source,
          'appointment_id',l.appointment_id,
          'converted_ticket_id',l.converted_ticket_id,
          'created_at',l.created_at,
          'updated_at',l.updated_at
        ) order by l.created_at desc)
        from public.leads l
        where l.location_id=loc and l.customer_id=c.id
      ),'[]'::jsonb),
      'receipts',case when can_financial then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id',r.id,
          'receipt_number',r.receipt_number,
          'ticket_id',r.ticket_id,
          'ticket_number',r.ticket_number,
          'business_date',r.business_date,
          'total_cents',r.total_cents,
          'amount_paid_cents',r.amount_paid_cents,
          'payment_method',r.payment_method,
          'created_at',r.created_at,
          'emailed_at',r.emailed_at,
          'printed_at',r.printed_at
        ) order by r.created_at desc)
        from public.receipts r
        where r.location_id=loc and r.customer_id=c.id
      ),'[]'::jsonb) else '[]'::jsonb end,
      'stats',jsonb_build_object(
        'device_count',(select count(*) from public.devices d where d.customer_id=c.id),
        'repair_count',(select count(*) from public.repair_tickets t where t.location_id=loc and t.customer_id=c.id),
        'active_repairs',(select count(*) from public.repair_tickets t where t.location_id=loc and t.customer_id=c.id and t.status::text not in ('sale_complete','abandoned','unrepairable','customer_declined','cancelled','completed')),
        'ready_for_pickup',(select count(*) from public.repair_tickets t where t.location_id=loc and t.customer_id=c.id and t.status::text in ('repaired','ready_for_pickup')),
        'lifetime_paid_cents',case when can_financial then coalesce((select sum(r.amount_paid_cents) from public.receipts r where r.location_id=loc and r.customer_id=c.id),0) else 0 end,
        'last_repair_at',(select max(coalesce(t.updated_at,t.created_at)) from public.repair_tickets t where t.location_id=loc and t.customer_id=c.id)
      )
    ) into detail
    from public.customers c
      where c.id=customer_id_input;

    if detail is null then raise exception 'Customer not found.'; end if;
  end if;

  with filtered as (
    select
      c.*,
      (select count(*) from public.devices d where d.customer_id=c.id)::integer as device_count,
      (select count(*) from public.repair_tickets t where t.location_id=loc and t.customer_id=c.id and t.status::text not in ('sale_complete','abandoned','unrepairable','customer_declined','cancelled','completed'))::integer as active_repairs,
      (select count(*) from public.repair_tickets t where t.location_id=loc and t.customer_id=c.id and t.status::text in ('repaired','ready_for_pickup'))::integer as ready_for_pickup,
      greatest(
        c.created_at,
        (select max(d.last_seen_at) from public.devices d where d.customer_id=c.id),
        (select max(coalesce(t.updated_at,t.created_at)) from public.repair_tickets t where t.location_id=loc and t.customer_id=c.id),
        (select max(coalesce(a.updated_at,a.created_at)) from public.appointments a where a.location_id=loc and a.customer_id=c.id),
        (select max(coalesce(l.updated_at,l.created_at)) from public.leads l where l.location_id=loc and l.customer_id=c.id)
      ) as last_activity
    from public.customers c
    where true
      and (
        q is null
        or concat_ws(' ',c.first_name,c.last_name) ilike '%'||q||'%'
        or c.phone ilike '%'||q||'%'
        or coalesce(c.contact_phone,'') ilike '%'||q||'%'
        or coalesce(c.email,'') ilike '%'||q||'%'
        or (q_digits<>'' and coalesce(c.phone_normalized,'') like '%'||q_digits||'%')
        or exists(
          select 1 from public.devices d
          where d.customer_id=c.id and concat_ws(' ',d.manufacturer,d.model,d.model_number,d.serial_number,d.imei) ilike '%'||q||'%'
        )
        or exists(
          select 1 from public.repair_tickets t
          where t.location_id=loc and t.customer_id=c.id and ('GC-'||lpad(t.ticket_number::text,6,'0')) ilike '%'||q||'%'
        )
      )
  ), paged as (
    select * from filtered
    order by last_activity desc nulls last, created_at desc
    limit lim offset off
  )
  select jsonb_build_object(
    'can_edit',can_edit,
    'can_intake',can_intake,
    'can_schedule',can_schedule,
    'can_financial',can_financial,
    'total',(select count(*) from filtered),
    'offset',off,
    'limit',lim,
    'summary',jsonb_build_object(
      'total_customers',(select count(*) from public.customers),
      'customers_with_active_repairs',(select count(distinct t.customer_id) from public.repair_tickets t where t.location_id=loc and t.status::text not in ('sale_complete','abandoned','unrepairable','customer_declined','cancelled','completed')),
      'customers_ready_for_pickup',(select count(distinct t.customer_id) from public.repair_tickets t where t.location_id=loc and t.status::text in ('repaired','ready_for_pickup')),
      'new_last_30_days',(select count(*) from public.customers c where c.created_at>=now()-interval '30 days')
    ),
    'customers',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',p.id,
        'first_name',p.first_name,
        'last_name',p.last_name,
        'phone',p.phone,
        'contact_phone',p.contact_phone,
        'email',p.email,
        'preferred_contact',p.preferred_contact,
        'city',p.city,
        'state',p.state,
        'created_at',p.created_at,
        'device_count',p.device_count,
        'active_repairs',p.active_repairs,
        'ready_for_pickup',p.ready_for_pickup,
        'last_activity',p.last_activity
      ) order by p.last_activity desc nulls last,p.created_at desc)
      from paged p
    ),'[]'::jsonb),
    'detail',detail
  ) into result;

  return result;
end;
$$;

create or replace function public.save_customer_profile(
  customer_id_input uuid default null,
  first_name_input text default null,
  last_name_input text default null,
  phone_input text default null,
  contact_phone_input text default null,
  email_input text default null,
  preferred_contact_input text default 'sms',
  address_line_1_input text default null,
  address_line_2_input text default null,
  city_input text default null,
  state_input text default null,
  postal_code_input text default null,
  notes_input text default null
)
returns public.customers
language plpgsql
security definer
set search_path=public
as $$
declare
  loc uuid:=public.current_location_id();
  normalized text:=regexp_replace(coalesce(phone_input,''),'\D','','g');
  saved public.customers;
  contact_method text:=lower(coalesce(nullif(btrim(preferred_contact_input),''),'sms'));
begin
  if auth.uid() is null or loc is null or not coalesce(public.has_permission('customers.edit'),false) then
    raise exception 'You do not have permission to edit customers.';
  end if;
  if nullif(btrim(coalesce(first_name_input,'')),'') is null then raise exception 'First name is required.'; end if;
  if length(normalized) < 7 then raise exception 'Enter a valid customer phone number.'; end if;
  if contact_method not in ('sms','call','email') then raise exception 'Preferred contact method is invalid.'; end if;
  if exists(
    select 1 from public.customers c
    where c.location_id=loc and c.phone_normalized=normalized and (customer_id_input is null or c.id<>customer_id_input)
  ) then raise exception 'A customer with this phone number already exists.'; end if;

  if customer_id_input is null then
    insert into public.customers(
      location_id,first_name,last_name,phone,phone_normalized,contact_phone,email,preferred_contact,notes,
      address_line_1,address_line_2,city,state,postal_code
    ) values(
      loc,btrim(first_name_input),coalesce(btrim(last_name_input),''),btrim(phone_input),normalized,
      coalesce(nullif(btrim(contact_phone_input),''),btrim(phone_input)),nullif(lower(btrim(coalesce(email_input,''))),''),contact_method,
      nullif(btrim(coalesce(notes_input,'')),''),nullif(btrim(coalesce(address_line_1_input,'')),''),nullif(btrim(coalesce(address_line_2_input,'')),''),
      nullif(btrim(coalesce(city_input,'')),''),nullif(upper(btrim(coalesce(state_input,''))),''),nullif(btrim(coalesce(postal_code_input,'')),'')
    ) returning * into saved;
  else
    update public.customers set
      first_name=btrim(first_name_input),
      last_name=coalesce(btrim(last_name_input),''),
      phone=btrim(phone_input),
      phone_normalized=normalized,
      contact_phone=coalesce(nullif(btrim(contact_phone_input),''),btrim(phone_input)),
      email=nullif(lower(btrim(coalesce(email_input,''))),''),
      preferred_contact=contact_method,
      notes=nullif(btrim(coalesce(notes_input,'')),''),
      address_line_1=nullif(btrim(coalesce(address_line_1_input,'')),''),
      address_line_2=nullif(btrim(coalesce(address_line_2_input,'')),''),
      city=nullif(btrim(coalesce(city_input,'')),''),
      state=nullif(upper(btrim(coalesce(state_input,''))),''),
      postal_code=nullif(btrim(coalesce(postal_code_input,'')),'')
    where id=customer_id_input and location_id=loc
    returning * into saved;
    if saved.id is null then raise exception 'Customer not found.'; end if;
  end if;

  return saved;
end;
$$;

revoke all on function public.get_customer_command_center(text,uuid,integer,integer) from public,anon;
revoke all on function public.save_customer_profile(uuid,text,text,text,text,text,text,text,text,text,text,text,text) from public,anon;
grant execute on function public.get_customer_command_center(text,uuid,integer,integer) to authenticated;
grant execute on function public.save_customer_profile(uuid,text,text,text,text,text,text,text,text,text,text,text,text) to authenticated;

