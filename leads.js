(() => {
  'use strict';
  let leads = [];
  const client = window.supabaseClient;
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);

  function statusLabel(value) { return value ? value[0].toUpperCase() + value.slice(1) : 'New'; }
  function render() {
    if (window.GotCrackedDirectory?.ownsLeadDirectory) {
      window.GotCrackedDirectory.requestRefresh?.('legacy-leads');
      return;
    }
    const host = document.querySelector('#portal-leads');
    if (!host) return;
    const query = document.querySelector('#lead-search')?.value.toLowerCase() || '';
    const status = document.querySelector('#lead-status')?.value || 'all';
    const shown = leads.filter(lead => (status === 'all' || lead.status === status) && Object.values(lead).join(' ').toLowerCase().includes(query));
    host.innerHTML = shown.length ? shown.map(lead => `
      <button class="lead-row" data-lead-id="${lead.id}">
        <span class="status ${lead.status}">${statusLabel(lead.status)}</span>
        <span class="row-main"><strong>${esc(lead.name)}${lead.intake_method === 'mail_in' ? ' · Mail-in' : ''}</strong><small>${esc(lead.service || 'No service')} · ${esc(lead.source || 'Unknown source')}</small></span>
        <span>${esc(lead.phone || lead.email || '')}</span><small>${new Date(lead.created_at).toLocaleString()}</small><em>›</em>
      </button>`).join('') : '<div class="empty-card"><h2>No matching leads</h2><p>New webhook leads will appear here and in Discord.</p></div>';
    const badge = document.querySelector('#lead-count');
    const activeCount = leads.filter(lead => ['new', 'claimed', 'qualified'].includes(lead.status)).length;
    badge.textContent = activeCount;
    badge.hidden = activeCount === 0;
  }

  async function load() {
    const { data: { session } } = await client.auth.getSession();
    if (!session) return;
    const { data, error } = await client.from('leads').select('*, profiles:assigned_user_id(display_name)').order('created_at', { ascending: false });
    if (!error) { leads = data || []; render(); openLinkedLead(); }
  }

  async function showLead(id) {
    const lead = leads.find(item => item.id === id);
    if (!lead) return;
    const { data: events } = await client.from('lead_events').select('*, profiles:actor_user_id(display_name)').eq('lead_id', id).order('created_at');
    const dialog = document.querySelector('#ticket-detail');
    dialog.querySelector('#ticket-detail-content').innerHTML = `
      <div class="modal-head"><div><p class="eyebrow">Shared with Discord</p><h2>${esc(lead.name)}</h2></div><button class="icon-button" id="close-lead">×</button></div>
      <span class="status ${lead.status}">${statusLabel(lead.status)}</span>
      <div class="ticket-detail"><div class="detail-row"><span>Contact</span><strong>${esc(lead.phone || lead.email || '—')}</strong></div><div class="detail-row"><span>Service</span><strong>${esc(lead.service || '—')}</strong></div><div class="detail-row"><span>Intake</span><strong>${lead.intake_method === 'mail_in' ? 'Mail-in repair' : 'Walk-in / local'}</strong></div>${lead.intake_method === 'mail_in' ? `<div class="detail-row"><span>Return address</span><strong>${esc(lead.shipping_address?.formatted || [lead.shipping_address?.line1, lead.shipping_address?.line2, [lead.shipping_address?.city, lead.shipping_address?.state, lead.shipping_address?.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '—')}</strong></div>` : ''}<div class="detail-row"><span>Owner</span><strong>${esc(lead.profiles?.display_name || 'Unclaimed')}</strong></div><div class="detail-row"><span>Source</span><strong>${esc(lead.source || '—')}</strong></div></div>
      <form id="lead-update-form" class="settings-list"><input type="hidden" name="leadId" value="${lead.id}"><label>Status<select name="status">${['new','claimed','qualified','won','lost'].map(value => `<option value="${value}" ${lead.status === value ? 'selected' : ''}>${statusLabel(value)}</option>`).join('')}</select></label><label>Activity note<textarea name="note" placeholder="Add an internal note"></textarea></label><button class="primary-button" type="submit">Save lead update</button><p class="auth-message" role="status"></p></form>
      <h3>Activity</h3><div class="lead-timeline">${(events || []).map(event => `<p><strong>${esc(event.profiles?.display_name || 'GotCracked bot')}</strong> ${esc(event.message || event.event_type)}<small>${new Date(event.created_at).toLocaleString()}</small></p>`).join('') || '<p>No activity yet.</p>'}</div>`;
    dialog.showModal();
    document.querySelector('#close-lead').onclick = () => dialog.close();
  }

  function openLinkedLead() {
    const match = location.hash.match(/^#leads\/([0-9a-f-]+)$/i);
    if (!match) return;
    document.querySelector('[data-view="leads"]')?.click();
    showLead(match[1]);
  }

  document.querySelector('#lead-search')?.addEventListener('input', render);
  document.querySelector('#lead-status')?.addEventListener('change', render);
  document.addEventListener('click', event => { const row = event.target.closest('[data-lead-id]'); if (row) showLead(row.dataset.leadId); });
  document.addEventListener('submit', async event => {
    if (event.target.id !== 'lead-update-form') return;
    event.preventDefault();
    const form = event.target, data = Object.fromEntries(new FormData(form));
    const message = form.querySelector('.auth-message'); const button = form.querySelector('button'); button.disabled = true;
    const { data: { user } } = await client.auth.getUser();
    const update = await client.from('leads').update({ status: data.status, assigned_user_id: data.status === 'new' ? null : user.id }).eq('id', data.leadId);
    if (!update.error && data.note.trim()) await client.from('lead_events').insert({ lead_id: data.leadId, actor_user_id: user.id, event_type: 'note', message: data.note.trim() });
    if (update.error) { message.textContent = update.error.message; button.disabled = false; return; }
    document.querySelector('#ticket-detail').close(); await load();
  });
  client.auth.onAuthStateChange(event => { if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') setTimeout(load, 0); });
  setTimeout(load, 1000);
})();
