(() => {
  'use strict';

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
  const sidebar = document.querySelector('.sidebar');
  const mobileMenu = document.querySelector('.mobile-menu');
  const ticketModal = document.querySelector('#new-ticket');
  const mobileQuery = window.matchMedia('(max-width: 750px)');

  // Portal 1.0 no longer uses a full-screen invisible backdrop button for the
  // mobile menu. If an old cached script created one before this controller
  // loaded, remove it so it cannot intercept taps.
  document.querySelectorAll('.sidebar-backdrop').forEach(node => node.remove());

  if (sidebar && !sidebar.id) sidebar.id = 'portal-sidebar';
  if (mobileMenu) {
    mobileMenu.type = 'button';
    mobileMenu.setAttribute('aria-controls', sidebar?.id || 'portal-sidebar');
    mobileMenu.setAttribute('aria-expanded', 'false');
  }

  function setMobileMenu(open) {
    if (!sidebar || !mobileMenu) return;
    const shouldOpen = Boolean(open) && mobileQuery.matches;
    sidebar.classList.toggle('open', shouldOpen);
    document.body.classList.toggle('mobile-nav-open', shouldOpen);
    mobileMenu.setAttribute('aria-expanded', String(shouldOpen));
    mobileMenu.setAttribute('aria-label', shouldOpen ? 'Close menu' : 'Open menu');
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

    if (updateHash) {
      const nextHash = `#${id}`;
      if (window.location.hash !== nextHash) history.pushState(null, '', nextHash);
    }

    setMobileMenu(false);
    document.dispatchEvent(new CustomEvent('gc-view-changed', { detail: id }));
    target.scrollIntoView({ block: 'start' });
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
      if (typeof guidedIntake === 'function') guidedIntake();
      else ticketModal?.showModal();
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

  mobileMenu?.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    setMobileMenu(!sidebar?.classList.contains('open'));
  });

  // Outside taps close the drawer directly. There is deliberately no invisible
  // overlay element between the user and the application.
  document.addEventListener('pointerdown', event => {
    if (!mobileQuery.matches || !sidebar?.classList.contains('open')) return;
    const target = event.target instanceof Node ? event.target : null;
    if (!target) return;
    if (sidebar.contains(target) || mobileMenu?.contains(target)) return;
    setMobileMenu(false);
  }, true);

  mobileQuery.addEventListener?.('change', event => {
    if (!event.matches) setMobileMenu(false);
  });
  window.addEventListener('orientationchange', () => setMobileMenu(false));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) setMobileMenu(false);
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