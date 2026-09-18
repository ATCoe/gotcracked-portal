#!/usr/bin/env node
// Read-only production evidence for Marlon's Portal audit.  It intentionally
// reports booleans/counts only: no tokens, customer records, or user details.
import fs from 'node:fs';

function loadServiceEnvironment(){
  // Direct invocations do not inherit systemd's EnvironmentFile. Parse only
  // simple KEY=VALUE lines and never print the resulting values.
  try{
    for(const line of fs.readFileSync(new URL('./.env',import.meta.url),'utf8').split(/\r?\n/)){
      const match=line.match(/^([A-Z0-9_]+)=(.*)$/);
      if(match&&!process.env[match[1]]) process.env[match[1]]=match[2].replace(/^['"]|['"]$/g,'');
    }
  }catch{}
}
loadServiceEnvironment();
const portalUrl=(process.env.PORTAL_URL||'https://portal.gotcracked.co').replace(/\/$/,'');
const supabaseUrl=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const now=()=>new Date().toISOString();

async function request(url,init={}){
  const response=await fetch(url,{...init,signal:AbortSignal.timeout(15000)});
  return {status:response.status,ok:response.ok,headers:Object.fromEntries([...response.headers].filter(([key])=>['content-type','cache-control','cf-cache-status'].includes(key.toLowerCase()))) };
}

async function supabase(path){
  if(!supabaseUrl||!serviceKey) return {available:false,reason:'Supabase service credentials are unavailable to the audit runner.'};
  try{
    const response=await fetch(`${supabaseUrl}${path}`,{headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`},signal:AbortSignal.timeout(15000)});
    const body=response.ok?await response.json():null;
    return {available:response.ok,status:response.status,body};
  }catch(error){return {available:false,reason:String(error?.message||error)};}
}

const report={checkedAt:now(),surface:'Portal backend',checks:{},findings:[]};
try{report.checks.portal=await request(`${portalUrl}/`);}catch(error){report.checks.portal={ok:false,error:String(error?.message||error)};}
try{report.checks.authSettings=await request(`${supabaseUrl}/auth/v1/settings`,{headers:{apikey:serviceKey}});}catch(error){report.checks.authSettings={ok:false,error:String(error?.message||error)};}
try{
  const unsigned=await request(`${supabaseUrl}/functions/v1/discord-outbox-delivery`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  report.checks.outboxFunction={...unsigned,ok:unsigned.status===401,expectedUnauthenticatedStatus:401};
}catch(error){report.checks.outboxFunction={ok:false,error:String(error?.message||error)};}

const profiles=await supabase('/rest/v1/profiles?select=id&active=eq.true&limit=2');
report.checks.activeProfileAccess={ok:profiles.available,status:profiles.status};
const workstation=await supabase('/rest/v1/profiles?select=id&account_type=eq.shared_workstation&active=eq.true&limit=2');
report.checks.sharedWorkstationProfile={ok:workstation.available,status:workstation.status,configured:Array.isArray(workstation.body)&&workstation.body.length===1};
const discord=await supabase('/rest/v1/marlon_discord_config?select=location_id&limit=2');
report.checks.marlonDiscordRouting={ok:discord.available,status:discord.status,configured:Array.isArray(discord.body)&&discord.body.length>=1};

for(const [name,check] of Object.entries(report.checks)){
  if(check?.ok===false) report.findings.push(`${name} failed${check.status?` (${check.status})`:''}.`);
}
if(!report.checks.sharedWorkstationProfile?.configured) report.findings.push('A single active shared-workstation profile was not confirmed.');
if(!report.checks.marlonDiscordRouting?.configured) report.findings.push('Marlon Discord routing configuration was not confirmed.');
report.ok=report.findings.length===0;
console.log(JSON.stringify(report,null,2));
