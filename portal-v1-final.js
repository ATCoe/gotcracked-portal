(() => {
  'use strict';

  const ops = () => window.GotCrackedOperationsV1;
  const activate = view => window.GotCrackedUI?.activateView?.(view);
  const metricViews = ['repairs', 'appointments', 'ready-pickup', 'reports'];
  const PRIMARY_VIEWS = ['dashboard', 'repairs', 'ready-pickup', 'leads', 'appointments', 'customers'];
  const MORE_VIEWS = ['shipping', 'inventory', 'repair-reference', 'purchasing'];
  const MANAGEMENT_VIEWS = ['reports', 'staff', 'settings'];
  let mobileNavSignature = '';

  function sourceLink(view) {
    return document.querySelector(`.sidebar > nav:not(.v1-mobile-nav) .nav-link[data-view="${view}"]`)
      || document.querySelector(`.sidebar-bottom > .nav-link[data-view="${view}"]`);
  }

  function cloneLink(view) {
    const source = sourceLink(view);
    if (!source || source.hidden || getComputedStyle(source).display === 'none') return null;
    const clone = source.cloneNode(true);
    clone.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
    clone.removeAttribute('id');
    clone.dataset.mobileNavClone = 'true';
    return clone;
  }

  function currentMobileNavSignature() {
    return [...PRIMARY_VIEWS, ...MORE_VIEWS, ...MANAGEMENT_VIEWS]
      .map(view => {
        const link = sourceLink(view);
        if (!link) return `${view}:missing`;
        return `${view}:${link.hidden ? 'hidden' : 'shown'}:${link.className}:${link.textContent.trim()}`;
      })
      .join('|');
  }

  function makeGroup(label, views, currentView) {
    const links = views.map(cloneLink).filter(Boolean);
    if (!links.length) return null;

    const details = document.createElement('details');
    details.className = 'v1-mobile-nav-group';
    details.dataset.mobileNavGroup = label.toLowerCase();
    if (links.some(link => link.dataset.view === currentView)) details.open = true;

    const summary = document.createElement('summary');
    summary.textContent = label;
    const body = document.createElement('div');
    body.className = 'v1-mobile-nav-group-links';
    links.forEach(link => body.appendChild(link));
    details.append(summary, body);

    details.addEventListener('toggle', () => {
      if (!details.open) return;
      details.parentElement?.querySelectorAll('.v1-mobile-nav-group[open]').forEach(other => {
        if (other !== details) other.open = false;
      });
    });
    return details;
  }

  function buildMobileNav() {
    const sidebar = document.querySelector('.sidebar');
    const desktopNav = sidebar?.querySelector(':scope > nav:not(.v1-mobile-nav)');
    if (!sidebar || !desktopNav) return;

    const signature = currentMobileNavSignature();
    if (signature === mobileNavSignature && sidebar.querySelector(':scope > .v1-mobile-nav')) return;
    mobileNavSignature = signature;

    sidebar.querySelector(':scope > .v1-mobile-nav')?.remove();
    const mobileNav = document.createElement('nav');
    mobileNav.className = 'v1-mobile-nav';
    mobileNav.setAttribute('aria-label', 'Mobile navigation');

    PRIMARY_VIEWS.map(cloneLink).filter(Boolean).forEach(link => mobileNav.appendChild(link));

    const currentView = window.location.hash.slice(1).split('/')[0] || 'dashboard';
    const more = makeGroup('More', MORE_VIEWS, currentView);
    const management = makeGroup('Management', MANAGEMENT_VIEWS, currentView);
    if (more) mobileNav.appendChild(more);
    if (management) mobileNav.appendChild(management);

    desktopNav.insertAdjacentElement('afterend', mobileNav);
  }

  function syncMobileNavActive() {
    const currentView = window.location.hash.slice(1).split('/')[0] || 'dashboard';
    document.querySelectorAll('.v1-mobile-nav .nav-link[data-view]').forEach(link => {
      link.classList.toggle('active', link.dataset.view === currentView);
    });
    document.querySelectorAll('.v1-mobile-nav-group').forEach(group => {
      if (group.querySelector(`.nav-link[data-view="${CSS.escape(currentView)}"]`)) group.open = true;
    });
  }

  function decorate() {
    document.querySelectorAll('.sidebar-backdrop,.v1-drawer-backdrop').forEach(backdrop => {
      backdrop.style.backdropFilter = 'none';
      backdrop.style.webkitBackdropFilter = 'none';
      backdrop.style.filter = 'none';
      backdrop.style.webkitFilter = 'none';
      backdrop.style.background = 'transparent';
    });

    buildMobileNav();
    syncMobileNavActive();

    document.querySelectorAll('#dashboard .metrics article').forEach((card, index) => {
      const view = metricViews[index];
      if (!view || card.dataset.v1MetricLink) return;
      card.dataset.v1MetricLink = view;
      card.tabIndex = 0;
      card.setAttribute('role', 'link');
      card.setAttribute('aria-label', `Open ${view.replaceAll('-', ' ')}`);
    });

    document.querySelectorAll('[data-open-ticket]').forEach(button => {
      button.setAttribute('title', 'Open guided intake');
      button.setAttribute('aria-label', 'Create work order using guided intake');
    });

    const rightDrawer = document.getElementById('v1-lead-drawer');
    if (rightDrawer) {
      rightDrawer.setAttribute('aria-label', 'Lead workflow panel');
      rightDrawer.setAttribute('aria-hidden', rightDrawer.classList.contains('open') ? 'false' : 'true');
    }
  }

  function openMetric(card) {
    const view = card?.dataset.v1MetricLink;
    if (view) activate(view);
  }

  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const metric = target.closest('[data-v1-metric-link]');
    if (metric) {
      event.preventDefault();
      openMetric(metric);
      return;
    }

    const openTicket = target.closest('[data-open-ticket]');
    if (openTicket && typeof ops()?.openIntake === 'function') {
      event.preventDefault();
      event.stopPropagation();
      ops().openIntake();
    }
  }, true);

  document.addEventListener('keydown', event => {
    if (!(event.target instanceof Element)) return;
    const metric = event.target.closest('[data-v1-metric-link]');
    if (metric && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openMetric(metric);
    }
  });

  const observer = new MutationObserver(decorate);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'hidden']
  });

  window.addEventListener('gc-view-changed', () => requestAnimationFrame(decorate));
  window.addEventListener('hashchange', () => requestAnimationFrame(syncMobileNavActive));
  window.addEventListener('load', decorate, { once: true });
  setTimeout(decorate, 1700);
})();
