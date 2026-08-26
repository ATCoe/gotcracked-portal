alter table public.pc_build_requests
  add column if not exists compatibility_audit jsonb,
  add column if not exists compatibility_status text not null default 'pending' check (compatibility_status in ('pending','verified','manual_review','failed'));

create index if not exists pc_build_requests_compatibility_status_idx
  on public.pc_build_requests(location_id, compatibility_status, updated_at desc);
