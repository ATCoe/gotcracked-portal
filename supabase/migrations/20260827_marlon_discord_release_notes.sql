alter table public.discord_notification_outbox
  drop constraint if exists discord_notification_outbox_entity_type_check;

alter table public.discord_notification_outbox
  add constraint discord_notification_outbox_entity_type_check
  check (entity_type in (
    'lead','work_order','purchase_order','support_ticket',
    'pc_build_request','portal_release'
  ));

create or replace function public.enqueue_discord_portal_release_event()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_location uuid;
  v_event_key text;
begin
  if new.status <> 'deployed' then return new; end if;
  if tg_op='UPDATE' and old.status='deployed'
     and new.deployed_at is not distinct from old.deployed_at then
    return new;
  end if;
  select location_id into v_location
  from public.business_settings
  order by updated_at desc nulls last
  limit 1;
  if v_location is null then return new; end if;

  v_event_key := 'portal-release:'||new.id::text||':deployed';
  insert into public.discord_notification_outbox(
    location_id,event_key,event_type,entity_type,entity_id,payload
  ) values (
    v_location,v_event_key,'portal_release_deployed','portal_release',new.id,
    jsonb_build_object(
      'release_id',new.id,
      'version',new.version,
      'title',new.title,
      'summary',new.summary,
      'release_kind',new.release_kind,
      'feature_highlights',coalesce(new.feature_highlights,'[]'::jsonb),
      'deployment_ref',new.deployment_ref,
      'deployed_at',coalesce(new.deployed_at,now()),
      'portal_url','https://portal.gotcracked.co/'
    )
  ) on conflict(event_key) do nothing;
  return new;
end;
$$;

drop trigger if exists portal_release_discord_notes on public.portal_releases;
create trigger portal_release_discord_notes
after insert or update of status,deployed_at
on public.portal_releases
for each row execute function public.enqueue_discord_portal_release_event();

alter table public.marlon_discord_config
  add column if not exists future_updates_channel_id text;
