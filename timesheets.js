(() => {
  'use strict';
  if (window.GotCrackedTimesheets) return;
  const client = window.supabaseClient;
  if (!client) return;

  const state = { data:null, weekStart:null, employee:'all', busy:false };
  const esc = value => String(value ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[c]);
  const pad = value => String(value).padStart(2,'0');
  const hours = seconds => `${(Math.max(0,Number(seconds)||0)/3600).toFixed(2)}h`;
  const profile = () => window.GotCrackedRuntimeProfile || window.GotCrackedOperationsV1?.state?.profile || null;

  function loadStyle(){
    if(document.querySelector('link[data-gc-timesheets]')) return;
    const link=document.createElement('link'); link.rel='stylesheet'; link.href='timesheets.css?v=20260826-ts1'; link.dataset.gcTimesheets='true'; document.head.appendChild(link);
  }
  function sunday(value=new Date()){
    const d=new Date(value); d.setHours(12,0,0,0); d.setDate(d.getDate()-d.getDay());
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }
  function shiftWeek(days){
    const d=new Date(`${state.weekStart||sunday()}T12:00:00`); d.setDate(d.getDate()+days); state.weekStart=sunday(d); load();
  }
  function formatDate(value,opts={}){
    if(!value) return '—'; const d=new Date(value); if(Number.isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat('en-US',opts).format(d);
  }
  function time(value){ return formatDate(value,{hour:'numeric',minute:'2-digit'}); }
  function day(value){ return formatDate(value,{weekday:'short',month:'short',day:'numeric'}); }
  function localInput(value){
    if(!value) return ''; const d=new Date(value); if(Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function shiftSeconds(shift){
    if(!shift?.starts_at||!shift?.ends_at) return 0;
    const [sh,sm]=shift.starts_at.split(':').map(Number), [eh,em]=shift.ends_at.split(':').map(Number);
    let mins=(eh*60+em)-(sh*60+sm); if(mins<0) mins+=1440;
    return Math.max(0,(mins-Number(shift.break_minutes||0))*60);
  }
  function futureShiftSeconds(shift){
    const start=new Date(`${shift.shift_date}T${String(shift.starts_at).slice(0,8)}`);
    return start.getTime()>Date.now()?shiftSeconds(shift):0;
  }
  function employeeStats(id){
    const entries=(state.data?.entries||[]).filter(e=>e.employee_id===id);
    const shifts=(state.data?.shifts||[]).filter(s=>s.employee_id===id);
    const clocked=entries.reduce((sum,e)=>sum+Number(e.paid_seconds||0),0);
    const scheduled=shifts.reduce((sum,s)=>sum+shiftSeconds(s),0);
    const projected=clocked+shifts.reduce((sum,s)=>sum+futureShiftSeconds(s),0);
    const closed=entries.filter(e=>e.clock_out);
    const pending=closed.filter(e=>!e.approved_at).length;
    const open=entries.some(e=>!e.clock_out);
    const approved=closed.length>0&&pending===0&&!open;
    return {entries,clocked,scheduled,projected,pending,open,approved};
  }

  function ensureShell(){
    const main=document.querySelector('.app-shell main'); if(!main) return;
    if(!document.getElementById('timesheets')){
      const section=document.createElement('section'); section.id='timesheets'; section.className='view'; section.innerHTML='<div id="gc-timesheets"><div class="empty-card"><span>◷</span><h2>Loading timesheets…</h2></div></div>';
      const staff=document.getElementById('staff'); staff ? staff.insertAdjacentElement('beforebegin',section) : main.appendChild(section);
    }
    const desktop=document.querySelector('.sidebar > nav:not(.gc-mobile-nav)');
    if(desktop&&!desktop.querySelector('[data-view="timesheets"]')){
      const anchor=desktop.querySelector('[data-view="schedule"]'); const link=document.createElement('a'); link.className='nav-link'; link.href='#timesheets'; link.dataset.view='timesheets'; link.innerHTML='<span>◴</span>Timesheets';
      anchor ? anchor.insertAdjacentElement('afterend',link) : desktop.appendChild(link);
    }
    const mobile=document.querySelector('.gc-mobile-nav');
    if(mobile&&!mobile.querySelector('[data-view="timesheets"]')){
      const anchor=mobile.querySelector('[data-view="schedule"]'); const link=document.createElement('a'); link.className='nav-link'; link.href='#timesheets'; link.dataset.view='timesheets'; link.dataset.mobileNavItem='true'; link.innerHTML='<span>◴</span>Timesheets';
      anchor ? anchor.insertAdjacentElement('afterend',link) : mobile.appendChild(link);
    }
    ensureDialog();
  }

  function ensureDialog(){
    if(document.getElementById('gc-time-entry-dialog')) return;
    const dialog=document.createElement('dialog'); dialog.id='gc-time-entry-dialog'; dialog.className='gc-timesheet-dialog';
    dialog.innerHTML='<form id="gc-time-entry-form" method="dialog"><div class="gc-timesheet-dialog-head"><div><p class="eyebrow">Time correction</p><h2>Edit punch</h2></div><button class="icon-button" type="button" data-ts-close>×</button></div><div class="gc-timesheet-dialog-body"><input type="hidden" name="id"><label>Clock in<input name="clock_in" type="datetime-local" required></label><label>Clock out<input name="clock_out" type="datetime-local"></label><label>Break minutes<input name="break_minutes" type="number" min="0" step="1" value="0"></label><label class="full">Required correction note<textarea name="note" required placeholder="Why is this punch being corrected?"></textarea></label><p class="gc-timesheet-message full" role="status"></p></div><div class="gc-timesheet-dialog-actions"><button class="secondary-button" type="button" data-ts-close>Cancel</button><button class="primary-button" type="submit">Save correction</button></div></form>';
    document.body.appendChild(dialog);
  }

  async function load(){
    ensureShell(); const p=profile(); if(!p?.id) return;
    state.weekStart=state.weekStart||sunday();
    const target=state.employee==='all'?null:state.employee;
    const host=document.getElementById('gc-timesheets'); if(host) host.dataset.loading='true';
    const {data,error}=await client.rpc('get_timesheet_week',{target_week_start:state.weekStart,target_employee:target});
    if(error){ if(host) host.innerHTML=`<div class="empty-card"><span>!</span><h2>Timesheets unavailable</h2><p>${esc(error.message)}</p></div>`; return; }
    state.data=data; render();
  }

  function approvalLabel(stats){
    if(stats.open) return '<span class="gc-ts-status open">Open punch</span>';
    if(stats.approved) return '<span class="gc-ts-status approved">Approved</span>';
    if(stats.pending) return `<span class="gc-ts-status pending">${stats.pending} pending</span>`;
    return '<span class="gc-ts-status neutral">No closed punches</span>';
  }

  function render(){
    ensureShell(); const host=document.getElementById('gc-timesheets'); if(!host||!state.data) return;
    const employees=state.data.employees||[], canManage=Boolean(state.data.can_manage);
    if(state.employee!=='all'&&!employees.some(e=>e.id===state.employee)) state.employee='all';
    const weekLabel=`${formatDate(`${state.data.week_start}T12:00:00`,{month:'short',day:'numeric'})} – ${formatDate(`${state.data.week_end}T12:00:00`,{month:'short',day:'numeric',year:'numeric'})}`;
    const shownEntries=(state.data.entries||[]).slice().sort((a,b)=>new Date(a.clock_in)-new Date(b.clock_in));
    const totalClocked=shownEntries.reduce((s,e)=>s+Number(e.paid_seconds||0),0);
    const totalScheduled=(state.data.shifts||[]).reduce((s,x)=>s+shiftSeconds(x),0);
    const totalProjected=totalClocked+(state.data.shifts||[]).reduce((s,x)=>s+futureShiftSeconds(x),0);
    host.innerHTML=`<div class="gc-ts-head"><div><p class="eyebrow">Workforce time</p><h1>Timesheets</h1><p>Review punches, projected weekly hours, corrections, and approvals.</p></div><div class="gc-ts-week-nav"><button class="secondary-button" type="button" data-ts-week="-7">←</button><strong>${esc(weekLabel)}</strong><button class="secondary-button" type="button" data-ts-week="7">→</button></div></div>
      <div class="gc-ts-toolbar">${canManage?`<label>Employee<select data-ts-employee><option value="all">All employees</option>${employees.map(e=>`<option value="${e.id}" ${state.employee===e.id?'selected':''}>${esc(e.display_name)}</option>`).join('')}</select></label>`:''}<button class="secondary-button" type="button" data-ts-refresh>↻ Refresh</button></div>
      <div class="gc-ts-metrics"><article><small>Clocked</small><strong>${hours(totalClocked)}</strong><span>Paid time recorded</span></article><article><small>Scheduled</small><strong>${hours(totalScheduled)}</strong><span>Published / managed shifts</span></article><article><small>Projected week</small><strong>${hours(totalProjected)}</strong><span>Clocked + future scheduled time</span></article><article><small>Timezone</small><strong class="gc-ts-timezone">${esc(state.data.timezone||'Store timezone')}</strong><span>Used for weekly records</span></article></div>
      ${canManage&&employees.length?`<section class="gc-ts-approval"><div class="card-title"><div><h2>Timesheet approval</h2><p>Approve completed punches for this week. Edits automatically return a punch to pending.</p></div></div><div class="gc-ts-employee-grid">${employees.map(e=>{const s=employeeStats(e.id);return `<article class="gc-ts-employee-card"><div><strong>${esc(e.display_name)}</strong><small>${esc(e.job_title||String(e.role||'staff').replaceAll('_',' '))}</small></div><div class="gc-ts-employee-hours"><span>${hours(s.clocked)} clocked</span><span>${hours(s.projected)} projected</span></div>${approvalLabel(s)}<button class="secondary-button" type="button" data-ts-focus="${e.id}">View</button><button class="primary-button" type="button" data-ts-approve-week="${e.id}" ${s.pending===0||s.open?'disabled':''}>Approve week</button></article>`}).join('')}</div></section>`:''}
      <section class="gc-ts-table-card"><div class="gc-ts-table-head"><div><h2>Punches</h2><p>${shownEntries.length} time entr${shownEntries.length===1?'y':'ies'} for this view.</p></div></div><div class="gc-ts-table-wrap"><table><thead><tr>${canManage?'<th>Employee</th>':''}<th>Date</th><th>In</th><th>Out</th><th>Break</th><th>Paid</th><th>Approval</th>${canManage?'<th>Actions</th>':''}</tr></thead><tbody>${shownEntries.map(e=>{const emp=employees.find(x=>x.id===e.employee_id);return `<tr><td data-col="Employee" ${canManage?'':'hidden'}><strong>${esc(emp?.display_name||'Staff')}</strong></td><td data-col="Date">${esc(day(e.clock_in))}${e.corrected_at?'<small>Corrected</small>':''}</td><td data-col="In">${esc(time(e.clock_in))}</td><td data-col="Out">${e.clock_out?esc(time(e.clock_out)):'<span class="gc-ts-status open">Open</span>'}</td><td data-col="Break">${Number(e.break_minutes||0)}m</td><td data-col="Paid"><strong>${hours(e.paid_seconds)}</strong></td><td data-col="Approval">${e.approved_at?'<span class="gc-ts-status approved">Approved</span>':'<span class="gc-ts-status pending">Pending</span>'}</td>${canManage?`<td data-col="Actions"><div class="gc-ts-row-actions"><button class="text-button" type="button" data-ts-edit="${e.id}">Edit</button><button class="text-button" type="button" data-ts-toggle-approval="${e.id}" data-approved="${e.approved_at?'true':'false'}" ${!e.clock_out?'disabled':''}>${e.approved_at?'Unapprove':'Approve'}</button><button class="text-button danger" type="button" data-ts-delete="${e.id}">Delete</button></div></td>`:''}</tr>`}).join('')||`<tr><td colspan="${canManage?8:6}"><div class="gc-ts-empty">No punches recorded for this week.</div></td></tr>`}</tbody></table></div></section>`;
    host.dataset.loading='false';
  }

  function entryById(id){ return (state.data?.entries||[]).find(e=>e.id===id); }
  function openEdit(id){
    const e=entryById(id); if(!e) return; const dialog=document.getElementById('gc-time-entry-dialog'), form=dialog?.querySelector('form'); if(!form) return;
    form.elements.id.value=e.id; form.elements.clock_in.value=localInput(e.clock_in); form.elements.clock_out.value=localInput(e.clock_out); form.elements.break_minutes.value=Number(e.break_minutes||0); form.elements.note.value=''; form.querySelector('.gc-timesheet-message').textContent=''; dialog.showModal();
  }
  async function saveEdit(form){
    if(state.busy) return; const message=form.querySelector('.gc-timesheet-message'); const data=Object.fromEntries(new FormData(form)); state.busy=true;
    const clockIn=new Date(data.clock_in), clockOut=data.clock_out?new Date(data.clock_out):null;
    if(Number.isNaN(clockIn.getTime())||(clockOut&&Number.isNaN(clockOut.getTime()))){message.textContent='Enter valid punch times.';state.busy=false;return;}
    const {error}=await client.rpc('update_time_entry',{target_entry:data.id,new_clock_in:clockIn.toISOString(),new_clock_out:clockOut?clockOut.toISOString():null,new_break_minutes:Number(data.break_minutes||0),correction_note:data.note.trim()});
    if(error){message.textContent=error.message;state.busy=false;return;} document.getElementById('gc-time-entry-dialog')?.close(); state.busy=false; await load(); window.GotCrackedTimeClock?.load?.({quiet:true});
  }
  async function deleteEntry(id){
    const e=entryById(id); if(!e) return; const reason=prompt('Required deletion reason:')?.trim(); if(!reason) return; if(!confirm(`Delete this punch from ${day(e.clock_in)}? The original record will remain in the audit log.`)) return;
    const {error}=await client.rpc('delete_time_entry',{target_entry:id,deletion_note:reason}); if(error) return alert(error.message); await load(); window.GotCrackedTimeClock?.load?.({quiet:true});
  }
  async function toggleApproval(id,approved){
    const note=approved ? (prompt('Approval note (optional):')||'') : '';
    const {error}=await client.rpc('set_time_entry_approval',{target_entry:id,approved,approval_note:note.trim()||null}); if(error) return alert(error.message); await load();
  }
  async function approveWeek(employeeId){
    const emp=(state.data?.employees||[]).find(e=>e.id===employeeId); if(!emp) return; if(!confirm(`Approve all completed pending punches for ${emp.display_name} for this week?`)) return;
    const note=prompt('Week approval note (optional):')||''; const {data,error}=await client.rpc('approve_timesheet_week',{target_employee:employeeId,target_week_start:state.data.week_start,approval_note:note.trim()||null});
    if(error) return alert(error.message); await load();
  }

  document.addEventListener('click',event=>{
    const target=event.target instanceof Element?event.target:null; if(!target) return;
    if(target.closest('[data-ts-week]')){ shiftWeek(Number(target.closest('[data-ts-week]').dataset.tsWeek)); return; }
    if(target.closest('[data-ts-refresh]')){ load(); return; }
    const focus=target.closest('[data-ts-focus]'); if(focus){ state.employee=focus.dataset.tsFocus; load(); return; }
    const approve=target.closest('[data-ts-approve-week]'); if(approve){ approveWeek(approve.dataset.tsApproveWeek); return; }
    const edit=target.closest('[data-ts-edit]'); if(edit){ openEdit(edit.dataset.tsEdit); return; }
    const del=target.closest('[data-ts-delete]'); if(del){ deleteEntry(del.dataset.tsDelete); return; }
    const toggle=target.closest('[data-ts-toggle-approval]'); if(toggle){ toggleApproval(toggle.dataset.tsToggleApproval,toggle.dataset.approved!=='true'); return; }
    if(target.closest('[data-ts-close]')) document.getElementById('gc-time-entry-dialog')?.close();
  });
  document.addEventListener('change',event=>{ const el=event.target; if(el?.matches?.('[data-ts-employee]')){ state.employee=el.value; load(); } });
  document.addEventListener('submit',event=>{ if(event.target?.id!=='gc-time-entry-form') return; event.preventDefault(); saveEdit(event.target); });
  document.addEventListener('gc-view-changed',event=>{ if(event.detail==='timesheets') load(); });
  document.addEventListener('gc-timeclock-change',()=>{ if(location.hash.startsWith('#timesheets')) load(); });
  document.addEventListener('gc-cross-user-sync',()=>{ if(location.hash.startsWith('#timesheets')) load(); });

  loadStyle(); ensureShell();
  const navObserver=new MutationObserver(()=>ensureShell()); navObserver.observe(document.body,{childList:true,subtree:true});
  window.GotCrackedTimesheets={load,state};
})();
