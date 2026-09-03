-- A browser retry must resolve to the original request instead of creating a
-- second lead and appointment. The token is generated per form session and is
-- never treated as a credential.
alter table public.leads
  add column if not exists client_request_id uuid;

create unique index if not exists leads_client_request_id_uidx
  on public.leads(client_request_id)
  where client_request_id is not null;

comment on column public.leads.client_request_id is
  'Client-generated idempotency token for one public intake form session.';

