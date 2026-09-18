import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { authorizePortal, canReadAgentJob } from '../aurora/marlon-core/portal-auth.mjs';

let passed=0;
async function test(name,run){await run();passed++;console.log('PASS',name);}
const root=new URL('../',import.meta.url);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function browserHarness(){
  const events=[],storageEvents=[],storage=new Map();
  let now=1700000000000,calls=0,sessionProvider=async()=>({data:{session:null},error:null});
  const client={auth:{getSession:()=>{calls++;return sessionProvider();},getUser:async()=>({data:{user:null}}),onAuthStateChange:f=>events.push(f)},realtime:{setAuth:async()=>{}},functions:{invoke:async()=>({data:null})}};
  const context={supabase:{createClient:()=>client},localStorage:{getItem:k=>storage.get(k)||null},sessionStorage:{getItem:()=>null},window:{localStorage:{},addEventListener:(e,f)=>{if(e==='storage')storageEvents.push(f)}},document:{getElementById:()=>null},console,AbortController,DOMException,Date:class extends Date{static now(){return now;}},setTimeout:f=>{const t=setTimeout(f,11000);t.unref();return t;},clearTimeout,fetch:async()=>new Response('{}'),CustomEvent:class{}};
  context.atob=atob;
  context.window.window=context.window;
  vm.runInNewContext(fs.readFileSync(new URL('supabase.js',root),'utf8'),context);
  return {client,events,storageEvents,storage,now:()=>now,advance:ms=>now+=ms,provider:f=>sessionProvider=f,calls:()=>calls,auth:context.window.GotCrackedAuth};
}
const session=(h,id='staff')=>({access_token:'valid-token',expires_at:h.now()/1000+3600,user:{id}});
await test('OAuth routing reads session method, not linked identities',()=>{
 const h=browserHarness();
 const token=method=>({access_token:`header.${Buffer.from(JSON.stringify({amr:[{method}]})).toString('base64url')}.signature`});
 assert.equal(h.auth.isOAuthSession(token('oauth')),true);
 assert.equal(h.auth.isOAuthSession(token('password')),false);
 assert.equal(h.auth.isOAuthSession({access_token:'broken'}),false);
});
await test('A server-registered human session wins over linked identity guesses',async()=>{
 const calls=[],storage=new Map();
 const source=fs.readFileSync(new URL('workflow.js',root),'utf8');
 const routine=source.slice(source.indexOf('  async function prepareHumanSession('),source.indexOf('  async function loadProfile('));
 const context={window:{GotCrackedAuth:{isOAuthSession:()=>true},GotCrackedVerifyDiscord:async()=>{throw Error('Unexpected Discord verification');},supabaseClient:{rpc:async name=>{calls.push(name);return{data:true};}}},sessionStorage:{getItem:key=>storage.get(key)||null,removeItem:key=>storage.delete(key)},localSignOut:async()=>{throw Error('Unexpected sign-out');},showLoginError:()=>{}};
 vm.createContext(context);vm.runInContext(routine,context);
 assert.equal(await context.prepareHumanSession({user:{id:'staff',identities:[{provider:'discord'},{provider:'google'}]}}),true);
 assert.deepEqual(calls,['portal_session_authorized']);
});
await test('Fresh Workspace OAuth uses the server-bound Workspace registration RPC',async()=>{
 const calls=[],storage=new Map([['gc-oauth-provider','google'],['gc-staff-invite','invite-token']]);
 const source=fs.readFileSync(new URL('workflow.js',root),'utf8');
 const routine=source.slice(source.indexOf('  async function prepareHumanSession('),source.indexOf('  async function loadProfile('));
 const context={window:{GotCrackedAuth:{isOAuthSession:()=>true},GotCrackedVerifyDiscord:async()=>{throw Error('Unexpected Discord verification');},supabaseClient:{rpc:async(name,args)=>{calls.push([name,args]);if(name==='portal_session_authorized')return{data:false};return{data:{authorized:true}};}}},sessionStorage:{getItem:key=>storage.get(key)||null,removeItem:key=>storage.delete(key)},localSignOut:async()=>{throw Error('Unexpected sign-out');},showLoginError:()=>{},URL,document:{title:'GotCracked Portal'},location:{href:'https://portal.gotcracked.co/?invite=invite-token'},history:{replaceState(){}}};
 vm.createContext(context);vm.runInContext(routine,context);
 assert.equal(await context.prepareHumanSession({user:{id:'staff',identities:[{provider:'discord'},{provider:'google'}]}}),true);
 assert.equal(calls[0][0],'portal_session_authorized');
 assert.equal(calls[1][0],'register_workspace_human_session');
 assert.equal(calls[1][1].invite_token,'invite-token');
});
await test('Expired cached tokens trigger a fresh session lookup',async()=>{
  const h=browserHarness(),s=session(h);h.events.forEach(f=>f('SIGNED_IN',s));
  assert.equal((await h.client.auth.getSession()).data.session.user.id,'staff');h.advance(3600001);
  assert.equal((await h.client.auth.getSession()).data.session,null);assert.equal(h.calls(),1);
});
await test('Concurrent forced restores share one lookup',async()=>{
  const h=browserHarness(),d=deferred();h.provider(()=>d.promise);
  const a=h.auth.restoreSession({force:true}),b=h.auth.restoreSession({force:true});
  assert.equal(h.calls(),1);d.resolve({data:{session:session(h)},error:null});await Promise.all([a,b]);
});
await test('A late restore cannot resurrect a signed-out session',async()=>{
  const h=browserHarness(),d=deferred();h.provider(()=>d.promise);const pending=h.auth.restoreSession();
  h.events.forEach(f=>f('SIGNED_OUT',null));d.resolve({data:{session:session(h)},error:null});
  assert.equal((await pending).session,null);h.provider(async()=>({data:{session:null},error:null}));
  assert.equal((await h.auth.restoreSession()).session,null);
});
await test('Cross-tab sign-out invalidates the cached session',async()=>{
  const h=browserHarness();h.events.forEach(f=>f('SIGNED_IN',session(h)));
  h.storageEvents.forEach(f=>f({key:'sb-uvpmmbioerejeyybfntb-auth-token'}));
  assert.equal((await h.auth.restoreSession()).session,null);
});

