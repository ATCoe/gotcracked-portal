import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const allowedOrigins = new Set(['https://gotcracked.co', 'https://www.gotcracked.co']);
const headers = (origin: string | null) => ({
  'Access-Control-Allow-Origin': allowedOrigins.has(origin || '') ? origin! : 'https://gotcracked.co',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json', 'Vary': 'Origin'
});
const clean = (value: unknown, max = 500) => String(value || '').trim().slice(0, max);
const json = (origin: string | null, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: headers(origin) });

async function sendDiscordAlert(lead: Record<string, any>) {
  const token = Deno.env.get('DISCORD_BOT_TOKEN');
  const channelId = Deno.env.get('DISCORD_LEAD_CHANNEL_ID');
  if (!token || !channelId) return false;
  const portalUrl = (Deno.env.get('PORTAL_URL') || 'https://portal.gotcracked.co').replace(/\/$/, '');
  const contact = [lead.phone, lead.email].filter(Boolean).join(' · ') || 'No contact details';
  const preferredContact = lead.preferred_contact || 'No preference';
  const timing = lead.timing_note || 'No timing constraint provided';
  const message = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      allowed_mentions: { parse: [] },
      embeds: [{
        title: `New lead · ${lead.name}`,
        description: lead.customer_issue || lead.service,
        color: 0x0a8fff,
        fields: [
          { name: 'Service', value: lead.service || 'Not provided', inline: false },
          { name: 'Contact', value: contact, inline: false },
          { name: 'Preferred contact', value: preferredContact, inline: true },
          { name: 'Timing', value: timing, inline: true },
          { name: 'Source', value: lead.source || 'gotcracked.co', inline: true },
          { name: 'Intake', value: lead.intake_method === 'mail_in' ? 'Mail-in repair' : 'Walk-in repair', inline: true },
          { name: 'Preferred time', value: [lead.preferred_date, lead.preferred_time].filter(Boolean).join(' · ') || (lead.intake_method === 'mail_in' ? 'Ships to GotCracked' : 'Not specified'), inline: true }
        ],
        footer: { text: `GotCracked lead ${lead.public_reference || ''}` },
        timestamp: new Date().toISOString()
      }],
      components: [
        { type: 1, components: [{ type: 2, style: 1, label: 'Claim', custom_id: `lead:claim:${lead.id}` }, { type: 2, style: 2, label: 'Add note', custom_id: `lead:note:${lead.id}` }, { type: 2, style: 3, label: 'Qualified', custom_id: `lead:qualified:${lead.id}` }, { type: 2, style: 3, label: 'Won', custom_id: `lead:won:${lead.id}` }, { type: 2, style: 4, label: 'Lost', custom_id: `lead:lost:${lead.id}` }] },
        { type: 1, components: [{ type: 2, style: 5, label: 'Open in Portal', url: `${portalUrl}/#leads/${lead.id}` }] }
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
    const body = await request.json();
    if (clean(body.companyWebsite, 100)) return json(origin, { error: 'Unable to submit the request.' }, 400);
    const startedAt = Number(body.formStartedAt || 0);
    if (!startedAt || Date.now() - startedAt < 2500 || Date.now() - startedAt > 86400000) return json(origin, { error: 'Please reload the page and try again.' }, 400);
    const firstName = clean(body.firstName, 80), lastName = clean(body.lastName, 80);
    const phone = clean(body.phone, 40), email = clean(body.email, 160).toLowerCase();
    const model = clean(body.model, 160), issue = clean(body.issue, 1200), deviceType = clean(body.deviceType, 80);
    const preferredContact = ['Call','Text','Email'].includes(clean(body.preferredContact, 20)) ? clean(body.preferredContact, 20) : 'No preference';
    const timingNote = clean(body.timing, 240);
    const intakeMethod = body.serviceMode === 'mail_in' ? 'mail_in' : 'walk_in';
    const shippingAddress = intakeMethod === 'mail_in' ? { line1: clean(body.address1, 160), line2: clean(body.address2, 160) || null, city: clean(body.city, 100), state: clean(body.state, 40).toUpperCase(), postal_code: clean(body.postalCode, 20) } : null;
    if (!firstName || !lastName || !phone || !email || !model || !issue || body.consent !== 'on') return json(origin, { error: 'Complete all required fields and consent to contact.' }, 400);
    if (intakeMethod === 'mail_in' && (!shippingAddress?.line1 || !shippingAddress.city || !shippingAddress.state || !shippingAddress.postal_code)) return json(origin, { error: 'Complete the return shipping address.' }, 400);
    if (!/^\S+@\S+\.\S+$/.test(email)) return json(origin, { error: 'Enter a valid email address.' }, 400);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const locationId = Deno.env.get('DEFAULT_LOCATION_ID')!;
    if (!locationId) throw new Error('DEFAULT_LOCATION_ID is not configured.');
    const reference = `GCR-${crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`;
    const externalId = `web-${crypto.randomUUID()}`;
    const notes = [issue, `Preferred contact: ${preferredContact}`, timingNote ? `Timing/deadline: ${timingNote}` : null].filter(Boolean).join('\n\n');
    const leadRecord = {
      external_id: externalId, public_reference: reference, location_id: locationId,
      name: `${firstName} ${lastName}`, phone, email, service: issue.slice(0, 180), source: 'gotcracked.co', notes,
      customer_issue: issue, preferred_contact: preferredContact, timing_note: timingNote || null,
      device_type: deviceType, device_model: model, intake_method: intakeMethod, shipping_address: shippingAddress, preferred_date: intakeMethod === 'walk_in' ? clean(body.date, 10) || null : null,
      preferred_time: intakeMethod === 'walk_in' ? clean(body.time, 80) || null : null, consent_at: new Date().toISOString(), status: 'new'
    };
    const insertRecord = { ...leadRecord };
    delete insertRecord.customer_issue;
    delete insertRecord.preferred_contact;
    delete insertRecord.timing_note;
    const leadResult = await admin.from('leads').insert(insertRecord).select().single();
    if (leadResult.error) throw leadResult.error;
    const alertRecord = { ...leadResult.data, customer_issue: issue, preferred_contact: preferredContact, timing_note: timingNote || null };
    if (intakeMethod === 'walk_in') {
      const appointmentResult = await admin.from('appointments').insert({
        location_id: locationId, lead_id: leadResult.data.id, device_description: `${deviceType} · ${model}`,
        service_requested: issue, preferred_date: leadRecord.preferred_date, preferred_time: leadRecord.preferred_time,
        service_mode: 'walk_in', status: 'requested', notes: ['Submitted through gotcracked.co', `Preferred contact: ${preferredContact}`, timingNote ? `Timing/deadline: ${timingNote}` : null].filter(Boolean).join(' · ')
      });
      if (appointmentResult.error) throw appointmentResult.error;
    }

    let discordDelivered = false;
    try { discordDelivered = await sendDiscordAlert(alertRecord); }
    catch (error) { console.error(error); }

    const botUrl = Deno.env.get('BOT_LEAD_WEBHOOK_URL');
    const botSecret = Deno.env.get('LEAD_WEBHOOK_SECRET');
    if (botUrl && botSecret) fetch(botUrl, {
      method: 'POST', headers: { Authorization: `Bearer ${botSecret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: externalId, locationId, name: leadRecord.name, phone, email, service: leadRecord.service, source: leadRecord.source, notes: `${intakeMethod === 'mail_in' ? '[MAIL-IN] ' : ''}${deviceType} ${model}: ${notes}` })
    }).catch(console.error);
    return json(origin, { ok: true, reference, discordDelivered }, 201);
  } catch (error) { console.error(error); return json(origin, { error: 'Unable to submit the repair request. Please contact the shop.' }, 500); }
});
