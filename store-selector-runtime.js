(() => {
  'use strict';
  const training = () => localStorage.getItem('gc-training-store') === '1';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const render = () => {
    const host = document.querySelector('.topbar .location');
    if (!document.getElementById('gc-store-selector-contrast')) {
      const style = document.createElement('style');
      style.id = 'gc-store-selector-contrast';
      style.textContent = '.topbar .location{overflow:visible!important;color:#e8f1f8!important}.topbar .location .v1-store-switch{color:#102131!important;background:#f8fbff!important;border:1px solid #9fb2c4!important;box-shadow:0 8px 20px rgba(0,0,0,.22)!important}.topbar .location .v1-store-switch strong{color:#102131!important}.v1-store-switch-menu{display:block!important;background:#102131!important;color:#f8fbff!important}.v1-store-switch-menu[hidden]{display:none!important}.v1-store-option,.v1-store-option strong{color:#f8fbff!important}.v1-store-option small{color:#b8c9d8!important}@media (max-width:750px){.topbar .location{margin-left:auto;max-width:calc(100vw - 100px)}.topbar .location .v1-store-switch{min-width:0;max-width:100%;padding:0 10px}.v1-store-switch-menu{left:auto;right:0;min-width:210px;max-width:calc(100vw - 24px)}}@media (min-width:751px) and (max-width:1100px){.v1-store-switch-menu{left:auto;right:0}}';
      document.head.appendChild(style);
    }
    if (!host) return;
    const existing = host.querySelector('[data-v1-store-menu-toggle]');
    if (existing) {
      if (existing.dataset.gcBound === '1') return;
      existing.dataset.gcBound = '1';
      existing.addEventListener('click', event => {
        event.preventDefault();
        const menu = existing.parentElement?.querySelector('.v1-store-switch-menu');
        if (menu) { menu.hidden = !menu.hidden; existing.setAttribute('aria-expanded', String(!menu.hidden)); }
      });
      return;
    }
    const activeTraining = training();
    host.innerHTML = `<button class="v1-store-switch" type="button" data-v1-store-menu-toggle aria-haspopup="menu" aria-expanded="false"><span class="status-dot"></span><strong>${activeTraining ? 'Training Store' : 'Blacksburg'}</strong><span aria-hidden="true">⌄</span></button><div class="v1-store-switch-menu" role="menu" hidden><button class="v1-store-option" type="button" role="menuitem" data-v1-store-option="production" aria-current="${activeTraining ? 'false' : 'true'}"><span class="status-dot"></span><span><strong>Blacksburg</strong><small>Live production data</small></span></button><button class="v1-store-option" type="button" role="menuitem" data-v1-store-option="training" aria-current="${activeTraining ? 'true' : 'false'}"><span>◌</span><span><strong>Training Store</strong><small>Sandbox data only</small></span></button></div>`;
    render();
  };
  const switchStore = nextTraining => {
    localStorage.setItem('gc-training-store', nextTraining ? '1' : '0');
    document.dispatchEvent(new CustomEvent('gc-store-mode-changed', { detail: { training: nextTraining } }));
    setTimeout(() => location.reload(), 80);
  };
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    const toggle = target?.closest('[data-v1-store-menu-toggle]');
    if (toggle) {
      event.preventDefault();
      const menu = toggle.parentElement?.querySelector('.v1-store-switch-menu');
      if (menu) { menu.hidden = !menu.hidden; toggle.setAttribute('aria-expanded', String(!menu.hidden)); }
      return;
    }
    const option = target?.closest('[data-v1-store-option]');
    if (option) { event.preventDefault(); switchStore(option.dataset.v1StoreOption === 'training'); }
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const menu = document.querySelector('.v1-store-switch-menu:not([hidden])');
    if (menu) { menu.hidden = true; menu.previousElementSibling?.setAttribute('aria-expanded', 'false'); menu.previousElementSibling?.focus(); }
  });
  new MutationObserver(render).observe(document.documentElement, { childList: true, subtree: true });
  render();
  window.addEventListener('gc-portal-runtime-ready', render);
})();

