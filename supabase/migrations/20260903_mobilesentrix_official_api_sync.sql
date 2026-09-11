-- MobileSentrix official API defaults and linked supplier identity.
-- Supplier catalog availability is kept separate from GotCracked physical stock.

update public.part_registry_sync_sources
set enabled = true,
    mode = 'api',
    last_status = case when secret_id is null then 'not_configured' else last_status end,
    last_error = case when secret_id is null then null else last_error end,
    config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
      'api_base_url',
        coalesce(nullif(config->>'api_base_url', ''), 'https://www.mobilesentrix.com'),
      'catalog_path',
        case
          when nullif(config->>'catalog_path', '') is null
            or config->>'catalog_path' = '/rest/V1/products'
            then '/api/rest/products'
          else config->>'catalog_path'
        end,
      'auth_scheme',
        case
          when secret_id is null
            and coalesce(nullif(config->>'auth_scheme', ''), 'bearer') = 'bearer'
            then 'oauth1'
          else coalesce(nullif(config->>'auth_scheme', ''), 'oauth1')
        end,
      'pagination_mode',
        case
          when nullif(config->>'pagination_mode', '') is null
            then 'magento1'
          else config->>'pagination_mode'
        end,
      'page_size',
        least(
          100,
          greatest(
            1,
            case
              when coalesce(config->>'page_size', '') ~ '^[0-9]+$'
                then (config->>'page_size')::integer
              else 100
            end
          )
        ),
      'integration_method', 'official_api_consumer',
      'oauth_initiate_path', '/oauth/initiate',
      'oauth_authorize_path', '/oauth/authorize',
      'oauth_token_path', '/oauth/token',
      'oauth_callback_url', 'https://portal.gotcracked.co/?mobilesentrix_oauth=callback'
    ),
    updated_at = now()
where source_name = 'mobilesentrix';

insert into public.supplier_account_links (
  location_id,
  supplier_key,
  account_label,
  account_email,
  portal_url,
  linked_at,
  updated_at
)
select
  l.id,
  'mobilesentrix',
  'GotCracked MobileSentrix',
  'hello@gotcracked.co',
  'https://www.mobilesentrix.com/customer/account/',
  now(),
  now()
from public.locations l
where lower(l.name) = 'blacksburg'
on conflict (location_id, supplier_key) do update
set account_label = coalesce(nullif(public.supplier_account_links.account_label, ''), excluded.account_label),
    account_email = coalesce(nullif(public.supplier_account_links.account_email, ''), excluded.account_email),
    portal_url = excluded.portal_url,
    linked_at = coalesce(public.supplier_account_links.linked_at, excluded.linked_at),
    updated_at = now();

comment on column public.part_registry_sync_sources.config is
  'Non-secret supplier sync settings and resumable run metadata. API credentials are stored separately in Supabase Vault.';
