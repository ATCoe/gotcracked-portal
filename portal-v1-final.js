(() => {
  'use strict';

  const ops = () => window.GotCrackedOperationsV1;
  const activate = view => window.GotCrackedUI?.activateView?.(view);
  const metricViews = ['repairs', 'appointments', 'ready-pickup', 'reports'];
  const workflowMedia = window.matchMedia('(max-width: 1100px)');

  function normalizeWorkOrderDrawer() {
    const layout = document.getElementById('v1-workorder-layout');
    if (!layout) {
      document.body.classList.remove('v1-workflow-open');
      return;
    }

    if (workflowMedia.matches) {
      if (layout.dataset.v1DrawerMode !== 'narrow') {
        layout.dataset.v1DrawerMode = 'narrow';
        layout.classList.add('drawer-collapsed');
      }
      const open = !layout.classList.contains('drawer-collapsed');
      document.body.classList.toggle('v1-workflow-open', open);
      layout.querySelector('.v1-workflow-panel')?.setAttribute('aria-hidden', open ? 'false' : 'true');
    } else {
      layout.dataset.v1DrawerMode = 'wide';
      layout.classList.remove('drawer-collapsed');
      document.body.classList.remove('v1-workflow-open');
      layout.querySelector('.v1-workflow-panel')?.setAttribute('aria-hidden', 'false');
    }
  }

  function syncLeadDrawerState() {
    const rightDrawer = document.getElementById('v1-lead-drawer');
    if (!rightDrawer) {
      document.body.classList.remove('v1-overlay-open');
      return;
    }
    const open = rightDrawer.classList.contains('open');
    rightDrawer.setAttribute('aria-label', 'Lead workflow panel');
    rightDrawer.setAttribute('aria-hidden', open ? 'false' : 'true');
    document.body.classList.toggle('v1-overlay-open', open);
  }

  function decorate() {
    document.querySelectorAll('.sidebar-backdrop,.v1-drawer-backdrop').forEach(backdrop => {
      backdrop.style.backdropFilter = 'none';
      backdrop.style.webkitBackdropFilter = 'none';
      backdrop.style.filter = 'none';
      backdrop.style.webkitFilter = 'none';
      backdrop.style.background = 'transparent';
    });

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

    syncLeadDrawerState();
    normalizeWorkOrderDrawer();
  }

  function openMetric(card) {
    const view = card?.dataset.v1MetricLink;
    if (view) activate(view);
  }

  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const metric = target.closest('[data-v1-metric-link]');
    if (metric && !metric.dataset.gcDirectoryFilter) {
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

    if (target.closest('[data-v1-toggle-workflow]')) {
      requestAnimationFrame(normalizeWorkOrderDrawer);
    }
  }, true);

  document.addEventListener('keydown', event => {
    if (!(event.target instanceof Element)) return;
    const metric = event.target.closest('[data-v1-metric-link]');
    if (metric && !metric.dataset.gcDirectoryFilter && (event.key === 'Enter' || event.key === ' ')) {
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

  workflowMedia.addEventListener?.('change', () => requestAnimationFrame(normalizeWorkOrderDrawer));
  window.addEventListener('resize', () => requestAnimationFrame(normalizeWorkOrderDrawer));
  window.addEventListener('gc-view-changed', () => requestAnimationFrame(decorate));
  window.addEventListener('load', decorate, { once: true });
  setTimeout(decorate, 1700);
})();
