(() => {
  'use strict';
  const client = window.supabaseClient;
  let profile = null;
  let repairs = [];
  let leads = [];
  let settings = null;

  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const friendly = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
  const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((cents || 0) / 100);
  const addressText = address => address?.formatted || [address?.line1, address?.line2, [address?.city, address?.state, address?.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const trackingUrl = (carrier, tracking) => {
    if (!tracking) return '';
    const encoded = encodeURIComponent(tracking);
    if (/ups/i.test(carrier || '')) return `https://www.ups.com/track?tracknum=${encoded}`;
    if (/fedex/i.test(carrier || '')) return `https://www.fedex.com/fedextrack/?trknbr=${encoded}`;
    return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encoded}`;
  };

  function render() {
    const host = document.querySelector('#shipping-workspace');
    if (!host) return;
    const active = repairs.filter(ticket => !['delivered', 'not_applicable'].includes(ticket.shipping_status));
    const waitingLeads = leads.filter(lead => ['new', 'claimed', 'qualified'].includes(lead.status));
    const returns = repairs.filter(ticket => ['return_label_ready', 'outbound_in_transit'].includes(ticket.shipping_status));
    const badge = document.querySelector('#shipping-count');
    const count = active.length + waitingLeads.length;
    if (badge) { badge.textContent = count; badge.hidden = count === 0; }

    host.innerHTML = `
      <section class="module-grid shipping-metrics">
        <article class="card module-stat"><p>Mail-in requests</p><strong>${waitingLeads.length}</strong><small>Awaiting intake or qualification</small></article>
        <article class="card module-stat"><p>Packages in progress</p><strong>${active.length}</strong><small>Inbound through delivered</small></article>
        <article class="card module-stat"><p>Returns to prepare</p><strong>${returns.length}</strong><small>Labels ready or outbound</small></article>
        <article class="card module-stat"><p>Shipping billed</p><strong>${money(repairs.reduce((sum, ticket) => sum + (ticket.shipping_charge_cents || 0), 0))}</strong><small>Work-order shipping lines</small></article>
      </section>
      <section class="shipping-grid">
        <article class="card"><div class="card-title"><div><h2>Package board</h2><p>Open a repair to update tracking, insurance, weight, and charges.</p></div></div>
          <div class="shipping-list">${repairs.length ? repairs.map(ticket => {
            const inbound = trackingUrl(ticket.inbound_carrier, ticket.inbound_tracking);
            const outbound = trackingUrl(ticket.outbound_carrier, ticket.outbound_tracking);
            return `<button class="shipping-row" data-ticket="${ticket.ticket_number}"><span class="shipping-status status-${esc(ticket.shipping_status)}">${esc(friendly(ticket.shipping_status))}</span><span class="row-main"><strong>GC-${String(ticket.ticket_number).padStart(6, '0')} · ${esc([ticket.customers?.first_name, ticket.customers?.last_name].filter(Boolean).join(' ') || 'Customer')}</strong><small>${esc([ticket.devices?.manufacturer, ticket.devices?.model].filter(Boolean).join(' ') || 'Device')} · ${esc(addressText(ticket.shipping_address) || 'Return address needed')}</small></span><span class="tracking-links">${inbound ? `<a href="${inbound}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Inbound ↗</a>` : ''}${outbound ? `<a href="${outbound}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Outbound ↗</a>` : ''}</span><em>›</em></button>`;
          }).join('') : '<p class="empty-state">No mail-in repair tickets yet.</p>'}</div>
        </article>
        <aside class="shipping-side">
          <article class="card"><div class="card-title"><div><h2>New mail-in requests</h2><p>Qualify these leads before the customer ships.</p></div></div>${waitingLeads.map(lead => `<button class="shipping-lead" data-lead-id="${lead.id}"><span class="status ${esc(lead.status)}">${esc(friendly(lead.status))}</span><span><strong>${esc(lead.name)}</strong><small>${esc(lead.device_model || lead.service || 'Device repair')}</small></span><em>›</em></button>`).join('') || '<p class="empty-state">No open mail-in requests.</p>'}</article>
          <article class="card shipping-tools"><h2>Carrier tools</h2><p class="subtle">Create labels with your selected carrier, then save the tracking number on the repair.</p><a href="https://ship.pirateship.com/" target="_blank" rel="noopener">Pirate Ship ↗</a><a href="https://www.usps.com/ship/" target="_blank" rel="noopener">USPS ↗</a><a href="https://www.ups.com/ship" target="_blank" rel="noopener">UPS ↗</a><a href="https://www.fedex.com/en-us/shipping.html" target="_blank" rel="noopener">FedEx ↗</a></article>
        </aside>
      </section>`;
  }

  function addSettingsPanel() {
    const host = document.querySelector('#settings');
    if (!host || host.querySelector('#shipping-settings-form') || !settings) return;
    const address = settings.shipping_return_address || {};
    host.insertAdjacentHTML('beforeend', `<article class="card settings-card shipping-settings"><div class="card-title"><div><h2>Mail-in repairs & shipping</h2><p>Public return address, carrier defaults, fees, and customer packing instructions.</p></div></div><form id="shipping-settings-form" class="settings-list"><label class="switch-row"><span>Accept mail-in repair requests</span><input name="accepts_mail_in_repairs" type="checkbox" ${settings.accepts_mail_in_repairs !== false ? 'checked' : ''}></label><div class="form-grid"><label>Default carrier<select name="default_shipping_carrier">${['USPS','UPS','FedEx','Other'].map(item => `<option ${settings.default_shipping_carrier === item ? 'selected' : ''}>${item}</option>`).join('')}</select></label><label>Default customer shipping charge<input name="default_shipping_charge" type="number" min="0" step="0.01" value="${((settings.default_shipping_charge_cents || 0)/100).toFixed(2)}"></label><label>Address line 1<input name="line1" required value="${esc(address.line1 || '700 North Main St')}"></label><label>Address line 2<input name="line2" value="${esc(address.line2 || 'Ste D')}"></label><label>City<input name="city" required value="${esc(address.city || 'Blacksburg')}"></label><label>State<input name="state" required maxlength="2" value="${esc(address.state || 'VA')}"></label><label>ZIP code<input name="postal_code" required value="${esc(address.postal_code || '24060')}"></label><label>Country<input name="country" required value="${esc(address.country || 'US')}"></label><label class="full">Customer packing instructions<textarea name="mail_in_instructions" required>${esc(settings.mail_in_instructions || '')}</textarea></label></div><button class="primary-button" type="submit">Save shipping settings</button><p class="auth-message" role="status"></p></form></article>`);
  }

  async function load() {
    const { data: { user } } = await client.auth.getUser();
    if (!user) return;
    const profileResult = await client.from('profiles').select('id,location_id,role').eq('id', user.id).maybeSingle();
    if (!profileResult.data) return;
    profile = profileResult.data;
    const [repairResult, leadResult, settingsResult] = await Promise.all([
      client.from('repair_tickets').select('id,ticket_number,intake_method,shipping_status,shipping_address,inbound_carrier,inbound_tracking,outbound_carrier,outbound_tracking,shipping_charge_cents,customers(first_name,last_name),devices(manufacturer,model)').eq('intake_method', 'mail_in').order('updated_at', { ascending: false }),
      client.from('leads').select('id,name,status,service,device_model,shipping_address').eq('intake_method', 'mail_in').order('created_at', { ascending: false }),
      client.from('business_settings').select('*').eq('location_id', profile.location_id).maybeSingle()
    ]);
    repairs = repairResult.data || [];
    leads = leadResult.data || [];
    settings = settingsResult.data || { location_id: profile.location_id, accepts_mail_in_repairs: true, default_shipping_carrier: 'USPS', default_shipping_charge_cents: 0, shipping_return_address: { line1: '700 North Main St', line2: 'Ste D', city: 'Blacksburg', state: 'VA', postal_code: '24060', country: 'US' } };
    render();
    setTimeout(addSettingsPanel, 150);
  }

  document.addEventListener('submit', async event => {
    if (event.target.id !== 'shipping-settings-form') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const form = event.target;
    const data = Object.fromEntries(new FormData(form));
    const message = form.querySelector('.auth-message');
    const payload = {
      location_id: profile.location_id,
      accepts_mail_in_repairs: form.elements.accepts_mail_in_repairs.checked,
      default_shipping_carrier: data.default_shipping_carrier,
      default_shipping_charge_cents: Math.round(Number(data.default_shipping_charge || 0) * 100),
      shipping_return_address: { line1: data.line1.trim(), line2: data.line2.trim() || null, city: data.city.trim(), state: data.state.trim().toUpperCase(), postal_code: data.postal_code.trim(), country: data.country.trim().toUpperCase() },
      mail_in_instructions: data.mail_in_instructions.trim()
    };
    const { error } = await client.from('business_settings').upsert(payload, { onConflict: 'location_id' });
    message.textContent = error ? error.message : 'Shipping settings saved.';
    if (!error) { settings = { ...settings, ...payload }; }
  }, true);

  const observer = new MutationObserver(() => addSettingsPanel());
  const settingsHost = document.querySelector('#settings');
  if (settingsHost) observer.observe(settingsHost, { childList: true });
  client.auth.onAuthStateChange(event => { if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') setTimeout(load, 250); });
  client.channel('shipping-live').on('postgres_changes', { event: '*', schema: 'public', table: 'repair_tickets' }, load).on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, load).subscribe();
  setTimeout(load, 1100);
})();
