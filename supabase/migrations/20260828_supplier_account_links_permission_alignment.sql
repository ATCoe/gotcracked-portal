drop policy if exists "management can view supplier account links" on public.supplier_account_links;
create policy "management can view supplier account links" on public.supplier_account_links
for select to authenticated
using (location_id=public.current_location_id() and (coalesce(public.has_permission('settings.manage'),false) or coalesce(public.has_permission('inventory.manage'),false)));

drop policy if exists "management can insert supplier account links" on public.supplier_account_links;
create policy "management can insert supplier account links" on public.supplier_account_links
for insert to authenticated
with check (location_id=public.current_location_id() and (coalesce(public.has_permission('settings.manage'),false) or coalesce(public.has_permission('inventory.manage'),false)));

drop policy if exists "management can update supplier account links" on public.supplier_account_links;
create policy "management can update supplier account links" on public.supplier_account_links
for update to authenticated
using (location_id=public.current_location_id() and (coalesce(public.has_permission('settings.manage'),false) or coalesce(public.has_permission('inventory.manage'),false)))
with check (location_id=public.current_location_id() and (coalesce(public.has_permission('settings.manage'),false) or coalesce(public.has_permission('inventory.manage'),false)));