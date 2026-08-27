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

function workOrderPayload(row:any){
  const p=row.payload||{};
  const url=p.portal_url || `${portalUrl}/${p.portal_hash || ''}`;
  const fields:any[]=[
    {name:'Customer',value:text(p.customer_name),inline:true},
    {name:'Device',value:text([p.manufacturer,p.model].filter(Boolean).join(' ')),inline:true},
    {name:'Status',value:titleCase(p.status),inline:true}
  ];
  if(p.previous_status) fields.push({name:'Previous status',value:titleCase(p.previous_status),inline:true});
  return {allowed_mentions:{parse:[]},embeds:[{title:`${row.event_type==='work_order_created'?'New work order':'Work order update'} · ${p.ticket_number?`GC-${String(p.ticket_number).padStart(6,'0')}`:'GotCracked'}`,description:text(p.issue || p.intake_summary || 'Work order activity').slice(0,3500),color:0x2f80ed,fields,footer:{text:`GotCracked · ${titleCase(row.event_type)}`},timestamp:new Date(row.created_at).toISOString()}],components:[{type:1,components:[{type:2,style:5,label:'Open Work Order',url}]}]};
}

function supportPayload(row:any){
  const p=row.payload||{};
  const code=p.ticket_number?`SUP-${String(p.ticket_number).padStart(4,'0')}`:'Support ticket';
  const created=row.event_type==='support_ticket_created';
  const fields:any[]=[{name:'Status',value:titleCase(p.status),inline:true},{name:'Priority',value:titleCase(p.priority),inline:true},{name:'Surface',value:titleCase(p.surface),inline:true},{name:'Managed by',value:text(p.managed_by,'Marlon'),inline:true}];
  if(p.requires_approval) fields.push({name:'Approval',value:titleCase(p.approval_status || 'pending'),inline:true});
  if(p.diagnosis) fields.push({name:'Diagnosis',value:text(p.diagnosis).slice(0,900),inline:false});
  if(p.action_taken) fields.push({name:'Action',value:text(p.action_taken).slice(0,900),inline:false});
  if(p.resolution) fields.push({name:'Resolution',value:text(p.resolution).slice(0,900),inline:false});
  return {flags:4096,allowed_mentions:{parse:[]},embeds:[{title:`${created?'New Marlon support request':'Marlon support update'} · ${code}`,description:`**${text(p.title,'Portal support request')}**\n${text(p.description,'Support activity logged by Marlon').slice(0,3200)}`,color:p.status==='resolved'||p.status==='closed'?0x2fbf71:p.priority==='critical'?0xe5484d:p.priority==='high'?0xf59e0b:0x159bd3,fields,footer:{text:'GotCracked Tech Support · silent log'},timestamp:new Date(row.created_at).toISOString()}],components:[{type:1,components:[{type:2,style:5,label:'Open Support Desk',url:`${portalUrl}/#support-tickets`}]}]};
}

function releasePayload(row:any){
  const p=row.payload||{};
  const raw=Array.isArray(p.feature_highlights)?p.feature_highlights:[];
  const highlights=raw.slice(0,10).map((item:any)=>{
    if(typeof item==='string') return item;
    const itemTitle=text(item?.title,'Update');
    const detail=String(item?.description||'').trim();
    return detail ? `**${itemTitle}** — ${detail}` : `**${itemTitle}**`;
  });
  const changeList=highlights.length
    ? `\n\n**What changed**\n${highlights.map((v:string)=>`• ${v}`).join('\n')}`
    : '';
  const description=`${text(p.summary,'A new GotCracked Portal update is live.')}${changeList}`;
  const fields:any[]=[
    {name:'Version',value:`v${text(p.version,'—')}`,inline:true},
    {name:'Release',value:titleCase(p.release_kind||'update'),inline:true}
  ];
  if(p.deployment_ref){
    fields.push({name:'Deployment',value:text(p.deployment_ref).slice(0,900),inline:false});
  }
  return {
    flags:4096,
    allowed_mentions:{parse:[]},
    embeds:[{
      title:`GotCracked Portal Update · v${text(p.version,'—')}`,
      description:description.slice(0,3900),
      color:0x159bd3,
      fields,
      footer:{text:'GotCracked · Updates & Patch Notes · silent'},
      timestamp:new Date(p.deployed_at||row.created_at).toISOString()
    }],
    components:[{
      type:1,
      components:[{type:2,style:5,label:'Open Portal',url:p.portal_url||portalUrl}]
    }]
  };
}

