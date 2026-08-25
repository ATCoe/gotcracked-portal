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
    if (!client) return { authorized: false, reason: 'client-unavailable' };

    // getSession() restores from the local Supabase session store and does not
    // perform the expensive /auth/v1/user round-trip used by getUser().
    const { data: { session }, error: sessionError } = await client.auth.getSession();
    if (sessionError || !session) return { authorized: false, reason: 'no-session' };

    const hasDiscord = session.user.identities?.some(identity => identity.provider === 'discord');
    if (!hasDiscord) return { authorized: true, skipped: true };

    const verifiedUser = sessionStorage.getItem('gc-discord-verified-user');
    if (!force && verifiedUser === session.user.id) {
      return { authorized: true, cached: true };
    }

    const inviteToken = sessionStorage.getItem('gc-staff-invite');
    const { data, error } = await client.functions.invoke('discord-verify', {
      body: { inviteToken: inviteToken || null }
    });

    if (error || !data?.authorized) {
      sessionStorage.removeItem('gc-discord-verified-user');
      await client.auth.signOut();
      const message = data?.error || error?.message || 'This Discord account is not authorized for the GotCracked Portal.';
      sessionStorage.setItem('gc-auth-error', message);
      return { authorized: false, reason: message };
    }

    sessionStorage.setItem('gc-discord-verified-user', session.user.id);
    sessionStorage.removeItem('gc-staff-invite');
    sessionStorage.removeItem('gc-discord-auth-started');
    sessionStorage.removeItem('gc-auth-error');

    if (params.has('invite')) {
      params.delete('invite');
      history.replaceState({}, document.title, `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
    }

    return { authorized: true };
  }

  let verificationPromise = null;
  function verifyOnce(options = {}) {
    if (verificationPromise) return verificationPromise;
    verificationPromise = verifyDiscordSession(options)
      .finally(() => { verificationPromise = null; });
    return verificationPromise;
  }

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
        document.querySelector('#login-error').textContent = error.message;
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

  /*
   * IMPORTANT: workflow.js awaits GotCrackedDiscordReady before restoring the
   * local Supabase session. That promise must therefore never represent a
   * network request. Session restoration opens Portal first; Discord membership
   * verification runs once in the background and can still sign out an account
   * that is no longer authorized.
   */
  window.GotCrackedDiscordReady = Promise.resolve({ ready: true });

  const backgroundVerify = force => {
    setTimeout(() => {
      verifyOnce({ force }).catch(error => {
        console.error('Discord verification failed', error);
        sessionStorage.setItem('gc-auth-error', 'Discord verification failed. Please try again.');
      });
    }, force ? 0 : 900);
  };

  client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      sessionStorage.removeItem('gc-discord-verified-user');
      return;
    }

    if (event === 'SIGNED_IN' && session) {
      const oauthJustStarted = sessionStorage.getItem('gc-discord-auth-started') === '1';
      backgroundVerify(oauthJustStarted);
    }
  });

  // Existing remembered sessions should open Portal immediately. Re-check
  // Discord shortly afterward without blocking the login screen.
  backgroundVerify(false);
  wireUi();
})();
