(() => {
  'use strict';

  const ACCESS_REFRESH_MS = 30_000;
  const isStandalone = window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;
  const isAppleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let accessState = isStandalone ? 'pending' : 'not-required';
  let accessCheck = null;
  let installPrompt = null;
  let accessChannel = null;
  let staff = null;

  function isMobileSurface() {
    const ua = navigator.userAgent || '';
    return /Android|iPhone|iPad|iPod|Mobile/i.test(ua)
      || (window.matchMedia?.('(pointer: coarse)')?.matches && window.matchMedia?.('(max-width: 1100px)')?.matches);
  }

  function hasAccess() {
    return !isStandalone || accessState === 'allowed';
  }

  function notifyAccessGranted() {
    document.documentElement.dataset.gcPortalCompanion = isStandalone ? 'installed' : 'available';
    document.dispatchEvent(new CustomEvent('gc-portal-mobile-access-granted'));
  }

  async function checkAccess() {
    if (!isStandalone) return true;
    if (accessCheck) return accessCheck;

    accessCheck = (async () => {
      const client = window.supabaseClient;
      if (!client) return false;
      const { data:sessionData, error:sessionError } = await client.auth.getSession();
      if (sessionError || !sessionData?.session?.access_token) return false;
      const { data, error } = await client.rpc('portal_mobile_access_status');
      if (error || data?.allowed !== true) return false;
      accessState = 'allowed';
      notifyAccessGranted();
      subscribeToAccessChanges(sessionData.session.user?.id);
      return true;
    })().finally(() => { accessCheck = null; });

    return accessCheck;
  }

  async function enforceAccess() {
    if (!isStandalone || !staff) return;
    const allowed = await checkAccess();
    if (allowed) return;
    accessState = 'denied';
    await window.GotCrackedPortalAuth?.signOut?.('This installed Portal Companion no longer has staff access.');
  }

  function subscribeToAccessChanges(profileId) {
    if (!profileId || accessChannel || !window.supabaseClient) return;
    accessChannel = window.supabaseClient
      .channel(`portal-companion-access-${profileId}`)
      .on('postgres_changes', { event:'*', schema:'public', table:'profiles', filter:`id=eq.${profileId}` }, () => { void enforceAccess(); })
      .subscribe();
  }

  function closeAccessChannel() {
    if (!accessChannel || !window.supabaseClient) return;
    window.supabaseClient.removeChannel(accessChannel);
    accessChannel = null;
  }

  function getInstallButton() {
    return document.querySelector('[data-gc-portal-companion-install]');
  }

  function updateInstallButton() {
    const button = getInstallButton();
    if (!button) return;
    button.textContent = installPrompt ? 'Install app' : 'Install help';
  }

  function openInstallHelp() {
    let dialog = document.querySelector('#gc-portal-companion-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'gc-portal-companion-dialog';
      dialog.className = 'gc-portal-companion-dialog';
      const instructions = isAppleMobile
        ? '<ol><li>Open this Portal page in Safari.</li><li>Tap Share.</li><li>Choose “Add to Home Screen,” then tap Add.</li></ol>'
        : '<ol><li>Open your browser menu.</li><li>Choose “Install app” or “Add to Home screen.”</li><li>Open GC Portal and sign in with your active staff account.</li></ol>';
      dialog.innerHTML = `<div><h2>Install Portal Companion</h2><p>This is the private staff app for approved GotCracked accounts. It receives Portal updates automatically.</p>${instructions}<button type="button" data-gc-close-install-help>Done</button></div>`;
      document.body.appendChild(dialog);
      dialog.querySelector('[data-gc-close-install-help]')?.addEventListener('click', () => dialog.close());
    }
    if (typeof dialog.showModal === 'function') dialog.showModal();
  }

  async function install() {
    if (!installPrompt) {
      openInstallHelp();
      return;
    }
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
    updateInstallButton();
  }

  function mountInstallCard() {
    if (isStandalone || !isMobileSurface() || document.querySelector('#gc-portal-companion-install-card')) return;
    const heading = document.querySelector('#dashboard .page-heading');
    if (!heading) return;
    const card = document.createElement('aside');
    card.id = 'gc-portal-companion-install-card';
    card.className = 'gc-portal-companion';
    card.setAttribute('aria-label', 'Install the private Portal Companion app');
    card.innerHTML = '<span class="gc-portal-companion-mark" aria-hidden="true">↗</span><div class="gc-portal-companion-copy"><small>Private staff app</small><strong>Take Portal with you</strong><span>Install on your approved phone or tablet. Your staff access stays linked to Portal.</span></div><button class="gc-portal-companion-action" type="button" data-gc-portal-companion-install>Install help</button>';
    heading.insertAdjacentElement('afterend', card);
    card.querySelector('[data-gc-portal-companion-install]')?.addEventListener('click', install);
    updateInstallButton();
  }

  function mountKioskCard() {
    if (isStandalone || !isMobileSurface() || !canDownloadKioskSetup() || document.querySelector('#gc-kiosk-download-card')) return;
    const heading = document.querySelector('#dashboard .page-heading');
    if (!heading) return;
    const card = document.createElement('aside');
    card.id = 'gc-kiosk-download-card';
    card.className = 'gc-portal-companion gc-kiosk-download';
    card.setAttribute('aria-label', 'Download the GotCracked self-service kiosk setup');
    card.innerHTML = '<span class="gc-portal-companion-mark" aria-hidden="true">▣</span><div class="gc-portal-companion-copy"><small>Device setup</small><strong>Set up a self-service kiosk</strong><span>Download the private kiosk bundle for an approved tablet. Portal verifies your active manager access before it is prepared.</span><span class="gc-kiosk-download-status" data-gc-kiosk-download-status aria-live="polite"></span></div><button class="gc-portal-companion-action" type="button" data-gc-kiosk-download>Download setup</button>';
    heading.insertAdjacentElement('afterend', card);
    card.querySelector('[data-gc-kiosk-download]')?.addEventListener('click', downloadKioskSetup);
  }

  function canDownloadKioskSetup() {
    const role = String(staff?.role || '').toLowerCase();
    return staff?.active !== false && staff?.account_type !== 'shared_workstation' && ['owner', 'manager'].includes(role);
  }

  function setKioskDownloadState(message = '', pending = false) {
    const card = document.querySelector('#gc-kiosk-download-card');
    const status = card?.querySelector('[data-gc-kiosk-download-status]');
    const button = card?.querySelector('[data-gc-kiosk-download]');
    if (status) status.textContent = message;
    if (button) {
      button.disabled = pending;
      button.textContent = pending ? 'Preparing…' : 'Download setup';
    }
  }

  async function downloadKioskSetup() {
    const client = window.supabaseClient;
    const button = document.querySelector('[data-gc-kiosk-download]');
    if (!client || !button || !canDownloadKioskSetup()) return;
    setKioskDownloadState('', true);
    try {
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (sessionError || !token) throw new Error('Sign in again to prepare kiosk setup.');
      const functionUrl = `${String(client.supabaseUrl || '').replace(/\/$/, '')}/functions/v1/private-kiosk-download`;
      if (!functionUrl.startsWith('https://')) throw new Error('Kiosk setup is unavailable outside the secure Portal connection.');
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      if (client.supabaseKey) headers.apikey = client.supabaseKey;
      const response = await fetch(functionUrl, { method:'POST', headers, body:'{}', cache:'no-store' });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || 'Portal could not prepare kiosk setup.');
      }
      const bundle = await response.blob();
      if (bundle.size < 512) throw new Error('Portal returned an invalid kiosk bundle.');
      const disposition = response.headers.get('content-disposition') || '';
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || 'gotcracked-kiosk-0.1.0.zip';
      const link = document.createElement('a');
      const objectUrl = URL.createObjectURL(bundle);
      link.href = objectUrl;
      link.download = filename;
      link.hidden = true;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      setKioskDownloadState('Ready for your approved tablet.');
    } catch (error) {
      setKioskDownloadState(error?.message || 'Portal could not prepare kiosk setup.');
    } finally {
      button.disabled = false;
      if (button.textContent === 'Preparing…') button.textContent = 'Download setup';
    }
  }

  function syncMobileDownloads() {
    const mobile = isMobileSurface();
    if (!mobile) {
      document.querySelector('#gc-portal-companion-install-card')?.remove();
      document.querySelector('#gc-kiosk-download-card')?.remove();
      return;
    }
    if (staff) {
      mountInstallCard();
      if (canDownloadKioskSetup()) mountKioskCard();
      else document.querySelector('#gc-kiosk-download-card')?.remove();
    }
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope:'/' });
      await registration.update();
    } catch (error) {
      console.warn('Portal Companion service worker could not register:', error);
    }
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    updateInstallButton();
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    document.querySelector('#gc-portal-companion-install-card')?.remove();
  });

  document.addEventListener('gc-portal-authenticated', event => {
    staff = event.detail || {};
    mountInstallCard();
    mountKioskCard();
    void registerServiceWorker();
    void enforceAccess();
  });

  document.addEventListener('gc-portal-access-revoked', () => {
    staff = null;
    accessState = isStandalone ? 'pending' : 'not-required';
    closeAccessChannel();
    document.querySelector('#gc-portal-companion-install-card')?.remove();
    document.querySelector('#gc-kiosk-download-card')?.remove();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void enforceAccess();
  });
  window.addEventListener('online', () => { void enforceAccess(); });
  window.addEventListener('resize', syncMobileDownloads, { passive:true });
  window.setInterval(() => { void enforceAccess(); }, ACCESS_REFRESH_MS);

  window.GotCrackedMobilePortal = {
    isInstalled: Boolean(isStandalone),
    isRuntimeAllowed: hasAccess,
    checkAccess,
    install
  };
})();