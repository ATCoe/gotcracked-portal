import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const allowedOrigins=new Set(['https://portal.gotcracked.co','http://localhost:8788','http://127.0.0.1:8788']);
const cors=(origin:string|null)=>({'Access-Control-Allow-Origin':allowedOrigins.has(origin||'')?origin!:'https://portal.gotcracked.co','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Vary':'Origin'});
const reply=(origin:string|null,body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors(origin)});
const hex=(bytes:Uint8Array)=>[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
const sha256=async(value:string)=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));
const randomToken=()=>hex(crypto.getRandomValues(new Uint8Array(32)));

Deno.serve(async request=>{
  const origin=request.headers.get('Origin');
  if(request.method==='OPTIONS')return new Response('ok',{headers:cors(origin)});
  if(request.method!=='POST')return reply(origin,{error:'Method not allowed.'},405);
  if(!allowedOrigins.has(origin||''))return reply(origin,{error:'Origin not allowed.'},403);
  try{
    const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,authorization=request.headers.get('Authorization')||'';
    const userClient=createClient(url,anon,{global:{headers:{Authorization:authorization}}}),admin=createClient(url,service);
    const {data:{user},error:userError}=await userClient.auth.getUser();
    if(userError||!user)return reply(origin,{error:'Sign in with Discord before enrolling a workstation.'},401);
    if(!user.identities?.some(identity=>identity.provider==='discord'))return reply(origin,{error:'Workstation enrollment requires a fresh human Discord sign-in.'},403);
    const {data:actor,error:actorError}=await admin.from('profiles').select('id,location_id,role,active,account_type,discord_user_id,display_name').eq('id',user.id).single();
    if(actorError||!actor?.active||actor.account_type!=='staff'||!['owner','manager'].includes(actor.role)||!actor.discord_user_id)return reply(origin,{error:'Only a Discord-authenticated owner or manager can enroll a workstation.'},403);
    const permission=await userClient.rpc('has_permission',{permission_key:'staff.manage'});if(permission.error||permission.data!==true)return reply(origin,{error:'Staff management permission is required.'},403);
    const body=await request.json().catch(()=>({})),deviceId=String(body.deviceId||'').trim(),deviceLabel=String(body.deviceLabel||'Front Desk Workstation').trim().slice(0,120)||'Front Desk Workstation';
    if(deviceId.length<16||deviceId.length>256)return reply(origin,{error:'This browser could not create a valid device identity.'},400);
    const {data:workstation,error:workstationError}=await admin.from('profiles').select('id,location_id,display_name,active,account_type').eq('location_id',actor.location_id).eq('account_type','shared_workstation').eq('active',true).limit(1).maybeSingle();
    if(workstationError||!workstation)return reply(origin,{error:'No active Front Desk Workstation account is configured for this location.'},404);
    const {data:authRecord,error:authError}=await admin.auth.admin.getUserById(workstation.id),workstationEmail=authRecord?.user?.email||'';
    if(authError||!workstationEmail)return reply(origin,{error:'The workstation authentication identity is not configured.'},500);
    const enrollmentToken=randomToken(),tokenHash=await sha256(enrollmentToken),deviceHash=await sha256(deviceId),expiresAt=new Date(Date.now()+5*60*1000).toISOString();
    await admin.from('workstation_enrollment_grants').delete().eq('workstation_profile_id',workstation.id).lt('expires_at',new Date().toISOString());
    const grant=await admin.from('workstation_enrollment_grants').insert({location_id:actor.location_id,workstation_profile_id:workstation.id,token_hash:tokenHash,device_id_hash:deviceHash,created_by:actor.id,expires_at:expiresAt}).select('id').single();if(grant.error)throw grant.error;
    const generated=await admin.auth.admin.generateLink({type:'magiclink',email:workstationEmail,options:{redirectTo:'https://portal.gotcracked.co/?workstation-enroll=complete'}} as any);if(generated.error)throw generated.error;
    const props:any=generated.data?.properties||{},actionLink=props.action_link||props.actionLink||'';let otpTokenHash=props.hashed_token||props.hashedToken||'';
    if(!otpTokenHash&&actionLink){try{otpTokenHash=new URL(actionLink).searchParams.get('token')||'';}catch{}}
    if(!otpTokenHash){await admin.from('workstation_enrollment_grants').delete().eq('id',grant.data.id);throw new Error('Supabase did not return a one-time workstation sign-in token.');}
    await admin.from('staff_account_events').insert({location_id:actor.location_id,actor_user_id:actor.id,target_user_id:workstation.id,event_type:'workstation_enrollment_issued',details:{device_label:deviceLabel,expires_at:expiresAt}});
    return reply(origin,{ok:true,enrollmentToken,otpTokenHash,deviceId,deviceLabel,workstationName:workstation.display_name,expiresAt});
  }catch(error){console.error('workstation-enroll',error);return reply(origin,{error:'Unable to enroll the Front Desk Workstation. Please sign in again and retry.'},500);}
});
