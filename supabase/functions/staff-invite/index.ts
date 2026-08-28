import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const origins=new Set(['https://portal.gotcracked.co','http://localhost:8788','http://127.0.0.1:8788']);
const headers=(origin:string|null)=>({'Access-Control-Allow-Origin':origins.has(origin||'')?origin!:'https://portal.gotcracked.co','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Vary':'Origin'});
const respond=(origin:string|null,body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:headers(origin)});
const clean=(value:unknown,max=120)=>String(value||'').trim().slice(0,max);
const slug=(value:string)=>value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'.').replace(/^\.+|\.+$/g,'').slice(0,40)||'staff';
const hex=(bytes:Uint8Array)=>[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
const sha256=async(value:string)=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));
const randomToken=()=>hex(crypto.getRandomValues(new Uint8Array(32)));

Deno.serve(async request=>{
  const origin=request.headers.get('Origin');
  if(request.method==='OPTIONS')return new Response('ok',{headers:headers(origin)});
  if(request.method!=='POST')return respond(origin,{error:'Method not allowed.'},405);
  if(!origins.has(origin||''))return respond(origin,{error:'Origin not allowed.'},403);
  try{
    const url=Deno.env.get('SUPABASE_URL')!;
    const userClient=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:request.headers.get('Authorization')||''}}});
    const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const {data:{user}}=await userClient.auth.getUser();
    if(!user)return respond(origin,{error:'Sign in required.'},401);
    const {data:actor}=await admin.from('profiles').select('id,location_id,role,active,account_type,display_name').eq('id',user.id).single();
    if(!actor?.active||actor.account_type!=='staff'||!['owner','manager'].includes(actor.role))return respond(origin,{error:'Only active owners and managers can onboard staff.'},403);
    const permission=await userClient.rpc('has_permission',{permission_key:'staff.manage'});
    if(permission.error||permission.data!==true)return respond(origin,{error:'Staff management permission is required.'},403);

    const body=await request.json();
    const displayName=clean(body.displayName,100),discordUsername=clean(body.discordUsername,32).toLowerCase();
    const role=clean(body.role,30),recoveryEmail=clean(body.recoveryEmail,160).toLowerCase()||null;
    const jobTitle=clean(body.jobTitle,120)||null,firstDay=clean(body.firstDay,10)||null;
    const welcomeMessage=clean(body.welcomeMessage,1200)||`Welcome to GotCracked, ${displayName || 'there'}. We’re excited to have you on the team.`;
    if(!displayName)return respond(origin,{error:'Enter the employee name.'},400);
    if(!/^[a-z0-9_.]{2,32}$/.test(discordUsername))return respond(origin,{error:'Enter the employee’s current Discord username, without @.'},400);
    if(!['manager','technician','front_desk'].includes(role)||(role==='manager'&&actor.role!=='owner'))return respond(origin,{error:'That role cannot be assigned.'},400);
    if(recoveryEmail&&!/^\S+@\S+\.\S+$/.test(recoveryEmail))return respond(origin,{error:'Enter a valid pre-employment email or leave it blank.'},400);
    if(firstDay&&!/^\d{4}-\d{2}-\d{2}$/.test(firstDay))return respond(origin,{error:'Choose a valid first day.'},400);

    const duplicate=await admin.from('profiles').select('id').ilike('discord_username',discordUsername).maybeSingle();
    if(duplicate.data)return respond(origin,{error:'That Discord username is already assigned to an employee.'},409);
    const pending=await admin.from('staff_invitations').select('id').eq('location_id',actor.location_id).ilike('discord_username',discordUsername).is('used_at',null).is('cancelled_at',null).gt('expires_at',new Date().toISOString()).maybeSingle();
    if(pending.data)return respond(origin,{error:'An active onboarding package already exists for this Discord username. Cancel it before issuing another.'},409);

    const base=slug(displayName);let portalEmail=`${base}@gotcracked.co`;
    for(let suffix=2;suffix<100;suffix++){
      const profileExists=await admin.from('profiles').select('id').ilike('portal_email',portalEmail).maybeSingle();
      const inviteExists=await admin.from('staff_invitations').select('id').ilike('portal_email',portalEmail).is('cancelled_at',null).maybeSingle();
      if(!profileExists.data&&!inviteExists.data)break;
      portalEmail=`${base}.${suffix}@gotcracked.co`;
    }

    const botToken=Deno.env.get('DISCORD_BOT_TOKEN'),channelId=Deno.env.get('DISCORD_ONBOARDING_CHANNEL_ID')||Deno.env.get('DISCORD_LEAD_CHANNEL_ID');
    if(!botToken||!channelId)throw new Error('Discord onboarding is not configured.');
    const inviteResponse=await fetch(`https://discord.com/api/v10/channels/${channelId}/invites`,{method:'POST',headers:{Authorization:`Bot ${botToken}`,'Content-Type':'application/json','X-Audit-Log-Reason':`GotCracked staff onboarding: ${displayName}`},body:JSON.stringify({max_age:604800,max_uses:1,temporary:false,unique:true})});
    if(!inviteResponse.ok)throw new Error(`Discord invite creation failed (${inviteResponse.status}).`);
    const discordInvite=await inviteResponse.json();
    const discordInviteUrl=`https://discord.gg/${discordInvite.code}`;

    const rawToken=randomToken(),tokenHash=await sha256(rawToken),expiresAt=new Date(Date.now()+604800000).toISOString();
    const welcomePayload={displayName,role,jobTitle,firstDay,managerName:actor.display_name,welcomeMessage,preEmploymentEmail:recoveryEmail,portalEmail};
    const inserted=await admin.from('staff_invitations').insert({token_hash:tokenHash,invited_by:actor.id,location_id:actor.location_id,role,display_name:displayName,discord_username:discordUsername,recovery_email:recoveryEmail,portal_email:portalEmail,job_title:jobTitle,first_day:firstDay,welcome_message:welcomeMessage,welcome_payload:welcomePayload,expires_at:expiresAt}).select('id').single();
    if(inserted.error)throw inserted.error;
    const portalInviteUrl=`https://portal.gotcracked.co/?invite=${encodeURIComponent(rawToken)}`;
    const firstDayLine=firstDay?`\nFirst day: ${firstDay}`:'';
    const titleLine=jobTitle?`\nPosition: ${jobTitle}`:'';
    const welcomeEmailSubject=`Welcome to GotCracked — ${displayName}`;
    const welcomeEmailBody=`Hi ${displayName.split(' ')[0]},\n\n${welcomeMessage}\n${titleLine}${firstDayLine}\n\nYour secure onboarding steps:\n1. Join the GotCracked staff Discord: ${discordInviteUrl}\n2. Open your private Portal invitation: ${portalInviteUrl}\n3. Continue with your Discord account and complete the guided welcome checklist.\n4. Create your personal workstation PIN when prompted.\n\nYour GotCracked employee address is ${portalEmail}. Portal access itself uses Discord — there is no shared or temporary password.\n\nIf you have questions before your first day, reply to this email.\n\n— GotCracked Management`;
    await admin.from('staff_account_events').insert({location_id:actor.location_id,invitation_id:inserted.data.id,actor_user_id:actor.id,event_type:'invitation_created',details:{display_name:displayName,discord_username:discordUsername,portal_email:portalEmail,expires_at:expiresAt,first_day:firstDay,role}});
    return respond(origin,{ok:true,invitationId:inserted.data.id,staff:{displayName,portalEmail,discordUsername,role,jobTitle,firstDay,onboardingStatus:'invite_created'},portalInviteUrl,discordInviteUrl,discordInviteExpiresAt:expiresAt,welcomeEmailSubject,welcomeEmailBody},201);
  }catch(error){console.error('staff-invite',error);return respond(origin,{error:'Unable to create the staff onboarding package.'},500);}
});