function leadPayload(row:any){
  const p=row.payload||{};
  const created=row.event_type==='lead_created';
  const fields:any[]=[
    {name:'Customer',value:text(p.name),inline:true},
    {name:'Phone',value:text(p.phone),inline:true},
    {name:'Email',value:text(p.email),inline:true},
    {name:'Status',value:titleCase(p.pipeline_status),inline:true},
    {name:'Source',value:text(p.source),inline:true}
  ];
  return {flags:4096,allowed_mentions:{parse:[]},embeds:[{title:created?'New lead':'Lead update',description:text(p.issue || 'Customer inquiry').slice(0,3200),color:0x159bd3,fields,footer:{text:'GotCracked Leads · silent channel log'},timestamp:new Date(row.created_at).toISOString()}],components:[{type:1,components:[{type:2,style:5,label:'Open Lead',url:p.portal_url||`${portalUrl}/#leads/${p.lead_id||row.entity_id}`}]}]};
}

function pcBuildPayload(row:any){
  const p=row.payload||{};
  const code=text(p.public_reference,'Custom PC request');
  const fields:any[]=[
    {name:'Customer',value:text(p.customer_name),inline:true},
    {name:'Phone',value:text(p.customer_phone),inline:true},
    {name:'Email',value:text(p.customer_email),inline:true},
    {name:'Preferred contact',value:titleCase(p.preferred_contact),inline:true},
    {name:'Status',value:titleCase(p.status),inline:true}
  ];
  if(Number.isFinite(Number(p.estimated_total_cents))&&Number(p.estimated_total_cents)>0) fields.push({name:'Current estimate',value:`$${(Number(p.estimated_total_cents)/100).toFixed(2)}`,inline:true});
  return {flags:4096,allowed_mentions:{parse:[]},embeds:[{title:`New custom PC build request · ${code}`,description:text(p.marlon_summary,'A customer submitted a custom PC build request and may need follow-up clarification.').slice(0,3200),color:0x7757d5,fields,footer:{text:'GotCracked Custom PC · silent channel log'},timestamp:new Date(row.created_at).toISOString()}],components:[{type:1,components:[{type:2,style:5,label:'Open Request',url:p.portal_url||`${portalUrl}/#leads/${p.lead_id||row.entity_id}`}]}]};
}

function leadDmPayload(row:any){
  const p=row.payload||{};
  return {allowed_mentions:{parse:[]},embeds:[{title:'New GotCracked lead',description:`**${text(p.name,'Potential customer')}**\n${text(p.issue,'New customer inquiry').slice(0,2600)}`,color:0x159bd3,fields:[{name:'Phone',value:text(p.phone),inline:true},{name:'Email',value:text(p.email),inline:true},{name:'Source',value:text(p.source),inline:true}],footer:{text:'Customer follow-up may be needed'},timestamp:new Date(row.created_at).toISOString()}],components:[{type:1,components:[{type:2,style:5,label:'Open Lead',url:p.portal_url||`${portalUrl}/#leads/${p.lead_id||row.entity_id}`}]}]};
}

function pcBuildDmPayload(row:any){
  const p=row.payload||{};
  return {allowed_mentions:{parse:[]},embeds:[{title:'New custom PC build request',description:`**${text(p.customer_name,'Potential customer')}**\n${text(p.marlon_summary,'A custom PC request was submitted and may need clarification before the build can move forward.').slice(0,2600)}`,color:0x7757d5,fields:[{name:'Phone',value:text(p.customer_phone),inline:true},{name:'Email',value:text(p.customer_email),inline:true},{name:'Preferred contact',value:titleCase(p.preferred_contact),inline:true}],footer:{text:'Customer follow-up may be needed'},timestamp:new Date(row.created_at).toISOString()}],components:[{type:1,components:[{type:2,style:5,label:'Open Request',url:p.portal_url||`${portalUrl}/#leads/${p.lead_id||row.entity_id}`}]}]};
}

