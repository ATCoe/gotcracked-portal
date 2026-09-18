import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const bytes = (hex: string) => new Uint8Array((hex.match(/.{1,2}/g) || []).map(value => Number.parseInt(value, 16)));

async function verified(request: Request, raw: string) {
  const signature = request.headers.get('x-signature-ed25519') || '';
  const timestamp = request.headers.get('x-signature-timestamp') || '';
  const publicKey = Deno.env.get('DISCORD_PUBLIC_KEY') || '';
  if (!/^[a-f0-9]{128}$/i.test(signature) || !/^[0-9]{10,13}$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(publicKey)) return false;
  if (Math.abs(Date.now()/1000-Number(timestamp))>300) return false;
  const key = await crypto.subtle.importKey('raw', bytes(publicKey), { name: 'Ed25519' }, false, ['verify']);
  return crypto.subtle.verify('Ed25519', key, bytes(signature), new TextEncoder().encode(timestamp + raw));
}

const response = (content: string) => json({ type: 4, data: { content, flags: 64 } });
const modalValue = (interaction: any) => interaction.data?.components?.flatMap((row: any) => row.components || []).find((field: any) => field.custom_id === 'note')?.value?.trim();

Deno.serve(async request => {
  if (request.method !== 'POST') return new Response('Not found', { status: 404 });
  const raw = await request.text();
  try {
    if (!(await verified(request, raw))) return new Response('invalid request signature', { status: 401 });
    const interaction = JSON.parse(raw);
    if (interaction.type === 1) return json({ type: 1 });

    const customId = interaction.data?.custom_id || '';
    const [scope, action, targetId, fingerprint] = customId.split(':');
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const discordId = interaction.member?.user?.id || interaction.user?.id;
    const staff = await admin.from('profiles').select('id,location_id,display_name,active,role,account_type').eq('discord_user_id', discordId).maybeSingle();
    if (staff.error || !staff.data?.active || !staff.data.location_id) return response('Your Discord account is not linked to an active Portal staff profile.');

    if (scope === 'workstation') {
      if (interaction.type !== 3 || !targetId || !fingerprint || !['approve','deny'].includes(action) || !/^[a-f0-9]{12}$/i.test(fingerprint)) return response('This workstation approval is no longer available.');
      if (staff.data.account_type !== 'staff' || !['owner','manager'].includes(staff.data.role)) return response('Only an active GotCracked owner or manager can approve a workstation.');
      const pending = await admin.from('workstation_enrollment_requests').select('id,location_id,workstation_profile_id,device_label,approval_fingerprint,expires_at,approved_at,denied_at,consumed_at').eq('id', targetId).maybeSingle();
      if (pending.error || !pending.data || pending.data.location_id !== staff.data.location_id) return response('That workstation request is not available to your location.');
      if (pending.data.consumed_at || pending.data.approved_at || pending.data.denied_at || new Date(pending.data.expires_at).getTime() <= Date.now()) return response('That workstation request has expired or was already decided.');
      if (pending.data.approval_fingerprint.slice(0,12) !== fingerprint) return response('Workstation approval fingerprint mismatch. Request a new enrollment.');
      const patch = action === 'approve' ? { approved_at:new Date().toISOString(), approved_by:staff.data.id } : { denied_at:new Date().toISOString(), denied_by:staff.data.id };
      const saved = await admin.from('workstation_enrollment_requests').update(patch).eq('id', pending.data.id)
        .eq('location_id',staff.data.location_id).eq('approval_fingerprint',pending.data.approval_fingerprint)
        .is('approved_at',null).is('denied_at',null).is('consumed_at',null)
        .gt('expires_at',new Date().toISOString()).select('id').maybeSingle();
      if (saved.error) throw saved.error;
      if (!saved.data) return response('That workstation request expired or was already decided. No new approval was recorded.');
      await admin.from('staff_account_events').insert({ location_id:staff.data.location_id,actor_user_id:staff.data.id,target_user_id:pending.data.workstation_profile_id,
        event_type:action === 'approve' ? 'workstation_enrollment_approved' : 'workstation_enrollment_denied',
        details:{ request_id:pending.data.id,device_label:pending.data.device_label,discord_interaction:true } });
      return response(action === 'approve' ? `${pending.data.device_label} approved. AuroraServer can finish enrollment now.` : `${pending.data.device_label} enrollment denied.`);
    }

    if (scope === 'proposal') {
      if (interaction.type !== 3 || !targetId || !fingerprint || !['approve','deny'].includes(action) || !/^[a-f0-9]{12}$/i.test(fingerprint)) return response('This Marlon approval is no longer available.');
      if (staff.data.account_type !== 'staff' || staff.data.role !== 'owner') return response('Only an active GotCracked Owner can decide Marlon capability and feature requests.');
      const pending = await admin.from('portal_suggestions')
        .select('id,location_id,source,surface,title,description,status,owner_review_required,owner_review_state,proposal_fingerprint,evidence')
        .eq('id',targetId).maybeSingle();
      if (pending.error || !pending.data || pending.data.location_id !== staff.data.location_id || pending.data.source !== 'marlon') return response('That Marlon request is not available to your location.');
      if (pending.data.owner_review_required !== true || pending.data.owner_review_state !== 'pending') return response('That Marlon request was already decided or no longer needs Owner review.');
      const fullFingerprint=String(pending.data.proposal_fingerprint||'');
      if (!fullFingerprint || fullFingerprint.slice(0,12) !== fingerprint) return response('Marlon request fingerprint mismatch. Review the current request before deciding.');
      const recomputed=await admin.rpc('marlon_improvement_fingerprint',{p_surface:pending.data.surface,p_title:pending.data.title,p_description:pending.data.description});
      if (recomputed.error || recomputed.data !== fullFingerprint) return response('Marlon request scope changed. Review the current request before deciding.');
      const capability=pending.data.evidence?.capability_required===true;
      const patch=action==='approve'
        ? {owner_review_state:'approved',owner_review_decided_at:new Date().toISOString(),owner_review_decided_by:staff.data.id,status:capability?'new':'planned'}
        : {owner_review_state:'denied',owner_review_decided_at:new Date().toISOString(),owner_review_decided_by:staff.data.id,status:'declined'};
      const saved=await admin.from('portal_suggestions').update(patch)
        .eq('id',pending.data.id).eq('location_id',staff.data.location_id).eq('source','marlon')
        .eq('owner_review_state','pending').eq('proposal_fingerprint',fullFingerprint).select('id').maybeSingle();
      if (saved.error) throw saved.error;
      if (!saved.data) return response('That Marlon request changed or was already decided. No new decision was recorded.');
      await admin.from('staff_account_events').insert({
        location_id:staff.data.location_id,actor_user_id:staff.data.id,event_type:action==='approve'?'marlon_request_approved_discord':'marlon_request_denied_discord',
        details:{suggestion_id:pending.data.id,title:String(pending.data.title||'').slice(0,180),capability_request:capability,discord_interaction:true,fingerprint}
      });
      if (action==='deny') return response(capability?'Capability request declined. Marlon will not treat that tool or connection as available.':'Marlon proposal declined.');
      return response(capability?'Capability request approved. Install or connect the requested capability, then use “Installed / Connected” in Portal so Marlon can verify availability.':'Marlon proposal approved for the exact fingerprinted scope.');
    }

    const leadId = targetId;
    if (scope !== 'lead' || !leadId) return response('This action is no longer available.');

    if (interaction.type === 3 && action === 'note') return json({
      type: 9,
      data: {
        custom_id: `lead:save-note:${leadId}`,
        title: 'Add lead note',
        components: [{ type: 1, components: [{ type: 4, custom_id: 'note', label: 'Internal activity note', style: 2, min_length: 2, max_length: 900, required: true }] }]
      }
    });

    const lead = await admin.from('leads').select('id,location_id,status').eq('id', leadId).maybeSingle();
    if (lead.error || !lead.data || lead.data.location_id !== staff.data.location_id) return response('That lead is not available to your location.');

    if (interaction.type === 5 && action === 'save-note') {
      const note = modalValue(interaction);
      if (!note) return response('Enter a note before saving.');
      const saved = await admin.from('lead_events').insert({ lead_id: leadId, actor_user_id: staff.data.id, event_type: 'note', message: note });
      if (saved.error) throw saved.error;
      return response(`Note saved to the Portal by ${staff.data.display_name}.`);
    }

    const statuses: Record<string, string> = { claim: 'claimed', qualified: 'qualified', won: 'won', lost: 'lost' };
    const nextStatus = statuses[action];
    if (!nextStatus) return response('Unknown lead action.');
    const patch: Record<string, unknown> = { status: nextStatus };
    if (action === 'claim') patch.assigned_user_id = staff.data.id;
    const updated = await admin.from('leads').update(patch).eq('id', leadId).eq('location_id', staff.data.location_id);
    if (updated.error) throw updated.error;
    await admin.from('lead_events').insert({ lead_id: leadId, actor_user_id: staff.data.id, event_type: 'status_changed', message: `${staff.data.display_name} marked this lead ${nextStatus}.` });
    return response(`Lead marked ${nextStatus} in the Portal.`);
  } catch (error) {
    console.error('discord-interactions: request failed (details redacted)');
    return response('The Portal could not complete that action. Please try again.');
  }
});
