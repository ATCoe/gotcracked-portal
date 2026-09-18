import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const source=fs.readFileSync(new URL('../supabase/functions/discord-verify/index.ts',import.meta.url),'utf8');
const code=stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm,''),{mode:'strip'});
function harness(options={}){
  let handler,writes=0,memberRequests=0,providerRequests=0,humanSessionWrites=0;
  const user={id:'synthetic-staff',identities:[{provider:'discord',identity_data:{provider_id:'discord-1',user_name:'test-staff'}}]};
  if(options.noDiscord)user.identities=[];
  const profile={id:user.id,active:options.staffActive!==false,location_id:'synthetic-shop',role:'technician',account_type:options.accountType||'staff',discord_user_id:options.mismatch?'another-discord':'discord-1',onboarding_complete:true};
  const client={
    auth:{getUser:async()=>({data:{user:options.noUser?null:user},error:options.noUser?Error('unauthenticated'):null})},
    rpc:async name=>{assert.equal(name,'portal_auth_session_active');return{data:options.sessionActive!==false,error:options.rpcError?Error('unavailable'):null};},
    from:table=>{
      assert.ok(['profiles','portal_human_sessions','staff_account_events'].includes(table),'Unexpected table access');
      const query={error:null,select:()=>query,eq:()=>query,maybeSingle:async()=>({data:profile,error:null}),update:()=>{writes++;return query;},insert:()=>{writes++;return{error:null};},upsert:()=>{writes++;if(table==='portal_human_sessions')humanSessionWrites++;return{error:null};}};
      return query;
    }
  };
  const context={Deno:{env:{get:()=> 'synthetic-configuration'},serve:fn=>handler=fn},createClient:()=>client,Request,Response,Headers,URL,TextEncoder,crypto,atob,console:{error(){}},fetch:async(url,init={})=>{
    const target=String(url);
    if(target.endsWith('/users/@me')){
      providerRequests++;
      assert.equal(init.headers.Authorization,'Bearer synthetic-provider-token');
      if(options.invalidProvider)return new Response('{}',{status:401});
      return Response.json({id:options.providerMismatch?'other-discord':'discord-1',username:'test-staff'});
    }
    assert.match(target,/^https:\/\/discord\.com\/api\/v10\/guilds\//);
    memberRequests++;
    return options.notMember?new Response('{}',{status:404}):Response.json({user:{username:'test-staff'}});
  }};
  vm.runInNewContext(code,context);
  const claims={session_id:'00000000-0000-4000-8000-000000000001',amr:[{method:options.method||'oauth'}]};
  if(options.missingSession)delete claims.session_id;
  const token='synthetic.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.synthetic';
  const body={providerToken:options.missingProvider?'':'synthetic-provider-token',linkOnly:options.linkOnly===true};
  const request=new Request('https://example.invalid/discord-verify',{method:options.httpMethod||'POST',headers:{Origin:options.origin||'https://portal.gotcracked.co',Authorization:'Bearer '+token,'Content-Type':'application/json'},...(options.httpMethod==='GET'?{}:{body:JSON.stringify(body)})});
  return{run:()=>handler(request),writes:()=>writes,members:()=>memberRequests,providers:()=>providerRequests,humanSessions:()=>humanSessionWrites};
}
let passed=0;
async function test(name,options,status,{members=0,providers=0,writes=0,humanSessions=0}={}){
  const h=harness(options),r=await h.run();
  assert.equal(r.status,status,name+': '+await r.text());
  assert.equal(h.writes(),writes,name+': unexpected database writes');
  assert.equal(h.members(),members,name+': unexpected guild request');
  assert.equal(h.providers(),providers,name+': unexpected current-provider request');
  assert.equal(h.humanSessions(),humanSessions,name+': unexpected human-session relabel');
  passed++;console.log('PASS',name);
}
await test('unauthenticated caller rejected',{noUser:true},401);
await test('missing session identifier rejected',{missingSession:true},401);
await test('revoked or expired session rejected',{sessionActive:false},401);
await test('missing or unavailable database prerequisite fails closed',{rpcError:true},401);
await test('password session with linked Discord rejected',{method:'password'},403);
await test('non-OAuth session rejected',{method:'otp'},403);
await test('OAuth session without Discord identity rejected',{noDiscord:true},403);
await test('missing current Discord provider proof rejected',{missingProvider:true},403);
await test('invalid current Discord provider proof rejected',{invalidProvider:true},403,{providers:1});
await test('different current Discord user rejected',{providerMismatch:true},403,{providers:1});
await test('non-member cannot register a Portal session',{notMember:true},403,{providers:1,members:1});
await test('inactive profile rejected',{staffActive:false},403,{providers:1,members:1});
await test('shared workstation cannot become human Discord staff',{accountType:'shared_workstation'},403,{providers:1,members:1});
await test('automation cannot become human Discord staff',{accountType:'automation'},403,{providers:1,members:1});
await test('mismatched linked profile rejected',{mismatch:true},403,{providers:1,members:1});
await test('valid current Discord staff session accepted',{},200,{providers:1,members:1,writes:2,humanSessions:1});
await test('Discord can be linked as fallback without relabeling a Workspace session',{linkOnly:true},200,{providers:1,members:1,writes:2,humanSessions:0});
await test('foreign origin rejected before authentication',{origin:'https://example.invalid'},403);
await test('unsupported method rejected',{httpMethod:'GET'},405);
const migration=fs.readFileSync(new URL('../supabase/migrations/20260918151200_portal_auth_session_active_prerequisite.sql',import.meta.url),'utf8');
assert.match(migration,/s\.id = session_id/);
assert.match(migration,/s\.user_id = caller_id/);
assert.match(migration,/s\.not_after is null or s\.not_after > now\(\)/);
assert.match(migration,/set search_path = pg_catalog/);
assert.match(migration,/from public, anon, service_role/);
assert.match(migration,/grant execute[^;]+to authenticated/);
assert.doesNotMatch(migration,/\b(insert into|delete from|update public\.|update auth\.)/i);
console.log(JSON.stringify({ok:true,discordCases:passed,prerequisiteContractAssertions:7,network:'mocked only',productionWrites:0}));
