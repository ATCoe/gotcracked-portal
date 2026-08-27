import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const AUDIENCE='gotcracked-marlon-executor';
const BRIDGE='https://uvpmmbioerejeyybfntb.supabase.co/functions/v1/marlon-executor-bridge';
const PLANNER='https://crackwave-ai.austncoe.workers.dev/executor/plan';
const STATE='.marlon-executor-state.json';
const REPO='ATCoe/gotcracked-portal';
const LIVE='https://portal.gotcracked.co';
const TEXT_EXT=new Set(['.js','.css','.html','.json']);
const STOP=new Set(['this','that','with','from','have','need','full','done','portal','website','find','fix','bugs','issues','open','coding','update','thing','noticed','make','into','when','they','them','your','marlon']);

const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const sha256=(text)=>crypto.createHash('sha256').update(text).digest('hex');
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();

function output(name,value){
  if(process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT,`${name}=${String(value).replace(/\r?\n/g,' ')}\n`);
}

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
  const res=await fetch(url,{
    method:'POST',
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify(body)
  });
  const text=await res.text();
  let parsed={};
  try{ parsed=text?JSON.parse(text):{}; }catch{ parsed={error:text}; }
  if(!res.ok) throw new Error(parsed?.error||`${url} failed (${res.status}).`);
  return parsed;
}

async function report(token,runId,status,extra={}){
  return post(BRIDGE,token,{action:'report',runId,status,...extra});
}

function ticketWords(ticket){
  const raw=[ticket.title,ticket.description,JSON.stringify(ticket.context||{})].join(' ').toLowerCase();
  return [...new Set((raw.match(/[a-z0-9_-]{4,}/g)||[]).filter(w=>!STOP.has(w)))];
}

function protectedPath(file){
  const v=file.toLowerCase();
  return /(^|\/)(\.github|supabase|cloudflare|database)(\/|$)/.test(v)
    || /(auth|payment|billing|secret|credential|permission|rls|migration|deploy|wrangler|supabase)/.test(v);
}

function protectedTicket(ticket){
  const raw=[ticket.title,ticket.description,ticket.category,ticket.surface,JSON.stringify(ticket.context||{})].join(' ').toLowerCase();
  const status=String(ticket.context?.status||'');
  return ['401','403'].includes(status) || /\b(authentication|authorization|permission|permissions|rls|payment|billing|secret|credential|schema|migration|deploy|deployment)\b/.test(raw);
}

function candidateFiles(ticket){
  const words=ticketWords(ticket);
  const rows=[];
  for(const item of fs.readdirSync('.', {withFileTypes:true})){
    if(!item.isFile()||!TEXT_EXT.has(path.extname(item.name).toLowerCase())) continue;
    if(item.name===STATE) continue;
    const content=fs.readFileSync(item.name,'utf8');
    const lower=content.toLowerCase();
    let score=0;
    for(const word of words){
      if(item.name.toLowerCase().includes(word)) score+=12;
      if(lower.includes(word)) score+=Math.min(5,(lower.split(word).length-1));
    }
    if(/directory|filter/.test(words.join(' ')) && /master-directory|directory-advanced/.test(item.name)) score+=40;
    if(/mobile/.test(words.join(' ')) && /mobile/.test(item.name)) score+=35;
    if(/dashboard/.test(words.join(' ')) && /dashboard|index/.test(item.name)) score+=30;
    if(/support|marlon/.test(words.join(' ')) && /marlon|support/.test(item.name)) score+=30;
    if(score>0) rows.push({path:item.name,content:content.slice(0,14000),score});
  }
  rows.sort((a,b)=>b.score-a.score||a.path.localeCompare(b.path));
  const fallback=['index.html','app.js','portal-runtime-loader.js','portal-v1-release.css'];
  for(const file of fallback){
    if(rows.some(r=>r.path===file)||!fs.existsSync(file)) continue;
    rows.push({path:file,content:fs.readFileSync(file,'utf8').slice(0,14000),score:0});
  }
  return rows.slice(0,8).map(({path,content})=>({path,content}));
}

