import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const origins = new Set(['https://portal.gotcracked.co','http://localhost:8788','http://127.0.0.1:8788']);
const headers = (origin:string|null) => ({
  'Access-Control-Allow-Origin': origins.has(origin || '') ? origin! : 'https://portal.gotcracked.co',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Vary':'Origin'
});
const respond = (origin:string|null,body:unknown,status=200) => new Response(JSON.stringify(body),{status,headers:headers(origin)});
const clean = (value:unknown,max=120) => String(value || '').trim().slice(0,max);
const slug = (value:string) => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'.').replace(/^\.+|\.+$/g,'').slice(0,40) || 'staff';
const randomPassword = () => {
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%';
  const bytes=crypto.getRandomValues(new Uint8Array(18));
  return [...bytes].map((byte,index)=>alphabet[byte%alphabet.length]).join('') + ['A','a','7','!'].map((c,i)=>c[(bytes[i]||0)%c.length]).join('');
};

Deno.serve(async request => {
  const origin=request.headers.get('Origin');
  if(request.method==='OPTIONS') return new Response('ok',{headers:headers(origin)});
  if(request.method!=='POST') return respond(origin,{error:'Method not allowed.'},405);
  if(!origins.has(origin || '')) return respond(origin,{error:'Origin not allowed.'},403);
  try{
    const url=Deno.env.get('SUPABASE_URL')!;
    const userClient=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:request.headers.get('Authorization') || ''}}});
    const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const {data:{user}}=await userClient.auth.getUser();
    if(!user) return respond(origin,{error:'Sign in required.'},401);
    const {data:actor}=await admin.from('profiles').select('id,location_id,role,active').eq('id',user.id).single();
    if(!actor?.active || !['owner','manager'].includes(actor.role)) return respond(origin,{error:'Only active owners and managers can onboard staff.'},403);

    const body=await request.json();
    const displayName=clean(body.displayName,100), discordUsername=clean(body.discordUsername,32).toLowerCase();
    const role=clean(body.role,30), recoveryEmail=clean(body.recoveryEmail,160).toLowerCase() || null;
    if(!displayName) return respond(origin,{error:'Enter the employee name.'},400);
    if(!/^[a-z0-9_.]{2,32}$/.test(discordUsername)) return respond(origin,{error:'Enter the employee’s current Discord username.'},400);
    if(!['manager','technician','front_desk'].includes(role) || (role==='manager' && actor.role!=='owner')) return respond(origin,{error:'That role cannot be assigned.'},400);
    if(recoveryEmail && !/^\S+@\S+\.\S+$/.test(recoveryEmail)) return respond(origin,{error:'Enter a valid recovery email or leave it blank.'},400);
    const duplicate=await admin.from('profiles').select('id').ilike('discord_username',discordUsername).maybeSingle();
    if(duplicate.data) return respond(origin,{error:'That Discord username is already assigned to a staff profile.'},409);

    const base=slug(displayName); let portalEmail=`${base}@gotcracked.co`;
    for(let suffix=2;suffix<100;suffix++){
      const exists=await admin.from('profiles').select('id').ilike('portal_email',portalEmail).maybeSingle();
      if(!exists.data) break;
      portalEmail=`${base}.${suffix}@gotcracked.co`;
    }

    const botToken=Deno.env.get('DISCORD_BOT_TOKEN'), channelId=Deno.env.get('DISCORD_ONBOARDING_CHANNEL_ID') || Deno.env.get('DISCORD_LEAD_CHANNEL_ID');
    if(!botToken || !channelId) throw new Error('Discord onboarding is not configured.');
    const inviteResponse=await fetch(`https://discord.com/api/v10/channels/${channelId}/invites`,{
      method:'POST',headers:{Authorization:`Bot ${botToken}`,'Content-Type':'application/json','X-Audit-Log-Reason':`GotCracked staff onboarding: ${displayName}`},
      body:JSON.stringify({max_age:604800,max_uses:1,temporary:false,unique:true})
    });
    if(!inviteResponse.ok) throw new Error(`Discord invite creation failed (${inviteResponse.status}).`);
    const invite=await inviteResponse.json(); const discordInviteUrl=`https://discord.gg/${invite.code}`;
    const temporaryPassword=randomPassword();
    const created=await admin.auth.admin.createUser({email:portalEmail,password:temporaryPassword,email_confirm:true,user_metadata:{display_name:displayName,role,location_id:actor.location_id}});
    if(created.error || !created.data.user) throw created.error || new Error('Unable to create the Portal account.');
    const expiresAt=new Date(Date.now()+604800000).toISOString();
    const profile=await admin.from('profiles').upsert({id:created.data.user.id,location_id:actor.location_id,display_name:displayName,role,active:true,recovery_email:recoveryEmail,must_change_password:true,onboarding_complete:false,discord_username:discordUsername,portal_email:portalEmail,onboarding_status:'discord_pending',discord_invite_expires_at:expiresAt,updated_at:new Date().toISOString()},{onConflict:'id'}).select().single();
    if(profile.error){await admin.auth.admin.deleteUser(created.data.user.id);throw profile.error;}
    await admin.from('staff_account_events').insert({actor_user_id:user.id,target_user_id:created.data.user.id,event_type:'account_created',details:{portal_email:portalEmail,discord_username:discordUsername,discord_invite_expires_at:expiresAt,onboarding_status:'discord_pending'}});
    return respond(origin,{ok:true,staff:{id:created.data.user.id,displayName,portalEmail,discordUsername,role,onboardingStatus:'discord_pending'},temporaryPassword,discordInviteUrl,discordInviteExpiresAt:expiresAt},201);
  }catch(error){console.error(error);return respond(origin,{error:'Unable to create the staff onboarding package.'},500);}
});

