import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {webcrypto,createHash} from 'node:crypto';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {transformSync}=require('@babel/core');
const operationsSource=fs.readFileSync(new URL('../supabase/functions/marlon-operations/index.ts',import.meta.url),'utf8');
const interactionsSource=fs.readFileSync(new URL('../supabase/functions/discord-interactions/index.ts',import.meta.url),'utf8');

const payloadBlock=operationsSource.match(/function proposalDiscordPayload[\s\S]*?\n}\n\nasync function openDm/)?.[0]?.replace(/\n\nasync function openDm$/,'');
assert.ok(payloadBlock,'proposalDiscordPayload block missing');
const payloadCode=transformSync(payloadBlock,{filename:'payload.ts',configFile:false,babelrc:false,plugins:[require.resolve('@babel/plugin-transform-typescript')]}).code;
const payloadContext={clean:(v,max=600)=>String(v??'').trim().replace(/\s+/g,' ').slice(0,max),Date,proposalDiscordPayload:null};
vm.createContext(payloadContext);
vm.runInContext(payloadCode+';this.proposalDiscordPayload=proposalDiscordPayload;',payloadContext);

const capability={
  id:'11111111-1111-4111-8111-111111111111',
  surface:'portal',implementation_complexity:'medium',owner_review_state:'pending',
  proposal_fingerprint:'abcdef1234567890',title:'Connect missing tool',description:'Marlon needs a bounded external capability.',
  evidence:{capability_required:true,capability_name:'Example Connector',capability_reason:'Needed for verified external QA.',capability_install:'Connect Example Connector in Settings.',capability_cost:'free'},
  created_at:new Date().toISOString()
};
let passed=0;
function pass(name){passed++;console.log('PASS '+name);}

{
  const p=payloadContext.proposalDiscordPayload(capability);
  const controls=p.components[0].components;
  assert.equal(p.embeds[0].title,'Marlon capability request');
  assert.ok(p.embeds[0].fields.some(f=>f.name==='Tool / access needed'&&f.value==='Example Connector'));
  assert.ok(p.embeds[0].fields.some(f=>f.name==='Owner action'&&/Connect Example/.test(f.value)));
  assert.equal(controls[0].custom_id,`proposal:approve:${capability.id}:abcdef123456`);
  assert.equal(controls[1].custom_id,`proposal:deny:${capability.id}:abcdef123456`);
  assert.equal(controls[2].style,5);
  pass('capability DM carries exact request and secure decision buttons');
}
{
  const p=payloadContext.proposalDiscordPayload({...capability,owner_review_state:'approved'},'Austin');
  assert.equal(p.embeds[0].title,'Marlon capability request approved');
  assert.match(p.embeds[0].fields.find(f=>f.name==='Status').value,/waiting for install\/connect/);
  assert.equal(p.components[0].components.length,1);
  pass('approved capability does not pretend installation completed');
}
{
  const p=payloadContext.proposalDiscordPayload({...capability,evidence:{capability_required:false},title:'Routine proposal'});
  assert.equal(p.components[0].components[0].label,'Approve exact scope');
  pass('normal proposal keeps fingerprinted scope approval');
}

