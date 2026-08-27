-- Location-scoped Vault storage for shipping provider credentials.
-- Kept separate from supplier catalog secrets so rotating a shipping key does
-- not depend on part_registry_sync_sources.

create or replace function public.server_store_shipping_secret(p_location_id uuid,p_secret text)
returns uuid
language plpgsql
security definer
set search_path='public','vault','pg_temp'
as $function$
declare sid uuid;
begin
  if coalesce(length(p_secret),0)<1 then raise exception 'Secret is required'; end if;
  select shipping_provider_secret_id into sid
  from public.business_settings
  where location_id=p_location_id
  for update;

  if sid is null then
    sid:=vault.create_secret(
      p_secret,
      'gotcracked_shipping_'||replace(p_location_id::text,'-','_'),
      'GotCracked location shipping provider credential'
    );
  else
    perform vault.update_secret(sid,p_secret,null,'GotCracked location shipping provider credential');
  end if;

  update public.business_settings
  set shipping_provider_secret_id=sid,updated_at=now()
  where location_id=p_location_id;
  return sid;
end;
$function$;

revoke all on function public.server_store_shipping_secret(uuid,text) from public,anon,authenticated;
grant execute on function public.server_store_shipping_secret(uuid,text) to service_role;
