-- A trusted shared workstation may read its basic workflow, but mutations require a verified human PIN context.

create or replace function public.get_workstation_operator_roster()
returns table(profile_id uuid,display_name text,job_title text,role text,avatar_url text,pin_configured boolean,reset_required boolean,discord_linked boolean)
language plpgsql security definer set search_path to 'public' as $function$
declare actor public.profiles;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into actor from public.profiles where id=auth.uid() and active=true;
  if actor.id is null then raise exception 'Active Portal profile required'; end if;
  if coalesce(actor.account_type,'staff')='shared_workstation' and not public.portal_session_authorized() then raise exception 'This workstation is not enrolled or has been revoked.'; end if;
  if coalesce(actor.account_type,'staff')<>'shared_workstation' and (actor.role::text not in ('owner','manager') or not public.portal_human_session()) then raise exception 'Operator roster access denied.'; end if;
  return query select p.id,p.display_name,p.job_title,p.role::text,case when p.avatar_url is null or p.avatar_url like 'preset:%' then null else p.avatar_url end,
    (s.pin_hash is not null and not coalesce(s.reset_required,true)),coalesce(s.reset_required,true),(p.discord_user_id is not null)
  from public.profiles p left join public.staff_operator_pins s on s.profile_id=p.id
  where p.location_id=actor.location_id and p.active=true and coalesce(p.account_type,'staff')='staff' order by p.display_name;
end;$function$;

create or replace function public.verify_workstation_operator_pin(target_profile uuid,pin text)
returns jsonb language plpgsql security definer set search_path to 'public','extensions' as $function$
declare actor public.profiles; target public.profiles; s public.staff_operator_pins; v_pin text:=trim(coalesce(pin,'')); attempts integer; token text; token_digest text; session_expiry timestamptz:=now()+interval '4 hours';
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if v_pin !~ '^[0-9]{4,6}$' then return jsonb_build_object('ok',false,'reason','invalid_format'); end if;
  select * into actor from public.profiles where id=auth.uid() and active=true;
  if actor.id is null or coalesce(actor.account_type,'staff')<>'shared_workstation' then raise exception 'Shared workstation authentication required.'; end if;
  if not public.portal_session_authorized() then raise exception 'This workstation is not enrolled or has been revoked.'; end if;
  select * into target from public.profiles where id=target_profile and location_id=actor.location_id and active=true and coalesce(account_type,'staff')='staff';
  if target.id is null then return jsonb_build_object('ok',false,'reason','operator_unavailable'); end if;
  select * into s from public.staff_operator_pins where profile_id=target.id for update;
  if s.profile_id is null or s.pin_hash is null or coalesce(s.reset_required,true) then return jsonb_build_object('ok',false,'reason','pin_setup_required'); end if;
  if s.locked_until is not null and s.locked_until>now() then return jsonb_build_object('ok',false,'reason','locked','locked_until',s.locked_until); end if;
  if s.pin_hash<>extensions.crypt(v_pin,s.pin_hash) then
    attempts:=coalesce(s.failed_attempts,0)+1;
    update public.staff_operator_pins set failed_attempts=case when attempts>=5 then 0 else attempts end,locked_until=case when attempts>=5 then now()+interval '5 minutes' else null end,updated_at=now() where profile_id=target.id;
    return jsonb_build_object('ok',false,'reason',case when attempts>=5 then 'locked' else 'incorrect_pin' end,'attempts_remaining',greatest(5-attempts,0),'locked_until',case when attempts>=5 then now()+interval '5 minutes' else null end);
  end if;
  update public.staff_operator_pins set failed_attempts=0,locked_until=null,last_verified_at=now(),updated_at=now() where profile_id=target.id;
  update public.workstation_operator_sessions set revoked_at=now() where workstation_profile_id=actor.id and revoked_at is null;
  token:=encode(extensions.gen_random_bytes(32),'hex'); token_digest:=encode(extensions.digest(token,'sha256'),'hex');
  insert into public.workstation_operator_sessions(location_id,workstation_profile_id,operator_profile_id,token_hash,expires_at) values(actor.location_id,actor.id,target.id,token_digest,session_expiry);
  return jsonb_build_object('ok',true,'session_token',token,'expires_at',session_expiry,'operator',jsonb_build_object('id',target.id,'display_name',target.display_name,'job_title',target.job_title,'role',target.role,'avatar_url',case when target.avatar_url like 'preset:%' then null else target.avatar_url end));
