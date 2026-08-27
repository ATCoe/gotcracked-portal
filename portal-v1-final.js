(() => {
  'use strict';

  const ops = () => window.GotCrackedOperationsV1;
  const activate = view => window.GotCrackedUI?.activateView?.(view);
  const metricViews = ['repairs', 'appointments', 'ready-pickup', 'reports'];
  const workflowMedia = window.matchMedia('(max-width: 1100px)');
  let decorateFrame = 0;

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

  function setBackdropInteractive(backdrop, open) {
    if (!backdrop) return;

    backdrop.hidden = !open;
    backdrop.setAttribute('aria-hidden', open ? 'false' : 'true');

    if (open) {
      backdrop.removeAttribute('inert');
      backdrop.style.setProperty('display', 'block', 'important');
      backdrop.style.setProperty('pointer-events', 'auto', 'important');
    } else {
      backdrop.setAttribute('inert', '');
      backdrop.style.setProperty('display', 'none', 'important');
      backdrop.style.setProperty('pointer-events', 'none', 'important');
    }
  }

  function syncLeadDrawerState() {
    const rightDrawer = document.getElementById('v1-lead-drawer');
    const open = Boolean(rightDrawer?.classList.contains('open'));

    document.querySelectorAll('#v1-drawer-backdrop,.v1-drawer-backdrop').forEach(backdrop => {
      setBackdropInteractive(backdrop, open);
    });

    if (!rightDrawer) return;
    rightDrawer.setAttribute('aria-label', 'Lead workflow panel');
    rightDrawer.setAttribute('aria-hidden', open ? 'false' : 'true');

    // Global overlay body state is owned by runtime-stability / the polish layer,
    // because native dialogs and the lead drawer both participate in it. This
    // release layer only owns the lead drawer's own backdrop.
    window.GotCrackedRuntimeStability?.syncOverlays?.();
  }

  function decorate() {
    decorateFrame = 0;

    syncLeadDrawerState();

    document.querySelectorAll('.v1-drawer-backdrop').forEach(backdrop => {
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

    normalizeWorkOrderDrawer();
  }

  function scheduleDecorate() {
    if (decorateFrame) return;
    decorateFrame = requestAnimationFrame(decorate);
  }

  function openMetric(card) {
    const view = card?.dataset.v1MetricLink;
    if (view) activate(view);
  }

  function loadKnowledgeBase() {
    if (window.GotCrackedKnowledgeBase || document.querySelector('script[data-gc-knowledge-base-runtime]')) return;
    const script = document.createElement('script');
    script.src = 'knowledge-base.js?v=20260827-kb1';
    script.async = false;
    script.dataset.gcKnowledgeBaseRuntime = '20260827-kb1';
    script.addEventListener('error', () => {
      console.error('Knowledge Base runtime failed to load.');
      window.GotCrackedDiagnostics?.error?.(new Error('Knowledge Base runtime failed to load.'), { context: 'Knowledge Base' });
    }, { once: true });
    document.body.appendChild(script);
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
      return;
    }

    if (target.closest('[data-v1-toggle-workflow], [data-v1-close-drawer], [data-v1-lead]')) {
      setTimeout(scheduleDecorate, 0);
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

  /* Dynamic operational views still insert DOM after authentication. Observe
     inserted/removed nodes only and coalesce them to one frame. */
  const main = document.querySelector('main');
  if (main) {
    const observer = new MutationObserver(scheduleDecorate);
    observer.observe(main, { subtree: true, childList: true });
  }

  workflowMedia.addEventListener?.('change', scheduleDecorate);
  window.addEventListener('resize', scheduleDecorate, { passive: true });
  window.addEventListener('pageshow', scheduleDecorate);
  document.addEventListener('gc-view-changed', scheduleDecorate);
  document.addEventListener('gc-portal-runtime-ready', scheduleDecorate);
  document.addEventListener('gc-portal-runtime-ready', loadKnowledgeBase, { once: true });
  window.addEventListener('load', scheduleDecorate, { once: true });

  syncLeadDrawerState();
  loadKnowledgeBase();
  setTimeout(scheduleDecorate, 0);
  setTimeout(scheduleDecorate, 1200);
})();
