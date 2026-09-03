(() => {
  'use strict';

  /* Staff-facing live diagnostics. Known signatures receive stable codes and
     plain-language explanations. Unknown signatures stay explicitly unknown
     and are queued for Marlon to investigate instead of being guessed. */
  const diagnostics = (() => {
    let sequence = 0;
    const normalize = value => String(value?.message || value || 'Unknown error').replace(/\s+/g,' ').trim().slice(0,500);
    const catalog = [
      {code:'GC-AUTH-001',title:'Portal session expired',match:/\b(jwt|token|session).*(expired|invalid)|invalid.*(jwt|token)|auth session missing\b/i,description:'Your Portal sign-in session could not be verified. Reconnect or sign in again, then retry the action.'},
      {code:'GC-PERM-001',title:'Portal permission blocked',match:/\b(permission denied|not authorized|forbidden|row.level security|rls|42501)\b/i,description:'Your signed-in account is not allowed to perform this action. If the action should be available for your role, Marlon needs to check the permission rule.'},
      {code:'GC-NET-001',title:'Portal connection interrupted',match:/\b(failed to fetch|networkerror|network error|load failed|connection.*(lost|failed)|timed?\s*out|timeout)\b/i,description:'The Portal could not complete a network request. Check connectivity and retry; Marlon will investigate if it keeps happening.'},
      {code:'GC-SYNC-001',title:'Live sync disconnected',match:/\b(realtime|websocket|channel_error|channel error|timed_out|subscription).*(failed|closed|error|timeout|disconnected)|\bchannel_error\b/i,description:'The live cross-user sync connection dropped. Portal should reconnect automatically; refresh if data remains stale.'},
      {code:'GC-DATA-001',title:'Duplicate record blocked',match:/\b(23505|duplicate key|unique constraint|already exists)\b/i,description:'Portal prevented a duplicate record from being saved. Review the existing record before trying again.'},
      {code:'GC-DATA-002',title:'Related record is missing',match:/\b(23503|foreign key constraint|violates foreign key)\b/i,description:'This save depends on another record that is missing or no longer available. Refresh the Portal and retry from the current record.'},
      {code:'GC-DATA-003',title:'Required data is missing',match:/\b(23502|not.null constraint|null value in column)\b/i,description:'Portal could not save because a required value was missing. Reopen the form and confirm the required fields before retrying.'},
      {code:'GC-DATA-004',title:'Portal data rule blocked the save',match:/\b(23514|violates check constraint|check constraint)\b/i,description:'Portal rejected this save because it violated a database integrity rule. The action was not applied; Marlon should inspect the rule and attempted value.'},
      {code:'GC-RUNTIME-001',title:'Portal feature is still loading',match:/guided intake is still loading|staff profile is not ready|has not finished loading yet/i,description:'The requested Portal feature has not finished loading. Wait a moment and try again; refresh if it does not become available.'},
      {code:'GC-RUNTIME-002',title:'Portal module failed to load',match:/\b(failed to load .*module|failed to load .*script|runtime failed to load|failed to load [\w./-]+\.js)\b/i,description:'A Portal code module did not load correctly. Refresh once; if it repeats, Marlon should inspect the failed module and deployment.'}
    ];
    const classify = (message,context) => {
      const source = `${context} ${message}`;
      const known = catalog.find(item => item.match.test(source));
      return known || null;
    };
    const queueUnknown = detail => {
      const queue = window.GotCrackedDiagnosticLearningQueue ||= [];
      queue.push(detail);
      while(queue.length>12)queue.shift();
      document.dispatchEvent(new CustomEvent('gc-diagnostic-learning-needed',{detail}));
    };
    const ensureHost = () => {
      let host = document.getElementById('gc-diagnostic-stack');
      if (host) return host;
      host = document.createElement('section');
      host.id = 'gc-diagnostic-stack';
      host.className = 'gc-diagnostic-stack';
      host.setAttribute('aria-label','Portal diagnostics');
      host.setAttribute('aria-live','assertive');
      document.body.appendChild(host);
      return host;
    };
    const report = (error, options = {}) => {
      const message = normalize(error);
      const context = normalize(options.context || 'Portal operation failed');
      const id = `GC-${new Date().toISOString().slice(11,19).replaceAll(':','')}-${String(++sequence).padStart(2,'0')}`;
      const time = new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit',second:'2-digit'});
      const known = classify(message,context);
      const displayCode = known?.code || id;
      const title = known ? known.title : 'Unclassified Portal error';
      const description = known ? known.description : `${context}. Marlon does not have a verified explanation for this error yet, so Portal is preserving the technical detail for investigation.`;
      const card = document.createElement('article');
      card.className = 'gc-diagnostic';
      card.dataset.diagnosticId = id;
      card.dataset.errorCode = displayCode;
      card.dataset.errorKnown = known ? 'true' : 'false';
      card.innerHTML = `<div class="gc-diagnostic-icon" aria-hidden="true">!</div><div class="gc-diagnostic-copy"><strong></strong><p></p><small></small><div class="gc-diagnostic-actions"><button type="button" data-gc-copy-diagnostic>Copy reference</button><button type="button" data-gc-dismiss-diagnostic>Dismiss</button></div></div>`;
      card.querySelector('strong').textContent = `${displayCode} · ${title}`;
      card.querySelector('p').textContent = description;
      card.querySelector('small').textContent = `Technical detail: ${message} · ${time}`;
      card.dataset.copyText = `${displayCode} | Ref ${id} | ${time} | ${context} | ${description} | Technical: ${message}`;
      const host = ensureHost();
      host.prepend(card);
      const transient=[...host.querySelectorAll('.gc-diagnostic:not(.gc-maintenance-approval)')];
      while(transient.length>4) transient.pop()?.remove();
      if(!known) queueUnknown({id,code:displayCode,context,message,path:location.pathname,view:location.hash||'#dashboard',at:new Date().toISOString()});
      setTimeout(() => card.classList.add('is-visible'), 20);
      setTimeout(() => dismiss(card), Number(options.duration || 12000));
      return displayCode;
    };
    const maintenanceApproval = (options = {}) => {
      const ticketId = String(options.ticketId || '').trim();
      if (!ticketId) return null;
      const host = ensureHost();
      const selector = `[data-gc-maintenance-ticket="${CSS.escape(ticketId)}"]`;
      let card = document.querySelector(selector);
      if (!card) {
        card = document.createElement('article');
        card.className = 'gc-diagnostic gc-maintenance-approval';
        card.dataset.gcMaintenanceTicket = ticketId;
        card.innerHTML = `<div class="gc-diagnostic-icon" aria-hidden="true">!</div><div class="gc-diagnostic-copy"><strong></strong><p></p><small></small><div class="gc-diagnostic-actions"><button type="button" class="gc-maintenance-review" data-gc-maintenance-review>Review in Support Desk</button></div></div>`;
      }
      const topActions = document.querySelector('.topbar .top-actions');
      (topActions || host).prepend(card);
      const code = options.ticketNumber ? `SUP-${String(options.ticketNumber).padStart(4,'0')}` : 'Marlon';
      card.querySelector('strong').textContent = `Action review needed · ${code}`;
      card.querySelector('[data-gc-maintenance-review]')?.replaceChildren(`Review ${code}`);
      card.querySelector('p').textContent = String(options.title || 'Marlon needs Owner approval before continuing this protected task.');
      const count=Math.max(1,Number(options.pendingCount||1));
      card.querySelector('small').textContent = count>1 ? `${count} items await an Owner decision · Showing oldest · Surface: ${String(options.surface || 'Portal')} · Priority: ${String(options.priority || 'High')}` : `Surface: ${String(options.surface || 'Portal')} · Priority: ${String(options.priority || 'High')} · Open Support Desk to review.`;
      card.querySelectorAll('button').forEach(button => button.disabled = false);
      requestAnimationFrame(() => card.classList.add('is-visible'));
      return ticketId;
    };
    const clearMaintenanceApproval = ticketId => {
      const id = String(ticketId || '').trim();
      if (!id) return;
      const card = document.querySelector(`[data-gc-maintenance-ticket="${CSS.escape(id)}"]`);
      if (card) dismiss(card);
    };
    const dismiss = card => { if (!card?.isConnected) return; card.classList.remove('is-visible'); setTimeout(() => card.remove(), 180); };
    document.addEventListener('click', async event => {
      const card = event.target.closest?.('.gc-diagnostic');
      if (!card) return;
      const approve = event.target.closest('[data-gc-maintenance-approve]');
      const deny = event.target.closest('[data-gc-maintenance-deny]');
      const review = event.target.closest('[data-gc-maintenance-review]');
      if (review) {
        window.GotCrackedUI?.activateView?.('support-tickets');
        setTimeout(() => document.dispatchEvent(new CustomEvent('gc-open-support-ticket',{detail:{ticketId:card.dataset.gcMaintenanceTicket}})), 150);
        return;
      }
      if (approve || deny) {
        card.querySelectorAll('button').forEach(button => button.disabled = true);
        document.dispatchEvent(new CustomEvent('gc-maintenance-approval-decision',{detail:{ticketId:card.dataset.gcMaintenanceTicket,approved:Boolean(approve)}}));
        return;
      }
      if (event.target.closest('[data-gc-dismiss-diagnostic]')) dismiss(card);
      if (event.target.closest('[data-gc-copy-diagnostic]')) {
        try { await navigator.clipboard.writeText(card.dataset.copyText || ''); event.target.textContent = 'Copied'; }
        catch { event.target.textContent = 'Copy failed'; }
      }
    });
    window.addEventListener('unhandledrejection', event => report(event.reason, {context:'Unexpected Portal failure'}));
    window.addEventListener('error', event => report(event.error || event.message, {context:'Portal script failure'}));
    return { error:report, maintenanceApproval, clearMaintenanceApproval, classify, catalog:Object.freeze(catalog.map(({code,title,description})=>({code,title,description}))) };
  })();
  window.GotCrackedDiagnostics = diagnostics;

  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[char]);

  const statusClass = value => ({
    'In diagnosis': 'diagnosis',
    'Waiting on parts': 'parts',
    'In repair': 'in-repair',
    'Ready for pickup': 'ready',
    'Awaiting Repair': 'diagnosis',
    'Need to Order Parts': 'parts',
    'Awaiting Parts': 'parts',
    'Diagnostic in Progress': 'diagnosis',
    'Repair in Progress': 'in-repair',
    'Quality Inspection': 'inspection',
    'Awaiting Callback': 'callback',
    'Repaired – Ready for Pickup': 'ready',
    'Sale Complete': 'complete',
    'Abandoned': 'closed',
    'Unrepairable': 'closed',
    'Customer Declined': 'closed',
    'Cancelled': 'closed'
  }[value] || '');

  const terminalStatuses = new Set([
    'sale_complete', 'abandoned', 'unrepairable',
    'customer_declined', 'completed', 'cancelled'
  ]);

  const list = document.querySelector('#repair-list');
  const table = document.querySelector('#repair-table');

  function setMobileMenu(open) {
    window.GotCrackedMobileNav?.setOpen?.(Boolean(open));
  }

  function getRepairs() {
    return Array.isArray(window.GotCrackedRepairs) ? window.GotCrackedRepairs : [];
  }

  function renderRepairs(items = getRepairs()) {
    if (!Array.isArray(items)) items = [];

    if (list) {
      list.innerHTML = items.map(r => `
        <div class="repair-row" data-ticket="${esc(r.id)}" tabindex="0" role="button" aria-label="Open repair ${esc(r.id)}">
          <div class="device-icon">${esc(r.icon || '▯')}</div>
          <div class="repair-customer">
            <strong>${esc(r.customer || 'Unknown customer')}</strong>
            <small>${esc(r.device || 'Unknown device')} · ${esc(r.service || 'No service listed')}</small>
          </div>
          <div class="repair-tech">${esc(r.tech || '—')}</div>
          <span class="status ${statusClass(r.status)}">${esc(r.status || 'In diagnosis')}</span>
          <div class="ticket-id">${esc(r.id || '—')}<br>${esc(r.updated || 'Recently updated')}</div>
        </div>
      `).join('');
    }

    if (table) {
      table.innerHTML = items.map(r => `
        <tr data-ticket="${esc(r.id)}" tabindex="0" aria-label="Open repair ${esc(r.id)}">
          <td><strong>${esc(r.id || '—')}</strong><small>${esc(r.updated || 'Recently updated')}</small></td>
          <td><strong>${esc(r.customer || 'Unknown customer')}</strong><small>${esc(r.device || 'Unknown device')}</small></td>
          <td>${esc(r.service || 'No service listed')}</td>
          <td>${esc(r.tech || '—')}</td>
          <td><span class="status ${statusClass(r.status)}">${esc(r.status || 'In diagnosis')}</span></td>
          <td>${esc(r.updated || 'Recently updated')}</td>
        </tr>
      `).join('');
    }

    const count = document.querySelector('#repair-count');
    if (count) {
      const openCount = getRepairs().filter(r => !terminalStatuses.has(r.statusKey)).length;
      count.textContent = String(openCount);
      count.hidden = openCount === 0;
    }
  }

  function filterRepairs() {
    const query = document.querySelector('#repair-search')?.value?.trim().toLowerCase() || '';
    const status = document.querySelector('#status-filter')?.value || 'all';

    const filtered = getRepairs().filter(repair => {
      const archived = terminalStatuses.has(repair.statusKey);
      const matchesStatus =
        status === 'all' ||
        (status === 'active' && !archived) ||
        (status === 'archive' && archived) ||
        repair.statusKey === status;

      const searchableText = Object.values(repair)
        .filter(value => value !== null && value !== undefined)
        .join(' ')
        .toLowerCase();

      return matchesStatus && searchableText.includes(query);
    });

    renderRepairs(filtered);
  }

  function showTicket(ticketId) {
    const ticket = getRepairs().find(repair => String(repair.id) === String(ticketId));
    if (!ticket) return;

    const detailModal = document.querySelector('#ticket-detail');
    const detailContent = document.querySelector('#ticket-detail-content');
    if (!detailModal || !detailContent) return;

    detailContent.innerHTML = `
      <div class="modal-head">
        <div><p class="eyebrow">${esc(ticket.id)}</p><h2>${esc(ticket.customer || 'Customer')}'s repair</h2></div>
        <button class="icon-button" id="close-ticket" type="button" aria-label="Close">×</button>
      </div>
      <span class="status ${statusClass(ticket.status)}">${esc(ticket.status || 'In diagnosis')}</span>
      <div class="ticket-detail">
        <div class="detail-row"><span>Device</span><strong>${esc(ticket.device || 'Unknown device')}</strong></div>
        <div class="detail-row"><span>Service</span><strong>${esc(ticket.service || 'No service listed')}</strong></div>
        <div class="detail-row"><span>Technician</span><strong>${esc(ticket.tech || '—')}</strong></div>
        <div class="detail-row"><span>Status</span><strong>${esc(ticket.status || 'In diagnosis')}</strong></div>
        <div class="detail-row"><span>Last updated</span><strong>${esc(ticket.updated || 'Recently updated')}</strong></div>
      </div>
    `;

    detailModal.showModal();
    detailModal.querySelector('#close-ticket')?.addEventListener('click', () => detailModal.close(), { once: true });
  }

  function activateView(id, { updateHash = true } = {}) {
    const target = document.getElementById(id);
    if (!target?.classList.contains('view')) return false;

    document.querySelectorAll('.view').forEach(view => {
      view.classList.toggle('active-view', view === target);
    });
    document.querySelectorAll('.nav-link[data-view]').forEach(nav => {
      nav.classList.toggle('active', nav.dataset.view === id);
    });

    const animateView = () => {
      target.classList.remove('gc-motion-view-enter');
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      void target.offsetWidth;
      target.classList.add('gc-motion-view-enter');
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(animateView);
    else animateView();

    if (updateHash) {
      const nextHash = `#${id}`;
      if (window.location.hash !== nextHash) history.pushState(null, '', nextHash);
    }

    setMobileMenu(false);
    document.dispatchEvent(new CustomEvent('gc-view-changed', { detail: id }));
    window.scrollTo({ top:0, left:0, behavior:'instant' });
    document.querySelector('main')?.scrollTo?.({ top:0, left:0, behavior:'instant' });
    return true;
  }

  function viewIdFromElement(element) {
    const direct = element.closest?.('[data-view]');
    if (direct?.dataset.view) return direct.dataset.view;

    const anchor = element.closest?.('a[href^="#"]');
    if (!anchor) return '';
    return anchor.hash.slice(1).split('/')[0];
  }

  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const viewId = viewIdFromElement(target);
    if (viewId && document.getElementById(viewId)?.classList.contains('view')) {
      event.preventDefault();
      activateView(viewId);
      return;
    }

    const openTicketButton = target.closest('[data-open-ticket]');
    if (openTicketButton) {
      event.preventDefault();
      const guidedIntake = window.GotCrackedOperationsV1?.openIntake;
      if (typeof guidedIntake === 'function') {
        guidedIntake();
      } else {
        window.GotCrackedDiagnostics?.error?.(
          'Guided intake is still loading. Please try again.',
          { context: 'Unable to open intake' }
        );
      }
      return;
    }

    const row = target.closest('[data-ticket]');
    if (row) showTicket(row.dataset.ticket);
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') setMobileMenu(false);

    if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof Element) {
      const row = event.target.closest('[data-ticket]');
      if (row) {
        event.preventDefault();
        showTicket(row.dataset.ticket);
      }
    }
  });

  const syncViewFromLocation = () => {
    const id = window.location.hash.slice(1).split('/')[0] || 'dashboard';
    if (document.getElementById(id)?.classList.contains('view')) {
      activateView(id, { updateHash: false });
    }
  };

  window.addEventListener('hashchange', syncViewFromLocation);
  window.addEventListener('popstate', syncViewFromLocation);

  document.querySelector('#repair-search')?.addEventListener('input', filterRepairs);
  document.querySelector('#status-filter')?.addEventListener('change', filterRepairs);

  const initialView = window.location.hash.slice(1).split('/')[0];
  if (initialView && document.getElementById(initialView)?.classList.contains('view')) {
    activateView(initialView, { updateHash: false });
  }

  window.GotCrackedUI = { renderRepairs, filterRepairs, showTicket, activateView, setMobileMenu };
})();

