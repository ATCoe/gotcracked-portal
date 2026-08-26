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
      ['schedule', '▦', 'Schedule'],
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
  const buttons = () => Array.from(document.querySelectorAll('.mobile-menu'));
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

  function syncButtons(open) {
    const panel = sidebar();
    for (const toggle of buttons()) {
      toggle.type = 'button';
      toggle.setAttribute('aria-expanded', String(Boolean(open)));
      toggle.setAttribute('aria-controls', panel?.id || 'portal-sidebar');
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    }
  }

  function forcePanelVisualState(panel, open) {
    if (!panel) return;
    if (open) {
      panel.style.setProperty('transform', 'translateX(0)', 'important');
      panel.style.setProperty('visibility', 'visible', 'important');
      panel.style.setProperty('pointer-events', 'auto', 'important');
      panel.style.setProperty('opacity', '1', 'important');
    } else {
      panel.style.removeProperty('transform');
      panel.style.removeProperty('visibility');
      panel.style.removeProperty('pointer-events');
      panel.style.removeProperty('opacity');
    }
  }

  function buildOnce() {
    const panel = sidebar();
    if (!panel) return null;
    if (!panel.id) panel.id = 'portal-sidebar';

    let nav = panel.querySelector(`.${NAV_CLASS}`);
    if (!nav) {
      nav = document.createElement('nav');
      nav.className = NAV_CLASS;
      nav.setAttribute('aria-label', 'Mobile navigation');
      nav.innerHTML = `${navItems.primary.map(linkMarkup).join('')}${groupMarkup('More', 'more', navItems.more)}${groupMarkup('Management', 'management', navItems.management)}`;

      const desktopNav = Array.from(panel.children).find(child => child.tagName === 'NAV' && !child.classList.contains(NAV_CLASS));
      const sidebarBottom = Array.from(panel.children).find(child => child.classList?.contains('sidebar-bottom'));
      if (desktopNav) desktopNav.insertAdjacentElement('afterend', nav);
      else if (sidebarBottom) sidebarBottom.insertAdjacentElement('beforebegin', nav);
      else panel.appendChild(nav);
    }

    panel.classList.add('gc-mobile-nav-ready');
    syncActive();
    return nav;
  }

  function setOpen(open) {
    const panel = sidebar();
    if (!panel) return;

    const shouldOpen = Boolean(open) && mobileQuery.matches;
    document.documentElement.dataset.gcMobileNavOpen = shouldOpen ? 'true' : 'false';
    panel.classList.toggle('open', shouldOpen);
    panel.dataset.mobileOpen = shouldOpen ? 'true' : 'false';
    panel.setAttribute('aria-hidden', shouldOpen ? 'false' : String(mobileQuery.matches));
    forcePanelVisualState(panel, shouldOpen);
    syncButtons(shouldOpen);

    /* Reassert once after the current event/layout turn. Some authenticated
       modules finish rendering immediately after the tap; the mobile controller
       remains the authority for whether the drawer is open. */
    if (shouldOpen) {
      requestAnimationFrame(() => {
        if (document.documentElement.dataset.gcMobileNavOpen !== 'true') return;
        const current = sidebar();
        if (!current) return;
        current.classList.add('open');
        current.dataset.mobileOpen = 'true';
        forcePanelVisualState(current, true);
        syncButtons(true);
      });
    }
  }

  function syncActive() {
    const panel = sidebar();
    const nav = panel?.querySelector(`.${NAV_CLASS}`);
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
    if (document.documentElement.dataset.gcMobileNavBound === 'true') return;
    document.documentElement.dataset.gcMobileNavBound = 'true';

    /* Delegation keeps the hamburger working even if an authenticated module
       replaces the visible button. Capture ownership prevents later Portal
       handlers from consuming the same tap first. */
    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      const toggle = target?.closest('.mobile-menu');
      if (!toggle || !mobileQuery.matches) return;

      const panel = sidebar();
      if (!panel) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(panel.dataset.mobileOpen !== 'true');
    }, true);

    document.addEventListener('pointerdown', event => {
      const panel = sidebar();
      if (!panel || !mobileQuery.matches || panel.dataset.mobileOpen !== 'true') return;

      const target = event.target instanceof Node ? event.target : null;
      const toggle = target instanceof Element ? target.closest?.('.mobile-menu') : null;
      if (!target || panel.contains(target) || toggle) return;
      setOpen(false);
    }, true);

    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest(`.${NAV_CLASS} .nav-link[data-view]`)) return;
      setOpen(false);
    });

    window.addEventListener('hashchange', () => {
      setOpen(false);
      syncActive();
    });

    /* A background render may announce the current view while the user is
       opening the menu. That event must not close the drawer. Navigation itself
       is already handled by the nav-link and hashchange paths above. */
    document.addEventListener('gc-view-changed', syncActive);

    document.addEventListener('gc-portal-runtime-ready', () => {
      buildOnce();
      syncActive();
      syncButtons(document.documentElement.dataset.gcMobileNavOpen === 'true');
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') setOpen(false);
    });

    mobileQuery.addEventListener?.('change', event => {
      if (!event.matches) setOpen(false);
      else {
        buildOnce();
        syncButtons(false);
      }
    });

    window.addEventListener('orientationchange', () => setOpen(false));
    window.addEventListener('pageshow', () => {
      buildOnce();
      setOpen(false);
    });
  }

  function init() {
    document.querySelectorAll('.sidebar-backdrop').forEach(node => node.remove());
    buildOnce();
    bind();
    setOpen(false);
  }

  window.GotCrackedMobileNav = { build: buildOnce, setOpen, syncActive };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();