const code=transformSync(interactionsSource.replace(/^import .*createClient.*;\s*/m,''),{filename:'interactions.ts',configFile:false,babelrc:false,plugins:[require.resolve('@babel/plugin-transform-typescript')]}).code;
const keys=await webcrypto.subtle.generateKey('Ed25519',true,['sign','verify']);
const pub=Buffer.from(await webcrypto.subtle.exportKey('raw',keys.publicKey)).toString('hex');
const FP='abcdef1234567890';
function fixture(opts={}){
  const proposal={...capability,location_id:'offline-location',source:'marlon',status:'new',owner_review_required:true,proposal_fingerprint:FP,...opts.proposal};
  const staff={id:'offline-owner',location_id:'offline-location',display_name:'Austin',active:true,account_type:'staff',role:'owner',...opts.staff};
  let writes=0,audits=0,handler;
  class Q{
    constructor(table){this.table=table;this.filters=[];this.patch=null;}
    select(){return this;}
    eq(k,v){this.filters.push(r=>r?.[k]===v);return this;}
    update(p){this.patch=p;return this;}
    insert(){if(this.table==='staff_account_events')audits++;return this;}
    maybeSingle(){return this;}
    then(y,n){return Promise.resolve().then(()=>{
      if(this.table==='profiles')return{data:staff,error:null};
      if(this.table==='staff_account_events')return{data:null,error:null};
      if(this.table==='portal_suggestions'){
        if(this.patch){
          if(opts.writeError)return{data:null,error:{message:'offline write failure'}};
          if(opts.race)proposal.owner_review_state='approved';
          if(!this.filters.every(f=>f(proposal)))return{data:null,error:null};
          Object.assign(proposal,this.patch);writes++;
        }
        return{data:{...proposal},error:null};
      }
      return{data:null,error:null};
    }).then(y,n);}
  }
  const db={from:t=>new Q(t),rpc:async(name,args)=>{
    if(name==='marlon_improvement_fingerprint')return{data:opts.recomputed??FP,error:opts.rpcError?{message:'offline rpc failure'}:null};
    return{data:null,error:{message:'unexpected rpc'}};
  }};
  vm.runInNewContext(code,{Request,Response,Uint8Array,TextEncoder,Date,crypto:webcrypto,console:{error:()=>{}},createClient:()=>db,Deno:{env:{get:n=>n==='DISCORD_PUBLIC_KEY'?pub:'offline'},serve:fn=>handler=fn}});
  async function request(action='approve',fingerprint=FP.slice(0,12)){
    const raw=JSON.stringify({type:3,user:{id:'offline-discord'},data:{custom_id:`proposal:${action}:${proposal.id}:${fingerprint}`}});
    const ts=String(Math.floor(Date.now()/1000));
    const sig=Buffer.from(await webcrypto.subtle.sign('Ed25519',keys.privateKey,new TextEncoder().encode(ts+raw))).toString('hex');
    return new Request('https://example.invalid/discord',{method:'POST',body:raw,headers:{'x-signature-ed25519':sig,'x-signature-timestamp':ts}});
  }
  return{proposal,handler,request,counts:()=>({writes,audits})};
}
async function verify(name,fn){await fn();pass(name);}

await verify('Owner can approve capability request without marking installed',async()=>{
  const f=fixture();const r=await f.handler(await f.request('approve'));const body=await r.text();
  assert.match(body,/Capability request approved/);assert.equal(f.proposal.owner_review_state,'approved');assert.equal(f.proposal.status,'new');
  assert.equal(f.proposal.evidence.capability_required,true);assert.deepEqual(f.counts(),{writes:1,audits:1});
});
await verify('Owner can deny capability request',async()=>{
  const f=fixture();const r=await f.handler(await f.request('deny'));assert.match(await r.text(),/declined/);
  assert.equal(f.proposal.owner_review_state,'denied');assert.equal(f.proposal.status,'declined');
});
for(const [name,opts] of [
  ['non-owner',{staff:{role:'manager'}}],
  ['automation identity',{staff:{account_type:'automation',role:'owner'}}],
  ['wrong location',{staff:{location_id:'other'}}],
  ['stale scope',{recomputed:'different'}],
  ['already decided',{proposal:{owner_review_state:'approved'}}],
  ['write race',{race:true}],
  ['database failure',{writeError:true}]
]){
  await verify(name+' cannot record approval',async()=>{
    const f=fixture(opts);const r=await f.handler(await f.request('approve'));const text=await r.text();
    assert.equal(f.counts().writes,0);assert.doesNotMatch(text,/approved for the exact|Capability request approved/);
  });
}
await verify('wrong fingerprint rejected',async()=>{
  const f=fixture();const r=await f.handler(await f.request('approve','001122334455'));assert.equal(f.counts().writes,0);assert.match(await r.text(),/fingerprint mismatch/);
});
await verify('non-capability approval becomes planned',async()=>{
  const f=fixture({proposal:{evidence:{capability_required:false}}});await f.handler(await f.request('approve'));
  assert.equal(f.proposal.owner_review_state,'approved');assert.equal(f.proposal.status,'planned');
});

console.log(JSON.stringify({ok:true,passed,operationsSha256:createHash('sha256').update(operationsSource).digest('hex'),interactionsSha256:createHash('sha256').update(interactionsSource).digest('hex'),network:'disabled',productionWrites:0}));
