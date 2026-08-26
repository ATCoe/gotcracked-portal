import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const bytes = (hex: string) => new Uint8Array((hex.match(/.{1,2}/g) || []).map(value => Number.parseInt(value, 16)));

async function verified(request: Request, raw: string) {
  const signature = request.headers.get('x-signature-ed25519') || '';
  const timestamp = request.headers.get('x-signature-timestamp') || '';
  const publicKey = Deno.env.get('DISCORD_PUBLIC_KEY') || '';
  if (!signature || !timestamp || !publicKey) return false;
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
    const [scope, action, leadId] = customId.split(':');
    if (scope !== 'lead' || !leadId) return response('This action is no longer available.');

    if (interaction.type === 3 && action === 'note') return json({
      type: 9,
      data: {
        custom_id: `lead:save-note:${leadId}`,
        title: 'Add lead note',
        components: [{ type: 1, components: [{ type: 4, custom_id: 'note', label: 'Internal activity note', style: 2, min_length: 2, max_length: 900, required: true }] }]
      }
    });

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const discordId = interaction.member?.user?.id || interaction.user?.id;
    const staff = await admin.from('profiles').select('id,location_id,display_name,active').eq('discord_user_id', discordId).maybeSingle();
    if (staff.error || !staff.data?.active || !staff.data.location_id) return response('Your Discord account is not linked to an active Portal staff profile.');
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
    console.error(error);
    return response('The Portal could not complete that action. Please try again.');
  }
});
