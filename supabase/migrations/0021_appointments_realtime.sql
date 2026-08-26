-- Appointment creation and rescheduling must refresh every signed-in Portal
-- user without a reload, just like leads and work orders.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='appointments'
  ) then
    alter publication supabase_realtime add table public.appointments;
  end if;
end $$;