end;$function$;

create or replace function public.validate_workstation_operator_session(session_token text)
returns jsonb language plpgsql security definer set search_path to 'public','extensions' as $function$
declare actor public.profiles; ws public.workstation_operator_sessions; op public.profiles; token_digest text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into actor from public.profiles where id=auth.uid() and active=true;
  if actor.id is null or coalesce(actor.account_type,'staff')<>'shared_workstation' then raise exception 'Shared workstation authentication required.'; end if;
  if not public.portal_session_authorized() then raise exception 'This workstation is not enrolled or has been revoked.'; end if;
  if coalesce(session_token,'')='' then return jsonb_build_object('ok',false); end if;
  token_digest:=encode(extensions.digest(session_token,'sha256'),'hex');
  select * into ws from public.workstation_operator_sessions where workstation_profile_id=actor.id and token_hash=token_digest and revoked_at is null and expires_at>now() order by created_at desc limit 1;
  if ws.id is null then return jsonb_build_object('ok',false); end if;
  select * into op from public.profiles where id=ws.operator_profile_id and active=true and coalesce(account_type,'staff')='staff';
  if op.id is null then update public.workstation_operator_sessions set revoked_at=now() where id=ws.id; return jsonb_build_object('ok',false); end if;
  update public.workstation_operator_sessions set last_seen_at=now() where id=ws.id;
  return jsonb_build_object('ok',true,'expires_at',ws.expires_at,'operator',jsonb_build_object('id',op.id,'display_name',op.display_name,'job_title',op.job_title,'role',op.role,'avatar_url',case when op.avatar_url like 'preset:%' then null else op.avatar_url end));
end;$function$;

create or replace function public.end_workstation_operator_session(session_token text)
returns boolean language plpgsql security definer set search_path to 'public','extensions' as $function$
declare actor public.profiles; token_digest text;
begin
  if auth.uid() is null then return false; end if;
  select * into actor from public.profiles where id=auth.uid() and active=true;
  if actor.id is null or coalesce(actor.account_type,'staff')<>'shared_workstation' or not public.portal_session_authorized() then return false; end if;
  token_digest:=encode(extensions.digest(coalesce(session_token,''),'sha256'),'hex');
  update public.workstation_operator_sessions set revoked_at=now() where workstation_profile_id=actor.id and token_hash=token_digest and revoked_at is null;
  return found;
end;$function$;

