(() => {
  'use strict';

  const STYLE_ID = 'gc-mobile-nav-safe-style';
  const NAV_CLASS = 'gc-mobile-nav';

  const link = (view, icon, label) =>
    `<a class="nav-link" href="#${view}" data-view="${view}"><span>${icon}</span>${label}</a>`;

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${NAV_CLASS}{display:none}

      @media(max-width:750px){
        .sidebar{
          display:flex!important;
          flex-direction:column!important;
          overflow:hidden!important;
        }

        .sidebar>.brand{
          flex:0 0 auto!important;
          height:136px!important;
          min-height:136px!important;
          margin:0!important;
          padding:12px 18px 4px!important;
        }

        .sidebar>.brand .brand-logo{
          width:min(220px,82%)!important;
          height:116px!important;
          max-height:116px!important;
          object-fit:contain!important;
        }

        .sidebar>nav:not(.${NAV_CLASS}){display:none!important}
        .sidebar-bottom>.nav-link[data-view="settings"]{display:none!important}

        .sidebar>.${NAV_CLASS}{
          display:flex!important;
          flex:1 1 auto!important;
          min-height:0!important;
          flex-direction:column!important;
          gap:3px!important;
          padding:4px 16px 8px!important;
          overflow-y:auto!important;
          overscroll-behavior:contain;
          scrollbar-width:none;
        }
        .sidebar>.${NAV_CLASS}::-webkit-scrollbar{display:none}

        .${NAV_CLASS}>.nav-link,
        .${NAV_CLASS} .gc-mobile-nav-group-links>.nav-link{
          display:grid!important;
          grid-template-columns:34px minmax(0,1fr)!important;
          align-items:center!important;
          gap:10px!important;
          width:100%!important;
          min-height:44px!important;
          margin:0!important;
          padding:8px 12px!important;
          border-radius:8px!important;
          line-height:1.15!important;
        }

        .${NAV_CLASS} .nav-link>span{
          display:grid!important;
          place-items:center!important;
          width:34px!important;
          min-width:34px!important;
          margin:0!important;
        }

        .${NAV_CLASS} .nav-link.active{
          background:rgba(93,167,238,.18)!important;
        }

        .${NAV_CLASS} .gc-mobile-nav-group{
          margin:1px 0!important;
          padding:0!important;
          border:0!important;
        }

        .${NAV_CLASS} .gc-mobile-nav-group>summary{
          position:relative;
          display:flex!important;
          align-items:center!important;
          min-height:42px!important;
          padding:8px 12px!important;
          border-radius:8px!important;
          color:#aebbd0!important;
          cursor:pointer;
          font-size:.76rem!important;
          font-weight:800!important;
          letter-spacing:.08em!important;
          text-transform:uppercase!important;
          list-style:none!important;
          user-select:none;
        }
        .${NAV_CLASS} .gc-mobile-nav-group>summary::-webkit-details-marker{display:none}
        .${NAV_CLASS} .gc-mobile-nav-group>summary::after{
          content:'›';
          margin-left:auto;
          font-size:22px;
          font-weight:500;
          line-height:1;
          transform:rotate(90deg);
          transition:transform .12s ease;
        }
        .${NAV_CLASS} .gc-mobile-nav-group[open]>summary::after{transform:rotate(-90deg)}
        .${NAV_CLASS} .gc-mobile-nav-group>summary:active{background:rgba(255,255,255,.04)}

        .${NAV_CLASS} .gc-mobile-nav-group-links{
          display:grid!important;
          gap:2px!important;
          padding:2px 0 5px 12px!important;
        }
        .${NAV_CLASS} .gc-mobile-nav-group-links>.nav-link{
          min-height:40px!important;
          font-size:.92rem!important;
        }

        .sidebar>.sidebar-bottom{
          flex:0 0 auto!important;
          margin-top:0!important;
          padding-top:8px!important;
          padding-bottom:max(12px,env(safe-area-inset-bottom))!important;
        }

        .sidebar>.sidebar-bottom .profile{
          min-height:72px!important;
          padding-top:10px!important;
          padding-bottom:10px!important;
        }
      }

      @media(max-width:750px) and (max-height:720px){
        .sidebar>.brand{
          height:104px!important;
          min-height:104px!important;
          padding-top:6px!important;
        }
        .sidebar>.brand .brand-logo{
          height:92px!important;
          max-height:92px!important;
        }
        .${NAV_CLASS}>.nav-link,
        .${NAV_CLASS} .gc-mobile-nav-group-links>.nav-link{
          min-height:40px!important;
          padding-top:6px!important;
          padding-bottom:6px!important;
        }
        .${NAV_CLASS} .gc-mobile-nav-group>summary{min-height:38px!important}
        .sidebar>.sidebar-bottom .profile{min-height:64px!important}
      }
    `;
    document.head.appendChild(style);
  }

  function installNav() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar || sidebar.querySelector(`:scope>.${NAV_CLASS}`)) return;

    const desktopNav = sidebar.querySelector(':scope>nav');
    if (!desktopNav) return;

    const nav = document.createElement('nav');
    nav.className = NAV_CLASS;
    nav.setAttribute('aria-label', 'Mobile navigation');
    nav.innerHTML = `
      ${link('dashboard', '▦', 'Dashboard')}
      ${link('repairs', '⌁', 'Repairs')}
      ${link('ready-pickup', '✓', 'Ready for Pickup')}
      ${link('leads', '⌁', 'Leads')}
      ${link('appointments', '◷', 'Appointments')}
      ${link('customers', '♙', 'Customers')}

      <details class="gc-mobile-nav-group" data-mobile-group="more">
        <summary>More</summary>
        <div class="gc-mobile-nav-group-links">
          ${link('shipping', '▰', 'Mail-in & Shipping')}
          ${link('inventory', '▤', 'Inventory')}
          ${link('repair-reference', '⌕', 'Repair Reference')}
          ${link('purchasing', '▣', 'Purchasing')}
        </div>
      </details>

      <details class="gc-mobile-nav-group" data-mobile-group="management">
        <summary>Management</summary>
        <div class="gc-mobile-nav-group-links">
          ${link('reports', '◫', 'Reports')}
          ${link('staff', '♟', 'Staff')}
          ${link('settings', '⚙', 'Settings')}
        </div>
      </details>
    `;

    desktopNav.insertAdjacentElement('afterend', nav);

    nav.querySelectorAll('.gc-mobile-nav-group').forEach(group => {
      group.addEventListener('toggle', () => {
        if (!group.open) return;
        nav.querySelectorAll('.gc-mobile-nav-group[open]').forEach(other => {
          if (other !== group) other.open = false;
        });
      });
    });

    syncGroupForCurrentView();
  }

  function syncGroupForCurrentView() {
    const nav = document.querySelector(`.${NAV_CLASS}`);
    if (!nav) return;
    const current = window.location.hash.slice(1).split('/')[0] || 'dashboard';
    const active = nav.querySelector(`.nav-link[data-view="${CSS.escape(current)}"]`);
    const group = active?.closest('.gc-mobile-nav-group');
    if (group) group.open = true;
  }

  function init() {
    installStyles();
    installNav();
    syncGroupForCurrentView();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.addEventListener('hashchange', syncGroupForCurrentView);
  document.addEventListener('gc-view-changed', syncGroupForCurrentView);
})();
