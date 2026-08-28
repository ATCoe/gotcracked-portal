import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const clean=(value:unknown)=>String(value??'').trim();
const uuid=(value:unknown)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean(value));
const hex=(buffer:ArrayBuffer)=>[...new Uint8Array(buffer)].map(v=>v.toString(16).padStart(2,'0')).join('');
const sha=async(value:string)=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
const secureEqual=(a:string,b:string)=>{
  if(a.length!==b.length)return false;
  let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;
};

Deno.serve(async request=>{
  if(request.method!=='POST')return json({error:'Method not allowed.'},405);
  const webhookSecret=clean(Deno.env.get('PAYMENT_BRIDGE_WEBHOOK_SECRET'));
  if(!webhookSecret)return json({error:'Payment webhook adapter is not configured.'},503);
  const raw=await request.text();
  const supplied=clean(request.headers.get('x-gotcracked-signature')).replace(/^sha256=/i,'').toLowerCase();
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(webhookSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const expected=hex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(raw)));
  if(!supplied||!secureEqual(supplied,expected))return json({error:'Invalid webhook signature.'},401);

  const body:any=JSON.parse(raw||'{}');
  const provider=clean(body.provider).toLowerCase();
  const eventId=clean(body.eventId);
  const eventType=clean(body.type);
  const paymentRequestId=clean(body.paymentRequestId);
  if(!provider||!eventId||!uuid(paymentRequestId))return json({error:'Invalid payment event.'},400);

  const url=Deno.env.get('SUPABASE_URL')!;
  const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  try{
    const reqResult=await admin.from('payment_requests').select('id,location_id,provider,status').eq('id',paymentRequestId).maybeSingle();
    if(reqResult.error)throw reqResult.error;
    const paymentRequest:any=reqResult.data;
    if(!paymentRequest||clean(paymentRequest.provider).toLowerCase()!==provider)return json({error:'Payment request/provider mismatch.'},400);
    const connResult=await admin.from('payment_provider_connections').select('connection_status').eq('location_id',paymentRequest.location_id).eq('provider_key',provider).maybeSingle();
    if(connResult.error)throw connResult.error;
    if(connResult.data?.connection_status!=='connected')return json({error:'Payment provider is not active.'},409);

    const payloadSha=await sha(raw);
    const amount=Math.round(Number(body.amountCents||0));
    const transactionId=clean(body.transactionId);
    if(!['payment.succeeded','refund.succeeded'].includes(eventType)){
      await admin.from('payment_provider_events').upsert({location_id:paymentRequest.location_id,provider_key:provider,provider_event_id:eventId,event_type:eventType||'unknown',payment_request_id:paymentRequestId,payload_sha256:payloadSha,signature_verified:true,processing_status:'ignored',metadata:{bridgeVersion:clean(body.version)||null},processed_at:new Date().toISOString()},{onConflict:'provider_key,provider_event_id'});
      return json({ok:true,ignored:true});
    }
    if(amount<=0||!transactionId)return json({error:'Payment event amount and transaction are required.'},400);

    let occurredAt=new Date().toISOString();
    if(body.occurredAt){const parsed=new Date(body.occurredAt);if(!Number.isNaN(parsed.getTime()))occurredAt=parsed.toISOString();}
    const metadata={payload_sha256:payloadSha,bridgeVersion:clean(body.version)||null,providerMetadata:body.metadata&&typeof body.metadata==='object'?body.metadata:{}};
    let result;
    if(eventType==='payment.succeeded'){
      result=await admin.rpc('apply_provider_payment',{
        target_provider:provider,target_event_id:eventId,target_request:paymentRequestId,target_transaction_id:transactionId,target_amount_cents:amount,
        target_currency:clean(body.currency||'USD').toUpperCase(),target_payment_method:clean(body.paymentMethod||'online_checkout'),
        target_card_brand:clean(body.cardBrand)||null,target_card_last4:/^\d{4}$/.test(clean(body.cardLast4))?clean(body.cardLast4):null,
        target_fee_cents:Number.isFinite(Number(body.feeCents))?Math.max(0,Math.round(Number(body.feeCents))):null,
        target_reference:clean(body.reference)||transactionId,target_provider_session_id:clean(body.providerSessionId)||null,target_occurred_at:occurredAt,target_metadata:metadata
      });
    }else{
      result=await admin.rpc('apply_provider_refund',{
        target_provider:provider,target_event_id:eventId,target_request:paymentRequestId,target_refund_transaction_id:transactionId,target_amount_cents:amount,
        target_currency:clean(body.currency||'USD').toUpperCase(),target_reference:clean(body.reference)||transactionId,target_occurred_at:occurredAt,target_metadata:metadata
      });
    }
    if(result.error)throw result.error;
    return json({ok:true,eventId,result:result.data});

  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    console.error('payment-webhook',provider,eventId,message);
    try{
      await admin.from('payment_provider_events').upsert({location_id:null,provider_key:provider,provider_event_id:eventId,event_type:eventType||'error',payment_request_id:uuid(paymentRequestId)?paymentRequestId:null,payload_sha256:await sha(raw),signature_verified:true,processing_status:'error',error_message:message.slice(0,500),metadata:{bridgeVersion:clean(body.version)||null}},{onConflict:'provider_key,provider_event_id'});
    }catch{}
    return json({error:'Payment event could not be processed.'},500);
  }
});
