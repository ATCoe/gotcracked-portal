import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const ANON_KEY=Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||Deno.env.get("SUPABASE_SECRET_KEY")||"";
const PORTAL_ORIGIN="https://portal.gotcracked.co";
const SOURCE_NAME="mobilesentrix";
const DEFAULT_BASE="https://www.mobilesentrix.com";
const AURORA_RELAY="https://auroraserver.tail317407.ts.net/internal/mobilesentrix-relay";
const cors={"Access-Control-Allow-Origin":PORTAL_ORIGIN,"Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const clean=(v:unknown)=>String(v??"").trim();
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
const enc=(v:unknown)=>encodeURIComponent(String(v??"")).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function nonce(){const b=new Uint8Array(18);crypto.getRandomValues(b);return Array.from(b,x=>x.toString(16).padStart(2,"0")).join("");}
async function hmac(key:string,data:string){const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(key),{name:"HMAC",hash:"SHA-1"},false,["sign"]);const sig=await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(data));return btoa(String.fromCharCode(...new Uint8Array(sig)));}
function safeBase(v:unknown){const u=new URL(clean(v)||DEFAULT_BASE);if(u.origin!==DEFAULT_BASE||u.username||u.password)throw new Error("Invalid MobileSentrix API base URL.");return u.origin;}
function hasConsumer(s:any){return Boolean(clean(s?.consumer_key??s?.consumerKey)&&clean(s?.consumer_secret??s?.consumerSecret));}

async function oauthHeader(method:string,url:URL,secret:any,extra:Record<string,string>={},token="",tokenSecret=""){
  const consumerKey=clean(secret?.consumer_key??secret?.consumerKey), consumerSecret=clean(secret?.consumer_secret??secret?.consumerSecret);
  if(!consumerKey||!consumerSecret)throw new Error("MobileSentrix consumer credentials are missing.");
  const oauth:Record<string,string>={oauth_consumer_key:consumerKey,oauth_nonce:nonce(),oauth_signature_method:"HMAC-SHA1",oauth_timestamp:String(Math.floor(Date.now()/1000)),oauth_version:"1.0",...extra};
  if(token)oauth.oauth_token=token;
  const params=[...Array.from(url.searchParams.entries()),...Object.entries(oauth)].map(([k,v])=>[enc(k),enc(v)] as const).sort(([a,b],[c,d])=>a===c?(b<d?-1:b>d?1:0):(a<c?-1:a>c?1:0));
  const normalized=params.map(([k,v])=>`${k}=${v}`).join("&");
  const base=`${url.origin}${url.pathname}`;
  const signatureBase=[method.toUpperCase(),enc(base),enc(normalized)].join("&");
  oauth.oauth_signature=await hmac(`${enc(consumerSecret)}&${enc(tokenSecret)}`,signatureBase);
  return "OAuth "+Object.entries(oauth).sort(([a],[b])=>(a<b?-1:a>b?1:0)).map(([k,v])=>`${enc(k)}=\"${enc(v)}\"`).join(", ");
}

async function readSecret(admin:any,id:string|null){if(!id)return null;const r=await admin.rpc("server_read_vendor_secret",{p_secret_id:id});if(r.error||!r.data)return null;try{return JSON.parse(r.data);}catch{return null;}}
async function storeSecret(admin:any,secret:any){const r=await admin.rpc("server_store_vendor_secret",{p_source_name:SOURCE_NAME,p_secret:JSON.stringify(secret)});if(r.error)throw r.error;return r.data;}
async function mark(admin:any,patch:Record<string,unknown>){const r=await admin.from("part_registry_sync_sources").update({...patch,updated_at:new Date().toISOString()}).eq("source_name",SOURCE_NAME);if(r.error)throw r.error;}
function oauthError(stage:string,status:number,ctype:string,text:string){
  let detail="";
  if(ctype.includes("application/x-www-form-urlencoded")){
    const form=new URLSearchParams(text);detail=form.get("oauth_problem")||form.get("error")||"";
  }else if(/text\/html/i.test(ctype))detail="Supplier returned an HTML challenge or error page.";
  return `MobileSentrix ${stage} failed (HTTP ${status})${detail?`: ${detail.replace(/[^a-zA-Z0-9 _.-]/g,"").slice(0,180)}`:""}`;
}

