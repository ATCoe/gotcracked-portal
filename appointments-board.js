(() => {
  'use strict';

  const client = window.supabaseClient;
  if (!client || window.GotCrackedAppointments) return;

  const state = {
    weekStart:null,
    data:null,
    search:'',
    status:'active',
    loading:false,
    loadedAt:0
  };

  const DAY = 86400000;
  const activeView = () => location.hash.slice(1).split('/')[0] === 'appointments';
  const training = () => localStorage.getItem('gc-training-store') === '1';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cleanPhone = value => String(value || '').replace(/[^\d+]/g,'');
  const label = value => String(value || '').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
  const isoDate = date => new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,10);
  const parseDate = value => new Date(`${value}T12:00:00`);
  const addDays = (value,count) => isoDate(new Date(parseDate(value).getTime()+count*DAY));
  const startOfWeek = (date=new Date()) => {
    const local = new Date(date.getFullYear(),date.getMonth(),date.getDate(),12);
    local.setDate(local.getDate()-local.getDay());
    return isoDate(local);
  };
  const today = () => isoDate(new Date());
  const host = () => document.getElementById('appointments');

  function timezone(){ return state.data?.timezone || 'America/New_York'; }
  function formatDate(value,options={weekday:'short',month:'short',day:'numeric'}){
    if(!value)return'';
    return new Intl.DateTimeFormat('en-US',options).format(parseDate(value));
  }
  function partsInZone(value){
    if(!value)return null;
    const date=new Date(value);
    if(Number.isNaN(date.getTime()))return null;
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:timezone(),year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
    return parts;
  }
  function dateInZone(value){
    const p=partsInZone(value);
    return p?`${p.year}-${p.month}-${p.day}`:'';
  }
  function timeInZone(value){
    if(!value)return'';
    const date=new Date(value);
    if(Number.isNaN(date.getTime()))return'';
    return new Intl.DateTimeFormat('en-US',{timeZone:timezone(),hour:'numeric',minute:'2-digit'}).format(date);
  }
  function dateTimeInZone(value){
    if(!value)return'';
    const date=new Date(value);
    if(Number.isNaN(date.getTime()))return'';
    return new Intl.DateTimeFormat('en-US',{timeZone:timezone(),weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(date);
  }
  function toLocalInput(value){
    const p=partsInZone(value);
    return p?`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`:'';
  }
  function zonedInputToIso(value){
    const match=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if(!match)return null;
    const [,y,m,d,h,min]=match.map(Number);
    const desired=Date.UTC(y,m-1,d,h,min,0);
    const probe=new Date(desired);
    const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:timezone(),year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(probe).filter(part=>part.type!=='literal').map(part=>[part.type,Number(part.value)]));
    const represented=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second||0);
    const offset=represented-desired;
    let result=new Date(desired-offset);
    const verify=partsInZone(result.toISOString());
    if(verify && Number(verify.hour)!==h){
      const desiredAgain=Date.UTC(y,m-1,d,h,min,0);
      const representedAgain=Date.UTC(Number(verify.year),Number(verify.month)-1,Number(verify.day),Number(verify.hour),Number(verify.minute),0);
      result=new Date(result.getTime()-(representedAgain-desiredAgain));
    }
    return result.toISOString();
  }

  function injectStyle(){
    if(document.getElementById('gc-appointments-style'))return;
    const style=document.createElement('style');
    style.id='gc-appointments-style';
    style.textContent=`
      .gc-appt-shell{display:grid;gap:16px}.gc-appt-header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}.gc-appt-header h1{margin:3px 0 4px}.gc-appt-header p{margin:0;color:var(--muted,#667085)}
      .gc-appt-actions,.gc-appt-nav,.gc-appt-card-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.gc-appt-toolbar{display:grid;grid-template-columns:auto minmax(220px,1fr) minmax(160px,220px);gap:10px;align-items:center}.gc-appt-nav strong{min-width:170px;text-align:center}.gc-appt-toolbar input,.gc-appt-toolbar select{width:100%}
      .gc-appt-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.gc-appt-metric{border:1px solid var(--line,#dbe3ec);background:var(--surface,#fff);border-radius:14px;padding:13px;display:grid;gap:3px}.gc-appt-metric small{color:var(--muted,#667085)}.gc-appt-metric strong{font-size:1.35rem}.gc-appt-metric.is-warn strong{color:#a15c00}.gc-appt-metric.is-bad strong{color:#b42318}
      .gc-appt-conflicts{border:1px solid rgba(180,35,24,.28);background:rgba(180,35,24,.06);border-radius:14px;padding:13px}.gc-appt-conflicts strong{color:#b42318}.gc-appt-conflicts ul{margin:8px 0 0;padding-left:20px}
      .gc-appt-days{display:grid;gap:13px}.gc-appt-day{border:1px solid var(--line,#dbe3ec);background:var(--surface,#fff);border-radius:16px;overflow:hidden}.gc-appt-day-head{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 14px;background:var(--surface-subtle,#f7f9fc);border-bottom:1px solid var(--line,#dbe3ec)}.gc-appt-day-head h2{font-size:1rem;margin:0}.gc-appt-day-head span{font-size:.82rem;color:var(--muted,#667085)}
      .gc-appt-list{display:grid}.gc-appt-card{display:grid;grid-template-columns:110px minmax(0,1fr) auto;gap:14px;padding:14px;border-bottom:1px solid var(--line,#e5eaf0);align-items:start}.gc-appt-card:last-child{border-bottom:0}.gc-appt-time{display:grid;gap:3px}.gc-appt-time strong{font-size:1rem}.gc-appt-time span{font-size:.78rem;color:var(--muted,#667085)}.gc-appt-main{min-width:0;display:grid;gap:6px}.gc-appt-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.gc-appt-title h3{margin:0;font-size:1rem}.gc-appt-badge{display:inline-flex;width:max-content;border-radius:999px;padding:3px 8px;font-size:.7rem;font-weight:800;background:rgba(43,124,255,.1)}.gc-appt-badge.requested{background:rgba(234,143,18,.14);color:#965b00}.gc-appt-badge.arrived{background:rgba(0,145,110,.12);color:#00795d}.gc-appt-badge.cancelled,.gc-appt-badge.no_show{background:rgba(180,35,24,.1);color:#b42318}.gc-appt-badge.completed{background:rgba(90,98,110,.12);color:#5a626e}.gc-appt-meta{display:flex;gap:8px 14px;flex-wrap:wrap;font-size:.82rem;color:var(--muted,#667085)}.gc-appt-service{font-size:.9rem}.gc-appt-notes{font-size:.82rem;color:var(--muted,#667085);white-space:pre-wrap;max-width:80ch}.gc-appt-card-actions{justify-content:flex-end;max-width:260px}.gc-appt-card-actions button,.gc-appt-card-actions a{font-size:.78rem;min-height:34px;padding:7px 10px}
      .gc-appt-empty{padding:28px;text-align:center;color:var(--muted,#667085)}.gc-appt-empty strong{display:block;color:var(--text,#101827);font-size:1.05rem;margin-bottom:4px}
      .gc-appt-dialog{border:0;border-radius:18px;padding:0;width:min(680px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow:auto;background:var(--surface,#fff);color:var(--text,#101827);box-shadow:0 24px 80px rgba(0,0,0,.35)}.gc-appt-dialog::backdrop{background:rgba(6,15,28,.68);backdrop-filter:blur(3px)}.gc-appt-form{padding:20px;display:grid;gap:13px}.gc-appt-dialog-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.gc-appt-dialog-head h2{margin:2px 0 3px}.gc-appt-dialog-head p{margin:0;color:var(--muted,#667085)}.gc-appt-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.gc-appt-form label{display:grid;gap:6px}.gc-appt-form input,.gc-appt-form select,.gc-appt-form textarea{width:100%}.gc-appt-form .full{grid-column:1/-1}.gc-appt-dialog-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}.gc-appt-message{min-height:1.2em;color:var(--muted,#667085);margin:0}.gc-appt-message.is-error{color:#b42318}.gc-appt-loading{padding:30px;text-align:center;color:var(--muted,#667085)}
      @media(max-width:900px){.gc-appt-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.gc-appt-toolbar{grid-template-columns:1fr 1fr}.gc-appt-nav{grid-column:1/-1;justify-content:space-between}.gc-appt-card{grid-template-columns:90px minmax(0,1fr)}.gc-appt-card-actions{grid-column:2;justify-content:flex-start;max-width:none}}
      @media(max-width:620px){.gc-appt-shell{gap:12px}.gc-appt-header .gc-appt-actions>*{flex:1 1 130px;min-height:44px}.gc-appt-toolbar{grid-template-columns:1fr}.gc-appt-nav{grid-column:auto}.gc-appt-nav strong{min-width:0;flex:1}.gc-appt-metrics{grid-template-columns:1fr 1fr}.gc-appt-metric{padding:11px}.gc-appt-card{grid-template-columns:1fr;gap:8px;padding:12px}.gc-appt-time{display:flex;gap:8px;align-items:baseline}.gc-appt-card-actions{grid-column:auto;justify-content:flex-start}.gc-appt-card-actions>*{min-height:40px}.gc-appt-grid{grid-template-columns:1fr}.gc-appt-form .full{grid-column:auto}.gc-appt-dialog-actions>*{flex:1 1 140px;min-height:44px}}
    `;
    document.head.appendChild(style);
  }

  function ensureDialog(){
    injectStyle();
    let dialog=document.getElementById('gc-appt-dialog');
    if(!dialog){dialog=document.createElement('dialog');dialog.id='gc-appt-dialog';dialog.className='gc-appt-dialog';document.body.appendChild(dialog);}
    return dialog;
  }
  function closeDialog(){const dialog=ensureDialog();if(dialog.open)dialog.close();}

  function dateForAppointment(appt){ return appt.starts_at ? dateInZone(appt.starts_at) : (appt.preferred_date || ''); }
  function displayName(appt){ return appt.customer_name || appt.lead_name || 'Customer'; }
  function displayPhone(appt){ return appt.customer_phone || appt.lead_phone || ''; }
  function displayEmail(appt){ return appt.customer_email || appt.lead_email || ''; }
  function appointmentTime(appt){ return appt.starts_at ? timeInZone(appt.starts_at) : (appt.preferred_time || 'Time requested'); }
  function durationLabel(appt){ return appt.starts_at ? `${Number(appt.duration_minutes)||60} min` : 'Not scheduled'; }
  function isActiveStatus(status){ return !['completed','cancelled','no_show'].includes(status); }

  function filteredAppointments(){
    const items=Array.isArray(state.data?.appointments)?state.data.appointments:[];
    const q=state.search.trim().toLowerCase();
    return items.filter(appt=>{
      if(state.status==='active'&&!isActiveStatus(appt.status))return false;
      if(state.status!=='all'&&state.status!=='active'&&appt.status!==state.status)return false;
      if(!q)return true;
      return [displayName(appt),displayPhone(appt),displayEmail(appt),appt.device_description,appt.service_requested,appt.assigned_name,appt.notes,appt.status].some(value=>String(value||'').toLowerCase().includes(q));
    });
  }

  function actionButtons(appt){
    if(!state.data?.can_manage)return appt.lead_id?`<a class="text-button" href="#leads/${esc(appt.lead_id)}">Open lead</a>`:'';
    const common=[];
    if(appt.status==='requested') common.push(`<button class="primary-button" type="button" data-appt-reschedule="${esc(appt.id)}">Confirm & schedule</button>`,`<button class="text-button" type="button" data-appt-status="cancelled" data-appt-id="${esc(appt.id)}">Cancel</button>`);
    if(['scheduled','confirmed'].includes(appt.status)) common.push(`<button class="primary-button" type="button" data-appt-status="arrived" data-appt-id="${esc(appt.id)}">Arrived</button>`,`<button class="secondary-button" type="button" data-appt-reschedule="${esc(appt.id)}">Reschedule</button>`,`<button class="text-button" type="button" data-appt-status="no_show" data-appt-id="${esc(appt.id)}">No-show</button>`);
    if(appt.status==='arrived') common.push(`<button class="primary-button" type="button" data-appt-status="completed" data-appt-id="${esc(appt.id)}">Complete appointment</button>`);
    if(appt.lead_id && ['requested','scheduled','confirmed','arrived'].includes(appt.status)) common.push(`<a class="secondary-button" href="#leads/${esc(appt.lead_id)}">${appt.status==='arrived'?'Open intake lead':'Open lead'}</a>`);
    if(['scheduled','confirmed','arrived'].includes(appt.status)) common.push(`<button class="text-button" type="button" data-appt-status="cancelled" data-appt-id="${esc(appt.id)}">Cancel</button>`);
    return common.join('');
  }

  function card(appt){
    const phone=displayPhone(appt), email=displayEmail(appt), source=appt.source==='portal'?'Portal':'Website';
    return `<article class="gc-appt-card" data-appt-card="${esc(appt.id)}">
      <div class="gc-appt-time"><strong>${esc(appointmentTime(appt))}</strong><span>${esc(durationLabel(appt))}</span></div>
      <div class="gc-appt-main">
        <div class="gc-appt-title"><h3>${esc(displayName(appt))}</h3><span class="gc-appt-badge ${esc(appt.status)}">${esc(label(appt.status))}</span></div>
        <div class="gc-appt-service"><strong>${esc(appt.device_description || 'Device not specified')}</strong>${appt.service_requested?` · ${esc(appt.service_requested)}`:''}</div>
        <div class="gc-appt-meta">${appt.assigned_name?`<span>Assigned: ${esc(appt.assigned_name)}</span>`:'<span>Unassigned</span>'}<span>${esc(appt.service_mode==='mail_in'?'Mail-in':'Walk-in')}</span><span>${esc(source)}</span>${phone?`<a href="tel:${esc(cleanPhone(phone))}">${esc(phone)}</a>`:''}${email?`<a href="mailto:${esc(email)}">${esc(email)}</a>`:''}</div>
        ${appt.notes?`<div class="gc-appt-notes">${esc(appt.notes)}</div>`:''}
      </div>
      <div class="gc-appt-card-actions">${actionButtons(appt)}</div>
    </article>`;
  }

  function dayMarkup(dayValue,items){
    const current=dayValue===today();
    return `<section class="gc-appt-day"><div class="gc-appt-day-head"><h2>${current?'Today · ':''}${esc(formatDate(dayValue,{weekday:'long',month:'short',day:'numeric'}))}</h2><span>${items.length} appointment${items.length===1?'':'s'}</span></div><div class="gc-appt-list">${items.length?items.map(card).join(''):'<div class="gc-appt-empty">No appointments on this day.</div>'}</div></section>`;
  }

  function render(){
    const target=host();
    if(!target)return;
    injectStyle();
    const items=filteredAppointments();
    const all=Array.isArray(state.data?.appointments)?state.data.appointments:[];
    const requested=all.filter(a=>a.status==='requested').length;
    const confirmed=all.filter(a=>['scheduled','confirmed'].includes(a.status)).length;
    const todayCount=all.filter(a=>dateForAppointment(a)===today()&&!['cancelled','no_show'].includes(a.status)).length;
    const conflicts=Array.isArray(state.data?.conflicts)?state.data.conflicts:[];
    const end=addDays(state.weekStart,6);
    const grouped=new Map();
    for(let i=0;i<7;i++)grouped.set(addDays(state.weekStart,i),[]);
    for(const appt of items){const date=dateForAppointment(appt);if(grouped.has(date))grouped.get(date).push(appt);}

    target.innerHTML=`<div class="gc-appt-shell">
      <div class="gc-appt-header"><div><p class="eyebrow">Appointments</p><h1>Appointment command center</h1><p>Website requests, confirmed visits, arrivals, assignments, and follow-through in one queue.</p></div><div class="gc-appt-actions">${state.data?.can_manage?'<button class="primary-button" type="button" data-appt-new>+ New appointment</button>':''}<button class="secondary-button" type="button" data-appt-refresh>Refresh</button></div></div>
      <div class="gc-appt-toolbar"><div class="gc-appt-nav"><button class="icon-button" type="button" data-appt-week="-7" aria-label="Previous week">‹</button><button class="text-button" type="button" data-appt-today>Today</button><strong>${esc(formatDate(state.weekStart,{month:'short',day:'numeric'}))} – ${esc(formatDate(end,{month:'short',day:'numeric',year:'numeric'}))}</strong><button class="icon-button" type="button" data-appt-week="7" aria-label="Next week">›</button></div><input type="search" data-appt-search placeholder="Search customer, device, service, staff…" value="${esc(state.search)}"><select data-appt-filter><option value="active" ${state.status==='active'?'selected':''}>Active appointments</option><option value="all" ${state.status==='all'?'selected':''}>All statuses</option>${['requested','scheduled','confirmed','arrived','completed','no_show','cancelled'].map(s=>`<option value="${s}" ${state.status===s?'selected':''}>${esc(label(s))}</option>`).join('')}</select></div>
      <div class="gc-appt-metrics"><div class="gc-appt-metric ${requested?'is-warn':''}"><small>Needs scheduling</small><strong>${requested}</strong><span>Website / intake requests</span></div><div class="gc-appt-metric"><small>Scheduled</small><strong>${confirmed}</strong><span>Confirmed this week</span></div><div class="gc-appt-metric"><small>Today</small><strong>${todayCount}</strong><span>Expected visits</span></div><div class="gc-appt-metric ${conflicts.length?'is-bad':''}"><small>Assignment conflicts</small><strong>${conflicts.length}</strong><span>${conflicts.length?'Needs attention':'Clear'}</span></div></div>
      ${conflicts.length?`<div class="gc-appt-conflicts"><strong>Schedule conflicts detected</strong><ul>${conflicts.map(c=>`<li>${esc(c.assigned_name||'Assigned staff')} · ${esc(dateTimeInZone(c.starts_at))} — ${esc(c.message)}</li>`).join('')}</ul></div>`:''}
      ${training()?'<div class="gc-appt-conflicts"><strong>Training Store</strong><div>Appointment command-center mutations are disabled in Training Store so sandbox work cannot touch the live appointment queue.</div></div>':''}
      <div class="gc-appt-days">${[...grouped.entries()].map(([date,list])=>dayMarkup(date,list)).join('')}</div>
    </div>`;
  }

  function renderLoading(){
    const target=host();if(!target)return;
    target.innerHTML='<div class="gc-appt-loading">Loading appointment command center…</div>';
  }
  function renderError(error){
    const target=host();if(!target)return;
    target.innerHTML=`<div class="gc-appt-shell"><div class="gc-appt-header"><div><p class="eyebrow">Appointments</p><h1>Appointment command center</h1></div></div><div class="empty-card"><h2>Appointments could not be loaded.</h2><p>${esc(error?.message||'Try refreshing the Portal.')}</p><button class="primary-button" type="button" data-appt-refresh>Try again</button></div></div>`;
  }

  async function load({quiet=false}={}){
    if(!activeView()||state.loading)return;
    if(!state.weekStart)state.weekStart=startOfWeek();
    state.loading=true;
    if(!quiet)renderLoading();
    try{
      if(training()){
        state.data={can_manage:false,timezone:'America/New_York',appointments:[],staff:[],conflicts:[]};
      }else{
        const result=await client.rpc('get_appointment_command_center',{range_start:state.weekStart,range_end:addDays(state.weekStart,6)});
        if(result.error)throw result.error;
        state.data=result.data||{appointments:[],staff:[],conflicts:[]};
      }
      state.loadedAt=Date.now();render();
    }catch(error){
      console.error('Appointment command center failed:',error);
      renderError(error);
      window.GotCrackedDiagnostics?.error?.(error,{context:'Appointments could not be loaded'});
    }finally{state.loading=false;}
  }

  function staffOptions(selected){
    const staff=Array.isArray(state.data?.staff)?state.data.staff:[];
    return `<option value="">Unassigned</option>${staff.map(person=>`<option value="${esc(person.id)}" ${person.id===selected?'selected':''}>${esc(person.name)} · ${esc(label(person.role))}</option>`).join('')}`;
  }

  function openNew(){
    if(training()||!state.data?.can_manage)return;
    const dialog=ensureDialog();
    const defaultTime=`${today()}T10:00`;
    dialog.innerHTML=`<form class="gc-appt-form" id="gc-appt-new-form"><div class="gc-appt-dialog-head"><div><p class="eyebrow">Internal booking</p><h2>New appointment</h2><p>Create the lead and confirmed appointment together.</p></div><button class="icon-button" type="button" data-appt-close>×</button></div><div class="gc-appt-grid"><label>Customer name<input name="customer_name" autocomplete="name" required></label><label>Phone<input name="phone" type="tel" autocomplete="tel"></label><label>Email<input name="email" type="email" autocomplete="email"></label><label>Device<input name="device" placeholder="iPhone 15 Pro, PS5, custom PC…"></label><label class="full">Service requested<input name="service" required placeholder="Screen repair, diagnostics, upgrade…"></label><label>Appointment time<input name="starts_at" type="datetime-local" value="${defaultTime}" required></label><label>Duration<select name="duration"><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60" selected>1 hour</option><option value="90">1.5 hours</option><option value="120">2 hours</option></select></label><label class="full">Assigned staff<select name="assigned">${staffOptions('')}</select></label><label class="full">Notes<textarea name="notes" rows="3" placeholder="Internal booking notes"></textarea></label></div><p class="gc-appt-message" role="status"></p><div class="gc-appt-dialog-actions"><button class="secondary-button" type="button" data-appt-close>Cancel</button><button class="primary-button" type="submit">Create appointment</button></div></form>`;
    dialog.showModal();
  }

  function findAppointment(id){return (state.data?.appointments||[]).find(item=>item.id===id)||null;}
  function openReschedule(id){
    if(training()||!state.data?.can_manage)return;
    const appt=findAppointment(id);if(!appt)return;
    let input=appt.starts_at?toLocalInput(appt.starts_at):`${appt.preferred_date||today()}T10:00`;
    const dialog=ensureDialog();
    dialog.innerHTML=`<form class="gc-appt-form" id="gc-appt-reschedule-form" data-appt-id="${esc(appt.id)}"><div class="gc-appt-dialog-head"><div><p class="eyebrow">${appt.status==='requested'?'Confirm request':'Appointment'}</p><h2>${appt.status==='requested'?'Schedule appointment':'Reschedule appointment'}</h2><p>${esc(displayName(appt))} · ${esc(appt.device_description||appt.service_requested||'Repair visit')}</p></div><button class="icon-button" type="button" data-appt-close>×</button></div><div class="gc-appt-grid"><label>Appointment time<input name="starts_at" type="datetime-local" value="${esc(input)}" required></label><label>Duration<select name="duration">${[30,45,60,90,120,180].map(minutes=>`<option value="${minutes}" ${Number(appt.duration_minutes||60)===minutes?'selected':''}>${minutes<60?`${minutes} minutes`:minutes===60?'1 hour':`${minutes/60} hours`}</option>`).join('')}</select></label><label class="full">Assigned staff<select name="assigned">${staffOptions(appt.assigned_user_id||'')}</select></label><label class="full">Change note<textarea name="note" rows="3" placeholder="Optional note added to appointment history"></textarea></label></div><p class="gc-appt-message" role="status"></p><div class="gc-appt-dialog-actions"><button class="secondary-button" type="button" data-appt-close>Cancel</button><button class="primary-button" type="submit">${appt.status==='requested'?'Confirm appointment':'Save changes'}</button></div></form>`;
    dialog.showModal();
  }

  async function submitNew(form){
    const iso=zonedInputToIso(form.elements.starts_at.value);
    if(!iso)throw new Error('Choose a valid appointment date and time.');
    const result=await client.rpc('create_staff_appointment',{
      customer_name_input:form.elements.customer_name.value.trim(),
      phone_input:form.elements.phone.value.trim()||null,
      email_input:form.elements.email.value.trim()||null,
      device_input:form.elements.device.value.trim()||null,
      service_input:form.elements.service.value.trim(),
      starts_at_input:iso,
      duration_input:Number(form.elements.duration.value),
      assigned_user_input:form.elements.assigned.value||null,
      notes_input:form.elements.notes.value.trim()||null
    });
    if(result.error)throw result.error;
    closeDialog();
    const date=dateInZone(result.data?.starts_at||iso);
    if(date && (date<state.weekStart||date>addDays(state.weekStart,6)))state.weekStart=startOfWeek(parseDate(date));
    await load({quiet:true});
    window.GotCrackedCrossUserSync?.pollNow?.();
  }

  async function submitReschedule(form){
    const iso=zonedInputToIso(form.elements.starts_at.value);
    if(!iso)throw new Error('Choose a valid appointment date and time.');
    const result=await client.rpc('reschedule_appointment',{
      appointment_id_input:form.dataset.apptId,
      starts_at_input:iso,
      duration_input:Number(form.elements.duration.value),
      assigned_user_input:form.elements.assigned.value||null,
      note_input:form.elements.note.value.trim()||null
    });
    if(result.error)throw result.error;
    closeDialog();await load({quiet:true});window.GotCrackedCrossUserSync?.pollNow?.();
  }

  async function setStatus(id,status){
    if(training()||!state.data?.can_manage)return;
    const appt=findAppointment(id);if(!appt)return;
    let note=null;
    if(status==='cancelled'){
      if(!confirm(`Cancel ${displayName(appt)}'s appointment?`))return;
      note=prompt('Optional cancellation note:','')||null;
    }
    if(status==='no_show'&&!confirm(`Mark ${displayName(appt)} as a no-show?`))return;
    const result=await client.rpc('update_appointment_status',{appointment_id_input:id,status_input:status,note_input:note});
    if(result.error)throw result.error;
    await load({quiet:true});window.GotCrackedCrossUserSync?.pollNow?.();
  }

  async function guarded(button,fn){
    if(button)button.disabled=true;
    const form=button?.closest('form');const message=form?.querySelector('.gc-appt-message');
    try{if(message){message.classList.remove('is-error');message.textContent='Saving…';}await fn();}
    catch(error){console.error('Appointment update failed:',error);if(message){message.classList.add('is-error');message.textContent=error?.message||'Unable to save this appointment.';}else window.GotCrackedDiagnostics?.error?.(error,{context:'Appointment update failed'});}
    finally{if(button)button.disabled=false;}
  }

  document.addEventListener('submit',event=>{
    const form=event.target;if(!(form instanceof HTMLFormElement))return;
    if(form.id==='gc-appt-new-form'){event.preventDefault();guarded(form.querySelector('button[type="submit"]'),()=>submitNew(form));}
    if(form.id==='gc-appt-reschedule-form'){event.preventDefault();guarded(form.querySelector('button[type="submit"]'),()=>submitReschedule(form));}
  });

  document.addEventListener('input',event=>{
    const input=event.target instanceof Element?event.target:null;
    if(input?.matches('[data-appt-search]')){state.search=input.value;render();const replacement=host()?.querySelector('[data-appt-search]');replacement?.focus();replacement?.setSelectionRange(state.search.length,state.search.length);}
  });
  document.addEventListener('change',event=>{
    const input=event.target instanceof Element?event.target:null;
    if(input?.matches('[data-appt-filter]')){state.status=input.value;render();}
  });
  document.addEventListener('click',event=>{
    const target=event.target instanceof Element?event.target:null;if(!target)return;
    if(target.closest('[data-appt-close]')){closeDialog();return;}
    if(target.closest('[data-appt-new]')){openNew();return;}
    if(target.closest('[data-appt-refresh]')){load();return;}
    if(target.closest('[data-appt-today]')){state.weekStart=startOfWeek();load();return;}
    const week=target.closest('[data-appt-week]');if(week){state.weekStart=addDays(state.weekStart,Number(week.dataset.apptWeek)||0);load();return;}
    const reschedule=target.closest('[data-appt-reschedule]');if(reschedule){openReschedule(reschedule.dataset.apptReschedule);return;}
    const status=target.closest('[data-appt-status][data-appt-id]');if(status){guarded(status,()=>setStatus(status.dataset.apptId,status.dataset.apptStatus));}
  });

  document.addEventListener('gc-view-changed',event=>{
    const view=typeof event.detail==='string'?event.detail:(event.detail?.view||location.hash.slice(1).split('/')[0]);
    if(view==='appointments')setTimeout(()=>load(),50);
  });
  document.addEventListener('gc-cross-user-sync',()=>{if(activeView())load({quiet:true});});
  window.addEventListener('hashchange',()=>{if(activeView())setTimeout(()=>load(),50);});

  injectStyle();
  if(activeView())setTimeout(()=>load(),50);
  window.GotCrackedAppointments={load,get state(){return state;}};
})();
