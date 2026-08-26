import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const portalUrl = (Deno.env.get('PORTAL_URL') || 'https://portal.gotcracked.co').replace(/\/$/, '');
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const callbackUrl = `${supabaseUrl}/functions/v1/google-integrations?action=callback`;
const googleClientId = () => (Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') || '').trim();
const googleClientSecret = () => (Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') || '').trim();
const businessScope = 'https://www.googleapis.com/auth/business.manage';
const coreScopes = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/analytics.readonly'
];
const cors = {
  'Access-Control-Allow-Origin': portalUrl,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
  'Vary': 'Origin'
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const admin = () => createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

async function actor(request: Request) {
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization) return null;
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { global:{ headers:{ Authorization:authorization } } });
  const user = await userClient.auth.getUser();
  if (user.error || !user.data.user) return null;
  const result = await admin().from('profiles').select('id,location_id,role,active').eq('id',user.data.user.id).maybeSingle();
  if (result.error || !result.data?.active || !result.data.location_id || !['owner','manager'].includes(result.data.role)) return null;
  return result.data;
}

function oauthConfigured() {
  return Boolean(googleClientId() && googleClientSecret());
}

async function refreshAccessToken(refreshToken: string) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({
      client_id:googleClientId(),
      client_secret:googleClientSecret(),
      refresh_token:refreshToken,
      grant_type:'refresh_token'
    })
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || 'Unable to refresh Google access.');
  return data.access_token as string;
}

const isoDate = (date: Date) => date.toISOString().slice(0,10);

async function metrics(locationId: string) {
  const db = admin();
  const [connectionResult, settingsResult] = await Promise.all([
    db.from('google_integrations').select('*').eq('location_id',locationId).maybeSingle(),
    db.from('business_settings').select('google_search_console_property,google_analytics_property_id').eq('location_id',locationId).maybeSingle()
  ]);
  if (connectionResult.error) throw connectionResult.error;
  if (!connectionResult.data) return { connected:false };
  const accessToken = await refreshAccessToken(connectionResult.data.refresh_token);
  const settings = settingsResult.data || {};
  const grantedScopes = Array.isArray(connectionResult.data.scopes) ? connectionResult.data.scopes : [];
  const end = new Date(); end.setUTCDate(end.getUTCDate()-1);
  const start = new Date(end); start.setUTCDate(start.getUTCDate()-27);
  const output: Record<string,unknown> = {
    connected:true,
    period:{start:isoDate(start),end:isoDate(end)},
    businessProfileAuthorized:grantedScopes.includes(businessScope)
  };

  if (settings.google_search_console_property) {
    const response = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(settings.google_search_console_property)}/searchAnalytics/query`, {
      method:'POST', headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},
      body:JSON.stringify({startDate:isoDate(start),endDate:isoDate(end),rowLimit:1})
    });
    const data = await response.json();
    output.searchConsole = response.ok ? (data.rows?.[0] || {clicks:0,impressions:0,ctr:0,position:0}) : { error:data.error?.message || 'Search Console data unavailable.' };
  }

  if (settings.google_analytics_property_id) {
    const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(settings.google_analytics_property_id)}:runReport`, {
      method:'POST', headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},
      body:JSON.stringify({dateRanges:[{startDate:'28daysAgo',endDate:'yesterday'}],metrics:[{name:'sessions'},{name:'activeUsers'},{name:'screenPageViews'}]})
    });
    const data = await response.json();
    const values = data.rows?.[0]?.metricValues || [];
    output.analytics = response.ok ? {sessions:Number(values[0]?.value||0),activeUsers:Number(values[1]?.value||0),pageViews:Number(values[2]?.value||0)} : { error:data.error?.message || 'Analytics data unavailable.' };
  }

  if (grantedScopes.includes(businessScope)) {
    const business = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20', { headers:{Authorization:`Bearer ${accessToken}`} });
    const businessData = await business.json();
    output.businessProfile = business.ok ? {accounts:(businessData.accounts || []).map((item:any)=>({name:item.name,accountName:item.accountName,type:item.type}))} : {error:businessData.error?.message || 'Business Profile API unavailable.'};
  } else {
    output.businessProfile = {authorized:false,requiresAdditionalAuthorization:true};
  }

  await db.from('google_integrations').update({last_sync_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()}).eq('location_id',locationId);
  return output;
}

