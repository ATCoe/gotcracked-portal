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

function payload(row:any){
  const p=row.payload||{};
  const url=p.portal_url || `${portalUrl}/${p.portal_hash || ''}`;
  const fields:any[]=[
    {name:'Customer',value:text(p.customer_name),inline:true},
    {name:'Device',value:text([p.manufacturer,p.model].filter(Boolean).join(' ')),inline:true},
    {name:'Status',value:titleCase(p.status),inline:true}
  ];
  if(p.previous_status) fields.push({name:'Previous status',value:titleCase(p.previous_status),inline:true});
  return {
    allowed_mentions:{parse:[]},
    embeds:[{
      title:`${row.event_type==='work_order_created'?'New work order':'Work order update'} · ${p.ticket_number?`GC-${String(p.ticket_number).padStart(6,'0')}`:'GotCracked'}`,
      description:text(p.issue || p.intake_summary || 'Work order activity').slice(0,3500),
      color:0x2f80ed,
      fields,
      footer:{text:`GotCracked · ${titleCase(row.event_type)}`},
      timestamp:new Date(row.created_at).toISOString()
    }],
    components:[{type:1,components:[{type:2,style:5,label:'Open Work Order',url}]}]
  };
}

Deno.serve(async request=>{
  if(request.method!=='POST') return new Response('Not found',{status:404});
  let id='';
  try{
    const body=await request.json();
    id=String(body.outbox_id||'');
    const ts=Number(body.ts||0);
    const supplied=request.headers.get('x-gc-signature')||'';
    if(!id||!Number.isFinite(ts)||Math.abs(Math.floor(Date.now()/1000)-ts)>300) return new Response('invalid signature',{status:401});
    const db=admin();
    const secretResult=await db.from('internal_runtime_secrets').select('secret').eq('key','discord_outbox_signing').maybeSingle();
    if(secretResult.error||!secretResult.data?.secret) return new Response('server secret missing',{status:500});
    const expected=await signatureFor(secretResult.data.secret,`${id}:${ts}`);
    if(!safeEqual(expected,supplied)) return new Response('invalid signature',{status:401});

    const rowResult=await db.from('discord_notification_outbox').select('*').eq('id',id).maybeSingle();
    if(rowResult.error) throw rowResult.error;
    const row=rowResult.data;
    if(!row||row.delivered_at||row.entity_type!=='work_order') return new Response(JSON.stringify({ok:true,skipped:true}),{headers:{'Content-Type':'application/json'}});
    const token=Deno.env.get('DISCORD_BOT_TOKEN');
    const channelId=Deno.env.get('DISCORD_WORK_ORDER_CHANNEL_ID') || Deno.env.get('DISCORD_LEAD_CHANNEL_ID');
    if(!token||!channelId) throw new Error('Discord work-order delivery is not configured.');

    const response=await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`,{method:'POST',headers:{Authorization:`Bot ${token}`,'Content-Type':'application/json'},body:JSON.stringify(payload(row))});
    if(!response.ok) throw new Error(`Discord ${response.status}: ${(await response.text()).slice(0,500)}`);
    await db.from('discord_notification_outbox').update({delivered_at:new Date().toISOString(),attempts:Number(row.attempts||0)+1,last_error:null}).eq('id',id);
    return new Response(JSON.stringify({ok:true}),{headers:{'Content-Type':'application/json'}});
  }catch(error){
    console.error(error);
    if(id){try{const db=admin();const row=await db.from('discord_notification_outbox').select('attempts').eq('id',id).maybeSingle();await db.from('discord_notification_outbox').update({attempts:Number(row.data?.attempts||0)+1,last_error:String(error instanceof Error?error.message:error).slice(0,1000)}).eq('id',id);}catch{}}
    return new Response(JSON.stringify({error:error instanceof Error?error.message:'Delivery failed'}),{status:502,headers:{'Content-Type':'application/json'}});
  }
});
