(() => {
  'use strict';

  const client = window.supabaseClient;
  const params = new URLSearchParams(window.location.search);
  const inviteFromUrl = params.get('invite');
  if (inviteFromUrl) sessionStorage.setItem('gc-staff-invite', inviteFromUrl);

  async function signInWithDiscord() {
    sessionStorage.setItem('gc-discord-auth-started', '1');
    const invite = sessionStorage.getItem('gc-staff-invite');
    const redirect = new URL(window.location.href);
    redirect.search = invite ? `?invite=${encodeURIComponent(invite)}` : '';
    redirect.hash = '';
    const { error } = await client.auth.signInWithOAuth({
      provider: 'discord',
      options: { redirectTo: redirect.toString(), queryParams: { prompt: 'consent' } }
    });
    if (error) throw error;
  }

  async function verifyDiscordSession({ force = false } = {}) {
    if (!client) return { authorized:false, reason:'client-unavailable', transient:true };

    const restored = window.GotCrackedAuth?.restoreSession
      ? await window.GotCrackedAuth.restoreSession()
      : await client.auth.getSession().then(({data,error}) => ({ session:data?.session || null, error }));

    const session = restored?.session;
    if (restored?.error || !session) {
      return { authorized:false, reason:'no-session', transient:Boolean(restored?.error) };
    }

    const hasDiscord = session.user.identities?.some(identity => identity.provider === 'discord');
    if (!hasDiscord) return { authorized:true, skipped:true };

    const verifiedUser = sessionStorage.getItem('gc-discord-verified-user');
    if (!force && verifiedUser === session.user.id) return { authorized:true, cached:true };

    const inviteToken = sessionStorage.getItem('gc-staff-invite');
    const { data, error } = await client.functions.invoke('discord-verify', {
      body: { inviteToken: inviteToken || null }
    });

    /*
     * Transport errors are not authorization failures. A temporary network or
     * Edge Function problem must never revoke a valid remembered staff session.
     * Fresh OAuth can decide whether to wait/retry, but returning staff remain
     * signed in until the server explicitly says authorized:false.
     */
    if (error) {
      console.warn('Discord verification deferred:', error.message);
      return { authorized:false, transient:true, reason:error.message || 'verification-unavailable' };
    }

    if (!data?.authorized) {
      sessionStorage.removeItem('gc-discord-verified-user');
      try { await client.auth.signOut({ scope:'local' }); } catch {}
      const message = data?.error || 'This Discord account is not authorized for the GotCracked Portal.';
      sessionStorage.setItem('gc-auth-error', message);
      return { authorized:false, transient:false, reason:message };
    }

    sessionStorage.setItem('gc-discord-verified-user', session.user.id);
    sessionStorage.removeItem('gc-staff-invite');
    sessionStorage.removeItem('gc-discord-auth-started');
    sessionStorage.removeItem('gc-auth-error');

    if (params.has('invite')) {
      params.delete('invite');
      history.replaceState({}, document.title, `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
    }

    return { authorized:true };
  }

  let verificationPromise = null;
  function verifyOnce(options = {}) {
    if (verificationPromise) return verificationPromise;
    verificationPromise = verifyDiscordSession(options)
      .finally(() => { verificationPromise = null; });
    return verificationPromise;
  }
  window.GotCrackedVerifyDiscord = verifyOnce;

  async function linkDiscord() {
    const { error } = await client.auth.linkIdentity({
      provider: 'discord',
      options: { redirectTo: `${location.origin}${location.pathname}`, scopes: 'identify email' }
    });
    if (error) throw error;
  }

  async function createInvite(form) {
    const fields = Object.fromEntries(new FormData(form));
    const { data, error } = await client.functions.invoke('staff-invite', { body: fields });
    if (error || !data?.url) throw new Error(data?.error || error?.message || 'Unable to create invite.');
    await navigator.clipboard.writeText(data.url);
    return data.url;
  }

  function showOnboardingMessage(message) {
    if (!message || document.querySelector('.onboarding-notice')) return;
    const staffView = document.querySelector('#staff .page-heading');
    if (!staffView) return;
    const notice = document.createElement('div');
    notice.className = 'onboarding-notice';
    notice.innerHTML = `<strong>Finish account setup</strong><span>${message}</span>`;
    staffView.insertAdjacentElement('afterend', notice);
  }

  function wireUi() {
    document.querySelector('#discord-login')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = 'Connecting to Discord…';
      try { await signInWithDiscord(); }
      catch (error) {
        const output = document.querySelector('#login-error');
        if (output) output.textContent = error.message;
        button.disabled = false;
        button.textContent = 'Continue with Discord';
      }
    });

    const priorError = sessionStorage.getItem('gc-auth-error');
    if (priorError) {
      const element = document.querySelector('#login-error');
      if (element) element.textContent = priorError;
      sessionStorage.removeItem('gc-auth-error');
    }

    const onboardingMessage = sessionStorage.getItem('gc-onboarding-message');
    if (onboardingMessage) {
      showOnboardingMessage(onboardingMessage);
      sessionStorage.removeItem('gc-onboarding-message');
    }
    document.addEventListener('gc-onboarding-required', event => showOnboardingMessage(event.detail));

    document.addEventListener('click', async event => {
      if (event.target.closest('#link-discord')) {
        event.target.disabled = true;
        try { await linkDiscord(); }
        catch (error) { alert(error.message); event.target.disabled = false; }
      }
    });

    document.addEventListener('submit', async event => {
      if (event.target.id !== 'staff-invite-form') return;
      event.preventDefault();
      const output = document.querySelector('#staff-invite-output');
      try {
        const url = await createInvite(event.target);
        output.textContent = `Invite copied: ${url}`;
      } catch (error) { output.textContent = error.message; }
    });
  }

  // workflow.js no longer depends on this promise for returning-session restore.
  window.GotCrackedDiscordReady = Promise.resolve({ ready:true });

  function scheduleBackgroundVerify(force = false) {
    const run = async () => {
      const result = await verifyOnce({ force }).catch(error => ({ authorized:false, transient:true, reason:error?.message }));
      if (!result.authorized && result.transient) {
        // Retry once later without blocking or signing out a remembered session.
        setTimeout(() => verifyOnce({ force:false }).catch(() => {}), 15000);
      }
    };

    if (force) return setTimeout(run, 50);
    if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout:4000 });
    else setTimeout(run, 3000);
  }

  client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      sessionStorage.removeItem('gc-discord-verified-user');
      return;
    }
    if (event === 'SIGNED_IN' && session) {
      const oauthJustStarted = sessionStorage.getItem('gc-discord-auth-started') === '1';
      scheduleBackgroundVerify(oauthJustStarted);
    }
  });

  // Existing sessions verify after the Portal shell is free to render.
  scheduleBackgroundVerify(false);
  wireUi();
})();
