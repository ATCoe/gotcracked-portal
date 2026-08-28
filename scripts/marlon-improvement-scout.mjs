import fs from 'node:fs';
import path from 'node:path';

const AUDIENCE='gotcracked-marlon-executor';
const BRIDGE='https://uvpmmbioerejeyybfntb.supabase.co/functions/v1/marlon-executor-bridge';
const SCOUT='https://crackwave-ai.austncoe.workers.dev/executor/improvements';
const PORTAL_URL='https://portal.gotcracked.co/';
const WEBSITE_URL='https://gotcracked.co/';

async function oidc(){
  const base=process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const auth=process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if(!base||!auth) throw new Error('GitHub OIDC environment is unavailable.');
  const url=`${base}${base.includes('?')?'&':'?'}audience=${encodeURIComponent(AUDIENCE)}`;
  const res=await fetch(url,{headers:{Authorization:`Bearer ${auth}`}});
  if(!res.ok) throw new Error(`GitHub OIDC request failed (${res.status}).`);
  const body=await res.json();
  if(!body?.value) throw new Error('GitHub OIDC token missing.');
  return body.value;
}

async function post(url,token,body){
  const res=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const text=await res.text();
  let parsed={};
  try{parsed=text?JSON.parse(text):{};}catch{parsed={error:text};}
  if(!res.ok) throw new Error(parsed?.error||`${url} failed (${res.status}).`);
  return parsed;
}

function snapshotFiles(root,files,maxEach=7000){
  const out=[];
  for(const rel of files){
    const full=path.join(root,rel);
    if(!fs.existsSync(full)||!fs.statSync(full).isFile()) continue;
    out.push({path:rel,content:fs.readFileSync(full,'utf8').slice(0,maxEach)});
  }
  return out;
}

async function liveSnapshot(url){
  try{
    const res=await fetch(`${url}${url.includes('?')?'&':'?'}marlon-scout=${Date.now()}`,{headers:{'Cache-Control':'no-cache','User-Agent':'GotCracked-Marlon-Scout'}});
    const body=await res.text();
    return {url,status:res.status,ok:res.ok,contentType:res.headers.get('content-type'),html:body.slice(0,10000)};
  }catch(error){
    return {url,status:0,ok:false,error:String(error?.message||error),html:''};
  }
}

async function main(){
  const token=await oidc();
  const existing=await post(BRIDGE,token,{action:'proposal_context'});
  const portalFiles=snapshotFiles('.',[
    'index.html','app.js','master-directory.js','operations-v1-core.js','workflow.js','portal-mobile-audit.js','marlon-support.js','marlon-releases.js'
  ]);
  const siteFiles=snapshotFiles('site',[
    'index.html','app.js','request.html','appointment.html','customer-chat.js','pc-build.html','pc-build.js','store-hours.js'
  ]);
  const [portalLive,websiteLive]=await Promise.all([liveSnapshot(PORTAL_URL),liveSnapshot(WEBSITE_URL)]);
  const evidence={
    reviewedAt:new Date().toISOString(),
    architecturePolicy:'Improve or extend existing architecture only. Never regress or remove working capability.',
    existingMarlonProposals:(existing.proposals||[]).slice(0,100),
    portal:{repository:'ATCoe/gotcracked-portal',live:portalLive,files:portalFiles},
    website:{repository:'ATCoe/gotcracked-site',live:websiteLive,files:siteFiles}
  };
  const result=await post(SCOUT,token,{evidence});
  const proposals=Array.isArray(result.proposals)?result.proposals.slice(0,2):[];
  const created=[];
  for(const proposal of proposals){
    const saved=await post(BRIDGE,token,{action:'create_proposal',proposal});
    if(saved?.proposal?.id) created.push({id:saved.proposal.id,title:saved.proposal.title,state:saved.proposal.owner_review_state});
  }
  console.log(JSON.stringify({ok:true,model:result.model,proposed:proposals.length,saved:created},null,2));
}

main().catch(error=>{console.error(error);process.exitCode=1;});
