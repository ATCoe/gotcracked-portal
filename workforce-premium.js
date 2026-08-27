(() => {
  'use strict';

  const client=window.supabaseClient;
  if(!client||window.GotCrackedWorkforcePremium)return;

  const DAY_MS=86400000;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const num=value=>Number(value)||0;
  const active=()=>location.hash.slice(1).split('/')[0]==='schedule';
  const scheduleState=()=>window.GotCrackedScheduleBoard?.state||null;
  const profile=()=>window.GotCrackedRuntimeProfile||window.GotCrackedOperationsV1?.state?.profile||null;
  const parseDate=value=>new Date(`${value}T12:00:00`);
  const dateOnly=date=>new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,10);
  const addDays=(value,count)=>dateOnly(new Date(parseDate(value).getTime()+count*DAY_MS));
  const fmtDate=(value,options={weekday:'short',month:'short',day:'numeric'})=>value?new Intl.DateTimeFormat('en-US',options).format(parseDate(value)):'';
  const fmtTime=value=>{
    if(!value)return'';
    const [h,m]=String(value).slice(0,5).split(':').map(Number);
    const d=new Date();d.setHours(h,m,0,0);
    return new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit'}).format(d);
  };
  const label=value=>String(value||'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());

  let data=null;
  let loading=false;
  let observer=null;
  let renderQueued=false;

  function injectStyle(){
    if(document.getElementById('gc-workforce-premium-style'))return;
    const style=document.createElement('style');
    style.id='gc-workforce-premium-style';
    style.textContent=`
      .gc-workforce-premium{border:1px solid var(--line,#d9e2ec);border-radius:16px;padding:16px;background:var(--surface,#fff);box-shadow:0 6px 22px rgba(15,23,42,.05);display:grid;gap:14px}
      .gc-workforce-premium-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}.gc-workforce-premium-head h2{margin:2px 0 4px}.gc-workforce-premium-head p{margin:0;color:var(--muted,#667085)}
      .gc-workforce-tools{display:flex;gap:8px;flex-wrap:wrap}.gc-workforce-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:10px}.gc-workforce-metric{padding:12px;border:1px solid var(--line,#d9e2ec);border-radius:12px;background:var(--surface-subtle,#f7f9fc);display:grid;gap:3px}.gc-workforce-metric small{color:var(--muted,#667085)}.gc-workforce-metric strong{font-size:1.15rem}.gc-workforce-metric.is-warning strong{color:#a15c00}.gc-workforce-metric.is-bad strong{color:#b42318}
      .gc-workforce-panel{border-top:1px solid var(--line,#d9e2ec);padding-top:12px}.gc-workforce-panel>summary{cursor:pointer;font-weight:750}.gc-workforce-list{display:grid;gap:8px;margin-top:10px}.gc-workforce-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px 12px;border:1px solid var(--line,#d9e2ec);border-radius:12px}.gc-workforce-row-copy{display:grid;gap:2px}.gc-workforce-row-copy span,.gc-workforce-row-copy small{color:var(--muted,#667085)}.gc-workforce-row-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.gc-workforce-severity{display:inline-flex;width:max-content;font-size:.72rem;font-weight:800;border-radius:999px;padding:3px 8px;background:rgba(222,115,0,.12)}.gc-workforce-severity.error{background:rgba(180,35,24,.12);color:#b42318}
      .gc-workforce-dialog{border:0;padding:0;border-radius:18px;width:min(720px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow:auto;background:var(--surface,#fff);color:var(--text,#101827);box-shadow:0 24px 80px rgba(0,0,0,.35)}.gc-workforce-dialog::backdrop{background:rgba(6,15,28,.68);backdrop-filter:blur(3px)}.gc-workforce-dialog form{padding:20px;display:grid;gap:14px}.gc-workforce-dialog-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.gc-workforce-dialog-head h2{margin:2px 0}.gc-workforce-dialog-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.gc-workforce-dialog label{display:grid;gap:6px}.gc-workforce-dialog input,.gc-workforce-dialog select,.gc-workforce-dialog textarea{width:100%}.gc-availability-grid{display:grid;gap:8px}.gc-availability-row{display:grid;grid-template-columns:95px 110px 1fr 1fr;gap:8px;align-items:center;padding:9px;border:1px solid var(--line,#d9e2ec);border-radius:11px}.gc-availability-row label{display:flex;align-items:center;gap:6px}.gc-availability-row label input{width:auto}.gc-workforce-dialog-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}.gc-workforce-message{min-height:1.2em;color:var(--muted,#667085);margin:0}.gc-workforce-message.is-error{color:#b42318}
      @media(max-width:680px){.gc-workforce-premium{padding:13px}.gc-workforce-tools>*{flex:1 1 145px;min-height:44px}.gc-workforce-dialog-grid{grid-template-columns:1fr}.gc-availability-row{grid-template-columns:1fr 1fr}.gc-availability-row>strong{grid-column:1/-1}.gc-workforce-row{grid-template-columns:1fr}.gc-workforce-row-actions{justify-content:flex-start}.gc-workforce-dialog-actions>*{flex:1 1 140px;min-height:44px}}
    `;
    document.head.appendChild(style);
  }

  function host(){return document.getElementById('schedule-board');}
  function ensureDialog(){
    injectStyle();
    let dialog=document.getElementById('gc-workforce-dialog');
    if(!dialog){dialog=document.createElement('dialog');dialog.id='gc-workforce-dialog';dialog.className='gc-workforce-dialog';document.body.appendChild(dialog);}
    return dialog;
  }
  function closeDialog(){const d=ensureDialog();if(d.open)d.close();}

  function currentWeek(){return scheduleState()?.weekStart||dateOnly(new Date());}
  function myName(){return profile()?.display_name||'My';}

  async function load({quiet=false}={}){
    if(!active()||loading)return;
    const target=host();
    if(!target)return;
    loading=true;
    try{
      const state=scheduleState();
      if(!state?.summary){setTimeout(()=>load({quiet:true}),180);return;}
      const result=await client.rpc('get_workforce_premium_summary',{target_week:currentWeek()});
      if(result.error)throw result.error;
      data=result.data||{};
      render();
    }catch(error){
      console.error('Workforce premium tools failed:',error);
      if(!quiet)window.GotCrackedDiagnostics?.error?.(error,{context:'Workforce tools unavailable'});
    }finally{loading=false;}
  }

  function conflictsMarkup(items){
    if(!items.length)return '<div class="gc-workforce-row"><div class="gc-workforce-row-copy"><strong>No schedule conflicts</strong><span>Availability, time off, overlap, long-day, and overtime checks are clear.</span></div></div>';
    return items.map(item=>`<div class="gc-workforce-row"><div class="gc-workforce-row-copy"><span class="gc-workforce-severity ${esc(item.severity||'warning')}">${esc(String(item.severity||'warning').toUpperCase())}</span><strong>${esc(item.employee_name||'Staff')}${item.date?` · ${esc(fmtDate(item.date))}`:''}</strong><span>${esc(item.message||label(item.type))}</span></div></div>`).join('');
  }

  function requestMarkup(request,canManage){
    const date=request.shift_date?fmtDate(request.shift_date):'Shift';
    const time=request.starts_at?`${fmtTime(request.starts_at)} – ${fmtTime(request.ends_at)}`:'';
    const actions=request.status==='pending'?(canManage
      ?`<button class="secondary-button" type="button" data-wf-review="approved" data-request-id="${esc(request.id)}">Approve</button><button class="danger-button" type="button" data-wf-review="denied" data-request-id="${esc(request.id)}">Deny</button>`
      :request.requester_id===profile()?.id?`<button class="text-button" type="button" data-wf-cancel-request="${esc(request.id)}">Cancel</button>`:'') : '';
    return `<div class="gc-workforce-row"><div class="gc-workforce-row-copy"><strong>${esc(request.requester_name||'Staff')} · ${esc(label(request.request_type))}</strong><span>${esc(date)}${time?` · ${esc(time)}`:''} · ${esc(label(request.status))}</span>${request.note?`<small>${esc(request.note)}</small>`:''}${request.manager_note?`<small>Manager: ${esc(request.manager_note)}</small>`:''}</div><div class="gc-workforce-row-actions">${actions}</div></div>`;
  }

  function myShiftMarkup(shift){
    return `<div class="gc-workforce-row"><div class="gc-workforce-row-copy"><strong>${esc(fmtDate(shift.date))} · ${esc(fmtTime(shift.starts_at))} – ${esc(fmtTime(shift.ends_at))}</strong><span>${esc(shift.role_label||'Scheduled shift')} · ${esc(label(shift.status))}</span></div>${shift.status==='published'?`<div class="gc-workforce-row-actions"><button class="secondary-button" type="button" data-wf-request-shift="${esc(shift.id)}">Request change</button></div>`:'<span></span>'}</div>`;
  }

  function render(){
    const page=host()?.querySelector('.gc-schedule-page');
    if(!page||!data)return;
    page.querySelector('.gc-workforce-premium')?.remove();
    const canManage=Boolean(data.can_manage);
    const conflicts=Array.isArray(data.conflicts)?data.conflicts:[];
    const requests=Array.isArray(data.shift_requests)?data.shift_requests:[];
    const pending=requests.filter(item=>item.status==='pending');
    const myShifts=Array.isArray(data.my_shifts)?data.my_shifts:[];
    const errors=conflicts.filter(item=>item.severity==='error').length;
    const warnings=conflicts.length-errors;
    const availability=Array.isArray(data.availability)?data.availability:[];
    const ownAvailability=availability.filter(item=>item.employee_id===profile()?.id).length;
    const card=document.createElement('section');
    card.className='gc-workforce-premium';
    card.innerHTML=`
      <div class="gc-workforce-premium-head"><div><p class="eyebrow">Premium workforce</p><h2>Schedule intelligence & team controls</h2><p>Availability, schedule health, shift changes, attendance policy, and reusable week planning.</p></div><div class="gc-workforce-tools"><button class="secondary-button" type="button" data-wf-availability>My availability</button>${myShifts.some(item=>item.status==='published')?'<button class="secondary-button" type="button" data-wf-request-first>Request shift change</button>':''}${canManage?'<button class="secondary-button" type="button" data-wf-copy-week>Copy previous week</button><button class="secondary-button" type="button" data-wf-policy>Time-clock policy</button>':''}</div></div>
      <div class="gc-workforce-metrics">
        <div class="gc-workforce-metric ${errors?'is-bad':warnings?'is-warning':''}"><small>Schedule health</small><strong>${canManage?(conflicts.length?`${conflicts.length} flag${conflicts.length===1?'':'s'}`:'Clear'):'Published view'}</strong><span>${canManage?`${errors} blocking · ${warnings} warning`:'Your schedule + requests'}</span></div>
        <div class="gc-workforce-metric ${pending.length?'is-warning':''}"><small>Shift requests</small><strong>${pending.length}</strong><span>${canManage?'Pending manager review':'Pending / involving you'}</span></div>
        <div class="gc-workforce-metric"><small>My availability</small><strong>${ownAvailability?`${ownAvailability}/7 days`:'Not set'}</strong><span>Recurring weekly preferences</span></div>
        <div class="gc-workforce-metric"><small>My shifts</small><strong>${myShifts.length}</strong><span>This work week</span></div>
      </div>
      ${canManage?`<details class="gc-workforce-panel" ${conflicts.length?'open':''}><summary>Schedule health ${conflicts.length?`(${conflicts.length})`:''}</summary><div class="gc-workforce-list">${conflictsMarkup(conflicts)}</div></details>`:''}
      ${requests.length?`<details class="gc-workforce-panel" ${pending.length?'open':''}><summary>Shift-change requests ${pending.length?`(${pending.length} pending)`:''}</summary><div class="gc-workforce-list">${requests.map(item=>requestMarkup(item,canManage)).join('')}</div></details>`:''}
      ${myShifts.length?`<details class="gc-workforce-panel"><summary>${esc(myName())} shifts</summary><div class="gc-workforce-list">${myShifts.map(myShiftMarkup).join('')}</div></details>`:''}`;
    const toolbar=page.querySelector('.gc-schedule-toolbar');
    if(toolbar)toolbar.insertAdjacentElement('afterend',card);else page.prepend(card);
  }

  function availabilityByDay(day){
    const list=(data?.availability||[]).filter(item=>item.employee_id===profile()?.id);
    return list.find(item=>Number(item.weekday)===day)||null;
  }

  function openAvailability(){
    const names=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const dialog=ensureDialog();
    dialog.innerHTML=`<form id="gc-workforce-availability-form"><div class="gc-workforce-dialog-head"><div><p class="eyebrow">Recurring availability</p><h2>My weekly availability</h2><p>Used by Schedule Health before a manager publishes shifts.</p></div><button class="icon-button" type="button" data-wf-close>×</button></div><div class="gc-availability-grid">${names.map((name,day)=>{
      const row=availabilityByDay(day);
      const available=row?row.is_available:true;
      return `<div class="gc-availability-row" data-availability-day="${day}"><strong>${name}</strong><label><input type="checkbox" name="available_${day}" ${available?'checked':''}> Available</label><input aria-label="${name} available from" name="start_${day}" type="time" value="${esc(String(row?.starts_at||'09:00').slice(0,5))}" ${available?'':'disabled'}><input aria-label="${name} available until" name="end_${day}" type="time" value="${esc(String(row?.ends_at||'18:00').slice(0,5))}" ${available?'':'disabled'}></div>`;
    }).join('')}</div><p class="gc-workforce-message" role="status"></p><div class="gc-workforce-dialog-actions"><button class="secondary-button" type="button" data-wf-close>Cancel</button><button class="primary-button" type="submit">Save availability</button></div></form>`;
    dialog.showModal();
  }

  async function saveAvailability(form){
    const entries=[];
    for(let day=0;day<7;day++){
      const available=form.elements[`available_${day}`].checked;
      entries.push({weekday:day,is_available:available,starts_at:available?form.elements[`start_${day}`].value:null,ends_at:available?form.elements[`end_${day}`].value:null});
    }
    const result=await client.rpc('save_staff_weekly_availability',{entries});
    if(result.error)throw result.error;
    closeDialog();await load({quiet:true});
  }

  function openCopyWeek(){
    const target=currentWeek();
    const source=addDays(target,-7);
    const dialog=ensureDialog();
    dialog.innerHTML=`<form id="gc-workforce-copy-form"><div class="gc-workforce-dialog-head"><div><p class="eyebrow">Schedule accelerator</p><h2>Copy previous week</h2><p>Copies employee assignments, times, breaks, roles, and notes into a new draft.</p></div><button class="icon-button" type="button" data-wf-close>×</button></div><div class="gc-workforce-dialog-grid"><label>Source week<input name="source" type="date" required value="${source}"></label><label>Target week<input name="target" type="date" required value="${target}"></label></div><label style="display:flex;grid-template-columns:none;align-items:flex-start;gap:8px"><input style="width:auto;margin-top:3px" name="replace" type="checkbox"><span>Replace shifts already in the target week</span></label><p class="gc-workforce-message" role="status"></p><div class="gc-workforce-dialog-actions"><button class="secondary-button" type="button" data-wf-close>Cancel</button><button class="primary-button" type="submit">Copy into draft</button></div></form>`;
    dialog.showModal();
  }

  async function copyWeek(form){
    const result=await client.rpc('copy_schedule_week',{source_week:form.elements.source.value,target_week:form.elements.target.value,replace_existing:form.elements.replace.checked});
    if(result.error)throw result.error;
    closeDialog();
    await window.GotCrackedScheduleBoard?.load?.({quiet:true});
    await load({quiet:true});
  }

  function openPolicy(){
    const s=data?.settings||{};
    const dialog=ensureDialog();
    dialog.innerHTML=`<form id="gc-workforce-policy-form"><div class="gc-workforce-dialog-head"><div><p class="eyebrow">Attendance controls</p><h2>Time-clock policy</h2><p>Managers can tighten enforcement without changing the employee time-clock workflow.</p></div><button class="icon-button" type="button" data-wf-close>×</button></div><div class="gc-workforce-dialog-grid"><label>Early clock-in window (minutes)<input name="early" type="number" min="0" max="240" required value="${num(s.early_clock_in_minutes)||10}"></label><label>Late grace period (minutes)<input name="late" type="number" min="0" max="240" required value="${num(s.late_grace_minutes)||5}"></label><label>Overtime warning (hours)<input name="overtime" type="number" min="1" max="168" step="0.25" required value="${num(s.overtime_warning_hours)||40}"></label><span></span></div><label style="display:flex;grid-template-columns:none;align-items:flex-start;gap:8px"><input style="width:auto;margin-top:3px" name="require_schedule" type="checkbox" ${s.require_scheduled_shift?'checked':''}><span>Require a published shift before clock-in</span></label><label style="display:flex;grid-template-columns:none;align-items:flex-start;gap:8px"><input style="width:auto;margin-top:3px" name="enforce_early" type="checkbox" ${s.enforce_early_window?'checked':''}><span>Block clock-ins earlier than the allowed window</span></label><p class="gc-workforce-message" role="status"></p><div class="gc-workforce-dialog-actions"><button class="secondary-button" type="button" data-wf-close>Cancel</button><button class="primary-button" type="submit">Save policy</button></div></form>`;
    dialog.showModal();
  }

  async function savePolicy(form){
    const result=await client.rpc('save_workforce_settings',{early_minutes:Number(form.elements.early.value),late_minutes:Number(form.elements.late.value),overtime_hours:Number(form.elements.overtime.value),require_schedule:form.elements.require_schedule.checked,enforce_early:form.elements.enforce_early.checked});
    if(result.error)throw result.error;
    closeDialog();await load({quiet:true});await window.GotCrackedTimeClock?.load?.({quiet:true});
  }

  function shiftOption(shift){return `${fmtDate(shift.date)} · ${fmtTime(shift.starts_at)}–${fmtTime(shift.ends_at)}${shift.role_label?` · ${shift.role_label}`:''}`;}
  function swapOption(shift){return `${shift.employee_name||'Staff'} · ${fmtDate(shift.date)} · ${fmtTime(shift.starts_at)}–${fmtTime(shift.ends_at)}`;}

  function openShiftRequest(preselected){
    const myShifts=(data?.my_shifts||[]).filter(item=>item.status==='published');
    if(!myShifts.length)return;
    const candidates=data?.swap_candidates||[];
    const dialog=ensureDialog();
    dialog.innerHTML=`<form id="gc-workforce-request-form"><div class="gc-workforce-dialog-head"><div><p class="eyebrow">Employee self-service</p><h2>Request a shift change</h2><p>Drop and swap requests remain pending until management approves them.</p></div><button class="icon-button" type="button" data-wf-close>×</button></div><label>My shift<select name="shift_id" required>${myShifts.map(item=>`<option value="${esc(item.id)}" ${item.id===preselected?'selected':''}>${esc(shiftOption(item))}</option>`).join('')}</select></label><label>Request<select name="request_type"><option value="drop">Drop this shift</option><option value="swap">Swap with another published shift</option></select></label><label data-wf-swap-wrap style="display:none">Swap with<select name="target_shift">${candidates.map(item=>`<option value="${esc(item.id)}">${esc(swapOption(item))}</option>`).join('')}</select></label><label>Note<textarea name="note" rows="3" placeholder="Optional context for management"></textarea></label><p class="gc-workforce-message" role="status"></p><div class="gc-workforce-dialog-actions"><button class="secondary-button" type="button" data-wf-close>Cancel</button><button class="primary-button" type="submit">Send request</button></div></form>`;
    dialog.showModal();
  }

  async function saveShiftRequest(form){
    const type=form.elements.request_type.value;
    if(type==='swap'&&!form.elements.target_shift.value)throw new Error('No eligible swap shift is available.');
    const result=await client.rpc('request_shift_change',{shift_id_input:form.elements.shift_id.value,request_type_input:type,target_shift_input:type==='swap'?form.elements.target_shift.value:null,request_note:form.elements.note.value.trim()||null});
    if(result.error)throw result.error;
    closeDialog();await load({quiet:true});
  }

  async function reviewRequest(id,decision){
    const note=decision==='denied'?prompt('Optional manager note for the employee:','')||null:null;
    const result=await client.rpc('review_shift_change',{request_id_input:id,decision_input:decision,manager_note_input:note});
    if(result.error)throw result.error;
    await window.GotCrackedScheduleBoard?.load?.({quiet:true});await load({quiet:true});
  }

  async function cancelRequest(id){
    const result=await client.rpc('cancel_shift_change',{request_id_input:id});
    if(result.error)throw result.error;
    await load({quiet:true});
  }

  async function guarded(fn,button){
    if(button)button.disabled=true;
    const form=button?.closest('form');
    const message=form?.querySelector('.gc-workforce-message');
    try{if(message){message.classList.remove('is-error');message.textContent='Saving…';}await fn();}
    catch(error){console.error('Workforce action failed:',error);if(message){message.classList.add('is-error');message.textContent=error?.message||'Update failed.';}else window.GotCrackedDiagnostics?.error?.(error,{context:'Workforce update failed'});}
    finally{if(button)button.disabled=false;}
  }

  document.addEventListener('change',event=>{
    const input=event.target instanceof Element?event.target:null;
    if(input?.matches('[name^="available_"]')){
      const row=input.closest('[data-availability-day]');
      row?.querySelectorAll('input[type="time"]').forEach(control=>{control.disabled=!input.checked;});
    }
    if(input?.matches('#gc-workforce-request-form [name="request_type"]')){
      const wrap=input.closest('form')?.querySelector('[data-wf-swap-wrap]');
      if(wrap)wrap.style.display=input.value==='swap'?'grid':'none';
    }
  });

  document.addEventListener('submit',event=>{
    const form=event.target;
    if(!(form instanceof HTMLFormElement))return;
    if(form.id==='gc-workforce-availability-form'){event.preventDefault();guarded(()=>saveAvailability(form),form.querySelector('button[type="submit"]'));}
    if(form.id==='gc-workforce-copy-form'){event.preventDefault();guarded(()=>copyWeek(form),form.querySelector('button[type="submit"]'));}
    if(form.id==='gc-workforce-policy-form'){event.preventDefault();guarded(()=>savePolicy(form),form.querySelector('button[type="submit"]'));}
    if(form.id==='gc-workforce-request-form'){event.preventDefault();guarded(()=>saveShiftRequest(form),form.querySelector('button[type="submit"]'));}
  });

  document.addEventListener('click',event=>{
    const target=event.target instanceof Element?event.target:null;
    if(!target)return;
    if(target.closest('[data-wf-close]')){closeDialog();return;}
    if(target.closest('[data-wf-availability]')){openAvailability();return;}
    if(target.closest('[data-wf-copy-week]')){openCopyWeek();return;}
    if(target.closest('[data-wf-policy]')){openPolicy();return;}
    const shiftButton=target.closest('[data-wf-request-shift]');if(shiftButton){openShiftRequest(shiftButton.dataset.wfRequestShift);return;}
    if(target.closest('[data-wf-request-first]')){openShiftRequest();return;}
    const review=target.closest('[data-wf-review][data-request-id]');if(review){guarded(()=>reviewRequest(review.dataset.requestId,review.dataset.wfReview),review);return;}
    const cancel=target.closest('[data-wf-cancel-request]');if(cancel){guarded(()=>cancelRequest(cancel.dataset.wfCancelRequest),cancel);}
  });

  function watch(){
    const target=host();
    if(!target||observer)return;
    observer=new MutationObserver(()=>{
      if(!active()||renderQueued||target.querySelector('.gc-workforce-premium'))return;
      renderQueued=true;setTimeout(()=>{renderQueued=false;load({quiet:true});},100);
    });
    observer.observe(target,{childList:true,subtree:false});
  }

  document.addEventListener('gc-view-changed',event=>{
    const view=typeof event.detail==='string'?event.detail:event.detail?.view;
    if(view==='schedule'){watch();setTimeout(()=>load({quiet:true}),220);}
  });
  document.addEventListener('gc-cross-user-sync',()=>{if(active())load({quiet:true});});
  window.addEventListener('hashchange',()=>{if(active()){watch();setTimeout(()=>load({quiet:true}),220);}});

  injectStyle();watch();if(active())setTimeout(()=>load(),250);
  window.GotCrackedWorkforcePremium={load,get data(){return data;}};
})();
