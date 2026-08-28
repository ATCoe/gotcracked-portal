import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type':'application/json', 'Cache-Control':'no-store' }
});
const clean = (value: unknown) => String(value ?? '').trim();
const uuid = (value: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean(value));
const safeUrl = (value: unknown) => {
  try { const u=new URL(clean(value)); return u.protocol==='https:' ? u.href : ''; } catch { return ''; }
};

Deno.serve(async request => {
  if(request.method!=='POST') return json({error:'Method not allowed.'},405);
  const url=Deno.env.get('SUPABASE_URL')!;
  const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const auth=clean(request.headers.get('Authorization'));
  if(auth!==`Bearer ${serviceKey}`) return json({error:'Service authorization required.'},401);
  const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});

  try {
    const body=await request.json().catch(()=>({}));
    const action=clean(body.action);
    if(action!=='create_checkout') return json({error:'Unknown payment gateway action.'},400);
    const ticketId=clean(body.ticketId);
    if(!uuid(ticketId)) return json({error:'A valid repair is required.'},400);

    const ticketResult=await admin.from('repair_tickets').select('id,ticket_number,location_id,customer_id,status,total_cents,amount_paid_cents,payment_status,customers(first_name,last_name,email,phone),devices(manufacturer,model,category)').eq('id',ticketId).maybeSingle();
    if(ticketResult.error) throw ticketResult.error;
    const ticket:any=ticketResult.data;
    if(!ticket) return json({error:'Repair not found.'},404);

    const [settingsResult,paidResult]=await Promise.all([
      admin.from('business_settings').select('currency_code,online_payment_provider_key,customer_online_payments_enabled,customer_online_partial_payments,customer_online_payment_stages,payment_checkout_expiry_minutes').eq('location_id',ticket.location_id).maybeSingle(),
      admin.from('payment_requests').select('amount_verified_cents,status').eq('ticket_id',ticket.id).in('status',['partial','verified'])
    ]);
    if(settingsResult.error) throw settingsResult.error;
    if(paidResult.error) throw paidResult.error;
    const settings:any=settingsResult.data;
    const provider=clean(settings?.online_payment_provider_key).toLowerCase();
    if(!settings?.customer_online_payments_enabled||!provider) return json({error:'Online payment is not connected yet.',code:'PAYMENT_PROVIDER_NOT_CONNECTED',architectureReady:true},409);

    const connectionResult=await admin.from('payment_provider_connections').select('id,provider_key,display_name,connection_status,environment,merchant_reference,public_configuration,capabilities').eq('location_id',ticket.location_id).eq('provider_key',provider).maybeSingle();
    if(connectionResult.error) throw connectionResult.error;
    const connection:any=connectionResult.data;
    if(!connection||connection.connection_status!=='connected') return json({error:'Online payment is not connected yet.',code:'PAYMENT_PROVIDER_NOT_CONNECTED',architectureReady:true,provider},409);

    const stages=Array.isArray(settings?.customer_online_payment_stages)?settings.customer_online_payment_stages:[];
    if(!stages.includes(String(ticket.status))) return json({error:'This repair is not eligible for online payment yet.',code:'PAYMENT_STAGE_NOT_ELIGIBLE'},409);
    const requestPaid=(paidResult.data||[]).reduce((sum:any,row:any)=>sum+Math.max(0,Number(row.amount_verified_cents||0)),0);
    const paid=Math.max(requestPaid,Math.max(0,Number(ticket.amount_paid_cents||0)));
    const balance=Math.max(0,Number(ticket.total_cents||0)-paid);
    if(balance<=0) return json({error:'This repair has no remaining balance.',code:'NO_BALANCE_DUE'},409);
    const amount=Math.round(Number(body.amountCents||balance));
    if(amount<=0||amount>balance) return json({error:'Invalid payment amount.'},400);
    if(!settings.customer_online_partial_payments&&amount!==balance) return json({error:'Partial online payments are not enabled.'},409);

    const bridgeUrl=safeUrl(Deno.env.get('PAYMENT_BRIDGE_URL'));
    const bridgeToken=clean(Deno.env.get('PAYMENT_BRIDGE_TOKEN'));
    if(!bridgeUrl||!bridgeToken) return json({error:'Payment adapter is ready for connection but provider credentials/API are not installed yet.',code:'PAYMENT_ADAPTER_NOT_CONFIGURED',architectureReady:true,provider},503);

    const requestResult=await admin.rpc('ensure_online_payment_request',{target_ticket:ticket.id,target_provider:provider,requested_amount_cents:amount});
    if(requestResult.error) throw requestResult.error;
    const paymentRequest:any=requestResult.data;
    const idempotencyKey=`gc-checkout-${paymentRequest.id}`;
    const returnUrl=`https://gotcracked.co/account.html?payment=return&repair=${encodeURIComponent(ticket.id)}`;
    const cancelUrl=`https://gotcracked.co/account.html?payment=cancelled&repair=${encodeURIComponent(ticket.id)}`;

    const customer=Array.isArray(ticket.customers)?ticket.customers[0]:ticket.customers||{};
    const device=Array.isArray(ticket.devices)?ticket.devices[0]:ticket.devices||{};
    const bridgeResponse=await fetch(bridgeUrl,{
      method:'POST',
      headers:{'Authorization':`Bearer ${bridgeToken}`,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},
      body:JSON.stringify({
        version:'2026-08-28',action:'create_checkout',provider,idempotencyKey,
        paymentRequestId:paymentRequest.id,ticketId:ticket.id,ticketNumber:ticket.ticket_number,
        amountCents:amount,currency:String(settings.currency_code||'USD').toUpperCase(),
        returnUrl,cancelUrl,
        customer:{name:[customer.first_name,customer.last_name].filter(Boolean).join(' '),email:customer.email||null,phone:customer.phone||null},
        description:[device.manufacturer,device.model].filter(Boolean).join(' ')||device.category||`GotCracked repair GC-${String(ticket.ticket_number).padStart(6,'0')}`,
        merchantReference:connection.merchant_reference||null,
        publicConfiguration:connection.public_configuration||{},
        metadata:{source:'gotcracked_customer_account',locationId:ticket.location_id}
      })
    });
    const bridge:any=await bridgeResponse.json().catch(()=>({}));
    if(!bridgeResponse.ok) {
      console.error('payment bridge create_checkout failed',provider,bridgeResponse.status,bridge?.code||'');
      return json({error:'Secure checkout could not be started. Please try again.',code:bridge?.code||'PAYMENT_BRIDGE_ERROR'},502);
    }
    const checkoutUrl=safeUrl(bridge.checkoutUrl);
    const providerSessionId=clean(bridge.providerSessionId);
    if(!checkoutUrl||!providerSessionId) throw new Error('Payment bridge returned an invalid checkout session.');

    const expiresAt=bridge.expiresAt ? new Date(bridge.expiresAt).toISOString() : new Date(Date.now()+Number(settings.payment_checkout_expiry_minutes||30)*60000).toISOString();
    const sessionResult=await admin.from('payment_checkout_sessions').upsert({
      payment_request_id:paymentRequest.id,location_id:ticket.location_id,provider_connection_id:connection.id,
      provider_key:provider,provider_session_id:providerSessionId,provider_payment_id:clean(bridge.providerPaymentId)||null,
      status:'pending',amount_cents:amount,currency_code:String(settings.currency_code||'USD').toUpperCase(),
      checkout_url:checkoutUrl,return_url:returnUrl,cancel_url:cancelUrl,idempotency_key:idempotencyKey,expires_at:expiresAt,
      metadata:{source:'customer_account',bridgeVersion:'2026-08-28'}
    },{onConflict:'idempotency_key'}).select('id,status,expires_at').single();
    if(sessionResult.error) throw sessionResult.error;
    await admin.from('payment_requests').update({status:'awaiting_external_confirmation',updated_at:new Date().toISOString()}).eq('id',paymentRequest.id).eq('status','pending');
    return json({ok:true,checkoutUrl,paymentRequestId:paymentRequest.id,checkoutSessionId:sessionResult.data.id,provider,providerLabel:connection.display_name,expiresAt:sessionResult.data.expires_at});
  } catch(error) {
    console.error('payment-gateway',error instanceof Error?error.message:String(error));
    return json({error:'Secure payment checkout is temporarily unavailable.'},500);
  }
});
