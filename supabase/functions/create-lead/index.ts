import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const allowedOrigins = new Set(['https://portal.gotcracked.co']);
const headers = (origin: string | null) => ({ 'Access-Control-Allow-Origin': allowedOrigins.has(origin || '') ? origin! : 'https://portal.gotcracked.co', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Content-Type': 'application/json', 'Vary': 'Origin' });
const json = (origin: string | null, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: headers(origin) });
const clean = (value: unknown, max = 500) => String(value || '').trim().slice(0, max);

async function sendDiscordAlert(lead: Record<string, any>) {
  const token = Deno.env.get('DISCORD_BOT_TOKEN');
  const channelId = Deno.env.get('DISCORD_LEAD_CHANNEL_ID');
  if (!token || !channelId) return false;
  const portalUrl = (Deno.env.get('PORTAL_URL') || 'https://portal.gotcracked.co').replace(/\/$/, '');
  const contact = [lead.phone, lead.email].filter(Boolean).join(' · ') || 'No contact details';
  const message = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      allowed_mentions: { parse: [] },
      embeds: [{
        title: `New lead · ${lead.name}`,
        description: lead.notes || lead.service,
        color: 0x0a8fff,
        fields: [
          { name: 'Service', value: lead.service || 'Not provided', inline: false },
          { name: 'Contact', value: contact, inline: false },
          { name: 'Source', value: lead.source || 'Portal', inline: true }
        ],
        footer: { text: 'GotCracked unified lead queue' },
        timestamp: new Date().toISOString()
      }],
      components: [
        { type: 1, components: [{ type: 2, style: 1, label: 'Claim', custom_id: `lead:claim:${lead.id}` }, { type: 2, style: 2, label: 'Add note', custom_id: `lead:note:${lead.id}` }, { type: 2, style: 3, label: 'Qualified', custom_id: `lead:qualified:${lead.id}` }, { type: 2, style: 3, label: 'Won', custom_id: `lead:won:${lead.id}` }, { type: 2, style: 4, label: 'Lost', custom_id: `lead:lost:${lead.id}` }] },
        { type: 1, components: [{ type: 2, style: 5, label: 'Open Lead', url: `${portalUrl}/#leads/${lead.id}` }] }
      ]
    })
  });
  if (!message.ok) throw new Error(`Discord message failed: ${message.status} ${await message.text()}`);
  const posted = await message.json();
  const thread = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${posted.id}/threads`, {
    method: 'POST',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `${lead.name} · ${lead.service}`.slice(0, 95), auto_archive_duration: 1440 })
  });
  if (!thread.ok) console.error(`Discord thread failed: ${thread.status} ${await thread.text()}`);
  return true;
}

Deno.serve(async request => {
  const origin = request.headers.get('Origin');
  if (request.method === 'OPTIONS') return new Response('ok', { headers: headers(origin) });
  if (request.method !== 'POST') return json(origin, { error: 'Method not allowed.' }, 405);
  if (!allowedOrigins.has(origin || '')) return json(origin, { error: 'Origin not allowed.' }, 403);
  try {
    const authorization = request.headers.get('Authorization') || '';
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } });
    const userResult = await userClient.auth.getUser();
    if (userResult.error || !userResult.data.user) return json(origin, { error: 'Sign in required.' }, 401);
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const profile = await admin.from('profiles').select('id,location_id,active').eq('id', userResult.data.user.id).single();
    if (profile.error || !profile.data.active || !profile.data.location_id) return json(origin, { error: 'Active staff access is required.' }, 403);
    const body = await request.json();
    const name = clean(body.name, 160), service = clean(body.service, 180);
    if (!name || !service) return json(origin, { error: 'Customer name and requested service are required.' }, 400);
    const externalId = `portal-${crypto.randomUUID()}`;
    const inserted = await admin.from('leads').insert({ external_id: externalId, location_id: profile.data.location_id, name, phone: clean(body.phone,40) || null, email: clean(body.email,160).toLowerCase() || null, service, source: clean(body.source,80) || 'portal', notes: clean(body.notes,1200) || null, status: 'new' }).select().single();
    if (inserted.error) throw inserted.error;
    const botUrl = Deno.env.get('BOT_LEAD_WEBHOOK_URL'), botSecret = Deno.env.get('LEAD_WEBHOOK_SECRET');
    const directUrl = `https://portal.gotcracked.co/#leads/${inserted.data.id}`;
    let discordDelivered = false;
    try { discordDelivered = await sendDiscordAlert(inserted.data); }
    catch (error) { console.error(error); }
    if (botUrl && botSecret) {
      const delivered = await fetch(botUrl, { method: 'POST', headers: { Authorization: `Bearer ${botSecret}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: externalId, leadId:inserted.data.id, portalUrl:directUrl, locationId: profile.data.location_id, name, phone: inserted.data.phone, email: inserted.data.email, service, source: inserted.data.source, notes: inserted.data.notes }) });
      discordDelivered = delivered.ok || discordDelivered;
    }
    return json(origin, { lead: inserted.data, portalUrl:directUrl, discordDelivered }, 201);
  } catch (error) { console.error(error); return json(origin, { error: 'Unable to create the lead.' }, 500); }
});