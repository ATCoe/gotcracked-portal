create or replace function public.marlon_support_history_context(
  p_query text,
  p_surface text default null,
  p_limit integer default 8
)
returns table(
  id uuid,
  ticket_number bigint,
  title text,
  description text,
  surface text,
  status text,
  diagnosis text,
  action_taken text,
  resolution text,
  updated_at timestamptz,
  relevance real
)
language sql
security definer
set search_path=public
as $$
  with q as (
    select websearch_to_tsquery('english', nullif(btrim(coalesce(p_query,'')),'')) as query
  ), ranked as (
    select t.*,
      case
        when q.query is null then 0::real
        else ts_rank_cd(
          to_tsvector('english', concat_ws(' ',t.title,t.description,t.diagnosis,t.action_taken,t.resolution,t.category,t.surface)),
          q.query
        )
      end as rank
    from public.support_tickets t
    cross join q
    where t.location_id=public.current_location_id()
      and t.status in ('resolved','closed')
      and (p_surface is null or p_surface='' or t.surface=p_surface)
  )
  select r.id,r.ticket_number,r.title,r.description,r.surface,r.status,r.diagnosis,r.action_taken,r.resolution,r.updated_at,r.rank
  from ranked r
  where r.rank > 0
  order by r.rank desc,r.updated_at desc
  limit greatest(1,least(coalesce(p_limit,8),20));
$$;

grant execute on function public.marlon_support_history_context(text,text,integer) to authenticated;

create or replace function public.capture_marlon_resolved_ticket_memory()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_summary text;
  v_key text;
begin
  if new.status not in ('resolved','closed') then return new; end if;
  if tg_op='UPDATE' and old.status in ('resolved','closed')
     and new.diagnosis is not distinct from old.diagnosis
     and new.action_taken is not distinct from old.action_taken
     and new.resolution is not distinct from old.resolution then
    return new;
  end if;

  v_key := 'support-ticket-' || new.id::text;
  v_summary := left(concat_ws(' ',
    'Resolved support ticket SUP-' || lpad(new.ticket_number::text,4,'0') || ':',
    new.title || '.',
    case when nullif(btrim(coalesce(new.diagnosis,'')),'') is not null then 'Diagnosis: ' || new.diagnosis || '.' end,
    case when nullif(btrim(coalesce(new.action_taken,'')),'') is not null then 'Fix: ' || new.action_taken || '.' end,
    case when nullif(btrim(coalesce(new.resolution,'')),'') is not null then 'Verified resolution: ' || new.resolution || '.' end
  ),1150);

  insert into public.marlon_memories(
    location_id,scope,profile_id,category,memory_key,summary,confidence,evidence_count,status,source_type,created_by,first_learned_at,last_reinforced_at,metadata
  ) values (
    new.location_id,'system',null,'reliability_lesson',v_key,v_summary,0.95,1,'active','incident',new.created_by,now(),now(),
    jsonb_build_object('ticket_id',new.id,'ticket_number',new.ticket_number,'surface',new.surface,'status',new.status,'source','support_ticket')
  )
  on conflict (location_id,scope,memory_key,coalesce(profile_id,'00000000-0000-0000-0000-000000000000'::uuid))
  do update set
    summary=excluded.summary,
    confidence=greatest(public.marlon_memories.confidence,excluded.confidence),
    evidence_count=public.marlon_memories.evidence_count+1,
    status='active',
    last_reinforced_at=now(),
    metadata=excluded.metadata;

  return new;
end;
$$;

drop trigger if exists marlon_resolved_ticket_memory on public.support_tickets;
create trigger marlon_resolved_ticket_memory
after insert or update of status,diagnosis,action_taken,resolution
on public.support_tickets
for each row execute function public.capture_marlon_resolved_ticket_memory();