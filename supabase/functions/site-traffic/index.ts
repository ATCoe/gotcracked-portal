import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = () => createClient(SUPABASE_URL, SERVICE_KEY);

const clean = (value: unknown, max = 300) => String(value ?? '').trim().slice(0, max);

function allowedOrigin(origin: string | null) {
  if (!origin) return '';
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' && host !== 'localhost' && host !== '127.0.0.1') return '';
    if (host === 'gotcracked.co' || host === 'www.gotcracked.co') return origin;
    if (host === 'localhost' || host === '127.0.0.1') return origin;
  } catch {}
  return '';
}

function cors(request: Request) {
  const origin = allowedOrigin(request.headers.get('Origin'));
  return {
    'Access-Control-Allow-Origin': origin || 'null',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function json(request: Request, body: unknown, status = 200) {
  return Response.json(body, { status, headers: { ...cors(request), 'Cache-Control':'no-store' } });
}

async function resolveLocation(db: ReturnType<typeof admin>) {
  const { data, error } = await db.from('business_settings').select('location_id,website_url').limit(20);
  if (error) throw error;
  const rows = data || [];
  if (!rows.length) throw new Error('Website location is not configured.');
  const exact = rows.find(row => {
    try {
      const host = new URL(String(row.website_url || '')).hostname.toLowerCase().replace(/^www\./,'');
      return host === 'gotcracked.co';
    } catch { return false; }
  });
  return exact?.location_id || rows[0].location_id;
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status:204, headers:cors(request) });
  if (request.method !== 'POST') return new Response('Not found', { status:404, headers:cors(request) });

  const origin = allowedOrigin(request.headers.get('Origin'));
  if (!origin) return json(request, { error:'Origin not allowed.' }, 403);

  try {
    const raw = await request.text();
    if (raw.length > 12000) return json(request, { error:'Payload too large.' }, 413);
    const body = JSON.parse(raw || '{}');
    const sessionId = clean(body.session_id, 100);
    if (!/^[a-zA-Z0-9._:-]{8,100}$/.test(sessionId)) return json(request, { error:'Invalid session.' }, 400);

    const path = clean(body.path || '/', 300);
    if (!path.startsWith('/')) return json(request, { error:'Invalid path.' }, 400);
    const eventType = body.event_type === 'page_view' ? 'page_view' : 'heartbeat';

    const db = admin();
    const locationId = await resolveLocation(db);
    const { error } = await db.rpc('record_customer_site_traffic', {
      p_location_id: locationId,
      p_session_id: sessionId,
      p_event_type: eventType,
      p_path: path,
      p_referrer_host: clean(body.referrer_host, 180) || null,
      p_utm_source: clean(body.utm_source, 120) || null,
      p_utm_medium: clean(body.utm_medium, 120) || null,
      p_utm_campaign: clean(body.utm_campaign, 160) || null,
      p_device_class: clean(body.device_class, 20),
      p_os_family: clean(body.os_family, 20),
      p_browser_family: clean(body.browser_family, 20),
      p_viewport_width: Number.isFinite(Number(body.viewport_width)) ? Math.round(Number(body.viewport_width)) : 0,
      p_viewport_height: Number.isFinite(Number(body.viewport_height)) ? Math.round(Number(body.viewport_height)) : 0
    });
    if (error) throw error;

    // Opportunistic retention cleanup. It is intentionally infrequent and stores no IP/PII.
    if (Math.random() < 0.01) {
      const cutoff = new Date(Date.now() - 35 * 86400000).toISOString();
      await Promise.allSettled([
        db.from('customer_site_events').delete().lt('occurred_at', cutoff),
        db.from('customer_site_sessions').delete().lt('last_seen_at', cutoff)
      ]);
    }

    return json(request, { ok:true }, 200);
  } catch (error) {
    console.error('Site traffic ingest failed:', error);
    return json(request, { error:'Telemetry unavailable.' }, 503);
  }
});
