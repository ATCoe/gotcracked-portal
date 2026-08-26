(() => {
  'use strict';

  const client = window.supabaseClient;
  if (!client) return;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const friendly = value => String(value || '').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
  const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
  let handling = false;
  let lastHandled = '';

  function parse() {
    const match = location.hash.match(/^#(work-order|repairs|leads|appointments)\/([0-9a-f-]+)$/i);
    if (!match) return null;
    const type = match[1].toLowerCase() === 'repairs' ? 'work-order' : match[1].toLowerCase();
    return { type, id:match[2], hash:location.hash };
  }

  async function waitFor(test, timeout=9000) {
    const started = Date.now();
    while (Date.now()-started < timeout) {
      const value = test();
      if (value) return value;
      await delay(100);
    }
    return null;
  }

  function keepHash(hash) {
    if (location.hash !== hash) history.replaceState(null,'',hash);
  }

  async function openWorkOrder(id, hash) {
    const ops = await waitFor(() => window.GotCrackedOperationsV1?.openWorkOrder && window.GotCrackedOperationsV1);
    if (!ops) throw new Error('Work-order runtime is not available.');
    let ticket = ops.state?.workOrders?.find(item => String(item.id) === String(id));
    if (!ticket && typeof ops.reload === 'function') {
      await ops.reload();
      ticket = ops.state?.workOrders?.find(item => String(item.id) === String(id));
    }
    if (!ticket) throw new Error('That work order could not be found or is not available to your account.');
    ops.openWorkOrder(id);
    keepHash(hash);
  }

  async function openLead(id, hash) {
    window.GotCrackedUI?.activateView?.('leads',{updateHash:false});
    await window.GotCrackedRuntime?.ensureView?.('leads');

    const row = await waitFor(() => document.querySelector(`[data-v1-lead="${CSS.escape(id)}"], [data-lead-id="${CSS.escape(id)}"]`),4500);
    if (row) {
      row.click();
      keepHash(hash);
      return;
    }

    const result = await client.from('leads').select('id,name,phone,email,service,customer_issue,source,pipeline_status,status,intake_method,preferred_date,preferred_time,appointment_id,converted_ticket_id,created_at').eq('id',id).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) throw new Error('That lead could not be found or is not available to your account.');
    const lead = result.data;
    showEntityDialog({
      eyebrow:'Lead',
      title:lead.name || 'Lead',
      status:lead.pipeline_status || lead.status,
      rows:[
        ['Contact',[lead.phone,lead.email].filter(Boolean).join(' · ') || '—'],
        ['Service / issue',lead.customer_issue || lead.service || '—'],
        ['Source',lead.source || '—'],
        ['Intake',lead.intake_method === 'mail_in' ? 'Mail-in repair' : 'Walk-in / local'],
        ['Preferred time',[lead.preferred_date,lead.preferred_time].filter(Boolean).join(' · ') || '—']
      ],
      links:[
        lead.appointment_id ? ['Open appointment',`#appointments/${lead.appointment_id}`] : null,
        lead.converted_ticket_id ? ['Open work order',`#work-order/${lead.converted_ticket_id}`] : null
      ].filter(Boolean)
    });
    keepHash(hash);
  }

  async function fetchAppointment(id) {
    let result = await client.from('appointments').select('*, customers(first_name,last_name,phone,email), leads(id,name,phone,email,converted_ticket_id)').eq('id',id).maybeSingle();
    if (!result.error) return result;
    result = await client.from('appointments').select('*').eq('id',id).maybeSingle();
    return result;
  }

  async function openAppointment(id, hash) {
    window.GotCrackedUI?.activateView?.('appointments',{updateHash:false});
    const result = await fetchAppointment(id);
    if (result.error) throw result.error;
    const appointment = result.data;
    if (!appointment) throw new Error('That appointment could not be found or is not available to your account.');
    const lead = appointment.leads || null;
    const customer = appointment.customers || null;
    const customerName = lead?.name || [customer?.first_name,customer?.last_name].filter(Boolean).join(' ') || 'Appointment';
    const contact = [lead?.phone || customer?.phone, lead?.email || customer?.email].filter(Boolean).join(' · ') || '—';
    showEntityDialog({
      eyebrow:'Appointment',
      title:customerName,
      status:appointment.status,
      rows:[
        ['Date / time',appointment.starts_at ? new Date(appointment.starts_at).toLocaleString() : [appointment.preferred_date,appointment.preferred_time].filter(Boolean).join(' · ') || 'To be scheduled'],
        ['Contact',contact],
        ['Device',appointment.device_description || '—'],
        ['Service requested',appointment.service_requested || '—'],
        ['Service mode',appointment.service_mode === 'mail_in' ? 'Mail-in' : 'Walk-in / local'],
        ['Notes',appointment.notes || '—']
      ],
      links:[
        appointment.lead_id ? ['Open lead',`#leads/${appointment.lead_id}`] : null,
        lead?.converted_ticket_id ? ['Open work order',`#work-order/${lead.converted_ticket_id}`] : null
      ].filter(Boolean)
    });
    keepHash(hash);
  }

  function showEntityDialog({eyebrow,title,status,rows,links=[]}) {
    const dialog = document.getElementById('ticket-detail');
    const content = document.getElementById('ticket-detail-content');
    if (!dialog || !content) return;
    if (dialog.open) dialog.close();
    content.innerHTML = `<div class="modal-head"><div><p class="eyebrow">${esc(eyebrow)}</p><h2>${esc(title)}</h2></div><button class="icon-button" type="button" data-gc-close-deep-link aria-label="Close">×</button></div>
      ${status ? `<span class="status">${esc(friendly(status))}</span>` : ''}
      <div class="ticket-detail">${rows.map(([label,value])=>`<div class="detail-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')}</div>
      ${links.length ? `<div class="modal-actions">${links.map(([label,href])=>`<a class="secondary-button" href="${esc(href)}">${esc(label)}</a>`).join('')}</div>` : ''}`;
    dialog.showModal();
    content.querySelector('[data-gc-close-deep-link]')?.addEventListener('click',()=>dialog.close(),{once:true});
  }

  async function handle({force=false}={}) {
    const route = parse();
    if (!route || handling) return;
    if (!force && lastHandled === route.hash) return;
    handling = true;
    try {
      if (route.type === 'work-order') await openWorkOrder(route.id,route.hash);
      if (route.type === 'leads') await openLead(route.id,route.hash);
      if (route.type === 'appointments') await openAppointment(route.id,route.hash);
      lastHandled = route.hash;
    } catch (error) {
      console.error('Portal deep link failed:',error);
      window.GotCrackedDiagnostics?.error?.(error,{context:'Unable to open linked Portal record',duration:16000});
    } finally { handling = false; }
  }

  window.addEventListener('hashchange',()=>handle({force:true}));
  window.addEventListener('popstate',()=>handle({force:true}));
  document.addEventListener('gc-portal-runtime-ready',()=>handle({force:true}),{once:true});
  setTimeout(()=>handle({force:true}),1800);

  window.GotCrackedDeepLinks = { open:hash => { location.hash=hash; return handle({force:true}); } };
})();