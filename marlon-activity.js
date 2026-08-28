(()=>{
  'use strict';
  if(window.GotCrackedMarlonActivity)return;
  const client=window.supabaseClient;if(!client)return;
  const ACTIVE_TICKET=new Set(['open','in_progress','waiting','waiting_window']);
  const ACTIVE_RUN=new Set(['claimed','diagnosing','patching','testing','deploying','verifying']);
  const RECENT_COMPLETE_MS=10*60*1000;
  let profile=null,channel=null,pollTimer=null,refreshTimer=null,lastModel=null;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const code=n=>n?`SUP-${String(n).padStart(4,'0')}`:'Marlon task';
  const short=v=>String(v||'').replace(/^Marlon high-level change:\s*/i,'').trim();
  const age=value=>{
    if(!value)return 'not started';const ms=Date.now()-Date.parse(value);if(!Number.isFinite(ms))return 'unknown';
    const s=Math.max(0,Math.floor(ms/1000));if(s<5)return 'just now';if(s<60)return `${s}s ago`;
    const m=Math.floor(s/60);if(m<60)return `${m}m ago`;return `${Math.floor(m/60)}h ago`;
  };
  const stageLabel=value=>({claimed:'Starting',diagnosing:'Diagnosing',patching:'Applying patch',testing:'Testing',waiting_window:'Waiting for window',deploying:'Deploying',verifying:'Verifying',completed:'Complete',blocked:'Blocked',failed:'Failed'}[value]||'Queued');
  function ensureUi(){
    const marlon=document.querySelector('.gc-marlon');if(!marlon)return null;
    let host=marlon.querySelector('.gc-marlon-activity');if(host)return host;
    host=document.createElement('section');host.className='gc-marlon-activity';
    host.innerHTML='<button type="button" class="gc-marlon-activity-pill" aria-expanded="false"><span class="gc-marlon-activity-dot"></span><span class="gc-marlon-activity-label">Marlon · Checking</span></button><div class="gc-marlon-activity-panel" hidden></div>';
    marlon.prepend(host);
    const button=host.querySelector('.gc-marlon-activity-pill');const panel=host.querySelector('.gc-marlon-activity-panel');
    button.addEventListener('click',()=>{const open=panel.hidden;panel.hidden=!open;button.setAttribute('aria-expanded',String(open));if(open)void refresh(true)});
    document.addEventListener('click',event=>{if(!host.contains(event.target)){panel.hidden=true;button.setAttribute('aria-expanded','false')}});
    return host;
  }
  function chooseTask(tickets){
    const parents=tickets.filter(t=>!t.parent_ticket_id);
    const active=parents.find(t=>ACTIVE_TICKET.has(String(t.status))&&t.approval_status!=='denied');if(active)return active;
    const pending=parents.find(t=>t.approval_status==='pending');if(pending)return pending;
    const latest=parents[0]||null;if(!latest)return null;
    if(['resolved','closed'].includes(String(latest.status))){
      const completedAt=Date.parse(latest.resolved_at||latest.updated_at||latest.created_at||0);
      if(Number.isFinite(completedAt)&&Date.now()-completedAt>RECENT_COMPLETE_MS)return null;
    }
    return latest;
  }
  function modelStatus(task,children,runs){
    if(!task)return {key:'idle',label:'Idle'};
    if(task.approval_status==='pending')return {key:'approval',label:'Needs approval'};
    const targets=children.length?children:[task];
    if(targets.length&&targets.every(t=>['resolved','closed'].includes(String(t.status))))return {key:'complete',label:'Complete'};
    const latestRuns=targets.map(t=>latestRun(t,runs)).filter(Boolean);
    if(latestRuns.some(r=>ACTIVE_RUN.has(String(r.status))))return {key:'working',label:'Working'};
    if(latestRuns.some(r=>r.status==='waiting_window'))return {key:'waiting',label:'Waiting'};
    if(latestRuns.some(r=>r.status==='blocked'||r.status==='failed'))return {key:'attention',label:'Needs attention'};
    if(task.approval_status==='approved'&&targets.some(t=>ACTIVE_TICKET.has(String(t.status))))return {key:'queued',label:'Queued'};
    return {key:'idle',label:'Idle'};
  }
  function latestRun(ticket,runs){
    return runs.filter(r=>r.ticket_id===ticket.id).sort((a,b)=>Date.parse(b.heartbeat_at||b.started_at||0)-Date.parse(a.heartbeat_at||a.started_at||0))[0]||null;
  }
  function targetRow(ticket,runs){
    const resolved=['resolved','closed'].includes(String(ticket.status));
    const run=resolved?null:latestRun(ticket,runs);
    const stage=resolved?'completed':run?.status||'queued';
    const heartbeat=resolved?(ticket.resolved_at||ticket.updated_at||null):(run?.heartbeat_at||run?.started_at||null);
    const activityLabel=heartbeat?`${resolved?'updated':'heartbeat'} ${age(heartbeat)}`:'awaiting worker pickup';
    return `<div class="gc-marlon-activity-target" data-stage="${esc(stage)}"><span class="gc-marlon-target-dot"></span><div><strong>${esc(ticket.surface==='website'?'Website':ticket.surface==='portal'?'Portal':ticket.surface||'Task')} · ${esc(code(ticket.ticket_number))}</strong><small>${esc(stageLabel(stage))} · ${esc(activityLabel)}</small></div></div>`;
  }
  function render(model){
    lastModel=model;const host=ensureUi();if(!host)return;
    const {task,children,runs,status}=model;host.dataset.state=status.key;
    host.querySelector('.gc-marlon-activity-label').textContent=`Marlon · ${status.label}`;
    const panel=host.querySelector('.gc-marlon-activity-panel');
    if(!task){panel.innerHTML='<strong>Marlon activity</strong><p>No active Marlon task right now.</p>';return}
    const targets=children.length?children:[task];
    const lastHeartbeat=runs.map(r=>r.heartbeat_at||r.started_at).filter(Boolean).sort().at(-1)||null;
    panel.innerHTML=`<header><span><b>Marlon activity</b><small>${esc(status.label)}</small></span><b>${esc(code(task.ticket_number))}</b></header><p class="gc-marlon-activity-task">${esc(short(task.context?.requested_scope||task.title))}</p><div class="gc-marlon-activity-targets">${targets.map(t=>targetRow(t,runs)).join('')}</div><footer>${status.key==='complete'?'Task completed successfully.':lastHeartbeat?`Last worker heartbeat ${esc(age(lastHeartbeat))}`:status.key==='queued'?'Approved and queued. Waiting for an execution worker to claim it.':'Live status updates automatically.'}</footer>`;
  }
  async function refresh(force=false){
    if(!profile?.id)return;
    try{
      const {data:tickets,error}=await client.from('support_tickets')
        .select('id,ticket_number,title,status,priority,surface,approval_status,parent_ticket_id,context,created_at,updated_at,resolved_at')
        .eq('managed_by','Marlon').order('updated_at',{ascending:false}).limit(30);
      if(error)throw error;
      const rows=Array.isArray(tickets)?tickets:[];const task=chooseTask(rows);
      if(!task){render({task:null,children:[],runs:[],status:{key:'idle',label:'Idle'}});return}
      const children=rows.filter(t=>t.parent_ticket_id===task.id);
      const ids=[task.id,...children.map(t=>t.id)];
      const {data:runData,error:runError}=await client.from('marlon_execution_runs')
        .select('id,ticket_id,repository,status,executor,started_at,heartbeat_at,finished_at,branch,commit_sha,diagnosis,patch_summary,error,metadata')
        .in('ticket_id',ids);
      if(runError)throw runError;
      const runs=Array.isArray(runData)?runData:[];render({task,children,runs,status:modelStatus(task,children,runs)});
    }catch(error){
      console.warn('Marlon activity refresh failed:',error);
      const host=ensureUi();if(host){host.dataset.state='unknown';host.querySelector('.gc-marlon-activity-label').textContent='Marlon · Status unavailable'}
    }
  }
  function scheduleRefresh(delay=120){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>void refresh(),delay)}
  function subscribe(){
    if(channel)client.removeChannel(channel);
    channel=client.channel(`marlon-activity-${profile?.id||'staff'}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'marlon_execution_runs'},()=>scheduleRefresh(50))
      .on('postgres_changes',{event:'*',schema:'public',table:'support_tickets'},()=>scheduleRefresh(80))
      .subscribe();
    clearInterval(pollTimer);pollTimer=setInterval(()=>void refresh(),15000);
  }
  function start(nextProfile){
    if(!nextProfile?.id)return;profile=nextProfile;ensureUi();subscribe();void refresh(true);
  }
  window.addEventListener('gotcracked:staff-ready',event=>start(event.detail));
  document.addEventListener('gc-staff-profile-updated',()=>{const p=window.GotCrackedRuntimeProfile||window.GotCrackedOperationsV1?.state?.profile;if(p)start(p)});
  const existing=window.GotCrackedRuntimeProfile||window.GotCrackedOperationsV1?.state?.profile;if(existing)setTimeout(()=>start(existing),250);
  window.GotCrackedMarlonActivity={version:'1.0.1',refresh:()=>refresh(true),get model(){return lastModel}};
})();
