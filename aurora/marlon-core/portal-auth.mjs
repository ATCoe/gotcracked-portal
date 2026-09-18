// Authenticate against Supabase, then apply the same session and permission
// policy used by Portal RLS. Never authorize from a decoded JWT or a role alone.
export async function authorizePortal(request, env, permissions = [], fetcher = fetch) {
  const authorization = request.headers.get('authorization') || '';
  const fail = (status, error) => ({ ok:false, status, error });
  if (!/^Bearer [^\s]+$/i.test(authorization)) return fail(401, 'Portal sign-in required.');
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return fail(503, 'Portal authentication is not configured.');
  const headers = { apikey:env.SUPABASE_ANON_KEY, Authorization:authorization, 'Content-Type':'application/json' };
  const operator = request.headers.get('x-gc-operator-token');
  if (operator) headers['x-gc-operator-token'] = operator;
  const call = (path, body) => fetcher(`${env.SUPABASE_URL}${path}`, {
    method:body === undefined ? 'GET' : 'POST', headers,
    ...(body === undefined ? {} : {body:JSON.stringify(body)}),
    redirect:'error', signal:AbortSignal.timeout(12000)
  });
  try {
    const userResponse=await call('/auth/v1/user');
    if(!userResponse.ok)return fail(userResponse.status>=500?503:401,'Portal session could not be validated.');
    const user=await userResponse.json();
    if(!user?.id)return fail(401,'Portal sign-in required.');
    const session=await call('/rest/v1/rpc/portal_session_authorized',{});
    if(!session.ok)return fail(503,'Portal session verification is unavailable.');
    if(await session.json()!==true)return fail(403,'A verified active Portal session is required.');
    const profileResponse=await call(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,role,account_type,active,location_id`);
    if(!profileResponse.ok)return fail(503,'Portal profile verification is unavailable.');
    const profile=(await profileResponse.json())?.[0];
    if(!profile?.active||!profile.location_id||profile.id!==user.id)return fail(403,'Active Portal staff access required.');
    for(const permission of permissions){
      const response=await call('/rest/v1/rpc/has_permission',{permission_key:permission});
      if(!response.ok)return fail(503,'Portal permission verification is unavailable.');
      if(await response.json()===true)return {ok:true,profile};
    }
    return permissions.length ? fail(403,'Portal permission required.') : {ok:true,profile};
  }catch{return fail(503,'Portal authentication is temporarily unavailable.');}
}

export function canReadAgentJob(job, profile, manager = false) {
  if (!job) return false;
  // Legacy jobs have no ownership metadata: only management may inspect them.
  if (!job.locationId || !job.requestedBy) return manager;
  return job.locationId === profile.location_id && (manager || job.requestedBy === profile.id);
}
