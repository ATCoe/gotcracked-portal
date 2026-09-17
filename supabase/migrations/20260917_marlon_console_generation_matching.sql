-- Harden revision-sensitive console sourcing to generation-specific families.
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
  device_text text;
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
  device_text := lower(concat_ws(' ',dev.manufacturer,dev.model,model_rec.name,model_rec.family));
  family_name := case
    when device_text ~ '(playstation[ ]*5|(^|[^a-z0-9])ps5([^a-z0-9]|$))' then 'playstation 5'
    when device_text ~ '(playstation[ ]*4|(^|[^a-z0-9])ps4([^a-z0-9]|$))' then 'playstation 4'
    when device_text ~ '(playstation[ ]*3|(^|[^a-z0-9])ps3([^a-z0-9]|$))' then 'playstation 3'
    when device_text ~ 'xbox[ ]+series[ ]+x' then 'xbox series x'
    when device_text ~ 'xbox[ ]+series[ ]+s' then 'xbox series s'
    when device_text ~ 'xbox[ ]+one[ ]+x' then 'xbox one x'
    when device_text ~ 'xbox[ ]+one[ ]+s' then 'xbox one s'
    when device_text ~ 'xbox[ ]+one' then 'xbox one'
    when device_text ~ 'nintendo[ ]+switch[ ]*2' then 'nintendo switch 2'
    when device_text ~ 'nintendo[ ]+switch' then 'nintendo switch'
    else nullif(lower(btrim(coalesce(model_rec.family,model_rec.name,dev.model,''))),'')
  end;
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