create or replace function public.request_operator_pin_reset(target_profile uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare actor public.profiles; target public.profiles; s public.staff_operator_pins; queue_dm boolean:=false; event_id uuid; workstation_request boolean:=false; requester_id uuid; requester_name text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into actor from public.profiles where id=auth.uid() and active=true;
  if actor.id is null or not public.portal_session_authorized() then raise exception 'Authorized Portal session required'; end if;
  select * into target from public.profiles where id=target_profile and active=true;
  if target.id is null or target.location_id<>actor.location_id or coalesce(target.account_type,'staff')<>'staff' then raise exception 'Human staff member not found for this location.'; end if;
  workstation_request:=coalesce(actor.account_type,'staff')='shared_workstation';
  if actor.id<>target.id and not workstation_request and actor.role::text not in ('owner','manager') then raise exception 'PIN reset permission denied.'; end if;
  select * into s from public.staff_operator_pins where profile_id=target.id for update;
  queue_dm:=target.discord_user_id is not null and (s.reset_requested_at is null or s.reset_requested_at<now()-interval '5 minutes');
  requester_id:=coalesce(public.current_actor_profile_id(),actor.id);
  requester_name:=coalesce((select display_name from public.profiles where id=public.current_actor_profile_id()),actor.display_name);
  if workstation_request then
    if queue_dm then
      insert into public.staff_operator_pins(profile_id,location_id,pin_hash,reset_required,reset_requested_at,failed_attempts,locked_until,updated_at)
      values(target.id,target.location_id,null,true,now(),0,null,now()) on conflict(profile_id) do update set reset_requested_at=now(),updated_at=now();
      insert into public.discord_notification_outbox(location_id,event_key,event_type,entity_type,entity_id,payload)
      values(target.location_id,'operator-pin-reset-reminder:'||target.id::text||':'||floor(extract(epoch from clock_timestamp())*1000)::bigint::text,'operator_pin_reset_requested','operator_pin_reset',target.id,
        jsonb_build_object('target_profile_id',target.id,'target_display_name',target.display_name,'target_discord_user_id',target.discord_user_id,'requested_by_profile_id',requester_id,'requested_by_name',requester_name,'reminder_only',true,'portal_url','https://portal.gotcracked.co/#profile')) returning id into event_id;
    end if;
    return jsonb_build_object('ok',true,'reset_required',coalesce(s.reset_required,s.pin_hash is null,true),'dm_queued',queue_dm,'outbox_id',event_id,'discord_linked',target.discord_user_id is not null,'message',case when target.discord_user_id is null then 'Discord is not linked. Ask management to reset this PIN from a human Portal account.' when queue_dm then 'Marlon sent a secure Discord reminder. Open your personal Portal account to create a new PIN.' else 'A recent PIN reminder was already sent by Marlon.' end);
  end if;
  insert into public.staff_operator_pins(profile_id,location_id,pin_hash,reset_required,reset_requested_at,failed_attempts,locked_until,updated_at)
  values(target.id,target.location_id,null,true,case when queue_dm then now() else null end,0,null,now()) on conflict(profile_id) do update set location_id=excluded.location_id,pin_hash=null,reset_required=true,reset_requested_at=case when queue_dm then now() else public.staff_operator_pins.reset_requested_at end,failed_attempts=0,locked_until=null,updated_at=now();
  update public.workstation_operator_sessions set revoked_at=now() where operator_profile_id=target.id and revoked_at is null;
  if queue_dm then insert into public.discord_notification_outbox(location_id,event_key,event_type,entity_type,entity_id,payload)
    values(target.location_id,'operator-pin-reset:'||target.id::text||':'||floor(extract(epoch from clock_timestamp())*1000)::bigint::text,'operator_pin_reset_requested','operator_pin_reset',target.id,jsonb_build_object('target_profile_id',target.id,'target_display_name',target.display_name,'target_discord_user_id',target.discord_user_id,'requested_by_profile_id',requester_id,'requested_by_name',requester_name,'portal_url','https://portal.gotcracked.co/#profile')) returning id into event_id; end if;
  return jsonb_build_object('ok',true,'reset_required',true,'dm_queued',queue_dm,'outbox_id',event_id,'discord_linked',target.discord_user_id is not null,'message',case when target.discord_user_id is null then 'PIN reset. Discord is not linked, so Marlon could not send a DM.' when queue_dm then 'PIN reset. Marlon is sending the employee a Discord DM.' else 'PIN reset. A recent reset DM was already sent.' end);
end;$function$;

create or replace function public.apply_workstation_actor_attribution()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare actor uuid; payload jsonb;
begin
  if coalesce((select account_type from public.profiles where id=auth.uid()),'staff')<>'shared_workstation' then return new; end if;
  if not public.portal_session_authorized() then raise exception 'This workstation is not enrolled or has been revoked.'; end if;
  actor:=public.require_current_actor_profile_id(); payload:=to_jsonb(new);
  if payload ? 'actor_user_id' then payload:=jsonb_set(payload,'{actor_user_id}',to_jsonb(actor),true); end if;
  if payload ? 'created_by' then payload:=jsonb_set(payload,'{created_by}',to_jsonb(actor),true); end if;
  if payload ? 'requested_by' then payload:=jsonb_set(payload,'{requested_by}',to_jsonb(actor),true); end if;
  if payload ? 'verified_by' and payload->>'verified_by'=auth.uid()::text then payload:=jsonb_set(payload,'{verified_by}',to_jsonb(actor),true); end if;
  if payload ? 'payment_confirmed_by' and payload->>'payment_confirmed_by'=auth.uid()::text then payload:=jsonb_set(payload,'{payment_confirmed_by}',to_jsonb(actor),true); end if;
  if payload ? 'completed_by' and payload->>'completed_by'=auth.uid()::text then payload:=jsonb_set(payload,'{completed_by}',to_jsonb(actor),true); end if;
  new:=jsonb_populate_record(new,payload); return new;
end;$function$;

do $triggers$ declare t text; begin
  foreach t in array array['ticket_events','lead_events','support_ticket_events','work_order_item_events','inventory_transactions','receipts','receipt_deliveries','payment_requests','repair_tickets','work_order_items','sales_ledger_entries','reconciliation_events','intake_sessions'] loop
    execute format('drop trigger if exists gc_workstation_actor_attribution on public.%I',t);
    execute format('create trigger gc_workstation_actor_attribution before insert or update on public.%I for each row execute function public.apply_workstation_actor_attribution()',t);
  end loop;
end $triggers$;

-- Prevent a shared workstation from reading employee private profile fields through PostgREST.
drop policy if exists "staff can read profiles at their location" on public.profiles;
create policy "staff can read profiles at their location" on public.profiles for select to authenticated using (id=auth.uid() or (public.portal_human_session() and location_id=public.current_location_id()));

drop policy if exists "authenticated staff can read permission definitions" on public.permission_definitions;
create policy "authenticated staff can read permission definitions" on public.permission_definitions for select to authenticated using (public.portal_human_session());

drop policy if exists "staff can view inventory audits" on public.inventory_audits;
create policy "staff can view inventory audits" on public.inventory_audits for select to authenticated using (location_id=public.current_location_id() and public.has_permission('inventory.manage'));
drop policy if exists "staff can view inventory audit items" on public.inventory_audit_items;
create policy "staff can view inventory audit items" on public.inventory_audit_items for select to authenticated using (public.has_permission('inventory.manage') and exists(select 1 from public.inventory_audits a where a.id=inventory_audit_items.audit_id and a.location_id=public.current_location_id()));
drop policy if exists "staff can add inventory transactions" on public.inventory_transactions;
create policy "staff can add inventory transactions" on public.inventory_transactions for insert to authenticated with check (location_id=public.current_location_id() and public.has_permission('inventory.manage'));
drop policy if exists "staff can view inventory transactions" on public.inventory_transactions;
create policy "staff can view inventory transactions" on public.inventory_transactions for select to authenticated using (location_id=public.current_location_id() and public.has_permission('inventory.view'));

drop policy if exists "staff can view purchase orders" on public.purchase_orders;
drop policy if exists "staff can view purchase order items" on public.purchase_order_items;

drop policy if exists "staff can view support tickets" on public.support_tickets;
create policy "staff can view support tickets" on public.support_tickets for select to authenticated using (public.portal_human_session() and location_id=public.current_location_id());
drop policy if exists "staff can create support tickets" on public.support_tickets;
create policy "staff can create support tickets" on public.support_tickets for insert to authenticated with check (public.portal_human_session() and location_id=public.current_location_id() and created_by=auth.uid());
drop policy if exists "staff can view support ticket events" on public.support_ticket_events;
create policy "staff can view support ticket events" on public.support_ticket_events for select to authenticated using (public.portal_human_session() and exists(select 1 from public.support_tickets t where t.id=support_ticket_events.ticket_id and t.location_id=public.current_location_id()));
drop policy if exists "staff can add support ticket events" on public.support_ticket_events;
create policy "staff can add support ticket events" on public.support_ticket_events for insert to authenticated with check (public.portal_human_session() and exists(select 1 from public.support_tickets t where t.id=support_ticket_events.ticket_id and t.location_id=public.current_location_id()));

-- Marlon/management/release metadata is never part of the shared-counter workflow.
drop policy if exists "staff view releases" on public.portal_releases; create policy "staff view releases" on public.portal_releases for select to authenticated using (public.portal_human_session());
drop policy if exists "staff view release settings" on public.portal_release_settings; create policy "staff view release settings" on public.portal_release_settings for select to authenticated using (public.portal_human_session());
drop policy if exists "staff view suggestions" on public.portal_suggestions; create policy "staff view suggestions" on public.portal_suggestions for select to authenticated using (public.portal_human_session() and location_id=public.current_location_id());
drop policy if exists "staff view marlon memories" on public.marlon_memories; create policy "staff view marlon memories" on public.marlon_memories for select to authenticated using (public.portal_human_session() and location_id=public.current_location_id());
drop policy if exists "staff view marlon learning events" on public.marlon_learning_events; create policy "staff view marlon learning events" on public.marlon_learning_events for select to authenticated using (public.portal_human_session() and location_id=public.current_location_id());
drop policy if exists "marlon_execution_capabilities_read" on public.marlon_execution_capabilities; create policy "marlon_execution_capabilities_read" on public.marlon_execution_capabilities for select to authenticated using (public.portal_human_session() and location_id=public.current_location_id());
drop policy if exists "marlon_execution_runs_read" on public.marlon_execution_runs; create policy "marlon_execution_runs_read" on public.marlon_execution_runs for select to authenticated using (public.portal_human_session() and location_id=public.current_location_id());
drop policy if exists "marlon_visual_findings_read" on public.marlon_visual_findings; create policy "marlon_visual_findings_read" on public.marlon_visual_findings for select to authenticated using (public.portal_human_session() and location_id=public.current_location_id());
drop policy if exists "marlon_visual_monitor_runs_read" on public.marlon_visual_monitor_runs; create policy "marlon_visual_monitor_runs_read" on public.marlon_visual_monitor_runs for select to authenticated using (public.portal_human_session() and location_id=public.current_location_id());
drop policy if exists "marlon_visual_monitor_settings_read" on public.marlon_visual_monitor_settings; create policy "marlon_visual_monitor_settings_read" on public.marlon_visual_monitor_settings for select to authenticated using (public.portal_human_session() and location_id=public.current_location_id());
drop policy if exists "staff view marlon web sources" on public.marlon_web_sources; create policy "staff view marlon web sources" on public.marlon_web_sources for select to authenticated using (public.portal_human_session());

drop policy if exists "staff can manage media posts" on public.media_posts;
create policy "staff can manage media posts" on public.media_posts for all to authenticated using (public.portal_human_session() and location_id=public.current_location_id() and public.has_permission('settings.manage')) with check (public.portal_human_session() and location_id=public.current_location_id() and public.has_permission('settings.manage'));
drop policy if exists "staff can view location pc build requests" on public.pc_build_requests; create policy "staff can view location pc build requests" on public.pc_build_requests for select to authenticated using (public.portal_human_session() and location_id=public.current_location_id());
drop policy if exists "training_store_state_staff_select" on public.training_store_state; create policy "training_store_state_staff_select" on public.training_store_state for select to authenticated using (public.portal_human_session() and location_id=public.current_location_id());

drop policy if exists "staff view parts registry" on public.parts_registry; create policy "staff view parts registry" on public.parts_registry for select to authenticated using (public.portal_session_authorized() and (public.portal_human_session() or public.has_permission('inventory.view') or public.has_permission('reference.view')));
drop policy if exists "staff view part listings" on public.part_source_listings; create policy "staff view part listings" on public.part_source_listings for select to authenticated using (public.portal_session_authorized() and (public.portal_human_session() or public.has_permission('inventory.view') or public.has_permission('reference.view')));
drop policy if exists "staff view part price history" on public.part_price_history; create policy "staff view part price history" on public.part_price_history for select to authenticated using (public.portal_session_authorized() and (public.portal_human_session() or public.has_permission('inventory.view') or public.has_permission('reference.view')));
drop policy if exists "staff view part registry events" on public.part_registry_events; create policy "staff view part registry events" on public.part_registry_events for select to authenticated using (public.portal_human_session());
drop policy if exists "staff view part sync status" on public.part_registry_sync_sources; create policy "staff view part sync status" on public.part_registry_sync_sources for select to authenticated using (public.portal_human_session());
drop policy if exists "supplier_shipping_methods_staff_read" on public.supplier_shipping_methods; create policy "supplier_shipping_methods_staff_read" on public.supplier_shipping_methods for select to authenticated using (public.portal_session_authorized());

revoke all on function public.apply_workstation_actor_attribution() from public,anon,authenticated;
