alter table public.business_settings
  add column if not exists custom_pc_build_service_charge_cents integer not null default 24999 check (custom_pc_build_service_charge_cents >= 0),
  add column if not exists custom_pc_build_estimate_valid_days integer not null default 7 check (custom_pc_build_estimate_valid_days between 1 and 30);

create table if not exists public.pc_build_requests (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  public_reference text not null unique,
  customer_name text not null,
  customer_email text not null,
  customer_phone text not null,
  preferred_contact text,
  survey jsonb not null default '{}'::jsonb,
  recommendation jsonb,
  internal_parts jsonb,
  source_urls jsonb not null default '[]'::jsonb,
  parts_cost_cents integer check (parts_cost_cents is null or parts_cost_cents >= 0),
  service_charge_cents integer check (service_charge_cents is null or service_charge_cents >= 0),
  estimated_total_cents integer check (estimated_total_cents is null or estimated_total_cents >= 0),
  estimate_valid_until timestamptz,
  status text not null default 'research_pending' check (status in ('research_pending','estimated','manual_review','contacted','approved','declined','ordered','building','completed','cancelled')),
  research_provider text,
  research_model text,
  research_error text,
  consent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pc_build_requests_location_created_idx on public.pc_build_requests(location_id, created_at desc);
create index if not exists pc_build_requests_lead_id_idx on public.pc_build_requests(lead_id);
create index if not exists pc_build_requests_status_idx on public.pc_build_requests(location_id, status, updated_at desc);

alter table public.pc_build_requests enable row level security;
revoke all on table public.pc_build_requests from public, anon;
grant select, update on table public.pc_build_requests to authenticated;

create policy "staff can view location pc build requests"
on public.pc_build_requests for select to authenticated
using (location_id = (select public.current_location_id()));

create policy "management can update location pc build requests"
on public.pc_build_requests for update to authenticated
using (
  location_id = (select public.current_location_id())
  and (select public.current_staff_role()) = any(array['owner'::public.staff_role,'manager'::public.staff_role])
)
with check (
  location_id = (select public.current_location_id())
  and (select public.current_staff_role()) = any(array['owner'::public.staff_role,'manager'::public.staff_role])
);

drop trigger if exists pc_build_requests_portal_sync on public.pc_build_requests;
create trigger pc_build_requests_portal_sync
after insert or update or delete on public.pc_build_requests
for each row execute function public.bump_portal_sync_revision();
