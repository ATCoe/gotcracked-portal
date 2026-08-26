(() => {
  'use strict';

  const client = window.supabaseClient;
  if (!client || window.GotCrackedScheduleBoard) return;

  const DAY_MS = 86400000;
  const state = {
    weekStart: sundayOf(),
    summary: null,
    actuals: null,
    profile: window.GotCrackedRuntimeProfile || window.GotCrackedOperationsV1?.state?.profile || null,
    loading: false
  };

  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[c]);
  const num = value => Number(value) || 0;
  const money = dollars => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(num(dollars));
  const cents = value => money(num(value)/100);
  const dateOnly = date => new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,10);
  const parseDate = value => new Date(`${value}T12:00:00`);
  const addDays = (value,count) => dateOnly(new Date(parseDate(value).getTime()+count*DAY_MS));
  function sundayOf(value=dateOnly(new Date())){ const d=parseDate(value); d.setDate(d.getDate()-d.getDay()); return dateOnly(d); }
  const fmtDate = (value,options={month:'short',day:'numeric'}) => new Intl.DateTimeFormat('en-US',options).format(parseDate(value));
  const fmtRange = (start,end) => `${fmtDate(start)} – ${fmtDate(end,{month:'short',day:'numeric',year:'numeric'})}`;
  const fmtTime = value => {
    if(!value) return '';
    const [h,m]=String(value).slice(0,5).split(':').map(Number);
    const d=new Date(); d.setHours(h,m,0,0);
    return new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit'}).format(d);
  };
  const initials = value => String(value||'GC').trim().split(/\s+/).slice(0,2).map(x=>x[0]?.toUpperCase()||'').join('')||'GC';
  const label = value => String(value||'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
  const profile = () => state.profile || window.GotCrackedRuntimeProfile || window.GotCrackedOperationsV1?.state?.profile || null;
  const host = () => document.getElementById('schedule-board');
  const active = () => location.hash.slice(1).split('/')[0]==='schedule';

  function shiftHours(shift){
    const [sh,sm]=String(shift.starts_at||'00:00').split(':').map(Number);
    const [eh,em]=String(shift.ends_at||'00:00').split(':').map(Number);
    return Math.max(0,((eh*60+em)-(sh*60+sm)-num(shift.break_minutes))/60);
  }

  function ensureDialog(){
    let dialog=document.getElementById('gc-schedule-dialog');
    if(!dialog){ dialog=document.createElement('dialog'); dialog.id='gc-schedule-dialog'; dialog.className='gc-schedule-dialog'; document.body.appendChild(dialog); }
    return dialog;
  }
  function closeDialog(){ const d=ensureDialog(); if(d.open) d.close(); }

  async function permission(key){
    const {data,error}=await client.rpc('has_permission',{permission_key:key});
    if(error) throw error;
    return Boolean(data);
  }

  async function load({quiet=false}={}){
    if(state.loading) return;
    const target=host();
    if(!target) return;
    state.loading=true;
    if(!quiet) target.innerHTML='<div class="empty-card"><span>◷</span><h2>Loading weekly schedule…</h2><p>Connecting schedule and workload data.</p></div>';
    try{
      if(!state.profile) state.profile=await window.GotCrackedRuntime?.waitForProfile?.() || profile();
      if(!state.profile?.location_id) throw new Error('A store assignment is required to view the schedule.');

      const [canView,canManage]=await Promise.all([permission('schedule.view'),permission('schedule.manage')]);
      if(!canView){
        document.querySelectorAll('[data-view="schedule"]').forEach(node=>node.classList.add('v1-hidden'));
        if(active()) location.hash='#dashboard';
        return;
      }
      document.querySelectorAll('[data-view="schedule"]').forEach(node=>node.classList.remove('v1-hidden'));

      const rpcName=canManage?'get_schedule_management_summary':'get_staff_schedule_week';
      const summaryRequest=client.rpc(rpcName,{target_week:state.weekStart});
      const actualsRequest=canManage?client.rpc('get_schedule_actuals',{target_week:state.weekStart}):Promise.resolve({data:null,error:null});
      const [summaryResult,actualsResult]=await Promise.all([summaryRequest,actualsRequest]);
      if(summaryResult.error) throw summaryResult.error;
      if(actualsResult.error) throw actualsResult.error;

      state.summary=summaryResult.data||{};
      state.summary.can_manage=canManage;
      state.actuals=actualsResult.data||null;
      state.weekStart=state.summary.week_start||state.weekStart;
      render();
    }catch(error){
      console.error('Schedule load failed:',error);
      target.innerHTML=`<div class="empty-card"><span>!</span><h2>Schedule could not load</h2><p>${esc(error.message||'Try again.')}</p><button class="secondary-button" type="button" data-schedule-retry>Retry</button></div>`;
    }finally{ state.loading=false; }
  }

  function coverage(day){
    if(num(day.open_hours)<=0) return {cls:'neutral',label:'Closed'};
    const delta=num(day.coverage_delta_hours);
    if(delta<-1) return {cls:'bad',label:`${Math.abs(delta).toFixed(1)}h short`};
    if(delta<-.25) return {cls:'warn',label:`${Math.abs(delta).toFixed(1)}h short`};
    if(delta>2) return {cls:'warn',label:`+${delta.toFixed(1)}h`};
    return {cls:'good',label:'Covered'};
  }

  function managementSummary(summary){
    const totals=summary.totals||{};
    const actuals=state.actuals||{};
    const delta=num(totals.scheduled_hours)-num(totals.suggested_hours);
    const coverageText=delta<0?`${Math.abs(delta).toFixed(1)}h under plan`:delta>0?`${delta.toFixed(1)}h over plan`:'On plan';
    return `<article class="gc-schedule-summary">
      <div class="gc-schedule-summary-head"><div><h2>Labor plan</h2><p>Forecast demand, actual labor, and sales all share the same SPLH pipeline.</p></div><span class="gc-schedule-status ${esc(summary.status||'draft')}">${esc(label(summary.status||'draft'))}</span></div>
      <div class="gc-schedule-metrics">
        <div class="gc-schedule-metric"><small>Target SPLH</small><strong>${money(summary.target_splh)}</strong><span>Target sales per labor hour</span></div>
        <div class="gc-schedule-metric"><small>Actual SPLH</small><strong>${money(actuals.actual_splh)}</strong><span>${num(actuals.actual_paid_hours).toFixed(1)} paid hrs · ${cents(actuals.actual_sales_cents)}</span></div>
        <div class="gc-schedule-metric"><small>Suggested sales</small><strong>${cents(totals.suggested_sales_cents)}</strong><span>History + known repair opportunity</span></div>
        <div class="gc-schedule-metric"><small>Suggested labor</small><strong>${num(totals.suggested_hours).toFixed(1)}h</strong><span>Forecast workload</span></div>
        <div class="gc-schedule-metric"><small>Scheduled labor</small><strong>${num(totals.scheduled_hours).toFixed(1)}h</strong><span>${esc(coverageText)}</span></div>
      </div>
      <form class="gc-schedule-plan" id="gc-schedule-plan-form">
        <label>Weekly sales forecast<input name="forecast" type="number" min="0" step="100" value="${Math.round(num(summary.weekly_forecast_cents)/100)}"></label>
        <label>Target SPLH<input name="splh" type="number" min="1" step="1" value="${Math.round(num(summary.target_splh)||125)}"></label>
        <button class="secondary-button" type="submit">Save planning targets</button>
      </form>
    </article>`;
  }

  function demandForecast(summary){
    return `<article class="gc-schedule-intel"><div class="gc-schedule-intel-head"><div><h2>Suggested workload</h2><p>Historical day-of-week sales, weekly forecast, open repairs, Repair Reference bench time, appointments, leads, and backlog.</p></div><small>${num(summary.history_days)} closed days of history</small></div><div class="gc-schedule-days">${(summary.days||[]).map(day=>{
      const c=coverage(day);
      return `<section class="gc-schedule-day-intel ${num(day.open_hours)<=0?'closed':''}"><header><div><strong>${fmtDate(day.date,{weekday:'short'})}</strong><small>${fmtDate(day.date)}</small></div><span class="gc-coverage-chip ${c.cls}">${esc(c.label)}</span></header><div class="gc-schedule-day-numbers"><span><b>${num(day.suggested_hours).toFixed(1)}h</b> suggested · ${num(day.scheduled_hours).toFixed(1)}h scheduled</span><span><b>${cents(day.suggested_sales_cents)}</b> demand</span><span>${num(day.promised_repairs)} repairs · ${num(day.appointments)} appts · ${num(day.leads_expected)} leads</span></div><p class="gc-schedule-day-reason">${esc(day.reason||'')}</p></section>`;
    }).join('')}</div></article>`;
  }

  function timeOffFor(employeeId,date){
    return (state.summary?.time_off||[]).filter(item=>item.employee_id===employeeId&&item.starts_on<=date&&item.ends_on>=date&&['approved','pending'].includes(item.status));
  }

  function shiftMarkup(employeeId,date,canManage){
    const shifts=(state.summary?.shifts||[]).filter(item=>item.employee_id===employeeId&&item.shift_date===date);
    const leave=timeOffFor(employeeId,date).map(item=>`<span class="gc-timeoff-badge">${item.status==='pending'?'Pending ':''}${esc(label(item.request_type||'Time off'))}</span>`).join('');
    const cards=shifts.map(shift=>{
      const body=`<strong>${fmtTime(shift.starts_at)} – ${fmtTime(shift.ends_at)}</strong><span>${shiftHours(shift).toFixed(1)} hrs${shift.break_minutes?` · ${shift.break_minutes}m break`:''}</span>${shift.role_label?`<small>${esc(shift.role_label)}</small>`:''}`;
      return canManage?`<button class="gc-shift-card" type="button" data-edit-shift="${esc(shift.id)}">${body}</button>`:`<div class="gc-shift-card">${body}</div>`;
    }).join('');
    return `${leave}${cards}${!leave&&!cards?'<span class="gc-schedule-empty-shift">—</span>':''}`;
  }

  function board(summary){
    const staff=summary.staff||[];
    const days=summary.days||[];
    const canManage=Boolean(summary.can_manage);
    const current=dateOnly(new Date());
    if(!staff.length&&summary.status==='unpublished'){
      return '<article class="gc-schedule-board-card"><div class="gc-schedule-empty"><strong>Schedule not published</strong><span>Management has not published this week yet.</span></div></article>';
    }
    return `<article class="gc-schedule-board-card"><div class="gc-schedule-board-head"><div><h2>Weekly schedule</h2><p>Sunday through Saturday. ${canManage?'Tap a cell to add a shift or tap a shift to edit it.':'Published store schedule.'}</p></div>${canManage?'<button class="primary-button" type="button" data-schedule-add-first>+ Add shift</button>':''}</div><div class="gc-schedule-board-scroll"><div class="gc-schedule-grid"><div class="gc-schedule-corner">Team</div>${days.map(day=>`<div class="gc-schedule-day-head ${day.date===current?'today':''}"><strong>${fmtDate(day.date,{weekday:'short'})}</strong><small>${fmtDate(day.date)}</small></div>`).join('')}${staff.map(member=>`<div class="gc-schedule-employee"><span class="gc-schedule-avatar">${esc(initials(member.display_name))}</span><div><strong>${esc(member.display_name||'Staff')}</strong><small>${esc(label(member.role))}</small></div></div>${days.map(day=>`<div class="gc-schedule-cell ${day.date===current?'today':''} ${timeOffFor(member.id,day.date).length?'is-timeoff':''}" ${canManage?`data-add-shift="1" data-employee-id="${esc(member.id)}" data-shift-date="${esc(day.date)}" data-can-manage="true" tabindex="0"`:''}>${shiftMarkup(member.id,day.date,canManage)}${canManage?'<button class="gc-schedule-cell-add" type="button" aria-label="Add shift">+</button>':''}</div>`).join('')}`).join('')}</div></div></article>`;
  }

  function timeOff(summary){
    const staff=summary.staff||[];
    const canManage=Boolean(summary.can_manage);
    const name=id=>staff.find(item=>item.id===id)?.display_name||'Staff';
    const rows=summary.time_off||[];
    return `<article class="gc-schedule-timeoff"><div class="gc-schedule-timeoff-head"><div><h2>Time off</h2><p>Requests and approved absences affecting this work week.</p></div><button class="secondary-button" type="button" data-request-timeoff>Request time off</button></div><div class="gc-timeoff-list">${rows.length?rows.map(item=>`<div class="gc-timeoff-row"><div><strong>${esc(name(item.employee_id))}</strong><small>${esc(label(item.request_type||'Time off'))}</small></div><div><strong>${fmtRange(item.starts_on,item.ends_on)}</strong><small>${item.status==='approved'?'Included in schedule planning':item.status==='pending'?'Awaiting management review':'Request closed'}</small></div><span class="gc-timeoff-status ${esc(item.status)}">${esc(item.status)}</span>${canManage&&item.status==='pending'?`<div class="gc-timeoff-actions"><button class="secondary-button" type="button" data-timeoff-decision="approved" data-timeoff-id="${esc(item.id)}">Approve</button><button class="danger-button" type="button" data-timeoff-decision="denied" data-timeoff-id="${esc(item.id)}">Deny</button></div>`:'<span></span>'}</div>`).join(''):'<div class="gc-schedule-empty"><strong>No time off this week</strong><span>Approved or pending requests will appear here.</span></div>'}</div></article>`;
  }

  function render(){
    const summary=state.summary||{};
    const canManage=Boolean(summary.can_manage);
    host().innerHTML=`<div class="gc-schedule-page">
      <div class="gc-schedule-toolbar"><div class="gc-schedule-week-nav"><button class="secondary-button" type="button" data-schedule-week="-7">←</button><div class="gc-schedule-week-title"><strong>${fmtRange(summary.week_start||state.weekStart,summary.week_end||addDays(state.weekStart,6))}</strong><small>Sunday – Saturday</small></div><button class="secondary-button" type="button" data-schedule-week="7">→</button><button class="text-button" type="button" data-schedule-today>Current week</button></div><div class="gc-schedule-toolbar-actions"><span class="gc-schedule-status ${esc(summary.status||'unpublished')}">${esc(label(summary.status||'unpublished'))}</span>${canManage?`<button class="${summary.status==='published'?'secondary-button':'primary-button'}" type="button" data-toggle-publish>${summary.status==='published'?'Return to draft':'Publish schedule'}</button>`:''}</div></div>
      ${canManage?managementSummary(summary):''}
      ${canManage?demandForecast(summary):''}
      ${board(summary)}
      ${timeOff(summary)}
    </div>`;
  }

  async function ensureWeek(){
    if(state.summary?.week_id) return state.summary.week_id;
    if(!state.summary?.can_manage) throw new Error('Schedule management permission is required.');
    const p=profile();
    const {data,error}=await client.from('schedule_weeks').upsert({location_id:p.location_id,week_start:state.weekStart,status:'draft',forecast_sales_cents:num(state.summary?.weekly_forecast_cents),target_splh:num(state.summary?.target_splh)||125},{onConflict:'location_id,week_start'}).select('id').single();
    if(error) throw error;
    state.summary.week_id=data.id;
    return data.id;
  }

  async function markDraft(){
    const id=await ensureWeek();
    const {error}=await client.from('schedule_weeks').update({status:'draft',published_at:null,published_by:null,updated_at:new Date().toISOString()}).eq('id',id);
    if(error) throw error;
    return id;
  }

  async function savePlan(form){
    const values=Object.fromEntries(new FormData(form));
    const id=await markDraft();
    const {error}=await client.from('schedule_weeks').update({forecast_sales_cents:Math.max(0,Math.round(num(values.forecast)*100)),target_splh:Math.max(1,num(values.splh)),updated_at:new Date().toISOString()}).eq('id',id);
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

  const shiftById=id=>(state.summary?.shifts||[]).find(item=>item.id===id);
  const staffOptions=id=>(state.summary?.staff||[]).map(member=>`<option value="${esc(member.id)}" ${member.id===id?'selected':''}>${esc(member.display_name||'Staff')}</option>`).join('');
  const dateOptions=value=>(state.summary?.days||[]).map(day=>`<option value="${esc(day.date)}" ${day.date===value?'selected':''}>${fmtDate(day.date,{weekday:'long',month:'short',day:'numeric'})}</option>`).join('');

  function openShift({id=null,employeeId=null,date=null}={}){
    if(!state.summary?.can_manage) return;
    const existing=id?shiftById(id):null;
    const dialog=ensureDialog();
    const employee=existing?.employee_id||employeeId||state.summary?.staff?.[0]?.id||'';
    const shiftDate=existing?.shift_date||date||state.weekStart;
    dialog.innerHTML=`<form id="gc-shift-form"><div class="gc-dialog-head"><div><p class="eyebrow">Workforce schedule</p><h2>${existing?'Edit shift':'Add shift'}</h2></div><button class="icon-button" type="button" data-close-schedule-dialog>×</button></div><div class="gc-dialog-body"><input type="hidden" name="id" value="${esc(existing?.id||'')}"><label>Employee<select name="employee_id" required>${staffOptions(employee)}</select></label><label>Date<select name="shift_date" required>${dateOptions(shiftDate)}</select></label><label>Start<input name="starts_at" type="time" required value="${esc(String(existing?.starts_at||'09:00').slice(0,5))}"></label><label>End<input name="ends_at" type="time" required value="${esc(String(existing?.ends_at||'17:00').slice(0,5))}"></label><label>Unpaid break<input name="break_minutes" type="number" min="0" step="5" value="${num(existing?.break_minutes)}"></label><label>Coverage / role<input name="role_label" value="${esc(existing?.role_label||'')}" placeholder="Technician, Front desk"></label><label class="full">Notes<textarea name="notes">${esc(existing?.notes||'')}</textarea></label></div><p class="gc-schedule-message"></p><div class="gc-dialog-actions">${existing?'<button class="danger-button" type="button" data-delete-current-shift>Delete shift</button>':'<span></span>'}<div class="gc-dialog-actions-right"><button class="secondary-button" type="button" data-close-schedule-dialog>Cancel</button><button class="primary-button" type="submit">${existing?'Save shift':'Add shift'}</button></div></div></form>`;
    dialog.showModal();
  }

  async function saveShift(form){
    const values=Object.fromEntries(new FormData(form));
    const [sh,sm]=values.starts_at.split(':').map(Number),[eh,em]=values.ends_at.split(':').map(Number);
    if(eh*60+em<=sh*60+sm) throw new Error('End time must be after start time.');
    const weekId=await markDraft();
    const payload={schedule_week_id:weekId,location_id:profile().location_id,employee_id:values.employee_id,shift_date:values.shift_date,starts_at:values.starts_at,ends_at:values.ends_at,break_minutes:Math.max(0,num(values.break_minutes)),role_label:values.role_label?.trim()||null,notes:values.notes?.trim()||null,updated_at:new Date().toISOString()};
    const result=values.id?await client.from('shifts').update(payload).eq('id',values.id):await client.from('shifts').insert(payload);
    if(result.error) throw result.error;
    closeDialog(); await load({quiet:true});
  }

  async function deleteShift(id){
    if(!id||!state.summary?.can_manage||!confirm('Delete this shift?')) return;
    await markDraft();
    const {error}=await client.from('shifts').delete().eq('id',id);
    if(error) throw error;
    closeDialog(); await load({quiet:true});
  }

  function openTimeOff(){
    const dialog=ensureDialog();
    dialog.innerHTML=`<form id="gc-timeoff-form"><div class="gc-dialog-head"><div><p class="eyebrow">Availability</p><h2>Request time off</h2></div><button class="icon-button" type="button" data-close-schedule-dialog>×</button></div><div class="gc-dialog-body"><label>Starts<input name="starts_on" type="date" required value="${state.weekStart}"></label><label>Ends<input name="ends_on" type="date" required value="${state.weekStart}"></label><label>Type<select name="request_type"><option value="unpaid">Unpaid</option><option value="pto">PTO</option><option value="sick">Sick</option><option value="other">Other</option></select></label><label class="full">Reason<textarea name="reason"></textarea></label></div><p class="gc-schedule-message"></p><div class="gc-dialog-actions"><span></span><div class="gc-dialog-actions-right"><button class="secondary-button" type="button" data-close-schedule-dialog>Cancel</button><button class="primary-button" type="submit">Submit request</button></div></div></form>`;
    dialog.showModal();
  }

  async function saveTimeOff(form){
    const values=Object.fromEntries(new FormData(form));
    if(values.ends_on<values.starts_on) throw new Error('End date cannot be before start date.');
    const p=profile();
    const {error}=await client.from('time_off_requests').insert({location_id:p.location_id,employee_id:p.id,starts_on:values.starts_on,ends_on:values.ends_on,request_type:values.request_type,reason:values.reason?.trim()||null,status:'pending'});
    if(error) throw error;
    closeDialog(); await load({quiet:true});
  }

  async function decideTimeOff(id,status){
    if(!state.summary?.can_manage) return;
    const p=profile();
    const {error}=await client.from('time_off_requests').update({status,reviewed_by:p.id,reviewed_at:new Date().toISOString()}).eq('id',id);
    if(error) throw error;
    await load({quiet:true});
  }

  async function guarded(fn,button){
    try{ if(button) button.disabled=true; await fn(); }
    catch(error){
      console.error('Schedule action failed:',error);
      const msg=ensureDialog().open?ensureDialog().querySelector('.gc-schedule-message'):null;
      if(msg) msg.textContent=error.message||'Schedule update failed.';
      else window.GotCrackedDiagnostics?.error?.(error,{context:'Schedule update failed'});
    }finally{ if(button) button.disabled=false; }
  }

  document.addEventListener('submit',event=>{
    if(event.target.id==='gc-schedule-plan-form'){ event.preventDefault(); guarded(()=>savePlan(event.target),event.target.querySelector('button[type="submit"]')); }
    if(event.target.id==='gc-shift-form'){ event.preventDefault(); guarded(()=>saveShift(event.target),event.target.querySelector('button[type="submit"]')); }
    if(event.target.id==='gc-timeoff-form'){ event.preventDefault(); guarded(()=>saveTimeOff(event.target),event.target.querySelector('button[type="submit"]')); }
  });

  document.addEventListener('click',event=>{
    const target=event.target instanceof Element?event.target:null;
    if(!target) return;
    if(target.closest('[data-schedule-retry]')){ load(); return; }
    const week=target.closest('[data-schedule-week]'); if(week){ state.weekStart=addDays(state.weekStart,num(week.dataset.scheduleWeek)); load(); return; }
    if(target.closest('[data-schedule-today]')){ state.weekStart=sundayOf(); load(); return; }
    const publish=target.closest('[data-toggle-publish]'); if(publish){ guarded(togglePublish,publish); return; }
    const edit=target.closest('[data-edit-shift]'); if(edit){ event.stopPropagation(); openShift({id:edit.dataset.editShift}); return; }
    const cell=target.closest('[data-add-shift][data-employee-id][data-shift-date]'); if(cell){ openShift({employeeId:cell.dataset.employeeId,date:cell.dataset.shiftDate}); return; }
    if(target.closest('[data-schedule-add-first]')){ openShift({employeeId:state.summary?.staff?.[0]?.id,date:state.weekStart}); return; }
    if(target.closest('[data-request-timeoff]')){ openTimeOff(); return; }
    const decision=target.closest('[data-timeoff-decision]'); if(decision){ guarded(()=>decideTimeOff(decision.dataset.timeoffId,decision.dataset.timeoffDecision),decision); return; }
    if(target.closest('[data-close-schedule-dialog]')){ closeDialog(); return; }
    const del=target.closest('[data-delete-current-shift]'); if(del){ guarded(()=>deleteShift(ensureDialog().querySelector('[name="id"]')?.value),del); }
  });

  document.addEventListener('keydown',event=>{
    if(event.key!=='Enter'||!(event.target instanceof Element)) return;
    const cell=event.target.closest('[data-add-shift][data-employee-id][data-shift-date]');
    if(cell){ event.preventDefault(); openShift({employeeId:cell.dataset.employeeId,date:cell.dataset.shiftDate}); }
  });

  document.addEventListener('gc-view-changed',event=>{
    const view=typeof event.detail==='string'?event.detail:event.detail?.view;
    if(view==='schedule') load({quiet:Boolean(state.summary)});
  });
  document.addEventListener('gc-cross-user-sync',()=>{ if(active()) load({quiet:true}); });
  document.addEventListener('gc-timeclock-change',()=>{ if(active()&&state.summary?.can_manage) load({quiet:true}); });
  window.addEventListener('hashchange',()=>{ if(active()) load({quiet:Boolean(state.summary)}); });

  window.GotCrackedScheduleBoard={load,get state(){return state;}};
  if(active()) load();
})();