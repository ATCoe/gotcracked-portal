create table if not exists public.training_store_state (
  location_id uuid primary key references public.locations(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

alter table public.training_store_state enable row level security;

drop policy if exists training_store_state_staff_select on public.training_store_state;
create policy training_store_state_staff_select on public.training_store_state
for select to authenticated using (location_id = public.current_location_id());

grant select on public.training_store_state to authenticated;

create or replace function public.get_training_store_state()
returns jsonb language plpgsql security definer set search_path='public' as $$
declare loc uuid := public.current_location_id(); row_state public.training_store_state;
begin
  if loc is null then raise exception 'Authenticated staff location required.'; end if;
  insert into public.training_store_state(location_id,data,revision,updated_at)
  values(loc,'{}'::jsonb,0,now()) on conflict(location_id) do nothing;
  select * into row_state from public.training_store_state where location_id=loc;
  return jsonb_build_object('location_id',row_state.location_id,'data',row_state.data,'revision',row_state.revision,'updated_at',row_state.updated_at,'updated_by',row_state.updated_by);
end; $$;

grant execute on function public.get_training_store_state() to authenticated;

create or replace function public.save_training_store_state(payload jsonb)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare loc uuid := public.current_location_id(); row_state public.training_store_state;
begin
  if loc is null then raise exception 'Authenticated staff location required.'; end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then raise exception 'Training payload must be a JSON object.'; end if;
  insert into public.training_store_state(location_id,data,revision,updated_at,updated_by)
  values(loc,payload,1,now(),auth.uid())
  on conflict(location_id) do update set data=excluded.data,revision=public.training_store_state.revision+1,updated_at=now(),updated_by=auth.uid()
  returning * into row_state;
  return jsonb_build_object('location_id',row_state.location_id,'revision',row_state.revision,'updated_at',row_state.updated_at,'updated_by',row_state.updated_by);
end; $$;

grant execute on function public.save_training_store_state(jsonb) to authenticated;
