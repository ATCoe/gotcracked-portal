-- Portal store identity + multi-store-safe staff assignment guard.

update public.locations
set name = 'Blacksburg'
where name = 'GotCracked — Main Store';

create or replace function public.assign_single_store_profile_location()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  only_location uuid;
  location_count integer;
begin
  if new.location_id is not null then
    return new;
  end if;

  select count(*) into location_count from public.locations;

  -- During the single-store phase, fill the only possible location.
  if location_count = 1 then
    select id into only_location from public.locations limit 1;
    new.location_id := only_location;
    return new;
  end if;

  -- Once multiple stores exist, never guess which store an active staff member
  -- belongs to. Staff provisioning must supply an explicit location_id.
  if coalesce(new.active, true) then
    raise exception 'Active staff profiles must be assigned to a store location.';
  end if;

  return new;
end;
$$;
