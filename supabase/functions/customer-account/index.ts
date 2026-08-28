import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const allowedOrigins = new Set(['https://gotcracked.co','https://www.gotcracked.co','http://localhost:8788','http://127.0.0.1:8788']);
const cors = (origin:string|null) => ({'Access-Control-Allow-Origin':allowedOrigins.has(origin||'')?origin!:'https://gotcracked.co','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type,x-customer-session','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Vary':'Origin'});
const reply = (origin:string|null, body:unknown, status=200) => new Response(JSON.stringify(body),{status,headers:cors(origin)});
const digits = (v:unknown) => String(v||'').replace(/\D/g,'');
const normalizeEmail = (v:unknown) => String(v||'').trim().toLowerCase();
const encoder = new TextEncoder();
const hex = (buffer:ArrayBuffer) => [...new Uint8Array(buffer)].map(v=>v.toString(16).padStart(2,'0')).join('');
const sha = async (v:string) => hex(await crypto.subtle.digest('SHA-256',encoder.encode(v)));
const randomToken = (bytes=32) => { const data=new Uint8Array(bytes);crypto.getRandomValues(data);return btoa(String.fromCharCode(...data)).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''); };
const randomCode = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6,'0');
const clientKey = (r:Request) => r.headers.get('cf-connecting-ip') || r.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || r.headers.get('x-real-ip') || `ua:${r.headers.get('user-agent')||'unknown'}`;
const money = (c:number|null|undefined) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((Number(c)||0)/100);
class RateLimitError extends Error {}

