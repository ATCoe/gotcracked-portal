create or replace function public.capture_marlon_verified_patch_release()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  t public.support_tickets%rowtype;
  v_current text;
  v_major integer := 1;
  v_minor integer := 0;
  v_patch integer := 0;
  v_version text;
  v_code text;
  v_highlights jsonb;
begin
  if new.status <> 'completed' then return new; end if;
  if tg_op='UPDATE' and old.status='completed' then return new; end if;
  if nullif(btrim(coalesce(new.commit_sha,'')),'') is null then return new; end if;

  select * into t from public.support_tickets where id=new.ticket_id;
  if not found then return new; end if;

  perform pg_advisory_xact_lock(hashtext('gotcracked-portal-release-version'));
  select version into v_current
  from public.portal_releases
  where version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'
  order by split_part(version,'.',1)::int desc,
           split_part(version,'.',2)::int desc,
           split_part(version,'.',3)::int desc
  limit 1;

  if v_current is not null then
    v_major := split_part(v_current,'.',1)::int;
    v_minor := split_part(v_current,'.',2)::int;
    v_patch := split_part(v_current,'.',3)::int;
  end if;

  loop
    v_patch := v_patch + 1;
    v_version := v_major::text||'.'||v_minor::text||'.'||v_patch::text;
    exit when not exists(
      select 1 from public.portal_releases where version=v_version
    );
  end loop;

  v_code := 'SUP-'||lpad(t.ticket_number::text,4,'0');
  v_highlights := jsonb_build_array(jsonb_build_object(
    'title',t.title,
    'description',coalesce(
      nullif(btrim(t.action_taken),''),
      nullif(btrim(t.resolution),''),
      'Verified Portal patch'
    ),
    'type','patch',
    'ticket',v_code
  ));

  insert into public.portal_releases(
    version,title,summary,status,feature_highlights,proposed_by,
    approved_by,approved_at,deployed_at,deployment_ref,release_kind,
    owner_approval_required
  ) values (
    v_version,
    'Portal Patch v'||v_version,
    coalesce(
      nullif(btrim(t.resolution),''),
      nullif(btrim(t.action_taken),''),
      'Marlon deployed and verified '||v_code||'.'
    ),
    'deployed',v_highlights,'Marlon',
    case when t.requires_approval then t.approval_decided_by else null end,
    case when t.requires_approval then t.approval_decided_at else new.started_at end,
    coalesce(new.finished_at,now()),
    'gotcracked-portal@'||new.commit_sha,
    'patch',t.requires_approval
  );

  return new;
end;
$$;

drop trigger if exists marlon_verified_patch_release
on public.marlon_execution_runs;
create trigger marlon_verified_patch_release
after insert or update of status
on public.marlon_execution_runs
for each row execute function public.capture_marlon_verified_patch_release();
