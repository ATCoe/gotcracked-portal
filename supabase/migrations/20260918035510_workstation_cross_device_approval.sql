-- Secure cross-device approval for AuroraServer shared-workstation enrollment.
create table if not exists public.workstation_enrollment_requests (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  workstation_profile_id uuid not null references public.profiles(id) on delete cascade,
  device_id_hash text not null,
  device_label text not null default 'AuroraServer GotCracked',
  approval_fingerprint text not null,
  expires_at timestamptz not null,
  approved_at timestamptz,
  approved_by uuid references public.profiles(id),
  denied_at timestamptz,
  denied_by uuid references public.profiles(id),
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (not (approved_at is not null and denied_at is not null))
);

create index if not exists workstation_enrollment_requests_active_idx
  on public.workstation_enrollment_requests(location_id, created_at desc)
  where consumed_at is null;

create index if not exists workstation_enrollment_requests_device_idx
  on public.workstation_enrollment_requests(workstation_profile_id, device_id_hash, created_at desc);

alter table public.workstation_enrollment_requests enable row level security;
revoke all on public.workstation_enrollment_requests from anon, authenticated;
comment on table public.workstation_enrollment_requests is
  'Service-only short-lived requests for cross-device shared-workstation approval. Discord-signed owner/manager interactions decide requests; browser clients never receive direct table access.';

insert into public.staff_account_events(location_id,event_type,details)
select p.location_id,'workstation_cross_device_approval_enabled',
       jsonb_build_object('workstation_profile_id',p.id,'enabled_at',now())
from public.profiles p
where p.account_type='shared_workstation' and p.active=true
  and not exists (
    select 1 from public.staff_account_events e
    where e.event_type='workstation_cross_device_approval_enabled'
      and e.details->>'workstation_profile_id'=p.id::text
  );

alter table public.discord_notification_outbox
  drop constraint if exists discord_notification_outbox_entity_type_check;

alter table public.discord_notification_outbox
  add constraint discord_notification_outbox_entity_type_check
  check (entity_type = any(array[
    'lead'::text,
    'work_order'::text,
    'purchase_order'::text,
    'support_ticket'::text,
    'pc_build_request'::text,
    'portal_release'::text,
    'operator_pin_reset'::text,
    'workstation_enrollment'::text
  ]));

alter table public.workstation_enrollment_requests
  add column if not exists redeem_code_hash text,
  add column if not exists redeem_attempts integer not null default 0
    check (redeem_attempts between 0 and 20);
