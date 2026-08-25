(() => {
  'use strict';
  const client = window.supabaseClient;
  let profile = null;
  let cache = { appointments: [], customers: [], inventory: [], repairs: [], leads: [], staff: [], services: [], suppliers: [], promos: [], media: [], settings: null };
  const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format((cents || 0) / 100);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const friendly = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
  const mediaIdFromUrl = value => { try { const url = new URL(value); return url.searchParams.get('v') || url.pathname.split('/').filter(Boolean).pop() || crypto.randomUUID(); } catch { return crypto.randomUUID(); } };

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
      .meta{display:flex;justify-content:space-between;gap:8px;font-weight:700}.brand{font-size:6.5pt;color:#31506f;text-transform:uppercase;letter-spacing:.08em}
    </style></head><body><section class="label"><img src="${new URL('assets/gotcracked-mark.png', location.href)}" alt=""><div class="copy"><div class="brand">GotCracked · We fix what life cracks</div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p><div class="meta">${code ? `<span class="code">${esc(code)}</span>` : '<span></span>'}${showPrice && price ? `<span>${esc(price)}</span>` : ''}</div>${showPhone && phone ? `<p>${esc(phone)}</p>` : ''}</div></section><script>addEventListener('load',()=>setTimeout(()=>print(),250));<\/script></body></html>`);
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
    const [appointments, customers, inventory, repairs, leads, staff, services, suppliers, promos, media, settings] = await Promise.all([
      client.from('appointments').select('*, customers(first_name,last_name,phone)').order('preferred_date').limit(100),
      client.from('customers').select('*, devices(id,model,manufacturer,category), repair_tickets(id,status)').order('created_at', { ascending: false }).limit(300),
      client.from('inventory_items').select('*').eq('active', true).order('name').limit(500),
      client.from('repair_tickets').select('*, customers(first_name,last_name,phone), devices(model,manufacturer), profiles:assigned_user_id(display_name), work_order_items(*)').order('created_at', { ascending: false }).limit(300),
      client.from('leads').select('*').order('created_at', { ascending: false }).limit(300),
      canManageStaff ? client.functions.invoke('manage-staff', { body: { action: 'list' } }) : Promise.resolve({ data: { staff: [profile] } }),
      client.from('services').select('*').eq('active', true).order('name'),
      client.from('suppliers').select('*').eq('active', true).order('name'),
      client.from('promo_codes').select('*').order('created_at', { ascending: false }),
      client.from('media_posts').select('*').order('published_at', { ascending: false }),
      client.from('business_settings').select('*').eq('location_id', profile.location_id).maybeSingle()
    ]);
    cache = { appointments: appointments.data || [], customers: customers.data || [], inventory: inventory.data || [], repairs: repairs.data || [], leads: leads.data || [], staff: staff.data?.staff || [], services: services.data || [], suppliers: suppliers.data || [], promos: promos.data || [], media: media.data || [], settings: settings.data || null };
    renderAll();
  }

  function renderDashboard() {
    const open = cache.repairs.filter(ticket => !['completed', 'cancelled'].includes(ticket.status));
    const today = new Date().toISOString().slice(0, 10);
    const todayAppointments = cache.appointments.filter(item => item.preferred_date === today || item.starts_at?.startsWith(today));
    const ready = cache.repairs.filter(ticket => ticket.status === 'ready_for_pickup');
    const completedToday = cache.repairs.filter(ticket => ticket.status === 'completed' && ticket.completed_at?.startsWith(today));
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
    host.innerHTML = `<div class="page-heading"><div><p class="eyebrow">Relationships</p><h1>Customers</h1><p class="subtle">Live customer, device, and repair history.</p></div><button class="primary-button" data-live-action="customer">+ New customer</button></div><div class="card"><div class="toolbar"><div class="search">⌕ <input id="live-customer-search" placeholder="Search name, phone, or device"></div></div><div id="live-customer-list"></div></div>`;
    const draw = query => {
      const filtered = cache.customers.filter(item => JSON.stringify(item).toLowerCase().includes(query.toLowerCase()));
      document.querySelector('#live-customer-list').innerHTML = filtered.map(customer => `<div class="list-row"><div class="avatar">${esc(customer.first_name[0])}${esc(customer.last_name[0])}</div><div class="row-main"><strong>${esc(customer.first_name)} ${esc(customer.last_name)}</strong><small>${esc(customer.phone)} · ${customer.devices?.map(device => `${device.manufacturer || ''} ${device.model}`).join(', ') || 'No devices'}</small></div><small>${customer.repair_tickets?.length || 0} repairs</small></div>`).join('') || '<p class="empty-state">No customers found.</p>';
    };
    draw(''); document.querySelector('#live-customer-search').oninput = event => draw(event.target.value);
  }

  function renderInventory() {
    const host = document.querySelector('#inventory');
    host.innerHTML = `<div class="page-heading"><div><p class="eyebrow">Catalog & stock</p><h1>Inventory</h1><p class="subtle">Parts, services, prices, reorder points, suppliers, and automatic SKUs.</p></div><div class="quick-actions"><button class="primary-button" data-live-action="inventory">+ Add part</button><button class="secondary-button" data-live-action="service">+ Add service</button></div></div><div class="section-tabs"><button class="active" data-catalog-tab="parts">Parts (${cache.inventory.length})</button><button data-catalog-tab="services">Services (${cache.services.length})</button></div><article class="card" id="parts-catalog"><div class="table-wrap"><table><thead><tr><th>Part</th><th>SKU</th><th>On hand</th><th>Reorder</th><th>Cost</th><th>Price</th><th>Supplier</th><th></th></tr></thead><tbody>${cache.inventory.map(item => `<tr><td><strong>${esc(item.name)}</strong><small>${esc(item.category || '')}</small></td><td>${esc(item.sku || 'Auto')}</td><td class="${item.quantity_on_hand <= item.reorder_point ? 'low-stock' : ''}">${item.quantity_on_hand}</td><td>${item.reorder_point}</td><td>${money(item.cost_cents)}</td><td>${money(item.sell_price_cents)}</td><td>${esc(item.supplier_name || '—')}</td><td><button class="text-button" data-print-part="${item.id}">Label</button> <button class="text-button" data-adjust-part="${item.id}">Adjust</button> <button class="text-button" data-edit-part="${item.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>${cache.inventory.length ? '' : '<p class="empty-state">No parts yet.</p>'}</article><article class="card" id="services-catalog" hidden><div class="table-wrap"><table><thead><tr><th>Service</th><th>SKU</th><th>Category</th><th>Cost</th><th>Price</th><th>Taxable</th><th></th></tr></thead><tbody>${cache.services.map(item => `<tr><td><strong>${esc(item.name)}</strong><small>${esc(item.description || '')}</small></td><td>${esc(item.sku)}</td><td>${esc(item.category || '—')}</td><td>${money(item.cost_cents)}</td><td>${money(item.price_cents)}</td><td>${item.taxable ? 'Yes' : 'No'}</td><td><button class="text-button" data-edit-service="${item.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>${cache.services.length ? '' : '<p class="empty-state">No services yet. Add diagnostics, cleaning, labor, or other billable work.</p>'}</article>`;
  }

  function renderReports() {
    const host = document.querySelector('#reports');
    const completed = cache.repairs.filter(item => item.status === 'completed');
    const revenue = completed.reduce((sum, item) => sum + (item.total_cents || item.estimate_cents || 0), 0);
    const won = cache.leads.filter(item => item.status === 'won').length;
    const conversion = cache.leads.length ? Math.round(won / cache.leads.length * 100) : 0;
    const sold = new Map(); cache.repairs.flatMap(item => item.work_order_items || []).filter(item => item.item_type === 'part').forEach(item => sold.set(item.description, (sold.get(item.description) || 0) + Number(item.quantity)));
    const topParts = [...sold.entries()].sort((a,b) => b[1]-a[1]).slice(0,8);
    host.innerHTML = `<div class="page-heading"><div><p class="eyebrow">Business intelligence</p><h1>Reports</h1><p class="subtle">Calculated from live shop records and work-order line items.</p></div></div><div class="module-grid"><article class="card module-stat"><p>Recorded repair value</p><strong>${money(revenue)}</strong><small>${completed.length} completed repairs</small></article><article class="card module-stat"><p>Open repairs</p><strong>${cache.repairs.filter(item => !['completed','cancelled'].includes(item.status)).length}</strong><small>Current workload</small></article><article class="card module-stat"><p>Lead conversion</p><strong>${conversion}%</strong><small>${won} won of ${cache.leads.length}</small></article></div><article class="card"><div class="card-title"><div><h2>Most-used repair parts</h2><p>Quantity added to work orders</p></div></div>${topParts.map(([name,quantity]) => `<div class="list-row"><span class="metric-icon blue">▤</span><div class="row-main"><strong>${esc(name)}</strong><small>Work-order consumption</small></div><strong>${quantity}</strong></div>`).join('') || '<p class="empty-state">Part usage analytics will appear as work orders are built.</p>'}</article>`;
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
      <article class="card"><h2>DYMO label printing</h2><p class="subtle">Print repair and inventory labels through the normal print dialog. Select your installed DYMO LabelWriter when prompted.</p><form id="label-settings-form" class="settings-list"><label>Printer name<input name="label_printer_name" value="${esc(cache.settings?.label_printer_name || 'DYMO LabelWriter')}"></label><label>Label template<select name="label_template"><option value="30252" ${cache.settings?.label_template !== '30336' && cache.settings?.label_template !== '30334' ? 'selected' : ''}>30252 · Address (3.5 × 1.125 in)</option><option value="30336" ${cache.settings?.label_template === '30336' ? 'selected' : ''}>30336 · Small multipurpose (2.125 × 1 in)</option><option value="30334" ${cache.settings?.label_template === '30334' ? 'selected' : ''}>30334 · Medium multipurpose (2.25 × 1.25 in)</option></select></label><label class="toggle-row"><span>Show retail price on inventory labels</span><input name="label_show_price" type="checkbox" ${checked(cache.settings?.label_show_price)}></label><label class="toggle-row"><span>Show customer phone on repair labels</span><input name="label_show_customer_phone" type="checkbox" ${cache.settings?.label_show_customer_phone ? 'checked' : ''}></label><button class="primary-button">Save label settings</button><button type="button" class="secondary-button" data-test-label>Print test label</button><p class="auth-message" role="status"></p></form></article>
      <article class="card"><h2>Access & Discord</h2><div class="settings-list"><label>Your role <span>${esc(friendly(profile.role))}</span></label><label>Discord identity <span>${profile.discord_user_id ? 'Linked' : 'Not linked'}</span></label><label>Portal authority <span>Supabase staff role</span></label></div><button class="secondary-button" data-view="staff">Manage staff access</button></article>
    </div>`;
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

  function renderAll() { renderDashboard(); renderAppointments(); renderCustomers(); renderInventory(); renderReports(); renderSettings(); renderStaffAccess(); }

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
    if (kind === 'lead') content.innerHTML = `${head('Lead pipeline','Create lead')}<input type="hidden" name="kind" value="lead"><div class="form-grid"><label>Customer name<input name="name" required></label><label>Source<input name="source" value="phone" placeholder="Phone, walk-in, referral"></label><label>Phone<input name="phone" inputmode="tel"></label><label>Email<input name="email" type="email"></label><label class="full">Requested service<input name="service" required></label><label class="full">Notes<textarea name="notes"></textarea></label></div><p class="operation-status"></p><div class="modal-actions"><button type="button" class="secondary-button" data-close-operation>Cancel</button><button class="primary-button">Create lead</button></div>`;
    if (kind === 'inventory') { const item = record || {}; content.innerHTML = `${head('Parts & supplies',record ? 'Edit inventory item' : 'Add inventory item')}<input type="hidden" name="kind" value="inventory"><input type="hidden" name="id" value="${item.id || ''}"><div class="form-grid"><label>Part name<input name="name" required value="${esc(item.name || '')}"></label><label>SKU<input name="sku" value="${esc(item.sku || '')}" placeholder="Assigned automatically"></label><label>Category<input name="category" value="${esc(item.category || '')}"></label><label>Supplier<select name="supplier_name"><option value="">No supplier</option>${cache.suppliers.map(s => `<option ${item.supplier_name === s.name ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label><label>Quantity on hand<input name="quantity_on_hand" type="number" min="0" value="${item.quantity_on_hand || 0}" required></label><label>Reorder point<input name="reorder_point" type="number" min="0" value="${item.reorder_point || 0}" required></label><label>Unit cost<input name="cost" type="number" min="0" step="0.01" value="${((item.cost_cents || 0)/100).toFixed(2)}"></label><label>Retail price<input name="price" type="number" min="0" step="0.01" value="${((item.sell_price_cents || 0)/100).toFixed(2)}"></label><label>Supplier SKU<input name="supplier_sku" value="${esc(item.supplier_sku || '')}"></label><label>Order URL<input name="supplier_url" type="url" value="${esc(item.supplier_url || '')}"></label></div><p class="operation-status"></p><div class="modal-actions">${record ? '<button type="button" class="danger-button" data-deactivate-part>Deactivate</button>' : ''}<button type="button" class="secondary-button" data-close-operation>Cancel</button><button class="primary-button">Save part</button></div>`; }
    if (kind === 'adjustment' && record) content.innerHTML = `${head('Inventory movement',`Adjust ${esc(record.name)}`)}<input type="hidden" name="kind" value="adjustment"><input type="hidden" name="id" value="${record.id}"><div class="form-grid"><label>Current quantity<input value="${record.quantity_on_hand}" disabled></label><label>Quantity change<input name="quantity_delta" type="number" step="1" required placeholder="10 to receive, -1 to remove"></label><label class="full">Reason<input name="note" required placeholder="Shipment received, cycle count correction, damaged part"></label></div><p class="operation-status"></p><div class="modal-actions"><button type="button" class="secondary-button" data-close-operation>Cancel</button><button class="primary-button">Apply adjustment</button></div>`;
    if (kind === 'service') { const item = record || {}; content.innerHTML = `${head('Service catalog',record ? 'Edit service' : 'Add service')}<input type="hidden" name="kind" value="service"><input type="hidden" name="id" value="${item.id || ''}"><div class="form-grid"><label>Service name<input name="name" required value="${esc(item.name || '')}"></label><label>SKU<input name="sku" value="${esc(item.sku || '')}" placeholder="Assigned automatically"></label><label>Category<input name="category" value="${esc(item.category || '')}" placeholder="Cleaning, diagnostic, labor"></label><label>Taxable<select name="taxable"><option value="true" ${item.taxable !== false ? 'selected' : ''}>Yes</option><option value="false" ${item.taxable === false ? 'selected' : ''}>No</option></select></label><label>Internal cost<input name="cost" type="number" min="0" step="0.01" value="${((item.cost_cents || 0)/100).toFixed(2)}"></label><label>Customer price<input name="price" type="number" min="0" step="0.01" value="${((item.price_cents || 0)/100).toFixed(2)}"></label><label class="full">Description<textarea name="description">${esc(item.description || '')}</textarea></label></div><p class="operation-status"></p><div class="modal-actions">${record ? '<button type="button" class="danger-button" data-deactivate-service>Deactivate</button>' : ''}<button type="button" class="secondary-button" data-close-operation>Cancel</button><button class="primary-button">Save service</button></div>`; }
    if (kind === 'service') content.querySelector('.form-grid')?.insertAdjacentHTML('beforeend', `<label>Pricing mode<select name="quote_required"><option value="false" ${record?.quote_required ? '' : 'selected'}>Catalog price</option><option value="true" ${record?.quote_required ? 'selected' : ''}>Quote required</option></select></label>`);
    if (kind === 'promo') { const item = record || {}; content.innerHTML = `${head('Pricing controls',record ? 'Edit promo code' : 'Create promo code')}<input type="hidden" name="kind" value="promo"><input type="hidden" name="id" value="${item.id || ''}"><div class="form-grid"><label>Code<input name="code" required maxlength="40" value="${esc(item.code || '')}" placeholder="CRACKED10"></label><label>Discount type<select name="discount_type"><option value="percent" ${item.discount_type !== 'fixed' ? 'selected' : ''}>Percentage</option><option value="fixed" ${item.discount_type === 'fixed' ? 'selected' : ''}>Fixed amount</option></select></label><label>Discount value<input name="discount_value" required type="number" min="0.01" step="0.01" value="${item.discount_value || ''}"></label><label>Maximum discount ($)<input name="maximum_discount" type="number" min="0" step="0.01" value="${item.maximum_discount_cents ? (item.maximum_discount_cents/100).toFixed(2) : ''}"></label><label>Starts<input name="starts_at" type="datetime-local" value="${item.starts_at ? item.starts_at.slice(0,16) : ''}"></label><label>Expires<input name="ends_at" type="datetime-local" value="${item.ends_at ? item.ends_at.slice(0,16) : ''}"></label><label>Usage limit<input name="usage_limit" type="number" min="1" step="1" value="${item.usage_limit || ''}"></label><label>Active<select name="active"><option value="true" ${item.active !== false ? 'selected' : ''}>Yes</option><option value="false" ${item.active === false ? 'selected' : ''}>No</option></select></label><label class="full">Description<input name="description" value="${esc(item.description || '')}" placeholder="Customer-facing discount description"></label></div><p class="operation-status"></p><div class="modal-actions"><button type="button" class="secondary-button" data-close-operation>Cancel</button><button class="primary-button">Save promo code</button></div>`; }
    if (kind === 'media') { const item = record || {}; content.innerHTML = `${head('Customer website',record ? 'Edit video' : 'Publish a video')}<input type="hidden" name="kind" value="media"><input type="hidden" name="id" value="${item.id || ''}"><input type="hidden" name="external_id" value="${esc(item.external_id || '')}"><div class="form-grid"><label>Platform<select name="platform"><option value="youtube" ${item.platform !== 'tiktok' ? 'selected' : ''}>YouTube</option><option value="tiktok" ${item.platform === 'tiktok' ? 'selected' : ''}>TikTok</option></select></label><label>Published<select name="active"><option value="true" ${item.active !== false ? 'selected' : ''}>Yes</option><option value="false" ${item.active === false ? 'selected' : ''}>Hidden</option></select></label><label class="full">Video title<input name="title" required value="${esc(item.title || '')}"></label><label class="full">Public video URL<input name="public_url" type="url" required value="${esc(item.public_url || '')}"></label><label class="full">Thumbnail URL<input name="thumbnail_url" type="url" value="${esc(item.thumbnail_url || '')}" placeholder="Optional image URL"></label><label>Published date<input name="published_at" type="datetime-local" value="${item.published_at ? item.published_at.slice(0,16) : ''}"></label></div><p class="operation-status"></p><div class="modal-actions"><button type="button" class="secondary-button" data-close-operation>Cancel</button><button class="primary-button">Save video</button></div>`; }
    if (kind === 'repair' && record) { const lines = record.work_order_items || []; const catalog = [...cache.inventory.map(item => ({...item, type:'part', price_cents:item.sell_price_cents})), ...cache.services.map(item => ({...item, type:'service'}))]; content.innerHTML = `${head(`GC-${String(record.ticket_number).padStart(6,'0')}`,'Update repair')}<input type="hidden" name="kind" value="repair"><input type="hidden" name="id" value="${record.id}"><div class="form-grid"><label>Status<select name="status">${['checked_in','in_diagnosis','awaiting_approval','waiting_on_parts','in_repair','ready_for_pickup','completed','cancelled'].map(value => `<option value="${value}" ${record.status === value ? 'selected' : ''}>${friendly(value)}</option>`).join('')}</select></label><label>Assigned to<select name="assigned_user_id"><option value="">Unassigned</option>${cache.staff.map(item => `<option value="${item.id}" ${record.assigned_user_id === item.id ? 'selected' : ''}>${esc(item.display_name)}</option>`).join('')}</select></label><label>Priority<select name="priority">${['normal','high','urgent'].map(value => `<option ${record.priority === value ? 'selected' : ''}>${friendly(value)}</option>`).join('')}</select></label><label>Legacy estimate<input name="estimate" type="number" min="0" step="0.01" value="${((record.estimate_cents || 0)/100).toFixed(2)}"></label><label class="full">Customer-visible note<textarea name="public_notes">${esc(record.public_notes || '')}</textarea></label><label class="full">Internal notes<textarea name="internal_notes">${esc(record.internal_notes || '')}</textarea></label></div><section class="work-order-builder"><div class="card-title"><div><h3>Parts & services</h3><p>Line items set the repair total and consume inventory.</p></div></div>${lines.map(line => `<div class="list-row"><div class="row-main"><strong>${esc(line.description)}</strong><small>${esc(line.sku || line.item_type)} · ${line.quantity} × ${money(line.unit_price_cents)}</small></div><strong>${money(Math.round(line.quantity * line.unit_price_cents))}</strong><button type="button" class="icon-button" data-remove-work-item="${line.id}" aria-label="Remove line">×</button></div>`).join('') || '<p class="empty-state">No parts or services added.</p>'}<div class="form-grid"><label class="full">Add catalog item<select name="catalog_item"><option value="">Choose a part or service</option>${catalog.map(item => `<option value="${item.type}:${item.id}">${item.type === 'part' ? 'PART' : 'SERVICE'} · ${esc(item.sku)} · ${esc(item.name)} · ${money(item.price_cents)}</option>`).join('')}</select></label><label>Quantity<input name="catalog_quantity" type="number" min="1" step="1" value="1"></label><label>Consume inventory<select name="inventory_applied"><option value="true">Yes</option><option value="false">Reserve later</option></select></label></div><div class="ticket-totals"><span>Subtotal <strong>${money(record.subtotal_cents)}</strong></span><span>Tax <strong>${money(record.tax_cents)}</strong></span><span>Total <strong>${money(record.total_cents)}</strong></span></div></section><p class="operation-status"></p><div class="modal-actions"><button type="button" class="secondary-button" data-close-operation>Cancel</button><button class="primary-button">Save repair & line item</button></div>`; }
    if (kind === 'repair' && record) {
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
    const button = form.querySelector('button.primary-button'); const status = form.querySelector('.operation-status');
    button.disabled = true; status.textContent = '';
    let result;
    if (data.kind === 'customer') result = await client.from('customers').insert({ location_id: profile.location_id, first_name: data.first_name.trim(), last_name: data.last_name.trim(), phone: data.phone.trim(), email: data.email.trim() || null });
    if (data.kind === 'lead') result = await client.functions.invoke('create-lead', { body: { name: data.name.trim(), phone: data.phone.trim() || null, email: data.email.trim() || null, service: data.service.trim(), source: data.source.trim() || 'portal', notes: data.notes.trim() || null } });
    if (data.kind === 'inventory') { const payload = { location_id: profile.location_id, name: data.name.trim(), sku: data.sku.trim() || null, category: data.category.trim() || null, supplier_name: data.supplier_name || null, supplier_sku: data.supplier_sku.trim() || null, supplier_url: data.supplier_url.trim() || null, quantity_on_hand: Number(data.quantity_on_hand), reorder_point: Number(data.reorder_point), cost_cents: Math.round(Number(data.cost || 0) * 100), sell_price_cents: Math.round(Number(data.price || 0) * 100) }; if (data.id) delete payload.quantity_on_hand; result = data.id ? await client.from('inventory_items').update(payload).eq('id', data.id) : await client.from('inventory_items').insert(payload); }
    if (data.kind === 'adjustment') result = await client.rpc('adjust_inventory', { target_item: data.id, quantity_delta: Number(data.quantity_delta), adjustment_note: data.note.trim() });
    if (data.kind === 'service') { const payload = { location_id: profile.location_id, name: data.name.trim(), sku: data.sku.trim() || null, category: data.category.trim() || null, description: data.description.trim() || null, taxable: data.taxable === 'true', quote_required: data.quote_required === 'true', cost_cents: Math.round(Number(data.cost || 0) * 100), price_cents: Math.round(Number(data.price || 0) * 100) }; result = data.id ? await client.from('services').update(payload).eq('id', data.id) : await client.from('services').insert(payload); }
    if (data.kind === 'promo') { const payload = { location_id: profile.location_id, code: data.code.trim().toUpperCase(), description: data.description.trim() || null, discount_type: data.discount_type, discount_value: Number(data.discount_value), maximum_discount_cents: data.maximum_discount ? Math.round(Number(data.maximum_discount) * 100) : null, starts_at: data.starts_at ? new Date(data.starts_at).toISOString() : null, ends_at: data.ends_at ? new Date(data.ends_at).toISOString() : null, usage_limit: data.usage_limit ? Number(data.usage_limit) : null, active: data.active === 'true' }; result = data.id ? await client.from('promo_codes').update(payload).eq('id', data.id) : await client.from('promo_codes').insert(payload); }
    if (data.kind === 'media') { const payload = { location_id: profile.location_id, platform: data.platform, external_id: data.external_id || mediaIdFromUrl(data.public_url), title: data.title.trim(), public_url: data.public_url.trim(), thumbnail_url: data.thumbnail_url.trim() || null, published_at: data.published_at ? new Date(data.published_at).toISOString() : new Date().toISOString(), active: data.active === 'true' }; result = data.id ? await client.from('media_posts').update(payload).eq('id', data.id) : await client.from('media_posts').insert(payload); }
    if (data.kind === 'repair') {
      let newLine = null;
      if (data.catalog_item) {
        const [type,id] = data.catalog_item.split(':'); const source = type === 'part' ? cache.inventory.find(item => item.id === id) : cache.services.find(item => item.id === id);
        const customPrice = String(data.override_price || '').trim();
        newLine = { item_type: type, catalog_id: id, description: source.name, quantity: Number(data.catalog_quantity || 1), unit_price_cents: customPrice ? Math.round(Number(customPrice) * 100) : (source.sell_price_cents ?? source.price_cents ?? 0), taxable: source.taxable !== false, inventory_applied: type === 'part' && data.inventory_applied === 'true', price_overridden: Boolean(customPrice) };
      }
      result = await client.rpc('save_work_order', { target_ticket: data.id, ticket_changes: { status: data.status, assigned_user_id: data.assigned_user_id || '', priority: data.priority, public_notes: data.public_notes.trim(), internal_notes: data.internal_notes.trim() }, new_line: newLine, manual_discount_cents: Math.round(Number(data.manual_discount || 0) * 100), manual_discount_reason: data.discount_reason?.trim() || null, entered_promo_code: data.promo_code?.trim() || null });
    }
    if (result?.error) { status.textContent = result.error.message; button.disabled = false; return; }
    form.closest('dialog').close(); form.reset(); await loadData();
  }

  document.querySelector('#ticket-form')?.addEventListener('submit', createRepair);
  document.querySelector('#operation-form')?.addEventListener('submit', saveOperation);
  document.addEventListener('submit', async event => {
    if (!['business-settings-form','work-order-settings-form','inventory-settings-form','media-settings-form','label-settings-form'].includes(event.target.id)) return;
    event.preventDefault(); const form = event.target; const data = Object.fromEntries(new FormData(form)); const message = form.querySelector('.auth-message');
    let payload = { location_id: profile.location_id };
    if (form.id === 'business-settings-form') payload = { ...payload, currency_code: data.currency_code, sales_tax_rate: Number(data.sales_tax_rate || 0), default_markup_percent: Number(data.default_markup_percent || 0), warranty_months: Number(data.warranty_months || 0) };
    if (form.id === 'work-order-settings-form') payload = { ...payload, allow_manager_price_overrides: form.elements.allow_manager_price_overrides.checked, allow_manager_manual_discounts: form.elements.allow_manager_manual_discounts.checked, require_discount_reason: form.elements.require_discount_reason.checked, consume_inventory_on_add: form.elements.consume_inventory_on_add.checked };
    if (form.id === 'inventory-settings-form') payload = { ...payload, part_sku_prefix: data.part_sku_prefix.trim().toUpperCase(), service_sku_prefix: data.service_sku_prefix.trim().toUpperCase(), default_reorder_point: Number(data.default_reorder_point || 0) };
    if (form.id === 'media-settings-form') payload = { ...payload, youtube_channel_url: data.youtube_channel_url.trim() || null, youtube_channel_id: data.youtube_channel_id.trim() || null, tiktok_profile_url: data.tiktok_profile_url.trim() || null };
    if (form.id === 'label-settings-form') payload = { ...payload, label_printer_name: data.label_printer_name.trim() || 'DYMO LabelWriter', label_template: data.label_template, label_show_price: form.elements.label_show_price.checked, label_show_customer_phone: form.elements.label_show_customer_phone.checked };
    const { error } = await client.from('business_settings').upsert(payload, { onConflict: 'location_id' }); message.textContent = error ? error.message : 'Settings saved.'; if (!error) loadData();
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
    if (event.target.closest('[data-close-operation]')) document.querySelector('#operation-dialog')?.close();
    const tab = event.target.closest('[data-catalog-tab]'); if (tab) { document.querySelectorAll('[data-catalog-tab]').forEach(item => item.classList.toggle('active', item === tab)); document.querySelector('#parts-catalog').hidden = tab.dataset.catalogTab !== 'parts'; document.querySelector('#services-catalog').hidden = tab.dataset.catalogTab !== 'services'; }
    const partEdit = event.target.closest('[data-edit-part]'); if (partEdit) openOperation('inventory', cache.inventory.find(item => item.id === partEdit.dataset.editPart));
    const partAdjust = event.target.closest('[data-adjust-part]'); if (partAdjust) openOperation('adjustment', cache.inventory.find(item => item.id === partAdjust.dataset.adjustPart));
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
    const repairRow = event.target.closest('[data-ticket]');
    if (repairRow) { const repair = cache.repairs.find(item => String(item.ticket_number) === repairRow.dataset.ticket); if (repair) { event.preventDefault(); event.stopImmediatePropagation(); openOperation('repair', repair); } }
  }, true);
  client.auth.onAuthStateChange(event => { if (['SIGNED_IN','INITIAL_SESSION'].includes(event)) setTimeout(loadData, 0); });
  setTimeout(loadData, 700);
  client.channel('portal-live').on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, loadData).on('postgres_changes', { event: '*', schema: 'public', table: 'repair_tickets' }, loadData).on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, loadData).subscribe();
})();
