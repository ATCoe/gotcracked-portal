import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl=Deno.env.get('SUPABASE_URL')!;
const portalUrl=(Deno.env.get('PORTAL_URL')||'https://portal.gotcracked.co').replace(/\/$/,'');
const admin=()=>createClient(supabaseUrl,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const hex=(buffer:ArrayBuffer)=>[...new Uint8Array(buffer)].map(v=>v.toString(16).padStart(2,'0')).join('');

async function signatureFor(secret:string,message:string){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(message)));
}
function safeEqual(a:string,b:string){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0}

function dmPayload(row:any){
  const p=row.payload||{};
  const first=String(p.target_display_name||'').trim().split(/\s+/)[0]||'there';
  return {
    allowed_mentions:{parse:[]},
    embeds:[{
      title:'Marlon · Front Desk PIN reset',
      description:`Hi ${first}. Your personal Front Desk workstation PIN was reset. Your previous PIN no longer works.\n\nSign in to the GotCracked Portal with Discord, open **My Account**, and create a new Workstation PIN before using the shared Front Desk computer.`,
      color:0x159bd3,
      fields:[{name:'Security note',value:'Marlon will never ask you to send your PIN in Discord. Set it only inside the Portal.',inline:false}],
      footer:{text:'Marlon · GotCracked Portal'},
      timestamp:new Date(row.created_at).toISOString()
    }],
    components:[{type:1,components:[{type:2,style:5,label:'Set New Workstation PIN',url:p.portal_url||`${portalUrl}/#profile`}]}]
  };
}

async function sendMessage(token:string,channelId:string,payload:any){
  const response=await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`,{
    method:'POST',headers:{Authorization:`Bot ${token}`,'Content-Type':'application/json'},body:JSON.stringify(payload)
  });
  if(!response.ok)throw new Error(`Discord ${response.status}: ${(await response.text()).slice(0,500)}`);
}

Deno.serve(async request=>{
  if(request.method!=='POST')return new Response('Not found',{status:404});
  let id='';
  try{
    const body=await request.json();
    id=String(body.outbox_id||'');
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
    if(!row||row.delivered_at||row.entity_type!=='operator_pin_reset')return new Response(JSON.stringify({ok:true,skipped:true}),{headers:{'Content-Type':'application/json'}});

    const targetId=String(row.payload?.target_profile_id||row.entity_id||'');
    const profileResult=await db.from('profiles').select('discord_user_id,active,account_type').eq('id',targetId).maybeSingle();
    if(profileResult.error)throw profileResult.error;
    const profile=profileResult.data;
    const userId=String(row.payload?.target_discord_user_id||profile?.discord_user_id||'');
    if(!profile?.active||profile?.account_type==='shared_workstation'||!userId)throw new Error('PIN reset recipient does not have an active linked Discord account.');

    const token=Deno.env.get('DISCORD_BOT_TOKEN');
    if(!token)throw new Error('Marlon Discord delivery is not configured.');
    const dm=await fetch('https://discord.com/api/v10/users/@me/channels',{
      method:'POST',headers:{Authorization:`Bot ${token}`,'Content-Type':'application/json'},body:JSON.stringify({recipient_id:userId})
    });
    if(!dm.ok)throw new Error(`Discord DM channel ${dm.status}: ${(await dm.text()).slice(0,500)}`);
    const channel=await dm.json();
    await sendMessage(token,String(channel.id),dmPayload(row));

    await db.from('discord_notification_outbox').update({delivered_at:new Date().toISOString(),attempts:Number(row.attempts||0)+1,last_error:null}).eq('id',id);
    return new Response(JSON.stringify({ok:true,dm:true}),{headers:{'Content-Type':'application/json'}});
  }catch(error){
    console.error(error);
    if(id){
      try{
        const db=admin();
        const row=await db.from('discord_notification_outbox').select('attempts').eq('id',id).maybeSingle();
        await db.from('discord_notification_outbox').update({attempts:Number(row.data?.attempts||0)+1,last_error:String(error instanceof Error?error.message:error).slice(0,1000)}).eq('id',id);
      }catch{}
    }
    return new Response(JSON.stringify({error:error instanceof Error?error.message:'PIN reset DM delivery failed'}),{status:502,headers:{'Content-Type':'application/json'}});
  }
});