async function deliveryChannel(db:any,row:any){
  if(row.entity_type==='support_ticket'){
    const cfg=await db.from('marlon_discord_config').select('tech_support_channel_id,bug_log_channel_id').eq('location_id',row.location_id).maybeSingle();
    return cfg.data?.tech_support_channel_id || cfg.data?.bug_log_channel_id || Deno.env.get('DISCORD_TECH_SUPPORT_CHANNEL_ID') || Deno.env.get('DISCORD_BUG_LOG_CHANNEL_ID') || Deno.env.get('DISCORD_WORK_ORDER_CHANNEL_ID') || Deno.env.get('DISCORD_LEAD_CHANNEL_ID');
  }
  if(row.entity_type==='portal_release'){
    const cfg=await db.from('marlon_discord_config').select('future_updates_channel_id,tech_support_channel_id').eq('location_id',row.location_id).maybeSingle();
    return cfg.data?.future_updates_channel_id || cfg.data?.tech_support_channel_id || Deno.env.get('DISCORD_TECH_SUPPORT_CHANNEL_ID');
  }
  if(row.entity_type==='lead'||row.entity_type==='pc_build_request') return Deno.env.get('DISCORD_LEAD_CHANNEL_ID') || Deno.env.get('DISCORD_WORK_ORDER_CHANNEL_ID');
  return Deno.env.get('DISCORD_WORK_ORDER_CHANNEL_ID') || Deno.env.get('DISCORD_LEAD_CHANNEL_ID');
}

async function leadDmUserId(db:any,row:any){
  const cfg=await db.from('marlon_discord_config').select('lead_dm_profile_id').eq('location_id',row.location_id).maybeSingle();
  const profileId=cfg.data?.lead_dm_profile_id;
  if(!profileId) throw new Error('Lead DM recipient is not configured.');
  const profile=await db.from('profiles').select('discord_user_id,active').eq('id',profileId).maybeSingle();
  if(profile.error) throw profile.error;
  if(!profile.data?.active||!profile.data?.discord_user_id) throw new Error('Configured lead DM recipient does not have an active linked Discord account.');
  return String(profile.data.discord_user_id);
}

function shouldDm(row:any){
  if(row.entity_type==='pc_build_request'&&row.event_type==='pc_build_request_created') return true;
  if(row.entity_type==='lead'&&row.event_type==='lead_created'){
    const source=String(row.payload?.source||'').toLowerCase();
    return !source.includes('custom-pc-build');
  }
  return false;
}

async function sendMessage(token:string,channelId:string,payload:any){
  const response=await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`,{method:'POST',headers:{Authorization:`Bot ${token}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});
  if(!response.ok) throw new Error(`Discord ${response.status}: ${(await response.text()).slice(0,500)}`);
  return response.json().catch(()=>({}));
}

async function sendDm(db:any,token:string,row:any){
  const userId=await leadDmUserId(db,row);
  const dm=await fetch('https://discord.com/api/v10/users/@me/channels',{method:'POST',headers:{Authorization:`Bot ${token}`,'Content-Type':'application/json'},body:JSON.stringify({recipient_id:userId})});
  if(!dm.ok) throw new Error(`Discord DM channel ${dm.status}: ${(await dm.text()).slice(0,500)}`);
  const channel=await dm.json();
  const payload=row.entity_type==='pc_build_request'?pcBuildDmPayload(row):leadDmPayload(row);
  await sendMessage(token,String(channel.id),payload);
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
    if(!row||row.delivered_at||!['work_order','support_ticket','lead','pc_build_request','portal_release'].includes(row.entity_type)) return new Response(JSON.stringify({ok:true,skipped:true}),{headers:{'Content-Type':'application/json'}});
    const token=Deno.env.get('DISCORD_BOT_TOKEN');
    const channelId=await deliveryChannel(db,row);
    if(!token||!channelId) throw new Error(`Discord ${row.entity_type} delivery is not configured.`);

    const channelPayload=row.entity_type==='support_ticket'?supportPayload(row):row.entity_type==='portal_release'?releasePayload(row):row.entity_type==='lead'?leadPayload(row):row.entity_type==='pc_build_request'?pcBuildPayload(row):workOrderPayload(row);
    await sendMessage(token,String(channelId),channelPayload);
    if(shouldDm(row)) await sendDm(db,token,row);

    await db.from('discord_notification_outbox').update({delivered_at:new Date().toISOString(),attempts:Number(row.attempts||0)+1,last_error:null}).eq('id',id);
    return new Response(JSON.stringify({ok:true,dm:shouldDm(row)}),{headers:{'Content-Type':'application/json'}});
  }catch(error){
    console.error(error);
    if(id){try{const db=admin();const row=await db.from('discord_notification_outbox').select('attempts').eq('id',id).maybeSingle();await db.from('discord_notification_outbox').update({attempts:Number(row.data?.attempts||0)+1,last_error:String(error instanceof Error?error.message:error).slice(0,1000)}).eq('id',id);}catch{}}
    return new Response(JSON.stringify({error:error instanceof Error?error.message:'Delivery failed'}),{status:502,headers:{'Content-Type':'application/json'}});
  }
});
