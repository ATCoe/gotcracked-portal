do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='rma_flow_purchase_reviews') then
    alter publication supabase_realtime add table public.rma_flow_purchase_reviews;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='rma_flow_supplier_returns') then
    alter publication supabase_realtime add table public.rma_flow_supplier_returns;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='rma_flow_supplier_return_events') then
    alter publication supabase_realtime add table public.rma_flow_supplier_return_events;
  end if;
end $$;

