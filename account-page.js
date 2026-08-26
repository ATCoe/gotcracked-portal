(() => {
  'use strict';

  if (window.GotCrackedAccountPage) return;
  const client = window.supabaseClient;
  if (!client) return;

  const VERSION = '20260826-account-page1';
  let observer = null;

  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[c]);
  const roleLabel = value => String(value || 'staff').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
  const current = () => window.GotCrackedRuntimeProfile || window.GotCrackedOperationsV1?.state?.profile || null;
  const staffState = () => window.GotCrackedStaffProfiles?.state || null;

  function ensureStyle(){
    const existing = document.querySelector('link[data-gc-account-page]');
    if (existing) return Promise.resolve();
    return new Promise(resolve => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `account-page.css?v=${VERSION}`;
      link.dataset.gcAccountPage = 'true';
      link.addEventListener('load', resolve, { once:true });
      link.addEventListener('error', resolve, { once:true });
      document.head.appendChild(link);
    });
  }

  function currentRow(){
    const id = current()?.id;
    return staffState()?.profiles?.find?.(row => row.id === id) || current() || null;
  }

  function themePreference(){
    const synced = window.GotCrackedAccountSync?.get?.('theme');
    if (['system','light','dark'].includes(synced)) return synced;
    const live = window.GotCrackedTheme?.preference;
    return ['system','light','dark'].includes(live) ? live : 'system';
  }

  function storeName(row){
    return row?.locations?.name || current()?.locations?.name || document.querySelector('.location')?.textContent?.replace('⌄','').trim() || 'Assigned store';
  }

  function accountSettingsMarkup(row){
    const preference = themePreference();
    const discord = row?.discord_username || (row?.discord_user_id ? 'Discord linked' : 'Not linked');
    const recovery = row?.recovery_email || 'Not set';
    return `<section class="gc-account-settings" aria-label="My account settings">
      <article class="gc-account-card">
        <div class="gc-account-card-head"><div><p class="eyebrow">Portal preferences</p><h2>Appearance</h2><p>Use your device theme automatically or choose a Portal-specific appearance.</p></div></div>
        <div class="gc-account-theme-options" role="group" aria-label="Portal appearance">
          <button type="button" data-account-theme="system" class="${preference==='system'?'selected':''}" aria-pressed="${preference==='system'}"><span>◐</span><strong>Device</strong><small>Follow system</small></button>
          <button type="button" data-account-theme="light" class="${preference==='light'?'selected':''}" aria-pressed="${preference==='light'}"><span>☀</span><strong>Light</strong><small>Always light</small></button>
          <button type="button" data-account-theme="dark" class="${preference==='dark'?'selected':''}" aria-pressed="${preference==='dark'}"><span>☾</span><strong>Dark</strong><small>Always dark</small></button>
        </div>
        <p class="gc-account-pref-note">Your Portal preferences sync to your staff account, so the same settings can follow you to another device.</p>
      </article>

      <article class="gc-account-card">
        <div class="gc-account-card-head"><div><p class="eyebrow">Account access</p><h2>Sign-in & identity</h2><p>Your personal identity is editable here. Administrative access stays management-controlled.</p></div></div>
        <div class="gc-account-access-grid">
          <div><small>Store</small><strong>${esc(storeName(row))}</strong></div>
          <div><small>Portal role</small><strong>${esc(roleLabel(row?.role))}</strong></div>
          <div><small>Account</small><strong>${row?.active===false?'Suspended':'Active'}</strong></div>
          <div><small>Recovery email</small><strong>${esc(recovery)}</strong></div>
          <div class="wide"><small>Discord</small><strong>${esc(discord)}</strong>${row?.discord_user_id?'':'<button type="button" class="secondary-button gc-account-inline-action" data-account-link-discord>Link Discord</button>'}</div>
        </div>
        <div class="gc-account-admin-note"><span aria-hidden="true">🔒</span><p><strong>Access controls are read-only here.</strong> Store assignment, role, account activation, and Portal permissions are managed from Staff Access by authorized management.</p></div>
        <div class="gc-account-actions"><button type="button" class="secondary-button" data-account-signout>Sign out of Portal</button></div>
      </article>
    </section>`;
  }

  function decorateLauncher(){
    const launcher = document.querySelector('.sidebar .profile');
    if (!launcher) return;
    launcher.classList.add('gc-account-launcher');
    launcher.setAttribute('role','button');
    launcher.setAttribute('tabindex','0');
    launcher.setAttribute('aria-label','Open My Account');
    launcher.title = 'Open My Account';
    if (!launcher.querySelector('.gc-account-open-indicator')) {
      const indicator = document.createElement('span');
      indicator.className = 'gc-account-open-indicator';
      indicator.setAttribute('aria-hidden','true');
      indicator.textContent = '›';
      const signout = launcher.querySelector('#sign-out');
      signout ? launcher.insertBefore(indicator, signout) : launcher.appendChild(indicator);
    }
  }

  function enhance(){
    decorateLauncher();
    const host = document.getElementById('gc-profile-view');
    const id = current()?.id;
    if (!host || !id || staffState()?.selected !== id) return;

    const head = host.querySelector('.gc-profile-page-head');
    const title = head?.querySelector('h1');
    const description = head?.querySelector('p:not(.eyebrow)');
    if (title) title.textContent = 'My Account';
    if (description) description.textContent = 'Manage your staff profile, Portal preferences, and sign-in identity.';

    host.querySelector('.gc-account-settings')?.remove();
    host.insertAdjacentHTML('beforeend', accountSettingsMarkup(currentRow()));
  }

  function watchProfileView(){
    const host = document.getElementById('gc-profile-view');
    if (!host || observer) return;
    observer = new MutationObserver(() => queueMicrotask(enhance));
    observer.observe(host,{childList:true,subtree:false});
  }

  async function setTheme(preference){
    if (!['system','light','dark'].includes(preference)) return;
    window.GotCrackedTheme?.set?.(preference);
    await window.GotCrackedAccountSync?.set?.('theme',preference);
    enhance();
  }

  async function linkDiscord(button){
    if (button) button.disabled = true;
    try {
      const { error } = await client.auth.linkIdentity({
        provider:'discord',
        options:{ redirectTo:`${location.origin}${location.pathname}#profile`, scopes:'identify email' }
      });
      if (error) throw error;
    } catch (error) {
      window.GotCrackedDiagnostics?.error?.(error,{context:'Unable to link Discord'});
      if (button) button.disabled = false;
    }
  }

  function openAccount(){
    const profiles = window.GotCrackedStaffProfiles;
    if (!profiles) return;
    window.GotCrackedUI?.activateView?.('profile');
    profiles.load?.();
    setTimeout(enhance,80);
  }

  document.addEventListener('keydown',event=>{
    const launcher = event.target instanceof Element ? event.target.closest('.sidebar .profile') : null;
    if (!launcher || event.target?.closest?.('#sign-out')) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openAccount();
    }
  });

  document.addEventListener('click',event=>{
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const theme = target.closest('[data-account-theme]');
    if (theme) { setTheme(theme.dataset.accountTheme); return; }
    const link = target.closest('[data-account-link-discord]');
    if (link) { linkDiscord(link); return; }
    if (target.closest('[data-account-signout]')) { document.getElementById('sign-out')?.click(); return; }
  });

  document.addEventListener('gc-view-changed',event=>{
    if (event.detail === 'profile' || event.detail?.view === 'profile') setTimeout(enhance,100);
  });
  document.addEventListener('gc-theme-change',()=>setTimeout(enhance,0));
  document.addEventListener('gc-account-preferences-updated',()=>setTimeout(enhance,0));

  const ready = ensureStyle().then(()=>{
    decorateLauncher();
    watchProfileView();
    enhance();
    return true;
  });

  window.GotCrackedAccountPage = { version:VERSION, ready, open:openAccount, enhance };
})();
