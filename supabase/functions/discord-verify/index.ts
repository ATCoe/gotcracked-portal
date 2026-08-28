import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const allowedOrigins=new Set(['https://portal.gotcracked.co','http://localhost:8788','http://127.0.0.1:8788']);
const cors=(origin:string|null)=>({'Access-Control-Allow-Origin':allowedOrigins.has(origin||'')?origin!:'https://portal.gotcracked.co','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'});
const reply=(origin:string|null,body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors(origin),'Content-Type':'application/json'}});
const bytesToHex=(bytes:Uint8Array)=>[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
async function sha256(value:string){return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));}
function jwtPayload(authorization:string){
  try{
    const token=authorization.replace(/^Bearer\s+/i,'').trim(),part=token.split('.')[1]||'';
    const normalized=part.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-part.length%4)%4);
    return JSON.parse(atob(normalized));
  }catch{return {};}
}

Deno.serve(async request=>{
  const origin=request.headers.get('Origin');
  if(request.method==='OPTIONS')return new Response('ok',{headers:cors(origin)});
  if(request.method!=='POST')return reply(origin,{authorized:false,error:'Method not allowed.'},405);
  if(!allowedOrigins.has(origin||''))return reply(origin,{authorized:false,error:'Origin not allowed.'},403);
  try{
    const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,authorization=request.headers.get('Authorization')||'';
    const userClient=createClient(url,anon,{global:{headers:{Authorization:authorization}}}),admin=createClient(url,service);
    const {data:{user},error:userError}=await userClient.auth.getUser();
    if(userError||!user)return reply(origin,{authorized:false,error:'Sign in required.'},401);
    const claims:any=jwtPayload(authorization),sessionId=String(claims?.session_id||'');
    if(!/^[0-9a-f-]{36}$/i.test(sessionId))return reply(origin,{authorized:false,error:'This Portal session cannot be verified. Sign in again.'},401);
    const discordIdentity=user.identities?.find(identity=>identity.provider==='discord');
    const discordId=String(discordIdentity?.identity_data?.provider_id||discordIdentity?.identity_data?.sub||discordIdentity?.id||'');
    if(!discordId)return reply(origin,{authorized:false,error:'No Discord identity was found.'},403);

    const guildId=Deno.env.get('DISCORD_GUILD_ID')!,botToken=Deno.env.get('DISCORD_BOT_TOKEN')!;
    if(!guildId||!botToken)throw new Error('Discord verification is not configured.');
    const memberResponse=await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${discordId}`,{headers:{Authorization:`Bot ${botToken}`}});
    if(!memberResponse.ok)return reply(origin,{authorized:false,error:'Join the GotCracked staff Discord before accessing the Portal.'},403);
    const member=await memberResponse.json(),identity:any=discordIdentity.identity_data||{};
    const currentUsername=String(identity.user_name||identity.preferred_username||member.user?.username||'').toLowerCase();

    let {data:profile}=await admin.from('profiles').select('*').eq('id',user.id).maybeSingle();
    const body=await request.json().catch(()=>({})),inviteToken=String(body?.inviteToken||'').trim();
    let consumedInvite:any=null;
    if(!profile&&inviteToken){
      const tokenHash=await sha256(inviteToken);
      const {data:invite}=await admin.from('staff_invitations').select('*').eq('token_hash',tokenHash).is('used_at',null).is('cancelled_at',null).gt('expires_at',new Date().toISOString()).maybeSingle();
      if(!invite||(invite.discord_user_id&&invite.discord_user_id!==discordId))return reply(origin,{authorized:false,error:'This staff invitation is invalid, expired, or belongs to another Discord account.'},403);
      if(invite.discord_username&&String(invite.discord_username).toLowerCase()!==currentUsername)return reply(origin,{authorized:false,error:`This onboarding package was issued for @${invite.discord_username}. Sign in with that Discord account or ask management to reissue it.`},403);
      const displayName=invite.display_name||member.nick||identity.full_name||identity.name||identity.user_name||'Staff';
      const created=await admin.from('profiles').insert({id:user.id,location_id:invite.location_id,display_name:displayName,role:invite.role,active:true,account_type:'staff',discord_user_id:discordId,discord_username:currentUsername||null,discord_avatar_url:identity.avatar_url||null,discord_verified_at:new Date().toISOString(),last_portal_login_at:new Date().toISOString(),recovery_email:invite.recovery_email||null,portal_email:invite.portal_email||null,job_title:invite.job_title||null,must_change_password:false,onboarding_complete:false,onboarding_status:'onboarding',discord_invite_expires_at:invite.expires_at,updated_at:new Date().toISOString()}).select().single();
      if(created.error)throw created.error;profile=created.data;consumedInvite=invite;
      const used=await admin.from('staff_invitations').update({used_at:new Date().toISOString(),used_by:user.id,discord_user_id:discordId}).eq('id',invite.id).is('used_at',null).select('id').maybeSingle();
      if(used.error||!used.data)throw used.error||new Error('This onboarding package was already used.');
      const progress=await admin.from('staff_onboarding_progress').upsert({profile_id:user.id,location_id:invite.location_id,invitation_id:invite.id,status:'in_progress',welcome_payload:invite.welcome_payload||{}},{onConflict:'profile_id'});if(progress.error)throw progress.error;
      await admin.from('staff_account_events').insert({location_id:invite.location_id,invitation_id:invite.id,actor_user_id:user.id,target_user_id:user.id,event_type:'discord_invitation_accepted',details:{discord_user_id:discordId,discord_username:currentUsername}});
    }
    if(!profile?.active)return reply(origin,{authorized:false,error:'Your GotCracked staff account is not active.'},403);
    if(profile.account_type==='shared_workstation')return reply(origin,{authorized:false,error:'Shared workstations use device enrollment, not Discord authentication.'},403);
    if(profile.discord_user_id&&String(profile.discord_user_id)!==discordId)return reply(origin,{authorized:false,error:'This Portal profile is already linked to a different Discord identity. Contact an owner.'},403);

    const updated=await admin.from('profiles').update({discord_user_id:discordId,discord_username:currentUsername||profile.discord_username,discord_avatar_url:identity.avatar_url||null,discord_verified_at:new Date().toISOString(),last_portal_login_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',user.id);if(updated.error)throw updated.error;
    const registered=await admin.from('portal_human_sessions').upsert({auth_session_id:sessionId,profile_id:user.id,location_id:profile.location_id,verification_method:'discord',verified_at:new Date().toISOString(),last_seen_at:new Date().toISOString()},{onConflict:'auth_session_id'});
    if(registered.error)throw registered.error;
    return reply(origin,{authorized:true,role:profile.role,discordUserId:discordId,onboardingRequired:!profile.onboarding_complete,invitationAccepted:Boolean(consumedInvite),sessionVerified:true});
  }catch(error){console.error('discord-verify',error);return reply(origin,{authorized:false,error:'Discord access verification failed.'},500);}
});
