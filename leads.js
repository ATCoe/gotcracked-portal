(() => {
  'use strict';
  let leads = [];
  const client = window.supabaseClient;

  function statusLabel(value) { return value ? value[0].toUpperCase() + value.slice(1) : 'New'; }
  function render() {
    const host = document.querySelector('#portal-leads');
    if (!host) return;
    const query = document.querySelector('#lead-search')?.value.toLowerCase() || '';
    const status = document.querySelector('#lead-status')?.value || 'all';
    const shown = leads.filter(lead => (status === 'all' || lead.status === status) && Object.values(lead).join(' ').toLowerCase().includes(query));
    host.innerHTML = shown.length ? shown.map(lead => `
      <button class="lead-row" data-lead-id="${lead.id}">
        <span class="status ${lead.status}">${statusLabel(lead.status)}</span>
        <span class="row-main"><strong>${lead.name}</strong><small>${lead.service || 'No service'} · ${lead.source || 'Unknown source'}</small></span>
        <span>${lead.phone || lead.email || ''}</span><small>${new Date(lead.created_at).toLocaleString()}</small><em>›</em>
      </button>`).join('') : '<div class="empty-card"><h2>No matching leads</h2><p>New webhook leads will appear here and in Discord.</p></div>';
    document.querySelector('#lead-count').textContent = leads.filter(lead => ['new', 'claimed', 'qualified'].includes(lead.status)).length;
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
      <div class="modal-head"><div><p class="eyebrow">Shared with Discord</p><h2>${lead.name}</h2></div><button class="icon-button" id="close-lead">×</button></div>
      <span class="status ${lead.status}">${statusLabel(lead.status)}</span>
      <div class="ticket-detail"><div class="detail-row"><span>Contact</span><strong>${lead.phone || lead.email || '—'}</strong></div><div class="detail-row"><span>Service</span><strong>${lead.service || '—'}</strong></div><div class="detail-row"><span>Owner</span><strong>${lead.profiles?.display_name || 'Unclaimed'}</strong></div><div class="detail-row"><span>Source</span><strong>${lead.source || '—'}</strong></div></div>
      <h3>Activity</h3><div class="lead-timeline">${(events || []).map(event => `<p><strong>${event.profiles?.display_name || 'GotCracked bot'}</strong> ${event.message || event.event_type}<small>${new Date(event.created_at).toLocaleString()}</small></p>`).join('') || '<p>No activity yet.</p>'}</div>`;
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
  client.auth.onAuthStateChange(event => { if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') setTimeout(load, 0); });
  setTimeout(load, 1000);
})();
