(() => {
  'use strict';

  const MOBILE_MAX = 750;
  const NAV_CLASS = 'gc-mobile-nav';
  const mobileQuery = window.matchMedia(`(max-width: ${MOBILE_MAX}px)`);

  const navItems = {
    primary: [
      ['dashboard', '▦', 'Dashboard'],
      ['repairs', '⌁', 'Repairs'],
      ['ready-pickup', '✓', 'Ready for Pickup'],
      ['leads', '⌁', 'Leads'],
      ['appointments', '◷', 'Appointments'],
      ['customers', '♙', 'Customers']
    ],
    more: [
      ['shipping', '▰', 'Mail-in & Shipping'],
      ['inventory', '▤', 'Inventory'],
      ['repair-reference', '⌕', 'Repair Reference'],
      ['purchasing', '▣', 'Purchasing']
    ],
    management: [
      ['reports', '◫', 'Reports'],
      ['staff', '♟', 'Staff Access'],
      ['settings', '⚙', 'Settings']
    ]
  };

  const sidebar = () => document.querySelector('.sidebar');
  const button = () => document.querySelector('.mobile-menu');
  const currentView = () => window.location.hash.slice(1).split('/')[0] || 'dashboard';

  function linkMarkup([view, icon, label]) {
    return `<a class="nav-link" href="#${view}" data-view="${view}" data-mobile-nav-item="true"><span>${icon}</span>${label}</a>`;
  }

  function groupMarkup(label, key, items) {
    return `<details class="gc-mobile-nav-group" data-mobile-group="${key}">
      <summary>${label}</summary>
      <div class="gc-mobile-nav-group-links">${items.map(linkMarkup).join('')}</div>
    </details>`;
  }

  function buildOnce() {
    const panel = sidebar();
    if (!panel) return null;
    if (!panel.id) panel.id = 'portal-sidebar';

    let nav = panel.querySelector(`:scope > .${NAV_CLASS}`);
    if (!nav) {
      nav = document.createElement('nav');
      nav.className = NAV_CLASS;
      nav.setAttribute('aria-label', 'Mobile navigation');
      nav.innerHTML = `${navItems.primary.map(linkMarkup).join('')}${groupMarkup('More', 'more', navItems.more)}${groupMarkup('Management', 'management', navItems.management)}`;
      const desktopNav = panel.querySelector(':scope > nav:not(.gc-mobile-nav)');
      if (desktopNav) desktopNav.insertAdjacentElement('afterend', nav);
      else panel.querySelector('.sidebar-bottom')?.insertAdjacentElement('beforebegin', nav);
    }

    panel.classList.add('gc-mobile-nav-ready');
    syncActive();
    return nav;
  }

  function clearLegacyBodyLock() {
    document.body.classList.remove('mobile-nav-open');
    document.body.style.removeProperty('overflow');
    document.documentElement.style.removeProperty('overflow');
  }

  function forceOpenStyles(panel, open) {
    const properties = ['display', 'transform', 'visibility', 'pointer-events'];
    if (open) {
      panel.style.setProperty('display', 'flex', 'important');
      panel.style.setProperty('transform', 'translateX(0)', 'important');
      panel.style.setProperty('visibility', 'visible', 'important');
      panel.style.setProperty('pointer-events', 'auto', 'important');
      return;
    }
    properties.forEach(property => panel.style.removeProperty(property));
  }

  function setOpen(open) {
    const panel = sidebar();
    const toggle = button();
    if (!panel || !toggle) return;

    const shouldOpen = Boolean(open) && mobileQuery.matches;
    buildOnce();
    panel.classList.toggle('open', shouldOpen);
    panel.dataset.mobileOpen = shouldOpen ? 'true' : 'false';
    toggle.setAttribute('aria-expanded', String(shouldOpen));
    toggle.setAttribute('aria-controls', panel.id || 'portal-sidebar');
    toggle.setAttribute('aria-label', shouldOpen ? 'Close menu' : 'Open menu');
    forceOpenStyles(panel, shouldOpen);
    clearLegacyBodyLock();
    requestAnimationFrame(clearLegacyBodyLock);
  }

  function syncActive() {
    const nav = document.querySelector(`.sidebar > .${NAV_CLASS}`);
    if (!nav) return;
    const active = currentView();
    nav.querySelectorAll('.nav-link[data-view]').forEach(link => {
      link.classList.toggle('active', link.dataset.view === active);
    });
    nav.querySelectorAll('.gc-mobile-nav-group').forEach(group => {
      const containsActive = Array.from(group.querySelectorAll('.nav-link[data-view]')).some(link => link.dataset.view === active);
      if (containsActive) group.open = true;
    });
  }

  function bind() {
    const toggle = button();
    const panel = sidebar();
    if (!toggle || !panel) return;

    toggle.type = 'button';
    toggle.setAttribute('aria-controls', panel.id || 'portal-sidebar');
    toggle.setAttribute('aria-expanded', 'false');

    toggle.addEventListener('click', event => {
      if (!mobileQuery.matches) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(panel.dataset.mobileOpen !== 'true');
    }, true);

    document.addEventListener('pointerdown', event => {
      if (!mobileQuery.matches || panel.dataset.mobileOpen !== 'true') return;
      const target = event.target instanceof Node ? event.target : null;
      if (!target || panel.contains(target) || toggle.contains(target)) return;
      setOpen(false);
    }, true);

    panel.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('.gc-mobile-nav .nav-link[data-view]')) setOpen(false);
    });

    window.addEventListener('hashchange', () => {
      setOpen(false);
      syncActive();
    });
    document.addEventListener('gc-view-changed', () => {
      setOpen(false);
      syncActive();
    });
    mobileQuery.addEventListener?.('change', event => {
      if (!event.matches) setOpen(false);
    });
    window.addEventListener('orientationchange', () => setOpen(false));
  }

  function init() {
    document.querySelectorAll('.sidebar-backdrop').forEach(node => node.remove());
    buildOnce();
    setOpen(false);
    bind();

    // Tiny defensive observer: only watches body class changes and strips the
    // one legacy class that can freeze mobile scrolling. No subtree work.
    const bodyClassGuard = new MutationObserver(clearLegacyBodyLock);
    bodyClassGuard.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  window.GotCrackedMobileNav = { build: buildOnce, setOpen };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
