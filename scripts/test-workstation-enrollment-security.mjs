import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { webcrypto, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {transformSync}=require('@babel/core');
const source=fs.readFileSync(new URL('../supabase/functions/workstation-enroll-approval/index.ts',import.meta.url),'utf8');
const executable=transformSync(source.replace(/^import .*createClient.*;\s*/m,''),{filename:'index.ts',configFile:false,babelrc:false,plugins:[require.resolve('@babel/plugin-transform-typescript')]}).code;
const hash=value=>createHash('sha256').update(value).digest('hex');
const ID='10000000-0000-4000-8000-000000000001';
const DEVICE='offline-browser-proof-'.repeat(3), CODE='AABBCCDDEEFF';
function fixture(options={}){
  const row={id:ID,location_id:'test-location',workstation_profile_id:'test-workstation',device_id_hash:hash(DEVICE),
    approved_at:new Date().toISOString(),approved_by:'test-owner',denied_at:null,consumed_at:null,
    expires_at:new Date(Date.now()+600000).toISOString(),redeem_attempts:0,device_label:'Offline test',redeem_code_hash:hash(CODE),...options.row};
  const calls={claims:0,grants:0,links:0,audits:0,revocations:0,attempts:0};
  const logs=[],grants=[];
  class Query{
    constructor(table){this.table=table;this.filters=[];this.mode='read';this.singleRow=false;}
    select(){return this;}limit(){return this;}order(){return this;}
    eq(k,v){this.filters.push(r=>r[k]===v);return this;}
    is(k,v){this.filters.push(r=>r[k]===v);return this;}
    not(k,op,v){assert.equal(op,'is');this.filters.push(r=>r[k]!==v);return this;}
    gt(k,v){this.filters.push(r=>r[k]>v);return this;}
    update(patch){this.mode='update';this.patch=patch;return this;}
    insert(value){this.mode='insert';this.value=value;return this;}
    maybeSingle(){this.singleRow=true;return this;}single(){this.singleRow=true;return this;}
    then(resolve,reject){return Promise.resolve().then(()=>this.run()).then(resolve,reject);}
    run(){
      if(this.table==='profiles'){
        if(options.profileError)return{data:null,error:{message:'fixture'}};
        const profiles=[{id:'test-owner',location_id:'test-location',role:'owner',account_type:'staff',active:true,...options.approver},
          {id:'test-workstation',location_id:'test-location',account_type:'shared_workstation',active:true,...options.workstation}];
        return{data:profiles.find(r=>this.filters.every(f=>f(r)))||null,error:null};
      }
      if(this.table==='workstation_enrollment_grants'){
        if(this.mode==='insert'){calls.grants++;if(options.grantError)return{data:null,error:{message:'fixture'}};grants.push({...this.value,consumed_at:null});}
        else if(this.mode==='update'){calls.revocations++;for(const r of grants)if(this.filters.every(f=>f(r)))Object.assign(r,this.patch);}
        return{data:null,error:null};
      }
      if(this.table==='staff_account_events'){calls.audits++;return{data:null,error:options.auditError?{message:'fixture'}:null};}
      assert.equal(this.table,'workstation_enrollment_requests');
      if(this.mode==='read'&&options.readError)return{data:null,error:{message:'fixture read failure'}};
      if(this.mode==='update'&&options.claimError)return{data:null,error:{message:'fixture update failure'}};
      const match=this.filters.every(f=>f(row));
      if(this.mode==='update'&&match){Object.assign(row,this.patch);if(this.patch.consumed_at)calls.claims++;else calls.attempts++;}
      return{data:this.singleRow?(match?{...row}:null):(match?[{...row}]:[]),error:null};
    }
  }
  const admin={from:table=>new Query(table),auth:{admin:{
    getUserById:async()=>{if(options.duringAuth)options.duringAuth(row);return{data:{user:{email:'fixture@example.invalid'}},error:options.authError?{message:'fixture'}:null};},
    generateLink:async args=>{calls.links++;assert.ok(!args.options?.redirectTo,'no redirect URL carrying a bearer proof');return{data:{properties:options.missingOtp?{}:{hashed_token:'offline-otp-proof',action_link:'https://example.invalid/never-used'}},error:options.linkError?{message:'fixture'}:null};}
  }}};
  let handler;
  vm.runInNewContext(executable,{Request,Response,URL,Uint8Array,TextEncoder,Date,crypto:webcrypto,AbortSignal,
    console:{error:(...args)=>logs.push(args.join(' '))},createClient:()=>admin,
    fetch:()=>{throw new Error('Network prohibited in offline security tests.');},
    Deno:{env:{get:name=>name==='SUPABASE_SERVICE_ROLE_KEY'?'fixture-service':name==='SUPABASE_URL'?'https://example.invalid':''},serve:fn=>{handler=fn;}}
  });
  const post=(action='redeem',body={},origin='http://127.0.0.1:4173')=>new Request('https://example.invalid/function',{
    method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify({action,requestId:ID,deviceId:DEVICE,code:CODE,...body})});
  return{row,calls,handler,post,logs,grants};
}
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
for(const action of ['redeem','redeem_code']){
  await test(action+' succeeds exactly once without changing device binding or exposing a URL',async()=>{
    const f=fixture(),before=f.row.device_id_hash,r=await f.handler(f.post(action));assert.equal(r.status,200);
    assert.equal(f.row.device_id_hash,before);assert.equal(f.calls.claims,1);assert.equal(f.calls.grants,1);assert.equal(f.calls.links,1);
    assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('location'),null);
    assert.equal(r.headers.get('access-control-allow-origin'),'http://127.0.0.1:4173');
    assert.equal((await r.json()).otpTokenHash,'offline-otp-proof');
    assert.equal((await f.handler(f.post(action))).status,409);assert.equal(f.calls.links,1);
  });
  for(const[name,row,status]of[['expired',{expires_at:new Date(Date.now()-60000).toISOString()},410],['denied',{denied_at:new Date().toISOString()},403],['unapproved',{approved_at:null},409],['used',{consumed_at:new Date().toISOString()},409],['locked',{redeem_attempts:5},423]])
    await test(action+' rejects '+name,async()=>{const f=fixture({row});assert.equal((await f.handler(f.post(action))).status,status);assert.equal(f.calls.links,0);assert.equal(f.calls.grants,0);});
  await test(action+' rejects another browser even with the right code',async()=>{const f=fixture();assert.equal((await f.handler(f.post(action,{deviceId:'different-offline-browser-proof-'.repeat(2)}))).status,403);assert.equal(f.calls.claims,0);});
  for(const[name,opts]of[['read error',{readError:true}],['claim error',{claimError:true}],['auth error',{authError:true}],['profile error',{profileError:true}]])
    await test(action+' distinguishes '+name+' from already used',async()=>{const f=fixture(opts),r=await f.handler(f.post(action));assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/already (used|claimed)/i);assert.equal(f.calls.links,0);assert.equal(f.row.consumed_at,null);});
  for(const[name,opts]of[['disabled approver',{approver:{active:false}}],['wrong approver role',{approver:{role:'automation',account_type:'automation'}}],['different location',{approver:{location_id:'other'}}],['disabled workstation',{workstation:{active:false}}]])
    await test(action+' rejects '+name,async()=>{const f=fixture(opts);assert.equal((await f.handler(f.post(action))).status,403);assert.equal(f.calls.claims,0);});
  for(const[name,opts]of[['grant failure',{grantError:true}],['link failure',{linkError:true}],['missing OTP',{missingOtp:true}],['audit failure',{auditError:true}]])
    await test(action+' safely requires fresh approval after '+name,async()=>{const f=fixture(opts),r=await f.handler(f.post(action));assert.equal(r.status,503);assert.equal((await r.json()).freshApprovalRequired,true);assert.ok(f.row.consumed_at);assert.equal(f.calls.revocations,1);for(const g of f.grants)assert.ok(new Date(g.expires_at).getTime()<=Date.now());assert.doesNotMatch(f.logs.join(' '),/offline-otp-proof|fixture@example|offline-browser-proof|AABBCCDDEEFF/);});
  for(const[name,patch]of[['expiry',{expires_at:new Date(Date.now()-60000).toISOString()}],['denial',{denied_at:new Date().toISOString()}],['approval change',{approved_by:'another-owner'}],['device change',{device_id_hash:'another-device'}],['attempt counter change',{redeem_attempts:5}]])
    await test(action+' rechecks '+name+' at claim time',async()=>{const f=fixture({duringAuth:r=>Object.assign(r,patch)});assert.equal((await f.handler(f.post(action))).status,409);assert.equal(f.calls.links,0);});
}
await test('concurrent redeem and redeem_code share one atomic claim',async()=>{const f=fixture();const rs=await Promise.all([f.handler(f.post('redeem')),f.handler(f.post('redeem_code'))]);assert.equal(rs.filter(r=>r.status===200).length,1);assert.equal(f.calls.claims,1);assert.equal(f.calls.grants,1);assert.equal(f.calls.links,1);});
await test('five wrong codes lock the request without issuing credentials',async()=>{const f=fixture();for(let i=0;i<5;i++)assert.equal((await f.handler(f.post('redeem_code',{code:'000000000000'}))).status,403);assert.equal(f.row.redeem_attempts,5);assert.equal((await f.handler(f.post('redeem_code'))).status,423);assert.equal(f.calls.links,0);});
await test('status requires original browser proof and exposes no bearer secrets',async()=>{const f=fixture();assert.equal((await f.handler(f.post('status',{deviceId:'other-proof'.repeat(5)}))).status,403);const r=await f.handler(f.post('status'));assert.equal(r.status,200);const s=await r.text();assert.match(s,/approved/);assert.doesNotMatch(s,/device_id_hash|redeem_code_hash|approval_fingerprint|enrollmentToken|otpTokenHash/);});
await test('unprivileged create stays denied',async()=>{const f=fixture();assert.equal((await f.handler(f.post('create'))).status,401);});
await test('unknown origins rejected before any auth mutation',async()=>{const f=fixture();assert.equal((await f.handler(f.post('redeem',{},'https://attacker.invalid'))).status,403);assert.equal(f.calls.claims,0);});
await test('code-only GET redemption is retired, never redirected',async()=>{const f=fixture();for(const suffix of ['', '?action=redeem_redirect&code='+CODE]){const r=await f.handler(new Request('https://example.invalid/function'+suffix));assert.equal(r.status,410);assert.equal(r.headers.get('location'),null);}assert.equal(f.calls.claims,0);});
await test('POST redeem_redirect is also retired',async()=>{const f=fixture();assert.equal((await f.handler(f.post('redeem_redirect'))).status,410);assert.equal(f.calls.claims,0);});
console.log(JSON.stringify({ok:true,passed,sourceSha256:hash(source),network:'disabled',productionWrites:0}));
