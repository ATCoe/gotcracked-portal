(() => {
  'use strict';

  const NAV_CLASS = 'gc-mobile-nav';
  const PRIMARY = ['dashboard', 'repairs', 'ready-pickup', 'leads', 'appointments', 'customers'];
  const MORE = ['shipping', 'inventory', 'repair-reference', 'purchasing'];
  const MANAGEMENT = ['reports', 'staff', 'settings'];
  const mobileQuery = window.matchMedia('(max-width: 750px)');
  let lastSignature = '';

  function sidebar() {
    return document.querySelector('.sidebar');
  }

  function menuButton() {
    return document.querySelector('.mobile-menu');
  }

  function desktopNav() {
    return document.querySelector(`.sidebar > nav:not(.${NAV_CLASS})`);
  }

  function sourceLink(view) {
    return desktopNav()?.querySelector(`.nav-link[data-view="${CSS.escape(view)}"]`)
      || document.querySelector(`.sidebar-bottom > .nav-link[data-view="${CSS.escape(view)}"]`);
  }

  function isAvailable(link) {
    if (!link) return false;
    return !link.classList.contains('v1-hidden') && !link.hidden;
  }

  function labelFor(link) {
    const clone = link.cloneNode(true);
    clone.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
    clone.removeAttribute('id');
    clone.querySelectorAll('b').forEach(node => node.remove());
    clone.classList.remove('active');
    clone.dataset.mobileNavClone = 'true';
    return clone;
  }

  function signature() {
    return [...PRIMARY, ...MORE, ...MANAGEMENT].map(view => {
      const link = sourceLink(view);
      if (!link) return `${view}:missing`;
      return `${view}:${isAvailable(link) ? '1' : '0'}:${link.className}:${link.textContent.trim()}`;
    }).join('|');
  }

  function setOpen(open) {
    const panel = sidebar();
    const button = menuButton();
    if (!panel || !button) return;

    const shouldOpen = Boolean(open) && mobileQuery.matches;
    panel.classList.toggle('open', shouldOpen);
    panel.dataset.mobileOpen = shouldOpen ? 'true' : 'false';
    button.setAttribute('aria-expanded', String(shouldOpen));
    button.setAttribute('aria-controls', panel.id || 'portal-sidebar');
    button.setAttribute('aria-label', shouldOpen ? 'Close menu' : 'Open menu');

    // The navigation drawer must never lock, dim, blur or otherwise disable the
    // page beneath it. Older controllers used this class to freeze body scroll.
    document.body.classList.remove('mobile-nav-open');
  }

  function makeGroup(label, key, views, current) {
    const links = views.map(view => sourceLink(view)).filter(isAvailable).map(labelFor);
    if (!links.length) return null;

    const details = document.createElement('details');
    details.className = 'gc-mobile-nav-group';
    details.dataset.mobileGroup = key;
    details.open = links.some(link => link.dataset.view === current);

    const summary = document.createElement('summary');
    summary.textContent = label;

    const body = document.createElement('div');
    body.className = 'gc-mobile-nav-group-links';
    links.forEach(link => body.appendChild(link));
    details.append(summary, body);

    details.addEventListener('toggle', () => {
      if (!details.open) return;
      details.parentElement?.querySelectorAll('.gc-mobile-nav-group[open]').forEach(other => {
        if (other !== details) other.open = false;
      });
    });
    return details;
  }

  function syncActive() {
    const nav = document.querySelector(`.sidebar > .${NAV_CLASS}`);
    if (!nav) return;
    const current = window.location.hash.slice(1).split('/')[0] || 'dashboard';
    nav.querySelectorAll('.nav-link[data-view]').forEach(link => {
      link.classList.toggle('active', link.dataset.view === current);
    });
    nav.querySelectorAll('.gc-mobile-nav-group').forEach(group => {
      if (group.querySelector(`.nav-link[data-view="${CSS.escape(current)}"]`)) group.open = true;
    });
  }

  function build() {
    const panel = sidebar();
    const source = desktopNav();
    if (!panel || !source) return;

    if (!panel.id) panel.id = 'portal-sidebar';
    menuButton()?.setAttribute('aria-controls', panel.id);

    const nextSignature = signature();
    if (nextSignature === lastSignature && panel.querySelector(`:scope > .${NAV_CLASS}`)) {
      syncActive();
      return;
    }
    lastSignature = nextSignature;

    panel.querySelector(`:scope > .${NAV_CLASS}`)?.remove();
    const nav = document.createElement('nav');
    nav.className = NAV_CLASS;
    nav.setAttribute('aria-label', 'Mobile navigation');

    PRIMARY.map(view => sourceLink(view)).filter(isAvailable).map(labelFor).forEach(link => nav.appendChild(link));

    const current = window.location.hash.slice(1).split('/')[0] || 'dashboard';
    const more = makeGroup('More', 'more', MORE, current);
    const management = makeGroup('Management', 'management', MANAGEMENT, current);
    if (more) nav.appendChild(more);
    if (management) nav.appendChild(management);

    source.insertAdjacentElement('afterend', nav);
    panel.classList.add('gc-mobile-nav-ready');
    syncActive();
  }

  function init() {
    build();
    setOpen(false);

    const source = desktopNav();
    const bottom = document.querySelector('.sidebar-bottom');
    const observer = new MutationObserver(() => requestAnimationFrame(build));
    if (source) observer.observe(source, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    if (bottom) observer.observe(bottom, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden'] });

    // Own the hamburger before any legacy target/bubble listeners can run.
    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest('.mobile-menu');
      if (!button || !mobileQuery.matches) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(sidebar()?.dataset.mobileOpen !== 'true');
    }, true);

    // Outside taps close navigation without an overlay/backdrop element.
    document.addEventListener('pointerdown', event => {
      const panel = sidebar();
      if (!mobileQuery.matches || panel?.dataset.mobileOpen !== 'true') return;
      const target = event.target instanceof Node ? event.target : null;
      if (!target || panel.contains(target) || menuButton()?.contains(target)) return;
      setOpen(false);
    }, true);

    window.addEventListener('hashchange', () => {
      setOpen(false);
      requestAnimationFrame(syncActive);
    });
    document.addEventListener('gc-view-changed', () => {
      setOpen(false);
      requestAnimationFrame(syncActive);
    });
    mobileQuery.addEventListener?.('change', event => {
      if (!event.matches) setOpen(false);
    });
    window.addEventListener('orientationchange', () => setOpen(false));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) setOpen(false);
    });

    setTimeout(build, 1700);
    setTimeout(build, 2800);
  }

  window.GotCrackedMobileNav = { build, setOpen };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
