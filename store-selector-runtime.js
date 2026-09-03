(() => {
  'use strict';
  const training = () => localStorage.getItem('gc-training-store') === '1';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const render = () => {
    const host = document.querySelector('.topbar .location');
    if (!host || host.querySelector('[data-v1-store-menu-toggle]')) return;
    const activeTraining = training();
    host.innerHTML = `<button class="v1-store-switch" type="button" data-v1-store-menu-toggle aria-haspopup="menu" aria-expanded="false"><span class="status-dot"></span><strong>${activeTraining ? 'Training Store' : 'Blacksburg'}</strong><span aria-hidden="true">⌄</span></button><div class="v1-store-switch-menu" role="menu" hidden><button class="v1-store-option" type="button" role="menuitem" data-v1-store-option="production" aria-current="${activeTraining ? 'false' : 'true'}"><span class="status-dot"></span><span><strong>Blacksburg</strong><small>Live production data</small></span></button><button class="v1-store-option" type="button" role="menuitem" data-v1-store-option="training" aria-current="${activeTraining ? 'true' : 'false'}"><span>◌</span><span><strong>Training Store</strong><small>Sandbox data only</small></span></button></div>`;
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

