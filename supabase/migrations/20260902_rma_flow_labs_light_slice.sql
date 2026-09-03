create table if not exists public.rma_flow_labs_access (
  location_id uuid not null references public.locations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  feature_key text not null default 'RMA_FLOW_LABS' check (feature_key = 'RMA_FLOW_LABS'),
  enabled boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id,feature_key)
);

-- The current production owner is the initial internal pilot. No future user or
-- location is enrolled automatically.
insert into public.rma_flow_labs_access(location_id,profile_id,enabled,created_by)
select p.location_id,p.id,true,p.id
from public.profiles p
join public.locations l on l.id=p.location_id
where p.role='owner' and p.active and lower(l.name)='blacksburg'
on conflict (profile_id,feature_key) do nothing;

create table if not exists public.rma_flow_purchase_reviews (
  purchase_order_id uuid primary key references public.purchase_orders(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  state text not null default 'pending' check (state in ('pending','approved','rejected')),
  requested_by uuid references public.profiles(id) on delete set null,
  decided_by uuid references public.profiles(id) on delete set null,
  decision_note text check (length(coalesce(decision_note,'')) <= 500),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.rma_flow_supplier_returns (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  purchase_order_item_id uuid not null references public.purchase_order_items(id) on delete restrict,
  ticket_id uuid references public.repair_tickets(id) on delete set null,
  quantity integer not null check (quantity > 0),
  reason_code text not null check (reason_code in ('defective','wrong_item','shipping_damage','compatibility','quality','other')),
  reason_notes text not null check (length(btrim(reason_notes)) between 3 and 500),
  status text not null default 'requested'
    check (status in ('requested','authorized','shipped','received_by_supplier','resolved','rejected','cancelled')),
  evidence_urls jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_urls)='array'),
  supplier_reference text check (length(coalesce(supplier_reference,'')) <= 160),
  carrier text check (length(coalesce(carrier,'')) <= 80),
  tracking_number text check (length(coalesce(tracking_number,'')) <= 160),
  resolution_code text check (resolution_code is null or resolution_code in ('credit','replacement','refund','denied','other')),
  resolution_note text check (length(coalesce(resolution_note,'')) <= 500),
  credit_cents integer check (credit_cents >= 0),
  requested_by uuid references public.profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  authorized_at timestamptz,
  shipped_at timestamptz,
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0)
);

