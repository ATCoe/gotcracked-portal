(() => {
  'use strict';

  const MOBILE_MAX = 750;
  const NAV_CLASS = 'gc-mobile-nav';
  const mobileQuery = window.matchMedia(`(max-width: ${MOBILE_MAX}px)`);
  let lastPointerToggleAt = 0;

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

  function visibleModalOpen() {
    return Array.from(document.querySelectorAll('dialog[open]')).some(dialog => {
      const style = getComputedStyle(dialog);
      const rect = dialog.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.01 && rect.width > 8 && rect.height > 8;
    });
  }

  function toggleAtPoint(event) {
    if (!mobileQuery.matches || (typeof event.button === 'number' && event.button !== 0)) return false;
    const direct = event.target instanceof Element ? event.target.closest('.mobile-menu') : null;
    let toggle = direct;

    if (!toggle && !visibleModalOpen() && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
      for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
        const candidate = element instanceof Element ? element.closest('.mobile-menu') : null;
        if (candidate) { toggle = candidate; break; }
      }
    }

    if (!toggle) return false;
    const panel = sidebar();
    if (!panel) return false;

    event.preventDefault();
    event.stopImmediatePropagation();
    lastPointerToggleAt = performance.now();
    setOpen(panel.dataset.mobileOpen !== 'true');
    return true;
  }

  function bind() {
    if (document.documentElement.dataset.gcMobileNavBound === 'true') return;
    document.documentElement.dataset.gcMobileNavBound = 'true';

    /* Android can cancel a synthesized click when late Portal rendering changes
       the DOM during a tap. Own the hamburger on pointerdown at window capture,
       before document-level runtime handlers or overlays can consume it. */
    window.addEventListener('pointerdown', event => {
      toggleAtPoint(event);
    }, true);

    /* Keyboard activation and browsers without Pointer Events keep a click
       fallback. Suppress the compatibility click after a handled pointer tap. */
    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      const toggle = target?.closest('.mobile-menu');
      if (!toggle || !mobileQuery.matches) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      if (performance.now() - lastPointerToggleAt < 900) return;

      const panel = sidebar();
      if (!panel) return;
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
