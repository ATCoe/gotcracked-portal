create or replace function public.marlon_execution_history_context(p_ticket_id uuid,p_limit integer default 8)
returns jsonb
language sql
security definer
set search_path=public
as $$
  with target as (
    select id,location_id,surface,concat_ws(' ',title,description,category,surface) as query_text
    from public.support_tickets
    where id=p_ticket_id
  ), q as (
    select target.*, websearch_to_tsquery('english', nullif(btrim(query_text),'')) as query
    from target
  ), ranked as (
    select t.id,t.ticket_number,t.title,t.description,t.surface,t.status,t.diagnosis,t.action_taken,t.resolution,t.updated_at,
      case when q.query is null then 0::real else ts_rank_cd(
        to_tsvector('english',concat_ws(' ',t.title,t.description,t.diagnosis,t.action_taken,t.resolution,t.category,t.surface)),q.query
      ) end as relevance
    from public.support_tickets t
    join q on q.location_id=t.location_id
    where t.id<>q.id and t.status in ('resolved','closed')
      and (t.surface=q.surface or q.surface='repository')
  ), picked as (
    select * from ranked where relevance>0 order by relevance desc,updated_at desc
    limit greatest(1,least(coalesce(p_limit,8),20))
  )
  select coalesce(jsonb_agg(to_jsonb(picked) order by relevance desc,updated_at desc),'[]'::jsonb) from picked;
$$;

revoke all on function public.marlon_execution_history_context(uuid,integer) from public,anon,authenticated;
grant execute on function public.marlon_execution_history_context(uuid,integer) to service_role;
