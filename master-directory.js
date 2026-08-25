(() => {
  'use strict';
  if (window.GotCrackedDirectory?.version) return;
  const client = window.supabaseClient;
  if (!client) { console.warn('GotCracked directory: Supabase client unavailable.'); return; }
  const VERSION = '20260825-directory1';
  const REPAIR_TERMINAL = new Set(['sale_complete','abandoned','unrepairable','customer_declined','completed','cancelled']);
  const LEAD_TERMINAL = new Set(['won','lost']);
  const REPAIR_LABELS = { checked_in:'Checked In', in_diagnosis:'In Diagnosis', awaiting_approval:'Awaiting Approval', waiting_on_parts:'Waiting on Parts', in_repair:'In Repair', ready_for_pickup:'Ready for Pickup', completed:'Completed', awaiting_repair:'Awaiting Repair', need_to_order_parts:'Need to Order Parts', awaiting_parts:'Awaiting Parts', diagnostic_in_progress:'Diagnostic in Progress', repair_in_progress:'Repair in Progress', quality_inspection:'Quality Inspection', awaiting_callback:'Awaiting Callback', repaired:'Ready for Pickup', sale_complete:'Sale Complete', abandoned:'Abandoned', unrepairable:'Unrepairable', customer_declined:'Customer Declined', cancelled:'Cancelled' };
  const LEAD_LABELS = { new:'New', claimed:'Claimed', qualified:'Qualified', won:'Won', lost:'Lost' };
  const DEFAULT_SORT = 'checkin_desc';
  const baseState = () => ({ query:'', types:new Set(), statuses:new Set(), device:'all', assigned:'all', intake:'all', from:'', to:'', includeClosed:false, sort:DEFAULT_SORT, filtersOpen:false, preset:'active' });
  const state = { dashboard:baseState(), leads:baseState(), data:{repairs:[],leads:[]}, loading:false, loaded:false, refreshTimer:null };
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[char]);
  const friendly = value => String(value || '').replaceAll('_',' ').replace(/\b\w/g, letter => letter.toUpperCase());
  const labelFor = (type,status) => type === 'work_order' ? (REPAIR_LABELS[status] || friendly(status)) : (LEAD_LABELS[status] || friendly(status));
  const isClosed = record => record.type === 'work_order' ? REPAIR_TERMINAL.has(record.status) : LEAD_TERMINAL.has(record.status);
  const customerName = ticket => [ticket.customers?.first_name,ticket.customers?.last_name].filter(Boolean).join(' ').trim() || 'Unknown customer';

  function normalizeRepair(ticket) {
    const device = [ticket.devices?.manufacturer,ticket.devices?.model].filter(Boolean).join(' ').trim() || 'Device not listed';
    return { key:`work_order:${ticket.id}`, type:'work_order', sourceId:ticket.id, ticketNumber:String(ticket.ticket_number ?? ''), displayId:ticket.ticket_number != null ? `GC-${String(ticket.ticket_number).padStart(6,'0')}` : 'Work order', customer:customerName(ticket), phone:ticket.customers?.phone || '', email:ticket.customers?.email || '', device, deviceType:ticket.devices?.category || ticket.devices?.manufacturer || 'Other', service:ticket.customer_issue || 'Repair service', status:ticket.status || 'awaiting_repair', statusLabel:labelFor('work_order',ticket.status || 'awaiting_repair'), assigned:ticket.profiles?.display_name || 'Unassigned', intake:ticket.intake_method || 'walk_in', createdAt:ticket.created_at || ticket.updated_at || '', updatedAt:ticket.updated_at || ticket.created_at || '' };
  }
  function normalizeLead(lead) {
    const service = lead.service || lead.notes || 'Service inquiry';
    return { key:`lead:${lead.id}`, type:'lead', sourceId:lead.id, ticketNumber:'', displayId:`LD-${String(lead.id || '').replaceAll('-','').slice(0,6).toUpperCase() || 'NEW'}`, customer:lead.name || 'Unknown lead', phone:lead.phone || '', email:lead.email || '', device:service, deviceType:'Lead / inquiry', service, status:lead.status || 'new', statusLabel:labelFor('lead',lead.status || 'new'), assigned:lead.profiles?.display_name || 'Unassigned', intake:lead.intake_method || lead.source || 'lead', createdAt:lead.created_at || lead.updated_at || '', updatedAt:lead.updated_at || lead.created_at || '' };
  }
  function allRecords(scope) { return [...(scope === 'leads' ? [] : state.data.repairs.map(normalizeRepair)), ...state.data.leads.map(normalizeLead)]; }
  const dateValue = value => { const time = new Date(value || 0).getTime(); return Number.isFinite(time) ? time : 0; };
  const searchable = record => [record.displayId,record.customer,record.phone,record.email,record.device,record.deviceType,record.service,record.statusLabel,record.assigned,record.intake].join(' ').toLowerCase();

  function filteredRecords(scope) {
    const s = state[scope], query = s.query.trim().toLowerCase(), from = s.from ? new Date(`${s.from}T00:00:00`).getTime() : null, to = s.to ? new Date(`${s.to}T23:59:59.999`).getTime() : null;
    const records = allRecords(scope).filter(record => {
      if (!s.includeClosed && isClosed(record)) return false;
      if (scope === 'dashboard' && s.types.size && !s.types.has(record.type)) return false;
      if (s.statuses.size && !s.statuses.has(`${record.type}:${record.status}`)) return false;
      if (s.device !== 'all' && record.deviceType !== s.device) return false;
      if (s.assigned !== 'all' && record.assigned !== s.assigned) return false;
      if (s.intake !== 'all' && record.intake !== s.intake) return false;
      const created = dateValue(record.createdAt);
      if (from != null && created < from) return false;
      if (to != null && created > to) return false;
      if (query && !searchable(record).includes(query)) return false;
      return true;
    });
    const sorters = { checkin_desc:(a,b)=>dateValue(b.createdAt)-dateValue(a.createdAt), checkin_asc:(a,b)=>dateValue(a.createdAt)-dateValue(b.createdAt), updated_desc:(a,b)=>dateValue(b.updatedAt)-dateValue(a.updatedAt), updated_asc:(a,b)=>dateValue(a.updatedAt)-dateValue(b.updatedAt), name_asc:(a,b)=>a.customer.localeCompare(b.customer), name_desc:(a,b)=>b.customer.localeCompare(a.customer), device_asc:(a,b)=>a.device.localeCompare(b.device), device_desc:(a,b)=>b.device.localeCompare(a.device), status_asc:(a,b)=>a.statusLabel.localeCompare(b.statusLabel), status_desc:(a,b)=>b.statusLabel.localeCompare(a.statusLabel) };
    records.sort(sorters[s.sort] || sorters[DEFAULT_SORT]);
    return records;
  }

  function statusOptions(scope) {
    const seen = new Map(); allRecords(scope).forEach(record => seen.set(`${record.type}:${record.status}`,record));
    return [...seen.values()].sort((a,b) => a.type === b.type ? a.statusLabel.localeCompare(b.statusLabel) : a.type.localeCompare(b.type));
  }
  const optionValues = (scope,key) => [...new Set(allRecords(scope).map(record => record[key]).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  function activeFilterCount(scope) { const s=state[scope]; return Number(Boolean(s.query))+Number(Boolean(s.types.size))+Number(Boolean(s.statuses.size))+Number(s.device!=='all')+Number(s.assigned!=='all')+Number(s.intake!=='all')+Number(Boolean(s.from||s.to))+Number(s.includeClosed)+Number(s.sort!==DEFAULT_SORT); }
  function formatDate(value) { if (!value) return '—'; const date=new Date(value); if (Number.isNaN(date.getTime())) return '—'; return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(date); }
  const typeLabel = type => type === 'work_order' ? 'Work order' : 'Lead';
  function statusClass(record) { const v=record.status; if (['new','awaiting_repair','checked_in'].includes(v)) return 'new'; if (['claimed','awaiting_approval','awaiting_callback'].includes(v)) return 'callback'; if (['qualified','diagnostic_in_progress','in_diagnosis'].includes(v)) return 'diagnosis'; if (['need_to_order_parts','awaiting_parts','waiting_on_parts'].includes(v)) return 'parts'; if (['repair_in_progress','in_repair'].includes(v)) return 'in-repair'; if (v==='quality_inspection') return 'inspection'; if (['repaired','ready_for_pickup','won'].includes(v)) return 'ready'; if (isClosed(record)) return 'closed'; return ''; }
  function renderStatusChecklist(scope) { const s=state[scope], options=statusOptions(scope); return options.length ? options.map(record => { const value=`${record.type}:${record.status}`; return `<label class="gc-dir-check"><input type="checkbox" data-gc-status="${esc(value)}" ${s.statuses.has(value)?'checked':''}><span><i class="gc-dir-type-dot ${record.type}"></i>${esc(record.statusLabel)}</span></label>`; }).join('') : '<p class="gc-dir-filter-empty">No statuses loaded yet.</p>'; }
  function selectOptions(values,selected,allLabel) { return `<option value="all">${esc(allLabel)}</option>${values.map(value=>`<option value="${esc(value)}" ${selected===value?'selected':''}>${esc(friendly(value))}</option>`).join('')}`; }
  function renderPresets(scope) { const active=state[scope].preset, presets=scope==='dashboard' ? [['active','All active'],['attention','Needs attention'],['new_leads','New leads'],['awaiting_parts','Awaiting parts'],['ready','Ready for pickup'],['unassigned','Unassigned']] : [['active','Active leads'],['new','New'],['claimed','Claimed'],['qualified','Qualified'],['won','Won'],['lost','Lost'],['unassigned','Unassigned']]; return presets.map(([value,label])=>`<button type="button" class="gc-dir-chip ${active===value?'active':''}" data-gc-preset="${value}">${label}</button>`).join(''); }

  function renderShell(scope) {
    const s=state[scope], isDashboard=scope==='dashboard', host=ensureHost(scope); if (!host) return;
    const filterCount=activeFilterCount(scope);
    host.innerHTML=`<div class="gc-dir-head"><div><p class="eyebrow">${isDashboard?'Unified operations':'Lead pipeline'}</p><h2>${isDashboard?'Master directory':'Lead directory'}</h2><p>${isDashboard?'Every open work order and active lead in one searchable operating view.':'Search, filter, sort, and work every lead from one focused queue.'}</p></div><div class="gc-dir-head-actions"><button class="secondary-button gc-dir-refresh" type="button" data-gc-action="refresh">↻ Refresh</button><button class="secondary-button gc-dir-filter-toggle" type="button" data-gc-action="filters" aria-expanded="${s.filtersOpen}">Filters${filterCount?` (${filterCount})`:''}</button></div></div>
    <div class="gc-dir-search-row"><label class="gc-dir-search"><span>⌕</span><input type="search" data-gc-field="query" value="${esc(s.query)}" placeholder="Search customer, phone, email, device, service, ticket, status…" autocomplete="off"></label><select data-gc-field="sort" aria-label="Sort directory"><option value="checkin_desc" ${s.sort==='checkin_desc'?'selected':''}>Check-in · newest first</option><option value="checkin_asc" ${s.sort==='checkin_asc'?'selected':''}>Check-in · oldest first</option><option value="updated_desc" ${s.sort==='updated_desc'?'selected':''}>Last updated · newest first</option><option value="updated_asc" ${s.sort==='updated_asc'?'selected':''}>Last updated · oldest first</option><option value="name_asc" ${s.sort==='name_asc'?'selected':''}>Customer · A to Z</option><option value="name_desc" ${s.sort==='name_desc'?'selected':''}>Customer · Z to A</option><option value="device_asc" ${s.sort==='device_asc'?'selected':''}>Device · A to Z</option><option value="device_desc" ${s.sort==='device_desc'?'selected':''}>Device · Z to A</option><option value="status_asc" ${s.sort==='status_asc'?'selected':''}>Status · A to Z</option><option value="status_desc" ${s.sort==='status_desc'?'selected':''}>Status · Z to A</option></select></div>
    <div class="gc-dir-presets">${renderPresets(scope)}</div>
    <div class="gc-dir-filter-panel ${s.filtersOpen?'open':''}">${isDashboard?`<fieldset><legend>Record type</legend><label class="gc-dir-check"><input type="checkbox" data-gc-type="work_order" ${s.types.has('work_order')?'checked':''}><span>Work orders</span></label><label class="gc-dir-check"><input type="checkbox" data-gc-type="lead" ${s.types.has('lead')?'checked':''}><span>Leads</span></label></fieldset>`:''}<fieldset class="gc-dir-status-field"><legend>Status</legend><div class="gc-dir-status-list">${renderStatusChecklist(scope)}</div></fieldset><label>Device type<select data-gc-field="device">${selectOptions(optionValues(scope,'deviceType'),s.device,'All device types')}</select></label><label>Assigned to<select data-gc-field="assigned">${selectOptions(optionValues(scope,'assigned'),s.assigned,'Everyone')}</select></label><label>Intake / source<select data-gc-field="intake">${selectOptions(optionValues(scope,'intake'),s.intake,'All intake types')}</select></label><label>Checked in after<input type="date" data-gc-field="from" value="${esc(s.from)}"></label><label>Checked in before<input type="date" data-gc-field="to" value="${esc(s.to)}"></label><label class="gc-dir-check gc-dir-closed"><input type="checkbox" data-gc-field="includeClosed" ${s.includeClosed?'checked':''}><span>Include closed records</span></label><button class="text-button gc-dir-clear" type="button" data-gc-action="clear">Clear filters</button></div>
    <div class="gc-dir-summary" data-gc-summary></div><div class="gc-dir-list" data-gc-results></div>`;
    drawResults(scope);
  }

  function drawResults(scope) {
    const host=ensureHost(scope), results=host?.querySelector('[data-gc-results]'), summary=host?.querySelector('[data-gc-summary]'); if (!results||!summary) return;
    if (state.loading&&!state.loaded) { summary.textContent='Loading live records…'; results.innerHTML='<div class="gc-dir-loading"><span></span><p>Loading GotCracked operations…</p></div>'; return; }
    const filtered=filteredRecords(scope), base=allRecords(scope).filter(record=>state[scope].includeClosed||!isClosed(record)), activeCount=base.filter(record=>!isClosed(record)).length, workOrderCount=filtered.filter(r=>r.type==='work_order').length, leadCount=filtered.filter(r=>r.type==='lead').length;
    summary.innerHTML=`<strong>${filtered.length}</strong> of ${base.length} records shown${scope==='dashboard'?` · ${workOrderCount} work order${workOrderCount===1?'':'s'} · ${leadCount} lead${leadCount===1?'':'s'}`:` · ${activeCount} active`}`;
    if (!filtered.length) { results.innerHTML='<div class="gc-dir-empty"><span>⌕</span><h3>No matching records</h3><p>Adjust the search or filters to broaden this view.</p><button class="secondary-button" type="button" data-gc-action="clear">Clear filters</button></div>'; return; }
    results.innerHTML=`<div class="gc-dir-columns" aria-hidden="true"><span>Record</span><span>Customer</span><span>Device / service</span><span>Status</span><span>Check-in</span><span>Assigned</span><span></span></div>${filtered.map(renderRow).join('')}`;
  }
  function renderRow(record) { const clickAttr=record.type==='work_order'?`data-ticket="${esc(record.ticketNumber)}"`:`data-lead-id="${esc(record.sourceId)}"`; return `<button class="gc-dir-row" type="button" ${clickAttr} data-gc-record="${esc(record.key)}"><span class="gc-dir-record"><b class="gc-dir-type ${record.type}">${typeLabel(record.type)}</b><strong>${esc(record.displayId)}</strong></span><span class="gc-dir-customer"><strong>${esc(record.customer)}</strong><small>${esc(record.phone||record.email||'No contact listed')}</small></span><span class="gc-dir-device"><strong>${esc(record.device)}</strong><small>${esc(record.service)}</small></span><span><b class="status ${statusClass(record)}">${esc(record.statusLabel)}</b></span><span class="gc-dir-time"><strong>${esc(formatDate(record.createdAt))}</strong><small>Updated ${esc(formatDate(record.updatedAt))}</small></span><span class="gc-dir-assigned"><strong>${esc(record.assigned)}</strong><small>${esc(friendly(record.intake))}</small></span><span class="gc-dir-arrow">›</span></button>`; }

  function ensureHost(scope) {
    if (scope==='dashboard') {
      const dashboard=document.querySelector('#dashboard'); if (!dashboard) return null; let host=dashboard.querySelector('#gc-master-directory');
      if (!host) { host=document.createElement('section'); host.id='gc-master-directory'; host.className='card gc-directory'; const metrics=dashboard.querySelector('.metrics'); if (metrics) metrics.insertAdjacentElement('afterend',host); else dashboard.querySelector('.page-heading')?.insertAdjacentElement('afterend',host); }
      dashboard.classList.add('gc-directory-mounted'); const subtitle=dashboard.querySelector('.page-heading .subtle'); if (subtitle) subtitle.textContent='Search and work every active repair and lead from one master operating directory.'; markDashboardMetrics(); return host;
    }
    const leadsView=document.querySelector('#leads'), legacyHost=leadsView?.querySelector('#portal-leads'); if (!leadsView||!legacyHost) return null; const card=legacyHost.closest('.card'); card?.classList.add('gc-leads-directory-card'); const toolbar=card?.querySelector(':scope > .toolbar'); if (toolbar) toolbar.hidden=true; legacyHost.classList.add('gc-directory'); return legacyHost;
  }
  function markDashboardMetrics() { const cards=document.querySelectorAll('#dashboard .metrics article'), openRepairs=cards[0], ready=cards[2]; if (openRepairs) { openRepairs.dataset.gcDirectoryFilter='open_repairs'; openRepairs.setAttribute('aria-label','Filter master directory to open repairs'); openRepairs.title='Filter master directory to open repairs'; } if (ready) { ready.dataset.gcDirectoryFilter='ready'; ready.setAttribute('aria-label','Filter master directory to ready for pickup'); ready.title='Filter master directory to ready for pickup'; } }

  function setPreset(scope,preset) {
    const s=state[scope]; Object.assign(s,{preset,query:'',device:'all',assigned:'all',intake:'all',from:'',to:'',sort:DEFAULT_SORT}); s.types.clear(); s.statuses.clear();
    if (scope==='dashboard') { s.includeClosed=false; if (preset==='attention') ['lead:new','work_order:need_to_order_parts','work_order:awaiting_parts','work_order:awaiting_callback','work_order:awaiting_approval'].forEach(v=>s.statuses.add(v)); if (preset==='new_leads') {s.types.add('lead');s.statuses.add('lead:new');} if (preset==='awaiting_parts') {s.types.add('work_order');['work_order:need_to_order_parts','work_order:awaiting_parts','work_order:waiting_on_parts'].forEach(v=>s.statuses.add(v));} if (preset==='ready') {s.types.add('work_order');['work_order:repaired','work_order:ready_for_pickup'].forEach(v=>s.statuses.add(v));} if (preset==='unassigned') s.assigned='Unassigned'; }
    else { s.includeClosed=['won','lost'].includes(preset); if (['new','claimed','qualified','won','lost'].includes(preset)) s.statuses.add(`lead:${preset}`); if (preset==='unassigned') s.assigned='Unassigned'; }
    persist(scope); renderShell(scope);
  }
  function clearFilters(scope) { state[scope]=baseState(); persist(scope); renderShell(scope); }
  function persist(scope) { try { const s=state[scope]; sessionStorage.setItem(`gc-directory-${scope}`,JSON.stringify({...s,types:[...s.types],statuses:[...s.statuses]})); } catch {} }
  function restore(scope) { try { const raw=sessionStorage.getItem(`gc-directory-${scope}`); if (!raw) return; const saved=JSON.parse(raw), next=baseState(); Object.assign(next,saved); next.types=new Set(Array.isArray(saved.types)?saved.types:[]); next.statuses=new Set(Array.isArray(saved.statuses)?saved.statuses:[]); state[scope]=next; } catch {} }
  function handleField(scope,target) { const s=state[scope], field=target.dataset.gcField; if (!field) return; if (field==='includeClosed') s.includeClosed=target.checked; else s[field]=target.value; if (field!=='sort') s.preset='custom'; persist(scope); if (['query','sort'].includes(field)) drawResults(scope); else renderShell(scope); }
  const scopeFor = target => target.closest('#gc-master-directory') ? 'dashboard' : target.closest('#leads') ? 'leads' : null;

  document.addEventListener('input',event=>{ const target=event.target; if (!(target instanceof HTMLInputElement)) return; const scope=scopeFor(target); if (scope&&target.dataset.gcField==='query') handleField(scope,target); });
  document.addEventListener('change',event=>{ const target=event.target; if (!(target instanceof HTMLElement)) return; const scope=scopeFor(target); if (!scope) return; if (target.matches('[data-gc-field]')) return handleField(scope,target); if (target.matches('[data-gc-type]')) { target.checked?state[scope].types.add(target.dataset.gcType):state[scope].types.delete(target.dataset.gcType); state[scope].preset='custom'; persist(scope); return drawResults(scope); } if (target.matches('[data-gc-status]')) { target.checked?state[scope].statuses.add(target.dataset.gcStatus):state[scope].statuses.delete(target.dataset.gcStatus); state[scope].preset='custom'; persist(scope); drawResults(scope); } });
  document.addEventListener('click',event=>{ const target=event.target instanceof Element?event.target:null; if (!target) return; const metric=target.closest('[data-gc-directory-filter]'); if (metric) { event.preventDefault(); event.stopPropagation(); if (metric.dataset.gcDirectoryFilter==='ready') setPreset('dashboard','ready'); else { setPreset('dashboard','active'); state.dashboard.types.add('work_order'); state.dashboard.preset='open_repairs'; persist('dashboard'); renderShell('dashboard'); } document.querySelector('#gc-master-directory')?.scrollIntoView({behavior:'smooth',block:'start'}); return; } const preset=target.closest('[data-gc-preset]'); if (preset) { const scope=scopeFor(preset); if (scope) setPreset(scope,preset.dataset.gcPreset); return; } const action=target.closest('[data-gc-action]'); if (!action) return; const scope=scopeFor(action); if (!scope) return; if (action.dataset.gcAction==='filters') { state[scope].filtersOpen=!state[scope].filtersOpen; persist(scope); renderShell(scope); } if (action.dataset.gcAction==='clear') clearFilters(scope); if (action.dataset.gcAction==='refresh') requestRefresh(); },true);

  async function load() {
    if (state.loading) return; state.loading=true; renderVisible();
    try {
      const {data:{session}}=await client.auth.getSession(); if (!session) return;
      const [repairs,leads]=await Promise.all([
        client.from('repair_tickets').select('id,ticket_number,status,created_at,updated_at,intake_method,customer_issue,customers(first_name,last_name,phone,email),devices(model,manufacturer,category),profiles:assigned_user_id(display_name)').order('created_at',{ascending:false}).limit(500),
        client.from('leads').select('id,name,phone,email,service,notes,source,status,created_at,updated_at,intake_method,assigned_user_id,profiles:assigned_user_id(display_name)').order('created_at',{ascending:false}).limit(500)
      ]);
      if (repairs.error) throw repairs.error; if (leads.error) throw leads.error; state.data.repairs=repairs.data||[]; state.data.leads=leads.data||[];
      const leadBadge=document.querySelector('#lead-count'); if (leadBadge) { const count=state.data.leads.filter(lead=>!LEAD_TERMINAL.has(lead.status)).length; leadBadge.textContent=String(count); leadBadge.hidden=count===0; }
      state.loaded=true;
    } catch (error) { console.error('GotCracked directory failed to load',error); document.querySelectorAll('.gc-dir-summary').forEach(node=>{node.textContent=`Directory refresh failed: ${error.message||'Unknown error'}`;}); }
    finally { state.loading=false; renderVisible(); }
  }
  function renderVisible() { if (document.querySelector('#dashboard')) renderShell('dashboard'); if (document.querySelector('#leads #portal-leads')) renderShell('leads'); }
  function requestRefresh() { clearTimeout(state.refreshTimer); state.refreshTimer=setTimeout(load,120); }
  restore('dashboard'); restore('leads');
  window.GotCrackedDirectory={version:VERSION,ownsLeadDirectory:true,requestRefresh,render:renderVisible};
  client.auth.onAuthStateChange(event=>{ if (['SIGNED_IN','INITIAL_SESSION','TOKEN_REFRESHED'].includes(event)) requestRefresh(); if (event==='SIGNED_OUT') { state.data={repairs:[],leads:[]}; state.loaded=false; renderVisible(); } });
  const channel=client.channel('gc-master-directory').on('postgres_changes',{event:'*',schema:'public',table:'repair_tickets'},requestRefresh).on('postgres_changes',{event:'*',schema:'public',table:'leads'},requestRefresh).subscribe();
  window.addEventListener('gc-view-changed',()=>requestAnimationFrame(renderVisible));
  window.addEventListener('beforeunload',()=>{try{client.removeChannel(channel);}catch{}},{once:true});
  setTimeout(load,250); setTimeout(renderVisible,900);
})();
