import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const allowedOrigins = new Set(['https://gotcracked.co', 'https://www.gotcracked.co']);
const cors = (origin: string | null) => ({
  'Access-Control-Allow-Origin': allowedOrigins.has(origin || '') ? origin! : 'https://gotcracked.co',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json', 'Vary': 'Origin'
});
const json = (origin: string | null, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors(origin) });
const clean = (value: unknown, max = 1600) => String(value || '').trim().slice(0, max);
const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, '0')).join('');
const hashToken = async (token: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
const clientKey = (request: Request) => request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || `ua:${request.headers.get('user-agent') || 'unknown'}`;

class ServiceUnavailableError extends Error {}

async function allow(admin: ReturnType<typeof createClient>, request: Request, kind: string, limit: number, seconds: number) {
  const result = await admin.rpc('consume_public_rate_limit', { p_kind:kind, p_key_hash:await hashToken(clientKey(request)), p_limit:limit, p_window_seconds:seconds });
  if (result.error) {
    console.error('Public chat rate limiter unavailable:', result.error.message);
    throw new ServiceUnavailableError('Request protection is temporarily unavailable.');
  }
  return result.data === true;
}

async function discord(path: string, init: RequestInit = {}) {
  const token = Deno.env.get('DISCORD_BOT_TOKEN');
  if (!token) throw new Error('Website chat is not configured.');
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    ...init,
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) }
  });
  if (!response.ok) throw new Error(`Discord request failed (${response.status}).`);
  return response.status === 204 ? null : response.json();
}

Deno.serve(async request => {
  const origin = request.headers.get('Origin');
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });
  if (request.method !== 'POST') return json(origin, { error: 'Method not allowed.' }, 405);
  if (!allowedOrigins.has(origin || '')) return json(origin, { error: 'Origin not allowed.' }, 403);
  try {
    const body = await request.json();
    const action = clean(body.action, 20);
    if (clean(body.companyWebsite, 100)) return json(origin, { error: 'Unable to send the message.' }, 400);
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    if (action === 'start') {
      if (!(await allow(admin,request,'public-chat-start',10,3600))) return json(origin,{error:'Too many new chat requests. Please wait and try again.'},429);
      const startedAt = Number(body.formStartedAt || 0);
      if (!startedAt || Date.now() - startedAt < 1500 || Date.now() - startedAt > 86400000) return json(origin, { error: 'Please reopen chat and try again.' }, 400);
      const name = clean(body.name, 100), email = clean(body.email, 160).toLowerCase(), message = clean(body.message);
      if (!name || !message) return json(origin, { error: 'Enter your name and question.' }, 400);
      if (email && !/^\S+@\S+\.\S+$/.test(email)) return json(origin, { error: 'Enter a valid email address or leave it blank.' }, 400);
      const token = crypto.randomUUID() + crypto.randomUUID();
      const locationId = Deno.env.get('DEFAULT_LOCATION_ID')!;
      const created = await admin.from('website_chat_sessions').insert({ location_id: locationId, public_token_hash: await hashToken(token), customer_name: name, customer_email: email || null }).select().single();
      if (created.error) throw created.error;
      const channelId = Deno.env.get('DISCORD_LEAD_CHANNEL_ID');
      if (!channelId) throw new Error('Discord chat channel is not configured.');
      const parent = await discord(`/channels/${channelId}/messages`, { method: 'POST', body: JSON.stringify({ allowed_mentions:{parse:[]}, embeds:[{ title:`Website chat · ${name}`, description:message, color:0x0a8fff, fields:[{name:'Reply',value:'Reply normally inside the thread. Your message will appear in the customer’s website chat.'},{name:'Email',value:email || 'Not provided'}], footer:{text:`Chat ${created.data.id.slice(0,8).toUpperCase()}`}, timestamp:new Date().toISOString() }] }) });
      const thread = await discord(`/channels/${channelId}/messages/${parent.id}/threads`, { method:'POST', body:JSON.stringify({ name:`Website · ${name}`.slice(0,95), auto_archive_duration:1440 }) });
      const posted = await discord(`/channels/${thread.id}/messages`, { method:'POST', body:JSON.stringify({ allowed_mentions:{parse:[]}, content:`**Customer · ${name}**\n${message}` }) });
      await admin.from('website_chat_sessions').update({ discord_message_id:parent.id, discord_thread_id:thread.id, updated_at:new Date().toISOString() }).eq('id',created.data.id);
      await admin.from('website_chat_messages').insert({ session_id:created.data.id, sender:'customer', body:message, discord_message_id:posted.id });
      return json(origin, { ok:true, sessionId:created.data.id, token, messages:[{sender:'customer',body:message,created_at:new Date().toISOString()}] }, 201);
    }

    const sessionId = clean(body.sessionId, 80), token = clean(body.token, 200);
    if (!sessionId || !token) return json(origin, { error:'Chat session not found.' }, 404);
    const session = await admin.from('website_chat_sessions').select('*').eq('id',sessionId).eq('public_token_hash',await hashToken(token)).maybeSingle();
    if (session.error || !session.data) return json(origin, { error:'Chat session not found.' }, 404);

    if (action === 'send') {
      if (!(await allow(admin,request,'public-chat-send',60,900))) return json(origin,{error:'Too many chat messages. Please wait and try again.'},429);
      const message = clean(body.message);
      if (!message) return json(origin, { error:'Enter a message.' }, 400);
      const recent = await admin.from('website_chat_messages').select('created_at').eq('session_id',sessionId).eq('sender','customer').order('created_at',{ascending:false}).limit(1).maybeSingle();
      if (recent.data && Date.now() - new Date(recent.data.created_at).getTime() < 1500) return json(origin,{error:'Please wait a moment before sending again.'},429);
      const posted = await discord(`/channels/${session.data.discord_thread_id}/messages`, { method:'POST', body:JSON.stringify({ allowed_mentions:{parse:[]}, content:`**Customer · ${session.data.customer_name}**\n${message}` }) });
      const saved = await admin.from('website_chat_messages').insert({ session_id:sessionId, sender:'customer', body:message, discord_message_id:posted.id });
      if (saved.error) throw saved.error;
    } else if (action === 'poll') {
      if (!(await allow(admin,request,'public-chat-poll',300,900))) return json(origin,{error:'Chat refresh limit reached. Please wait a moment and try again.'},429);
    } else {
      return json(origin,{error:'Unsupported chat action.'},400);
    }

    if (session.data.discord_thread_id) {
      const discordMessages = await discord(`/channels/${session.data.discord_thread_id}/messages?limit=50`);
      const staff = (discordMessages || []).filter((item:any) => !item.author?.bot && clean(item.content)).reverse();
      for (const item of staff) await admin.from('website_chat_messages').upsert({ session_id:sessionId, sender:'staff', body:clean(item.content), discord_message_id:item.id, created_at:item.timestamp }, { onConflict:'discord_message_id', ignoreDuplicates:true });
      await admin.from('website_chat_sessions').update({ last_discord_sync_at:new Date().toISOString(), updated_at:new Date().toISOString() }).eq('id',sessionId);
    }
    const messages = await admin.from('website_chat_messages').select('sender,body,created_at').eq('session_id',sessionId).order('created_at').limit(100);
    if (messages.error) throw messages.error;
    return json(origin, { ok:true, messages:messages.data || [] });
  } catch (error) {
    console.error(error);
    if (error instanceof ServiceUnavailableError) return json(origin, { error:'Chat is temporarily unavailable. Email hello@gotcracked.co for help.' }, 503);
    return json(origin, { error:'Chat is temporarily unavailable. Email hello@gotcracked.co for help.' }, 500);
  }
});
