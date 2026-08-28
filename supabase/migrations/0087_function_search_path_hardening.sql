-- Pin remaining helper/trigger search paths so object resolution cannot be influenced
-- by a caller-controlled role search_path.

alter function public.marlon_scope_fingerprint(text, text, text)
  set search_path = pg_catalog, public;

alter function public.touch_support_ticket()
  set search_path = pg_catalog, public;

alter function public.normalize_shipping_scan(text)
  set search_path = pg_catalog, public;

alter function public.normalize_repair_device_class(text, text, text)
  set search_path = pg_catalog, public;

alter function public.booking_normalize_text(text)
  set search_path = pg_catalog, public;

alter function public.normalize_repair_service_key(text)
  set search_path = pg_catalog, public;
