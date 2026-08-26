import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': 'https://portal.gotcracked.co', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Content-Type': 'application/json' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405);
  try {
    const authorization = request.headers.get('Authorization') || '';
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } });
    const user = await userClient.auth.getUser();
    if (user.error || !user.data.user) return reply({ error: 'Sign in required.' }, 401);
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const profile = await admin.from('profiles').select('location_id,role,active').eq('id', user.data.user.id).single();
    if (profile.error || !profile.data.active || !['owner','manager'].includes(profile.data.role)) return reply({ error: 'Management access is required.' }, 403);
    const body = await request.json();
    const platform = String(body.platform || '').toLowerCase();
    const settings = await admin.from('business_settings').select('*').eq('location_id', profile.data.location_id).single();
    if (settings.error) throw settings.error;
    let rows: Record<string, unknown>[] = [];

    if (platform === 'youtube') {
      const key = Deno.env.get('YOUTUBE_API_KEY'), channelId = settings.data.youtube_channel_id;
      if (!key || !channelId) return reply({ error: 'Add the YouTube channel ID and YOUTUBE_API_KEY first.' }, 400);
      const channelResponse = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${encodeURIComponent(channelId)}&key=${encodeURIComponent(key)}`);
      const channel = await channelResponse.json();
      const uploads = channel.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (!channelResponse.ok || !uploads) throw new Error('Unable to locate the YouTube uploads playlist.');
      const videoResponse = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(uploads)}&maxResults=20&key=${encodeURIComponent(key)}`);
      const videos = await videoResponse.json();
      if (!videoResponse.ok) throw new Error(videos.error?.message || 'YouTube sync failed.');
      rows = (videos.items || []).map((item: Record<string, any>) => ({ location_id: profile.data.location_id, platform: 'youtube', external_id: item.contentDetails.videoId, title: item.snippet.title, thumbnail_url: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.medium?.url, public_url: `https://www.youtube.com/watch?v=${item.contentDetails.videoId}`, published_at: item.contentDetails.videoPublishedAt || item.snippet.publishedAt, active: true }));
    } else if (platform === 'tiktok') {
      const token = Deno.env.get('TIKTOK_ACCESS_TOKEN');
      if (!token) return reply({ error: 'TIKTOK_ACCESS_TOKEN is not configured.' }, 400);
      const response = await fetch('https://open.tiktokapis.com/v2/video/list/?fields=id,title,cover_image_url,share_url,create_time', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ max_count: 20 }) });
      const videos = await response.json();
      if (!response.ok || videos.error?.code) throw new Error(videos.error?.message || 'TikTok sync failed.');
      rows = (videos.data?.videos || []).map((item: Record<string, any>) => ({ location_id: profile.data.location_id, platform: 'tiktok', external_id: item.id, title: item.title || 'GotCracked on TikTok', thumbnail_url: item.cover_image_url, public_url: item.share_url, published_at: new Date(Number(item.create_time) * 1000).toISOString(), active: true }));
    } else return reply({ error: 'Choose YouTube or TikTok.' }, 400);

    if (rows.length) {
      const upserted = await admin.from('media_posts').upsert(rows, { onConflict: 'location_id,platform,external_id' });
      if (upserted.error) throw upserted.error;
    }
    return reply({ ok: true, platform, synced: rows.length });
  } catch (error) { console.error(error); return reply({ error: error instanceof Error ? error.message : 'Media sync failed.' }, 500); }
});
