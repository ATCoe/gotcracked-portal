(() => {
  'use strict';

  const client = window.supabaseClient;
  if (!client || window.GotCrackedScheduleBoard) return;

  const DAY_MS = 86400000;
  const state = {
    weekStart: sundayOf(),
    summary: null,
    profile: window.GotCrackedRuntimeProfile || window.GotCrackedOperationsV1?.state?.profile || null,
    loading: false,
    loadToken: 0
  };

  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[char]);
  const money = cents => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format((Number(cents)||0)/100);
  const shortMoney = cents => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0,notation:Number(cents||0)>=1000000?'compact':'standard'}).format((Number(cents)||0)/100);
  const number = value => Number(value) || 0;
  const dateOnly = date => new Date(date.getTime() - date.getTimezoneOffset()*60000).toISOString().slice(0,10);
  const parseDate = value => new Date(`${value}T12:00:00`);
  const addDays = (value, count) => dateOnly(new Date(parseDate(value).getTime() + count*DAY_MS));
  function sundayOf(value = dateOnly(new Date())) {
    const date = parseDate(value);
    date.setDate(date.getDate() - date.getDay());
    return dateOnly(date);
  }
  const initials = value => String(value || 'GC').trim().split(/\s+/).slice(0,2).map(part=>part[0]?.toUpperCase()||'').join('') || 'GC';
  const roleLabel = value => String(value || 'staff').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
  const formatDate = (value, options={month:'short',day:'numeric'}) => new Intl.DateTimeFormat('en-US',options).format(parseDate(value));
  const formatRange = (start, end) => `${formatDate(start,{month:'short',day:'numeric'})} – ${formatDate(end,{month:'short',day:'numeric',year:'numeric'})}`;
  const formatTime = value => {
    if (!value) return '';
    const [h,m] = String(value).slice(0,5).split(':').map(Number);
    const date = new Date(); date.setHours(h,m,0,0);
    return new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit'}).format(date);
  };
  const shiftHours = shift => {
    const [sh,sm]=String(shift.starts_at||'00:00').split(':').map(Number);
    const [eh,em]=String(shift.ends_at||'00:00').split(':').map(Number);
    return Math.max(0,((eh*60+em)-(sh*60+sm)-number(shift.break_minutes))/60);
  };

  function host(){ return document.getElementById('schedule-board'); }
  function active(){ return location.hash.slice(1).split('/')[0] === 'schedule'; }
  function today(){ return dateOnly(new Date()); }
  function profile(){ return state.profile || window.GotCrackedRuntimeProfile || window.GotCrackedOperationsV1?.state?.profile || null; }

  function ensureDialog(){
    let dialog=document.getElementById('gc-schedule-dialog');
    if(!dialog){
      dialog=document.createElement('dialog');
      dialog.id='gc-schedule-dialog';
      dialog.className='gc-schedule-dialog';
      document.body.appendChild(dialog);
    }
    return dialog;
  }

  function closeDialog(){ const dialog=ensureDialog(); if(dialog.open) dialog.close(); }

  async function hasViewPermission(){
    const {data,error}=await client.rpc('has_permission',{permission_key:'schedule.view'});
    if(error) throw error;
    return Boolean(data);
  }

  async function load({quiet=false}={}){
    if(state.loading) return;
    const target=host();
    if(!target) return;
    state.loading=true;
    const token=++state.loadToken;
    if(!quiet) target.innerHTML='<div class="empty-card"><span>◷</span><h2>Loading workforce plan…</h2><p>Connecting sales, SPLH, repairs, appointments, and staffing.</p></div>';
    try{
      if(!state.profile) state.profile=await window.GotCrackedRuntime?.waitForProfile?.() || profile();
      if(!state.profile?.location_id) throw new Error('A store assignment is required to view the schedule.');
      if(!(await hasViewPermission())){
        document.querySelectorAll('[data-view="schedule"]').forEach(node=>node.classList.add('v1-hidden'));
        if(active()) location.hash='#dashboard';
        return;
      }
      document.querySelectorAll('[data-view="schedule"]').forEach(node=>node.classList.remove('v1-hidden'));
      const {data,error}=await client.rpc('get_schedule_planning_summary',{target_week:state.weekStart});
      if(error) throw error;
      if(token!==state.loadToken) return;
      state.summary=data || {};
      state.weekStart=state.summary.week_start || state.weekStart;
      render();
    }catch(error){
      console.error('Schedule load failed:',error);
      target.innerHTML=`<div class="empty-card"><span>!</span><h2>Schedule could not load</h2><p>${esc(error.message||'Try again.')}</p><button class="secondary-button" type="button" data-schedule-retry>Retry</button></div>`;
    }finally{ state.loading=false; }
  }

  function coverage(day){
    if(number(day.open_hours)<=0) return {cls:'neutral',label:'Closed'};
    const delta=number(day.coverage_delta_hours);
    if(delta < -1) return {cls:'bad',label:`${Math.abs(delta).toFixed(1)}h short`};
    if(delta < -.25) return {cls:'warn',label:`${Math.abs(delta).toFixed(1)}h short`};
    if(delta > 2) return {cls:'warn',label:`+${delta.toFixed(1)}h`};
    return {cls:'good',label:'Covered'};
  }

  function renderManagementSummary(summary){
    const totals=summary.totals||{};
    const delta=number(totals.scheduled_hours)-number(totals.suggested_hours);
    const coverageText=delta < 0 ? `${Math.abs(delta).toFixed(1)}h under plan` : delta > 0 ? `${delta.toFixed(1)}h over plan` : 'On plan';
    return `<article class="gc-schedule-summary">
      <div class="gc-schedule-summary-head"><div><h2>Labor plan</h2><p>Suggested workload uses the same sales and SPLH economics as the Dashboard goal engine.</p></div><span class="gc-schedule-status ${esc(summary.status||'draft')}">${esc(roleLabel(summary.status||'draft'))}</span></div>
      <div class="gc-schedule-metrics">
        <div class="gc-schedule-metric"><small>Target SPLH</small><strong>${money(number(summary.target_splh)*100)}</strong><span>Sales per scheduled labor hour</span></div>
        <div class="gc-schedule-metric"><small>Suggested sales</small><strong>${shortMoney(totals.suggested_sales_cents)}</strong><span>History + known repair opportunity</span></div>
        <div class="gc-schedule-metric"><small>Suggested labor</small><strong>${number(totals.suggested_hours).toFixed(1)}h</strong><span>Minimum coverage + repair workload</span></div>
        <div class="gc-schedule-metric"><small>Scheduled labor</small><strong>${number(totals.scheduled_hours).toFixed(1)}h</strong><span>${esc(coverageText)}</span></div>
      </div>
      <form class="gc-schedule-plan" id="gc-schedule-plan-form">
        <label>Weekly sales forecast<input name="forecast" type="number" min="0" step="100" value="${Math.round(number(summary.weekly_forecast_cents)/100)}" inputmode="decimal"></label>
        <label>Target SPLH<input name="splh" type="number" min="1" step="1" value="${number(summary.target_splh).toFixed(0)}" inputmode="decimal"></label>
        <button class="secondary-button" type="submit">Save planning targets</button>
      </form>
    </article>`;
  }

  function renderDayIntel(summary){
    return `<article class="gc-schedule-intel"><div class="gc-schedule-intel-head"><div><h2>Demand forecast</h2><p>Each day blends historical demand, sales forecast, repair bench time, appointments, expected leads, and open backlog.</p></div><small>${number(summary.history_days)} closed day${number(summary.history_days)===1?'':'s'} of history</small></div><div class="gc-schedule-days">${(summary.days||[]).map(day=>{
      const c=coverage(day);
      return `<section class="gc-schedule-day-intel ${number(day.open_hours)<=0?'closed':''}"><header><div><strong>${formatDate(day.date,{weekday:'short'})}</strong><small>${formatDate(day.date)}</small></div><span class="gc-coverage-chip ${c.cls}">${esc(c.label)}</span></header><div class="gc-schedule-day-numbers"><span><b>${number(day.suggested_hours).toFixed(1)}h</b> suggested · ${number(day.scheduled_hours).toFixed(1)}h scheduled</span><span><b>${shortMoney(day.suggested_sales_cents)}</b> demand</span><span>${number(day.promised_repairs)} repairs · ${number(day.appointments)} appts · ${number(day.leads_expected)} leads</span></div><p class="gc-schedule-day-reason">${esc(day.reason||'')}</p></section>`;
    }).join('')}</div></article>`;
  }

  function timeOffFor(employeeId,date){
    return (state.summary?.time_off||[]).filter(item=>item.employee_id===employeeId && item.starts_on<=date && item.ends_on>=date && ['approved','pending'].includes(item.status));
  }

  function shiftCards(employeeId,date,canManage){
    const shifts=(state.summary?.shifts||[]).filter(item=>item.employee_id===employeeId && item.shift_date===date);
    const cards=shifts.map(shift=>{
      const hrs=shiftHours(shift).toFixed(1);
      const body=`<strong>${formatTime(shift.starts_at)} – ${formatTime(shift.ends_at)}</strong><span>${hrs} hrs${shift.break_minutes?` · ${shift.break_minutes}m break`:''}</span>${shift.role_label?`<small>${esc(shift.role_label)}</small>`:''}`;
      return canManage?`<button class="gc-shift-card" type="button" data-edit-shift="${esc(shift.id)}">${body}</button>`:`<div class="gc-shift-card">${body}</div>`;
    }).join('');
    const leave=timeOffFor(employeeId,date).map(item=>`<span class="gc-timeoff-badge">${item.status==='pending'?'Pending ':''}${esc(roleLabel(item.request_type||'Time off'))}</span>`).join('');
    return `${leave}${cards}${!cards&&!leave?'<span class="gc-schedule-empty-shift">—</span>':''}`;
  }

  function renderBoard(summary){
    const staff=summary.staff||[];
    const days=summary.days||[];
    const canManage=Boolean(summary.can_manage);
    const todayValue=today();
    return `<article class="gc-schedule-board-card"><div class="gc-schedule-board-head"><div><h2>Weekly schedule</h2><p>Sunday through Saturday. ${canManage?'Tap any employee/day cell to add a shift; tap a shift to edit it.':'Published store schedule.'}</p></div>${canManage?'<button class="primary-button" type="button" data-schedule-add-first>+ Add shift</button>':''}</div><div class="gc-schedule-board-scroll"><div class="gc-schedule-grid"><div class="gc-schedule-corner">Team</div>${days.map(day=>`<div class="gc-schedule-day-head ${day.date===todayValue?'today':''}"><strong>${formatDate(day.date,{weekday:'short'})}</strong><small>${formatDate(day.date)}</small></div>`).join('')}${staff.map(member=>`<div class="gc-schedule-employee"><span class="gc-schedule-avatar">${esc(initials(member.display_name))}</span><div><strong>${esc(member.display_name||'Staff')}</strong><small>${esc(roleLabel(member.role))}</small></div></div>${days.map(day=>`<div class="gc-schedule-cell ${day.date===todayValue?'today':''} ${timeOffFor(member.id,day.date).length?'is-timeoff':''}" data-can-manage="${canManage}" ${canManage?`data-add-shift="1" data-employee-id="${esc(member.id)}" data-shift-date="${esc(day.date)}" tabindex="0"`:''}>${shiftCards(member.id,day.date,canManage)}${canManage?'<button class="gc-schedule-cell-add" type="button" aria-label="Add shift">+</button>':''}</div>`).join('')}`).join('')}</div></div></article>`;
  }

  function renderTimeOff(summary){
    const staff=summary.staff||[];
    const rows=summary.time_off||[];
    const canManage=Boolean(summary.can_manage);
    const staffName=id=>staff.find(item=>item.id===id)?.display_name||'Staff';
    return `<article class="gc-schedule-timeoff"><div class="gc-schedule-timeoff-head"><div><h2>Time off</h2><p>Requests and approved absences affecting this work week.</p></div><button class="secondary-button" type="button" data-request-timeoff>Request time off</button></div><div class="gc-timeoff-list">${rows.length?rows.map(item=>`<div class="gc-timeoff-row"><div><strong>${esc(staffName(item.employee_id))}</strong><small>${esc(roleLabel(item.request_type||'Time off'))}</small></div><div><strong>${formatRange(item.starts_on,item.ends_on)}</strong><small>${item.status==='approved'?'Included in schedule planning':item.status==='pending'?'Awaiting management review':'Request closed'}</small></div><span class="gc-timeoff-status ${esc(item.status)}">${esc(item.status)}</span>${canManage&&item.status==='pending'?`<div class="gc-timeoff-actions"><button class="secondary-button" type="button" data-timeoff-decision="approved" data-timeoff-id="${esc(item.id)}">Approve</button><button class="danger-button" type="button" data-timeoff-decision="denied" data-timeoff-id="${esc(item.id)}">Deny</button></div>`:'<span></span>'}</div>`).join(''):'<div class="gc-schedule-empty"><strong>No time off this week</strong><span>Approved or pending requests will appear here.</span></div>'}</div></article>`;
  }

  function render(){
    const summary=state.summary||{};
    const target=host();
    if(!target) return;
    const canManage=Boolean(summary.can_manage);
    target.innerHTML=`<div class="gc-schedule-page">
      <div class="gc-schedule-toolbar"><div class="gc-schedule-week-nav"><button class="secondary-button" type="button" data-schedule-week="-7">←</button><div class="gc-schedule-week-title"><strong>${formatRange(summary.week_start||state.weekStart,summary.week_end||addDays(state.weekStart,6))}</strong><small>Sunday – Saturday</small></div><button class="secondary-button" type="button" data-schedule-week="7">→</button><button class="text-button" type="button" data-schedule-today>Current week</button></div><div class="gc-schedule-toolbar-actions"><span class="gc-schedule-status ${esc(summary.status||'unpublished')}">${esc(roleLabel(summary.status||'unpublished'))}</span>${canManage?`<button class="${summary.status==='published'?'secondary-button':'primary-button'}" type="button" data-toggle-publish>${summary.status==='published'?'Return to draft':'Publish schedule'}</button>`:''}</div></div>
      ${canManage?renderManagementSummary(summary):''}
      ${canManage?renderDayIntel(summary):''}
      ${renderBoard(summary)}
      ${renderTimeOff(summary)}
    </div>`;
  }

  async function ensureWeek(){
    if(state.summary?.week_id) return state.summary.week_id;
    if(!state.summary?.can_manage) throw new Error('Schedule management permission is required.');
    const p=profile();
    const payload={location_id:p.location_id,week_start:state.weekStart,status:'draft',target_splh:number(state.summary?.target_splh)||null,forecast_sales_cents:number(state.summary?.weekly_forecast_cents)||0};
    const {data,error}=await client.from('schedule_weeks').upsert(payload,{onConflict:'location_id,week_start'}).select('id').single();
    if(error) throw error;
    state.summary.week_id=data.id;
    state.summary.status='draft';
    return data.id;
  }

  async function markDraft(){
    const id=await ensureWeek();
    if(state.summary?.status==='published'){
      const {error}=await client.from('schedule_weeks').update({status:'draft',published_at:null,published_by:null,updated_at:new Date().toISOString()}).eq('id',id);
      if(error) throw error;
    }
    state.summary.status='draft';
    return id;
  }

  async function savePlan(form){
    const data=Object.fromEntries(new FormData(form));
    const id=await ensureWeek();
    const payload={forecast_sales_cents:Math.max(0,Math.round(number(data.forecast)*100)),target_splh:Math.max(1,number(data.splh)),status:'draft',published_at:null,published_by:null,updated_at:new Date().toISOString()};
    const {error}=await client.from('schedule_weeks').update(payload).eq('id',id);
    if(error) throw error;
    await load({quiet:true});
  }

  async function togglePublish(){
    const id=await ensureWeek();
    const publishing=state.summary?.status!=='published';
    const p=profile();
    const payload=publishing?{status:'published',published_at:new Date().toISOString(),published_by:p.id,updated_at:new Date().toISOString()}:{status:'draft',published_at:null,published_by:null,updated_at:new Date().toISOString()};
    const {error}=await client.from('schedule_weeks').update(payload).eq('id',id);
    if(error) throw error;
    await load({quiet:true});
  }

  function shiftById(id){ return (state.summary?.shifts||[]).find(item=>item.id===id); }
  function staffOption(id){ return (state.summary?.staff||[]).map(member=>`<option value="${esc(member.id)}" ${member.id===id?'selected':''}>${esc(member.display_name||'Staff')}</option>`).join(''); }
  function dateOption(value){ return (state.summary?.days||[]).map(day=>`<option value="${esc(day.date)}" ${day.date===value?'selected':''}>${formatDate(day.date,{weekday:'long',month:'short',day:'numeric'})}</option>`).join(''); }

  function openShiftDialog({employeeId,date,id=null}={}){
    if(!state.summary?.can_manage) return;
    const existing=id?shiftById(id):null;
    const chosenEmployee=existing?.employee_id||employeeId||state.summary?.staff?.[0]?.id||'';
    const chosenDate=existing?.shift_date||date||state.weekStart;
    const dialog=ensureDialog();
    dialog.innerHTML=`<form id="gc-shift-form"><div class="gc-dialog-head"><div><p class="eyebrow">Workforce schedule</p><h2>${existing?'Edit shift':'Add shift'}</h2></div><button class="icon-button" type="button" data-close-schedule-dialog>×</button></div><div class="gc-dialog-body"><input type="hidden" name="id" value="${esc(existing?.id||'')}"><label>Employee<select name="employee_id" required>${staffOption(chosenEmployee)}</select></label><label>Date<select name="shift_date" required>${dateOption(chosenDate)}</select></label><label>Start time<input name="starts_at" type="time" required value="${esc(String(existing?.starts_at||'09:00').slice(0,5))}"></label><label>End time<input name="ends_at" type="time" required value="${esc(String(existing?.ends_at||'17:00').slice(0,5))}"></label><label>Unpaid break (minutes)<input name="break_minutes" type="number" min="0" step="5" value="${number(existing?.break_minutes)}"></label><label>Coverage / role<input name="role_label" value="${esc(existing?.role_label||'')}" placeholder="Technician, Front desk"></label><label class="full">Shift notes<textarea name="notes" placeholder="Optional scheduling note">${esc(existing?.notes||'')}</textarea></label></div><p class="gc-schedule-message"></p><div class="gc-dialog-actions">${existing?'<button class="danger-button" type="button" data-delete-current-shift>Delete shift</button>':'<span></span>'}<div class="gc-dialog-actions-right"><button class="secondary-button" type="button" data-close-schedule-dialog>Cancel</button><button class="primary-button" type="submit">${existing?'Save shift':'Add shift'}</button></div></div></form>`;
    dialog.showModal();
  }

  async function saveShift(form){
    const values=Object.fromEntries(new FormData(form));
    const [sh,sm]=values.starts_at.split(':').map(Number);
    const [eh,em]=values.ends_at.split(':').map(Number);
    if(eh*60+em<=sh*60+sm) throw new Error('End time must be after start time.');
    const weekId=await markDraft();
    const payload={schedule_week_id:weekId,location_id:profile().location_id,employee_id:values.employee_id,shift_date:values.shift_date,starts_at:values.starts_at,ends_at:values.ends_at,break_minutes:Math.max(0,number(values.break_minutes)),role_label:values.role_label?.trim()||null,notes:values.notes?.trim()||null,updated_at:new Date().toISOString()};
    const query=values.id?client.from('shifts').update(payload).eq('id',values.id):client.from('shifts').insert(payload);
    const {error}=await query;
    if(error) throw error;
    closeDialog();
    await load({quiet:true});
  }

  async function deleteShift(id){
    if(!id||!state.summary?.can_manage) return;
    if(!window.confirm('Delete this shift?')) return;
    await markDraft();
    const {error}=await client.from('shifts').delete().eq('id',id);
    if(error) throw error;
    closeDialog();
    await load({quiet:true});
  }

  function openTimeOffDialog(){
    const dialog=ensureDialog();
    dialog.innerHTML=`<form id="gc-timeoff-form"><div class="gc-dialog-head"><div><p class="eyebrow">Availability</p><h2>Request time off</h2></div><button class="icon-button" type="button" data-close-schedule-dialog>×</button></div><div class="gc-dialog-body"><label>Starts<input name="starts_on" type="date" required value="${esc(state.weekStart)}"></label><label>Ends<input name="ends_on" type="date" required value="${esc(state.weekStart)}"></label><label>Type<select name="request_type"><option value="unpaid">Unpaid</option><option value="pto">PTO</option><option value="sick">Sick</option><option value="other">Other</option></select></label><label class="full">Reason<textarea name="reason" placeholder="Optional note for management"></textarea></label></div><p class="gc-schedule-message"></p><div class="gc-dialog-actions"><span></span><div class="gc-dialog-actions-right"><button class="secondary-button" type="button" data-close-schedule-dialog>Cancel</button><button class="primary-button" type="submit">Submit request</button></div></div></form>`;
    dialog.showModal();
  }

  async function saveTimeOff(form){
    const values=Object.fromEntries(new FormData(form));
    if(values.ends_on<values.starts_on) throw new Error('End date cannot be before start date.');
    const p=profile();
    const {error}=await client.from('time_off_requests').insert({location_id:p.location_id,employee_id:p.id,starts_on:values.starts_on,ends_on:values.ends_on,request_type:values.request_type,reason:values.reason?.trim()||null,status:'pending'});
    if(error) throw error;
    closeDialog();
    await load({quiet:true});
  }

  async function decideTimeOff(id,status){
    if(!state.summary?.can_manage) return;
    const p=profile();
    const {error}=await client.from('time_off_requests').update({status,reviewed_by:p.id,reviewed_at:new Date().toISOString()}).eq('id',id);
    if(error) throw error;
    await load({quiet:true});
  }

  async function guarded(action, element){
    try{
      if(element) element.disabled=true;
      await action();
    }catch(error){
      console.error('Schedule action failed:',error);
      const dialog=ensureDialog();
      const message=dialog.open?dialog.querySelector('.gc-schedule-message'):null;
      if(message) message.textContent=error.message||'The schedule could not be updated.';
      else window.GotCrackedDiagnostics?.error?.(error,{context:'Schedule update failed'});
    }finally{ if(element) element.disabled=false; }
  }

  document.addEventListener('submit',event=>{
    if(event.target.id==='gc-schedule-plan-form'){
      event.preventDefault();
      guarded(()=>savePlan(event.target),event.target.querySelector('button[type="submit"]'));
    }
    if(event.target.id==='gc-shift-form'){
      event.preventDefault();
      guarded(()=>saveShift(event.target),event.target.querySelector('button[type="submit"]'));
    }
    if(event.target.id==='gc-timeoff-form'){
      event.preventDefault();
      guarded(()=>saveTimeOff(event.target),event.target.querySelector('button[type="submit"]'));
    }
  });

  document.addEventListener('click',event=>{
    const target=event.target instanceof Element?event.target:null;
    if(!target) return;
    const retry=target.closest('[data-schedule-retry]'); if(retry){ load(); return; }
    const week=target.closest('[data-schedule-week]'); if(week){ state.weekStart=addDays(state.weekStart,number(week.dataset.scheduleWeek)); load(); return; }
    if(target.closest('[data-schedule-today]')){ state.weekStart=sundayOf(); load(); return; }
    const publish=target.closest('[data-toggle-publish]'); if(publish){ guarded(togglePublish,publish); return; }
    const edit=target.closest('[data-edit-shift]'); if(edit){ event.stopPropagation(); openShiftDialog({id:edit.dataset.editShift}); return; }
    const cell=target.closest('[data-add-shift][data-employee-id][data-shift-date]'); if(cell){ openShiftDialog({employeeId:cell.dataset.employeeId,date:cell.dataset.shiftDate}); return; }
    if(target.closest('[data-schedule-add-first]')){ openShiftDialog({employeeId:state.summary?.staff?.[0]?.id,date:state.weekStart}); return; }
    if(target.closest('[data-request-timeoff]')){ openTimeOffDialog(); return; }
    const decision=target.closest('[data-timeoff-decision]'); if(decision){ guarded(()=>decideTimeOff(decision.dataset.timeoffId,decision.dataset.timeoffDecision),decision); return; }
    if(target.closest('[data-close-schedule-dialog]')){ closeDialog(); return; }
    const del=target.closest('[data-delete-current-shift]'); if(del){ const id=ensureDialog().querySelector('[name="id"]')?.value; guarded(()=>deleteShift(id),del); }
  });

  document.addEventListener('keydown',event=>{
    if(event.key!=='Enter'||!(event.target instanceof Element)) return;
    const cell=event.target.closest('[data-add-shift][data-employee-id][data-shift-date]');
    if(cell){ event.preventDefault(); openShiftDialog({employeeId:cell.dataset.employeeId,date:cell.dataset.shiftDate}); }
  });

  document.addEventListener('gc-view-changed',event=>{ if(event.detail?.view==='schedule') load({quiet:Boolean(state.summary)}); });
  document.addEventListener('gc-cross-user-sync',()=>{ if(active()) load({quiet:true}); });
  window.addEventListener('hashchange',()=>{ if(active()) load({quiet:Boolean(state.summary)}); });

  window.GotCrackedScheduleBoard={
    load,
    get state(){ return state; }
  };

  if(active()) load();
})();
