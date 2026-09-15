alter type public.staff_role add value if not exists 'automation';

create or replace function public.role_default_permission(target_role public.staff_role, permission_key text)
returns boolean language sql immutable set search_path to 'public' as $function$
  select case
    when target_role='owner' then true
    when target_role='manager' then permission_key=any(array['dashboard.view','repairs.view','repairs.intake','repairs.workflow','ready_pickup.view','ready_pickup.checkout','leads.view','leads.manage','appointments.view','appointments.manage','customers.view','customers.edit','inventory.view','inventory.manage','inventory.count','purchasing.view','purchasing.manage','reference.view','reference.manage','reports.view','staff.manage','settings.manage','pricing.override','labels.work_order','labels.inventory','schedule.view','schedule.manage','timeclock.use','timeclock.manage'])
    when target_role='technician' then permission_key=any(array['dashboard.view','repairs.view','repairs.intake','repairs.workflow','ready_pickup.view','leads.view','leads.manage','appointments.view','customers.view','inventory.view','reference.view','labels.work_order','schedule.view','timeclock.use'])
    when target_role='front_desk' then permission_key=any(array['dashboard.view','repairs.view','repairs.intake','ready_pickup.view','ready_pickup.checkout','leads.view','leads.manage','appointments.view','appointments.manage','customers.view','customers.edit','inventory.view','reference.view','labels.work_order','schedule.view','timeclock.use'])
    when target_role='automation' then permission_key=any(array['dashboard.view','repairs.view','repairs.workflow','leads.view','appointments.view','customers.view','inventory.view','reference.view'])
    else false end
$function$;
