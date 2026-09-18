-- Marlon lean-stock and source-ranked procurement.
-- Existing Inventory, Parts Registry, demand, reservation, allocation, and PO tables remain canonical.

alter table public.inventory_items
  add column if not exists stock_strategy text not null default 'demand_only',
  add column if not exists target_on_hand integer not null default 0,
  add column if not exists max_on_hand integer not null default 0,
  add column if not exists stock_reason text,
  add column if not exists last_demand_review_at timestamptz;

alter table public.part_demands
  add column if not exists sourcing_status text not null default 'pending',
  add column if not exists recommended_listing_id uuid references public.part_source_listings(id) on delete set null,
  add column if not exists sourcing_confidence numeric,
  add column if not exists clarification_question text,
  add column if not exists sourcing_evidence jsonb not null default '{}'::jsonb,
  add column if not exists sourcing_updated_at timestamptz;

alter table public.inventory_items drop constraint if exists inventory_items_stock_strategy_check;
alter table public.inventory_items add constraint inventory_items_stock_strategy_check
  check (stock_strategy in ('demand_only','baseline','manual'));
alter table public.inventory_items drop constraint if exists inventory_items_stock_targets_check;
alter table public.inventory_items add constraint inventory_items_stock_targets_check
  check (target_on_hand >= 0 and max_on_hand >= target_on_hand);

alter table public.part_demands drop constraint if exists part_demands_sourcing_status_check;
alter table public.part_demands add constraint part_demands_sourcing_status_check
  check (sourcing_status in ('pending','clarification_needed','recommended','staged','ordered','resolved','not_required'));
alter table public.part_demands drop constraint if exists part_demands_sourcing_confidence_check;
alter table public.part_demands add constraint part_demands_sourcing_confidence_check
  check (sourcing_confidence is null or sourcing_confidence between 0 and 1);

alter table public.part_source_listings drop constraint if exists part_source_listings_source_name_check;
alter table public.part_source_listings add constraint part_source_listings_source_name_check
  check (source_name ~ '^[a-z0-9][a-z0-9._-]{0,79}$');

create index if not exists part_demands_sourcing_queue_idx
  on public.part_demands(location_id,sourcing_status,priority,created_at)
  where status not in ('fulfilled','cancelled');

