import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {transformSync}=require('@babel/core');
const tsPlugin=require.resolve('@babel/plugin-transform-typescript');
import { webcrypto, createHmac } from 'node:crypto';
const source=fs.readFileSync(new URL('../supabase/functions/discord-outbox-delivery/index.ts',import.meta.url),'utf8');
const executable=transformSync(source.replace(/^import .*createClient.*;\s*/m,''),{filename:'index.ts',configFile:false,babelrc:false,plugins:[tsPlugin]}).code;
const secret='offline-signing-fixture';
function fixture(row){
  const sent=[],patches=[];let handler;
  const db={from:table=>({select(){return this;},eq(){return this;},async maybeSingle(){
    if(table==='internal_runtime_secrets')return{data:{secret}};
    if(table==='discord_notification_outbox')return{data:row};
    if(table==='marlon_discord_config')return{data:{tech_support_channel_id:'support',lead_dm_profile_id:'owner'}};
    if(table==='profiles')return{data:{active:true,discord_user_id:'owner-discord'}};
    throw Error('Unexpected table');
  },update(patch){patches.push(patch);return{eq:async()=>({error:null})};}})};
  const ctx={Request,Response,URL,Date,Uint8Array,TextEncoder,crypto:webcrypto,setTimeout,console:{error(){}},createClient:()=>db,
    Deno:{env:{get:n=>n==='DISCORD_BOT_TOKEN'?'offline-bot':n==='SUPABASE_URL'?'https://example.invalid':'fixture'},serve:fn=>{handler=fn;}},
    fetch:async(url,init)=>{assert.ok(String(url).startsWith('https://discord.com/api/v10/'));sent.push({url,body:JSON.parse(init.body)});return Response.json({id:String(url).endsWith('/users/@me/channels')?'owner-dm':'message'});}};
  vm.runInNewContext(executable,ctx);
  const request=(ts=Math.floor(Date.now()/1000),signature)=>new Request('https://example.invalid/outbox',{method:'POST',headers:{'Content-Type':'application/json','x-gc-signature':signature??createHmac('sha256',secret).update(`${row.id}:${ts}`).digest('hex')},body:JSON.stringify({outbox_id:row.id,ts})});
  return{ctx,handler,request,sent,patches};
}
let passed=0;
const base={id:'offline-row',location_id:'offline-location',entity_id:'offline-ticket',entity_type:'support_ticket',event_type:'support_ticket_progress',attempts:0,created_at:new Date().toISOString(),payload:{notify_owner:true,execution_stage:'started',title:'Offline recovery',status:'in_progress',action_taken:'CURRENT_ACTION'}};
for(const stage of ['started','diagnosed','testing','blocked','completed','failed']){const f=fixture({...base,payload:{...base.payload,execution_stage:stage}});assert.equal(f.ctx.shouldDm({...base,payload:{...base.payload,execution_stage:stage}}),true);passed++;}
for(const changes of [{execution_stage:'heartbeat'},{execution_stage:'working'},{notify_owner:false},{notify_owner:'true'},{execution_stage:'arbitrary'}]){const row={...base,payload:{...base.payload,...changes}},f=fixture(row);assert.equal(f.ctx.shouldDm(row),false);passed++;}
{
  const f=fixture(base),r=await f.handler(f.request());assert.equal(r.status,200);assert.equal(f.sent.length,3);
  assert.equal(f.sent[2].url,'https://discord.com/api/v10/channels/owner-dm/messages');
  assert.match(f.sent[2].body.embeds[0].title,/Marlon update/);assert.ok(f.sent[2].body.embeds[0].fields.some(x=>x.name==='Latest action'&&x.value==='CURRENT_ACTION'));assert.deepEqual(f.sent[2].body.allowed_mentions,{parse:[]});
  assert.ok(f.patches.at(-1).delivered_at);passed+=5;
}
for(const [ts,sig] of [[Math.floor(Date.now()/1000),'wrong'],[Math.floor(Date.now()/1000)-601,undefined]]){
  const f=fixture(base),r=await f.handler(f.request(ts,sig));assert.equal(r.status,401);assert.equal(f.sent.length,0);passed+=2;
}
{
  const row={...base,payload:{...base.payload,execution_stage:'heartbeat'}},f=fixture(row);
  assert.equal((await f.handler(f.request())).status,200);assert.equal(f.sent.length,1);passed+=2;
}
for(const event of ['workstation_enrollment_approval_requested','workstation_enrollment_code']){
  const row={...base,entity_type:'workstation_enrollment',event_type:event,payload:{request_id:'offline-request',fingerprint:'offline-fingerprint',code:'OFFLINE-ONLY'}},f=fixture(row);
  assert.equal((await f.handler(f.request())).status,200);assert.equal(f.sent.length,2);
  assert.deepEqual(JSON.parse(JSON.stringify(f.patches.at(-1).payload)),{delivered:true,event_type:event});passed+=3;
}
{
  const f=fixture({...base,delivered_at:new Date().toISOString()});assert.equal((await f.handler(f.request())).status,200);assert.equal(f.sent.length,0);passed+=2;
}
console.log(JSON.stringify({ok:true,passed,network:'mocked only',coverage:['v12 compatibility-stage allowlist','detailed-stage suppression before DB mapping','current-action DM field','signed delivery','invalid/stale rejection','workstation preservation','one-use delivery guard']}));
