create or replace function public.marlon_release_readiness()
returns jsonb
language sql
security definer
set search_path=public
as $$
  with eligible as (
    select ps.id,ps.created_at
    from public.portal_suggestions ps
    where ps.location_id=public.current_location_id()
      and (
        (ps.source='marlon' and ps.owner_review_required=true and ps.owner_review_state='approved' and ps.status='planned')
        or
        (ps.source<>'marlon' and ps.status in ('new','grouped'))
      )
      and not exists (
        select 1
        from public.portal_releases pr
        where pr.status<>'cancelled'
          and ps.id=any(pr.suggestion_ids)
      )
  )
  select jsonb_build_object(
    'threshold',s.suggestion_threshold,
    'eligible_count',count(e.id),
    'ready',count(e.id)>=s.suggestion_threshold,
    'current_version',s.current_version,
    'suggestion_ids',coalesce(jsonb_agg(e.id order by e.created_at) filter(where e.id is not null),'[]'::jsonb)
  )
  from public.portal_release_settings s
  left join eligible e on true
  where s.id=true
  group by s.suggestion_threshold,s.current_version;
$$;