create table if not exists public.rma_flow_supplier_return_events (
  id bigint generated always as identity primary key,
  return_id uuid not null references public.rma_flow_supplier_returns(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  from_status text,
  to_status text not null,
  note text check (length(coalesce(note,'')) <= 500),
  actor_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists rma_flow_returns_location_status_idx
  on public.rma_flow_supplier_returns(location_id,status,updated_at desc);
create index if not exists rma_flow_returns_po_item_idx
  on public.rma_flow_supplier_returns(purchase_order_item_id);
create index if not exists rma_flow_returns_ticket_idx
  on public.rma_flow_supplier_returns(ticket_id) where ticket_id is not null;
create index if not exists rma_flow_events_return_idx
  on public.rma_flow_supplier_return_events(return_id,created_at desc);
create index if not exists rma_flow_access_location_idx
  on public.rma_flow_labs_access(location_id,enabled);

alter table public.rma_flow_labs_access enable row level security;
alter table public.rma_flow_purchase_reviews enable row level security;
alter table public.rma_flow_supplier_returns enable row level security;
alter table public.rma_flow_supplier_return_events enable row level security;

create or replace function public.rma_flow_labs_enabled()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(
    select 1 from public.rma_flow_labs_access a
    where a.profile_id=auth.uid()
      and a.location_id=public.current_location_id()
      and a.feature_key='RMA_FLOW_LABS'
      and a.enabled
  )
$$;

drop policy if exists "staff can read own labs access" on public.rma_flow_labs_access;
create policy "staff can read own labs access" on public.rma_flow_labs_access
for select to authenticated using (profile_id=(select auth.uid()));

drop policy if exists "enabled staff can view purchase reviews" on public.rma_flow_purchase_reviews;
create policy "enabled staff can view purchase reviews" on public.rma_flow_purchase_reviews
for select to authenticated using (
  location_id=(select public.current_location_id())
  and (select public.rma_flow_labs_enabled())
  and ((select coalesce(public.has_permission('purchasing.view'),false))
    or (select coalesce(public.has_permission('purchasing.manage'),false)))
);

drop policy if exists "enabled staff can view supplier returns" on public.rma_flow_supplier_returns;
create policy "enabled staff can view supplier returns" on public.rma_flow_supplier_returns
for select to authenticated using (
  location_id=(select public.current_location_id())
  and (select public.rma_flow_labs_enabled())
  and ((select coalesce(public.has_permission('inventory.view'),false))
    or (select coalesce(public.has_permission('inventory.manage'),false))
    or (select coalesce(public.has_permission('purchasing.view'),false))
    or (select coalesce(public.has_permission('purchasing.manage'),false)))
);

drop policy if exists "enabled staff can view supplier return events" on public.rma_flow_supplier_return_events;
create policy "enabled staff can view supplier return events" on public.rma_flow_supplier_return_events
for select to authenticated using (
  location_id=(select public.current_location_id())
  and (select public.rma_flow_labs_enabled())
  and ((select coalesce(public.has_permission('inventory.view'),false))
    or (select coalesce(public.has_permission('purchasing.view'),false))
    or (select coalesce(public.has_permission('purchasing.manage'),false)))
);

create or replace function public.rma_flow_review_purchase_order(
  p_purchase_order_id uuid,
  p_decision text,
  p_note text default null
) returns public.rma_flow_purchase_reviews
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_po public.purchase_orders;
  v_row public.rma_flow_purchase_reviews;
begin
  if not coalesce(public.portal_session_authorized(),false) then raise exception 'Verified human portal session required'; end if;
  if not public.rma_flow_labs_enabled() then raise exception 'RMA Flow Labs is not enabled'; end if;
  if not coalesce(public.has_permission('purchasing.manage'),false) then raise exception 'Purchasing management permission required'; end if;
  if p_decision not in ('pending','approved','rejected') then raise exception 'Invalid purchase review decision'; end if;
  select * into v_po from public.purchase_orders where id=p_purchase_order_id for update;
  if v_po.id is null or v_po.location_id<>public.current_location_id() then raise exception 'Purchase order not found'; end if;
  insert into public.rma_flow_purchase_reviews(
    purchase_order_id,location_id,state,requested_by,decided_by,decision_note,requested_at,decided_at,updated_at
  ) values (
    v_po.id,v_po.location_id,p_decision,auth.uid(),
    case when p_decision in ('approved','rejected') then auth.uid() end,
    nullif(btrim(p_note),''),
    now(),case when p_decision in ('approved','rejected') then now() end,now()
  )
  on conflict (purchase_order_id) do update set
    state=excluded.state,
    decided_by=excluded.decided_by,
    decision_note=excluded.decision_note,
    decided_at=excluded.decided_at,
    updated_at=now()
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.rma_flow_create_supplier_return(
  p_purchase_order_item_id uuid,
  p_ticket_id uuid,
  p_quantity integer,
  p_reason_code text,
  p_reason_notes text,
  p_evidence_urls jsonb default '[]'::jsonb,
  p_supplier_reference text default null
) returns public.rma_flow_supplier_returns
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_line public.purchase_order_items;
  v_location uuid;
  v_existing integer;
  v_row public.rma_flow_supplier_returns;
begin
  if not coalesce(public.portal_session_authorized(),false) then raise exception 'Verified human portal session required'; end if;
  if not public.rma_flow_labs_enabled() then raise exception 'RMA Flow Labs is not enabled'; end if;
  if not coalesce(public.has_permission('purchasing.manage'),false) then raise exception 'Purchasing management permission required'; end if;
  if p_quantity is null or p_quantity<1 then raise exception 'Return quantity must be positive'; end if;
  if p_reason_code not in ('defective','wrong_item','shipping_damage','compatibility','quality','other') then raise exception 'Invalid return reason'; end if;
  if length(btrim(coalesce(p_reason_notes,'')))<3 then raise exception 'Return notes are required'; end if;
  if jsonb_typeof(coalesce(p_evidence_urls,'[]'::jsonb))<>'array' then raise exception 'Evidence must be an array'; end if;

  select line.* into v_line
  from public.purchase_order_items line where line.id=p_purchase_order_item_id for update;
  select po.location_id into v_location from public.purchase_orders po where po.id=v_line.purchase_order_id;
  if v_line.id is null or v_location is null or v_location<>public.current_location_id() then raise exception 'Purchase order line not found'; end if;
  if v_line.quantity_received<1 then raise exception 'Only received parts can be returned'; end if;
  if p_ticket_id is not null and not exists(select 1 from public.repair_tickets t where t.id=p_ticket_id and t.location_id=v_location) then raise exception 'Repair ticket not found'; end if;
  select coalesce(sum(quantity),0) into v_existing
  from public.rma_flow_supplier_returns
  where purchase_order_item_id=p_purchase_order_item_id and status not in ('rejected','cancelled');
  if v_existing+p_quantity>v_line.quantity_received then raise exception 'Return quantity exceeds received quantity'; end if;

  insert into public.rma_flow_supplier_returns(
    location_id,purchase_order_item_id,ticket_id,quantity,reason_code,reason_notes,
    evidence_urls,supplier_reference,requested_by
  ) values (
    v_location,p_purchase_order_item_id,p_ticket_id,p_quantity,p_reason_code,btrim(p_reason_notes),
    coalesce(p_evidence_urls,'[]'::jsonb),nullif(btrim(p_supplier_reference),''),auth.uid()
  ) returning * into v_row;
  insert into public.rma_flow_supplier_return_events(return_id,location_id,to_status,note,actor_profile_id)
  values(v_row.id,v_location,'requested','Return requested',auth.uid());
  return v_row;
end $$;

create or replace function public.rma_flow_transition_supplier_return(
  p_return_id uuid,
  p_expected_version integer,
  p_next_status text,
  p_note text default null,
  p_supplier_reference text default null,
  p_carrier text default null,
  p_tracking_number text default null,
  p_resolution_code text default null,
  p_credit_cents integer default null
) returns public.rma_flow_supplier_returns
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_row public.rma_flow_supplier_returns;
  v_old_status text;
begin
  if not coalesce(public.portal_session_authorized(),false) then raise exception 'Verified human portal session required'; end if;
  if not public.rma_flow_labs_enabled() then raise exception 'RMA Flow Labs is not enabled'; end if;
  if not coalesce(public.has_permission('purchasing.manage'),false) then raise exception 'Purchasing management permission required'; end if;
  select * into v_row from public.rma_flow_supplier_returns where id=p_return_id for update;
  if v_row.id is null or v_row.location_id<>public.current_location_id() then raise exception 'Supplier return not found'; end if;
  if v_row.version<>p_expected_version then raise exception 'This return changed in another session; refresh and try again'; end if;
  v_old_status:=v_row.status;
  if not (
    (v_old_status='requested' and p_next_status in ('authorized','rejected','cancelled')) or
    (v_old_status='authorized' and p_next_status in ('shipped','cancelled')) or
    (v_old_status='shipped' and p_next_status='received_by_supplier') or
    (v_old_status='received_by_supplier' and p_next_status='resolved')
  ) then raise exception 'Invalid supplier return transition'; end if;
  if p_next_status='shipped' and length(btrim(coalesce(p_tracking_number,v_row.tracking_number,'')))<3 then raise exception 'Tracking number is required before shipment'; end if;
  if p_next_status='resolved' and p_resolution_code not in ('credit','replacement','refund','denied','other') then raise exception 'Resolution is required'; end if;

  update public.rma_flow_supplier_returns set
    status=p_next_status,
    supplier_reference=coalesce(nullif(btrim(p_supplier_reference),''),supplier_reference),
    carrier=coalesce(nullif(btrim(p_carrier),''),carrier),
    tracking_number=coalesce(nullif(btrim(p_tracking_number),''),tracking_number),
    resolution_code=coalesce(p_resolution_code,resolution_code),
    resolution_note=case when p_next_status='resolved' then nullif(btrim(p_note),'') else resolution_note end,
    credit_cents=coalesce(p_credit_cents,credit_cents),
    authorized_at=case when p_next_status='authorized' then now() else authorized_at end,
    shipped_at=case when p_next_status='shipped' then now() else shipped_at end,
    resolved_at=case when p_next_status in ('resolved','rejected','cancelled') then now() else resolved_at end,
    updated_at=now(),version=version+1
  where id=p_return_id returning * into v_row;
  insert into public.rma_flow_supplier_return_events(return_id,location_id,from_status,to_status,note,actor_profile_id)
  values(v_row.id,v_row.location_id,v_old_status,p_next_status,nullif(btrim(p_note),''),auth.uid());
  return v_row;
end $$;

revoke all on public.rma_flow_labs_access, public.rma_flow_purchase_reviews,
  public.rma_flow_supplier_returns, public.rma_flow_supplier_return_events from anon;
revoke insert,update,delete on public.rma_flow_labs_access, public.rma_flow_purchase_reviews,
  public.rma_flow_supplier_returns, public.rma_flow_supplier_return_events from authenticated;
grant select on public.rma_flow_labs_access, public.rma_flow_purchase_reviews,
  public.rma_flow_supplier_returns, public.rma_flow_supplier_return_events to authenticated;
revoke all on function public.rma_flow_labs_enabled() from public,anon;
revoke all on function public.rma_flow_review_purchase_order(uuid,text,text) from public,anon;
revoke all on function public.rma_flow_create_supplier_return(uuid,uuid,integer,text,text,jsonb,text) from public,anon;
revoke all on function public.rma_flow_transition_supplier_return(uuid,integer,text,text,text,text,text,text,integer) from public,anon;
grant execute on function public.rma_flow_labs_enabled() to authenticated;
grant execute on function public.rma_flow_review_purchase_order(uuid,text,text) to authenticated;
grant execute on function public.rma_flow_create_supplier_return(uuid,uuid,integer,text,text,jsonb,text) to authenticated;
grant execute on function public.rma_flow_transition_supplier_return(uuid,integer,text,text,text,text,text,text,integer) to authenticated;

comment on table public.rma_flow_supplier_returns is
  'Feature-gated supplier-return workflow. It never changes physical inventory; receiving remains authoritative.';

