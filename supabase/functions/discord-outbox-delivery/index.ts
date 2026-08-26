import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const portalUrl = (Deno.env.get('PORTAL_URL') || 'https://portal.gotcracked.co').replace(/\/$/, '');
const admin = () => createClient(supabaseUrl,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const text = (value: unknown, fallback='—') => String(value ?? '').trim() || fallback;
const titleCase = (value: unknown) => String(value || '').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map(v=>v.toString(16).padStart(2,'0')).join('');

async function signatureFor(secret: string, message: string) {
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(message)));
}
function safeEqual(a:string,b:string){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}

function channelFor(entityType:string){
  if(entityType==='work_order') return Deno.env.get('DISCORD_WORK_ORDER_CHANNEL_ID') || Deno.env.get('DISCORD_LEAD_CHANNEL_ID');
  if(entityType==='appointment') return Deno.env.get('DISCORD_APPOINTMENT_CHANNEL_ID') || Deno.env.get('DISCORD_LEAD_CHANNEL_ID');
  return Deno.env.get('DISCORD_LEAD_CHANNEL_ID');
}

function discordPayload(row:any){
  const p=row.payload||{};
  const url=p.portal_url || `${portalUrl}/${p.portal_hash || ''}`;
  const fields:any[]=[];
  let title='GotCracked update';
  let description=text(p.issue || p.service_requested || p.intake_summary || p.last_contact_note,'Portal activity');
  let color=0x0a8fff;

  if(row.entity_type==='work_order'){
    title=`${row.event_type==='work_order_created'?'New work order':'Work order update'} · ${p.ticket_number?`GC-${String(p.ticket_number).padStart(6,'0')}`:'GotCracked'}`;
    fields.push({name:'Customer',value:text(p.customer_name),inline:true},{name:'Device',value:text([p.manufacturer,p.model].filter(Boolean).join(' ')),inline:true},{name:'Status',value:titleCase(p.status),inline:true});
    if(p.previous_status)fields.push({name:'Previous status',value:titleCase(p.previous_status),inline:true});
    color=0x2f80ed;
  }else if(row.entity_type==='appointment'){
    title=`${row.event_type==='appointment_created'?'New appointment':'Appointment update'} · ${text(p.customer_name,'Customer')}`;
    fields.push({name:'Requested service',value:text(p.service_requested),inline:false},{name:'Date / time',value:text(p.starts_at || [p.preferred_date,p.preferred_time].filter(Boolean).join(' · ')),inline:true},{name:'Status',value:titleCase(p.status),inline:true});
    color=0x7b61ff;
  }else{
    title=`${row.event_type==='lead_created'?'New lead':'Lead update'} · ${text(p.name,'Customer')}`;
    fields.push({name:'Contact',value:text([p.phone,p.email].filter(Boolean).join(' · ')),inline:false},{name:'Device',value:text([p.manufacturer,p.model].filter(Boolean).join(' ')),inline:true},{name:'Stage',value:titleCase(p.pipeline_status||p.status),inline:true});
    color=0x0a8fff;
  }

  const buttons:any[]=[{type:2,style:5,label:row.entity_type==='work_order'?'Open Work Order':row.entity_type==='appointment'?'Open Appointment':'Open Lead',url}];
  if(p.lead_url && row.entity_type==='appointment') buttons.push({type:2,style:5,label:'Open Lead',url:p.lead_url});
  return {allowed_mentions:{parse:[]},embeds:[{title,description:description.slice(0,3500),color,fields,footer:{text:`GotCracked · ${titleCase(row.event_type)}`},timestamp:new Date(row.created_at).toISOString()}],components:[{type:1,components:buttons}]};
}

Deno.serve(async request=>{
  if(request.method!=='POST')return new Response('Not found',{status:404});
  try{
    const body=await request.json();
    const id=String(body.outbox_id||'');
    const ts=Number(body.ts||0);
    const supplied=request.headers.get('x-gc-signature')||'';
    if(!id||!Number.isFinite(ts)||Math.abs(Math.floor(Date.now()/1000)-ts)>300)return new Response('invalid signature',{status:401});
    const db=admin();
    const secretResult=await db.from('internal_runtime_secrets').select('secret').eq('key','discord_outbox_signing').maybeSingle();
    if(secretResult.error||!secretResult.data?.secret)return new Response('server secret missing',{status:500});
    const expected=await signatureFor(secretResult.data.secret,`${id}:${ts}`);
    if(!safeEqual(expected,supplied))return new Response('invalid signature',{status:401});

    const rowResult=await db.from('discord_notification_outbox').select('*').eq('id',id).maybeSingle();
    if(rowResult.error)throw rowResult.error;
    const row=rowResult.data;
    if(!row||row.delivered_at)return new Response(JSON.stringify({ok:true,skipped:true}),{headers:{'Content-Type':'application/json'}});
    const token=Deno.env.get('DISCORD_BOT_TOKEN');
    const channelId=channelFor(row.entity_type);
    if(!token||!channelId)throw new Error(`Discord credentials/channel are not configured for ${row.entity_type}.`);

    const response=await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`,{method:'POST',headers:{Authorization:`Bot ${token}`,'Content-Type':'application/json'},body:JSON.stringify(discordPayload(row))});
    if(!response.ok)throw new Error(`Discord ${response.status}: ${(await response.text()).slice(0,500)}`);
    await db.from('discord_notification_outbox').update({delivered_at:new Date().toISOString(),attempts:Number(row.attempts||0)+1,last_error:null}).eq('id',id);
    return new Response(JSON.stringify({ok:true}),{headers:{'Content-Type':'application/json'}});
  }catch(error){
    console.error(error);
    try{
      const body=await request.clone().json().catch(()=>({}));
      if(body.outbox_id){const db=admin();const row=await db.from('discord_notification_outbox').select('attempts').eq('id',body.outbox_id).maybeSingle();await db.from('discord_notification_outbox').update({attempts:Number(row.data?.attempts||0)+1,last_error:String(error instanceof Error?error.message:error).slice(0,1000)}).eq('id',body.outbox_id);}
    }catch{}
    return new Response(JSON.stringify({error:error instanceof Error?error.message:'Delivery failed'}),{status:502,headers:{'Content-Type':'application/json'}});
  }
});
