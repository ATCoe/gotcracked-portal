alter table public.portal_suggestions add column if not exists owner_review_state text not null default 'not_required';
alter table public.portal_suggestions add column if not exists owner_review_requested_at timestamptz;
alter table public.portal_suggestions add column if not exists owner_review_decided_at timestamptz;
alter table public.portal_suggestions add column if not exists owner_review_decided_by uuid references public.profiles(id) on delete set null;
alter table public.portal_suggestions add column if not exists proposal_fingerprint text;
alter table public.portal_suggestions add column if not exists evidence jsonb not null default '{}'::jsonb;

alter table public.portal_suggestions drop constraint if exists portal_suggestions_owner_review_state_check;
alter table public.portal_suggestions add constraint portal_suggestions_owner_review_state_check
check (owner_review_state in ('not_required','pending','approved','denied'));

create table if not exists public.marlon_feature_proposal_discord_receipts (
  proposal_id uuid not null references public.portal_suggestions(id) on delete cascade,
  owner_profile_id uuid not null references public.profiles(id) on delete cascade,
  discord_user_id text not null,
  dm_channel_id text not null,
  message_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (proposal_id, owner_profile_id)
);
alter table public.marlon_feature_proposal_discord_receipts enable row level security;

create or replace function public.marlon_improvement_fingerprint(p_surface text,p_title text,p_description text)
returns text
language sql
immutable
set search_path=public,extensions
as $$
  select encode(
    extensions.digest(
      convert_to(lower(btrim(coalesce(p_surface,'')))||E'\n'||btrim(coalesce(p_title,''))||E'\n'||btrim(coalesce(p_description,'')),'UTF8'),
      'sha256'
    ),
    'hex'
  );
$$;

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
  saved public.portal_suggestions%rowtype;
begin
  if p_surface not in ('portal','website','both') then raise exception 'Invalid proposal surface.'; end if;
  if p_suggestion_type not in ('standard','workflow_improvement','premium_feature','reliability') then raise exception 'Invalid proposal type.'; end if;
  if p_complexity not in ('low','medium','high','very_high') then raise exception 'Invalid implementation complexity.'; end if;
  if char_length(btrim(coalesce(p_title,''))) < 3 then raise exception 'Proposal title is required.'; end if;
  if char_length(btrim(coalesce(p_description,''))) < 10 then raise exception 'Proposal description is required.'; end if;

  select location_id into v_location from public.business_settings order by updated_at desc nulls last limit 1;
  if v_location is null then raise exception 'Business location is unavailable.'; end if;
  v_fp := public.marlon_improvement_fingerprint(p_surface,p_title,p_description);

  select * into saved
  from public.portal_suggestions
  where location_id=v_location and source='marlon' and proposal_fingerprint=v_fp and status not in ('declined','implemented')
  order by created_at desc limit 1;
  if found then return saved; end if;

  insert into public.portal_suggestions(
    location_id,source,surface,title,description,category,status,
    suggestion_type,business_value,user_impact,implementation_complexity,
    owner_review_required,owner_review_state,owner_review_requested_at,
    proposal_fingerprint,evidence,marlon_summary
  ) values (
    v_location,'marlon',p_surface,btrim(p_title),btrim(p_description),'improvement','new',
    p_suggestion_type,
    nullif(btrim(coalesce(p_business_value,'')),''),
    nullif(btrim(coalesce(p_user_impact,'')),''),
    p_complexity,true,'pending',now(),v_fp,coalesce(p_evidence,'{}'::jsonb),
    'Marlon identified this as a possible workflow or product improvement. Owner approval is required before it may enter a future prepared update.'
  ) returning * into saved;
  return saved;
end;
$$;

create or replace function public.decide_marlon_improvement_proposal(p_suggestion uuid,p_approve boolean)
returns public.portal_suggestions
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  profile public.profiles%rowtype;
  saved public.portal_suggestions%rowtype;
begin
  select * into profile from public.profiles where id=auth.uid() and active=true;
  if not found or profile.role<>'owner' then raise exception 'Only an active Owner can decide Marlon feature proposals.'; end if;

  select * into saved
  from public.portal_suggestions
  where id=p_suggestion and location_id=profile.location_id
  for update;
  if not found then raise exception 'Feature proposal not found for this location.'; end if;
  if saved.source<>'marlon' or saved.owner_review_required<>true or saved.owner_review_state<>'pending' then raise exception 'This proposal is not awaiting Owner review.'; end if;
  if saved.proposal_fingerprint is distinct from public.marlon_improvement_fingerprint(saved.surface,saved.title,saved.description) then raise exception 'Proposal scope changed and must be reviewed again.'; end if;

  update public.portal_suggestions
  set owner_review_state=case when p_approve then 'approved' else 'denied' end,
      owner_review_decided_at=now(),
      owner_review_decided_by=auth.uid(),
      status=case when p_approve then 'planned' else 'declined' end,
      updated_at=now()
  where id=p_suggestion
  returning * into saved;
  return saved;
end;
$$;

create or replace function public.dispatch_marlon_improvement_discord()
returns trigger
language plpgsql
security definer
set search_path=public,private
as $$
begin
  if new.source<>'marlon' or coalesce(new.owner_review_required,false)<>true then return new; end if;

  if new.owner_review_state='pending' and (tg_op='INSERT' or old.owner_review_state is distinct from new.owner_review_state) then
    perform private.invoke_marlon_operation('feature-proposal-notify',jsonb_build_object('suggestion_id',new.id));
  elsif tg_op='UPDATE' and old.owner_review_state is distinct from new.owner_review_state and new.owner_review_state in ('approved','denied') then
    perform private.invoke_marlon_operation('feature-proposal-update',jsonb_build_object('suggestion_id',new.id));
  end if;
  return new;
end;
$$;

drop trigger if exists marlon_improvement_discord on public.portal_suggestions;
create trigger marlon_improvement_discord
after insert or update of owner_review_state on public.portal_suggestions
for each row execute function public.dispatch_marlon_improvement_discord();

revoke all on function public.create_marlon_improvement_proposal(text,text,text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_marlon_improvement_proposal(text,text,text,text,text,text,text,jsonb) to service_role;
grant execute on function public.decide_marlon_improvement_proposal(uuid,boolean) to authenticated;
