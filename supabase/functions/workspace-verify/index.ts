import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const allowedOrigins=new Set(['https://portal.gotcracked.co','http://localhost:8788','http://127.0.0.1:8788']);
const cors=(origin:string|null)=>({'Access-Control-Allow-Origin':allowedOrigins.has(origin||'')?origin!:'https://portal.gotcracked.co','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'});
const reply=(origin:string|null,body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors(origin),'Content-Type':'application/json'}});
const bytesToHex=(bytes:Uint8Array)=>[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
const sha256=async(value:string)=>bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));
function jwtPayload(authorization:string){
  try{
    const token=authorization.replace(/^Bearer\s+/i,'').trim(),part=token.split('.')[1]||'';
    const normalized=part.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-part.length%4)%4);
    return JSON.parse(atob(normalized));
  }catch{return {};}
}
const cleanEmail=(value:unknown)=>String(value||'').trim().toLowerCase();

Deno.serve(async request=>{
  const origin=request.headers.get('Origin');
  if(request.method==='OPTIONS')return new Response('ok',{headers:cors(origin)});
  if(request.method!=='POST')return reply(origin,{authorized:false,error:'Method not allowed.'},405);
  if(!allowedOrigins.has(origin||''))return reply(origin,{authorized:false,error:'Origin not allowed.'},403);
  try{
    const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authorization=request.headers.get('Authorization')||'';
    const userClient=createClient(url,anon,{global:{headers:{Authorization:authorization}}}),admin=createClient(url,service);
    const {data:{user},error:userError}=await userClient.auth.getUser();
    if(userError||!user)return reply(origin,{authorized:false,error:'Sign in with Google Workspace to continue.'},401);
    const claims:any=jwtPayload(authorization),sessionId=String(claims?.session_id||'');
    if(!/^[0-9a-f-]{36}$/i.test(sessionId))return reply(origin,{authorized:false,error:'This Portal session cannot be verified. Sign in again.'},401);
    const active=await userClient.rpc('portal_auth_session_active');
    if(active.error||active.data!==true)return reply(origin,{authorized:false,error:'This sign-in has expired. Continue with Google Workspace again.'},401);
    if(!Array.isArray(claims.amr)||!claims.amr.some((entry:any)=>entry.method==='oauth'))return reply(origin,{authorized:false,error:'Google Workspace OAuth is required.'},403);

    const body=await request.json().catch(()=>({}));
    const providerToken=String(body?.providerToken||'').trim(),inviteToken=String(body?.inviteToken||'').trim();
    const linked=user.identities?.find(identity=>identity.provider==='google'),identity:any=linked?.identity_data||{};
    const linkedEmail=cleanEmail(identity.email),linkedSub=String(identity.sub||linked?.id||'');
    if(!linked||!linkedEmail||!linkedSub)return reply(origin,{authorized:false,error:'No Google Workspace identity is linked to this account.'},403);
    if(!providerToken)return reply(origin,{authorized:false,error:'Google Workspace proof is missing. Sign in again.'},403);
    const googleResponse=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:`Bearer ${providerToken}`,Accept:'application/json'}});
    if(!googleResponse.ok)return reply(origin,{authorized:false,providerMismatch:true,error:'This OAuth session is not a valid Google Workspace sign-in.'},403);
    const google:any=await googleResponse.json();
    const googleEmail=cleanEmail(google.email);
    if(google.email_verified!==true||!googleEmail.endsWith('@gotcracked.co'))return reply(origin,{authorized:false,error:'Use a verified @gotcracked.co Google Workspace account.'},403);
    if(linkedEmail!==googleEmail||String(google.sub||'')!==linkedSub)return reply(origin,{authorized:false,error:'This Google identity does not match the linked Portal account.'},403);

    let {data:profile,error:profileError}=await admin.from('profiles').select('*').eq('id',user.id).maybeSingle();
    if(profileError)throw profileError;
    let consumedInvite:any=null;
    if(!profile&&inviteToken){
      const tokenHash=await sha256(inviteToken);
      const {data:invite,error:inviteError}=await admin.from('staff_invitations').select('*').eq('token_hash',tokenHash).is('used_at',null).is('cancelled_at',null).gt('expires_at',new Date().toISOString()).maybeSingle();
      if(inviteError)throw inviteError;
      if(!invite||cleanEmail(invite.portal_email)!==googleEmail)return reply(origin,{authorized:false,error:'This onboarding package is invalid, expired, or belongs to another Workspace account.'},403);
      const conflict=await admin.from('profiles').select('id').ilike('portal_email',googleEmail).neq('id',user.id).maybeSingle();
      if(conflict.error)throw conflict.error;
      if(conflict.data)return reply(origin,{authorized:false,error:'This Workspace address is already assigned to another Portal profile.'},409);
      const used=await admin.from('staff_invitations').update({used_at:new Date().toISOString(),used_by:user.id}).eq('id',invite.id).is('used_at',null).is('cancelled_at',null).gt('expires_at',new Date().toISOString()).select('id').maybeSingle();
      if(used.error||!used.data)throw used.error||new Error('This onboarding package was already used.');
      const displayName=invite.display_name||google.name||googleEmail.split('@')[0];
      const created=await admin.from('profiles').insert({id:user.id,location_id:invite.location_id,display_name:displayName,role:invite.role,active:true,account_type:'staff',recovery_email:invite.recovery_email||null,portal_email:googleEmail,job_title:invite.job_title||null,discord_username:invite.discord_username||null,must_change_password:false,onboarding_complete:false,onboarding_status:'onboarding',discord_invite_expires_at:invite.expires_at,last_portal_login_at:new Date().toISOString(),updated_at:new Date().toISOString()}).select().single();
      if(created.error)throw created.error;profile=created.data;consumedInvite=invite;
      const progress=await admin.from('staff_onboarding_progress').upsert({profile_id:user.id,location_id:invite.location_id,invitation_id:invite.id,status:'in_progress',welcome_payload:invite.welcome_payload||{}},{onConflict:'profile_id'});
      if(progress.error)throw progress.error;
      await admin.from('staff_account_events').insert({location_id:invite.location_id,invitation_id:invite.id,actor_user_id:user.id,target_user_id:user.id,event_type:'workspace_invitation_accepted',details:{workspace_email:googleEmail}});
    }
    if(!profile?.active)return reply(origin,{authorized:false,error:'Your GotCracked staff account is not active.'},403);
    if(profile.account_type!=='staff')return reply(origin,{authorized:false,error:'Shared workstations use device enrollment, not personal Workspace authentication.'},403);
    if(profile.portal_email&&cleanEmail(profile.portal_email)!==googleEmail)return reply(origin,{authorized:false,error:'This Portal profile is assigned to a different Workspace address. Contact an owner.'},403);
    const updated=await admin.from('profiles').update({portal_email:googleEmail,last_portal_login_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',user.id);
    if(updated.error)throw updated.error;
    const registered=await admin.from('portal_human_sessions').upsert({auth_session_id:sessionId,profile_id:user.id,location_id:profile.location_id,verification_method:'google',verified_at:new Date().toISOString(),last_seen_at:new Date().toISOString()},{onConflict:'auth_session_id'});
    if(registered.error)throw registered.error;
    return reply(origin,{authorized:true,role:profile.role,workspaceEmail:googleEmail,onboardingRequired:!profile.onboarding_complete,invitationAccepted:Boolean(consumedInvite),sessionVerified:true});
  }catch(error){
    console.error('workspace-verify',error);
    return reply(origin,{authorized:false,error:'Google Workspace access verification failed.'},500);
  }
});