async function relayOauth(portalAuthorization:string,path:string,vendorAuthorization:string,body="") {
  const relay=await fetch(AURORA_RELAY,{
    method:"POST",
    headers:{Authorization:portalAuthorization,"Content-Type":"application/json",Accept:"application/json"},
    body:JSON.stringify({path,vendorAuthorization,body}),
    signal:AbortSignal.timeout(30000)
  });
  const payload=await relay.json().catch(()=>null);
  if(!payload||(!relay.ok&&!Number.isInteger(payload.status)))throw new Error(payload?.error||`AuroraServer OAuth relay failed (HTTP ${relay.status}).`);
  return payload;
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return reply({ok:false,error:"Method not allowed"},405);
  if(!SERVICE_KEY)return reply({ok:false,error:"OAuth service is not configured."},500);
  const authorization=req.headers.get("Authorization")||"";
  const userClient=createClient(SUPABASE_URL,ANON_KEY,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const admin=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:userError}=await userClient.auth.getUser();
  if(userError||!user)return reply({ok:false,error:"Invalid Portal session"},401);
  const profileRes=await admin.from("profiles").select("id,role,active").eq("id",user.id).maybeSingle();
  if(!profileRes.data?.active)return reply({ok:false,error:"Active staff profile required"},403);
  const [inv,setg]=await Promise.all([userClient.rpc("has_permission",{permission_key:"inventory.manage"}),userClient.rpc("has_permission",{permission_key:"settings.manage"})]);
  if(inv.error||setg.error||(inv.data!==true&&setg.data!==true))return reply({ok:false,error:"Inventory management permission required"},403);
  let body:any={};try{body=await req.json();}catch{return reply({ok:false,error:"Invalid request"},400);}
  const sourceRes=await admin.from("part_registry_sync_sources").select("*").eq("source_name",SOURCE_NAME).maybeSingle();
  if(sourceRes.error||!sourceRes.data)return reply({ok:false,error:"MobileSentrix sync source is missing"},500);
  const source=sourceRes.data, config=source.config||{}, action=clean(body.action);
  let sessionId="";
  try{sessionId=JSON.parse(atob(authorization.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"))).session_id||"";}catch{}
  if(!sessionId)return reply({ok:false,error:"Portal session could not be verified."},401);
  const saved=await readSecret(admin,source.secret_id);

  try{
    if(action==="oauth_start"){
      if(!hasConsumer(saved))return reply({ok:false,error:"Save the MobileSentrix consumer key and secret first."},400);
      const base=safeBase(config.api_base_url||DEFAULT_BASE), callback=clean(config.oauth_callback_url||`${PORTAL_ORIGIN}/?mobilesentrix_oauth=callback`);
      const initiate=new URL(clean(config.oauth_initiate_path||"/oauth/initiate"),base+"/");
      if(initiate.origin!==DEFAULT_BASE||initiate.pathname!=="/oauth/initiate"||initiate.search||callback!==`${PORTAL_ORIGIN}/?mobilesentrix_oauth=callback`)throw new Error("MobileSentrix OAuth endpoint or callback is not approved.");
      const auth=await oauthHeader("POST",initiate,saved,{oauth_callback:callback});
      const vendor=await relayOauth(authorization,initiate.pathname,auth,"");
      const text=String(vendor.text||"");
      if(!vendor.ok)throw new Error(oauthError("OAuth request-token exchange",Number(vendor.status||502),String(vendor.contentType||""),text));
      const q=new URLSearchParams(text), requestToken=clean(q.get("oauth_token")), requestSecret=clean(q.get("oauth_token_secret"));
      if(!requestToken||!requestSecret)return reply({ok:false,error:"MobileSentrix did not return an OAuth request token."},502);
      const secretId=await storeSecret(admin,{...saved,request_token:requestToken,request_token_secret:requestSecret,request_user_id:user.id,request_session_id:sessionId,request_expires_at:new Date(Date.now()+15*60*1000).toISOString()});
      await mark(admin,{secret_id:secretId,last_status:"authorizing",last_error:null});
      const authorize=new URL(clean(config.oauth_authorize_path||"/oauth/authorize"),base+"/");
      if(authorize.origin!==DEFAULT_BASE||authorize.pathname!=="/oauth/authorize"||authorize.search)throw new Error("MobileSentrix authorization URL is not approved.");
      authorize.searchParams.set("oauth_token",requestToken);
      return reply({ok:true,authorizeUrl:authorize.toString()});
    }
    if(action==="oauth_complete"){
      const requestToken=clean(saved?.request_token),requestSecret=clean(saved?.request_token_secret),returned=clean(body.oauth_token),verifier=clean(body.oauth_verifier);
      if(!requestToken||!requestSecret||returned!==requestToken||!verifier||saved?.request_user_id!==user.id||saved?.request_session_id!==sessionId||!(Date.parse(saved?.request_expires_at)>Date.now()))return reply({ok:false,error:"MobileSentrix OAuth callback could not be verified."},400);
      const base=safeBase(config.api_base_url||DEFAULT_BASE), tokenUrl=new URL(clean(config.oauth_token_path||"/oauth/token"),base+"/");
      if(tokenUrl.origin!==DEFAULT_BASE||tokenUrl.pathname!=="/oauth/token"||tokenUrl.search)throw new Error("MobileSentrix OAuth token endpoint is not approved.");
      const auth=await oauthHeader("POST",tokenUrl,saved,{oauth_verifier:verifier},requestToken,requestSecret);
      const vendor=await relayOauth(authorization,tokenUrl.pathname,auth,"");
      const text=String(vendor.text||"");
      if(!vendor.ok)throw new Error(oauthError("OAuth access-token exchange",Number(vendor.status||502),String(vendor.contentType||""),text));
      const q=new URLSearchParams(text),access=clean(q.get("oauth_token")),accessSecret=clean(q.get("oauth_token_secret"));
      if(!access||!accessSecret)return reply({ok:false,error:"MobileSentrix did not return an OAuth access token."},502);
      const final={...saved,access_token:access,access_token_secret:accessSecret};for(const key of ["request_token","request_token_secret","request_user_id","request_session_id","request_expires_at"])delete final[key];
      const secretId=await storeSecret(admin,final);await mark(admin,{secret_id:secretId,last_status:"idle",last_error:null});return reply({ok:true,apiReady:true});
    }
    if(action==="oauth_cancel"){
      if(saved?.request_token&&(saved.request_user_id!==user.id||saved.request_session_id!==sessionId))return reply({ok:false,error:"This authorization belongs to another Portal session."},403);
      if(saved){for(const key of ["request_token","request_token_secret","request_user_id","request_session_id","request_expires_at"])delete saved[key];const secretId=await storeSecret(admin,saved);await mark(admin,{secret_id:secretId,last_status:saved.access_token?"idle":"not_configured",last_error:null});}
      return reply({ok:true});
    }
    return reply({ok:false,error:"Unknown MobileSentrix OAuth action"},400);
  }catch(error){const message=error instanceof Error?error.message:"MobileSentrix OAuth failed";await mark(admin,{last_status:"error",last_error:message}).catch(()=>{});return reply({ok:false,error:message},500);}
});