create or replace function public.record_marlon_source_observation(
  p_listing_id uuid,
  p_price_cents integer,
  p_availability text default null,
  p_compatibility jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns public.part_source_listings
language plpgsql
security definer
set search_path=public
as $$
declare
  saved public.part_source_listings;
begin
  if p_price_cents is null or p_price_cents <= 0 then raise exception 'A verified positive source price is required.'; end if;
  update public.part_source_listings
  set price_cents=p_price_cents,
      availability=coalesce(nullif(btrim(p_availability),''),availability),
      compatibility_evidence=coalesce(compatibility_evidence,'{}'::jsonb)||coalesce(p_compatibility,'{}'::jsonb),
      source_metadata=coalesce(source_metadata,'{}'::jsonb)||coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('marlon_verified_at',now()),
      last_seen_at=now(),active=true
  where id=p_listing_id
  returning * into saved;
  if not found then raise exception 'Source listing not found.'; end if;
  insert into public.part_price_history(listing_id,price_cents,availability,observed_at)
  values(saved.id,saved.price_cents,saved.availability,now());
  return saved;
end;
$$;
revoke all on function public.record_marlon_source_observation(uuid,integer,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.record_marlon_source_observation(uuid,integer,text,jsonb,jsonb) to service_role;

create or replace function public.marlon_promote_listing_to_inventory_internal(
  p_location_id uuid,
  p_listing_id uuid,
  p_stock_strategy text default 'demand_only',
  p_target_on_hand integer default 0,
  p_max_on_hand integer default 0,
  p_reorder_point integer default 0,
  p_reason text default null
)
returns public.inventory_items
language plpgsql
security definer
set search_path=public
as $$
declare
  listing public.part_source_listings;
  part public.parts_registry;
  supplier public.suppliers;
  settings public.business_settings;
  saved public.inventory_items;
  gm numeric;
  default_sell integer;
  local_sku text;
  source_prefix text;
begin
  if p_stock_strategy not in ('demand_only','baseline','manual') then raise exception 'Invalid stock strategy.'; end if;
  if p_target_on_hand < 0 or p_max_on_hand < p_target_on_hand or p_reorder_point < 0 then raise exception 'Invalid stock targets.'; end if;

  select * into listing from public.part_source_listings where id=p_listing_id and active=true;
  if listing.id is null then raise exception 'Active source listing not found.'; end if;
  if coalesce(listing.price_cents,0) <= 0 then raise exception 'Source price must be verified before adding this part to Inventory.'; end if;
  select * into part from public.parts_registry where id=listing.part_id;
  if part.id is null then raise exception 'Registry part not found.'; end if;
  select * into settings from public.business_settings where location_id=p_location_id;
  if settings.location_id is null then raise exception 'Business settings not found.'; end if;

  select * into supplier from public.suppliers s
  where s.location_id=p_location_id and s.active=true and (
    (listing.source_name='mobilesentrix' and s.supplier_type='mobilesentrix') or
    (listing.source_name='amazon' and s.supplier_type='amazon') or
    lower(s.name)=lower(coalesce(nullif(listing.source_metadata->>'supplier_name',''),listing.source_name))
  )
  order by case when (listing.source_name='mobilesentrix' and s.supplier_type='mobilesentrix') or (listing.source_name='amazon' and s.supplier_type='amazon') then 0 else 1 end
  limit 1;
  if supplier.id is null then raise exception 'A configured supplier is required before this listing can become Inventory.'; end if;

  gm:=greatest(0,least(94,coalesce(settings.target_gross_margin_percent,50)));
  default_sell:=ceil(listing.price_cents/greatest(0.06,1-(gm/100.0)))::integer;

  select * into saved from public.inventory_items
  where location_id=p_location_id and registry_part_id=part.id and active=true
  order by updated_at desc limit 1 for update;
  if saved.id is not null then
    update public.inventory_items
    set cost_cents=listing.price_cents,
        supplier_name=supplier.name,
        supplier_sku=coalesce(listing.supplier_sku,supplier_sku),
        supplier_url=listing.source_url,
        sell_price_cents=case when coalesce(sell_price_cents,0)<=0 then default_sell else sell_price_cents end,
        stock_strategy=case when stock_strategy='manual' then stock_strategy else p_stock_strategy end,
        target_on_hand=case when stock_strategy='manual' then target_on_hand else p_target_on_hand end,
        max_on_hand=case when stock_strategy='manual' then max_on_hand else p_max_on_hand end,
        reorder_point=case when stock_strategy='manual' then reorder_point else p_reorder_point end,
        stock_reason=coalesce(nullif(btrim(p_reason),''),stock_reason),
        last_demand_review_at=now(),updated_at=now()
    where id=saved.id returning * into saved;
    return saved;
  end if;

  source_prefix:=case listing.source_name when 'mobilesentrix' then 'MS' when 'amazon' then 'AMZ' else upper(left(regexp_replace(listing.source_name,'[^a-z0-9]+','','g'),4)) end;
  local_sku:=left(source_prefix||'-'||coalesce(nullif(listing.supplier_sku,''),replace(part.id::text,'-','')),120);
  insert into public.inventory_items(
    location_id,sku,name,quantity_on_hand,reorder_point,cost_cents,sell_price_cents,active,
    description,category,supplier_name,supplier_sku,supplier_url,registry_part_id,
    stock_strategy,target_on_hand,max_on_hand,stock_reason,last_demand_review_at,updated_at
  ) values(
    p_location_id,local_sku,part.display_name,0,p_reorder_point,listing.price_cents,default_sell,true,
    part.description,part.category,supplier.name,listing.supplier_sku,listing.source_url,part.id,
    p_stock_strategy,p_target_on_hand,p_max_on_hand,nullif(btrim(p_reason),''),now(),now()
  ) returning * into saved;
  return saved;
end;
$$;
revoke all on function public.marlon_promote_listing_to_inventory_internal(uuid,uuid,text,integer,integer,integer,text) from public,anon,authenticated;
grant execute on function public.marlon_promote_listing_to_inventory_internal(uuid,uuid,text,integer,integer,integer,text) to service_role;

-- Revision-aware sourcing and one-open-cart-per-supplier hardening.
-- Supersedes the older MobileSentrix-only per-demand draft staging path.

alter table public.purchase_order_items
  drop constraint if exists purchase_order_items_unit_cost_cents_check;
alter table public.purchase_order_items
  add constraint purchase_order_items_unit_cost_cents_check
  check (unit_cost_cents > 0);

alter table public.purchase_orders
  drop constraint if exists purchase_orders_marlon_manual_checkout_check;
alter table public.purchase_orders
  add constraint purchase_orders_marlon_manual_checkout_check
  check (not prepared_by_marlon or requires_manual_checkout);

create unique index if not exists purchase_orders_one_draft_per_supplier_idx
  on public.purchase_orders(location_id,supplier_id)
  where status='draft' and supplier_id is not null;

create or replace function public.marlon_demand_device_id_internal(p_demand_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  d public.part_demands;
  resolved uuid;
begin
  select * into d from public.part_demands where id=p_demand_id;
  if d.id is null then return null; end if;

  if d.driver_type='work_order' then
    select rt.device_id into resolved
    from public.repair_tickets rt
    where rt.id=d.ticket_id;
  elsif d.driver_type='lead' then
    select l.device_id into resolved
    from public.leads l
    where l.id=d.lead_id;
  elsif d.driver_type='appointment' then
    select l.device_id into resolved
    from public.appointments a
    left join public.leads l on l.id=a.lead_id
    where a.id=d.appointment_id;
  end if;

  return resolved;
end;
$$;
revoke all on function public.marlon_demand_device_id_internal(uuid) from public,anon,authenticated;
grant execute on function public.marlon_demand_device_id_internal(uuid) to service_role;


create or replace function public.marlon_assess_listing_for_demand_internal(
  p_demand_id uuid,
  p_listing_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  d public.part_demands;
  listing public.part_source_listings;
  part public.parts_registry;
  dev public.devices;
  variant public.device_catalog_variants;
  model_rec public.device_catalog_models;
  evidence jsonb;
  part_text text;
  component_kind text := 'general';
  is_console boolean := false;
  revision_sensitive boolean := false;
  exact_match boolean := false;
  family_match boolean := false;
  all_models boolean := false;
  all_revisions boolean := false;
  model_number text;
  family_name text;
  revision_value text;
  revision_key text;
  verified_at timestamptz;
  question text;
  confidence numeric := 0;
begin
  select * into d from public.part_demands where id=p_demand_id;
  if d.id is null then
    return jsonb_build_object('compatible',false,'clarification_required',false,'reason','demand_not_found','confidence',0);
  end if;

  select * into listing from public.part_source_listings where id=p_listing_id and active=true;
  if listing.id is null then
    return jsonb_build_object('compatible',false,'clarification_required',false,'reason','listing_not_found','confidence',0);
  end if;

  select * into part from public.parts_registry where id=listing.part_id;
  if part.id is null then
    return jsonb_build_object('compatible',false,'clarification_required',false,'reason','registry_part_not_found','confidence',0);
  end if;
  if d.registry_part_id is not null and d.registry_part_id<>part.id then
    return jsonb_build_object('compatible',false,'clarification_required',false,'reason','listing_part_mismatch','confidence',0);
  end if;
  if coalesce(listing.price_cents,0)<=0 then
    return jsonb_build_object('compatible',false,'clarification_required',false,'reason','verified_positive_price_required','confidence',0);
  end if;

  begin
    verified_at := nullif(listing.source_metadata->>'marlon_verified_at','')::timestamptz;
  exception when others then
    verified_at := null;
  end;
  if verified_at is null then
    return jsonb_build_object('compatible',false,'clarification_required',false,'reason','decision_time_source_verification_required','confidence',0);
  end if;
  if verified_at < now()-interval '7 days' then
    return jsonb_build_object('compatible',false,'clarification_required',false,'reason','source_price_verification_stale','verified_at',verified_at,'confidence',0);
  end if;

  evidence := coalesce(part.compatibility,'{}'::jsonb) || coalesce(listing.compatibility_evidence,'{}'::jsonb);
  part_text := lower(concat_ws(' ',part.category,part.subcategory,part.display_name,part.description));
  if part_text ~ '(^|[^a-z])hdmi([^a-z]|$)' then
    component_kind := 'hdmi';
  elsif part_text ~ '(power[ _-]*supply|(^|[^a-z])psu([^a-z]|$))' then
    component_kind := 'power_supply';
  elsif part_text ~ '(optical[ _-]*drive|disc[ _-]*drive|disk[ _-]*drive|blu[ -]*ray[ _-]*drive)' then
    component_kind := 'optical_drive';
  elsif part_text ~ '((^|[^a-z])fan([^a-z]|$)|cooling)' then
    component_kind := 'fan';
  elsif part_text ~ '(charging[ _-]*port|power[ _-]*port|dc[ _-]*jack|power[ _-]*connector|usb[ -]*c[ _-]*port)' then
    component_kind := 'power_component';
  end if;

  select * into dev from public.devices where id=public.marlon_demand_device_id_internal(d.id);
  if dev.id is not null and dev.catalog_variant_id is not null then
    select * into variant from public.device_catalog_variants where id=dev.catalog_variant_id;
  end if;
  if dev.id is not null and dev.catalog_model_id is not null then
    select * into model_rec from public.device_catalog_models where id=dev.catalog_model_id;
  end if;

  is_console := dev.id is not null and (
    lower(coalesce(dev.category,'')) ~ 'console'
    or lower(concat_ws(' ',dev.manufacturer,dev.model,model_rec.name,model_rec.family)) ~ '(playstation|(^|[^a-z])ps[345]([^a-z]|$)|xbox|nintendo[ ]+switch)'
  );
  revision_sensitive := is_console and component_kind in ('hdmi','power_supply','optical_drive','fan','power_component');
  model_number := nullif(lower(btrim(coalesce(dev.model_number,variant.model_number,''))),'');
  family_name := nullif(lower(btrim(coalesce(model_rec.family,model_rec.name,dev.model,''))),'');
  all_models := lower(coalesce(evidence->>'all_models_in_family','false'))='true';
  all_revisions := lower(coalesce(evidence->>'all_hardware_revisions','false'))='true';

  if dev.catalog_variant_id is not null and jsonb_typeof(evidence->'catalog_variant_ids')='array' then
    exact_match := exists (
      select 1 from jsonb_array_elements_text(evidence->'catalog_variant_ids') v
      where lower(btrim(v))=lower(dev.catalog_variant_id::text)
    );
  end if;
  if not exact_match and model_number is not null and jsonb_typeof(evidence->'model_numbers')='array' then
    exact_match := exists (
      select 1 from jsonb_array_elements_text(evidence->'model_numbers') v
      where lower(btrim(v))=model_number
    );
  end if;
  if not exact_match and dev.catalog_model_id is not null and not revision_sensitive
     and jsonb_typeof(evidence->'catalog_model_ids')='array' then
    exact_match := exists (
      select 1 from jsonb_array_elements_text(evidence->'catalog_model_ids') v
      where lower(btrim(v))=lower(dev.catalog_model_id::text)
    );
  end if;
  if dev.serial_number is not null and jsonb_typeof(evidence->'serial_prefixes')='array' then
    exact_match := exact_match or exists (
      select 1 from jsonb_array_elements_text(evidence->'serial_prefixes') v
      where lower(dev.serial_number) like lower(btrim(v))||'%'
    );
  end if;

  revision_key := case component_kind
    when 'power_supply' then 'psu_revisions'
    when 'optical_drive' then 'drive_revisions'
    when 'fan' then 'fan_revisions'
    else 'board_revisions'
  end;
  revision_value := nullif(lower(btrim(coalesce(
    case component_kind
      when 'power_supply' then variant.metadata->>'psu_revision'
      when 'optical_drive' then variant.metadata->>'drive_revision'
      when 'fan' then variant.metadata->>'fan_revision'
      else variant.metadata->>'board_revision'
    end,
    variant.metadata->>'hardware_revision',
    variant.metadata->>'revision',
    ''
  ))),'');
  if revision_value is not null and jsonb_typeof(evidence->revision_key)='array' then
    exact_match := exact_match or exists (
      select 1 from jsonb_array_elements_text(evidence->revision_key) v
      where lower(btrim(v))=revision_value
    );
  end if;

  if family_name is not null then
    family_match := nullif(lower(btrim(evidence->>'device_family')),'')=family_name;
    if not family_match and jsonb_typeof(evidence->'device_families')='array' then
      family_match := exists (
        select 1 from jsonb_array_elements_text(evidence->'device_families') v
        where lower(btrim(v))=family_name
      );
    end if;
  end if;
  if not family_match and dev.id is not null and jsonb_typeof(evidence->'models')='array' then
    family_match := exists (
      select 1 from jsonb_array_elements_text(evidence->'models') v
      where lower(btrim(v)) in (
        lower(btrim(coalesce(dev.model,''))),
        lower(btrim(coalesce(model_rec.name,''))),
        lower(btrim(coalesce(model_rec.family,'')))
      )
    );
  end if;

  if revision_sensitive and dev.id is null then
    question := 'Link the exact console/device record before sourcing this '||replace(component_kind,'_',' ')||'.';
    return jsonb_build_object(
      'compatible',false,'clarification_required',true,'question',question,
      'reason','exact_console_identity_required','component_kind',component_kind,
      'revision_sensitive',true,'confidence',0,'verified_at',verified_at
    );
  end if;

  if revision_sensitive then
    if component_kind='hdmi' and (exact_match or (family_match and all_models)) then
      confidence := case when exact_match then 1 else 0.92 end;
    elsif component_kind<>'hdmi' and (exact_match or (family_match and all_revisions)) then
      confidence := case when exact_match then 1 else 0.92 end;
    else
      question := case component_kind
        when 'power_supply' then 'Confirm the exact console model number and PSU/hardware revision, or provide a clear PSU label photo.'
        when 'optical_drive' then 'Confirm the exact console model number and optical-drive revision, or provide a clear drive label photo.'
        when 'fan' then 'Confirm the exact console model number and fan/hardware revision, or provide a clear fan label photo.'
        when 'power_component' then 'Confirm the exact console model number and board/hardware revision for this power component.'
        else 'Confirm the exact console model number and board/hardware revision for this HDMI component.'
      end;
      return jsonb_build_object(
        'compatible',false,'clarification_required',true,'question',question,
        'reason','console_revision_compatibility_unresolved','component_kind',component_kind,
        'revision_sensitive',true,'model_number_present',(model_number is not null),
        'catalog_variant_present',(dev.catalog_variant_id is not null),
        'confidence',0,'verified_at',verified_at
      );
    end if;
  else
    if exact_match then
      confidence := 1;
    elsif family_match then
      confidence := 0.9;
    elsif d.registry_part_id is not null and d.registry_part_id=part.id then
      confidence := 0.8;
    else
      confidence := 0.65;
    end if;
  end if;

  return jsonb_build_object(
    'compatible',true,'clarification_required',false,'reason','compatibility_supported',
    'component_kind',component_kind,'revision_sensitive',revision_sensitive,
    'exact_match',exact_match,'family_match',family_match,'confidence',confidence,
    'verified_at',verified_at,'source_name',listing.source_name,'supplier_sku',listing.supplier_sku
  );
end;
$$;
revoke all on function public.marlon_assess_listing_for_demand_internal(uuid,uuid) from public,anon,authenticated;
grant execute on function public.marlon_assess_listing_for_demand_internal(uuid,uuid) to service_role;

create or replace function public.marlon_recommend_source_listing_internal(
  p_demand_id uuid,
  p_listing_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  assessment jsonb;
  listing public.part_source_listings;
  next_status text;
  question text;
begin
  select * into listing from public.part_source_listings where id=p_listing_id;
  if listing.id is null then raise exception 'Source listing not found.'; end if;

  assessment := public.marlon_assess_listing_for_demand_internal(p_demand_id,p_listing_id);
  question := nullif(assessment->>'question','');
  next_status := case
    when coalesce((assessment->>'compatible')::boolean,false) then 'recommended'
    when coalesce((assessment->>'clarification_required')::boolean,false) then 'clarification_needed'
    else 'pending'
  end;

  update public.part_demands
  set recommended_listing_id=case when next_status='recommended' then p_listing_id else null end,
      sourcing_confidence=coalesce((assessment->>'confidence')::numeric,0),
      clarification_question=case when next_status='clarification_needed' then question else null end,
      sourcing_status=next_status,
      sourcing_evidence=coalesce(sourcing_evidence,'{}'::jsonb)||jsonb_build_object(
        'candidate_listing_id',p_listing_id,
        'source_name',listing.source_name,
        'supplier_sku',listing.supplier_sku,
        'source_url',listing.source_url,
        'last_assessment',assessment
      ),
      sourcing_updated_at=now(),updated_at=now()
  where id=p_demand_id;
  if not found then raise exception 'Part demand not found.'; end if;

  return assessment||jsonb_build_object('sourcing_status',next_status,'demand_id',p_demand_id,'listing_id',p_listing_id);
end;
$$;
revoke all on function public.marlon_recommend_source_listing_internal(uuid,uuid) from public,anon,authenticated;
grant execute on function public.marlon_recommend_source_listing_internal(uuid,uuid) to service_role;

create unique index if not exists purchase_order_items_one_part_per_draft_line_idx
  on public.purchase_order_items(purchase_order_id,inventory_item_id,coalesce(supplier_sku,''));

create or replace function public.stage_recommended_part_demand_internal(
  p_demand_id uuid,
  p_listing_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  d public.part_demands;
  listing public.part_source_listings;
  assessment jsonb;
  inv public.inventory_items;
  supplier public.suppliers;
  po public.purchase_orders;
  line public.purchase_order_items;
  target_listing_id uuid;
  existing_staged integer := 0;
  needed integer := 0;
begin
  select * into d from public.part_demands where id=p_demand_id for update;
  if d.id is null then return jsonb_build_object('ok',false,'reason','demand_not_found'); end if;
  if d.status in ('fulfilled','cancelled') then return jsonb_build_object('ok',false,'reason','closed_demand'); end if;

  target_listing_id := coalesce(p_listing_id,d.recommended_listing_id);
  if target_listing_id is null then
    return jsonb_build_object('ok',false,'reason','verified_recommendation_required');
  end if;
  select * into listing from public.part_source_listings where id=target_listing_id and active=true;
  if listing.id is null then return jsonb_build_object('ok',false,'reason','listing_not_found'); end if;

  assessment := public.marlon_assess_listing_for_demand_internal(d.id,listing.id);
  if not coalesce((assessment->>'compatible')::boolean,false) then
    perform public.marlon_recommend_source_listing_internal(d.id,listing.id);
    return assessment||jsonb_build_object('ok',false,'staged',0);
  end if;

  select coalesce(sum(a.quantity_allocated),0)::integer into existing_staged
  from public.purchase_order_item_allocations a
  join public.purchase_order_items poi on poi.id=a.purchase_order_item_id
  join public.purchase_orders p on p.id=poi.purchase_order_id
  where a.demand_id=d.id and p.status='draft';

  needed := greatest(d.quantity_required-d.quantity_reserved-d.quantity_ordered-existing_staged,0);
  if needed<=0 then
    update public.part_demands set quantity_staged=existing_staged,sourcing_updated_at=now(),updated_at=now() where id=d.id;
    return jsonb_build_object('ok',true,'already_covered',true,'staged',0);
  end if;
  if coalesce(listing.price_cents,0)<=0 then
    return jsonb_build_object('ok',false,'reason','verified_positive_price_required');
  end if;

  inv := public.marlon_promote_listing_to_inventory_internal(
    d.location_id,listing.id,'demand_only',0,0,0,'Demand-driven part sourcing'
  );

  select * into supplier from public.suppliers s
  where s.location_id=d.location_id and s.active=true and (
    (listing.source_name='mobilesentrix' and s.supplier_type='mobilesentrix') or
    (listing.source_name='amazon' and s.supplier_type='amazon') or
    lower(s.name)=lower(coalesce(nullif(listing.source_metadata->>'supplier_name',''),listing.source_name))
  )
  order by case
    when listing.source_name='mobilesentrix' and s.supplier_type='mobilesentrix' then 0
    when listing.source_name='amazon' and s.supplier_type='amazon' then 0
    else 1
  end
  limit 1;
  if supplier.id is null then
    return jsonb_build_object('ok',false,'reason','configured_supplier_required','source_name',listing.source_name);
  end if;

  select * into po from public.purchase_orders
  where location_id=d.location_id and supplier_id=supplier.id and status='draft'
  order by created_at limit 1 for update;
  if po.id is null then
    begin
      insert into public.purchase_orders(
        location_id,supplier_id,supplier_name,status,notes,created_by,
        prepared_by_marlon,prepared_at,checkout_url,requires_manual_checkout
      ) values(
        d.location_id,supplier.id,supplier.name,'draft',
        'Prepared from verified part demands. Paid supplier checkout must be completed by staff.',
        null,true,now(),coalesce(supplier.ordering_url,supplier.website_url),true
      ) returning * into po;
    exception when unique_violation then
      select * into po from public.purchase_orders
      where location_id=d.location_id and supplier_id=supplier.id and status='draft'
      order by created_at limit 1 for update;
    end;
  end if;

  select * into line from public.purchase_order_items poi
  where poi.purchase_order_id=po.id
    and poi.inventory_item_id=inv.id
    and coalesce(poi.supplier_sku,'')=coalesce(listing.supplier_sku,'')
  limit 1 for update;

  if line.id is null then
    begin
      insert into public.purchase_order_items(
        purchase_order_id,inventory_item_id,supplier_sku,description,
        quantity_ordered,quantity_received,unit_cost_cents,product_url
      ) values(
        po.id,inv.id,listing.supplier_sku,inv.name,needed,0,listing.price_cents,listing.source_url
      ) returning * into line;
    exception when unique_violation then
      select * into line from public.purchase_order_items poi
      where poi.purchase_order_id=po.id
        and poi.inventory_item_id=inv.id
        and coalesce(poi.supplier_sku,'')=coalesce(listing.supplier_sku,'')
      limit 1 for update;
      update public.purchase_order_items
      set quantity_ordered=quantity_ordered+needed,
          unit_cost_cents=listing.price_cents,
          product_url=listing.source_url
      where id=line.id returning * into line;
    end;
  else
    update public.purchase_order_items
    set quantity_ordered=quantity_ordered+needed,
        unit_cost_cents=listing.price_cents,
        product_url=listing.source_url
    where id=line.id returning * into line;
  end if;

  insert into public.purchase_order_item_allocations(purchase_order_item_id,demand_id,quantity_allocated)
  values(line.id,d.id,needed)
  on conflict(purchase_order_item_id,demand_id)
  do update set quantity_allocated=public.purchase_order_item_allocations.quantity_allocated+excluded.quantity_allocated,
                updated_at=now();

  update public.part_demands
  set inventory_item_id=inv.id,
      recommended_listing_id=listing.id,
      quantity_staged=existing_staged+needed,
      sourcing_status='staged',
      clarification_question=null,
      sourcing_confidence=coalesce((assessment->>'confidence')::numeric,sourcing_confidence),
      sourcing_evidence=coalesce(sourcing_evidence,'{}'::jsonb)||jsonb_build_object(
        'staged_listing_id',listing.id,
        'supplier_id',supplier.id,
        'supplier_name',supplier.name,
        'purchase_order_id',po.id,
        'purchase_order_item_id',line.id,
        'manual_checkout_required',true
      ),
      sourcing_updated_at=now(),updated_at=now()
  where id=d.id;

  return jsonb_build_object(
    'ok',true,'staged',needed,'supplier_id',supplier.id,'supplier_name',supplier.name,
    'purchase_order_id',po.id,'purchase_order_item_id',line.id,
    'inventory_item_id',inv.id,'manual_checkout_required',true,
    'checkout_url',po.checkout_url,'unit_cost_cents',listing.price_cents
  );
end;
$$;
revoke all on function public.stage_recommended_part_demand_internal(uuid,uuid) from public,anon,authenticated;
grant execute on function public.stage_recommended_part_demand_internal(uuid,uuid) to service_role;

create or replace function public.stage_recommended_part_demand(
  p_demand_id uuid,
  p_listing_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
begin
  if auth.uid() is null then raise exception 'Authenticated staff required.'; end if;
  if not (
    coalesce(public.has_permission('purchasing.manage'),false)
    or coalesce(public.has_permission('inventory.manage'),false)
  ) then raise exception 'Purchasing or inventory management permission required.'; end if;
  return public.stage_recommended_part_demand_internal(p_demand_id,p_listing_id);
end;
$$;
revoke all on function public.stage_recommended_part_demand(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.stage_recommended_part_demand(uuid,uuid) to authenticated;

create or replace function public.stage_mobilesentrix_demand_internal(p_demand_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  listing_id uuid;
  listing_source text;
begin
  select recommended_listing_id into listing_id from public.part_demands where id=p_demand_id;
  if listing_id is null then
    return jsonb_build_object('ok',false,'reason','verified_mobilesentrix_recommendation_required');
  end if;
  select psl.source_name into listing_source from public.part_source_listings psl where psl.id=listing_id and psl.active=true;
  if listing_source is distinct from 'mobilesentrix' then
    return jsonb_build_object('ok',false,'reason','verified_mobilesentrix_recommendation_required');
  end if;
  return public.stage_recommended_part_demand_internal(p_demand_id,listing_id);
end;
$$;
revoke all on function public.stage_mobilesentrix_demand_internal(uuid) from public,anon,authenticated;
grant execute on function public.stage_mobilesentrix_demand_internal(uuid) to service_role;

create or replace function public.stage_mobilesentrix_demand(p_demand_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
begin
  if auth.uid() is null then raise exception 'Authenticated staff required.'; end if;
  if not (
    coalesce(public.has_permission('purchasing.manage'),false)
    or coalesce(public.has_permission('inventory.manage'),false)
  ) then raise exception 'Purchasing or inventory management permission required.'; end if;
  return public.stage_mobilesentrix_demand_internal(p_demand_id);
end;
$$;
revoke all on function public.stage_mobilesentrix_demand(uuid) from public,anon,authenticated,service_role;
grant execute on function public.stage_mobilesentrix_demand(uuid) to authenticated;

-- Retire the old automatic trigger. Staging now follows explicit compatibility assessment.
drop trigger if exists part_demand_auto_stage_po_trigger on public.part_demands;
drop function if exists public.auto_stage_part_demand();

create or replace function public.finalize_manual_supplier_order(
  p_purchase_order_id uuid,
  p_external_order_number text,
  p_external_order_id text default null,
  p_expected_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  po public.purchase_orders;
  rec record;
  line_count integer;
  invalid_cost_count integer;
begin
  if auth.uid() is null then raise exception 'Authenticated staff required.'; end if;
  if not coalesce(public.has_permission('purchasing.manage'),false) then
    raise exception 'Purchasing management permission required.';
  end if;
  if nullif(btrim(p_external_order_number),'') is null then
    raise exception 'Supplier order number is required.';
  end if;

  select * into po from public.purchase_orders where id=p_purchase_order_id for update;
  if po.id is null or po.location_id<>public.current_location_id() then
    raise exception 'Purchase order not found.';
  end if;
  if po.status not in ('draft','submitted') then
    raise exception 'Only a prepared or submitted purchase order can be finalized.';
  end if;
  if not coalesce(po.requires_manual_checkout,true) then
    raise exception 'This purchase order is not configured for manual checkout.';
  end if;

  select count(*),count(*) filter (where coalesce(unit_cost_cents,0)<=0)
  into line_count,invalid_cost_count
  from public.purchase_order_items
  where purchase_order_id=po.id;
  if line_count=0 then raise exception 'Purchase order has no items.'; end if;
  if invalid_cost_count>0 then raise exception 'Every purchase-order line requires a verified positive cost.'; end if;

  update public.purchase_orders
  set status='ordered',external_order_number=btrim(p_external_order_number),
      external_order_id=nullif(btrim(p_external_order_id),''),ordered_at=now(),
      expected_at=p_expected_at,updated_at=now()
  where id=po.id;

  for rec in
    select a.demand_id,sum(a.quantity_allocated)::integer as qty
    from public.purchase_order_item_allocations a
    join public.purchase_order_items poi on poi.id=a.purchase_order_item_id
    where poi.purchase_order_id=po.id
    group by a.demand_id
  loop
    update public.part_demands
    set quantity_ordered=quantity_ordered+rec.qty,
        quantity_staged=greatest(quantity_staged-rec.qty,0),
        status='ordered',sourcing_status='ordered',sourcing_updated_at=now(),updated_at=now()
    where id=rec.demand_id and status not in ('fulfilled','cancelled');
  end loop;

  return jsonb_build_object(
    'ok',true,'purchase_order_id',po.id,'status','ordered',
    'manual_checkout_recorded',true,'external_order_number',btrim(p_external_order_number)
  );
end;
$$;
revoke all on function public.finalize_manual_supplier_order(uuid,text,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.finalize_manual_supplier_order(uuid,text,text,timestamptz) to authenticated;

comment on function public.marlon_assess_listing_for_demand_internal(uuid,uuid) is
  'Internal revision-aware compatibility gate for device-specific sourcing. Raw device identifiers are not returned.';
comment on function public.stage_recommended_part_demand_internal(uuid,uuid) is
  'Stages only verified compatible positive-cost listings into one draft cart per configured supplier; never completes external checkout.';

create or replace function public.upsert_marlon_source_listing_internal(
  p_part_id uuid,
  p_source_name text,
  p_source_type text,
  p_source_url text,
  p_price_cents integer,
  p_supplier_sku text default null,
  p_availability text default null,
  p_compatibility jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns public.part_source_listings
language plpgsql
security definer
set search_path=public
as $$
declare
  saved public.part_source_listings;
  source_key text := lower(btrim(p_source_name));
begin
  if not exists(select 1 from public.parts_registry where id=p_part_id) then raise exception 'Registry part not found.'; end if;
  if source_key !~ '^[a-z0-9][a-z0-9._-]{0,79}$' then raise exception 'Invalid source name.'; end if;
  if p_source_type not in ('supplier','reference','manufacturer') then raise exception 'Invalid source type.'; end if;
  if nullif(btrim(p_source_url),'') is null then raise exception 'Source URL is required.'; end if;
  if p_price_cents is null or p_price_cents<=0 then raise exception 'A verified positive source price is required.'; end if;

  insert into public.part_source_listings(
    part_id,source_name,source_type,supplier_sku,source_url,price_cents,currency_code,
    availability,compatibility_evidence,source_metadata,first_seen_at,last_seen_at,active
  ) values(
    p_part_id,source_key,p_source_type,nullif(btrim(p_supplier_sku),''),btrim(p_source_url),
    p_price_cents,'USD',nullif(btrim(p_availability),''),coalesce(p_compatibility,'{}'::jsonb),
    coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('marlon_verified_at',now()),now(),now(),true
  )
  on conflict(source_name,source_url) do update set
    part_id=excluded.part_id,
    source_type=excluded.source_type,
    supplier_sku=coalesce(excluded.supplier_sku,public.part_source_listings.supplier_sku),
    price_cents=excluded.price_cents,
    availability=coalesce(excluded.availability,public.part_source_listings.availability),
    compatibility_evidence=coalesce(public.part_source_listings.compatibility_evidence,'{}'::jsonb)||excluded.compatibility_evidence,
    source_metadata=coalesce(public.part_source_listings.source_metadata,'{}'::jsonb)||excluded.source_metadata,
    last_seen_at=now(),active=true
  returning * into saved;

  insert into public.part_price_history(listing_id,price_cents,availability,observed_at)
  values(saved.id,saved.price_cents,saved.availability,now());
  return saved;
end;
$$;
revoke all on function public.upsert_marlon_source_listing_internal(uuid,text,text,text,integer,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.upsert_marlon_source_listing_internal(uuid,text,text,text,integer,text,text,jsonb,jsonb) to service_role;

comment on function public.upsert_marlon_source_listing_internal(uuid,text,text,text,integer,text,text,jsonb,jsonb) is
  'Stores verified public source evidence in the canonical part_source_listings table. Amazon sellers belong in metadata while source_name remains amazon.';
