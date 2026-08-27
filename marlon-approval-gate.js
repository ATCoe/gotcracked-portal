(()=>{
  'use strict';
  if(window.GotCrackedMarlonApprovalGate)return;
  const client=window.supabaseClient;if(!client)return;
  const current=()=>window.GotCrackedRuntimeProfile||window.GotCrackedOperationsV1?.state?.profile||null;
  const isOwner=()=>String(current()?.role||'')==='owner';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const fmt=v=>v?new Date(v).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'—';
  const approvalCache=new Map();

  function ensureStyle(){
    if(document.getElementById('gc-marlon-approval-style'))return;
    const s=document.createElement('style');s.id='gc-marlon-approval-style';s.textContent=`
      .gc-marlon-approval{margin:14px 0;padding:14px;border:1px solid rgba(55,196,255,.42);border-radius:12px;background:rgba(11,104,145,.10)}
      .gc-marlon-approval strong{display:block;margin-bottom:6px}.gc-marlon-approval p{margin:5px 0;line-height:1.45}.gc-marlon-approval small{display:block;opacity:.78;margin-top:7px}
      .gc-marlon-approval-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.gc-marlon-approval-actions button{min-width:110px;min-height:40px;border-radius:9px;font-weight:800;cursor:pointer}
      .gc-marlon-approve{border:1px solid #19b8ef;background:#0c9fd5;color:white}.gc-marlon-deny{border:1px solid #8c99a7;background:transparent;color:inherit}
      .gc-marlon-approval[data-state="denied"]{border-color:rgba(236,91,91,.45)}.gc-marlon-approval[data-state="approved"]{border-color:rgba(64,196,130,.45)}
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
    if(/\bwebsite|site\b/.test(value))return 'website';
    return String(context?.surface||'').toLowerCase()==='website'?'website':'portal';
  }

  async function createApproval(text,context={}){
    const scope=String(text||'').trim().replace(/\s+/g,' ').slice(0,4000);if(!scope)return null;
    const key=`${surfaceFor(scope,context)}|${scope}`;
    if(approvalCache.has(key))return approvalCache.get(key);
    const title=`Marlon high-level change: ${scope}`.slice(0,180);
    const {data,error}=await client.rpc('create_ui_update_request',{
      p_title:title,p_description:scope,p_surface:surfaceFor(scope,context),p_priority:'normal',
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
    const {data,error}=await client.from('support_tickets').select('id,title,description,surface,status,requires_approval,approval_status,approval_requested_at,approval_decided_at,approval_fingerprint').eq('id',id).maybeSingle();
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

  async function decide(button){
    const panel=button.closest('[data-approval-ticket]');const id=panel?.dataset.approvalTicket;if(!id)return;
    if(!isOwner()){window.GotCrackedDiagnostics?.error?.('Only a verified Owner can approve Marlon high-level changes.',{context:'Marlon approval blocked'});return}
    const approved=button.dataset.marlonApproval==='approve';
    panel.querySelectorAll('button').forEach(b=>b.disabled=true);
    try{
      const {error}=await client.rpc('decide_marlon_change_approval',{p_ticket_id:id,p_approved:approved});if(error)throw error;
      await refreshPanels(id);
      await window.GotCrackedSupportTickets?.load?.();
      if(document.getElementById('gc-support-detail-dialog')?.open)await decorate(id);
    }catch(error){
      panel.querySelectorAll('button').forEach(b=>b.disabled=false);
      window.GotCrackedDiagnostics?.error?.(error,{context:'Unable to record Marlon approval decision'});
    }
  }

  document.addEventListener('click',event=>{
    const target=event.target instanceof Element?event.target:null;if(!target)return;
    const decision=target.closest('[data-marlon-approval]');
    if(decision&&decision.closest('[data-approval-ticket]')){event.preventDefault();event.stopPropagation();void decide(decision);return}
    const row=target.closest('[data-ticket-id]');if(row)setTimeout(()=>void decorate(row.dataset.ticketId),0);
  },true);

  ensureStyle();
  installChatFailsafe();
  window.GotCrackedMarlonApprovalGate={version:'1.2.0',decorate,refreshPanels,panelMarkup,createApproval,highLevelIntent};
})();
