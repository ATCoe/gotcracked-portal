(()=>{
  'use strict';
  if(window.GotCrackedMarlonApprovalGate)return;
  const client=window.supabaseClient;if(!client)return;
  const current=()=>window.GotCrackedRuntimeProfile||window.GotCrackedOperationsV1?.state?.profile||null;
  const isOwner=()=>String(current()?.role||'')==='owner';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const fmt=v=>v?new Date(v).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'—';
  const titleCase=v=>String(v||'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
  const approvalCache=new Map();
  const maintenanceShown=new Set();
  const decidingTickets=new Set();
  let pendingRefresh=null;

  function ensureStyle(){
    if(document.getElementById('gc-marlon-approval-style'))return;
    const s=document.createElement('style');s.id='gc-marlon-approval-style';s.textContent=`
      .gc-marlon-approval{margin:14px 0;padding:14px;border:1px solid rgba(55,196,255,.42);border-radius:12px;background:rgba(11,104,145,.10)}
      .gc-marlon-approval strong{display:block;margin-bottom:6px}.gc-marlon-approval p{margin:5px 0;line-height:1.45}.gc-marlon-approval small{display:block;opacity:.78;margin-top:7px}
      .gc-marlon-approval-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.gc-marlon-approval-actions button{min-width:110px;min-height:40px;border-radius:9px;font-weight:800;cursor:pointer}
      .gc-marlon-approve{border:1px solid #19b8ef;background:#0c9fd5;color:white}.gc-marlon-deny{border:1px solid #8c99a7;background:transparent;color:inherit}
      .gc-marlon-approval[data-state="denied"]{border-color:rgba(236,91,91,.45)}.gc-marlon-approval[data-state="approved"]{border-color:rgba(64,196,130,.45)}
      .gc-maintenance-approval{border-color:#f59e0b!important;border-left-color:#d97706!important;background:#fff7ed!important;color:#7c2d12!important;box-shadow:0 14px 38px rgba(124,45,18,.22)!important}
      .gc-maintenance-approval .gc-diagnostic-icon{background:#d97706!important;color:#fff!important}.gc-maintenance-approval .gc-diagnostic-copy strong{color:#7c2d12!important;font-weight:900!important}.gc-maintenance-approval .gc-diagnostic-copy p{color:#9a3412!important;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.gc-maintenance-approval .gc-diagnostic-copy small{color:#b45309!important}
      .gc-maintenance-approval .gc-diagnostic-actions{gap:8px;flex-wrap:wrap}.gc-maintenance-approval .gc-diagnostic-actions button{min-height:34px;padding:0 12px;border-radius:8px;text-decoration:none!important;font-weight:850}.gc-maintenance-approve{background:#d97706!important;color:#fff!important;border:1px solid #b45309!important}.gc-maintenance-deny{background:transparent!important;color:#9a3412!important;border:1px solid #fdba74!important}
      .gc-marlon-approval-screen{position:fixed;inset:0;z-index:22000;display:grid;place-items:center;padding:24px;background:rgba(17,24,39,.72);backdrop-filter:blur(8px)}
      .gc-marlon-approval-screen-card{width:min(680px,100%);max-height:min(760px,calc(100vh - 40px));overflow:auto;border:1px solid #f59e0b;border-top:7px solid #d97706;border-radius:18px;background:#fffaf2;color:#431407;box-shadow:0 26px 80px rgba(0,0,0,.38);padding:24px}
      .gc-marlon-approval-screen-card,.gc-marlon-approval-screen-card h1,.gc-marlon-approval-screen-card strong{color:#431407!important}.gc-marlon-approval-screen-card>p,.gc-marlon-approval-screen-card .gc-approval-scope p{color:#7c2d12!important}.gc-marlon-approval-screen-card .eyebrow{margin:0 0 7px;color:#b45309!important;font-size:.74rem;font-weight:900;letter-spacing:.09em;text-transform:uppercase}.gc-marlon-approval-screen-card h1{margin:0 0 10px;font-size:clamp(1.35rem,4vw,2rem)}
      .gc-marlon-approval-screen-card .gc-approval-scope{margin:18px 0;padding:14px;border:1px solid #fed7aa;border-radius:12px;background:#fff7ed;line-height:1.5}.gc-marlon-approval-screen-meta{display:flex;gap:10px;flex-wrap:wrap;color:#9a3412;font-size:.78rem;font-weight:750}
      .gc-marlon-approval-screen-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:20px}.gc-marlon-approval-screen-actions button,.gc-marlon-approval-screen-actions a{min-height:44px;padding:0 18px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;font-weight:900;text-decoration:none;cursor:pointer}.gc-marlon-screen-approve{border:1px solid #b45309;background:#d97706;color:#fff}.gc-marlon-screen-deny{border:1px solid #fdba74;background:transparent;color:#9a3412}.gc-marlon-screen-continue{border:1px solid #cbd5e1;background:#fff;color:#334155}
      html[data-theme="dark"] .gc-marlon-approval-screen-card{background:#18130d!important;color:#fff7ed!important;border-color:#f59e0b!important}html[data-theme="dark"] .gc-marlon-approval-screen-card h1,html[data-theme="dark"] .gc-marlon-approval-screen-card strong{color:#fff7ed!important}html[data-theme="dark"] .gc-marlon-approval-screen-card>p,html[data-theme="dark"] .gc-marlon-approval-screen-card .gc-approval-scope p{color:#fed7aa!important}html[data-theme="dark"] .gc-marlon-approval-screen-card .eyebrow{color:#fbbf24!important}html[data-theme="dark"] .gc-marlon-approval-screen-card .gc-approval-scope{background:#21170d!important;border-color:#92400e!important}html[data-theme="dark"] .gc-marlon-approval-screen-meta{color:#fdba74!important}html[data-theme="dark"] .gc-marlon-screen-deny{color:#fed7aa!important;border-color:#92400e!important}
      @media(max-width:650px){.gc-marlon-approval-screen{padding:12px}.gc-marlon-approval-screen-card{padding:18px;border-radius:14px}.gc-marlon-approval-screen-actions>*{flex:1 1 140px}}
    `;document.head.appendChild(s);
  }

  function highLevelIntent(value){
    const text=String(value||'').toLowerCase();
    const action=/\b(make|change|update|modify|deploy|release|replace|remove|delete|migrate|restructure|redesign|rewrite|restart|reboot|integrate|enable|disable|configure|implement|apply|ship|publish)\b/.test(text);
    const risk=/\b(authentication|authorization|auth|permission|permissions|role|roles|rls|payment|payments|billing|checkout|database|schema|migration|migrations|secret|secrets|credential|credentials|production|deploy|deployment|cloudflare|downtime|restart|reboot|delete|purge|destructive|discord server|channel structure|webhook|integration|workflow|major|entire|whole|restructure|redesign|rewrite)\b/.test(text);
    return action&&risk;
  }

  function surfaceFor(text,context){
    const value=String(text||'').toLowerCase();
    if(/\bcloudflare\b/.test(value))return 'cloudflare';
    if(/\brepository|github|repo\b/.test(value))return 'repository';
    const portal=/\bportal\b/.test(value),website=/\bwebsite|customer site|customer-facing site\b/.test(value);
    if(portal&&website)return 'both';
    if(website)return 'website';
    return String(context?.surface||'').toLowerCase()==='website'?'website':'portal';
  }

  async function createApproval(text,context={}){
    const scope=String(text||'').trim().replace(/\s+/g,' ').slice(0,4000);if(!scope)return null;
    const key=`${surfaceFor(scope,context)}|${scope}`;
    if(approvalCache.has(key))return approvalCache.get(key);
    const title=`Marlon high-level change: ${scope}`.slice(0,180);
    const {data,error}=await client.rpc('create_ui_update_request',{
      p_title:title,p_description:scope,p_surface:surfaceFor(scope,context),p_priority:/\b(outage|down|unavailable|urgent|blocking|production broken)\b/i.test(scope)?'high':'normal',
      p_context:{source:'marlon_chat_failsafe',view:String(context?.view||location.hash||'#dashboard').slice(0,160),path:String(context?.path||location.pathname).slice(0,300),requested_scope:scope}
    });
    if(error)throw error;
    const approval={required:true,ticketId:data?.id,ticketNumber:data?.ticket_number||null,title:data?.title||title,summary:data?.title||title,surface:data?.surface||surfaceFor(scope,context),status:'pending',fingerprint:data?.approval_fingerprint||null};
    if(approval.ticketId)approvalCache.set(key,approval);
    return approval.ticketId?approval:null;
  }

  function installChatFailsafe(){
    if(window.__gcMarlonApprovalFetchPatched||!window.fetch)return;
    const nativeFetch=window.fetch.bind(window);
    window.fetch=async function marlonApprovalFetch(input,init){
      const response=await nativeFetch(input,init);
      const url=typeof input==='string'?input:input?.url||'';
      if(!String(url).includes('/portal/chat'))return response;
      try{
        const requestBody=typeof init?.body==='string'?JSON.parse(init.body):{};
        const messages=Array.isArray(requestBody?.messages)?requestBody.messages:[];
        const lastUser=[...messages].reverse().find(message=>message?.role==='user')?.content||'';
        const data=await response.clone().json();
        let approval=data?.approvalRequest||data?.approval||null;
        if(!approval&&isOwner()&&highLevelIntent(lastUser))approval=await createApproval(lastUser,requestBody?.context||{});
        if(!approval)return response;
        const normalized={...approval,summary:approval.summary||approval.title||'High-level change'};
        const headers=new Headers(response.headers);headers.set('Content-Type','application/json');
        return new Response(JSON.stringify({...data,approval:data?.approval||normalized,approvalRequest:normalized}),{status:response.status,statusText:response.statusText,headers});
      }catch(error){
        console.warn('Marlon approval failsafe could not enrich chat response:',error);
        return response;
      }
    };
    window.__gcMarlonApprovalFetchPatched=true;
  }

  async function ticket(id){
    const {data,error}=await client.from('support_tickets').select('id,ticket_number,title,description,surface,priority,status,managed_by,change_level,requires_approval,approval_state,approval_status,approval_requested_at,approval_decided_at,approval_fingerprint').eq('id',id).maybeSingle();
    if(error)throw error;return data;
  }

  function panelMarkup(t){
    if(!t?.requires_approval)return '';
    const state=t.approval_status||'pending';
    const pending=state==='pending';
    const owner=isOwner();
    const stateLabel=state==='approved'?'Approved':state==='denied'?'Denied':'Owner approval required';
    const message=state==='approved'
      ?'Marlon may execute only the exact approved scope below. Any scope change requires a new approval.'
      :state==='denied'
        ?'This change is blocked. Marlon is not authorized to execute it.'
        :'Marlon is blocked from executing this high-level change until a verified Owner clicks Approve.';
    return `<section class="gc-marlon-approval" data-state="${esc(state)}" data-approval-ticket="${esc(t.id)}"><strong>${esc(stateLabel)}</strong><p>${esc(message)}</p><p><b>Exact scope:</b> ${esc(t.title)}</p><small>Surface: ${esc(t.surface)} · Requested ${esc(fmt(t.approval_requested_at))}${t.approval_decided_at?` · Decided ${esc(fmt(t.approval_decided_at))}`:''}</small>${pending&&owner?`<div class="gc-marlon-approval-actions"><button type="button" class="gc-marlon-approve" data-marlon-approval="approve">Approve</button><button type="button" class="gc-marlon-deny" data-marlon-approval="deny">Deny</button></div>`:pending?'<small>Waiting for a verified Owner decision.</small>':''}</section>`;
  }

  async function refreshPanels(id){
    const t=await ticket(id);if(!t?.requires_approval)return;
    document.querySelectorAll(`[data-approval-ticket="${id}"]`).forEach(panel=>{panel.outerHTML=panelMarkup(t)});
    return t;
  }

  async function decorate(id){
    if(!id)return;
    try{
      const t=await ticket(id);if(!t?.requires_approval)return;
      let tries=0;
      const place=()=>{
        const host=document.querySelector('#gc-support-detail-dialog .gc-support-detail');
        if(!host){if(++tries<10)setTimeout(place,50);return}
        host.querySelector('.gc-marlon-approval')?.remove();
        host.insertAdjacentHTML('afterbegin',panelMarkup(t));
      };place();
    }catch(error){console.warn('Marlon approval panel failed:',error)}
  }

  function deepLinkTicketId(){
    try{
      const query=new URL(location.href).searchParams.get('marlon-approval');
      if(query)return query;
    }catch{}
    const match=/^#marlon-approval\/([^/?#]+)/.exec(location.hash||'');
    return match?decodeURIComponent(match[1]):null;
  }

  function closeApprovalScreen(){document.getElementById('gc-marlon-approval-screen')?.remove()}

  async function renderApprovalScreen(id=deepLinkTicketId()){
    if(!id)return;
    let root=document.getElementById('gc-marlon-approval-screen');
    if(!root){root=document.createElement('section');root.id='gc-marlon-approval-screen';root.className='gc-marlon-approval-screen';root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');document.body.appendChild(root)}
    root.innerHTML='<article class="gc-marlon-approval-screen-card"><p class="eyebrow">Marlon Maintenance</p><h1>Loading approval request…</h1></article>';
    try{
      const t=await ticket(id);if(!t)throw new Error('This approval request could not be found.');
      const state=t.approval_status||'pending',pending=state==='pending',owner=isOwner();
      const code=t.ticket_number?`SUP-${String(t.ticket_number).padStart(4,'0')}`:'Support request';
      const heading=pending?'Owner approval required':state==='approved'?'Approval recorded':'Request denied';
      const explanation=pending?'Marlon stopped before changing a protected system. Review the exact scope below, then approve or deny it.':state==='approved'?'Marlon is authorized to continue only with this exact fingerprinted scope.':'Marlon will not execute this protected change.';
      const actions=pending&&owner?`<button type="button" class="gc-marlon-screen-approve" data-marlon-screen-decision="approve">Approve</button><button type="button" class="gc-marlon-screen-deny" data-marlon-screen-decision="deny">Deny</button>`:pending?'<span>Waiting for a verified Owner account.</span>':`<a class="gc-marlon-screen-continue" href="${location.origin}/#support-tickets">Continue to Support Desk</a>`;
      root.innerHTML=`<article class="gc-marlon-approval-screen-card" data-screen-approval-ticket="${esc(t.id)}"><p class="eyebrow">Marlon Maintenance · ${esc(code)}</p><h1>${esc(heading)}</h1><p>${esc(explanation)}</p><div class="gc-approval-scope"><strong>Exact scope</strong><p>${esc(t.description||t.title)}</p></div><div class="gc-marlon-approval-screen-meta"><span>Surface: ${esc(t.surface)}</span><span>Priority: ${esc(t.priority||'normal')}</span><span>Status: ${esc(state)}</span><span>Requested: ${esc(fmt(t.approval_requested_at))}</span></div><div class="gc-marlon-approval-screen-actions">${actions}</div></article>`;
    }catch(error){
      root.innerHTML=`<article class="gc-marlon-approval-screen-card"><p class="eyebrow">Marlon Maintenance</p><h1>Approval request unavailable</h1><p>${esc(error?.message||error)}</p><div class="gc-marlon-approval-screen-actions"><a class="gc-marlon-screen-continue" href="${location.origin}/#support-tickets">Open Support Desk</a></div></article>`;
    }
  }

  async function pendingApprovals(){
    const profile=current();
    if(!profile?.id)return [];
    if(!isOwner())return [];
    const {data,error}=await client.from('support_tickets')
      .select('id,ticket_number,title,description,surface,priority,status,managed_by,change_level,requires_approval,approval_state,approval_status,approval_requested_at,approval_fingerprint,created_at')
      .eq('managed_by','Marlon')
      .eq('requires_approval',true)
      .eq('approval_status','pending')
      .order('created_at',{ascending:true})
      .limit(6);
    if(error)throw error;
    return Array.isArray(data)?data:[];
  }

  function syncMaintenanceAlerts(rows){
    const diagnostics=window.GotCrackedDiagnostics;
    if(!diagnostics?.maintenanceApproval)return;
    const active=rows[0]||null;
    const activeId=active?String(active.id):'';
    for(const id of maintenanceShown){if(id!==activeId)diagnostics.clearMaintenanceApproval?.(id)}
    maintenanceShown.clear();
    if(!active)return;
    maintenanceShown.add(activeId);
    const concise=String(active.title||'').replace(/^Marlon high-level change:\s*/i,'').trim() || 'Marlon needs Owner approval before continuing this protected task.';
    diagnostics.maintenanceApproval({ticketId:active.id,ticketNumber:active.ticket_number,title:concise,surface:titleCase(active.surface),priority:titleCase(active.priority||'high'),pendingCount:rows.length});
  }

  async function refreshPendingApprovals(){
    try{
      const rows=await pendingApprovals();
      syncMaintenanceAlerts(rows);
      return rows;
    }catch(error){
      console.warn('Marlon pending approval refresh failed:',error);
      return [];
    }
  }

  function schedulePendingRefresh(delay=100){
    if(pendingRefresh)clearTimeout(pendingRefresh);
    pendingRefresh=setTimeout(()=>{pendingRefresh=null;void refreshPendingApprovals()},delay);
  }

  async function decideTicket(id,approved,controls=[]){
    if(!id||decidingTickets.has(String(id)))return;
    if(!isOwner()){
      window.GotCrackedDiagnostics?.error?.('Only a verified Owner can approve Marlon high-level changes.',{context:'Marlon approval blocked'});
      controls.forEach(button=>button.disabled=false);
      return;
    }
    decidingTickets.add(String(id));
    controls.forEach(button=>{button.disabled=true;button.dataset.gcOriginalText||=button.textContent||'';button.textContent='Working…'});
    try{
      const {error}=await client.rpc('decide_marlon_high_level_change',{p_ticket:id,p_approve:Boolean(approved)});
      if(error)throw error;
      window.GotCrackedDiagnostics?.clearMaintenanceApproval?.(id);
      maintenanceShown.delete(String(id));
      await refreshPanels(id).catch(()=>null);
      await window.GotCrackedSupportTickets?.load?.();
      if(document.getElementById('gc-support-detail-dialog')?.open)await decorate(id);
      await refreshPendingApprovals();
      if(deepLinkTicketId()===id)await renderApprovalScreen(id);
      document.dispatchEvent(new CustomEvent('gc-marlon-approval-decided',{detail:{ticket:id,approved:Boolean(approved)}}));
    }catch(error){
      controls.forEach(button=>{button.disabled=false;if(button.dataset.gcOriginalText)button.textContent=button.dataset.gcOriginalText});
      const message=String(error?.message||error||'');
      if(/already been decided/i.test(message)){await refreshPendingApprovals();if(deepLinkTicketId()===id)await renderApprovalScreen(id);return}
      window.GotCrackedDiagnostics?.error?.(error,{context:'Unable to record Marlon approval decision'});
      if(deepLinkTicketId()===id)await renderApprovalScreen(id);
    }finally{decidingTickets.delete(String(id))}
  }

  async function decide(button){
    const panel=button.closest('[data-approval-ticket]');const id=panel?.dataset.approvalTicket;if(!id)return;
    const approved=button.dataset.marlonApproval==='approve';
    await decideTicket(id,approved,[...panel.querySelectorAll('button')]);
  }

  document.addEventListener('gc-maintenance-approval-decision',event=>{
    const id=String(event.detail?.ticketId||'');
    const card=document.querySelector(`[data-gc-maintenance-ticket="${CSS.escape(id)}"]`);
    void decideTicket(id,event.detail?.approved===true,[...(card?.querySelectorAll('button')||[])]);
  });

  document.addEventListener('click',event=>{
    const target=event.target instanceof Element?event.target:null;if(!target)return;
    const screenDecision=target.closest('[data-marlon-screen-decision]');
    if(screenDecision){
      const host=screenDecision.closest('[data-screen-approval-ticket]');
      const id=host?.dataset.screenApprovalTicket;
      if(id){event.preventDefault();void decideTicket(id,screenDecision.dataset.marlonScreenDecision==='approve',[...host.querySelectorAll('button')]);}
      return;
    }
    const decision=target.closest('[data-marlon-approval]');
    if(decision&&decision.closest('[data-approval-ticket]')){event.preventDefault();event.stopPropagation();void decide(decision);return}
    const row=target.closest('[data-ticket-id]');if(row)setTimeout(()=>void decorate(row.dataset.ticketId),0);
  },true);

  document.addEventListener('gc-cross-user-sync',()=>schedulePendingRefresh(250));
  document.addEventListener('gc-marlon-approval-decided',()=>schedulePendingRefresh(100));
  window.addEventListener('gotcracked:staff-ready',()=>{schedulePendingRefresh(50);if(deepLinkTicketId())void renderApprovalScreen()});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedulePendingRefresh(100)});
  setInterval(()=>{if(!document.hidden)schedulePendingRefresh(0)},30000);

  try{
    client.channel('gc-marlon-approval-alerts')
      .on('postgres_changes',{event:'*',schema:'public',table:'support_tickets'},()=>schedulePendingRefresh(150))
      .subscribe();
  }catch(error){console.warn('Marlon approval realtime subscription unavailable:',error)}

  ensureStyle();
  installChatFailsafe();
  setTimeout(()=>{schedulePendingRefresh(0);if(deepLinkTicketId())void renderApprovalScreen()},700);
  window.GotCrackedMarlonApprovalGate={version:'1.4.0',decorate,refreshPanels,panelMarkup,createApproval,highLevelIntent,refreshPendingApprovals,renderApprovalScreen};

})();
