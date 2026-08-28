create or replace function public.get_workstation_operator_roster()
returns table(
  profile_id uuid,
  display_name text,
  job_title text,
  role text,
  avatar_url text,
  pin_configured boolean,
  reset_required boolean,
  discord_linked boolean
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  actor public.profiles;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into actor from public.profiles where id=auth.uid() and active=true;
  if actor.id is null then raise exception 'Active Portal profile required'; end if;
  if coalesce(actor.account_type,'staff') <> 'shared_workstation'
     and actor.role::text not in ('owner','manager') then
    raise exception 'Operator roster access denied.';
  end if;

  return query
  select p.id,p.display_name,p.job_title,p.role::text,
         case when p.avatar_url is null or p.avatar_url like 'preset:%' then null else p.avatar_url end,
         (s.pin_hash is not null and not coalesce(s.reset_required,true)) as pin_configured,
         coalesce(s.reset_required,true) as reset_required,
         (p.discord_user_id is not null) as discord_linked
  from public.profiles p
  left join public.staff_operator_pins s on s.profile_id=p.id
  where p.location_id=actor.location_id
    and p.active=true
    and coalesce(p.account_type,'staff')='staff'
  order by p.display_name;
end;
$function$;