function applyPlan(ticket,candidates,plan){
  const allowed=new Map(candidates.map(c=>[c.path,c]));
  const changed=[];
  for(const edit of (plan.edits||[])){
    const file=String(edit?.path||'');
    const find=String(edit?.find||'');
    const replace=String(edit?.replace??'');
    if(!allowed.has(file)||!find) throw new Error(`Unsafe or unknown edit target: ${file}`);
    if(ticket.change_level!=='high_level'&&protectedPath(file)) throw new Error(`Protected file requires high-level approval: ${file}`);
    const source=fs.readFileSync(file,'utf8');
    const first=source.indexOf(find);
    const second=first<0?-1:source.indexOf(find,first+find.length);
    if(first<0||second>=0) throw new Error(`Edit anchor is not unique in ${file}.`);
    fs.writeFileSync(file,source.slice(0,first)+replace+source.slice(first+find.length));
    changed.push(file);
  }
  return [...new Set(changed)];
}

async function prepare(){
  const token=await oidc();
  const claim=await post(BRIDGE,token,{action:'claim'});
  const ticket=claim.ticket;
  if(!ticket){ output('has_work','false'); return; }
  const runId=claim.run?.id;
  output('ticket_number',ticket.ticket_number);
  if(ticket.change_level!=='high_level' && protectedTicket(ticket)){
    await report(token,runId,'blocked',{diagnosis:'This ticket touches authentication, authorization, payments, schema/deployment, or another protected surface.',error:'Protected execution requires a separately Owner-approved high-level request.'});
    output('has_work','false');
    return;
  }
  try{
    await report(token,runId,'diagnosing',{metadata:{prior_history_count:(claim.history||[]).length}});
    const candidates=candidateFiles(ticket);
    const ticketWithHistory={...ticket,prior_history:claim.history||[]};
    const planned=await post(PLANNER,token,{ticket:ticketWithHistory,candidates});
    const plan=planned.plan||{};
    if(!Array.isArray(plan.edits)||plan.edits.length===0){
      await report(token,runId,'blocked',{diagnosis:plan.diagnosis||null,error:plan.blocker||'No deterministic safe patch was produced.',metadata:{prior_history_count:(claim.history||[]).length}});
      output('has_work','false'); return;
    }
    const changed=applyPlan(ticket,candidates,plan);
    const patchSummary=plan.edits.map(e=>`${e.path}: ${e.reason||'bounded repair'}`).join('; ').slice(0,3500);
    await report(token,runId,'patching',{diagnosis:plan.diagnosis||null,patchSummary,metadata:{changed_paths:changed,prior_history_count:(claim.history||[]).length}});
    fs.writeFileSync(STATE,JSON.stringify({runId,ticketNumber:ticket.ticket_number,baseSha:git('rev-parse','HEAD'),diagnosis:plan.diagnosis||'',patchSummary,changedPaths:changed,verificationPlan:plan.verification||[]},null,2));
    output('has_work','true');
  }catch(error){
    await report(token,runId,'failed',{error:String(error?.message||error)}).catch(()=>{});
    throw error;
  }
}
async function dispatchWorkflow(file,ref,token){
  const res=await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${encodeURIComponent(file)}/dispatches`,{
    method:'POST',
    headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},
    body:JSON.stringify({ref})
  });
  if(!res.ok) throw new Error(`Failed to dispatch ${file} (${res.status}): ${await res.text()}`);
}

async function waitWorkflow(file,sha,startedAt,token){
  for(let i=0;i<48;i++){
    const res=await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${encodeURIComponent(file)}/runs?event=workflow_dispatch&per_page=20`,{
      headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}
    });
    if(!res.ok) throw new Error(`Unable to read ${file} runs (${res.status}).`);
    const body=await res.json();
    const run=(body.workflow_runs||[]).find(r=>r.head_sha===sha && Date.parse(r.created_at)>=startedAt-30000);
    if(run?.status==='completed'){
      if(run.conclusion!=='success') throw new Error(`${file} concluded ${run.conclusion||'unsuccessfully'}.`);
      return {workflow:file,run_id:run.id,conclusion:run.conclusion};
    }
    await sleep(10000);
  }
  throw new Error(`${file} did not complete within 8 minutes.`);
}

