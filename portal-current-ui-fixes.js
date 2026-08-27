(() => {
  'use strict';

  const client = window.supabaseClient;
  if (!client || window.GotCrackedCurrentUIFixes) return;

  const LABELS = {
    awaiting_diagnostic:'Awaiting Diagnostic',
    testing_in_progress:'Testing in Progress'
  };
  const EXTRA_NEXT = {
    awaiting_repair:['awaiting_diagnostic'],
    awaiting_diagnostic:['testing_in_progress','diagnostic_in_progress','awaiting_callback','unrepairable','cancelled'],
    diagnostic_in_progress:['testing_in_progress'],
    testing_in_progress:['diagnostic_in_progress','quality_inspection','repaired','awaiting_callback','unrepairable','cancelled'],
    repair_in_progress:['testing_in_progress'],
    quality_inspection:['testing_in_progress']
  };

  let intakePath = 'repair';
  let diagnosticCreationPending = false;
  let diagnosticLineBusy = false;
  let observer = null;

  const ops = () => window.GotCrackedOperationsV1;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
  const friendly = value => String(value || '').replaceAll('_',' ').replace(/\b\w/g, letter => letter.toUpperCase());
  const training = () => localStorage.getItem('gc-training-store') === '1';

  function injectStyle(){
    if(document.getElementById('gc-current-ui-fixes-style')) return;
    const style=document.createElement('style');
    style.id='gc-current-ui-fixes-style';
    style.textContent=`
      .v1-status.awaiting_diagnostic{background:#fde8e7!important;color:#b42318!important}
      .v1-status.testing_in_progress,.v1-status.repair_in_progress{background:#e5f7ed!important;color:#087657!important}
      .gc-intake-check-actions{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;min-width:0}
      .gc-intake-check-actions button{min-height:39px;border:1px solid #d7e0e8;border-radius:9px;background:#fff;color:#42576d;padding:7px 8px;font:800 .72rem inherit;cursor:pointer;touch-action:manipulation}
      .gc-intake-check-actions button[aria-pressed="true"][data-value="pass"]{background:#e5f7ed;border-color:#7bc89d;color:#087657}
      .gc-intake-check-actions button[aria-pressed="true"][data-value="fail"],.gc-intake-check-actions button[aria-pressed="true"][data-value="damaged"]{background:#fde8e7;border-color:#e3a09a;color:#b42318}
      .gc-intake-check-actions button[aria-pressed="true"][data-value="observed"]{background:#fff3d6;border-color:#e3c06e;color:#8a5a00}
      .gc-intake-check-actions button[aria-pressed="true"][data-value="not_tested"],.gc-intake-check-actions button[aria-pressed="true"][data-value="not_applicable"]{background:#eef3f8;border-color:#b8c7d6;color:#40556b}
      .v1-check-row:has(.gc-intake-check-actions){grid-template-columns:minmax(150px,.8fr) minmax(0,1.7fr)}
      .gc-intake-path{border:1px solid #dce5ee;border-radius:12px;padding:14px;background:#fbfcfd}
      .gc-intake-path h4{margin:0 0 5px;font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;color:#60758b}
      .gc-intake-path p{margin:0 0 10px;color:#53677b;font-size:.8rem;line-height:1.45}
      .gc-intake-path-options{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .gc-intake-path-options button{min-height:64px;border:1px solid #d7e0e8;border-radius:10px;background:#fff;color:#344c63;text-align:left;padding:10px 12px;cursor:pointer}
      .gc-intake-path-options button strong{display:block;font-size:.82rem}.gc-intake-path-options button small{display:block;margin-top:3px;color:#74869a;line-height:1.35}
      .gc-intake-path-options button[aria-pressed="true"]{border-color:#2d7dc7;background:#f1f7fd;box-shadow:0 0 0 2px rgba(45,125,199,.12)}
      button[data-timeclock-action="clock_in"]{border-color:#23844a!important;background:#23844a!important;color:#fff!important}
      button[data-timeclock-action="clock_out"]{border-color:#c94b42!important;background:#c94b42!important;color:#fff!important}
      button[data-timeclock-action="break_start"],button[data-timeclock-action="break_end"]{border-color:#d99a18!important;background:#fff0c7!important;color:#805000!important}
      html[data-theme="dark"] button[data-timeclock-action="break_start"],html[data-theme="dark"] button[data-timeclock-action="break_end"]{background:#3a2d0d!important;border-color:#b97f10!important;color:#ffd36a!important}
      @media(max-width:700px){
        .v1-check-row:has(.gc-intake-check-actions){grid-template-columns:1fr!important;gap:8px}
        .gc-intake-check-actions{grid-template-columns:repeat(2,minmax(0,1fr))}
        .gc-intake-check-actions button{min-height:44px;font-size:.76rem}
        .gc-intake-path-options{grid-template-columns:1fr}
      }
    `;
    document.head.appendChild(style);
  }

  function syncTapButtons(select, wrap){
    wrap.querySelectorAll('button[data-value]').forEach(button=>{
      const active=button.dataset.value===select.value;
      button.setAttribute('aria-pressed',active?'true':'false');
    });
  }

  function tapifyIntake(){
    document.querySelectorAll('#v1-intake-dialog select[data-intake-check]').forEach(select=>{
      if(select.dataset.gcTapified==='true') return;
      select.dataset.gcTapified='true';
      const [bucket] = select.dataset.intakeCheck.split(':');
      const choices = bucket==='visual'
        ? [['pass','Normal'],['damaged','Damaged'],['observed','Observed'],['not_applicable','N/A']]
        : [['pass','Pass'],['fail','Problem'],['not_tested','Not Tested'],['not_applicable','N/A']];
      select.hidden=true;
      select.tabIndex=-1;
      select.setAttribute('aria-hidden','true');
      const wrap=document.createElement('div');
      wrap.className='gc-intake-check-actions';
      wrap.setAttribute('role','group');
      choices.forEach(([value,label])=>{
        const button=document.createElement('button');
        button.type='button';
        button.dataset.value=value;
        button.textContent=label;
        button.setAttribute('aria-pressed','false');
        button.addEventListener('click',event=>{
          event.preventDefault();
          event.stopPropagation();
          select.value=value;
          select.dispatchEvent(new Event('change',{bubbles:true}));
          syncTapButtons(select,wrap);
        });
        wrap.appendChild(button);
      });
      select.insertAdjacentElement('afterend',wrap);
      syncTapButtons(select,wrap);
    });
  }

  function renderIntakePath(){
    const review=document.querySelector('#v1-intake-dialog .v1-review');
    if(!review || review.querySelector('.gc-intake-path')) return;
    const card=document.createElement('div');
    card.className='gc-intake-path';
    card.innerHTML=`<h4>Service path</h4><p>Choose the path this device should enter after intake.</p><div class="gc-intake-path-options"><button type="button" data-gc-intake-path="repair"><strong>Repair</strong><small>Normal repair workflow beginning in Awaiting Repair.</small></button><button type="button" data-gc-intake-path="diagnostic"><strong>Thorough Diagnostic</strong><small>Leave-behind bench diagnostic beginning in Awaiting Diagnostic, then Testing in Progress.</small></button></div>`;
    review.insertBefore(card,review.firstChild);
    card.querySelectorAll('[data-gc-intake-path]').forEach(button=>button.setAttribute('aria-pressed',button.dataset.gcIntakePath===intakePath?'true':'false'));
  }

  function setIntakePath(value){
    intakePath=value==='diagnostic'?'diagnostic':'repair';
    document.querySelectorAll('[data-gc-intake-path]').forEach(button=>button.setAttribute('aria-pressed',button.dataset.gcIntakePath===intakePath?'true':'false'));
  }

  function patchRepairTicketWrites(){
    if(client.__gcDiagnosticPathPatched) return;
    const originalFrom=client.from.bind(client);
    client.from=function(table){
      const builder=originalFrom(table);
      if(table!=='repair_tickets'||!builder) return builder;
      const shouldPatch=()=>intakePath==='diagnostic'&&document.getElementById('v1-intake-dialog')?.open;
      const patchValues=values=>{
        if(!shouldPatch()) return values;
        const patchOne=value=>value&&value.status==='awaiting_repair'?{...value,status:'awaiting_diagnostic'}:value;
        return Array.isArray(values)?values.map(patchOne):patchOne(values);
      };
      if(typeof builder.insert==='function'){
        const originalInsert=builder.insert.bind(builder);
        builder.insert=(values,options)=>originalInsert(patchValues(values),options);
      }
      if(typeof builder.update==='function'){
        const originalUpdate=builder.update.bind(builder);
        builder.update=(values,options)=>originalUpdate(patchValues(values),options);
      }
      return builder;
    };
    client.__gcDiagnosticPathPatched=true;
  }

  function ensureOption(select,value,label){
    if(!select||select.querySelector(`option[value="${CSS.escape(value)}"]`)) return;
    const option=document.createElement('option');
    option.value=value;
    option.textContent=label;
    select.appendChild(option);
  }

  function decorateWorkflow(){
    const current=ops()?.state?.currentWorkOrder;
    if(!current) return;
    const select=document.querySelector('#v1-workflow-form select[name="status"]');
    if(select){
      const extras=current.status==='awaiting_callback'&&['awaiting_diagnostic','testing_in_progress'].includes(current.status_before_callback)
        ? [current.status_before_callback]
        : (EXTRA_NEXT[current.status]||[]);
      extras.forEach(status=>ensureOption(select,status,LABELS[status]||friendly(status)));
    }
    const filter=document.getElementById('v1-repair-status');
    ensureOption(filter,'awaiting_diagnostic',LABELS.awaiting_diagnostic);
    ensureOption(filter,'testing_in_progress',LABELS.testing_in_progress);
    document.querySelectorAll('.v1-status.awaiting_diagnostic').forEach(node=>node.textContent=LABELS.awaiting_diagnostic);
    document.querySelectorAll('.v1-status.testing_in_progress').forEach(node=>node.textContent=LABELS.testing_in_progress);
    const workflowTitle=document.querySelector('#work-order .v1-workflow-panel .v1-drawer-head h2');
    if(workflowTitle&&LABELS[current.status])workflowTitle.textContent=LABELS[current.status];
  }

  function safeSuggestions(){
    const host=document.querySelector('#work-order .v1-suggestions');
    const state=ops()?.state;
    const ticket=state?.currentWorkOrder;
    if(!host||!ticket) return;
    const intake=(state.intakes||[]).find(item=>item.ticket_id===ticket.id||item.id===ticket.intake_session_id);
    const abnormal=[];
    for(const bucket of [intake?.visual_findings||{},intake?.functional_findings||{}]){
      for(const [key,value] of Object.entries(bucket)){
        if(['fail','damaged','observed'].includes(value)) abnormal.push(friendly(key));
      }
    }
    const source=[ticket.customer_issue||'',...abnormal].join(' ').toLowerCase();
    const category=String(ticket.devices?.category||'').toLowerCase();
    const matches=(state.guides||[]).map(guide=>{
      const tags=(guide.tags||[]).map(tag=>String(tag).toLowerCase()).filter(Boolean);
      const hits=tags.filter(tag=>source.includes(tag)).length;
      if(!hits) return null;
      const categoryBonus=category&&String(guide.device_category||'').toLowerCase()===category?25:0;
      return {guide,score:Math.min(100,categoryBonus+hits*18)};
    }).filter(Boolean).sort((a,b)=>b.score-a.score).slice(0,3);
    const card=host.closest('.card');
    if(!matches.length){ if(card)card.hidden=true; return; }
    if(card)card.hidden=false;
    host.innerHTML=matches.map(match=>`<article class="v1-suggestion"><header><h4>${esc(match.guide.title)}</h4><span class="v1-confidence">${match.score}% match</span></header><p>${esc((match.guide.likely_causes||[]).join(' · '))}</p></article>`).join('');
  }

  function ensureTrainingDiagnosticService(){
    if(!training()) return;
    const state=ops()?.state;
    if(!state?.services||state.services.some(service=>service.sku==='SVC-THOROUGH-DIAG')) return;
    state.services.push({id:'training-svc-thorough-diagnostic',sku:'SVC-THOROUGH-DIAG',name:'Thorough Diagnostic',category:'Diagnostics',price_cents:0,taxable:false,active:true});
  }

  function persistTrainingTicket(ticket){
    try{
      const raw=localStorage.getItem('gc-training-data-v1');
      if(!raw)return;
      const data=JSON.parse(raw);
      const stored=(data.workOrders||[]).find(item=>item.id===ticket.id);
      if(stored)Object.assign(stored,{status:ticket.status,work_order_items:ticket.work_order_items,updated_at:new Date().toISOString()});
      localStorage.setItem('gc-training-data-v1',JSON.stringify(data));
    }catch(error){console.warn('Unable to persist Training Store diagnostic path.',error);}
  }

  async function attachDiagnosticService(){
    if(!diagnosticCreationPending||diagnosticLineBusy) return;
    const state=ops()?.state;
    const ticket=state?.currentWorkOrder;
    if(!ticket||ticket.status!=='awaiting_diagnostic') return;
    ensureTrainingDiagnosticService();
    const service=(state.services||[]).find(item=>item.sku==='SVC-THOROUGH-DIAG');
    if(!service){diagnosticCreationPending=false;return;}
    if((ticket.work_order_items||[]).some(line=>line.catalog_id===service.id||line.sku==='SVC-THOROUGH-DIAG')){diagnosticCreationPending=false;return;}
    diagnosticLineBusy=true;
    try{
      if(training()){
        ticket.work_order_items=ticket.work_order_items||[];
        ticket.work_order_items.push({id:`training-diag-${Date.now()}`,ticket_id:ticket.id,item_type:'service',catalog_id:service.id,description:service.name,sku:service.sku,quantity:1,unit_price_cents:0,taxable:false,inventory_applied:false,damaged:false});
        persistTrainingTicket(ticket);
        diagnosticCreationPending=false;
        ops()?.openWorkOrder?.(ticket.id);
        return;
      }
      const result=await client.rpc('save_work_order',{
        target_ticket:ticket.id,
        ticket_changes:{status:ticket.status,assigned_user_id:ticket.assigned_user_id||'',priority:ticket.priority||'normal',public_notes:ticket.public_notes||'',internal_notes:ticket.internal_notes||'',intake_method:ticket.intake_method||'walk_in',shipping_status:ticket.shipping_status||'not_applicable'},
        new_line:{item_type:'service',catalog_id:service.id,description:service.name,quantity:1,unit_price_cents:service.price_cents||0,taxable:false,inventory_applied:false},
        manual_discount_cents:0,manual_discount_reason:null,entered_promo_code:null
      });
      if(result.error)throw result.error;
      diagnosticCreationPending=false;
      await ops()?.reload?.();
      ops()?.openWorkOrder?.(ticket.id);
    }catch(error){
      console.error('Unable to attach Thorough Diagnostic service.',error);
      window.GotCrackedDiagnostics?.error?.(error,{context:'Thorough Diagnostic intake'});
    }finally{diagnosticLineBusy=false;}
  }

  function decorate(){
    tapifyIntake();
    renderIntakePath();
    decorateWorkflow();
    safeSuggestions();
    attachDiagnosticService();
  }

  function observe(){
    if(observer)return;
    observer=new MutationObserver(()=>queueMicrotask(decorate));
    observer.observe(document.body,{childList:true,subtree:true});
  }

  document.addEventListener('click',event=>{
    const button=event.target instanceof Element?event.target.closest('[data-gc-intake-path]'):null;
    if(button){event.preventDefault();setIntakePath(button.dataset.gcIntakePath);return;}
    const create=event.target instanceof Element?event.target.closest('[data-v1-intake-create]'):null;
    if(create&&intakePath==='diagnostic')diagnosticCreationPending=true;
  });

  document.getElementById('v1-intake-dialog')?.addEventListener('close',()=>setTimeout(()=>{if(!diagnosticCreationPending)setIntakePath('repair');},0));
  document.addEventListener('gc-view-changed',()=>setTimeout(decorate,0));
  document.addEventListener('gc-cross-user-sync',()=>setTimeout(decorate,0));
  document.addEventListener('gc-portal-runtime-ready',()=>setTimeout(decorate,0));

  injectStyle();
  patchRepairTicketWrites();
  observe();
  setTimeout(decorate,0);

  window.GotCrackedCurrentUIFixes={
    version:'20260827-diagnostic2',
    decorate,
    get intakePath(){return intakePath;}
  };
})();