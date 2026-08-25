-- Keep every staff browser synchronized when operational records change.
-- RLS remains authoritative for which rows an authenticated staff member can read.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'leads','repair_tickets','customers','devices','intake_sessions',
    'work_order_items','ticket_events','purchase_orders','purchase_order_items'
  ] loop
    if to_regclass('public.' || table_name) is not null
       and not exists (
         select 1 from pg_publication_tables
         where pubname='supabase_realtime' and schemaname='public' and tablename=table_name
       ) then
      execute format('alter publication supabase_realtime add table public.%I',table_name);
    end if;
  end loop;
end $$;