async function checks(branch){
  const state=JSON.parse(fs.readFileSync(STATE,'utf8'));
  const idToken=await oidc();
  const apiToken=process.env.GITHUB_TOKEN;
  if(!apiToken) throw new Error('GitHub workflow token missing.');
  const sha=git('rev-parse','HEAD');
  await report(idToken,state.runId,'testing',{commitSha:sha,metadata:{branch}});
  const workflows=['portal-ci.yml','production-guard.yml','full-source-audit.yml'];
  const startedAt=Date.now();
  for(const file of workflows) await dispatchWorkflow(file,branch,apiToken);
  const results=[];
  for(const file of workflows) results.push(await waitWorkflow(file,sha,startedAt,apiToken));
  state.branch=branch;
  state.commitSha=sha;
  state.checks=results;
  fs.writeFileSync(STATE,JSON.stringify(state,null,2));
}

async function verifyLive(state){
  const wanted=state.changedPaths.filter(p=>TEXT_EXT.has(path.extname(p).toLowerCase()));
  const pending=new Set(wanted);
  for(let attempt=0;attempt<24 && pending.size;attempt++){
    for(const file of [...pending]){
      const local=fs.readFileSync(file,'utf8');
      const url=`${LIVE}/${file}?marlon=${encodeURIComponent(state.commitSha)}-${attempt}`;
      try{
        const res=await fetch(url,{headers:{'Cache-Control':'no-cache'}});
        if(res.ok && sha256(await res.text())===sha256(local)) pending.delete(file);
      }catch{}
    }
    if(pending.size) await sleep(10000);
  }
  if(pending.size) throw new Error(`Cloudflare live verification timed out for: ${[...pending].join(', ')}`);
  return {verified_files:wanted,verified_at:new Date().toISOString()};
}

async function complete(){
  const state=JSON.parse(fs.readFileSync(STATE,'utf8'));
  const token=await oidc();
  const sha=git('rev-parse','HEAD');
  state.commitSha=sha;
  await report(token,state.runId,'deploying',{commitSha:sha,metadata:{branch:state.branch,checks:state.checks||[]}});
  try{
    const live=await verifyLive(state);
    await report(token,state.runId,'verifying',{commitSha:sha,deploymentUrl:LIVE,verification:{checks:state.checks||[],...live}});
    await report(token,state.runId,'completed',{diagnosis:state.diagnosis,patchSummary:state.patchSummary,resolution:'Implemented, passed Portal CI, Production Guard, and Full Source Audit, then verified on the live Cloudflare deployment.',commitSha:sha,deploymentUrl:LIVE,verification:{checks:state.checks||[],...live}});
  }catch(error){
    await report(token,state.runId,'failed',{commitSha:sha,error:String(error?.message||error),verification:{checks:state.checks||[]}}).catch(()=>{});
    throw error;
  }
}
async function fail(message){
  if(!fs.existsSync(STATE)) return;
  const state=JSON.parse(fs.readFileSync(STATE,'utf8'));
  const token=await oidc();
  await report(token,state.runId,'failed',{commitSha:state.commitSha||null,error:message||'Executor workflow failed.',verification:{checks:state.checks||[]}}).catch(()=>{});
}

const command=process.argv[2]||'prepare';
try{
  if(command==='prepare') await prepare();
  else if(command==='checks') await checks(process.argv[3]);
  else if(command==='complete') await complete();
  else if(command==='fail') await fail(process.argv.slice(3).join(' '));
  else throw new Error(`Unknown executor command: ${command}`);
}catch(error){
  console.error(error);
  process.exitCode=1;
}
