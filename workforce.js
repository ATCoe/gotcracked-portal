(() => {
  'use strict';
  const client = window.supabaseClient;
  const host = () => document.querySelector('#labor-scheduler');
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[char]);
  const money = cents => new Intl.NumberFormat('en-US', { style:'currency', currency:'USD' }).format((cents || 0) / 100);
  const dateOnly = date => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const addDays = (value, count) => { const date = new Date(`${value}T12:00:00`); date.setDate(date.getDate() + count); return dateOnly(date); };
  const mondayOf = value => { const date = new Date(`${value || dateOnly(new Date())}T12:00:00`); const day = date.getDay() || 7; date.setDate(date.getDate() - day + 1); return dateOnly(date); };
  const hoursBetween = (start, end, breaks = 0) => Math.max(0, (new Date(end) - new Date(start)) / 3600000 - breaks / 60);
  const shiftHours = shift => { const [sh,sm] = shift.starts_at.split(':').map(Number); const [eh,em] = shift.ends_at.split(':').map(Number); return Math.max(0, ((eh * 60 + em) - (sh * 60 + sm) - shift.break_minutes) / 60); };
  const clock = value => new Intl.DateTimeFormat('en-US', { hour:'numeric', minute:'2-digit' }).format(new Date(value));
  let weekStart = mondayOf();
  let state = { profile:null, staff:[], week:null, shifts:[], compensation:[], entries:[], timeOff:[], repairs:[] };

  async function load() {
    const { data: { user } } = await client.auth.getUser();
    if (!user || !host()) return;
    const { data: profile } = await client.from('profiles').select('*,locations(name)').eq('id', user.id).single();
    if (!profile?.active) return;
    const management = ['owner','manager'].includes(profile.role);
    const staffResult = management ? await client.functions.invoke('manage-staff', { body:{ action:'list' } }) : { data:{ staff:[profile] } };
    let { data: week } = await client.from('schedule_weeks').select('*').eq('location_id', profile.location_id).eq('week_start', weekStart).maybeSingle();
    if (!week && management) {
      const created = await client.from('schedule_weeks').insert({ location_id:profile.location_id, week_start:weekStart }).select().single();
      week = created.data;
    }
    const end = addDays(weekStart, 7);
    const [shifts, compensation, entries, timeOff, repairs] = await Promise.all([
      week ? client.from('shifts').select('*').eq('schedule_week_id', week.id).order('shift_date').order('starts_at') : Promise.resolve({data:[]}),
      profile.role === 'owner' ? client.from('staff_compensation').select('*').eq('location_id', profile.location_id) : Promise.resolve({data:[]}),
      client.from('time_entries').select('*,time_entry_breaks(*)').eq('location_id', profile.location_id).gte('clock_in', `${weekStart}T00:00:00`).lt('clock_in', `${end}T00:00:00`).order('clock_in'),
      client.from('time_off_requests').select('*').eq('location_id', profile.location_id).gte('ends_on', weekStart).lte('starts_on', end).order('starts_on'),
      client.from('repair_tickets').select('total_cents,completed_at').eq('location_id', profile.location_id).gte('completed_at', `${weekStart}T00:00:00`).lt('completed_at', `${end}T00:00:00`)
    ]);
    state = { profile, staff:staffResult.data?.staff || [profile], week, shifts:shifts.data || [], compensation:compensation.data || [], entries:entries.data || [], timeOff:timeOff.data || [], repairs:repairs.data || [] };
    render();
  }

  function entryHours(entry) {
    const end = entry.clock_out || new Date().toISOString();
    const breakHours = (entry.time_entry_breaks || []).reduce((sum, item) => sum + hoursBetween(item.started_at, item.ended_at || new Date().toISOString()), 0);
    return Math.max(0, hoursBetween(entry.clock_in, end) - breakHours);
  }

  function render() {
    const management = ['owner','manager'].includes(state.profile.role);
    const scheduledHours = state.shifts.reduce((sum, shift) => sum + shiftHours(shift), 0);
    const rateFor = id => state.compensation.find(item => item.profile_id === id)?.hourly_rate_cents || 0;
    const plannedLabor = state.shifts.reduce((sum, shift) => sum + shiftHours(shift) * rateFor(shift.employee_id), 0);
    const actualHours = state.entries.reduce((sum, entry) => sum + entryHours(entry), 0);
    const actualSales = state.repairs.reduce((sum, repair) => sum + Number(repair.total_cents || 0), 0);
    const forecast = state.week?.forecast_sales_cents || 0;
    const projectedSplh = scheduledHours ? forecast / 100 / scheduledHours : 0;
    const actualSplh = actualHours ? actualSales / 100 / actualHours : 0;
    const target = Number(state.week?.target_splh || 0);
    const openEntry = state.entries.find(entry => entry.employee_id === state.profile.id && !entry.clock_out);
    const openBreak = openEntry?.time_entry_breaks?.find(item => !item.ended_at);
    const days = Array.from({length:7}, (_,index) => addDays(weekStart,index));
    const dateLabel = new Intl.DateTimeFormat('en-US', { month:'short', day:'numeric' });

    host().innerHTML = `<section class="workforce-module">
      <article class="card workforce-head"><div class="card-title"><div><p class="eyebrow">Workforce planning</p><h2>Labor scheduler & SPLH</h2><p>Week of ${dateLabel.format(new Date(`${weekStart}T12:00:00`))} · ${esc(state.week?.status || 'View only')}</p></div><div class="quick-actions"><button class="secondary-button" data-week="-7">← Previous</button><button class="secondary-button" data-week="today">Today</button><button class="secondary-button" data-week="7">Next →</button></div></div>
      <div class="labor-metrics"><div><small>Scheduled hours</small><strong>${scheduledHours.toFixed(1)}</strong></div><div><small>Projected labor</small><strong>${state.profile.role === 'owner' ? money(Math.round(plannedLabor)) : 'Owner only'}</strong></div><div><small>Projected SPLH</small><strong class="${target && projectedSplh < target ? 'metric-warn' : ''}">${money(Math.round(projectedSplh * 100))}</strong></div><div><small>Actual SPLH</small><strong>${money(Math.round(actualSplh * 100))}</strong></div></div>
      ${management && state.week ? `<form id="schedule-plan-form" class="schedule-plan"><label>Weekly sales forecast<input name="forecast" type="number" min="0" step="100" value="${(forecast/100).toFixed(0)}"></label><label>Target SPLH<input name="target" type="number" min="0" step="1" value="${state.week.target_splh || 125}"></label><button class="secondary-button">Save targets</button><button type="button" class="primary-button" data-publish-schedule>${state.week.status === 'published' ? 'Unpublish schedule' : 'Publish schedule'}</button></form>` : ''}</article>
      <article class="card"><div class="card-title"><div><h2>Weekly schedule</h2><p>Build coverage by employee, day, and role.</p></div>${management ? '<button class="primary-button" data-add-shift>+ Add shift</button>' : ''}</div><div class="schedule-grid">${days.map(day => `<section class="schedule-day"><header><strong>${new Intl.DateTimeFormat('en-US',{weekday:'short'}).format(new Date(`${day}T12:00:00`))}</strong><small>${dateLabel.format(new Date(`${day}T12:00:00`))}</small></header>${state.shifts.filter(shift => shift.shift_date === day).map(shift => { const employee = state.staff.find(item => item.id === shift.employee_id); return `<div class="shift-card"><strong>${esc(employee?.display_name || 'Staff')}</strong><span>${esc(shift.starts_at.slice(0,5))}–${esc(shift.ends_at.slice(0,5))}</span><small>${shiftHours(shift).toFixed(1)} hrs${shift.break_minutes ? ` · ${shift.break_minutes}m break` : ''}</small>${management ? `<button data-delete-shift="${shift.id}" aria-label="Delete shift">×</button>` : ''}</div>`; }).join('') || '<p class="empty-state">No shifts</p>'}</section>`).join('')}</div></article>
      <div class="two-col"><article class="card"><div class="card-title"><div><h2>Time clock</h2><p>${openEntry ? `Clocked in ${clock(openEntry.clock_in)}` : 'You are currently clocked out.'}</p></div><span class="tag ${openEntry ? 'confirmed' : ''}">${openBreak ? 'On break' : openEntry ? 'Working' : 'Off clock'}</span></div><div class="clock-actions">${!openEntry ? '<button class="primary-button" data-clock-in>Clock in</button>' : openBreak ? '<button class="primary-button" data-break-end>End break</button>' : '<button class="secondary-button" data-break-start>Start break</button>'}${openEntry ? '<button class="danger-button" data-clock-out>Clock out</button>' : ''}</div><p id="clock-status" class="auth-message"></p><div class="time-entry-list">${state.entries.filter(item => item.employee_id === state.profile.id).slice(-5).reverse().map(item => `<div class="list-row"><div class="row-main"><strong>${new Date(item.clock_in).toLocaleDateString()} · ${clock(item.clock_in)}–${item.clock_out ? clock(item.clock_out) : 'Now'}</strong><small>${entryHours(item).toFixed(2)} paid hours</small></div></div>`).join('') || '<p class="empty-state">No time entries this week.</p>'}</div></article>
      <article class="card"><div class="card-title"><div><h2>Time off</h2><p>Requests that affect this week.</p></div><button class="secondary-button" data-request-time-off>Request time off</button></div>${state.timeOff.map(item => { const employee = state.staff.find(staff => staff.id === item.employee_id); return `<div class="list-row"><div class="row-main"><strong>${esc(employee?.display_name || 'Staff')}</strong><small>${esc(item.starts_on)}–${esc(item.ends_on)} · ${esc(item.request_type)}</small></div><span class="tag ${item.status === 'approved' ? 'confirmed' : ''}">${esc(item.status)}</span>${management && item.status === 'pending' ? `<button class="secondary-button" data-time-off="${item.id}" data-decision="approved">Approve</button><button class="danger-button" data-time-off="${item.id}" data-decision="denied">Deny</button>` : ''}</div>`; }).join('') || '<p class="empty-state">No time-off requests for this week.</p>'}</article></div>
      ${state.profile.role === 'owner' ? `<article class="card"><div class="card-title"><div><h2>Private labor rates</h2><p>Visible to owners only; used for projected labor cost.</p></div></div><div class="table-wrap"><table><thead><tr><th>Employee</th><th>Type</th><th>Hourly rate</th><th></th></tr></thead><tbody>${state.staff.map(member => { const pay = state.compensation.find(item => item.profile_id === member.id); return `<tr><td>${esc(member.display_name)}</td><td><select data-pay-type="${member.id}"><option value="owner" ${pay?.employment_type === 'owner' ? 'selected' : ''}>Owner</option><option value="hourly" ${pay?.employment_type === 'hourly' ? 'selected' : ''}>Hourly</option><option value="salary" ${pay?.employment_type === 'salary' ? 'selected' : ''}>Salary</option></select></td><td><input data-pay-rate="${member.id}" type="number" min="0" step="0.01" value="${((pay?.hourly_rate_cents || 0)/100).toFixed(2)}"></td><td><button class="secondary-button" data-save-pay="${member.id}">Save</button></td></tr>`; }).join('')}</tbody></table></div></article>` : ''}
    </section>`;
  }

  function ensureDialog() {
    let dialog = document.querySelector('#workforce-dialog');
    if (!dialog) { dialog = document.createElement('dialog'); dialog.id = 'workforce-dialog'; document.body.append(dialog); }
    return dialog;
  }

  document.addEventListener('submit', async event => {
    if (event.target.id === 'schedule-plan-form') {
      event.preventDefault(); const data = Object.fromEntries(new FormData(event.target));
      await client.from('schedule_weeks').update({ forecast_sales_cents:Math.round(Number(data.forecast || 0)*100), target_splh:Number(data.target || 0) }).eq('id', state.week.id); await load();
    }
    if (event.target.id === 'shift-form') {
      event.preventDefault(); const data = Object.fromEntries(new FormData(event.target));
      const result = await client.from('shifts').insert({ schedule_week_id:state.week.id, location_id:state.profile.location_id, employee_id:data.employee_id, shift_date:data.shift_date, starts_at:data.starts_at, ends_at:data.ends_at, break_minutes:Number(data.break_minutes || 0), role_label:data.role_label || null, notes:data.notes || null });
      if (result.error) return event.target.querySelector('.auth-message').textContent = result.error.message;
      ensureDialog().close(); await load();
    }
    if (event.target.id === 'time-off-form') {
      event.preventDefault(); const data = Object.fromEntries(new FormData(event.target));
      const result = await client.from('time_off_requests').insert({ location_id:state.profile.location_id, employee_id:state.profile.id, starts_on:data.starts_on, ends_on:data.ends_on, request_type:data.request_type, reason:data.reason || null });
      if (result.error) return event.target.querySelector('.auth-message').textContent = result.error.message;
      ensureDialog().close(); await load();
    }
  });

  document.addEventListener('click', async event => {
    const week = event.target.closest('[data-week]');
    if (week) { weekStart = week.dataset.week === 'today' ? mondayOf() : addDays(weekStart, Number(week.dataset.week)); return load(); }
    if (event.target.closest('[data-add-shift]')) {
      const dialog = ensureDialog(); const days = Array.from({length:7},(_,i)=>addDays(weekStart,i));
      dialog.innerHTML = `<form id="shift-form"><div class="modal-head"><div><p class="eyebrow">Labor scheduler</p><h2>Add shift</h2></div><button type="button" class="icon-button" data-close-workforce>×</button></div><div class="form-grid"><label>Employee<select name="employee_id">${state.staff.filter(item=>item.active).map(item=>`<option value="${item.id}">${esc(item.display_name)}</option>`).join('')}</select></label><label>Date<select name="shift_date">${days.map(day=>`<option value="${day}">${new Date(`${day}T12:00:00`).toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'})}</option>`).join('')}</select></label><label>Start<input name="starts_at" type="time" value="09:00" required></label><label>End<input name="ends_at" type="time" value="17:00" required></label><label>Unpaid break (minutes)<input name="break_minutes" type="number" min="0" step="5" value="30"></label><label>Role/coverage<input name="role_label" placeholder="Front desk, technician"></label><label class="full">Notes<input name="notes"></label></div><p class="auth-message"></p><div class="modal-actions"><button type="button" class="secondary-button" data-close-workforce>Cancel</button><button class="primary-button">Add shift</button></div></form>`; dialog.showModal(); return;
    }
    if (event.target.closest('[data-request-time-off]')) { const dialog = ensureDialog(); dialog.innerHTML = `<form id="time-off-form"><div class="modal-head"><div><p class="eyebrow">Availability</p><h2>Request time off</h2></div><button type="button" class="icon-button" data-close-workforce>×</button></div><div class="form-grid"><label>Starts<input name="starts_on" type="date" required></label><label>Ends<input name="ends_on" type="date" required></label><label>Type<select name="request_type"><option value="unpaid">Unpaid</option><option value="paid">Paid</option><option value="sick">Sick</option><option value="other">Other</option></select></label><label class="full">Reason<textarea name="reason"></textarea></label></div><p class="auth-message"></p><div class="modal-actions"><button type="button" class="secondary-button" data-close-workforce>Cancel</button><button class="primary-button">Submit request</button></div></form>`; dialog.showModal(); return; }
    if (event.target.closest('[data-close-workforce]')) return ensureDialog().close();
    const deleteShift = event.target.closest('[data-delete-shift]'); if (deleteShift && confirm('Delete this shift?')) { await client.from('shifts').delete().eq('id',deleteShift.dataset.deleteShift); return load(); }
    if (event.target.closest('[data-publish-schedule]')) { const published = state.week.status !== 'published'; await client.from('schedule_weeks').update({ status:published?'published':'draft', published_at:published?new Date().toISOString():null, published_by:published?state.profile.id:null }).eq('id',state.week.id); return load(); }
    if (event.target.closest('[data-clock-in]')) { await client.from('time_entries').insert({ location_id:state.profile.location_id, employee_id:state.profile.id, clock_in:new Date().toISOString() }); return load(); }
    const openEntry = state.entries.find(item=>item.employee_id===state.profile.id&&!item.clock_out);
    const openBreak = openEntry?.time_entry_breaks?.find(item=>!item.ended_at);
    if (event.target.closest('[data-break-start]') && openEntry) { await client.from('time_entry_breaks').insert({ time_entry_id:openEntry.id, employee_id:state.profile.id }); return load(); }
    if (event.target.closest('[data-break-end]') && openBreak) { await client.from('time_entry_breaks').update({ ended_at:new Date().toISOString() }).eq('id',openBreak.id); return load(); }
    if (event.target.closest('[data-clock-out]') && openEntry) { if (openBreak) await client.from('time_entry_breaks').update({ ended_at:new Date().toISOString() }).eq('id',openBreak.id); await client.from('time_entries').update({ clock_out:new Date().toISOString() }).eq('id',openEntry.id); return load(); }
    const decision = event.target.closest('[data-time-off]'); if (decision) { await client.from('time_off_requests').update({ status:decision.dataset.decision, reviewed_by:state.profile.id, reviewed_at:new Date().toISOString() }).eq('id',decision.dataset.timeOff); return load(); }
    const savePay = event.target.closest('[data-save-pay]'); if (savePay) { const id=savePay.dataset.savePay; await client.from('staff_compensation').upsert({ profile_id:id, location_id:state.profile.location_id, employment_type:document.querySelector(`[data-pay-type="${id}"]`).value, hourly_rate_cents:Math.round(Number(document.querySelector(`[data-pay-rate="${id}"]`).value||0)*100), updated_at:new Date().toISOString() },{onConflict:'profile_id'}); return load(); }
  });

  client.auth.onAuthStateChange(event => { if (['SIGNED_IN','INITIAL_SESSION'].includes(event)) setTimeout(load, 300); });
  document.addEventListener('gc-view-changed', event => { if (event.detail === 'staff') load(); });
  setTimeout(load, 1400);
})();