Deno.serve(async request => {
  const origin=request.headers.get('Origin');
  if(request.method==='OPTIONS') return new Response('ok',{headers:cors(origin)});
  if(request.method!=='POST') return reply(origin,{error:'Method not allowed.'},405);
  if(!allowedOrigins.has(origin||'')) return reply(origin,{error:'Origin not allowed.'},403);
  const url=Deno.env.get('SUPABASE_URL')!;
  const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const hmacSecret=Deno.env.get('CUSTOMER_ACCOUNT_SECRET') || serviceKey;
  const hmacKey=await crypto.subtle.importKey('raw',encoder.encode(hmacSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const hmac=async(v:string)=>hex(await crypto.subtle.sign('HMAC',hmacKey,encoder.encode(v)));
  const rate=async(kind:string,key:string,limit:number,seconds:number)=>{
    const result=await admin.rpc('consume_public_rate_limit',{p_kind:kind,p_key_hash:await sha(key),p_limit:limit,p_window_seconds:seconds});
    if(result.error){console.error('customer-account rate limiter unavailable',result.error.message);throw new Error('Verification service unavailable.');}
    if(result.data!==true)throw new RateLimitError('Too many attempts. Please wait a few minutes and try again.');
  };
  const sessionFromRequest=async()=>{
    const token=String(request.headers.get('x-customer-session')||'').trim();
    if(token.length<30)return null;
    const tokenHash=await sha(token);
    const result=await admin.from('customer_access_sessions').select('id,customer_ids,verified_email,lookup_kind,expires_at,revoked_at').eq('token_hash',tokenHash).maybeSingle();
    const session=result.data;
    if(result.error||!session||session.revoked_at||new Date(session.expires_at).getTime()<=Date.now())return null;
    await admin.from('customer_access_sessions').update({last_seen_at:new Date().toISOString()}).eq('id',session.id);
    return session;
  };
  const accountBundle=async(session:any)=>{
    const customerIds=(session.customer_ids||[]).filter(Boolean);
    const customerResult=await admin.from('customers').select('id,first_name,last_name,email,phone,preferred_contact').in('id',customerIds);
    if(customerResult.error)throw customerResult.error;
    const customers=customerResult.data||[];
    const repairResult=await admin.from('repair_tickets').select('id,ticket_number,location_id,customer_id,status,customer_issue,estimate_cents,approved_at,promised_at,checked_in_at,completed_at,pickup_at,created_at,updated_at,public_notes,warranty_expires_at,subtotal_cents,tax_cents,total_cents,intake_method,shipping_status,outbound_carrier,outbound_tracking,shipped_at,delivered_at,payment_status,amount_paid_cents,paid_at,ready_for_pickup_at,parts_status,devices(manufacturer,model,category,color)').in('customer_id',customerIds).order('created_at',{ascending:false}).limit(100);
    if(repairResult.error)throw repairResult.error;
    const repairs=repairResult.data||[];
    const ticketIds=repairs.map((r:any)=>r.id);
    let receipts:any[]=[];let events:any[]=[];
    if(ticketIds.length){
      const [receiptResult,eventResult]=await Promise.all([
        admin.from('receipts').select('id,receipt_number,ticket_id,ticket_number,business_date,device_description,subtotal_cents,tax_cents,total_cents,amount_paid_cents,payment_method,line_items,created_at').in('ticket_id',ticketIds).order('created_at',{ascending:false}),
        admin.from('ticket_events').select('id,ticket_id,event_type,message,created_at,visibility').in('ticket_id',ticketIds).in('visibility',['customer','public']).order('created_at',{ascending:true})
      ]);
      if(receiptResult.error)throw receiptResult.error;if(eventResult.error)throw eventResult.error;
      receipts=receiptResult.data||[];events=eventResult.data||[];
    }
    const receiptByTicket=new Map(receipts.map((r:any)=>[r.ticket_id,r]));
    const eventsByTicket=new Map<string,any[]>();for(const e of events){if(!eventsByTicket.has(e.ticket_id))eventsByTicket.set(e.ticket_id,[]);eventsByTicket.get(e.ticket_id)!.push({type:e.event_type,message:e.message,createdAt:e.created_at});}
    const safeRepairs=repairs.map((r:any)=>{
      const total=Math.max(0,Number(r.total_cents||0));const estimate=Math.max(0,Number(r.estimate_cents||0));const paid=Math.max(0,Number(r.amount_paid_cents||0));const due=Math.max(0,total-paid);
      const receipt:any=receiptByTicket.get(r.id)||null;
      return {id:r.id,ticket:`GC-${String(r.ticket_number).padStart(6,'0')}`,ticketNumber:r.ticket_number,status:r.status,issue:r.customer_issue,device:r.devices||null,estimateCents:estimate,totalCents:total,subtotalCents:Math.max(0,Number(r.subtotal_cents||0)),taxCents:Math.max(0,Number(r.tax_cents||0)),amountPaidCents:paid,balanceDueCents:due,paymentStatus:r.payment_status,approvedAt:r.approved_at,promisedAt:r.promised_at,checkedInAt:r.checked_in_at,completedAt:r.completed_at,pickupAt:r.pickup_at,readyForPickupAt:r.ready_for_pickup_at,updatedAt:r.updated_at,publicNotes:r.public_notes,warrantyExpiresAt:r.warranty_expires_at,intakeMethod:r.intake_method,partsStatus:r.parts_status,shippingStatus:r.shipping_status,outboundCarrier:r.outbound_carrier,outboundTracking:r.outbound_tracking,shippedAt:r.shipped_at,deliveredAt:r.delivered_at,events:eventsByTicket.get(r.id)||[],receipt:receipt?{id:receipt.id,number:receipt.receipt_number,businessDate:receipt.business_date,deviceDescription:receipt.device_description,subtotalCents:receipt.subtotal_cents,taxCents:receipt.tax_cents,totalCents:receipt.total_cents,amountPaidCents:receipt.amount_paid_cents,paymentMethod:receipt.payment_method,lineItems:receipt.line_items,createdAt:receipt.created_at}:null,actions:{canApprove:r.status==='awaiting_approval',canDecline:r.status==='awaiting_approval',canPay:due>0&&['repaired','ready_for_pickup','quality_inspection','sale_complete'].includes(String(r.status))}};
    });
    const primary=customers[0]||{};
    return {customer:{firstName:primary.first_name||'',lastName:primary.last_name||'',email:session.verified_email,preferredContact:primary.preferred_contact||'email'},repairs:safeRepairs,onlinePayment:{available:false,provider:null,message:'Secure online card payment is not connected yet. Your balance is shown here and will become payable from this screen when the verified payment provider is enabled.'},meta:{sessionExpiresAt:session.expires_at,repairCount:safeRepairs.length}};
  };

  try{
    const body=await request.json().catch(()=>({}));
    const action=String(body?.action||'').trim();
    const ip=clientKey(request);
    if(action==='request_code'){
      await rate('customer-account-ip',ip,12,900);
      const raw=String(body?.identifier||'').trim().slice(0,254);
      const kind=raw.includes('@')?'email':'phone';
      const normalized=kind==='email'?normalizeEmail(raw):digits(raw);
      if(kind==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))return reply(origin,{error:'Enter a valid email address or phone number.'},400);
      if(kind==='phone'&&normalized.length<7)return reply(origin,{error:'Enter a valid email address or phone number.'},400);
      await rate('customer-account-lookup',normalized,5,900);
      const lookupHash=await sha(`${kind}:${normalized}`);
      let query=admin.from('customers').select('id,email,email_normalized,phone_normalized,first_name,last_name');
      query=kind==='email'?query.eq('email_normalized',normalized):query.eq('phone_normalized',normalized);
      const found=await query.limit(50); if(found.error)throw found.error;
      const rows=found.data||[]; let customerIds:string[]=[];let destination='';
      if(rows.length){
        if(kind==='email'){destination=normalized;customerIds=rows.filter((r:any)=>r.email_normalized===normalized).map((r:any)=>r.id);}
        else { const candidate=rows.map((r:any)=>normalizeEmail(r.email)).find((v:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))||''; if(candidate){destination=candidate;customerIds=rows.filter((r:any)=>normalizeEmail(r.email)===candidate).map((r:any)=>r.id);} }
      }
      const deliverable=Boolean(destination&&customerIds.length);
      const challengeId=crypto.randomUUID();const code=randomCode();const expiresAt=new Date(Date.now()+10*60*1000).toISOString();
      const ids=deliverable?customerIds:[crypto.randomUUID()]; const codeHash=await hmac(`${challengeId}|${code}`);
      const insert=await admin.from('customer_access_challenges').insert({id:challengeId,lookup_hash:lookupHash,lookup_kind:kind,customer_ids:ids,destination_email:deliverable?destination:'unavailable@invalid.local',code_hash:codeHash,expires_at:expiresAt});
      if(insert.error)throw insert.error;
      if(deliverable){
        const apiKey=Deno.env.get('RESEND_API_KEY');
        if(apiKey){
          const from=Deno.env.get('CUSTOMER_FROM_EMAIL')||Deno.env.get('RECEIPT_FROM_EMAIL')||'GotCracked <hello@gotcracked.co>';
          const html=`<!doctype html><html><body style="margin:0;background:#07111f;font-family:Arial,sans-serif;color:#eaf2ff"><div style="max-width:560px;margin:0 auto;padding:34px 20px"><div style="background:#0d1a2c;border:1px solid #243953;border-radius:18px;padding:28px"><div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#82b7ff">GotCracked Customer Account</div><h1 style="margin:10px 0 8px;font-size:24px">Your sign-in code</h1><p style="color:#b8c8dc;line-height:1.6">Use this code to securely view your repair status, history, warranty, receipts, approvals, and balance.</p><div style="font-size:34px;letter-spacing:.22em;font-weight:800;margin:24px 0;color:#fff">${code}</div><p style="color:#b8c8dc">This code expires in 10 minutes. If you did not request it, you can ignore this email.</p></div></div></body></html>`;
          const sent=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({from,to:[destination],subject:'Your GotCracked sign-in code',html})});
          if(!sent.ok)console.error('customer-account email delivery failed',sent.status,await sent.text());
        } else console.error('customer-account RESEND_API_KEY not configured');
      }
      return reply(origin,{ok:true,challengeId,expiresIn:600,message:'If a matching GotCracked customer profile is available, a verification code has been sent to its verified email.'});
    }

    if(action==='verify_code'){
      await rate('customer-account-verify-ip',ip,30,900);
      const challengeId=String(body?.challengeId||'');const code=digits(body?.code).slice(0,6);
      if(!/^[0-9a-f-]{36}$/i.test(challengeId)||code.length!==6)return reply(origin,{error:'Enter the six-digit verification code.'},400);
      const result=await admin.from('customer_access_challenges').select('*').eq('id',challengeId).maybeSingle();
      if(result.error)throw result.error;const challenge=result.data;
      if(!challenge||challenge.consumed_at||new Date(challenge.expires_at).getTime()<=Date.now())return reply(origin,{error:'That code is invalid or expired. Request a new code.'},401);
      await rate('customer-account-challenge',challengeId,8,900);
      if(Number(challenge.attempts||0)>=6)return reply(origin,{error:'Too many incorrect codes. Request a new code.'},429);
      const expected=await hmac(`${challengeId}|${code}`);
      if(expected!==challenge.code_hash){await admin.from('customer_access_challenges').update({attempts:Number(challenge.attempts||0)+1}).eq('id',challengeId);return reply(origin,{error:'That code is invalid or expired. Request a new code.'},401);}
      if(String(challenge.destination_email).endsWith('@invalid.local'))return reply(origin,{error:'That code is invalid or expired. Request a new code.'},401);
      const now=new Date().toISOString();await admin.from('customer_access_challenges').update({consumed_at:now}).eq('id',challengeId).is('consumed_at',null);
      const token=randomToken();const tokenHash=await sha(token);const expiresAt=new Date(Date.now()+7*24*60*60*1000).toISOString();
      const save=await admin.from('customer_access_sessions').insert({token_hash:tokenHash,customer_ids:challenge.customer_ids,verified_email:normalizeEmail(challenge.destination_email),lookup_kind:challenge.lookup_kind,expires_at:expiresAt}).select('id').single();
      if(save.error)throw save.error;
      return reply(origin,{ok:true,sessionToken:token,expiresAt});
    }
    if(action==='profile'){
      const session=await sessionFromRequest();if(!session)return reply(origin,{error:'Your customer session has expired. Sign in again.'},401);
      return reply(origin,{ok:true,...await accountBundle(session)});
    }

    if(action==='approve_estimate'||action==='decline_estimate'){
      const session=await sessionFromRequest();if(!session)return reply(origin,{error:'Your customer session has expired. Sign in again.'},401);
      await rate('customer-account-action',`${session.id}|${ip}`,20,900);
      const ticketId=String(body?.ticketId||'');
      const owned=await admin.from('repair_tickets').select('id,customer_id,status,ticket_number,estimate_cents,total_cents').eq('id',ticketId).in('customer_id',session.customer_ids).maybeSingle();
      if(owned.error)throw owned.error;if(!owned.data)return reply(origin,{error:'Repair not found.'},404);
      if(owned.data.status!=='awaiting_approval')return reply(origin,{error:'This repair is no longer waiting for approval. Refresh your account for the latest status.'},409);
      const approving=action==='approve_estimate';const nextStatus=approving?'awaiting_repair':'customer_declined';const now=new Date().toISOString();
      const update:any={status:nextStatus,updated_at:now};if(approving)update.approved_at=now;
      const saved=await admin.from('repair_tickets').update(update).eq('id',ticketId).eq('status','awaiting_approval').select('id').maybeSingle();
      if(saved.error)throw saved.error;if(!saved.data)return reply(origin,{error:'The repair changed while you were responding. Refresh and try again.'},409);
      await admin.from('ticket_events').insert({ticket_id:ticketId,actor_user_id:null,event_type:'customer_update',message:approving?`Customer approved the repair estimate (${money(owned.data.estimate_cents||owned.data.total_cents)}).`:'Customer declined the repair estimate through GotCracked Account.',visibility:'customer'});
      return reply(origin,{ok:true,message:approving?'Estimate approved. GotCracked can continue with the repair.':'Repair declined. GotCracked has been notified.'});
    }

    if(action==='logout'){
      const token=String(request.headers.get('x-customer-session')||'').trim();
      if(token)await admin.from('customer_access_sessions').update({revoked_at:new Date().toISOString()}).eq('token_hash',await sha(token));
      return reply(origin,{ok:true});
    }
    return reply(origin,{error:'Unknown action.'},400);
  }catch(error){
    console.error('customer-account',error instanceof Error?error.message:String(error));
    if(error instanceof RateLimitError)return reply(origin,{error:error.message},429);
    return reply(origin,{error:'The GotCracked customer account is temporarily unavailable. Please try again.'},500);
  }
});
