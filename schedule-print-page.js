(() => {
  'use strict';

  const root = document.getElementById('print-root');
  const printButton = document.getElementById('print-now');
  const closeButton = document.getElementById('close-print');
  const params = new URLSearchParams(location.search);
  const job = params.get('job');

  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[c]);
  const number = value => Number(value) || 0;
  const parseDate = value => new Date(`${value}T12:00:00`);
  const formatDate = (value, options={month:'short',day:'numeric'}) => new Intl.DateTimeFormat('en-US', options).format(parseDate(value));
  const roleLabel = value => String(value || '').replaceAll('_',' ').replace(/\b\w/g, c => c.toUpperCase());
  const formatTime = value => {
    if (!value) return '';
    const [h,m] = String(value).slice(0,5).split(':').map(Number);
    const d = new Date(); d.setHours(h,m,0,0);
    return new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit'}).format(d);
  };
  const shiftHours = shift => {
    const [sh,sm] = String(shift.starts_at || '00:00').split(':').map(Number);
    const [eh,em] = String(shift.ends_at || '00:00').split(':').map(Number);
    return Math.max(0, ((eh*60+em)-(sh*60+sm)-number(shift.break_minutes))/60);
  };

  function loadPayload(){
    if(!job) return null;
    try{
      const key = `gc-schedule-print:${job}`;
      const raw = sessionStorage.getItem(key);
      if(!raw) return null;
      sessionStorage.removeItem(key);
      return JSON.parse(raw);
    }catch{ return null; }
  }

  function timeOffFor(payload, employeeId, date){
    return (payload.time_off || []).filter(item => item.employee_id === employeeId && item.starts_on <= date && item.ends_on >= date && item.status === 'approved');
  }

  function shiftCell(payload, employeeId, date){
    const leave = timeOffFor(payload, employeeId, date);
    const shifts = (payload.shifts || []).filter(item => item.employee_id === employeeId && item.shift_date === date);
    const leaveMarkup = leave.map(item => `<span class="timeoff-print">${esc(roleLabel(item.request_type || 'Time off'))}</span>`).join('');
    const shiftMarkup = shifts.map(shift => `<span class="shift-print"><strong>${esc(formatTime(shift.starts_at))} – ${esc(formatTime(shift.ends_at))}</strong><span>${shiftHours(shift).toFixed(1)} hrs${shift.break_minutes ? ` · ${esc(shift.break_minutes)}m break` : ''}${shift.role_label ? ` · ${esc(shift.role_label)}` : ''}</span></span>`).join('');
    return leaveMarkup + shiftMarkup || '—';
  }

  function employeeTotal(payload, employeeId){
    return (payload.shifts || []).filter(item => item.employee_id === employeeId).reduce((sum, shift) => sum + shiftHours(shift), 0);
  }

  function dayTotal(payload, date){
    return (payload.shifts || []).filter(item => item.shift_date === date).reduce((sum, shift) => sum + shiftHours(shift), 0);
  }

  function notesMarkup(payload){
    const notes = (payload.shifts || []).filter(shift => String(shift.notes || '').trim());
    if(!notes.length) return '<p>No shift notes for this week.</p>';
    return notes.map(shift => {
      const employee = (payload.staff || []).find(item => item.id === shift.employee_id);
      return `<p><strong>${esc(employee?.display_name || 'Staff')} · ${esc(formatDate(shift.shift_date,{weekday:'short',month:'short',day:'numeric'}))}:</strong> ${esc(shift.notes)}</p>`;
    }).join('');
  }

  function approvedTimeOffMarkup(payload){
    const items = (payload.time_off || []).filter(item => item.status === 'approved');
    if(!items.length) return '<p>No approved time off affecting this week.</p>';
    return items.map(item => {
      const employee = (payload.staff || []).find(member => member.id === item.employee_id);
      const range = item.starts_on === item.ends_on ? formatDate(item.starts_on) : `${formatDate(item.starts_on)}–${formatDate(item.ends_on)}`;
      return `<p><strong>${esc(employee?.display_name || 'Staff')}:</strong> ${esc(range)} · ${esc(roleLabel(item.request_type || 'Time off'))}</p>`;
    }).join('');
  }

  function render(payload){
    if(!root) return;
    if(!payload){
      root.innerHTML='<section class="print-loading"><strong>No schedule data found.</strong><span>Return to the Portal and choose Print schedule again.</span></section>';
      return;
    }

    const status = payload.status || 'unpublished';
    const days = payload.days || [];
    const staff = payload.staff || [];
    const totalHours = (payload.shifts || []).reduce((sum, shift) => sum + shiftHours(shift), 0);
    const generatedAt = new Date(payload.generated_at || Date.now()).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'});

    root.innerHTML=`${status === 'draft' ? '<div class="draft-watermark">DRAFT</div>' : ''}<div class="print-sheet-content">
      <header class="print-header">
        <div class="print-brand"><img class="print-logo" src="assets/gotcracked-portal-logo.png" alt="GotCracked"><div class="print-title"><h1>Team Schedule</h1><p>${esc(payload.location_name || 'GotCracked')} · Sunday–Saturday work week</p></div></div>
        <div class="print-meta"><strong>${esc(payload.week_label || '')}</strong><span>Prepared ${esc(generatedAt)}</span><span class="print-status ${esc(status)}">${esc(roleLabel(status))}</span></div>
      </header>
      <section class="print-callout"><span><strong>${staff.length}</strong> scheduled staff</span><span><strong>${totalHours.toFixed(1)}</strong> total scheduled labor hours</span><span>Breaks shown are unpaid.</span></section>
      <table class="schedule-print-table" aria-label="Weekly staff schedule">
        <thead><tr><th>Team member</th>${days.map(day=>`<th>${esc(formatDate(day.date,{weekday:'short'}))}<br>${esc(formatDate(day.date,{month:'numeric',day:'numeric'}))}</th>`).join('')}<th>Total</th></tr></thead>
        <tbody>${staff.map(member=>`<tr><th>${esc(member.display_name || 'Staff')}<span>${esc(roleLabel(member.role || 'Staff'))}</span></th>${days.map(day=>`<td>${shiftCell(payload,member.id,day.date)}</td>`).join('')}<td><strong>${employeeTotal(payload,member.id).toFixed(1)}h</strong></td></tr>`).join('')}</tbody>
        <tfoot><tr><th>Daily labor</th>${days.map(day=>`<td>${dayTotal(payload,day.date).toFixed(1)}h</td>`).join('')}<td>${totalHours.toFixed(1)}h</td></tr></tfoot>
      </table>
      <section class="print-notes"><article class="print-note-block"><h2>Approved time off</h2>${approvedTimeOffMarkup(payload)}</article><article class="print-note-block"><h2>Shift notes</h2>${notesMarkup(payload)}</article></section>
      <footer class="print-footer"><span><strong>${esc(payload.location_name || 'GotCracked')}</strong> · ${esc(payload.week_label || '')}</span><span>Generated from GotCracked Portal · Posted schedule subject to management updates</span></footer>
    </div>`;

    document.title = `${payload.location_name || 'GotCracked'} Schedule ${payload.week_start || ''}`;
  }

  printButton?.addEventListener('click', () => window.print());
  closeButton?.addEventListener('click', () => window.close());

  const payload = loadPayload();
  render(payload);

  if(payload){
    const logo = document.querySelector('.print-logo');
    const launch = () => setTimeout(() => window.print(), 160);
    if(logo && !logo.complete) logo.addEventListener('load', launch, {once:true});
    else launch();
  }
})();
