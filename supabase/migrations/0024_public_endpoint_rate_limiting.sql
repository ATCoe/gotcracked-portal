create table if not exists public.public_rate_limits (
  kind text not null,
  key_hash text not null,
  window_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (kind, key_hash, window_start)
);

alter table public.public_rate_limits enable row level security;
revoke all on table public.public_rate_limits from public, anon, authenticated;

create index if not exists public_rate_limits_updated_at_idx
  on public.public_rate_limits(updated_at);

create or replace function public.consume_public_rate_limit(
  p_kind text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_bucket timestamptz;
  v_count integer;
begin
  if coalesce(length(trim(p_kind)), 0) = 0
     or coalesce(length(trim(p_key_hash)), 0) < 16
     or p_limit < 1
     or p_window_seconds < 10 then
    return false;
  end if;

  v_bucket := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.public_rate_limits(kind, key_hash, window_start, request_count, updated_at)
  values (left(p_kind, 80), left(p_key_hash, 128), v_bucket, 1, now())
  on conflict (kind, key_hash, window_start)
  do update set
    request_count = public.public_rate_limits.request_count + 1,
    updated_at = now()
  returning request_count into v_count;

  if random() < 0.02 then
    delete from public.public_rate_limits where updated_at < now() - interval '2 days';
  end if;

  return v_count <= p_limit;
end;
$$;

revoke all on function public.consume_public_rate_limit(text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.consume_public_rate_limit(text,text,integer,integer) to service_role;
