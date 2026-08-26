do $$
declare
  only_location uuid;
  location_count integer;
begin
  select count(*) into location_count from public.locations;
  if location_count = 1 then
    select id into only_location from public.locations limit 1;
    update public.profiles
      set location_id = only_location
    where location_id is null;
  end if;
end $$;

create or replace function public.assign_single_store_profile_location()
returns trigger
language plpgsql
security definer
set search_path='public'
as $$
declare
  only_location uuid;
  location_count integer;
begin
  if new.location_id is not null then
    return new;
  end if;

  select count(*) into location_count from public.locations;
  if location_count = 1 then
    select id into only_location from public.locations limit 1;
    new.location_id := only_location;
  end if;

  return new;
end;
$$;

drop trigger if exists assign_single_store_profile_location_trg on public.profiles;
create trigger assign_single_store_profile_location_trg
before insert or update of location_id on public.profiles
for each row execute function public.assign_single_store_profile_location();
