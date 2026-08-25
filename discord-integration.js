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
      options: { redirectTo: redirect.toString(), scopes: 'identify email' }
    });
    if (error) throw error;
  }

  async function verifyDiscordSession() {
    if (!client) return;
    const { data: { session } } = await client.auth.getSession();
    if (!session) return;
    const hasDiscord = session.user.identities?.some(identity => identity.provider === 'discord');
    if (!hasDiscord) return;

    const inviteToken = sessionStorage.getItem('gc-staff-invite');
    const { data, error } = await client.functions.invoke('discord-verify', {
      body: { inviteToken: inviteToken || null }
    });
    if (error || !data?.authorized) {
      await client.auth.signOut();
      const message = data?.error || 'This Discord account is not authorized for the GotCracked Portal.';
      sessionStorage.setItem('gc-auth-error', message);
      return;
    }
    sessionStorage.removeItem('gc-staff-invite');
    sessionStorage.removeItem('gc-discord-auth-started');
    if (params.has('invite')) {
      params.delete('invite');
      history.replaceState({}, document.title, `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
    }
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

  window.GotCrackedDiscordReady = verifyDiscordSession().catch(error => {
    console.error('Discord verification failed', error);
    sessionStorage.setItem('gc-auth-error', 'Discord verification failed. Please try again.');
  });
  wireUi();
})();
