(() => {
  'use strict';
  const client = window.supabaseClient;
  let profile = null;
  let cache = { appointments: [], customers: [], inventory: [], inventoryLoss: [], repairs: [], leads: [], staff: [], services: [], suppliers: [], promos: [], media: [], settings: null };
  const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format((cents || 0) / 100);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const friendly = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
  const mediaIdFromUrl = value => { try { const url = new URL(value); return url.searchParams.get('v') || url.pathname.split('/').filter(Boolean).pop() || crypto.randomUUID(); } catch { return crypto.randomUUID(); } };
  const REPAIR_STATUS_LABELS = {
    checked_in: 'Checked in (legacy)', in_diagnosis: 'In diagnosis (legacy)', awaiting_approval: 'Awaiting approval (legacy)', waiting_on_parts: 'Waiting on parts (legacy)', in_repair: 'In repair (legacy)', ready_for_pickup: 'Ready for pickup (legacy)', completed: 'Completed (legacy)',
    awaiting_repair: 'Awaiting Repair', need_to_order_parts: 'Need to Order Parts', awaiting_parts: 'Awaiting Parts', diagnostic_in_progress: 'Diagnostic in Progress', repair_in_progress: 'Repair in Progress', quality_inspection: 'Quality Inspection', awaiting_callback: 'Awaiting Callback', repaired: 'Repaired – Ready for Pickup', sale_complete: 'Sale Complete', abandoned: 'Abandoned', unrepairable: 'Unrepairable', customer_declined: 'Customer Declined', cancelled: 'Cancelled'
  };
  const REPAIR_TRANSITIONS = {
    checked_in: ['awaiting_repair','need_to_order_parts','awaiting_parts','awaiting_callback','unrepairable','customer_declined','cancelled'],
    awaiting_approval: ['awaiting_repair','need_to_order_parts','awaiting_parts','awaiting_callback','unrepairable','customer_declined','cancelled'],
    waiting_on_parts: ['awaiting_parts','diagnostic_in_progress','repair_in_progress','awaiting_callback','unrepairable','customer_declined','cancelled'],
    in_diagnosis: ['diagnostic_in_progress','need_to_order_parts','awaiting_parts','quality_inspection','awaiting_callback','unrepairable','customer_declined','cancelled'],
    in_repair: ['repair_in_progress','need_to_order_parts','awaiting_parts','quality_inspection','awaiting_callback','unrepairable','customer_declined','cancelled'],
    ready_for_pickup: ['repaired','unrepairable','customer_declined','cancelled'],
    awaiting_repair: ['need_to_order_parts','awaiting_parts','diagnostic_in_progress','repair_in_progress','awaiting_callback','unrepairable','customer_declined','cancelled'],
    need_to_order_parts: ['awaiting_parts','awaiting_callback','unrepairable','customer_declined','cancelled'],
    awaiting_parts: ['diagnostic_in_progress','repair_in_progress','awaiting_callback','unrepairable','customer_declined','cancelled'],
    diagnostic_in_progress: ['need_to_order_parts','awaiting_parts','repair_in_progress','quality_inspection','awaiting_callback','unrepairable','customer_declined','cancelled'],
    repair_in_progress: ['need_to_order_parts','awaiting_parts','quality_inspection','awaiting_callback','unrepairable','customer_declined','cancelled'],
    quality_inspection: ['diagnostic_in_progress','repair_in_progress','repaired','awaiting_callback','unrepairable','customer_declined','cancelled'],
    repaired: ['sale_complete'], sale_complete: [], abandoned: [], unrepairable: [], customer_declined: [], completed: [], cancelled: []
  };
  const statusLabel = value => REPAIR_STATUS_LABELS[value] || friendly(value);
  const terminalStatuses = new Set(['sale_complete','abandoned','unrepairable','customer_declined','completed','cancelled']);
  function allowedRepairStatuses(record) {
    if (record.status === 'awaiting_callback') return [record.status, record.status_before_callback, 'unrepairable', 'customer_declined', 'cancelled'].filter(Boolean);
    const values = [record.status, ...(REPAIR_TRANSITIONS[record.status] || [])];
    if (record.status === 'repaired' && ['owner','manager'].includes(profile?.role)) {
      const days = cache.settings?.abandoned_after_days ?? 30;
      const readyAt = new Date(record.ready_for_pickup_at || record.updated_at || record.created_at).getTime();
      if (Date.now() >= readyAt + days * 86400000) values.push('abandoned');
    }
    return values;
  }

  function code39Svg(value) {
    const patterns = { '0':0x034,'1':0x121,'2':0x061,'3':0x160,'4':0x031,'5':0x130,'6':0x070,'7':0x025,'8':0x124,'9':0x064,A:0x109,B:0x049,C:0x148,D:0x019,E:0x118,F:0x058,G:0x00d,H:0x10c,I:0x04c,J:0x01c,K:0x103,L:0x043,M:0x142,N:0x013,O:0x112,P:0x052,Q:0x007,R:0x106,S:0x046,T:0x016,U:0x181,V:0x0c1,W:0x1c0,X:0x091,Y:0x190,Z:0x0d0,'-':0x085,'.':0x184,' ':0x0c4,'$':0x0a8,'/':0x0a2,'+':0x08a,'%':0x02a,'*':0x094 };
    const clean = String(value || 'UNASSIGNED').toUpperCase().replace(/[^0-9A-Z. $/+%\-]/g, '-').slice(0, 32);
    let x = 0, bars = '';
    for (const char of `*${clean}*`) {
      const pattern = patterns[char] ?? patterns['-'];
      for (let index = 0; index < 9; index += 1) {
        const width = pattern & (1 << (8 - index)) ? 3 : 1;
        if (index % 2 === 0) bars += `<rect x="${x}" y="0" width="${width}" height="34"/>`;
        x += width;
      }
      x += 1;
    }
    return `<svg viewBox="0 0 ${x} 34" preserveAspectRatio="none" role="img" aria-label="Barcode ${esc(clean)}">${bars}</svg>`;
  }

  function printDymoLabel({ title, subtitle = '', code = '', price = '', phone = '' }) {
    const template = cache.settings?.label_template || '30252';
    const sizes = { '30252': ['3.5in', '1.125in'], '30336': ['2.125in', '1in'], '30334': ['2.25in', '1.25in'] };
    const [width, height] = sizes[template] || sizes['30252'];
    const showPrice = cache.settings?.label_show_price !== false;
    const showPhone = cache.settings?.label_show_customer_phone === true;
    const popup = window.open('', '_blank', 'width=720,height=460');
    if (!popup) return alert('Allow pop-ups for the Portal to print labels.');
    popup.document.write(`<!doctype html><html><head><title>GotCracked label</title><style>
      @page{size:${width} ${height};margin:0}*{box-sizing:border-box}body{margin:0;width:${width};height:${height};font-family:Arial,sans-serif;color:#06101f}
      .label{width:100%;height:100%;padding:.08in .12in;display:grid;grid-template-columns:.72in 1fr;gap:.09in;align-items:center;overflow:hidden}
      img{width:.68in;height:.68in;object-fit:contain}.copy{min-width:0}h1{font-size:14pt;line-height:1;margin:0 0 3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      p{font-size:8pt;line-height:1.15;margin:2px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.code{font:700 10pt Consolas,monospace;letter-spacing:.08em;border-top:1px solid #111;padding-top:3px;margin-top:4px}
      .meta{display:flex;justify-content:space-between;gap:8px;font-weight:700}.brand{font-size:6.5pt;color:#31506f;text-transform:uppercase;letter-spacing:.08em}.barcode{height:.30in;margin-top:2px}.barcode svg{display:block;width:100%;height:100%;fill:#000}.barcode-text{font:700 6.5pt Consolas,monospace;text-align:center;letter-spacing:.08em;margin-top:0}
    </style></head><body><section class="label"><img src="${new URL('assets/gotcracked-mark.png', location.href)}" alt=""><div class="copy"><div class="brand">GotCracked · We fix what life cracks</div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p>${code ? `<div class="barcode">${code39Svg(code)}</div><div class="barcode-text">${esc(code)}</div>` : ''}<div class="meta">${showPrice && price ? `<span>${esc(price)}</span>` : '<span></span>'}</div>${showPhone && phone ? `<p>${esc(phone)}</p>` : ''}</div></section><script>addEventListener('load',()=>setTimeout(()=>print(),250));<\/script></body></html>`);
    popup.document.close();
  }

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
    const [appointments, customers, inventory, inventoryLoss, repairs, leads, staff, services, suppliers, promos, media, settings] = await Promise.all([
      client.from('appointments').select('*, customers(first_name,last_name,phone)').order('preferred_date').limit(100),
      client.from('customers').select('*, devices(id,model,manufacturer,category,color,serial_number,imei,device_notes,last_seen_at), repair_tickets(id,ticket_number,status,customer_issue,total_cents,created_at,device_id,devices(model,manufacturer))').order('created_at', { ascending: false }).limit(300),
      client.from('inventory_items').select('*').eq('active', true).order('name').limit(500),
      client.from('inventory_transactions').select('*, inventory_items(name,sku), profiles:actor_user_id(display_name)').eq('transaction_type', 'write_off').order('created_at', { ascending: false }).limit(100),
      client.from('repair_tickets').select('*, customers(first_name,last_name,phone,email), devices(model,manufacturer), profiles:assigned_user_id(display_name), work_order_items(*), ticket_events(*, actor:actor_user_id(display_name))').order('created_at', { ascending: false }).limit(300),
      client.from('leads').select('*').order('created_at', { ascending: false }).limit(300),
      canManageStaff ? client.functions.invoke('manage-staff', { body: { action: 'list' } }) : Promise.resolve({ data: { staff: [profile] } }),
      client.from('services').select('*').eq('active', true).order('name'),
      client.from('suppliers').select('*').eq('active', true).order('name'),
      client.from('promo_codes').select('*').order('created_at', { ascending: false }),
      client.from('media_posts').select('*').order('published_at', { ascending: false }),
      client.from('business_settings').select('*').eq('location_id', profile.location_id).maybeSingle()
    ]);
    cache = { appointments: appointments.data || [], customers: customers.data || [], inventory: inventory.data || [], inventoryLoss: inventoryLoss.data || [], repairs: repairs.data || [], leads: leads.data || [], staff: staff.data?.staff || [], services: services.data || [], suppliers: suppliers.data || [], promos: promos.data || [], media: media.data || [], settings: settings.data || null };
    renderAll();
  }

  function renderDashboard() {
    const open = cache.repairs.filter(ticket => !terminalStatuses.has(ticket.status));
    const today = new Date().toISOString().slice(0, 10);
    const todayAppointments = cache.appointments.filter(item => item.preferred_date === today || item.starts_at?.startsWith(today));
    const ready = cache.repairs.filter(ticket => ['repaired','ready_for_pickup'].includes(ticket.status));
    const completedToday = cache.repairs.filter(ticket => ['sale_complete','completed'].includes(ticket.status) && (ticket.completed_at || ticket.updated_at)?.startsWith(today));
    const sales = completedToday.reduce((sum, ticket) => sum + (ticket.total_cents || ticket.estimate_cents || 0), 0);
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
    host.innerHTML = `<div class="page-heading"><div><p class="eyebrow">Relationships</p><h1>Customers</h1><p class="subtle">Search by name, phone, email, or device and open the complete repair history.</p></div><button class="primary-button" data-live-action="customer">+ New customer</button></div><div class="card"><div class="toolbar"><div class="search">⌕ <input id="live-customer-search" placeholder="Search name, phone, email, or device"></div></div><div id="live-customer-list"></div></div>`;
    const draw = query => {
      const filtered = cache.customers.filter(item => JSON.stringify(item).toLowerCase().includes(query.toLowerCase()));
      document.querySelector('#live-customer-list').innerHTML = filtered.map(customer => `<button class="list-row customer-row" data-customer-id="${customer.id}"><div class="avatar">${esc(customer.first_name[0])}${esc(customer.last_name[0])}</div><div class="row-main"><strong>${esc(customer.first_name)} ${esc(customer.last_name)}</strong><small>${esc(customer.phone)}${customer.email ? ` · ${esc(customer.email)}` : ''} · ${customer.devices?.map(device => `${device.manufacturer || ''} ${device.model}`).join(', ') || 'No devices'}</small></div><small>${customer.repair_tickets?.length || 0} repairs</small><em>›</em></button>`).join('') || '<p class="empty-state">No customers found.</p>';
    };
    draw(''); document.querySelector('#live-customer-search').oninput = event => draw(event.target.value);
  }

  function renderInventory() {
    const host = document.querySelector('#inventory');
    host.innerHTML = `<div class="page-heading"><div><p class="eyebrow">Catalog & stock</p><h1>Inventory</h1><p class="subtle">Parts, services, prices, reorder points, suppliers, automatic SKUs, and accountable loss reporting.</p></div><div class="quick-actions"><button class="primary-button" data-live-action="inventory">+ Add part</button><button class="secondary-button" data-live-action="service">+ Add service</button></div></div><div class="section-tabs"><button class="active" data-catalog-tab="parts">Parts (${cache.inventory.length})</button><button data-catalog-tab="services">Services (${cache.services.length})</button></div><article class="card" id="parts-catalog"><div class="table-wrap"><table><thead><tr><th>Part</th><th>SKU</th><th>On hand</th><th>Reorder</th><th>Cost</th><th>Price</th><th>Supplier</th><th></th></tr></thead><tbody>${cache.inventory.map(item => `<tr><td><strong>${esc(item.name)}</strong><small>${esc(item.category || '')}</small></td><td>${esc(item.sku || 'Auto')}</td><td class="${item.quantity_on_hand <= item.reorder_point ? 'low-stock' : ''}">${item.quantity_on_hand}</td><td>${item.reorder_point}</td><td>${money(item.cost_cents)}</td><td>${money(item.sell_price_cents)}</td><td>${esc(item.supplier_name || '—')}</td><td><button class="text-button" data-print-part="${item.id}">Label</button> <button class="text-button" data-adjust-part="${item.id}">Adjust</button> <button class="text-button loss-action" data-loss-part="${item.id}">Damage / loss</button> <button class="text-button" data-edit-part="${item.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>${cache.inventory.length ? '' : '<p class="empty-state">No parts yet.</p>'}</article><article class="card" id="services-catalog" hidden><div class="table-wrap"><table><thead><tr><th>Service</th><th>SKU</th><th>Category</th><th>Cost</th><th>Price</th><th>Taxable</th><th></th></tr></thead><tbody>${cache.services.map(item => `<tr><td><strong>${esc(item.name)}</strong><small>${esc(item.description || '')}</small></td><td>${esc(item.sku)}</td><td>${esc(item.category || '—')}</td><td>${money(item.cost_cents)}</td><td>${money(item.price_cents)}</td><td>${item.taxable ? 'Yes' : 'No'}</td><td><button class="text-button" data-edit-service="${item.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>${cache.services.length ? '' : '<p class="empty-state">No services yet. Add diagnostics, cleaning, labor, or other billable work.</p>'}</article><article class="card inventory-loss-card"><div class="card-title"><div><h2>Recent inventory loss</h2><p>Manager-approved write-offs at recorded unit cost.</p></div><strong>${money(cache.inventoryLoss.reduce((sum,item)=>sum+(item.loss_amount_cents||0),0))}</strong></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Item</th><th>Reason</th><th>Qty</th><th>Loss</th><th>Reported by</th></tr></thead><tbody>${cache.inventoryLoss.slice(0,20).map(item=>`<tr><td>${new Date(item.created_at).toLocaleDateString()}</td><td><strong>${esc(item.inventory_items?.name||'Inventory item')}</strong><small>${esc(item.inventory_items?.sku||'')}</small></td><td>${esc(friendly(item.loss_category))}<small>${esc(item.note||'')}</small></td><td>${Math.abs(item.quantity_delta)}</td><td>${money(item.loss_amount_cents)}</td><td>${esc(item.profiles?.display_name||'Staff')}</td></tr>`).join('')||'<tr><td colspan="6">No inventory losses reported.</td></tr>'}</tbody></table></div></article>`;
  }

  function renderReports() {
    const host = document.querySelector('#reports');
    const completed = cache.repairs.filter(item => ['sale_complete','completed'].includes(item.status));
    const onShelf = cache.repairs.filter(item => ['repaired','ready_for_pickup'].includes(item.status));
    const revenue = completed.reduce((sum, item) => sum + (item.total_cents || item.estimate_cents || 0), 0);
    const shelfRevenue = onShelf.reduce((sum, item) => sum + (item.total_cents || item.estimate_cents || 0), 0);
    const won = cache.leads.filter(item => item.status === 'won').length;
    const conversion = cache.leads.length ? Math.round(won / cache.leads.length * 100) : 0;
    const sold = new Map(); cache.repairs.flatMap(item => item.work_order_items || []).filter(item => item.item_type === 'part').forEach(item => sold.set(item.description, (sold.get(item.description) || 0) + Number(item.quantity)));
    const topParts = [...sold.entries()].sort((a,b) => b[1]-a[1]).slice(0,8);
    host.innerHTML = `<div class="page-heading"><div><p class="eyebrow">Business intelligence</p><h1>Reports</h1><p class="subtle">Calculated from live shop records and work-order line items.</p></div></div><div class="module-grid"><article class="card module-stat"><p>Recognized sales</p><strong>${money(revenue)}</strong><small>${completed.length} paid, completed repairs</small></article><article class="card module-stat shelf-revenue"><p>Revenue on shelf</p><strong>${money(shelfRevenue)}</strong><small>${onShelf.length} repaired devices awaiting pickup</small></article><article class="card module-stat"><p>Open repairs</p><strong>${cache.repairs.filter(item => !terminalStatuses.has(item.status)).length}</strong><small>Current workload</small></article><article class="card module-stat"><p>Lead conversion</p><strong>${conversion}%</strong><small>${won} won of ${cache.leads.length}</small></article></div><article class="card"><div class="card-title"><div><h2>Most-used repair parts</h2><p>Quantity added to work orders</p></div></div>${topParts.map(([name,quantity]) => `<div class="list-row"><span class="metric-icon blue">▤</span><div class="row-main"><strong>${esc(name)}</strong><small>Work-order consumption</small></div><strong>${quantity}</strong></div>`).join('') || '<p class="empty-state">Part usage analytics will appear as work orders are built.</p>'}</article>`;
  }

  function renderSettings() {
    const host = document.querySelector('#settings');
    const checked = value => value !== false ? 'checked' : '';
    host.innerHTML = `<div class="page-heading"><div><p class="eyebrow">Portal configuration</p><h1>Settings</h1><p class="subtle">Control pricing, work orders, catalog behavior, promotions, purchasing, media, and access.</p></div></div><div class="two-col">
      <article class="card"><h2>Shop & pricing</h2><form id="business-settings-form" class="settings-list"><label>Location <span>${esc(profile.locations?.name || 'Not assigned')}</span></label><label>Timezone <span>${esc(profile.locations?.timezone || 'America/New_York')}</span></label><label>Currency<select name="currency_code"><option value="USD" selected>USD — US dollar</option></select></label><label>Sales tax rate <small>Enter 0.07 for 7%</small><input name="sales_tax_rate" type="number" min="0" max="1" step="0.0001" value="${cache.settings?.sales_tax_rate ?? 0}"></label><label>Default retail markup (%)<input name="default_markup_percent" type="number" min="0" step="0.01" value="${cache.settings?.default_markup_percent ?? 50}"></label><label>Eligible repair warranty (months)<input name="warranty_months" type="number" min="0" max="60" step="1" value="${cache.settings?.warranty_months ?? 6}"></label><button class="primary-button">Save shop settings</button><p class="auth-message" role="status"></p></form></article>
      <article class="card"><h2>Work-order controls</h2><form id="work-order-settings-form" class="settings-list"><label class="toggle-row"><span>Managers may override prices<small>Owners always retain administrative access.</small></span><input name="allow_manager_price_overrides" type="checkbox" ${checked(cache.settings?.allow_manager_price_overrides)}></label><label class="toggle-row"><span>Managers may add manual discounts</span><input name="allow_manager_manual_discounts" type="checkbox" ${checked(cache.settings?.allow_manager_manual_discounts)}></label><label class="toggle-row"><span>Require a discount reason</span><input name="require_discount_reason" type="checkbox" ${checked(cache.settings?.require_discount_reason)}></label><label class="toggle-row"><span>Consume inventory when a part is added</span><input name="consume_inventory_on_add" type="checkbox" ${checked(cache.settings?.consume_inventory_on_add)}></label><button class="primary-button">Save work-order controls</button><p class="auth-message" role="status"></p></form></article>
      <article class="card"><div class="card-title"><div><h2>Promo codes</h2><p>Create fixed or percentage discounts.</p></div><button class="primary-button" data-live-action="promo">+ New promo</button></div>${cache.promos.map(p => `<div class="list-row"><div class="row-main"><strong>${esc(p.code)}</strong><small>${p.discount_type === 'percent' ? `${p.discount_value}% off` : `${money(Math.round(p.discount_value * 100))} off`} · used ${p.times_used}${p.usage_limit ? `/${p.usage_limit}` : ''}</small></div><span class="tag ${p.active ? 'confirmed' : ''}">${p.active ? 'Active' : 'Inactive'}</span><button class="secondary-button" data-edit-promo="${p.id}">Edit</button></div>`).join('') || '<p class="empty-state">No promo codes yet.</p>'}</article>
      <article class="card"><h2>Inventory defaults</h2><form id="inventory-settings-form" class="settings-list"><label>Part SKU prefix<input name="part_sku_prefix" maxlength="12" value="${esc(cache.settings?.part_sku_prefix || 'PART')}"></label><label>Service SKU prefix<input name="service_sku_prefix" maxlength="12" value="${esc(cache.settings?.service_sku_prefix || 'SVC')}"></label><label>Default reorder point<input name="default_reorder_point" type="number" min="0" step="1" value="${cache.settings?.default_reorder_point ?? 2}"></label><button class="primary-button">Save inventory defaults</button><p class="auth-message" role="status"></p></form><div class="quick-actions"><button class="secondary-button" data-live-action="inventory">Add part</button><button class="secondary-button" data-live-action="service">Add service</button></div><div class="settings-list"><label>Active parts <span>${cache.inventory.length}</span></label><label>Active services <span>${cache.services.length}</span></label><label>Below reorder point <span>${cache.inventory.filter(i => i.quantity_on_hand <= i.reorder_point).length}</span></label></div></article>
      <article class="card"><h2>Ordering & suppliers</h2><p class="subtle">Supplier ordering links and account integrations.</p>${cache.suppliers.map(s => `<div class="list-row"><div class="row-main"><strong>${esc(s.name)}</strong><small>${esc(friendly(s.supplier_type))}</small></div><a class="secondary-button" href="${esc(s.ordering_url || s.website_url || '#')}" target="_blank" rel="noopener">Open supplier</a></div>`).join('')}</article>
      <article class="card"><div class="card-title"><div><h2>Customer-site media</h2><p>Publish YouTube and TikTok videos to the public site.</p></div><button class="secondary-button" data-live-action="media">+ Add video</button></div><form id="media-settings-form" class="settings-list"><label>YouTube channel URL<input name="youtube_channel_url" type="url" value="${esc(cache.settings?.youtube_channel_url || '')}"></label><label>YouTube channel ID<input name="youtube_channel_id" value="${esc(cache.settings?.youtube_channel_id || '')}"></label><label>TikTok profile URL<input name="tiktok_profile_url" type="url" value="${esc(cache.settings?.tiktok_profile_url || '')}"></label><button class="primary-button">Save media settings</button><p class="auth-message" role="status"></p></form><div class="quick-actions"><button class="secondary-button" data-sync-media="youtube">Sync YouTube</button><button class="secondary-button" data-sync-media="tiktok">Sync TikTok</button></div><p id="media-sync-status" class="auth-message" role="status"></p>${cache.media.slice(0,5).map(item => `<div class="list-row"><div class="row-main"><strong>${esc(item.title || item.public_url)}</strong><small>${esc(friendly(item.platform))} · ${item.active ? 'Published' : 'Hidden'}</small></div><button class="secondary-button" data-edit-media="${item.id}">Edit</button></div>`).join('')}</article>
      <article class="card"><h2>DYMO label printing</h2><p class="subtle">Print repair and inventory labels through the normal print dialog. Inventory labels include a Code 39 SKU barcode for scanner-based work orders and audits.</p><form id="label-settings-form" class="settings-list"><label>Printer name<input name="label_printer_name" value="${esc(cache.settings?.label_printer_name || 'DYMO LabelWriter')}"></label><label>Label template<select name="label_template"><option value="30252" ${cache.settings?.label_template !== '30336' && cache.settings?.label_template !== '30334' ? 'selected' : ''}>30252 · Address (3.5 × 1.125 in)</option><option value="30336" ${cache.settings?.label_template === '30336' ? 'selected' : ''}>30336 · Small multipurpose (2.125 × 1 in)</option><option value="30334" ${cache.settings?.label_template === '30334' ? 'selected' : ''}>30334 · Medium multipurpose (2.25 × 1.25 in)</option></select></label><label>Barcode format<select name="label_barcode_format"><option value="CODE39">Code 39 · scanner compatible</option></select></label><label class="toggle-row"><span>Prompt to print a barcode label after receiving stock</span><input name="label_prompt_on_receive" type="checkbox" ${checked(cache.settings?.label_prompt_on_receive)}></label><label class="toggle-row"><span>Show retail price on inventory labels</span><input name="label_show_price" type="checkbox" ${checked(cache.settings?.label_show_price)}></label><label class="toggle-row"><span>Show customer phone on repair labels</span><input name="label_show_customer_phone" type="checkbox" ${cache.settings?.label_show_customer_phone ? 'checked' : ''}></label><button class="primary-button">Save label settings</button><button type="button" class="secondary-button" data-test-label>Print barcode test label</button><p class="auth-message" role="status"></p></form></article>
      <article class="card"><h2>Access & Discord</h2><div class="settings-list"><label>Your role <span>${esc(friendly(profile.role))}</span></label><label>Discord identity <span>${profile.discord_user_id ? 'Linked' : 'Not linked'}</span></label><label>Portal authority <span>Supabase staff role</span></label></div><button class="secondary-button" data-view="staff">Manage staff access</button></article>
    </div>`;
    const shopSave = host.querySelector('#business-settings-form .primary-button');
    shopSave?.insertAdjacentHTML('beforebegin', `<label>Frequent-repair eligibility (completed repairs)<input name="frequent_repair_min_completed" type="number" min="1" step="1" value="${cache.settings?.frequent_repair_min_completed ?? 3}"></label><label>Frequent-repair discount (%)<input name="frequent_repair_discount_percent" type="number" min="0.01" max="100" step="0.01" value="${cache.settings?.frequent_repair_discount_percent ?? 10}"></label><label>Frequent-repair promo code<input name="frequent_repair_promo_code" maxlength="40" value="${esc(cache.settings?.frequent_repair_promo_code || 'FREQUENTFIX')}"></label><label>Abandoned-device holding period (days)<small>Owners/managers may archive a ready device only after this many days.</small><input name="abandoned_after_days" type="number" min="1" max="365" step="1" value="${cache.settings?.abandoned_after_days ?? 30}"></label>`);
  }

  function renderStaffAccess() {
    const host = document.querySelector('#staff-management-list');
    if (!host) return;
    if (!['owner', 'manager'].includes(profile.role)) {
      host.innerHTML = '<p class="empty-state">Only owners and managers can view employee access.</p>';
      return;
    }
    host.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Employee</th><th>Portal role</th><th>Discord</th><th>Status</th><th>Actions</th></tr></thead><tbody>${cache.staff.map(member => {
      const self = member.id === profile.id;
      const roleProtected = member.role === 'owner' || (profile.role === 'manager' && member.role === 'manager');
      const canToggleOwner = profile.role === 'owner' && member.role === 'owner' && !self;
      const actionProtected = roleProtected && !canToggleOwner;
      const roleOptions = ['front_desk', 'technician', ...(profile.role === 'owner' ? ['manager'] : [])];
      return `<tr><td><strong>${esc(member.display_name)}</strong>${self ? '<small>You</small>' : ''}</td><td>${roleProtected ? `<span>${esc(friendly(member.role))}</span>` : `<select data-staff-role="${member.id}">${roleOptions.map(role => `<option value="${role}" ${member.role === role ? 'selected' : ''}>${friendly(role)}</option>`).join('')}</select>`}</td><td>${member.discord_user_id ? '<span class="tag confirmed">Linked</span>' : '<span class="tag">Not linked</span>'}</td><td><span class="tag ${member.active ? 'confirmed' : ''}">${member.active ? 'Active' : 'Inactive'}</span></td><td>${actionProtected ? '<small>Protected</small>' : `${roleProtected ? '' : `<button class="secondary-button" data-save-staff="${member.id}">Save role</button> `}<button class="${member.active ? 'danger-button' : 'secondary-button'}" data-toggle-staff="${member.id}" data-active="${member.active ? 'false' : 'true'}" ${self ? 'disabled' : ''}>${member.active ? 'Deactivate' : 'Reactivate'}</button>`}</td></tr>`;
    }).join('')}</tbody></table></div>${cache.staff.length ? '' : '<p class="empty-state">No staff profiles found.</p>'}<p id="staff-management-status" class="auth-message" role="status"></p>`;
  }

  function renderAll() {
    renderDashboard(); renderAppointments(); renderCustomers(); renderInventory(); renderReports(); renderSettings(); renderStaffAccess();
    const filter = document.querySelector('#status-filter');
    if (filter && !filter.querySelector('[value="abandoned"]')) filter.querySelector('[value="unrepairable"]')?.insertAdjacentHTML('beforebegin', '<option value="abandoned">Abandoned</option>');
  }

  document.querySelector('#ticket-form [name="device"]')?.closest('label')?.insertAdjacentHTML('afterend', `<label>Manufacturer<input name="manufacturer" placeholder="Apple, Samsung, Dell"></label><label>Color<input name="color"></label><label>Serial number<input name="serial_number"></label><label>IMEI<input name="imei"></label><label class="full">Device notes<textarea name="device_notes" placeholder="Condition, configuration, or identifying details"></textarea></label>`);

  async function createRepair(event) {
    event.preventDefault();
    const form = event.currentTarget, data = Object.fromEntries(new FormData(form));
    const names = String(data.customer).trim().split(/\s+/); const lastName = names.length > 1 ? names.pop() : 'Customer'; const firstName = names.join(' ');
    const phone = data.phone.trim();
    const email = data.email?.trim().toLowerCase() || null;
    let existing = (await client.from('customers').select('*').eq('location_id', profile.location_id).eq('phone', phone).maybeSingle()).data;
    if (!existing && email) existing = (await client.from('customers').select('*').eq('location_id', profile.location_id).eq('email', email).maybeSingle()).data;
    const customerPayload = { location_id: profile.location_id, first_name: firstName, last_name: lastName, phone, email: email || existing?.email || null };
    const customerResult = existing ? await client.from('customers').update(customerPayload).eq('id', existing.id).select().single() : await client.from('customers').insert(customerPayload).select().single();
    if (customerResult.error) return alert(customerResult.error.message);
    const devicePayload = { customer_id: customerResult.data.id, category: 'Device', manufacturer: data.manufacturer?.trim() || null, model: data.device, color: data.color?.trim() || null, serial_number: data.serial_number?.trim() || null, imei: data.imei?.trim() || null, device_notes: data.device_notes?.trim() || null, last_seen_at: new Date().toISOString() };
    let existingDevice = null;
    if (devicePayload.serial_number) existingDevice = (await client.from('devices').select('*').eq('customer_id', customerResult.data.id).eq('serial_number', devicePayload.serial_number).maybeSingle()).data;
    if (!existingDevice && devicePayload.imei) existingDevice = (await client.from('devices').select('*').eq('customer_id', customerResult.data.id).eq('imei', devicePayload.imei).maybeSingle()).data;
    const deviceResult = existingDevice ? await client.from('devices').update(devicePayload).eq('id', existingDevice.id).select().single() : await client.from('devices').insert(devicePayload).select().single();
    if (deviceResult.error) return alert(deviceResult.error.message);
    const mailIn = data.intake_method === 'mail_in';
    const ticketResult = await client.from('repair_tickets').insert({
      location_id: profile.location_id,
      customer_id: customerResult.data.id,
      device_id: deviceResult.data.id,
      customer_issue: data.issue || data.service,
      status: 'awaiting_repair',
      intake_method: mailIn ? 'mail_in' : 'walk_in',
      shipping_status: mailIn ? (data.shipping_status === 'not_applicable' ? 'awaiting_inbound' : data.shipping_status) : 'not_applicable',
      shipping_address: mailIn && data.shipping_address?.trim() ? { formatted: data.shipping_address.trim() } : null
    }).select().single();
    if (ticketResult.error) return alert(ticketResult.error.message);
    form.closest('dialog').close(); form.reset(); await loadData();
  }

  function openOperation(kind, record = null) {
    const dialog = document.querySelector('#operation-dialog');
    const content = document.querySelector('#operation-dialog-content');
    const head = (eyebrow, title) => `<div class="modal-head"><div><p class="eyebrow">${eyebrow}</p><h2>${title}</h2></div><button class="icon-button" type="button" data-close-operation aria-label="Close">×</button></div>`;
    if (kind === 'customer') content.innerHTML = `${head('Customer record','Add customer')}<input type="hidden" name="kind" value="customer"><div class="form-grid"><label>First name<input name="first_name" required></label><label>Last name<input name="last_name" required></label><label>Phone<input name="phone" required inputmode="tel"></label><label>Email<input name="email" type="email"></label></div><p class="operation-status"></p><div class="modal-actions"><button type="button" class="secondary-button" data-close-operation>Cancel</button><button class="primary-button">Save customer</button></div>`;
    if (kind === 'customer_history' && record) {
      const history = [...(record.repair_tickets || [])].sort((a,b) => new Date(b.created_at)-new Date(a.created_at));
      content.innerHTML = `${head('Customer profile',`${esc(record.first_name)} ${esc(record.last_name)}`)}<input type="hidden" name="kind" value="existing_repair"><input type="hidden" name="customer_id" value="${record.id}"><section class="customer-profile-summary"><div><small>Phone</small><strong>${esc(record.phone)}</strong></div><div><small>Email</small><strong>${esc(record.email || 'Not provided')}</strong></div><div><small>Repairs</small><strong>${history.length}</strong></div></section><section class="customer-history"><div class="card-title"><div><h3>Repair history</h3><p>Every previous work order saved to this customer.</p></div></div>${history.map(ticket=>`<button type="button" class="customer-history-row" data-ticket="${ticket.ticket_number}"><span><strong>GC-${String(ticket.ticket_number).padStart(6,'0')}</strong><small>${new Date(ticket.created_at).toLocaleDateString()} · ${esc([ticket.devices?.manufacturer,ticket.devices?.model].filter(Boolean).join(' ')||'Device')}</small></span><span class="tag confirmed">${esc(friendly(ticket.status))}</span><strong>${money(ticket.total_cents)}</strong><em>›</em></button>`).join('')||'<p class="empty-state">No previous repairs.</p>'}</section><section class="new-customer-work-order"><div class="card-title"><div><h3>Create another work order</h3><p>Keep the new repair under this customer profile.</p></div></div><div class="form-grid"><label>Existing device<select name="device_id"><option value="">Add a different device</option>${(record.devices||[]).map(device=>`<option value="${device.id}">${esc([device.manufacturer,device.model].filter(Boolean).join(' ')||device.category||'Device')}</option>`).join('')}</select></label><label>New device description<input name="new_device" placeholder="Required if no existing device selected"></label><label>Intake method<select name="intake_method"><option value="walk_in">Walk-in / local</option><option value="mail_in">Mail-in repair</option></select></label><label>Initial shipping status<select name="shipping_status"><option value="not_applicable">Not applicable</option><option value="awaiting_inbound">Awaiting inbound package</option><option value="received">Received at shop</option></select></label><label class="full">Return shipping address<input name="shipping_address" placeholder="Mail-in only"></label><label class="full">Customer-reported issue<textarea name="issue" required placeholder="What is happening with this device?"></textarea></label></div></section><p class="operation-status"></p><div class="modal-actions"><button type="button" class="secondary-button" data-close-operation>Cancel</button><button class="primary-button">Create work order</button></div>`;
    }
    if (kind === 'customer_history' && record) {
      const completedCount = (record.repair_tickets || []).filter(ticket => ['sale_complete','completed'].includes(ticket.status)).length;
      const repeatThreshold = cache.settings?.frequent_repair_min_completed ?? 3;
      const repeatEligible = completedCount >= repeatThreshold;
      const repeatCode = cache.settings?.frequent_repair_promo_code || 'FREQUENTFIX';
      content.insertAdjacentHTML('afterbegin', `<input type="hidden" name="frequent_promo" value="${repeatEligible ? esc(repeatCode) : ''}">`);
      content.querySelector('.customer-profile-summary')?.insertAdjacentHTML('beforeend', `<div class="${repeatEligible ? 'repeat-eligible' : ''}"><small>Frequent-repair reward</small><strong>${repeatEligible ? `Eligible · ${esc(repeatCode)}` : `${Math.max(0, repeatThreshold-completedCount)} more completed repair(s) to qualify`}</strong></div>`);
      content.querySelector('.customer-history')?.insertAdjacentHTML('beforebegin', `<section class="saved-devices"><div class="card-title"><div><h3>Saved devices</h3><p>Serial, IMEI, color, notes, and last visit remain with the customer.</p></div></div><div class="saved-device-grid">${(record.devices||[]).map(device=>`<article><strong>${esc([device.manufacturer,device.model].filter(Boolean).join(' ')||device.category||'Device')}</strong><small>${esc(device.color||'Color not recorded')} · Last seen ${device.last_seen_at ? new Date(device.last_seen_at).toLocaleDateString() : 'not recorded'}</small><code>${esc(device.serial_number||device.imei||'Serial / IMEI not recorded')}</code>${device.device_notes?`<p>${esc(device.device_notes)}</p>`:''}</article>`).join('')||'<p class="empty-state">No saved devices yet.</p>'}</div></section>`);
      content.querySelector('.new-customer-work-order .form-grid')?.insertAdjacentHTML('beforeend', `<label>Manufacturer<input name="manufacturer" placeholder="Apple, Samsung, Dell"></label><label>Model<input name="model" placeholder="Exact device model"></label><label>Category<input name="category" placeholder="Phone, computer, console"></label><label>Color<input name="color"></label><label>Serial number<input name="serial_number"></label><label>IMEI<input name="imei"></label><label class="full">Device notes<textarea name="device_notes" placeholder="Condition, configuration, accessories, or identifying details"></textarea></label>${repeatEligible ? `<div class="full repeat-discount-callout"><strong>Frequent-repair discount available</strong><span>${esc(repeatCode)} will be suggested when this work order is priced.</span></div>` : ''}`);
    }
    if (kind === 'lead') content.innerHTML = `${head('Lead pipeline','Create lead')}<input type="hidden" name="kind" value="lead"><div class="form-grid"><label>Customer name<input name="name" required></label><label>Source<input name="source" value="phone" placeholder="Phone, walk-in, referral"></label><label>Phone<input name="phone" inputmode="tel"></label><label>Email<input name="email" type="email"></label><label class="full">Requested service<input name="service" required></label><label class="full">Notes<textarea name="notes"></textarea></label></div><p class="operation-status"></p><div class="modal-actions"><button type="button" class="secondary-button" data-close-operation>Cancel</button><button class="primary-button">Create lead</button></div>`;
    if (kind === 'inventory') { const item = record || {}; content.innerHTML = `${head('Parts & supplies',record ? 'Edit inventory item' : 'Add inventory item')}<input type="hidden" name="kind" value="inventory"><input type="hidden" name="id" value="${item.id || ''}"><div class="form-grid"><label>Part name<input name="name" required value="${esc(item.name || '')}"></label><label>SKU<input name="sku" value="${esc(item.sku || '')}" placeholder="Assigned automatically"></label><label>Category<input name="category" value="${esc(item.category || '')}"></label><label>Supplier<select name="supplier_name"><option value="">No supplier</option>${cache.suppliers.map(s => `<option ${item.supplier_name === s.name ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label><label>Quantity on hand<input name="quantity_on_hand" type="number" min="0" value="${item.quantity_on_hand || 0}" required></label><label>Reorder point<input name="reorder_point" type="number" min="0" value="${item.reorder_point || 0}" required></label><label>Unit cost<input name="cost" type="number" min="0" step="0.01" value="${((item.cost_cents || 0)/100).toFixed(2)}"></label><label>Retail price<input name="price" type="number" min="0" step="0.01" value="${((item.sell_price_cents || 0)/100).toFixed(2)}"></label><label>Supplier SKU<input name="supplier_sku" value="${esc(item.supplier_sku || '')}"></label><label>Order URL<input name="supplier_url" type="url" value="${esc(item.supplier_url || '')}"></label></div><p class="operation-status"></p><div class="modal-actions">${record ? '<button type="button" class="danger-button" data-deactivate-part>Deactivate</button>' : ''}<button type="button" class="secondary-button" data-close-operation>Cancel</button><button class="primary-button">Save part</button></div>`; }
    if (kind === 'adjustment' && record) content.innerHTML = `${head('Inventory movement',`Adjust ${esc(record.name)}`)}<input type="hidden" name="kind" value="adjustment"><input type="hidden" name="id" value="${record.id}"><div class="form-grid"><label>Current quantity<input value="${record.quantity_on_hand}" disabled></label><label>Quantity change<input name="quantity_delta" type="number" step="1" required placeholder="10 to receive, -1 to remove"></label><label class="full">Reason<input name="note" required placeholder="Shipment received, cycle count correction, damaged part"></label></div><p class="operation-status"></p><div class="modal-actions"><button type="button" class="secondary-button" data-close-operation>Cancel</button><button class="primary-button">Apply adjustment</button></div>`;
    if (kind === 'loss' && record) content.innerHTML = `${head('Inventory accountability',`Report damage or loss · ${esc(record.name)}`)}<input type="hidden" name="kind" value="loss"><input type="hidden" name="id" value="${record.id}"><div class="loss-warning"><strong>This permanently removes stock on hand.</strong><span>The recorded cost flows into inventory-loss reporting.</span></div><div class="form-grid"><label>On hand<input value="${record.quantity_on_hand}" disabled></label><label>Unit cost<input value="${money(record.cost_cents)}" disabled></label><label>Quantity to write off<input name="quantity_to_remove" type="number" min="1" max="${record.quantity_on_hand}" step="1" required value="1"></label><label>Loss category<select name="loss_category" required><option value="damaged">Damaged</option><option value="broken">Broken during handling/repair</option><option value="shrinkage">Missing / shrinkage</option><option value="expired">Expired / obsolete</option><option value="return_to_vendor">Return to vendor</option><option value="other">Other</option></select></label><label>Expected recovery or vendor credit<input name="recoverable_amount" type="number" min="0" step="0.01" value="0.00"></label><label class="full">Required incident note<textarea name="loss_note" required placeholder="What happened, condition, and any related ticket or vendor RMA"></textarea></label></div><p class="operation-status"></p><div class="modal-actions"><button type="button" class="secondary-button" data-close-operation>Cancel</button><button class="danger-button" type="submit">Record inventory loss</button></div>`;
    if (kind === 'service') { const item = record || {}; content.innerHTML = `${head('Service catalog',record ? 'Edit service' : 'Add service')}<input type="hidden" name="kind" value="service"><input type="hidden" name="id" value="${item.id || ''}"><div class="form-grid"><label>Service name<input name="name" required value="${esc(item.name || '')}"></label><label>SKU<input name="sku" value="${esc(item.sku || '')}" placeholder="Assigned automatically"></label><label>Category<input name="category" value="${esc(item.category || '')}" placeholder="Cleaning, diagnostic, labor"></label><label>Taxable<select name="taxable"><option value="true" ${item.taxable !== false ? 'selected' : ''}>Yes</option><option value="false" ${item.taxable === false ? 'selected' : ''}>No</option></select></label><label>Internal cost<input name="cost" type="number" min="0" step="0.01" value="${((item.cost_cents || 0)/100).toFixed(2)}"></label><label>Customer price<input name="price" type="number" min="0" step="0.01" value="${((item.price_cents || 0)/100).toFixed(2)}"></label><label class="full">Description<textarea name="description">${esc(item.description || '')}</textarea></label></div><p class="operation-status"></p><div class="modal-actions">${record ? '<button type="button" class="danger-button" data-deactivate-service>Deactivate</button>' : ''}<button type="button" class="secondary-button" data-close-operation>Cancel</button><button class="primary-button">Save service</button></div>`; }
    if (kind === 'service') content.querySelector('.form-grid')?.insertAdjacentHTML('beforeend', `<label>Pricing mode<select name="quote_required"><option value="false" ${record?.quote_required ? '' : 'selected'}>Catalog price</option><option value="true" ${record?.quote_required ? 'selected' : ''}>Quote required</option></select></label>`);
    if (kind === 'promo') { const item = record || {}; content.innerHTML = `${head('Pricing controls',record ? 'Edit promo code' : 'Create promo code')}<input type="hidden" name="kind" value="promo"><input type="hidden" name="id" value="${item.id || ''}"><div class="form-grid"><label>Code<input name="code" required maxlength="40" value="${esc(item.code || '')}" placeholder="CRACKED10"></label><label>Discount type<select name="discount_type"><option value="percent" ${item.discount_type !== 'fixed' ? 'selected' : ''}>Percentage</option><option value="fixed" ${item.discount_type === 'fixed' ? 'selected' : ''}>Fixed amount</option></select></label><label>Discount value<input name="discount_value" required type="number" min="0.01" step="0.01" value="${item.discount_value || ''}"></label><label>Maximum discount ($)<input name="maximum_discount" type="number" min="0" step="0.01" value="${item.maximum_discount_cents ? (item.maximum_discount_cents/100).toFixed(2) : ''}"></label><label>Starts<input name="starts_at" type="datetime-local" value="${item.starts_at ? item.starts_at.slice(0,16) : ''}"></label><label>Expires<input name="ends_at" type="datetime-local" value="${item.ends_at ? item.ends_at.slice(0,16) : ''}"></label><label>Usage limit<input name="usage_limit" type="number" min="1" step="1" value="${item.usage_limit || ''}"></label><label>Active<select name="active"><option value="true" ${item.active !== false ? 'selected' : ''}>Yes</option><option value="false" ${item.active === false ? 'selected' : ''}>No</option></select></label><label class="full">Description<input name="description" value="${esc(item.description || '')}" placeholder="Customer-facing discount description"></label></div><p class="operation-status"></p><div class="modal-actions"><button type="button" class="secondary-button" data-close-operation>Cancel</button><button class="primary-button">Save promo code</button></div>`; }
    if (kind === 'media') { const item = record || {}; content.innerHTML = `${head('Customer website',record ? 'Edit video' : 'Publish a video')}<input type="hidden" name="kind" value="media"><input type="hidden" name="id" value="${item.id || ''}"><input type="hidden" name="external_id" value="${esc(item.external_id || '')}"><div class="form-grid"><label>Platform<select name="platform"><option value="youtube" ${item.platform !== 'tiktok' ? 'selected' : ''}>YouTube</option><option value="tiktok" ${item.platform === 'tiktok' ? 'selected' : ''}>TikTok</option></select></label><label>Published<select name="active"><option value="true" ${item.active !== false ? 'selected' : ''}>Yes</option><option value="false" ${item.active === false ? 'selected' : ''}>Hidden</option></select></label><label class="full">Video title<input name="title" required value="${esc(item.title || '')}"></label><label class="full">Public video URL<input name="public_url" type="url" required value="${esc(item.public_url || '')}"></label><label class="full">Thumbnail URL<input name="thumbnail_url" type="url" value="${esc(item.thumbnail_url || '')}" placeholder="Optional image URL"></label><label>Published date<input name="published_at" type="datetime-local" value="${item.published_at ? item.published_at.slice(0,16) : ''}"></label></div><p class="operation-status"></p><div class="modal-actions"><button type="button" class="secondary-button" data-close-operation>Cancel</button><button class="primary-button">Save video</button></div>`; }
    if (kind === 'repair' && record) { const lines = record.work_order_items || []; const catalog = [...cache.inventory.map(item => ({...item, type:'part', price_cents:item.sell_price_cents})), ...cache.services.map(item => ({...item, type:'service'}))]; content.innerHTML = `${head(`GC-${String(record.ticket_number).padStart(6,'0')}`,'Update repair')}<input type="hidden" name="kind" value="repair"><input type="hidden" name="id" value="${record.id}"><div class="form-grid"><label>Status<select name="status">${['checked_in','in_diagnosis','awaiting_approval','waiting_on_parts','in_repair','ready_for_pickup','completed','cancelled'].map(value => `<option value="${value}" ${record.status === value ? 'selected' : ''}>${friendly(value)}</option>`).join('')}</select></label><label>Assigned to<select name="assigned_user_id"><option value="">Unassigned</option>${cache.staff.map(item => `<option value="${item.id}" ${record.assigned_user_id === item.id ? 'selected' : ''}>${esc(item.display_name)}</option>`).join('')}</select></label><label>Priority<select name="priority">${['normal','high','urgent'].map(value => `<option ${record.priority === value ? 'selected' : ''}>${friendly(value)}</option>`).join('')}</select></label><label>Legacy estimate<input name="estimate" type="number" min="0" step="0.01" value="${((record.estimate_cents || 0)/100).toFixed(2)}"></label><label class="full">Customer-visible note<textarea name="public_notes">${esc(record.public_notes || '')}</textarea></label><label class="full">Internal notes<textarea name="internal_notes">${esc(record.internal_notes || '')}</textarea></label></div><section class="work-order-builder"><div class="card-title"><div><h3>Parts & services</h3><p>Line items set the repair total and consume inventory.</p></div></div>${lines.map(line => `<div class="list-row"><div class="row-main"><strong>${esc(line.description)}</strong><small>${esc(line.sku || line.item_type)} · ${line.quantity} × ${money(line.unit_price_cents)}</small></div><strong>${money(Math.round(line.quantity * line.unit_price_cents))}</strong><button type="button" class="icon-button" data-remove-work-item="${line.id}" aria-label="Remove line">×</button></div>`).join('') || '<p class="empty-state">No parts or services added.</p>'}<div class="form-grid"><label class="full">Add catalog item<select name="catalog_item"><option value="">Choose a part or service</option>${catalog.map(item => `<option value="${item.type}:${item.id}">${item.type === 'part' ? 'PART' : 'SERVICE'} · ${esc(item.sku)} · ${esc(item.name)} · ${money(item.price_cents)}</option>`).join('')}</select></label><label>Quantity<input name="catalog_quantity" type="number" min="1" step="1" value="1"></label><label>Consume inventory<select name="inventory_applied"><option value="true">Yes</option><option value="false">Reserve later</option></select></label></div><div class="ticket-totals"><span>Subtotal <strong>${money(record.subtotal_cents)}</strong></span><span>Tax <strong>${money(record.tax_cents)}</strong></span><span>Total <strong>${money(record.total_cents)}</strong></span></div></section><p class="operation-status"></p><div class="modal-actions"><button type="button" class="secondary-button" data-close-operation>Cancel</button><button class="primary-button">Save repair & line item</button></div>`; }
    if (kind === 'repair' && record) {
      const statusSelect = content.querySelector('[name="status"]');
      if (statusSelect) statusSelect.innerHTML = allowedRepairStatuses(record).map(value => `<option value="${value}" ${record.status === value ? 'selected' : ''}>${esc(value === record.status_before_callback && record.status === 'awaiting_callback' ? `Resume: ${statusLabel(value)}` : statusLabel(value))}</option>`).join('');
      content.insertAdjacentHTML('afterbegin', `<input type="hidden" name="previous_status" value="${esc(record.status)}">`);
      const events = [...(record.ticket_events || [])].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
      const customer = cache.customers.find(item => item.id === record.customer_id);
      const repeatThreshold = cache.settings?.frequent_repair_min_completed ?? 3;
      const completedCount = (customer?.repair_tickets || []).filter(ticket => ['sale_complete','completed'].includes(ticket.status)).length;
      const repeatCode = cache.settings?.frequent_repair_promo_code || 'FREQUENTFIX';
      const repeatEligible = completedCount >= repeatThreshold;
      content.querySelector('.work-order-builder')?.insertAdjacentHTML('beforebegin', `<section class="repair-progress-editor"><div class="card-title"><div><h3>Repair progress</h3><p>Every stage change requires a note. Photos can be internal or customer-visible.</p></div></div>${record.status === 'awaiting_callback' ? `<div class="callback-hold"><strong>Paused for customer callback</strong><span>Resume to ${esc(statusLabel(record.status_before_callback))}, or document Unrepairable / Customer Declined.</span></div>` : ''}<div class="form-grid"><label class="full">Progress note<textarea name="progress_note" placeholder="Diagnosis, work performed, information requested, quality check, or outcome"></textarea></label><label>Visibility<select name="progress_visibility"><option value="internal">Staff only</option><option value="customer">Show in customer tracking</option></select></label><label>Progress photo<input name="progress_photo" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif"></label></div></section>${repeatEligible ? `<div class="repeat-discount-callout"><strong>Frequent-repair discount available</strong><span>${esc(repeatCode)} · ${Number(cache.settings?.frequent_repair_discount_percent || 10)}% configured discount</span><button type="button" class="secondary-button" data-use-frequent-code="${esc(repeatCode)}">Apply code</button></div>` : ''}<section class="repair-activity"><div class="card-title"><div><h3>Activity & documentation</h3><p>Stage history, staff notes, customer updates, and photos.</p></div></div>${events.map(item => { const attachments = Array.isArray(item.attachments) ? item.attachments : []; return `<article class="repair-event"><span class="event-dot"></span><div><header><strong>${esc(statusLabel(item.event_type))}</strong><small>${new Date(item.created_at).toLocaleString()} · ${esc(item.actor?.display_name || 'GotCracked staff')} · ${item.visibility === 'customer' ? 'Customer-visible' : 'Internal'}</small></header>${item.message ? `<p>${esc(item.message)}</p>` : ''}${attachments.length ? `<div class="event-attachments">${attachments.map(file => `<button type="button" data-attachment-path="${esc(file.path)}">▧ ${esc(file.name || 'Progress photo')}</button>`).join('')}</div>` : ''}</div></article>`; }).join('') || '<p class="empty-state">No repair updates yet. Add the first progress note above.</p>'}</section>`);
      if (['repaired','sale_complete'].includes(record.status)) content.querySelector('.repair-activity')?.insertAdjacentHTML('beforebegin', `<section class="payment-closeout ${record.payment_status === 'paid' || record.payment_status === 'waived' ? 'payment-confirmed' : ''}"><div class="card-title"><div><h3>Payment & closeout</h3><p>Repaired tickets stay in the pickup queue until payment is confirmed and the stage is changed to Sale Complete.</p></div><strong>${esc(friendly(record.payment_status || 'unpaid'))}</strong></div>${record.paid_at ? `<div class="payment-summary"><span>${money(record.amount_paid_cents)} · ${esc(friendly(record.payment_method))}</span><small>Confirmed ${new Date(record.paid_at).toLocaleString()}${record.payment_reference ? ` · ${esc(record.payment_reference)}` : ''}</small></div>` : `<div class="form-grid"><label class="check-row full"><input name="confirm_payment" type="checkbox" value="true"> Confirm payment received</label><label>Amount received<input name="payment_amount" type="number" min="0" step="0.01" value="${((record.total_cents || 0)/100).toFixed(2)}"></label><label>Method<select name="payment_method"><option value="card">Card</option><option value="cash">Cash</option><option value="online">Online</option><option value="warranty">Warranty / redo</option><option value="no_charge">No-charge service</option><option value="other">Other</option></select></label><label>Reference<input name="payment_reference" placeholder="Receipt, transaction, or note"></label><label>Payment note<input name="payment_note" placeholder="Optional internal note"></label></div>`}</section>`);
      if (record.status === 'repaired') {
        const abandonedDays = cache.settings?.abandoned_after_days ?? 30;
        const readyAt = new Date(record.ready_for_pickup_at || record.updated_at || record.created_at);
        const eligibleAt = new Date(readyAt.getTime() + abandonedDays * 86400000);
        const remaining = Math.max(0, Math.ceil((eligibleAt.getTime() - Date.now()) / 86400000));
        content.querySelector('.payment-closeout')?.insertAdjacentHTML('beforeend', `<div class="abandoned-policy"><strong>Abandoned-device policy</strong><span>${remaining ? `Eligible in ${remaining} day${remaining===1?'':'s'} · ${eligibleAt.toLocaleDateString()}` : `Eligible now · owner/manager and a progress note required`}</span></div>`);
      }
      const progressIntro = content.querySelector('.repair-progress-editor .card-title p');
      if (progressIntro) progressIntro.textContent = 'Every stage change requires a note. Customer-visible notes appear in tracking; photos remain in private staff storage.';
      const visibilitySelect = content.querySelector('[name="progress_visibility"]');
      if (visibilitySelect) { visibilitySelect.closest('label').firstChild.textContent = 'Note visibility'; visibilitySelect.options[1].textContent = 'Show note in customer tracking'; }
      const photoInput = content.querySelector('[name="progress_photo"]');
      if (photoInput) photoInput.closest('label').firstChild.textContent = 'Private progress photo';
      const address = record.shipping_address || {};
      const formattedAddress = address.formatted || [address.line1, address.line2, [address.city, address.state, address.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      const workOrderFields = content.querySelector('.work-order-builder .form-grid');
      workOrderFields?.insertAdjacentHTML('afterbegin', `<label class="full scan-part-field">Scan part SKU<input name="scan_sku" autocomplete="off" placeholder="Scan a DYMO part barcode"></label>`);
      content.querySelector('.work-order-builder')?.insertAdjacentHTML('beforebegin', `<section class="shipping-editor"><div class="card-title"><div><h3>Mail-in & shipping</h3><p>Tracking details shown here can also appear in customer repair tracking.</p></div></div><div class="form-grid"><label>Intake method<select name="intake_method"><option value="walk_in" ${record.intake_method !== 'mail_in' ? 'selected' : ''}>Walk-in / local</option><option value="mail_in" ${record.intake_method === 'mail_in' ? 'selected' : ''}>Mail-in repair</option></select></label><label>Package status<select name="shipping_status">${['not_applicable','awaiting_inbound','inbound_in_transit','received','return_label_ready','outbound_in_transit','delivered','shipping_issue'].map(value => `<option value="${value}" ${record.shipping_status === value ? 'selected' : ''}>${friendly(value)}</option>`).join('')}</select></label><label class="full">Return address<input name="shipping_address" value="${esc(formattedAddress)}" placeholder="Customer return shipping address"></label><label>Inbound carrier<input name="inbound_carrier" value="${esc(record.inbound_carrier || '')}" placeholder="USPS, UPS, FedEx"></label><label>Inbound tracking<input name="inbound_tracking" value="${esc(record.inbound_tracking || '')}"></label><label>Outbound carrier<input name="outbound_carrier" value="${esc(record.outbound_carrier || '')}" placeholder="USPS, UPS, FedEx"></label><label>Outbound tracking<input name="outbound_tracking" value="${esc(record.outbound_tracking || '')}"></label><label class="full">Shipping label URL<input name="shipping_label_url" type="url" value="${esc(record.shipping_label_url || '')}" placeholder="Optional carrier label or shipment URL"></label><label>Package weight (oz)<input name="package_weight_oz" type="number" min="0" step="0.1" value="${record.package_weight_oz || ''}"></label><label>Insurance amount<input name="insurance_amount" type="number" min="0" step="0.01" value="${((record.insurance_amount_cents || 0)/100).toFixed(2)}"></label><label>Customer shipping charge<input name="shipping_charge" type="number" min="0" step="0.01" value="${((record.shipping_charge_cents || 0)/100).toFixed(2)}"></label></div></section>`);
      content.querySelector('.work-order-builder .form-grid')?.insertAdjacentHTML('beforeend', `<label>Override unit price<input name="override_price" type="number" min="0" step="0.01" placeholder="Use catalog price"></label><label>Promo code<input name="promo_code" autocomplete="off"></label><label>Manual discount<input name="manual_discount" type="number" min="0" step="0.01" placeholder="0.00"></label><label>Discount reason<input name="discount_reason" placeholder="Manager-approved reason"></label>`);
      const canOverride = ['owner','manager'].includes(profile.role) && cache.settings?.allow_manager_price_overrides !== false;
      const canDiscount = ['owner','manager'].includes(profile.role) && cache.settings?.allow_manager_manual_discounts !== false;
      content.querySelector('[name="override_price"]').disabled = !canOverride;
      content.querySelector('[name="manual_discount"]').disabled = !canDiscount;
      content.querySelector('[name="discount_reason"]').disabled = !canDiscount;
      const consume = content.querySelector('[name="inventory_applied"]');
      if (consume) consume.value = cache.settings?.consume_inventory_on_add === false ? 'false' : 'true';
      content.querySelector('.modal-actions')?.insertAdjacentHTML('afterbegin', '<button type="button" class="secondary-button" data-print-ticket>Print DYMO label</button>');
    }
    dialog.showModal();
  }

  async function saveOperation(event) {
    event.preventDefault();
    const form = event.currentTarget, data = Object.fromEntries(new FormData(form));
    const button = form.querySelector('button[type="submit"], button.primary-button'); const status = form.querySelector('.operation-status');
    button.disabled = true; status.textContent = '';
    let result;
    if (data.kind === 'customer') result = await client.from('customers').insert({ location_id: profile.location_id, first_name: data.first_name.trim(), last_name: data.last_name.trim(), phone: data.phone.trim(), email: data.email.trim() || null });
    if (data.kind === 'existing_repair') {
      let deviceId = data.device_id || null;
      const deviceModel = data.model?.trim() || data.new_device?.trim();
      if (!deviceId && !deviceModel) result = { error: { message: 'Choose an existing device or enter a new device model.' } };
      const devicePayload = { category: data.category?.trim() || 'Device', manufacturer: data.manufacturer?.trim() || null, model: deviceModel || 'Device', color: data.color?.trim() || null, serial_number: data.serial_number?.trim() || null, imei: data.imei?.trim() || null, device_notes: data.device_notes?.trim() || null, last_seen_at: new Date().toISOString() };
      if (!result && deviceId) {
        const deviceResult = await client.from('devices').update(devicePayload).eq('id', deviceId).eq('customer_id', data.customer_id).select().single();
        if (deviceResult.error) result = deviceResult;
      }
      if (!result && !deviceId) {
        const deviceResult = await client.from('devices').insert({ customer_id: data.customer_id, ...devicePayload }).select().single();
        if (deviceResult.error) result = deviceResult; else deviceId = deviceResult.data.id;
      }
      if (!result) {
        const mailIn = data.intake_method === 'mail_in';
        result = await client.from('repair_tickets').insert({ location_id: profile.location_id, customer_id: data.customer_id, device_id: deviceId, customer_issue: data.issue.trim(), status: 'awaiting_repair', intake_method: mailIn ? 'mail_in' : 'walk_in', shipping_status: mailIn ? (data.shipping_status === 'not_applicable' ? 'awaiting_inbound' : data.shipping_status) : 'not_applicable', shipping_address: mailIn && data.shipping_address?.trim() ? { formatted: data.shipping_address.trim() } : null, internal_notes: data.frequent_promo ? `Frequent-repair discount eligible: ${data.frequent_promo}` : null }).select().single();
      }
    }
    if (data.kind === 'lead') result = await client.functions.invoke('create-lead', { body: { name: data.name.trim(), phone: data.phone.trim() || null, email: data.email.trim() || null, service: data.service.trim(), source: data.source.trim() || 'portal', notes: data.notes.trim() || null } });
    if (data.kind === 'inventory') { const payload = { location_id: profile.location_id, name: data.name.trim(), sku: data.sku.trim() || null, category: data.category.trim() || null, supplier_name: data.supplier_name || null, supplier_sku: data.supplier_sku.trim() || null, supplier_url: data.supplier_url.trim() || null, quantity_on_hand: Number(data.quantity_on_hand), reorder_point: Number(data.reorder_point), cost_cents: Math.round(Number(data.cost || 0) * 100), sell_price_cents: Math.round(Number(data.price || 0) * 100) }; if (data.id) delete payload.quantity_on_hand; result = data.id ? await client.from('inventory_items').update(payload).eq('id', data.id) : await client.from('inventory_items').insert(payload); }
    if (data.kind === 'adjustment') result = await client.rpc('adjust_inventory', { target_item: data.id, quantity_delta: Number(data.quantity_delta), adjustment_note: data.note.trim() });
    if (data.kind === 'loss') result = await client.rpc('write_off_inventory', { target_item: data.id, quantity_to_remove: Number(data.quantity_to_remove), loss_category: data.loss_category, loss_note: data.loss_note.trim(), recoverable_amount_cents: Math.round(Number(data.recoverable_amount || 0) * 100) });
    if (data.kind === 'service') { const payload = { location_id: profile.location_id, name: data.name.trim(), sku: data.sku.trim() || null, category: data.category.trim() || null, description: data.description.trim() || null, taxable: data.taxable === 'true', quote_required: data.quote_required === 'true', cost_cents: Math.round(Number(data.cost || 0) * 100), price_cents: Math.round(Number(data.price || 0) * 100) }; result = data.id ? await client.from('services').update(payload).eq('id', data.id) : await client.from('services').insert(payload); }
    if (data.kind === 'promo') { const payload = { location_id: profile.location_id, code: data.code.trim().toUpperCase(), description: data.description.trim() || null, discount_type: data.discount_type, discount_value: Number(data.discount_value), maximum_discount_cents: data.maximum_discount ? Math.round(Number(data.maximum_discount) * 100) : null, starts_at: data.starts_at ? new Date(data.starts_at).toISOString() : null, ends_at: data.ends_at ? new Date(data.ends_at).toISOString() : null, usage_limit: data.usage_limit ? Number(data.usage_limit) : null, active: data.active === 'true' }; result = data.id ? await client.from('promo_codes').update(payload).eq('id', data.id) : await client.from('promo_codes').insert(payload); }
    if (data.kind === 'media') { const payload = { location_id: profile.location_id, platform: data.platform, external_id: data.external_id || mediaIdFromUrl(data.public_url), title: data.title.trim(), public_url: data.public_url.trim(), thumbnail_url: data.thumbnail_url.trim() || null, published_at: data.published_at ? new Date(data.published_at).toISOString() : new Date().toISOString(), active: data.active === 'true' }; result = data.id ? await client.from('media_posts').update(payload).eq('id', data.id) : await client.from('media_posts').insert(payload); }
    if (data.kind === 'repair') {
      const currentTicket = cache.repairs.find(item => item.id === data.id);
      const attachments = [];
      const paymentWillBeConfirmed = data.confirm_payment === 'true' || ['paid','waived'].includes(currentTicket?.payment_status);
      if (data.status !== data.previous_status && !data.progress_note?.trim()) { status.textContent = 'A progress note is required to change the repair stage.'; button.disabled = false; return; }
      if (data.status === 'sale_complete' && !paymentWillBeConfirmed) { status.textContent = 'Confirm payment before marking this work order Sale Complete.'; button.disabled = false; return; }
      const progressPhoto = form.elements.progress_photo?.files?.[0];
      if (progressPhoto?.size) {
        if (progressPhoto.size > 10 * 1024 * 1024) { status.textContent = 'Progress photos must be 10 MB or smaller.'; button.disabled = false; return; }
        const safeName = progressPhoto.name.replace(/[^a-zA-Z0-9._-]/g, '-');
        const path = `${profile.location_id}/${data.id}/${crypto.randomUUID()}-${safeName}`;
        const upload = await client.storage.from('repair-attachments').upload(path, progressPhoto, { contentType: progressPhoto.type, upsert: false });
        if (upload.error) { status.textContent = upload.error.message; button.disabled = false; return; }
        attachments.push({ bucket: 'repair-attachments', path, name: progressPhoto.name, type: progressPhoto.type, size: progressPhoto.size });
      }
      if (data.confirm_payment === 'true' && !['paid','waived'].includes(currentTicket?.payment_status)) {
        const payment = await client.rpc('confirm_repair_payment', { target_ticket: data.id, paid_amount_cents: Math.round(Number(data.payment_amount || 0) * 100), paid_method: data.payment_method, paid_reference: data.payment_reference?.trim() || null, payment_note: data.payment_note?.trim() || null });
        if (payment.error) { status.textContent = payment.error.message; button.disabled = false; return; }
      }
      if (data.status !== data.previous_status) {
        const advance = await client.rpc('advance_repair_status', { target_ticket: data.id, next_status: data.status, update_note: data.progress_note.trim(), update_attachments: attachments, update_visibility: data.progress_visibility || 'internal' });
        if (advance.error) { status.textContent = advance.error.message; button.disabled = false; return; }
      } else if (data.progress_note?.trim() || attachments.length) {
        const update = await client.rpc('add_repair_update', { target_ticket: data.id, update_note: data.progress_note?.trim() || '', update_attachments: attachments, update_visibility: data.progress_visibility || 'internal' });
        if (update.error) { status.textContent = update.error.message; button.disabled = false; return; }
      }
      let newLine = null;
      if (data.catalog_item) {
        const [type,id] = data.catalog_item.split(':'); const source = type === 'part' ? cache.inventory.find(item => item.id === id) : cache.services.find(item => item.id === id);
        const customPrice = String(data.override_price || '').trim();
        newLine = { item_type: type, catalog_id: id, description: source.name, quantity: Number(data.catalog_quantity || 1), unit_price_cents: customPrice ? Math.round(Number(customPrice) * 100) : (source.sell_price_cents ?? source.price_cents ?? 0), taxable: source.taxable !== false, inventory_applied: type === 'part' && data.inventory_applied === 'true', price_overridden: Boolean(customPrice) };
      }
      result = await client.rpc('save_work_order', { target_ticket: data.id, ticket_changes: {
        status: data.status,
        assigned_user_id: data.assigned_user_id || '',
        priority: data.priority,
        public_notes: data.public_notes.trim(),
        internal_notes: data.internal_notes.trim(),
        intake_method: data.intake_method || 'walk_in',
        shipping_status: data.shipping_status || 'not_applicable',
        shipping_address: data.shipping_address?.trim() ? { formatted: data.shipping_address.trim() } : null,
        inbound_carrier: data.inbound_carrier?.trim() || '',
        inbound_tracking: data.inbound_tracking?.trim() || '',
        outbound_carrier: data.outbound_carrier?.trim() || '',
        outbound_tracking: data.outbound_tracking?.trim() || '',
        shipping_label_url: data.shipping_label_url?.trim() || '',
        package_weight_oz: data.package_weight_oz || null,
        insurance_amount_cents: Math.round(Number(data.insurance_amount || 0) * 100),
        shipping_charge_cents: Math.round(Number(data.shipping_charge || 0) * 100)
      }, new_line: newLine, manual_discount_cents: Math.round(Number(data.manual_discount || 0) * 100), manual_discount_reason: data.discount_reason?.trim() || null, entered_promo_code: data.promo_code?.trim() || null });
    }
    if (result?.error) { status.textContent = result.error.message; button.disabled = false; return; }
    if (data.kind === 'adjustment' && Number(data.quantity_delta) > 0 && cache.settings?.label_prompt_on_receive !== false) {
      const item = cache.inventory.find(row => row.id === data.id);
      if (item && confirm(`${data.quantity_delta} unit(s) received. Print a DYMO SKU barcode label now? Use the print dialog's Copies setting for multiple identical parts.`)) printDymoLabel({ title: item.name, subtitle: `Received ${data.quantity_delta} · ${item.category || 'GotCracked inventory'}`, code: item.sku, price: money(item.sell_price_cents) });
    }
    form.closest('dialog').close(); form.reset(); await loadData();
  }

  document.querySelector('#ticket-form')?.addEventListener('submit', createRepair);
  document.querySelector('#operation-form')?.addEventListener('submit', saveOperation);
  document.addEventListener('submit', async event => {
    if (!['business-settings-form','work-order-settings-form','inventory-settings-form','media-settings-form','label-settings-form'].includes(event.target.id)) return;
    event.preventDefault(); const form = event.target; const data = Object.fromEntries(new FormData(form)); const message = form.querySelector('.auth-message');
    let payload = { location_id: profile.location_id };
    if (form.id === 'business-settings-form') payload = { ...payload, currency_code: data.currency_code, sales_tax_rate: Number(data.sales_tax_rate || 0), default_markup_percent: Number(data.default_markup_percent || 0), warranty_months: Number(data.warranty_months || 0), frequent_repair_min_completed: Number(data.frequent_repair_min_completed || 3), frequent_repair_discount_percent: Number(data.frequent_repair_discount_percent || 10), frequent_repair_promo_code: data.frequent_repair_promo_code.trim().toUpperCase() || 'FREQUENTFIX', abandoned_after_days: Number(data.abandoned_after_days || 30) };
    if (form.id === 'work-order-settings-form') payload = { ...payload, allow_manager_price_overrides: form.elements.allow_manager_price_overrides.checked, allow_manager_manual_discounts: form.elements.allow_manager_manual_discounts.checked, require_discount_reason: form.elements.require_discount_reason.checked, consume_inventory_on_add: form.elements.consume_inventory_on_add.checked };
    if (form.id === 'inventory-settings-form') payload = { ...payload, part_sku_prefix: data.part_sku_prefix.trim().toUpperCase(), service_sku_prefix: data.service_sku_prefix.trim().toUpperCase(), default_reorder_point: Number(data.default_reorder_point || 0) };
    if (form.id === 'media-settings-form') payload = { ...payload, youtube_channel_url: data.youtube_channel_url.trim() || null, youtube_channel_id: data.youtube_channel_id.trim() || null, tiktok_profile_url: data.tiktok_profile_url.trim() || null };
    if (form.id === 'label-settings-form') payload = { ...payload, label_printer_name: data.label_printer_name.trim() || 'DYMO LabelWriter', label_template: data.label_template, label_barcode_format: 'CODE39', label_prompt_on_receive: form.elements.label_prompt_on_receive.checked, label_show_price: form.elements.label_show_price.checked, label_show_customer_phone: form.elements.label_show_customer_phone.checked };
    let { error } = await client.from('business_settings').upsert(payload, { onConflict: 'location_id' });
    if (!error && form.id === 'business-settings-form') {
      const nextCode = payload.frequent_repair_promo_code;
      const previousCode = cache.settings?.frequent_repair_promo_code;
      if (previousCode && previousCode !== nextCode) await client.from('promo_codes').update({ active: false }).eq('location_id', profile.location_id).eq('code', previousCode);
      const promoSave = await client.from('promo_codes').upsert({ location_id: profile.location_id, code: nextCode, description: 'Frequent-repair customer discount', discount_type: 'percent', discount_value: payload.frequent_repair_discount_percent, active: true }, { onConflict: 'location_id,code' });
      error = promoSave.error;
    }
    message.textContent = error ? error.message : 'Settings saved.'; if (!error) loadData();
  });
  document.addEventListener('change', event => {
    if (event.target.name !== 'device_id') return;
    const form = event.target.closest('form');
    const customer = cache.customers.find(item => item.id === form.querySelector('[name="customer_id"]')?.value);
    const device = customer?.devices?.find(item => item.id === event.target.value);
    const fields = ['manufacturer','model','category','color','serial_number','imei','device_notes'];
    fields.forEach(name => { const input = form.elements[name]; if (input) input.value = device?.[name] || ''; });
    if (device && form.elements.new_device) form.elements.new_device.value = '';
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.target.name !== 'scan_sku') return;
    event.preventDefault();
    const sku = event.target.value.trim().toUpperCase();
    const item = cache.inventory.find(row => String(row.sku || '').toUpperCase() === sku);
    const form = event.target.closest('form');
    const status = form?.querySelector('.operation-status');
    if (!item) { if (status) status.textContent = `No active inventory item matches SKU ${sku}.`; event.target.select(); return; }
    const select = form.querySelector('[name="catalog_item"]');
    select.value = `part:${item.id}`;
    if (status) status.textContent = `${item.name} selected from barcode scan. Save the repair to add it.`;
    event.target.value = '';
  });
  document.addEventListener('click', async event => {
    const saveStaff = event.target.closest('[data-save-staff]');
    const toggleStaff = event.target.closest('[data-toggle-staff]');
    if (saveStaff || toggleStaff) {
      const actionButton = saveStaff || toggleStaff;
      const targetUserId = actionButton.dataset.saveStaff || actionButton.dataset.toggleStaff;
      const member = cache.staff.find(item => item.id === targetUserId);
      const status = document.querySelector('#staff-management-status');
      const body = { targetUserId };
      if (saveStaff) body.role = document.querySelector(`[data-staff-role="${targetUserId}"]`)?.value;
      if (toggleStaff) {
        body.active = toggleStaff.dataset.active === 'true';
        body.removeFromDiscord = false;
        if (!body.active && member?.discord_user_id) {
          body.removeFromDiscord = confirm(`Also remove ${member.display_name} from the GotCracked Discord server?\n\nOK removes them from Discord and Portal. Cancel deactivates Portal access only.`);
        }
        if (!confirm(`${body.active ? 'Reactivate' : 'Deactivate'} Portal access for ${member?.display_name || 'this employee'}?`)) return;
      }
      actionButton.disabled = true;
      if (status) status.textContent = 'Updating employee access…';
      const { data, error } = await client.functions.invoke('manage-staff', { body });
      if (error || data?.error) {
        if (status) status.textContent = data?.error || error?.message || 'Unable to update staff access.';
        actionButton.disabled = false;
      } else {
        if (status) status.textContent = data.warning || 'Employee access updated.';
        await loadData();
      }
      return;
    }
    const button = event.target.closest('[data-live-action]'); if (button) openOperation(button.dataset.liveAction);
    const customerRow = event.target.closest('[data-customer-id]'); if (customerRow) openOperation('customer_history', cache.customers.find(item => item.id === customerRow.dataset.customerId));
    if (event.target.closest('[data-close-operation]')) document.querySelector('#operation-dialog')?.close();
    const tab = event.target.closest('[data-catalog-tab]'); if (tab) { document.querySelectorAll('[data-catalog-tab]').forEach(item => item.classList.toggle('active', item === tab)); document.querySelector('#parts-catalog').hidden = tab.dataset.catalogTab !== 'parts'; document.querySelector('#services-catalog').hidden = tab.dataset.catalogTab !== 'services'; }
    const partEdit = event.target.closest('[data-edit-part]'); if (partEdit) openOperation('inventory', cache.inventory.find(item => item.id === partEdit.dataset.editPart));
    const partAdjust = event.target.closest('[data-adjust-part]'); if (partAdjust) openOperation('adjustment', cache.inventory.find(item => item.id === partAdjust.dataset.adjustPart));
    const partLoss = event.target.closest('[data-loss-part]'); if (partLoss) openOperation('loss', cache.inventory.find(item => item.id === partLoss.dataset.lossPart));
    const partLabel = event.target.closest('[data-print-part]'); if (partLabel) { const item = cache.inventory.find(row => row.id === partLabel.dataset.printPart); if (item) printDymoLabel({ title: item.name, subtitle: item.category || 'GotCracked inventory', code: item.sku, price: money(item.sell_price_cents) }); }
    if (event.target.closest('[data-test-label]')) printDymoLabel({ title: 'DYMO test label', subtitle: profile.locations?.name || 'GotCracked', code: 'GC-READY', price: '$0.00' });
    if (event.target.closest('[data-print-ticket]')) { const id = document.querySelector('#operation-form [name="id"]')?.value; const ticket = cache.repairs.find(row => row.id === id); if (ticket) printDymoLabel({ title: `GC-${String(ticket.ticket_number).padStart(6,'0')}`, subtitle: `${ticket.customers?.first_name || ''} ${ticket.customers?.last_name || ''} · ${ticket.devices?.manufacturer || ''} ${ticket.devices?.model || ''}`.trim(), code: friendly(ticket.status), phone: ticket.customers?.phone || '' }); }
    const serviceEdit = event.target.closest('[data-edit-service]'); if (serviceEdit) openOperation('service', cache.services.find(item => item.id === serviceEdit.dataset.editService));
    const promoEdit = event.target.closest('[data-edit-promo]'); if (promoEdit) openOperation('promo', cache.promos.find(item => item.id === promoEdit.dataset.editPromo));
    const mediaEdit = event.target.closest('[data-edit-media]'); if (mediaEdit) openOperation('media', cache.media.find(item => item.id === mediaEdit.dataset.editMedia));
    const mediaSync = event.target.closest('[data-sync-media]'); if (mediaSync) { const status = document.querySelector('#media-sync-status'); mediaSync.disabled = true; status.textContent = `Syncing ${friendly(mediaSync.dataset.syncMedia)}…`; client.functions.invoke('sync-media', { body: { platform: mediaSync.dataset.syncMedia } }).then(({data,error}) => { status.textContent = error ? error.message : `${data.synced} ${friendly(data.platform)} videos synchronized.`; if (!error) loadData(); }).finally(() => { mediaSync.disabled = false; }); }
    if (event.target.closest('[data-deactivate-part]')) { const id = document.querySelector('#operation-form [name="id"]').value; if (confirm('Deactivate this part? Existing work-order history will be preserved.')) client.from('inventory_items').update({active:false}).eq('id',id).then(() => { document.querySelector('#operation-dialog').close(); loadData(); }); }
    if (event.target.closest('[data-deactivate-service]')) { const id = document.querySelector('#operation-form [name="id"]').value; if (confirm('Deactivate this service? Existing work-order history will be preserved.')) client.from('services').update({active:false}).eq('id',id).then(() => { document.querySelector('#operation-dialog').close(); loadData(); }); }
    const removeLine = event.target.closest('[data-remove-work-item]'); if (removeLine && confirm('Remove this line item? Any consumed inventory will be returned automatically.')) { client.from('work_order_items').delete().eq('id',removeLine.dataset.removeWorkItem).then(() => { document.querySelector('#operation-dialog').close(); loadData(); }); }
    const frequentCode = event.target.closest('[data-use-frequent-code]');
    if (frequentCode) { const input = document.querySelector('#operation-form [name="promo_code"]'); if (input) { input.value = frequentCode.dataset.useFrequentCode; input.focus(); } }
    const attachment = event.target.closest('[data-attachment-path]');
    if (attachment) {
      const { data, error } = await client.storage.from('repair-attachments').createSignedUrl(attachment.dataset.attachmentPath, 3600);
      if (error) alert(error.message); else window.open(data.signedUrl, '_blank', 'noopener');
    }
    const repairRow = event.target.closest('[data-ticket]');
    if (repairRow) { const repair = cache.repairs.find(item => String(item.ticket_number) === repairRow.dataset.ticket); if (repair) { event.preventDefault(); event.stopImmediatePropagation(); openOperation('repair', repair); } }
  }, true);
  client.auth.onAuthStateChange(event => { if (['SIGNED_IN','INITIAL_SESSION'].includes(event)) setTimeout(loadData, 0); });
  setTimeout(loadData, 700);
  client.channel('portal-live').on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, loadData).on('postgres_changes', { event: '*', schema: 'public', table: 'repair_tickets' }, loadData).on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, loadData).subscribe();
})();
