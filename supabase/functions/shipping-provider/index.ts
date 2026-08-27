import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY') || '';
const PORTAL_ORIGIN = 'https://portal.gotcracked.co';
const EASYPOST_BASE = 'https://api.easypost.com/v2';

const cors = {
  'Access-Control-Allow-Origin': PORTAL_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};
const clean = (v: unknown, max = 500) => String(v ?? '').trim().slice(0,max);
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status,headers:cors});
const cents = (v: unknown) => Math.max(0,Math.round(Number(v || 0) * 100));

function basic(apiKey:string) { return `Basic ${btoa(`${apiKey}:`)}`; }
function normalizedTracking(v:unknown){return clean(v,180).toUpperCase().replace(/[^A-Z0-9]/g,'');}
function parcel(body:any, defaults:any={}) {
  const value={...(defaults||{}),...(body||{})};
  const length=Number(value.length||10),width=Number(value.width||8),height=Number(value.height||4),weight=Number(value.weight_oz||value.weight||32);
  if (![length,width,height,weight].every(n=>Number.isFinite(n)&&n>0)) throw new Error('Package dimensions and weight must be positive numbers.');
  return {length,width,height,weight};
}
function address(source:any, name:string, phone?:string|null, email?:string|null) {
  const street1=clean(source?.line1||source?.street1,120), city=clean(source?.city,80), state=clean(source?.state,40), zip=clean(source?.postal_code||source?.zip,20), country=clean(source?.country||'US',2).toUpperCase();
  if(!street1||!city||!state||!zip) throw new Error('A complete shipping address is required before rating a shipment.');
  return {name:clean(name,80)||'Customer',company:name==='GotCracked'?'GotCracked':undefined,street1,street2:clean(source?.line2||source?.street2,120)||undefined,city,state,zip,country,phone:clean(phone,40)||undefined,email:clean(email,160)||undefined};
}
async function easy(apiKey:string,path:string,init:RequestInit={}){
  const r=await fetch(`${EASYPOST_BASE}${path}`,{...init,headers:{Authorization:basic(apiKey),'Content-Type':'application/json','Accept':'application/json',...(init.headers||{})}});
  const text=await r.text(); let data:any={}; try{data=text?JSON.parse(text):{}}catch{data={error:{message:text.slice(0,500)}}}
  if(!r.ok) throw new Error(clean(data?.error?.message||data?.message||`Shipping provider returned ${r.status}`,500));
  return data;
}

