import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DISCORD_TOKEN = Deno.env.get('DISCORD_BOT_TOKEN')!;
const SIGNING_KEY = 'marlon_operations_signing';
const enc = new TextEncoder();

const admin = () => createClient(SUPABASE_URL, SERVICE_KEY);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const clean = (v: unknown, max = 600) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  return [...sig].map(v => v.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function authorize(request: Request, action: string) {
  const ts = Number(request.headers.get('x-gc-ts') || 0);
  const supplied = request.headers.get('x-gc-signature') || '';
  const headerAction = request.headers.get('x-gc-action') || '';
  if (!ts || !supplied || headerAction !== action || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) return false;
  const db = admin();
  const { data, error } = await db.from('internal_runtime_secrets').select('secret').eq('key', SIGNING_KEY).maybeSingle();
  if (error || !data?.secret) return false;
  return safeEqual(await hmacHex(data.secret, `${ts}:${action}`), supplied);
}

async function discord(method: string, path: string, body?: unknown) {
  if (!DISCORD_TOKEN) throw new Error('Discord bot token is not configured.');
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    method,
    headers: { Authorization: `Bot ${DISCORD_TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`Discord ${response.status}: ${clean(data?.message || text, 500)}`);
  return data;
}

async function resolveGuild() {
  const guilds: any[] = await discord('GET', '/users/@me/guilds');
  const configured = Deno.env.get('DISCORD_GUILD_ID');
  let guild = configured ? guilds.find(g => g.id === configured) : null;
  if (!guild) guild = guilds.find(g => /got\s*cracked/i.test(String(g.name || '')));
  if (!guild && guilds.length === 1) guild = guilds[0];
  if (!guild) throw new Error('Could not uniquely identify the GotCracked Discord server.');
  return guild;
}

async function syncTechSupport() {
  const guild = await resolveGuild();
  const db = admin();
  let channels: any[] = await discord('GET', `/guilds/${guild.id}/channels`);

  let category = channels.find(c => c.type === 4 && /^tech[ -]?support$/i.test(String(c.name || '')));
  if (!category) {
    category = await discord('POST', `/guilds/${guild.id}/channels`, { name: 'TECH SUPPORT', type: 4 });
    channels = [...channels, category];
  }

  const supportTopic = 'GotCracked Tech Support with Marlon — hardware, software, accounts, connectivity, internal tools, website issues, and Portal issues when relevant.';
  let support = channels.find(c => c.type === 0 && /^tech-support$/i.test(String(c.name || '')));
  if (support) support = await discord('PATCH', `/channels/${support.id}`, { parent_id: category.id, topic: supportTopic });
  else support = await discord('POST', `/guilds/${guild.id}/channels`, { name: 'tech-support', type: 0, parent_id: category.id, topic: supportTopic });

  const updatesTopic = 'Verified GotCracked Portal releases, updates, fixes, and patch notes posted by Marlon. Silent channel — no staff pings.';
  let updates = channels.find(c => c.type === 0 && /^(updates-and-patch-notes|updates-patch-notes|patch-notes)$/i.test(String(c.name || '')));
  if (updates) updates = await discord('PATCH', `/channels/${updates.id}`, { parent_id: category.id, topic: updatesTopic });
  else updates = await discord('POST', `/guilds/${guild.id}/channels`, { name: 'updates-and-patch-notes', type: 0, parent_id: category.id, topic: updatesTopic });

  const { data: settings, error: settingsError } = await db.from('business_settings').select('location_id').order('updated_at',{ascending:false}).limit(1).maybeSingle();
  if (settingsError || !settings?.location_id) throw settingsError || new Error('Location settings unavailable.');
  const { data: existing } = await db.from('marlon_discord_config').select('bug_log_channel_id,lead_dm_profile_id,tech_support_voice_channel_id').eq('location_id',settings.location_id).maybeSingle();
  const { error: saveError } = await db.from('marlon_discord_config').upsert({
    location_id: settings.location_id,
    guild_id: guild.id,
    category_id: category.id,
    tech_support_channel_id: support.id,
    future_updates_channel_id: updates.id,
    bug_log_channel_id: existing?.bug_log_channel_id || support.id,
    lead_dm_profile_id: existing?.lead_dm_profile_id || null,
    tech_support_voice_channel_id: existing?.tech_support_voice_channel_id || null,
    updated_at: new Date().toISOString()
  }, { onConflict: 'location_id' });
  if (saveError) throw saveError;

  return {
    guild: { id: guild.id, name: guild.name },
    category: { id: category.id, name: category.name },
    channel: { id: support.id, name: support.name, parent_id: support.parent_id },
    updates: { id: updates.id, name: updates.name, parent_id: updates.parent_id },
    standalone: true
  };
}

function proposalDiscordPayload(suggestion: any, decidedBy = '') {
  const pending = suggestion.owner_review_state === 'pending';
  const approved = suggestion.owner_review_state === 'approved';
  const stateLabel = pending ? 'Awaiting Owner Review' : approved ? `Approved by ${decidedBy || 'Owner'}` : `Declined by ${decidedBy || 'Owner'}`;
  const fields: any[] = [
    { name: 'Surface', value: clean(suggestion.surface || 'portal', 80), inline: true },
    { name: 'Complexity', value: clean(suggestion.implementation_complexity || 'medium', 80), inline: true },
    { name: 'Status', value: stateLabel, inline: false }
  ];
  if (suggestion.business_value) fields.push({ name: 'Business value', value: clean(suggestion.business_value, 900), inline: false });
  if (suggestion.user_impact) fields.push({ name: 'User impact', value: clean(suggestion.user_impact, 900), inline: false });
  return {
    allowed_mentions: { parse: [] },
    embeds: [{
      title: pending ? 'Marlon feature proposal' : approved ? 'Marlon feature proposal approved' : 'Marlon feature proposal declined',
      description: `**${clean(suggestion.title, 180)}**\n${clean(suggestion.description, 3000)}`,
      color: pending ? 0x159bd3 : approved ? 0x2fbf71 : 0xe5484d,
      fields,
      footer: { text: pending ? 'GotCracked · Owner feature review' : `GotCracked · ${stateLabel}` },
      timestamp: new Date(suggestion.owner_review_decided_at || suggestion.owner_review_requested_at || suggestion.created_at || Date.now()).toISOString()
    }],
    components: [{
      type: 1,
      components: [{ type: 2, style: 5, label: pending ? 'Review in Portal' : 'Open Portal', url: 'https://portal.gotcracked.co/#support-tickets' }]
    }]
  };
}

async function openDm(userId: string) {
  return await discord('POST', '/users/@me/channels', { recipient_id: userId });
}
async function notifyFeatureProposal(body: any) {
  const suggestionId = clean(body.suggestion_id, 80);
  if (!suggestionId) throw new Error('suggestion_id is required.');
  const db = admin();
  const { data: suggestion, error } = await db.from('portal_suggestions').select('*').eq('id', suggestionId).maybeSingle();
  if (error || !suggestion) throw error || new Error('Feature proposal not found.');
  if (suggestion.source !== 'marlon' || suggestion.owner_review_state !== 'pending') return { ok: true, skipped: true };

  const { data: owners, error: ownersError } = await db.from('profiles')
    .select('id,display_name,discord_user_id')
    .eq('location_id', suggestion.location_id)
    .eq('role', 'owner')
    .eq('active', true)
    .not('discord_user_id', 'is', null);
  if (ownersError) throw ownersError;

  let sent = 0;
  const failures: any[] = [];
  for (const owner of owners || []) {
    try {
      const existing = await db.from('marlon_feature_proposal_discord_receipts')
        .select('dm_channel_id,message_id')
        .eq('proposal_id', suggestion.id)
        .eq('owner_profile_id', owner.id)
        .maybeSingle();
      if (existing.data?.dm_channel_id && existing.data?.message_id) {
        await discord('PATCH', `/channels/${existing.data.dm_channel_id}/messages/${existing.data.message_id}`, proposalDiscordPayload(suggestion));
        sent += 1;
        continue;
      }
      const channel = await openDm(String(owner.discord_user_id));
      const message = await discord('POST', `/channels/${channel.id}/messages`, proposalDiscordPayload(suggestion));
      const { error: receiptError } = await db.from('marlon_feature_proposal_discord_receipts').upsert({
        proposal_id: suggestion.id,
        owner_profile_id: owner.id,
        discord_user_id: String(owner.discord_user_id),
        dm_channel_id: String(channel.id),
        message_id: String(message.id),
        updated_at: new Date().toISOString()
      }, { onConflict: 'proposal_id,owner_profile_id' });
      if (receiptError) throw receiptError;
      sent += 1;
    } catch (err) {
      failures.push({ owner: owner.id, error: clean(err instanceof Error ? err.message : err, 500) });
    }
  }
  return { ok: failures.length === 0, sent, failures };
}
async function updateFeatureProposalMessages(body: any) {
  const suggestionId = clean(body.suggestion_id, 80);
  if (!suggestionId) throw new Error('suggestion_id is required.');
  const db = admin();
  const { data: suggestion, error } = await db.from('portal_suggestions').select('*').eq('id', suggestionId).maybeSingle();
  if (error || !suggestion) throw error || new Error('Feature proposal not found.');
  if (!['approved','denied'].includes(String(suggestion.owner_review_state || ''))) return { ok: true, skipped: true };

  let decidedBy = 'Owner';
  if (suggestion.owner_review_decided_by) {
    const decider = await db.from('profiles').select('display_name').eq('id', suggestion.owner_review_decided_by).maybeSingle();
    if (decider.data?.display_name) decidedBy = clean(decider.data.display_name, 120);
  }

  const { data: receipts, error: receiptError } = await db.from('marlon_feature_proposal_discord_receipts')
    .select('owner_profile_id,dm_channel_id,message_id')
    .eq('proposal_id', suggestion.id);
  if (receiptError) throw receiptError;

  let updated = 0;
  const failures: any[] = [];
  for (const receipt of receipts || []) {
    try {
      await discord('PATCH', `/channels/${receipt.dm_channel_id}/messages/${receipt.message_id}`, proposalDiscordPayload(suggestion, decidedBy));
      await db.from('marlon_feature_proposal_discord_receipts')
        .update({ updated_at: new Date().toISOString() })
        .eq('proposal_id', suggestion.id)
        .eq('owner_profile_id', receipt.owner_profile_id);
      updated += 1;
    } catch (err) {
      failures.push({ owner: receipt.owner_profile_id, error: clean(err instanceof Error ? err.message : err, 500) });
    }
  }
  return { ok: failures.length === 0, updated, decidedBy, decision: suggestion.owner_review_state, failures };
}

function localClock(timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type: string) => parts.find(p => p.type === type)?.value || '';
  const dayMap: Record<string,string> = { Mon:'mon', Tue:'tue', Wed:'wed', Thu:'thu', Fri:'fri', Sat:'sat', Sun:'sun' };
  const hour = Number(get('hour')), minute = Number(get('minute'));
  return { day: dayMap[get('weekday')] || '', minutes: hour * 60 + minute, local: `${get('year')}-${get('month')}-${get('day')} ${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}` };
}
function hmMinutes(value: string) {
  const [h,m] = String(value || '').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}
async function maintenancePolicy() {
  const db = admin();
  const { data, error } = await db.from('business_settings').select('location_id,store_hours,store_timezone').limit(1).maybeSingle();
  if (error || !data) throw error || new Error('Business settings are unavailable.');
  const tz = data.store_timezone || 'America/New_York';
  const clock = localClock(tz);
  const window = data.store_hours?.[clock.day] || null;
  const open = Array.isArray(window) && window.length === 2 ? hmMinutes(window[0]) : null;
  const close = Array.isArray(window) && window.length === 2 ? hmMinutes(window[1]) : null;
  const isOpen = open !== null && close !== null && clock.minutes >= open && clock.minutes < close;
  return { ...data, timeZone: tz, clock, todayHours: window, isOpen };
}

async function logTechSupport(message: string) {
  const db = admin();
  const { data: settings, error: settingsError } = await db.from('business_settings').select('location_id').limit(1).maybeSingle();
  if (settingsError || !settings?.location_id) throw settingsError || new Error('Location settings unavailable.');
  const { data: config } = await db.from('marlon_discord_config').select('tech_support_channel_id,bug_log_channel_id').eq('location_id', settings.location_id).maybeSingle();
  const channelId = clean(config?.tech_support_channel_id || config?.bug_log_channel_id || Deno.env.get('DISCORD_TECH_SUPPORT_CHANNEL_ID') || Deno.env.get('DISCORD_BUG_LOG_CHANNEL_ID'), 40);
  if (!channelId) return { logged: false, reason: 'Tech Support channel is not configured.' };
  await discord('POST', `/channels/${channelId}/messages`, { content: message, flags: 4096, allowed_mentions: { parse: [] } });
  return { logged: true, channelId };
}

function surfaceName(surface: string) {
  return surface === 'portal' ? 'GotCracked employee Portal' : surface === 'website' ? 'GotCracked website' : 'GotCracked website and employee Portal';
}
async function maintenanceCheck(body: any) {
  const policy = await maintenancePolicy();
  const changeClass = body.change_class === 'quick_patch' ? 'quick_patch' : 'disruptive';
  const requiresDowntime = Boolean(body.requires_downtime);
  const livePatch = changeClass === 'quick_patch' && !requiresDowntime;
  const allowed = livePatch || !policy.isOpen;
  return { allowed, deferred: !allowed, livePatch, storeOpen: policy.isOpen, currentLocalTime: policy.clock.local, timeZone: policy.timeZone, todayHours: policy.todayHours, rule: livePatch ? 'Quick refresh-only patch permitted.' : policy.isOpen ? 'Disruptive maintenance deferred until after business hours.' : 'Disruptive maintenance permitted because the store is closed.' };
}
async function maintenanceStart(body: any) {
  const gate = await maintenanceCheck(body);
  const db = admin();
  const { data: settings } = await db.from('business_settings').select('location_id').limit(1).maybeSingle();
  if (!settings?.location_id) throw new Error('Location settings unavailable.');
  const surface = ['portal','website','both'].includes(body.surface) ? body.surface : 'both';
  const changeClass = body.change_class === 'quick_patch' ? 'quick_patch' : 'disruptive';
  const requiresDowntime = Boolean(body.requires_downtime);
  const reason = clean(body.reason || 'Scheduled maintenance', 1000);
  if (!gate.allowed) {
    const { data } = await db.from('marlon_maintenance_events').insert({ location_id: settings.location_id, surface, change_class: changeClass, status: 'deferred', requires_downtime: requiresDowntime, reason, details: gate }).select('id').single();
    return { ...gate, eventId: data?.id || null };
  }
  const { data: event, error } = await db.from('marlon_maintenance_events').insert({ location_id: settings.location_id, surface, change_class: changeClass, status: 'started', requires_downtime: requiresDowntime, reason, started_at: new Date().toISOString(), details: gate }).select('id').single();
  if (error) throw error;
  let notification = { logged: false };
  if (requiresDowntime) {
    notification = await logTechSupport(`🛠️ **Marlon maintenance notice**\n${surfaceName(surface)} is temporarily down for scheduled maintenance.\n**Reason:** ${reason}`);
  }
  await db.from('marlon_maintenance_events').update({ dm_recipients: 0, details: { ...gate, notification } }).eq('id', event.id);
  return { ...gate, eventId: event.id, notification };
}
async function maintenanceFinish(body: any, failed = false) {
  const db = admin();
  const eventId = clean(body.event_id, 80);
  if (!eventId) throw new Error('event_id is required.');
  const { data: event, error } = await db.from('marlon_maintenance_events').select('*').eq('id', eventId).maybeSingle();
  if (error || !event) throw error || new Error('Maintenance event not found.');
  const surface = event.surface || 'both';
  const note = clean(body.note || (failed ? 'Maintenance needs attention.' : 'Maintenance completed and service verification passed.'), 1000);
  let notification = { logged: false };
  if (event.requires_downtime) notification = await logTechSupport(failed ? `❌ **Marlon maintenance alert**\n${surfaceName(surface)} is not back online yet.\n**Status:** ${note}` : `✅ **Marlon maintenance complete**\n${surfaceName(surface)} is back online and available.\n**Status:** ${note}`);
  await db.from('marlon_maintenance_events').update({ status: failed ? 'failed' : 'completed', completed_at: new Date().toISOString(), dm_recipients: 0, details: { ...(event.details || {}), completion_note: note, notification } }).eq('id', eventId);
  return { ok: !failed, eventId, notification };
}

Deno.serve(async request => {
  if (request.method !== 'POST') return new Response('Not found', { status: 404 });
  try {
    const body = await request.json().catch(() => ({}));
    const action = clean(body.action, 80);
    if (!(await authorize(request, action))) return json({ error: 'Unauthorized.' }, 401);
    if (action === 'inspect-discord') {
      const guild = await resolveGuild();
      const channels: any[] = await discord('GET', `/guilds/${guild.id}/channels`);
      return json({ guild: { id: guild.id, name: guild.name }, channels: channels.map(c => ({ id: c.id, name: c.name, type: c.type, parent_id: c.parent_id })) });
    }
    if (action === 'sync-tech-support') return json(await syncTechSupport());
    if (action === 'feature-proposal-notify') return json(await notifyFeatureProposal(body));
    if (action === 'feature-proposal-update') return json(await updateFeatureProposalMessages(body));
    if (action === 'maintenance-check') return json(await maintenanceCheck(body));
    if (action === 'maintenance-start') return json(await maintenanceStart(body));
    if (action === 'maintenance-complete') return json(await maintenanceFinish(body, false));
    if (action === 'maintenance-failed') return json(await maintenanceFinish(body, true));
    return json({ error: 'Unknown action.' }, 400);
  } catch (error) {
    console.error('Marlon operations failed', error);
    return json({ error: clean(error instanceof Error ? error.message : error, 1000) }, 500);
  }
});
