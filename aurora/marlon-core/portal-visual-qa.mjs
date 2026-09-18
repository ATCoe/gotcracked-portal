#!/usr/bin/env node
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';

const target=process.argv[2]||'https://portal.gotcracked.co/';
const out=process.argv[3]||path.join(process.cwd(),'visual-artifacts');
const chromium=process.env.CHROMIUM_BIN||'/snap/bin/chromium';
const timeoutMs=Number(process.env.VISUAL_QA_TIMEOUT_MS||30000);
await fs.mkdir(out,{recursive:true,mode:0o700});

function run(args){return new Promise((resolve,reject)=>{const child=spawn(chromium,args,{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';const timer=setTimeout(()=>{child.kill('SIGTERM');reject(new Error('visual QA timed out'));},timeoutMs);child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.on('error',reject);child.on('close',code=>{clearTimeout(timer);if(code===0)resolve({stdout,stderr});else reject(new Error(`chromium exited ${code}: ${stderr.slice(-800)}`));});});}
const stamp=new Date().toISOString().replaceAll(':','-');
const findings=[];
for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844]]){
  const screenshot=path.join(out,`${stamp}-${name}.png`);
  const dom=path.join(out,`${stamp}-${name}.html`);
  const args=['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--user-data-dir=/tmp/marlon-visual-qa',`--window-size=${width},${height}`,`--screenshot=${screenshot}`,'--dump-dom',target];
  const result=await run(args);
  await fs.writeFile(dom,result.stdout,{mode:0o600});
  const html=result.stdout;
  if(/Loading (your dashboard|live operating alerts|staff…)/i.test(html)) findings.push(`${name}: persistent loading-state text`);
  if(/overflow-x|width:\s*\d{4,}px/i.test(html)) findings.push(`${name}: suspicious overflow/oversized layout evidence`);
}
const report={ok:true,target,createdAt:new Date().toISOString(),artifacts:out,findings};
await fs.writeFile(path.join(out,`${stamp}-report.json`),JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(report));
