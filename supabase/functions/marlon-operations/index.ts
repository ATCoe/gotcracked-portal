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
  const channels: any[] = await discord('GET', `/guilds/${guild.id}/channels`);
  let category = channels.find(c => c.type === 4 && /^tech[ -]?support$/i.test(String(c.name || '')));
  if (!category) category = await discord('POST', `/guilds/${guild.id}/channels`, { name: 'TECH SUPPORT', type: 4 });
  let channel = channels.find(c => c.type === 0 && /^tech-support$/i.test(String(c.name || '')));
  const topic = 'GotCracked Tech Support with Marlon — hardware, software, accounts, connectivity, internal tools, website issues, and Portal issues when relevant. This Discord support space is independent from Portal chat.';
  if (channel) channel = await discord('PATCH', `/channels/${channel.id}`, { parent_id: category.id, topic });
  else channel = await discord('POST', `/guilds/${guild.id}/channels`, { name: 'tech-support', type: 0, parent_id: category.id, topic });
  return { guild: { id: guild.id, name: guild.name }, category: { id: category.id, name: category.name }, channel: { id: channel.id, name: channel.name, parent_id: channel.parent_id }, standalone: true };
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
