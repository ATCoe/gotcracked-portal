import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const hex=(bytes:Uint8Array)=>[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
const randomToken=(bytes=32)=>hex(crypto.getRandomValues(new Uint8Array(bytes)));
const sha256=async(value:string)=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));
const safeLabel=(value:unknown)=>String(value||'AuroraServer GotCracked').trim().slice(0,120)||'AuroraServer GotCracked';
const validUuid=(value:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const allowedOrigins=new Set(['https://portal.gotcracked.co','http://localhost:4173','http://127.0.0.1:4173']);
const cors=(origin:string|null)=>({
  'Access-Control-Allow-Origin':allowedOrigins.has(origin||'')?origin!:'https://portal.gotcracked.co',
  'Access-Control-Allow-Headers':'content-type, authorization, apikey, x-client-info',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'
});
const reply=(origin:string|null,body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors(origin)});

async function discord(method:string,path:string,body?:unknown){
  const token=Deno.env.get('DISCORD_BOT_TOKEN')||'';
  if(!token)throw new Error('Discord bot connection is unavailable.');
  const response=await fetch(`https://discord.com/api/v10${path}`,{
    method,headers:{Authorization:`Bot ${token}`,'Content-Type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000)
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(`Discord request failed (${response.status}).`);
  return payload;
}

Deno.serve(async request=>{
  const origin=request.headers.get('Origin');
  if(origin&&!allowedOrigins.has(origin))return reply(origin,{error:'Origin not allowed.'},403);
  if(request.method==='OPTIONS')return new Response('ok',{headers:cors(origin)});
  const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  const authorization=request.headers.get('Authorization')||'';
  if(!service)return json({error:'Server configuration unavailable.'},500);
  try{
    const admin=createClient(Deno.env.get('SUPABASE_URL')!,service);

    // Retired: GET/code-only redirects leaked bearer proofs into URLs and rebound devices.
    // Do not resurrect this path or translate its query parameters into browser storage.
    if(request.method==='GET')return reply(origin,{error:'URL-based enrollment is retired. Use the approved browser pairing screen with a fresh approval.'},410);

    if(request.method!=='POST')return reply(origin,{error:'Method not allowed.'},405);
    if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))return reply(origin,{error:'JSON request required.'},415);
    const raw=await request.text();
    if(raw.length>8192)return reply(origin,{error:'Request too large.'},413);
    let body:any;
    try{body=JSON.parse(raw);}catch{return reply(origin,{error:'Invalid JSON.'},400);}
    if(!body||typeof body!=='object'||Array.isArray(body))return reply(origin,{error:'Invalid request.'},400);
    const action=String(body.action||'').trim();

    if(action==='create'){
      if(authorization!==`Bearer ${service}`)return json({error:'Service authorization required.'},401);
      const deviceId=String(body.deviceId||'').trim(),deviceLabel=safeLabel(body.deviceLabel);
      if(deviceId.length<16||deviceId.length>256)return json({error:'Invalid workstation device identity.'},400);
      const deviceHash=await sha256(deviceId);
      const workstations=await admin.from('profiles').select('id,location_id,display_name').eq('account_type','shared_workstation').eq('active',true).limit(2);
      if(workstations.error)throw workstations.error;
      if((workstations.data||[]).length!==1)return json({error:'Exactly one active shared workstation profile must be configured.'},409);
      const workstation=workstations.data![0];

      const existing=await admin.from('workstation_enrollment_requests').select('id,expires_at,approved_at,denied_at')
        .eq('workstation_profile_id',workstation.id).eq('device_id_hash',deviceHash).is('consumed_at',null)
        .gt('expires_at',new Date().toISOString()).order('created_at',{ascending:false}).limit(1).maybeSingle();
      if(existing.error)return reply(origin,{error:'Enrollment lookup unavailable. No request was created.'},503);
      if(existing.data&&!existing.data.denied_at){
        return json({ok:true,requestId:existing.data.id,expiresAt:existing.data.expires_at,status:existing.data.approved_at?'approved':'pending',reused:true});
      }

      const cfg=await admin.from('marlon_discord_config').select('lead_dm_profile_id').eq('location_id',workstation.location_id).maybeSingle();
      if(cfg.error||!cfg.data?.lead_dm_profile_id)return json({error:'No owner Discord approval recipient is configured.'},409);
      const owner=await admin.from('profiles').select('id,display_name,discord_user_id,role,active,account_type')
        .eq('id',cfg.data.lead_dm_profile_id).maybeSingle();
      if(owner.error||!owner.data?.active||owner.data.account_type!=='staff'||!['owner','manager'].includes(owner.data.role)||!owner.data.discord_user_id)
        return json({error:'Configured workstation approver is not an active linked owner or manager.'},409);

      const fingerprint=randomToken(16),expiresAt=new Date(Date.now()+10*60*1000).toISOString();
      const inserted=await admin.from('workstation_enrollment_requests').insert({
        location_id:workstation.location_id,workstation_profile_id:workstation.id,device_id_hash:deviceHash,
        device_label:deviceLabel,approval_fingerprint:fingerprint,expires_at:expiresAt
      }).select('id').single();
      if(inserted.error)throw inserted.error;
      const dm=await discord('POST','/users/@me/channels',{recipient_id:owner.data.discord_user_id});
      const short=fingerprint.slice(0,12);
      await discord('POST',`/channels/${dm.id}/messages`,{
        allowed_mentions:{parse:[]},
        embeds:[{title:'Approve GotCracked workstation?',description:'AuroraServer is requesting trusted Front Desk workstation access.',color:0x2f80ed,
          fields:[{name:'Device',value:deviceLabel,inline:false},{name:'Trust',value:'Session-bound shared workstation · employees still use personal PINs',inline:false},
            {name:'Expires',value:'10 minutes',inline:true}],footer:{text:'GotCracked · secure device enrollment'}}],
        components:[{type:1,components:[
          {type:2,style:3,label:'Approve',custom_id:`workstation:approve:${inserted.data.id}:${short}`},
          {type:2,style:4,label:'Deny',custom_id:`workstation:deny:${inserted.data.id}:${short}`}
        ]}]
      });
      await admin.from('staff_account_events').insert({location_id:workstation.location_id,target_user_id:workstation.id,event_type:'workstation_enrollment_approval_requested',
        details:{request_id:inserted.data.id,device_label:deviceLabel,approver_profile_id:owner.data.id,expires_at:expiresAt}});
      return json({ok:true,requestId:inserted.data.id,expiresAt,status:'pending',approver:owner.data.display_name});
    }

    if(action==='redeem_redirect')return reply(origin,{error:'URL-based enrollment is retired. Request a fresh device-bound approval.'},410);
    if(!['status','redeem','redeem_code'].includes(action))return reply(origin,{error:'Unknown action.'},400);
    const requestId=String(body.requestId||''),deviceId=String(body.deviceId||'').trim();
    if(!validUuid(requestId)||deviceId.length<32||deviceId.length>256)return reply(origin,{error:'A valid request and original browser proof are required.'},400);
    const deviceHash=await sha256(deviceId);
    const row=await admin.from('workstation_enrollment_requests').select('*').eq('id',requestId).maybeSingle();
    if(row.error)return reply(origin,{error:'Enrollment service unavailable. No request was consumed.'},503);
    if(!row.data||deviceHash!==row.data.device_id_hash)return reply(origin,{error:'Enrollment request not available to this browser.'},403);
    const record=row.data;
    const expired=new Date(record.expires_at).getTime()<=Date.now();
    if(action==='status'){
      const status=record.consumed_at?'consumed':record.denied_at?'denied':expired?'expired':record.approved_at?'approved':'pending';
      return reply(origin,{ok:true,status,requestId:record.id,expiresAt:record.expires_at,deviceLabel:record.device_label});
    }
    if(record.denied_at)return reply(origin,{error:'Enrollment request was denied.'},403);
    if(expired)return reply(origin,{error:'Enrollment approval expired. Request a fresh approval.'},410);
    if(record.consumed_at)return reply(origin,{error:'Enrollment approval was already claimed. Resume the saved completion, or request a fresh approval.'},409);
    if(!record.approved_at||!record.approved_by)return reply(origin,{error:'Enrollment request is not approved.'},409);
    const attempts=Number(record.redeem_attempts||0);
    if(attempts>=5)return reply(origin,{error:'Enrollment request locked. Request a fresh approval.'},423);

    // Revalidate the approving human and workstation rather than relying on stale role data.
    const approver=await admin.from('profiles').select('id,location_id,role,account_type,active').eq('id',record.approved_by).maybeSingle();
    const workstation=await admin.from('profiles').select('id,location_id,account_type,active').eq('id',record.workstation_profile_id).maybeSingle();
    if(approver.error||workstation.error)return reply(origin,{error:'Enrollment identity checks unavailable. No request was consumed.'},503);
    if(!approver.data?.active||approver.data.account_type!=='staff'||!['owner','manager'].includes(approver.data.role)||approver.data.location_id!==record.location_id||
       !workstation.data?.active||workstation.data.account_type!=='shared_workstation'||workstation.data.location_id!==record.location_id)
      return reply(origin,{error:'Enrollment approval is no longer authorized.'},403);

    let codeHash:string|null=null;
    if(action==='redeem_code'){
      const code=String(body.code||'').trim().toUpperCase();
      codeHash=await sha256(code);
      if(!/^[A-F0-9]{12}$/.test(code)||!record.redeem_code_hash||codeHash!==record.redeem_code_hash){
        // Compare-and-set prevents lost updates, including races with a successful claim.
        const counted=await admin.from('workstation_enrollment_requests').update({redeem_attempts:attempts+1})
          .eq('id',record.id).eq('device_id_hash',deviceHash).eq('redeem_attempts',attempts)
          .is('consumed_at',null).is('denied_at',null).gt('expires_at',new Date().toISOString()).select('id').maybeSingle();
        if(counted.error)return reply(origin,{error:'Enrollment service unavailable. No request was consumed.'},503);
        return reply(origin,{error:counted.data?'Incorrect enrollment code.':'Enrollment state changed. Check status before retrying.'},counted.data?403:409);
      }
    }
    const authRecord=await admin.auth.admin.getUserById(record.workstation_profile_id);
    const workstationEmail=authRecord.data?.user?.email||'';
    if(authRecord.error||!workstationEmail)return reply(origin,{error:'Workstation authentication unavailable. No request was consumed.'},503);

    // Immutable device binding. One atomic claim wins across ALL redemption methods.
    let claim=admin.from('workstation_enrollment_requests').update({consumed_at:new Date().toISOString()})
      .eq('id',record.id).eq('device_id_hash',deviceHash).eq('approved_by',record.approved_by)
      .eq('approved_at',record.approved_at).eq('redeem_attempts',attempts)
      .is('denied_at',null).is('consumed_at',null).gt('expires_at',new Date().toISOString());
    if(codeHash)claim=claim.eq('redeem_code_hash',codeHash);
    const claimed=await claim.select('id').maybeSingle();
    if(claimed.error)return reply(origin,{error:'Enrollment claim unavailable. Check status before retrying.'},503);
    if(!claimed.data)return reply(origin,{error:'Enrollment approval changed, expired, or was already claimed.'},409);

    const enrollmentToken=randomToken(32),tokenHash=await sha256(enrollmentToken);
    const grantExpires=new Date(Math.min(Date.now()+5*60*1000,new Date(record.expires_at).getTime())).toISOString();
    try{
      const grant=await admin.from('workstation_enrollment_grants').insert({
        location_id:record.location_id,workstation_profile_id:record.workstation_profile_id,token_hash:tokenHash,
        device_id_hash:deviceHash,created_by:record.approved_by,expires_at:grantExpires
      });
      if(grant.error)throw new Error('grant_insert_failed');
      const generated=await admin.auth.admin.generateLink({type:'magiclink',email:workstationEmail} as any);
      if(generated.error)throw new Error('auth_link_failed');
      const props:any=generated.data?.properties||{};
      const otpTokenHash=props.hashed_token||props.hashedToken||'';
      if(!otpTokenHash)throw new Error('auth_proof_missing');
      const audit=await admin.from('staff_account_events').insert({location_id:record.location_id,actor_user_id:record.approved_by,target_user_id:record.workstation_profile_id,
        event_type:'workstation_enrollment_approval_redeemed',details:{request_id:record.id,device_label:record.device_label,method:action}});
      if(audit.error)throw new Error('audit_insert_failed');
      // Bearer proofs are returned only in a non-cacheable response body, never URLs/logs.
      return reply(origin,{ok:true,enrollmentToken,otpTokenHash,deviceLabel:record.device_label,grantExpiresAt:grantExpires});
    }catch{
      // Never un-consume an approval. Revoke any unfinished grant and require fresh consent.
      const revoked=await admin.from('workstation_enrollment_grants').update({expires_at:new Date().toISOString()}).eq('token_hash',tokenHash).is('consumed_at',null);
      console.error('workstation enrollment issuance failed',JSON.stringify({requestId:record.id,grantRevocationConfirmed:!revoked.error}));
      return reply(origin,{error:'Enrollment issuance failed after the one-use claim. Request a fresh approval; this request will not be reused.',freshApprovalRequired:true},503);
    }

  }catch(error){
    console.error('workstation-enroll-approval: unexpected failure (details redacted)');
    return reply(origin,{error:'Unable to process workstation enrollment approval. Check status before retrying.'},500);
  }
});
