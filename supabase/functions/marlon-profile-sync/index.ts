import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const discordToken = Deno.env.get('DISCORD_BOT_TOKEN') || '';
const MAX_AVATAR_BYTES = 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/png','image/jpeg','image/webp','image/gif']);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {status,headers:{...corsHeaders,'Content-Type':'application/json'}});
}

function encodeBase64(bytes: Uint8Array) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i,i+chunk));
  return btoa(binary);
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok',{headers:corsHeaders});
  if (request.method !== 'POST') return json({error:'Method not allowed'},405);

  try {
    const authorization = request.headers.get('Authorization') || '';
    if (!authorization.startsWith('Bearer ')) return json({error:'Authentication required'},401);

    const client = createClient(supabaseUrl,anonKey,{
      global:{headers:{Authorization:authorization}},
      auth:{persistSession:false,autoRefreshToken:false}
    });
    const {data:{user},error:userError} = await client.auth.getUser();
    if (userError || !user) return json({error:'Invalid Portal session'},401);

    const permission = await client.rpc('has_permission',{permission_key:'settings.manage'});
    if (permission.error || permission.data !== true) return json({error:'Settings permission required'},403);

    const profileResult = await client.from('profiles').select('location_id').eq('id',user.id).maybeSingle();
    if (profileResult.error || !profileResult.data?.location_id) return json({error:'Staff location unavailable'},400);

    const settingsResult = await client.from('business_settings')
      .select('marlon_avatar_url,marlon_discord_avatar_sync')
      .eq('location_id',profileResult.data.location_id)
      .maybeSingle();
    if (settingsResult.error) throw settingsResult.error;
    if (!settingsResult.data?.marlon_discord_avatar_sync) return json({ok:true,skipped:true,reason:'Discord avatar sync is disabled'});

    const source = String(settingsResult.data?.marlon_avatar_url || '').trim();
    if (!source) return json({error:'Set a Marlon avatar URL in Portal Settings first.'},400);

    let avatarUrl: URL;
    try { avatarUrl = new URL(source); }
    catch { return json({error:'Marlon avatar URL is invalid.'},400); }
    if (avatarUrl.protocol !== 'https:') return json({error:'Marlon avatar URL must use HTTPS.'},400);

    const avatarResponse = await fetch(avatarUrl.toString(),{redirect:'follow'});
    if (!avatarResponse.ok) return json({error:`Avatar image could not be downloaded (${avatarResponse.status}).`},400);
    const contentType = String(avatarResponse.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) return json({error:'Discord sync supports PNG, JPEG, WebP, or GIF avatars.'},400);

    const bytes = new Uint8Array(await avatarResponse.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_AVATAR_BYTES) return json({error:'Avatar image must be between 1 byte and 1 MB.'},400);
    if (!discordToken) return json({error:'Discord bot token is not configured on the server.'},500);

    const avatar = `data:${contentType};base64,${encodeBase64(bytes)}`;
    const discordResponse = await fetch('https://discord.com/api/v10/users/@me',{
      method:'PATCH',
      headers:{Authorization:`Bot ${discordToken}`,'Content-Type':'application/json'},
      body:JSON.stringify({avatar})
    });
    if (!discordResponse.ok) {
      const detail = (await discordResponse.text().catch(()=>'' )).slice(0,500);
      throw new Error(`Discord profile update failed (${discordResponse.status})${detail?`: ${detail}`:''}`);
    }

    const discordUser = await discordResponse.json().catch(()=>({}));
    return json({ok:true,discordUserId:discordUser?.id || null});
  } catch (error) {
    console.error('Marlon profile sync failed',error);
    return json({error:error instanceof Error ? error.message : 'Unable to sync Marlon to Discord.'},500);
  }
});
