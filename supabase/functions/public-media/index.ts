import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const allowedOrigins = new Set(['https://gotcracked.co', 'https://www.gotcracked.co']);
const cors = (origin: string | null) => ({
  'Access-Control-Allow-Origin': allowedOrigins.has(origin || '') ? origin! : 'https://gotcracked.co',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300', 'Vary': 'Origin'
});

Deno.serve(async request => {
  const origin = request.headers.get('Origin');
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });
  if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'Method not allowed.' }), { status: 405, headers: cors(origin) });
  if (!allowedOrigins.has(origin || '')) return new Response(JSON.stringify({ error: 'Origin not allowed.' }), { status: 403, headers: cors(origin) });
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const location = await admin.from('locations').select('id').order('created_at').limit(1).single();
    if (location.error) throw location.error;
    const [settings, posts] = await Promise.all([
      admin.from('business_settings').select('youtube_channel_url,tiktok_profile_url').eq('location_id', location.data.id).maybeSingle(),
      admin.from('media_posts').select('platform,external_id,title,thumbnail_url,public_url,published_at').eq('location_id', location.data.id).eq('active', true).order('published_at', { ascending: false }).limit(12)
    ]);
    if (settings.error || posts.error) throw settings.error || posts.error;
    return new Response(JSON.stringify({ settings: settings.data || {}, posts: posts.data || [] }), { headers: cors(origin) });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: 'Media feed is temporarily unavailable.' }), { status: 500, headers: cors(origin) });
  }
});
