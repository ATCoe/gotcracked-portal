(() => {
  'use strict';
  const client = window.supabaseClient;
  let profile = null;
  let cache = { appointments: [], customers: [], inventory: [], repairs: [], leads: [], staff: [] };
  const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format((cents || 0) / 100);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const friendly = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());

  async function getProfile() {
    const { data: { user } } = await client.auth.getUser();
    if (!user) return null;
    const result = await client.from('profiles').select('*, locations(name,timezone)').eq('id', user.id).single();
    return result.data;
  }

  async function loadData() {
    profile = await getProfile();
    if (!profile) return;
    const canManageStaff = ['owner', 'manager'].includes(profile.role);
    const inviteCard = document.querySelector('#staff .two-col article:first-child');
    if (inviteCard) inviteCard.hidden = !canManageStaff;
    if (profile.role !== 'owner' && !profile.discord_user_id) {
      document.querySelector('[data-view="staff"]')?.click();
      return;
    }
    const [appointments, customers, inventory, repairs, leads, staff] = await Promise.all([
      client.from('appointments').select('*, customers(first_name,last_name,phone)').order('preferred_date').limit(100),
      client.from('customers').select('*, devices(id,model,manufacturer,category), repair_tickets(id,status)').order('created_at', { ascending: false }).limit(300),
      client.from('inventory_items').select('*').eq('active', true).order('name').limit(500),
      client.from('repair_tickets').select('*, customers(first_name,last_name,phone), devices(model,manufacturer), profiles:assigned_user_id(display_name)').order('created_at', { ascending: false }).limit(300),
      client.from('leads').select('*').order('created_at', { ascending: false }).limit(300),
      client.from('profiles').select('id,display_name,role,active').eq('active', true).order('display_name')
    ]);
    cache = { appointments: appointments.data || [], customers: customers.data || [], inventory: inventory.data || [], repairs: repairs.data || [], leads: leads.data || [], staff: staff.data || [] };
    renderAll();
  }

  function renderDashboard() {
    const open = cache.repairs.filter(ticket => !['completed', 'cancelled'].includes(ticket.status));
    const today = new Date().toISOString().slice(0, 10);
    const todayAppointments = cache.appointments.filter(item => item.preferred_date === today || item.starts_at?.startsWith(today));
    const ready = cache.repairs.filter(ticket => ticket.status === 'ready_for_pickup');
    const completedToday = cache.repairs.filter(ticket => ticket.status === 'completed' && ticket.completed_at?.startsWith(today));
    const sales = completedToday.reduce((sum, ticket) => sum + (ticket.estimate_cents || 0), 0);
    const values = document.querySelectorAll('.metrics article strong');
    [open.length, todayAppointments.length, ready.length, money(sales)].forEach((value, index) => { if (values[index]) values[index].textContent = value; });
    const count = document.querySelector('#repair-count'); if (count) count.textContent = open.length;
    const greeting = document.querySelector('#dashboard .page-heading h1');
    if (greeting) greeting.textContent = `Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, ${profile.display_name.split(' ')[0]}.`;
    const date = document.querySelector('#dashboard .page-heading .eyebrow');
    if (date) date.textContent = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
    const location = document.querySelector('.location'); if (location) location.innerHTML = `<span class="status-dot"></span> ${esc(profile.locations?.name || 'GotCracked')}`;

    const scheduleCard = document.querySelector('#dashboard .right-column .card:first-child');
    if (scheduleCard) scheduleCard.innerHTML = `<div class="card-title"><div><h2>Upcoming schedule</h2><p>Live appointment requests</p></div><a href="#appointments" data-view="appointments">Calendar →</a></div>${cache.appointments.slice(0, 4).map(item => `<div class="schedule-item"><time>${esc(item.preferred_date || 'TBD')}</time><div><strong>${esc(item.customers ? `${item.customers.first_name} ${item.customers.last_name}` : 'New request')}</strong><p>${esc(item.service_requested)}</p></div><span class="tag confirmed">${esc(friendly(item.status))}</span></div>`).join('') || '<p class="empty-state">No upcoming appointments.</p>'}`;
    const attention = document.querySelector('#dashboard .attention');
    if (attention) {
      const low = cache.inventory.filter(item => item.quantity_on_hand <= item.reorder_point);
      const approvals = cache.repairs.filter(item => item.status === 'awaiting_approval');
      const newLeads = cache.leads.filter(item => item.status === 'new');
      attention.innerHTML = `<div class="card-title"><div><h2>Needs attention</h2><p>Live operating alerts</p></div></div><button class="attention-item"><span class="warning">!</span><span><strong>${low.length} parts need reorder</strong><small>Review Inventory</small></span></button><button class="attention-item"><span class="warning">!</span><span><strong>${approvals.length} estimates await approval</strong><small>Review Repairs</small></span></button><button class="attention-item"><span class="warning">!</span><span><strong>${newLeads.length} unclaimed leads</strong><small>Review Leads</small></span></button>`;
    }
  }

  function renderAppointments() {
    const host = document.querySelector('#appointments');
    host.innerHTML = `<div class="page-heading"><div><p class="eyebrow">Scheduling</p><h1>Appointments</h1><p class="subtle">Live requests and confirmed shop visits.</p></div></div><article class="card"><div class="card-title"><div><h2>Appointment queue</h2><p>${cache.appointments.length} records</p></div></div>${cache.appointments.map(item => `<div class="list-row"><span class="metric-icon blue">◷</span><div class="row-main"><strong>${esc(item.preferred_date || 'Date TBD')} · ${esc(item.preferred_time || 'Time TBD')}</strong><small>${esc(item.service_requested)} · ${esc(item.device_description || '')}</small></div><span class="tag confirmed">${esc(friendly(item.status))}</span></div>`).join('') || '<p class="empty-state">No appointment requests yet.</p>'}</article>`;
  }

  function renderCustomers() {
    const host = document.querySelector('#customers');
    host.innerHTML = `<div class="page-heading"><div><p class="eyebrow">Relationships</p><h1>Customers</h1><p class="subtle">Live customer, device, and repair history.</p></div><button class="primary-button" data-live-action="customer">+ New customer</button></div><div class="card"><div class="toolbar"><div class="search">⌕ <input id="live-customer-search" placeholder="Search name, phone, or device"></div></div><div id="live-customer-list"></div></div>`;
    const draw = query => {
      const filtered = cache.customers.filter(item => JSON.stringify(item).toLowerCase().includes(query.toLowerCase()));
      document.querySelector('#live-customer-list').innerHTML = filtered.map(customer => `<div class="list-row"><div class="avatar">${esc(customer.first_name[0])}${esc(customer.last_name[0])}</div><div class="row-main"><strong>${esc(customer.first_name)} ${esc(customer.last_name)}</strong><small>${esc(customer.phone)} · ${customer.devices?.map(device => `${device.manufacturer || ''} ${device.model}`).join(', ') || 'No devices'}</small></div><small>${customer.repair_tickets?.length || 0} repairs</small></div>`).join('') || '<p class="empty-state">No customers found.</p>';
    };
    draw(''); document.querySelector('#live-customer-search').oninput = event => draw(event.target.value);
  }

  function renderInventory() {
    const host = document.querySelector('#inventory');
    host.innerHTML = `<div class="page-heading"><div><p class="eyebrow">Parts & supplies</p><h1>Inventory</h1><p class="subtle">Live stock, reorder points, cost, and retail value.</p></div><button class="primary-button" data-live-action="inventory">+ Add part</button></div><article class="card"><div class="table-wrap"><table><thead><tr><th>Part</th><th>SKU</th><th>On hand</th><th>Reorder at</th><th>Cost</th><th>Retail</th></tr></thead><tbody>${cache.inventory.map(item => `<tr><td><strong>${esc(item.name)}</strong></td><td>${esc(item.sku || '—')}</td><td class="${item.quantity_on_hand <= item.reorder_point ? 'low-stock' : ''}">${item.quantity_on_hand}</td><td>${item.reorder_point}</td><td>${money(item.cost_cents)}</td><td>${money(item.sell_price_cents)}</td></tr>`).join('')}</tbody></table></div>${cache.inventory.length ? '' : '<p class="empty-state">No inventory items yet.</p>'}</article>`;
  }

  function renderReports() {
    const host = document.querySelector('#reports');
    const completed = cache.repairs.filter(item => item.status === 'completed');
    const revenue = completed.reduce((sum, item) => sum + (item.estimate_cents || 0), 0);
    const won = cache.leads.filter(item => item.status === 'won').length;
    const conversion = cache.leads.length ? Math.round(won / cache.leads.length * 100) : 0;
    host.innerHTML = `<div class="page-heading"><div><p class="eyebrow">Business intelligence</p><h1>Reports</h1><p class="subtle">Calculated from live shop records.</p></div></div><div class="module-grid"><article class="card module-stat"><p>Recorded repair value</p><strong>${money(revenue)}</strong><small>${completed.length} completed repairs</small></article><article class="card module-stat"><p>Open repairs</p><strong>${cache.repairs.filter(item => !['completed','cancelled'].includes(item.status)).length}</strong><small>Current workload</small></article><article class="card module-stat"><p>Lead conversion</p><strong>${conversion}%</strong><small>${won} won of ${cache.leads.length}</small></article></div>`;
  }

  function renderSettings() {
    const host = document.querySelector('#settings');
    host.innerHTML = `<div class="page-heading"><div><p class="eyebrow">Portal configuration</p><h1>Settings</h1><p class="subtle">Current account and operational defaults.</p></div></div><div class="two-col"><article class="card"><h2>Shop</h2><div class="settings-list"><label>Location <span>${esc(profile.locations?.name || 'Not assigned')}</span></label><label>Timezone <span>${esc(profile.locations?.timezone || 'America/New_York')}</span></label></div></article><article class="card"><h2>Access</h2><div class="settings-list"><label>Role <span>${esc(friendly(profile.role))}</span></label><label>Discord <span>${profile.discord_user_id ? 'Linked' : 'Not linked'}</span></label></div></article></div>`;
  }

  function renderAll() { renderDashboard(); renderAppointments(); renderCustomers(); renderInventory(); renderReports(); renderSettings(); }

  async function createRepair(event) {
    event.preventDefault();
    const form = event.currentTarget, data = Object.fromEntries(new FormData(form));
    const names = String(data.customer).trim().split(/\s+/); const lastName = names.length > 1 ? names.pop() : 'Customer'; const firstName = names.join(' ');
    const customerResult = await client.from('customers').upsert({ location_id: profile.location_id, first_name: firstName, last_name: lastName, phone: data.phone }, { onConflict: 'location_id,phone' }).select().single();
    if (customerResult.error) return alert(customerResult.error.message);
    const deviceResult = await client.from('devices').insert({ customer_id: customerResult.data.id, category: 'Device', model: data.device }).select().single();
    if (deviceResult.error) return alert(deviceResult.error.message);
    const ticketResult = await client.from('repair_tickets').insert({ location_id: profile.location_id, customer_id: customerResult.data.id, device_id: deviceResult.data.id, customer_issue: data.issue || data.service, status: 'checked_in' }).select().single();
    if (ticketResult.error) return alert(ticketResult.error.message);
    form.closest('dialog').close(); form.reset(); await loadData();
  }

  function openOperation(kind, record = null) {
    const dialog = document.querySelector('#operation-dialog');
    const content = document.querySelector('#operation-dialog-content');
    const head = (eyebrow, title) => `<div class="modal-head"><div><p class="eyebrow">${eyebrow}</p><h2>${title}</h2></div><button class="icon-button" type="button" data-close-operation aria-label="Close">×</button></div>`;
    if (kind === 'customer') content.innerHTML = `${head('Customer record','Add customer')}<input type="hidden" name="kind" value="customer"><div class="form-grid"><label>First name<input name="first_name" required></label><label>Last name<input name="last_name" required></label><label>Phone<input name="phone" required inputmode="tel"></label><label>Email<input name="email" type="email"></label></div><p class="operation-status"></p><div class="modal-actions"><button type="button" class="secondary-button" data-close-operation>Cancel</button><button class="primary-button">Save customer</button></div>`;
    if (kind === 'inventory') content.innerHTML = `${head('Parts & supplies','Add inventory item')}<input type="hidden" name="kind" value="inventory"><div class="form-grid"><label>Part name<input name="name" required></label><label>SKU<input name="sku"></label><label>Quantity on hand<input name="quantity_on_hand" type="number" min="0" value="0" required></label><label>Reorder point<input name="reorder_point" type="number" min="0" value="0" required></label><label>Unit cost<input name="cost" type="number" min="0" step="0.01" value="0"></label><label>Retail price<input name="price" type="number" min="0" step="0.01" value="0"></label></div><p class="operation-status"></p><div class="modal-actions"><button type="button" class="secondary-button" data-close-operation>Cancel</button><button class="primary-button">Save item</button></div>`;
    if (kind === 'repair' && record) content.innerHTML = `${head(record.ticket_number,'Update repair')}<input type="hidden" name="kind" value="repair"><input type="hidden" name="id" value="${record.id}"><div class="form-grid"><label>Status<select name="status">${['checked_in','in_diagnosis','awaiting_approval','waiting_on_parts','in_repair','ready_for_pickup','completed','cancelled'].map(value => `<option value="${value}" ${record.status === value ? 'selected' : ''}>${friendly(value)}</option>`).join('')}</select></label><label>Assigned to<select name="assigned_user_id"><option value="">Unassigned</option>${cache.staff.map(item => `<option value="${item.id}" ${record.assigned_user_id === item.id ? 'selected' : ''}>${esc(item.display_name)}</option>`).join('')}</select></label><label>Estimate<input name="estimate" type="number" min="0" step="0.01" value="${((record.estimate_cents || 0)/100).toFixed(2)}"></label><label>Priority<select name="priority">${['normal','high','urgent'].map(value => `<option ${record.priority === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label><label class="full">Customer-visible note<textarea name="public_notes">${esc(record.public_notes || '')}</textarea></label><label class="full">Internal notes<textarea name="internal_notes">${esc(record.internal_notes || '')}</textarea></label></div><p class="operation-status"></p><div class="modal-actions"><button type="button" class="secondary-button" data-close-operation>Cancel</button><button class="primary-button">Save repair</button></div>`;
    dialog.showModal();
  }

  async function saveOperation(event) {
    event.preventDefault();
    const form = event.currentTarget, data = Object.fromEntries(new FormData(form));
    const button = form.querySelector('button.primary-button'); const status = form.querySelector('.operation-status');
    button.disabled = true; status.textContent = '';
    let result;
    if (data.kind === 'customer') result = await client.from('customers').insert({ location_id: profile.location_id, first_name: data.first_name.trim(), last_name: data.last_name.trim(), phone: data.phone.trim(), email: data.email.trim() || null });
    if (data.kind === 'inventory') result = await client.from('inventory_items').insert({ location_id: profile.location_id, name: data.name.trim(), sku: data.sku.trim() || null, quantity_on_hand: Number(data.quantity_on_hand), reorder_point: Number(data.reorder_point), cost_cents: Math.round(Number(data.cost || 0) * 100), sell_price_cents: Math.round(Number(data.price || 0) * 100) });
    if (data.kind === 'repair') result = await client.from('repair_tickets').update({ status: data.status, assigned_user_id: data.assigned_user_id || null, estimate_cents: Math.round(Number(data.estimate || 0) * 100), priority: data.priority, public_notes: data.public_notes.trim() || null, internal_notes: data.internal_notes.trim() || null }).eq('id', data.id);
    if (result?.error) { status.textContent = result.error.message; button.disabled = false; return; }
    form.closest('dialog').close(); form.reset(); await loadData();
  }

  document.querySelector('#ticket-form')?.addEventListener('submit', createRepair);
  document.querySelector('#operation-form')?.addEventListener('submit', saveOperation);
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-live-action]'); if (button) openOperation(button.dataset.liveAction);
    if (event.target.closest('[data-close-operation]')) document.querySelector('#operation-dialog')?.close();
    const repairRow = event.target.closest('[data-ticket]');
    if (repairRow) { const repair = cache.repairs.find(item => String(item.ticket_number) === repairRow.dataset.ticket); if (repair) { event.preventDefault(); event.stopImmediatePropagation(); openOperation('repair', repair); } }
  }, true);
  client.auth.onAuthStateChange(event => { if (['SIGNED_IN','INITIAL_SESSION'].includes(event)) setTimeout(loadData, 0); });
  setTimeout(loadData, 700);
  client.channel('portal-live').on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, loadData).on('postgres_changes', { event: '*', schema: 'public', table: 'repair_tickets' }, loadData).on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, loadData).subscribe();
})();
