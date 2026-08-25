-- Apply this migration to an existing GotCracked Supabase project.
-- New staff must choose a private password before the portal loads.

alter table public.profiles
  add column if not exists must_change_password boolean not null default true;

-- Force every existing staff profile, including owners, through the one-time setup.
-- Run this only after the updated portal code has been deployed.
update public.profiles
set must_change_password = true;

create or replace function public.complete_initial_password_setup() returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles
  set must_change_password = false
  where id = auth.uid() and active = true;

  if not found then
    raise exception 'Active staff profile not found';
  end if;
end; $$;

revoke all on function public.complete_initial_password_setup() from public;
grant execute on function public.complete_initial_password_setup() to authenticated;
