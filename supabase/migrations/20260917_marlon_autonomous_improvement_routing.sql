create or replace function public.marlon_improvement_needs_owner_review(
  p_title text,
  p_description text,
  p_complexity text,
  p_suggestion_type text,
  p_evidence jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
immutable
set search_path=public
as $$
declare
  scope_text text:=lower(coalesce(p_title,'')||' '||coalesce(p_description,''));
begin
  if p_suggestion_type='premium_feature' or p_complexity in ('high','very_high') then return true; end if;
  if coalesce((p_evidence->>'capability_required')::boolean,false) then return true; end if;
  if scope_text ~ '((^|[^a-z])(auth|authentication|authorization|permission|permissions|rls|payment|payments|billing|credential|credentials|secret|secrets|oauth|password|passwords)([^a-z]|$)|row[ ]+level[ ]+security|role[ _-]*change|destructive|drop[ ]+table|delete[ ]+data|security[ ]+policy|service[ ]+role|database[ ]+migration)' then return true; end if;
  return false;
exception when others then
  return true;
end;
$$;
revoke all on function public.marlon_improvement_needs_owner_review(text,text,text,text,jsonb) from public,anon;
grant execute on function public.marlon_improvement_needs_owner_review(text,text,text,text,jsonb) to authenticated,service_role;

create or replace function public.queue_marlon_improvement_ticket(
  p_location uuid,
  p_suggestion uuid,
  p_surface text,
  p_title text,
  p_description text,
  p_business_value text,
  p_user_impact text,
  p_suggestion_type text,
  p_evidence jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  saved public.support_tickets%rowtype;
  category_name text;
  priority_name text;
begin
  if p_surface not in ('portal','website') then raise exception 'Executable Marlon improvement surface must be portal or website.'; end if;
  category_name:=case when p_suggestion_type='workflow_improvement' then 'workflow' when p_surface='website' then 'website_ui' else 'portal_ui' end;
  priority_name:=case when p_suggestion_type='reliability' then 'high' else 'normal' end;
  insert into public.support_tickets(
    location_id,title,description,category,priority,status,source,surface,managed_by,
    requires_approval,change_level,approval_state,approval_status,context
  ) values(
    p_location,left(p_title,180),left(
      p_description||
      case when nullif(btrim(coalesce(p_business_value,'')),'') is not null then E'\n\nBusiness value: '||btrim(p_business_value) else '' end||
      case when nullif(btrim(coalesce(p_user_impact,'')),'') is not null then E'\nUser impact: '||btrim(p_user_impact) else '' end,
      5000),category_name,priority_name,'open','system',p_surface,'Marlon',
    false,'standard','not_required','not_required',
    jsonb_build_object(
      'marlon_autonomous_improvement',true,
      'suggestion_id',p_suggestion,
      'suggestion_type',p_suggestion_type,
      'owner_requested',false,
      'evidence',coalesce(p_evidence,'{}'::jsonb)
    )
  ) returning * into saved;
  insert into public.support_ticket_events(ticket_id,actor,event_type,message)
  values(saved.id,'marlon','autonomous_improvement_queued','Marlon converted a safe improvement into bounded execution work. Protected-system and deployment gates still apply.');
  return saved.id;
end;
$$;
revoke all on function public.queue_marlon_improvement_ticket(uuid,uuid,text,text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.queue_marlon_improvement_ticket(uuid,uuid,text,text,text,text,text,text,jsonb) to service_role;

create or replace function public.create_marlon_improvement_proposal(
  p_surface text,
  p_title text,
  p_description text,
  p_business_value text default null,
  p_user_impact text default null,
  p_complexity text default 'medium',
  p_suggestion_type text default 'workflow_improvement',
  p_evidence jsonb default '{}'::jsonb
)
returns public.portal_suggestions
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_location uuid;
  v_fp text;
  v_review boolean;
  saved public.portal_suggestions%rowtype;
  portal_ticket uuid;
  website_ticket uuid;
begin
  if p_surface not in ('portal','website','both') then raise exception 'Invalid proposal surface.'; end if;
  if p_suggestion_type not in ('standard','workflow_improvement','premium_feature','reliability') then raise exception 'Invalid proposal type.'; end if;
  if p_complexity not in ('low','medium','high','very_high') then raise exception 'Invalid implementation complexity.'; end if;
  if char_length(btrim(coalesce(p_title,'')))<3 then raise exception 'Proposal title is required.'; end if;
  if char_length(btrim(coalesce(p_description,'')))<10 then raise exception 'Proposal description is required.'; end if;

  select location_id into v_location from public.business_settings order by updated_at desc nulls last limit 1;
  if v_location is null then raise exception 'Business location is unavailable.'; end if;
  v_fp:=public.marlon_improvement_fingerprint(p_surface,p_title,p_description);
  select * into saved from public.portal_suggestions
  where location_id=v_location and source='marlon' and proposal_fingerprint=v_fp
    and status not in ('declined','implemented')
  order by created_at desc limit 1;
  if found then return saved; end if;

  v_review:=public.marlon_improvement_needs_owner_review(p_title,p_description,p_complexity,p_suggestion_type,p_evidence);
  insert into public.portal_suggestions(
    location_id,source,surface,title,description,category,status,suggestion_type,business_value,user_impact,
    implementation_complexity,owner_review_required,owner_review_state,owner_review_requested_at,
    proposal_fingerprint,evidence,marlon_summary
  ) values(
    v_location,'marlon',p_surface,btrim(p_title),btrim(p_description),'improvement',case when v_review then 'new' else 'planned' end,
    p_suggestion_type,nullif(btrim(coalesce(p_business_value,'')),''),nullif(btrim(coalesce(p_user_impact,'')),''),p_complexity,
    v_review,case when v_review then 'pending' else 'not_required' end,case when v_review then now() else null end,
    v_fp,coalesce(p_evidence,'{}'::jsonb),
    case when v_review then
      case when coalesce((p_evidence->>'capability_required')::boolean,false)
        then 'Marlon needs an external capability, account, credential, paid service, or installation before this work can proceed. Owner action is required.'
        else 'Marlon identified a protected, premium, or high-complexity improvement. Owner review is required before execution.' end
      else 'Marlon classified this as routine safe improvement work and queued it for bounded implementation, testing, deployment, and verification.' end
  ) returning * into saved;

  if not v_review then
    if p_surface in ('portal','both') then
      portal_ticket:=public.queue_marlon_improvement_ticket(v_location,saved.id,'portal',saved.title,saved.description,saved.business_value,saved.user_impact,saved.suggestion_type,saved.evidence);
    end if;
    if p_surface in ('website','both') then
      website_ticket:=public.queue_marlon_improvement_ticket(v_location,saved.id,'website',saved.title,saved.description,saved.business_value,saved.user_impact,saved.suggestion_type,saved.evidence);
    end if;
    update public.portal_suggestions
    set evidence=coalesce(evidence,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object(
      'execution_portal_ticket_id',portal_ticket,
      'execution_website_ticket_id',website_ticket,
      'autonomous_queue_at',now()
    )),updated_at=now()
    where id=saved.id returning * into saved;
  end if;
  return saved;
end;
$$;
revoke all on function public.create_marlon_improvement_proposal(text,text,text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_marlon_improvement_proposal(text,text,text,text,text,text,text,jsonb) to service_role;

-- Legacy proposals created under the old blanket-review policy remain historical review records.
-- Do not bulk-enqueue them during this release. New safe Marlon proposals route directly through
-- create_marlon_improvement_proposal(), while legacy ideas can be re-evaluated deliberately later.

create or replace function public.complete_marlon_capability_request(p_suggestion uuid)
returns public.portal_suggestions
language plpgsql
security definer
set search_path=public
as $$
declare
  profile public.profiles%rowtype;
  saved public.portal_suggestions%rowtype;
  cleaned_evidence jsonb;
  still_review boolean;
  portal_ticket uuid;
  website_ticket uuid;
begin
  select * into profile from public.profiles where id=auth.uid() and active=true;
  if not found or profile.role<>'owner' then raise exception 'Only an active Owner can confirm a Marlon capability installation.'; end if;
  select * into saved from public.portal_suggestions where id=p_suggestion and location_id=profile.location_id for update;
  if not found or saved.source<>'marlon' then raise exception 'Marlon capability request not found.'; end if;
  if not coalesce((saved.evidence->>'capability_required')::boolean,false) then raise exception 'This suggestion does not have an outstanding capability request.'; end if;

  cleaned_evidence:=coalesce(saved.evidence,'{}'::jsonb)||jsonb_build_object(
    'capability_required',false,'capability_completed_at',now(),'capability_completed_by',auth.uid()
  );
  still_review:=public.marlon_improvement_needs_owner_review(saved.title,saved.description,coalesce(saved.implementation_complexity,'medium'),coalesce(saved.suggestion_type,'standard'),cleaned_evidence);

  update public.portal_suggestions
  set evidence=cleaned_evidence,
      owner_review_required=still_review,
      owner_review_state=case when still_review then 'pending' else 'not_required' end,
      owner_review_requested_at=case when still_review then now() else null end,
      owner_review_decided_at=null,owner_review_decided_by=null,
      status=case when still_review then 'new' else 'planned' end,
      marlon_summary=case when still_review then 'Required capability is available. The remaining protected, premium, or high-complexity scope still requires Owner review.' else 'Required capability is available. Marlon queued the remaining routine work for bounded execution.' end,
      updated_at=now()
  where id=saved.id returning * into saved;

  if not still_review then
    if saved.surface in ('portal','both') then portal_ticket:=public.queue_marlon_improvement_ticket(saved.location_id,saved.id,'portal',saved.title,saved.description,saved.business_value,saved.user_impact,saved.suggestion_type,saved.evidence); end if;
    if saved.surface in ('website','both') then website_ticket:=public.queue_marlon_improvement_ticket(saved.location_id,saved.id,'website',saved.title,saved.description,saved.business_value,saved.user_impact,saved.suggestion_type,saved.evidence); end if;
    update public.portal_suggestions set evidence=evidence||jsonb_strip_nulls(jsonb_build_object('execution_portal_ticket_id',portal_ticket,'execution_website_ticket_id',website_ticket,'autonomous_queue_at',now())),updated_at=now() where id=saved.id returning * into saved;
  end if;
  return saved;
end;
$$;
revoke all on function public.complete_marlon_capability_request(uuid) from public,anon,authenticated,service_role;
grant execute on function public.complete_marlon_capability_request(uuid) to authenticated;
