create or replace function public.dispatch_discord_outbox()
returns trigger
language plpgsql
security definer
set search_path to 'public','extensions'
as $function$
declare
  signing_secret text;
  ts bigint;
  signature text;
  delivery_url text;
begin
  if new.entity_type not in ('work_order','support_ticket','lead','pc_build_request','operator_pin_reset') then
    return new;
  end if;
  select secret into signing_secret from public.internal_runtime_secrets where key='discord_outbox_signing';
  if signing_secret is null then return new; end if;
  ts:=floor(extract(epoch from clock_timestamp()))::bigint;
  signature:=encode(extensions.hmac(convert_to(new.id::text||':'||ts::text,'UTF8'),convert_to(signing_secret,'UTF8'),'sha256'),'hex');
  delivery_url:=case when new.entity_type='operator_pin_reset'
    then 'https://uvpmmbioerejeyybfntb.supabase.co/functions/v1/operator-pin-reset-dm'
    else 'https://uvpmmbioerejeyybfntb.supabase.co/functions/v1/discord-outbox-delivery' end;
  perform net.http_post(
    url:=delivery_url,
    headers:=jsonb_build_object('Content-Type','application/json','x-gc-signature',signature),
    body:=jsonb_build_object('outbox_id',new.id,'ts',ts),
    timeout_milliseconds:=5000
  );
  return new;
exception when others then return new;
end;
$function$;
