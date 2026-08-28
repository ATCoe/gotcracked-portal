create table if not exists public.supplier_account_links (
  location_id uuid not null references public.locations(id) on delete cascade,
  supplier_key text not null,
  account_label text,
  account_email text,
  account_number text,
  portal_url text,
  linked_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key(location_id,supplier_key),
  constraint supplier_account_links_key_check check (supplier_key ~ '^[a-z0-9_-]{2,80}$'),
  constraint supplier_account_links_email_length check (length(coalesce(account_email,''))<=320),
  constraint supplier_account_links_number_length check (length(coalesce(account_number,''))<=160),
  constraint supplier_account_links_label_length check (length(coalesce(account_label,''))<=160)
);

alter table public.supplier_account_links enable row level security;
drop policy if exists "management can view supplier account links" on public.supplier_account_links;
create policy "management can view supplier account links" on public.supplier_account_links
for select to authenticated
using (location_id=public.current_location_id() and coalesce(public.has_permission('settings.manage'),false));
drop policy if exists "management can insert supplier account links" on public.supplier_account_links;
create policy "management can insert supplier account links" on public.supplier_account_links
for insert to authenticated
with check (location_id=public.current_location_id() and coalesce(public.has_permission('settings.manage'),false));drop policy if exists "management can update supplier account links" on public.supplier_account_links;
create policy "management can update supplier account links" on public.supplier_account_links
for update to authenticated
using (location_id=public.current_location_id() and coalesce(public.has_permission('settings.manage'),false))
with check (location_id=public.current_location_id() and coalesce(public.has_permission('settings.manage'),false));
revoke all on public.supplier_account_links from anon;
grant select,insert,update on public.supplier_account_links to authenticated;
create index if not exists supplier_account_links_supplier_idx on public.supplier_account_links(supplier_key,location_id);