const request=new Request('https://auroraserver.tail317407.ts.net/internal/mobilesentrix-relay',{headers:{Authorization:'Bearer test-jwt'}});
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_ANON_KEY:'public-key'};
function transport({active=true,permission=false,role='owner',account_type='staff'}={}){
  return async(url,init)=>{
    assert.equal(init.headers.apikey,'public-key');assert.equal(init.headers.Authorization,'Bearer test-jwt');
    if(url.endsWith('/auth/v1/user'))return Response.json({id:'staff'});
    if(url.endsWith('/portal_session_authorized'))return Response.json(active);
    if(url.includes('/profiles?'))return Response.json([{id:'staff',role,account_type,active:true,location_id:'shop'}]);
    if(url.endsWith('/has_permission'))return Response.json(permission);
    throw Error('Unexpected request');
  };
}
await test('Relay rejects a revoked owner session',async()=>assert.equal((await authorizePortal(request,env,['settings.manage'],transport({active:false}))).status,403));
await test('An owner label cannot bypass a permission denial',async()=>assert.equal((await authorizePortal(request,env,['settings.manage'],transport())).status,403));
await test('A valid authorized staff session passes the relay',async()=>assert.equal((await authorizePortal(request,env,['inventory.manage'],transport({permission:true}))).ok,true));
await test('A missing API key is a configuration failure',async()=>assert.equal((await authorizePortal(request,{},[],transport())).status,503));
await test('Authentication outages fail closed',async()=>assert.equal((await authorizePortal(request,env,[],async()=>{throw Error('offline');})).status,503));
await test('Automation cannot read another actor or location job',async()=>{
  const p={id:'marlon',location_id:'shop'};
  assert.equal(canReadAgentJob({requestedBy:'owner',locationId:'shop'},p),false);
  assert.equal(canReadAgentJob({requestedBy:'marlon',locationId:'other'},p),false);
  assert.equal(canReadAgentJob({},p),false);
  assert.equal(canReadAgentJob({requestedBy:'marlon',locationId:'shop'},p),true);
});

function loadEdge(name, {permission=false,authActive=false,role='owner',account_type='staff'}={}){
  let handler;
  const profile={id:'staff',active:true,location_id:'shop',role,account_type};
  const client={auth:{getUser:async()=>({data:{user:{id:'staff',identities:[]}},error:null})},rpc:async n=>({data:n==='portal_auth_session_active'?authActive:permission,error:null}),from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:profile,error:null}),single:async()=>({data:profile,error:null})};return q;}};
  const source=fs.readFileSync(new URL(`supabase/functions/${name}/index.ts`,root),'utf8').replace(/^import .*;\r?\n/gm,'');
  const code=stripTypeScriptTypes(source,{mode:'strip'});
  const context={Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://example.supabase.co':k==='PORTAL_URL'?undefined:'configured'},serve:f=>handler=f},createClient:()=>client,Request,Response,Headers,URL,URLSearchParams,AbortSignal,TextEncoder,TextDecoder,crypto,btoa,atob,console,setTimeout,clearTimeout};
  vm.runInNewContext(code,context);return handler;
}
for(const name of ['mobilesentrix-oauth','mobilesentrix-sync','google-integrations','sync-media','send-receipt','create-lead','device-catalog-search','marlon-knowledge-context','shipping-provider','staff-invite','manage-staff','marlon-profile-sync']){
  await test(`${name} denies an unverified owner before privileged work`,async()=>{
    const handler=loadEdge(name);
    const response=await handler(new Request(`https://example.supabase.co/functions/v1/${name}`,{method:'POST',headers:{Authorization:'Bearer invalid','Content-Type':'application/json',Origin:'https://portal.gotcracked.co'},body:JSON.stringify({action:'status',category:'Phone'})}));
    assert.equal(response.status,403,await response.text());
  });
}
console.log(`${passed} authentication regression checks passed.`);
