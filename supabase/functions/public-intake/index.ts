import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const allowedOrigins = new Set(['https://gotcracked.co', 'https://www.gotcracked.co']);
const headers = (origin: string | null) => ({
  'Access-Control-Allow-Origin': allowedOrigins.has(origin || '') ? origin! : 'https://gotcracked.co',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json', 'Vary': 'Origin'
});
const clean = (value: unknown, max = 500) => String(value || '').trim().slice(0, max);
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] || c));
const json = (origin: string | null, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: headers(origin) });
const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2,'0')).join('');
const hash = async (value: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
const clientKey = (request: Request) => request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || `ua:${request.headers.get('user-agent') || 'unknown'}`;

async function consumeRateLimit(admin: ReturnType<typeof createClient>, request: Request) {
  const keyHash = await hash(clientKey(request));
  const result = await admin.rpc('consume_public_rate_limit', { p_kind:'public-intake', p_key_hash:keyHash, p_limit:20, p_window_seconds:900 });
  if (result.error) { console.error('Public intake rate limiter unavailable:', result.error.message); return true; }
  return result.data === true;
}

async function sendConfirmationEmail(data: Record<string, any>) {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey || !data.email) return false;
  const from = Deno.env.get('CUSTOMER_FROM_EMAIL') || Deno.env.get('RECEIPT_FROM_EMAIL') || 'GotCracked <hello@gotcracked.co>';
  const mailIn = data.intake_method === 'mail_in';
  const subject = mailIn ? `GotCracked mail-in request ${data.public_reference}` : `GotCracked repair request ${data.public_reference}`;
  const schedule = [data.preferred_date, data.preferred_time].filter(Boolean).join(' · ');
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111827;background:#f6f8fb;padding:24px"><div style="max-width:680px;margin:auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:28px"><h1 style="margin:0;color:#0a2342">GotCracked</h1><p style="color:#4b5563">Repair request ${esc(data.public_reference)}</p><p>Hi ${esc(data.first_name)},</p><p>We received your ${mailIn ? 'mail-in repair request' : 'repair request'}. This confirms receipt of the request; it is not a final repair estimate or appointment confirmation.</p><div style="background:#f3f6fa;border-radius:10px;padding:16px;margin:20px 0"><strong>${esc(data.device_type)} · ${esc(data.device_model)}</strong><p style="margin:8px 0 0">${esc(data.issue)}</p>${schedule ? `<p style="margin:8px 0 0"><strong>Requested time:</strong> ${esc(schedule)}</p>` : ''}${data.timing_note ? `<p style="margin:8px 0 0"><strong>Timing note:</strong> ${esc(data.timing_note)}</p>` : ''}<p style="margin:8px 0 0"><strong>Preferred contact:</strong> ${esc(data.preferred_contact)}</p></div>${mailIn ? '<p><strong>Do not ship your device yet.</strong> We will review the request and contact you before you send it.</p>' : '<p>We will review the request and contact you to confirm timing, availability, and next steps.</p>'}<p style="color:#4b5563">Keep request number <strong>${esc(data.public_reference)}</strong> with your records.</p><p style="color:#4b5563">GotCracked · 700 North Main St, Ste D · Blacksburg, VA 24060</p></div></body></html>`;
  const response = await fetch('https://api.resend.com/emails', {
    method:'POST',
    headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
    body:JSON.stringify({from,to:[data.email],subject,html})
  });
  if (!response.ok) { console.error(`Request confirmation email failed (${response.status}): ${await response.text()}`); return false; }
  return true;
}

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
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    if (!(await consumeRateLimit(admin, request))) return json(origin, { error:'Too many requests. Please wait a few minutes and try again.' }, 429);

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

    const locationId = Deno.env.get('DEFAULT_LOCATION_ID')!;
    if (!locationId) throw new Error('DEFAULT_LOCATION_ID is not configured.');
    const reference = `GCR-${crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`;
    const externalId = `web-${crypto.randomUUID()}`;
    const notes = [issue, `Preferred contact: ${preferredContact}`, timingNote ? `Timing/deadline: ${timingNote}` : null].filter(Boolean).join('\n\n');
    const leadRecord = {
      external_id: externalId, public_reference: reference, location_id: locationId,
      name: `${firstName} ${lastName}`, phone, email, service: issue.slice(0, 180), source: 'gotcracked.co', notes,
      device_type: deviceType, device_model: model, intake_method: intakeMethod, shipping_address: shippingAddress,
      preferred_date: intakeMethod === 'walk_in' ? clean(body.date, 10) || null : null,
      preferred_time: intakeMethod === 'walk_in' ? clean(body.time, 80) || null : null,
      consent_at: new Date().toISOString(), status: 'new'
    };
    const leadResult = await admin.from('leads').insert(leadRecord).select().single();
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
    try { discordDelivered = await sendDiscordAlert(alertRecord); } catch (error) { console.error(error); }
    let emailDelivered = false;
    try { emailDelivered = await sendConfirmationEmail({ public_reference:reference, first_name:firstName, email, intake_method:intakeMethod, device_type:deviceType, device_model:model, issue, preferred_date:leadRecord.preferred_date, preferred_time:leadRecord.preferred_time, preferred_contact:preferredContact, timing_note:timingNote }); } catch (error) { console.error(error); }

    const botUrl = Deno.env.get('BOT_LEAD_WEBHOOK_URL');
    const botSecret = Deno.env.get('LEAD_WEBHOOK_SECRET');
    if (botUrl && botSecret) fetch(botUrl, {
      method: 'POST', headers: { Authorization: `Bearer ${botSecret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: externalId, locationId, name: leadRecord.name, phone, email, service: leadRecord.service, source: leadRecord.source, notes: `${intakeMethod === 'mail_in' ? '[MAIL-IN] ' : ''}${deviceType} ${model}: ${notes}` })
    }).catch(console.error);
    return json(origin, { ok: true, reference, discordDelivered, emailDelivered }, 201);
  } catch (error) { console.error(error); return json(origin, { error: 'Unable to submit the repair request. Please contact the shop.' }, 500); }
});