async function callback(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  const googleError = url.searchParams.get('error') || '';
  const googleErrorDescription = url.searchParams.get('error_description') || '';
  const db = admin();
  const stateResult = state ? await db.from('google_oauth_states').select('*').eq('state',state).maybeSingle() : { data:null, error:null } as any;

  if (googleError) {
    if (stateResult.data) await db.from('google_oauth_states').delete().eq('state',state);
    console.error(`Google OAuth authorization failed: ${googleError}${googleErrorDescription ? ` - ${googleErrorDescription}` : ''}`);
    return Response.redirect(`${portalUrl}/?google=error&reason=${encodeURIComponent(googleError)}#settings`,302);
  }

  if (stateResult.error || !stateResult.data || new Date(stateResult.data.expires_at).getTime() < Date.now() || !code) {
    console.error(`Google OAuth callback rejected: state=${state ? 'present' : 'missing'}, stateRow=${stateResult.data ? 'present' : 'missing'}, code=${code ? 'present' : 'missing'}`);
    if (stateResult.data) await db.from('google_oauth_states').delete().eq('state',state);
    return Response.redirect(`${portalUrl}/?google=error&reason=callback_validation#settings`,302);
  }

  await db.from('google_oauth_states').delete().eq('state',state);
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({
      client_id:googleClientId(),
      client_secret:googleClientSecret(),
      code,
      grant_type:'authorization_code',
      redirect_uri:callbackUrl
    })
  });
  const token = await tokenResponse.json();
  if (!tokenResponse.ok || !token.access_token) {
    const reason = String(token.error || 'token_exchange_failed');
    console.error(`Google OAuth token exchange failed (${tokenResponse.status}): ${reason}${token.error_description ? ` - ${token.error_description}` : ''}`);
    return Response.redirect(`${portalUrl}/?google=error&reason=${encodeURIComponent(reason)}#settings`,302);
  }

  const existing = await db.from('google_integrations').select('refresh_token').eq('location_id',stateResult.data.location_id).maybeSingle();
  if (existing.error) {
    console.error(`Google OAuth existing connection lookup failed: ${existing.error.message}`);
    return Response.redirect(`${portalUrl}/?google=error&reason=connection_lookup#settings`,302);
  }
  const refreshToken = token.refresh_token || existing.data?.refresh_token;
  if (!refreshToken) {
    console.error('Google OAuth completed without a refresh token. Reauthorization with consent is required.');
    return Response.redirect(`${portalUrl}/?google=reauthorize#settings`,302);
  }

  let email: string | null = null;
  try {
    const userInfo = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {headers:{Authorization:`Bearer ${token.access_token}`}});
    if (userInfo.ok) email = (await userInfo.json()).email || null;
  } catch {}

  const saved = await db.from('google_integrations').upsert({
    location_id:stateResult.data.location_id,
    connected_email:email,
    refresh_token:refreshToken,
    scopes:String(token.scope || '').split(/\s+/).filter(Boolean),
    connected_at:new Date().toISOString(),
    updated_at:new Date().toISOString(),
    last_error:null
  },{onConflict:'location_id'});
  if (saved.error) {
    console.error(`Google OAuth connection save failed: ${saved.error.message}`);
    return Response.redirect(`${portalUrl}/?google=error&reason=connection_save#settings`,302);
  }
  return Response.redirect(`${portalUrl}/?google=connected#settings`,302);
}

async function startAuthorization(staff:any, requestedScopes:string[]) {
  if (!oauthConfigured()) return json({error:'Google OAuth server credentials are not configured.',setupRequired:true,callbackUrl},409);
  const db = admin();
  await db.from('google_oauth_states').delete().lt('expires_at',new Date().toISOString());
  const state = crypto.randomUUID();
  const inserted = await db.from('google_oauth_states').insert({state,location_id:staff.location_id,requested_by:staff.id});
  if (inserted.error) throw inserted.error;
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.search = new URLSearchParams({
    client_id:googleClientId(),
    redirect_uri:callbackUrl,
    response_type:'code',
    scope:requestedScopes.join(' '),
    access_type:'offline',
    prompt:'consent',
    include_granted_scopes:'true',
    state
  }).toString();
  return json({authUrl:authUrl.toString(),callbackUrl,requestedScopes});
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok',{headers:cors});
  const url = new URL(request.url);
  if (request.method === 'GET' && url.searchParams.get('action') === 'callback') return callback(request);
  if (request.method !== 'POST') return json({error:'Method not allowed.'},405);
  try {
    const staff = await actor(request);
    if (!staff) return json({error:'Owner or manager access required.'},403);
    const body = await request.json().catch(()=>({}));
    const action = String(body.action || 'status');
    const db = admin();
    if (action === 'status') {
      const result = await db.from('google_integrations').select('connected_email,scopes,connected_at,last_sync_at,last_error').eq('location_id',staff.location_id).maybeSingle();
      const grantedScopes = Array.isArray(result.data?.scopes) ? result.data.scopes : [];
      return json({
        connected:Boolean(result.data),
        setupRequired:!oauthConfigured(),
        callbackUrl,
        email:result.data?.connected_email||null,
        scopes:grantedScopes,
        businessProfileAuthorized:grantedScopes.includes(businessScope),
        connectedAt:result.data?.connected_at||null,
        lastSyncAt:result.data?.last_sync_at||null,
        lastError:result.data?.last_error||null
      });
    }
    if (action === 'start') return startAuthorization(staff,coreScopes);
    if (action === 'start_business') return startAuthorization(staff,[businessScope]);
    if (action === 'metrics') return json(await metrics(staff.location_id));
    if (action === 'disconnect') {
      const current = await db.from('google_integrations').select('refresh_token').eq('location_id',staff.location_id).maybeSingle();
      if (current.data?.refresh_token) await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:current.data.refresh_token})}).catch(()=>null);
      await db.from('google_integrations').delete().eq('location_id',staff.location_id);
      return json({ok:true});
    }
    return json({error:'Unknown action.'},400);
  } catch (error) {
    console.error(error);
    return json({error:error instanceof Error ? error.message : 'Google integration failed.'},500);
  }
});