Deno.serve(async request => {
  if(request.method==='OPTIONS') return new Response('ok',{headers:cors});
  if(request.method!=='POST') return response({ok:false,error:'Method not allowed.'},405);
  if(!SERVICE_KEY) return response({ok:false,error:'Shipping service is not configured on the server.'},500);

  const authorization=request.headers.get('Authorization')||'';
  const userClient=createClient(SUPABASE_URL,ANON_KEY,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const admin=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:userError}=await userClient.auth.getUser();
  if(userError||!user) return response({ok:false,error:'Invalid Portal session.'},401);
  const {data:profile}=await admin.from('profiles').select('id,location_id,role,active').eq('id',user.id).maybeSingle();
  if(!profile?.active||!profile.location_id) return response({ok:false,error:'Active staff profile required.'},403);

  let body:any={}; try{body=await request.json()}catch{return response({ok:false,error:'Invalid request.'},400)}
  const action=clean(body.action||'status',40).toLowerCase();
  const [workflowPerm,intakePerm,settingsPerm]=await Promise.all([
    userClient.rpc('has_permission',{permission_key:'repairs.workflow'}),
    userClient.rpc('has_permission',{permission_key:'repairs.intake'}),
    userClient.rpc('has_permission',{permission_key:'settings.manage'})
  ]);
  const canShip=workflowPerm.data===true||intakePerm.data===true||profile.role==='owner'||profile.role==='manager';
  const canSettings=settingsPerm.data===true||profile.role==='owner';

  const settingsResult=await admin.from('business_settings').select('location_id,shipping_provider,shipping_provider_secret_id,shipping_provider_mode,shipping_default_parcel,shipping_require_label_confirmation,shipping_return_address,default_shipping_carrier').eq('location_id',profile.location_id).maybeSingle();
  if(settingsResult.error) return response({ok:false,error:settingsResult.error.message},500);
  const settings=settingsResult.data||{};

  if(action==='status') return response({ok:true,status:{provider:settings.shipping_provider||'easypost',mode:settings.shipping_provider_mode||'test',hasCredentials:Boolean(settings.shipping_provider_secret_id),defaultParcel:settings.shipping_default_parcel||{length:10,width:8,height:4,weight_oz:32},confirmationRequired:settings.shipping_require_label_confirmation!==false}});

  if(action==='configure'){
    if(!canSettings) return response({ok:false,error:'Settings management permission required.'},403);
    let secretId=settings.shipping_provider_secret_id||null;
    const apiKey=clean(body.api_key,300);
    if(apiKey){
      const stored=await admin.rpc('server_store_vendor_secret',{p_source_name:`shipping:easypost:${profile.location_id}`,p_secret:JSON.stringify({api_key:apiKey})});
      if(stored.error) return response({ok:false,error:stored.error.message},500);
      secretId=stored.data;
    }
    const mode=['test','production'].includes(clean(body.mode,20))?clean(body.mode,20):(settings.shipping_provider_mode||'test');
    const defaultParcel=parcel(body.default_parcel,settings.shipping_default_parcel||{});
    const update=await admin.from('business_settings').update({shipping_provider:'easypost',shipping_provider_secret_id:secretId,shipping_provider_mode:mode,shipping_default_parcel:{length:defaultParcel.length,width:defaultParcel.width,height:defaultParcel.height,weight_oz:defaultParcel.weight},shipping_require_label_confirmation:true,updated_at:new Date().toISOString()}).eq('location_id',profile.location_id);
    if(update.error) return response({ok:false,error:update.error.message},500);
    return response({ok:true,hasCredentials:Boolean(secretId),mode,manualPurchaseConfirmation:true});
  }

  if(!canShip) return response({ok:false,error:'Repair workflow permission required.'},403);
  if(!settings.shipping_provider_secret_id) return response({ok:false,error:'Connect the shipping provider in Settings before buying or rating labels.'},400);
  const secretResult=await admin.rpc('server_read_vendor_secret',{p_secret_id:settings.shipping_provider_secret_id});
  if(secretResult.error||!secretResult.data) return response({ok:false,error:'Saved shipping credential could not be read.'},500);
  let secret:any={}; try{secret=JSON.parse(secretResult.data)}catch{return response({ok:false,error:'Saved shipping credential is invalid.'},500)}
  const apiKey=clean(secret.api_key,300); if(!apiKey) return response({ok:false,error:'EasyPost API key is not configured.'},400);

  if(action==='rates'){
    const ticketId=clean(body.ticket_id,80)||null, leadId=clean(body.lead_id,80)||null;
    if(!ticketId&&!leadId) return response({ok:false,error:'Choose a repair or mail-in request.'},400);
    const direction=clean(body.direction,20)==='inbound'?'inbound':'outbound';
    let record:any=null, customer:any=null;
    if(ticketId){
      const result=await admin.from('repair_tickets').select('id,location_id,ticket_number,shipping_address,customers(first_name,last_name,phone,email)').eq('id',ticketId).eq('location_id',profile.location_id).maybeSingle();
      if(result.error||!result.data) return response({ok:false,error:'Repair ticket not found.'},404);
      record=result.data; customer=(result.data as any).customers;
    }else{
      const result=await admin.from('leads').select('id,location_id,name,phone,email,shipping_address').eq('id',leadId).eq('location_id',profile.location_id).eq('intake_method','mail_in').maybeSingle();
      if(result.error||!result.data) return response({ok:false,error:'Mail-in request not found.'},404);
      record=result.data; customer={first_name:record.name,last_name:'',phone:record.phone,email:record.email};
    }
    const storeAddress=address(settings.shipping_return_address||{},'GotCracked',Deno.env.get('STORE_PHONE')||null,Deno.env.get('STORE_EMAIL')||null);
    const customerName=ticketId?[customer?.first_name,customer?.last_name].filter(Boolean).join(' '):record.name;
    const customerAddress=address(record.shipping_address||{},customerName,customer?.phone,customer?.email);
    const fromAddress=direction==='inbound'?customerAddress:storeAddress;
    const toAddress=direction==='inbound'?storeAddress:customerAddress;
    const parcelValue=parcel(body.parcel,settings.shipping_default_parcel||{});
    const shipment=await easy(apiKey,'/shipments',{method:'POST',body:JSON.stringify({shipment:{to_address:toAddress,from_address:fromAddress,parcel:parcelValue,reference:ticketId?`GC-${String(record.ticket_number).padStart(6,'0')}`:`MAILIN-${record.id}`}})});
    const rates=(shipment.rates||[]).map((r:any)=>({id:r.id,carrier:r.carrier,service:r.service,rate:Number(r.rate||0),currency:r.currency||'USD',deliveryDays:r.delivery_days??null,deliveryDate:r.delivery_date??null})).sort((a:any,b:any)=>a.rate-b.rate).slice(0,30);
    const saved=await admin.from('shipping_shipments').insert({location_id:profile.location_id,repair_ticket_id:ticketId,lead_id:leadId,direction,provider:'easypost',provider_shipment_id:shipment.id,status:'rated',from_address:fromAddress,to_address:toAddress,parcel:{length:parcelValue.length,width:parcelValue.width,height:parcelValue.height,weight_oz:parcelValue.weight},rates,created_by:user.id}).select('id').single();
    if(saved.error) return response({ok:false,error:saved.error.message},500);
    return response({ok:true,shipmentId:saved.data.id,providerShipmentId:shipment.id,rates,manualPurchaseRequired:true});
  }

  if(action==='buy'){
    if(body.confirm_purchase!==true) return response({ok:false,error:'Label purchase requires an explicit confirmation click.'},409);
    const localId=clean(body.shipment_id,80),rateId=clean(body.rate_id,120);
    const localResult=await admin.from('shipping_shipments').select('*').eq('id',localId).eq('location_id',profile.location_id).maybeSingle();
    const local=localResult.data;
    if(localResult.error||!local) return response({ok:false,error:'Rated shipment not found.'},404);
    if(local.status!=='rated') return response({ok:false,error:'Only a rated shipment can be purchased.'},409);
    const knownRate=(local.rates||[]).find((r:any)=>r.id===rateId); if(!knownRate) return response({ok:false,error:'Choose one of the rates returned for this shipment.'},400);
    const purchased=await easy(apiKey,`/shipments/${encodeURIComponent(local.provider_shipment_id)}/buy`,{method:'POST',body:JSON.stringify({rate:{id:rateId}})});
    const label=purchased.postage_label||{}; const tracking=clean(purchased.tracking_code,180); const carrier=clean(purchased.selected_rate?.carrier||knownRate.carrier,80); const service=clean(purchased.selected_rate?.service||knownRate.service,100);
    const postage=cents(purchased.selected_rate?.rate||knownRate.rate);
    const update=await admin.from('shipping_shipments').update({provider_rate_id:rateId,carrier,service,tracking_code:tracking||null,tracking_code_normalized:normalizedTracking(tracking)||null,label_url:label.label_url||null,label_pdf_url:label.label_pdf_url||null,label_format:label.label_file_type||null,postage_cents:postage,status:'label_purchased',purchased_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',local.id);
    if(update.error) return response({ok:false,error:update.error.message},500);
    if(local.repair_ticket_id){
      const patch=local.direction==='outbound'?{outbound_carrier:carrier,outbound_tracking:tracking,shipping_label_url:label.label_pdf_url||label.label_url||null,shipping_status:'return_label_ready',package_weight_oz:Number(local.parcel?.weight_oz||0)}:{inbound_carrier:carrier,inbound_tracking:tracking,shipping_label_url:label.label_pdf_url||label.label_url||null,shipping_status:'awaiting_inbound',package_weight_oz:Number(local.parcel?.weight_oz||0)};
      await admin.from('repair_tickets').update({...patch,updated_at:new Date().toISOString()}).eq('id',local.repair_ticket_id);
    }
    return response({ok:true,shipmentId:local.id,trackingCode:tracking,carrier,service,postageCents:postage,labelUrl:label.label_pdf_url||label.label_url||null,manualPurchaseConfirmed:true});
  }

  if(action==='mark_shipped'){
    const localId=clean(body.shipment_id,80);
    const result=await admin.from('shipping_shipments').select('*').eq('id',localId).eq('location_id',profile.location_id).maybeSingle();
    const local=result.data;if(result.error||!local)return response({ok:false,error:'Shipment not found.'},404);
    if(local.direction!=='outbound'||!['label_purchased','in_transit'].includes(local.status))return response({ok:false,error:'Only an outbound purchased label can be marked shipped.'},409);
    const at=new Date().toISOString();
    await admin.from('shipping_shipments').update({status:'in_transit',shipped_at:local.shipped_at||at,updated_at:at}).eq('id',local.id);
    if(local.repair_ticket_id) await admin.from('repair_tickets').update({shipping_status:'outbound_in_transit',shipped_at:at,updated_at:at}).eq('id',local.repair_ticket_id);
    return response({ok:true,status:'in_transit',shippedAt:at});
  }

  return response({ok:false,error:'Unknown shipping action.'},400);
});
