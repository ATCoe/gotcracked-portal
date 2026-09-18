import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const source=fs.readFileSync(new URL('../supabase/functions/workspace-verify/index.ts',import.meta.url),'utf8');
const code=stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm,''),{mode:'strip'});
function harness(options={}){
  let handler,writes=0,providerRequests=0;
  const user={id:'synthetic-staff',identities:[{provider:'google',id:'google-sub',identity_data:{sub:'google-sub',email:'staff@gotcracked.co',email_verified:true}}]};
  if(options.noGoogle)user.identities=[];
  const profile={id:user.id,active:options.staffActive!==false,location_id:'synthetic-shop',role:'technician',account_type:options.accountType||'staff',portal_email:options.profileEmail===undefined?'staff@gotcracked.co':options.profileEmail,onboarding_complete:true};
  const userClient={auth:{getUser:async()=>({data:{user:options.noUser?null:user},error:options.noUser?Error('unauthenticated'):null})},rpc:async name=>{assert.equal(name,'portal_auth_session_active');return{data:options.sessionActive!==false,error:options.rpcError?Error('unavailable'):null};}};
  const admin={from:table=>{
    assert.ok(['profiles','portal_human_sessions'].includes(table),'Unexpected table access: '+table);
    const query={error:null,select:()=>query,eq:()=>query,maybeSingle:async()=>({data:profile,error:null}),update:()=>{writes++;return query;},upsert:()=>{writes++;return{error:null};}};
    return query;
  }};
  let clients=0;
  const createClient=()=>++clients===1?userClient:admin;
  const context={Deno:{env:{get:()=> 'synthetic-configuration'},serve:fn=>handler=fn},createClient,Request,Response,Headers,URL,TextEncoder,crypto,atob,console:{error(){}},fetch:async(url,init={})=>{
    providerRequests++;
    assert.equal(String(url),'https://openidconnect.googleapis.com/v1/userinfo');
    assert.equal(init.headers.Authorization,'Bearer synthetic-google-token');
    if(options.invalidProvider)return new Response('{}',{status:401});
    return Response.json({sub:options.providerMismatch?'other-sub':'google-sub',email:options.googleEmail||'staff@gotcracked.co',email_verified:options.unverified?false:true});
  }};
  vm.runInNewContext(code,context);
  const claims={session_id:'00000000-0000-4000-8000-000000000001',amr:[{method:options.method||'oauth'}]};
  if(options.missingSession)delete claims.session_id;
  const token='synthetic.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.synthetic';
  const body={providerToken:options.missingProvider?'':'synthetic-google-token'};
  const request=new Request('https://example.invalid/workspace-verify',{method:options.httpMethod||'POST',headers:{Origin:options.origin||'https://portal.gotcracked.co',Authorization:'Bearer '+token,'Content-Type':'application/json'},...(options.httpMethod==='GET'?{}:{body:JSON.stringify(body)})});
  return{run:()=>handler(request),writes:()=>writes,providers:()=>providerRequests};
}
let passed=0;
async function test(name,options,status,{providers=0,writes=0}={}){
  const h=harness(options),r=await h.run();
  assert.equal(r.status,status,name+': '+await r.text());
  assert.equal(h.writes(),writes,name+': unexpected database writes');
  assert.equal(h.providers(),providers,name+': unexpected Google provider request');
  passed++;console.log('PASS',name);
}
await test('unauthenticated caller rejected',{noUser:true},401);
await test('missing session identifier rejected',{missingSession:true},401);
await test('revoked or expired session rejected',{sessionActive:false},401);
await test('password session rejected',{method:'password'},403);
await test('OAuth session without linked Google identity rejected',{noGoogle:true},403);
await test('missing current Google provider proof rejected',{missingProvider:true},403);
await test('invalid current Google provider proof rejected',{invalidProvider:true},403,{providers:1});
await test('unverified Google address rejected',{unverified:true},403,{providers:1});
await test('non-Workspace Google address rejected',{googleEmail:'staff@example.com'},403,{providers:1});
await test('different current Google identity rejected',{providerMismatch:true},403,{providers:1});
await test('inactive staff profile rejected',{staffActive:false},403,{providers:1});
await test('shared workstation rejected as personal Workspace staff',{accountType:'shared_workstation'},403,{providers:1});
await test('profile Workspace address mismatch rejected',{profileEmail:'other@gotcracked.co'},403,{providers:1});
await test('valid current Workspace staff session accepted',{},200,{providers:1,writes:2});
await test('foreign origin rejected before authentication',{origin:'https://example.invalid'},403);
await test('unsupported method rejected',{httpMethod:'GET'},405);
assert.match(source,/cleanEmail\(invite\.portal_email\)!==googleEmail/);
assert.match(source,/portal_email:googleEmail/);
assert.match(source,/verification_method:'google'/);
assert.match(source,/workspace_invitation_accepted/);
console.log(JSON.stringify({ok:true,workspaceCases:passed,onboardingContractAssertions:4,network:'mocked only',productionWrites:0}));
