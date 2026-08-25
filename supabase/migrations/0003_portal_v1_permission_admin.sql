-- GotCracked Portal 1.0 permission administration helpers.
-- Keeps per-user overrides auditable and prevents managers from modifying peers/owners.

create or replace function public.set_staff_permission_override(
  target_profile uuid,
  target_permission text,
  target_enabled boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  actor public.profiles;
  target public.profiles;
begin
  select * into actor from public.profiles where id = auth.uid() and active = true;
  select * into target from public.profiles where id = target_profile and active = true;

  if actor.id is null or actor.role not in ('owner','manager') then
    raise exception 'You do not have permission to manage staff permissions.';
  end if;
  if target.id is null or target.location_id is distinct from actor.location_id then
    raise exception 'Staff profile not found.';
  end if;
  if not exists (select 1 from public.permission_definitions where permission_key = target_permission) then
    raise exception 'Unknown permission.';
  end if;
  if target.role = 'owner' then
    raise exception 'Owner permissions are fixed at full access.';
  end if;
  if actor.role = 'manager' and target.role in ('owner','manager') then
    raise exception 'Managers cannot change owner or manager permissions.';
  end if;

  insert into public.staff_permission_overrides(profile_id,permission_key,enabled,updated_by,updated_at)
  values(target_profile,target_permission,target_enabled,auth.uid(),now())
  on conflict(profile_id,permission_key) do update
    set enabled=excluded.enabled, updated_by=excluded.updated_by, updated_at=excluded.updated_at;
end; $$;

create or replace function public.clear_staff_permission_override(
  target_profile uuid,
  target_permission text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  actor public.profiles;
  target public.profiles;
begin
  select * into actor from public.profiles where id = auth.uid() and active = true;
  select * into target from public.profiles where id = target_profile and active = true;
  if actor.id is null or actor.role not in ('owner','manager') then
    raise exception 'You do not have permission to manage staff permissions.';
  end if;
  if target.id is null or target.location_id is distinct from actor.location_id then
    raise exception 'Staff profile not found.';
  end if;
  if target.role = 'owner' then raise exception 'Owner permissions are fixed at full access.'; end if;
  if actor.role = 'manager' and target.role in ('owner','manager') then
    raise exception 'Managers cannot change owner or manager permissions.';
  end if;
  delete from public.staff_permission_overrides
  where profile_id=target_profile and permission_key=target_permission;
end; $$;

revoke all on function public.set_staff_permission_override(uuid,text,boolean) from public;
revoke all on function public.clear_staff_permission_override(uuid,text) from public;
grant execute on function public.set_staff_permission_override(uuid,text,boolean) to authenticated;
grant execute on function public.clear_staff_permission_override(uuid,text) to authenticated;
