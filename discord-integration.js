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
    if (error || !data?.ok) throw new Error(data?.error || error?.message || 'Unable to onboard the employee.');
    const packageText = `GotCracked staff onboarding\nPortal: https://portal.gotcracked.co\nLogin: ${data.staff.portalEmail}\nTemporary password: ${data.temporaryPassword}\nDiscord invite: ${data.discordInviteUrl}\nDiscord username: @${data.staff.discordUsername}\n\nChange the temporary password after first sign-in.`;
    let copied = false;
    try { await navigator.clipboard.writeText(packageText); copied = true; } catch {}
    return { ...data, packageText, copied };
  }

  function safeHttpsUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'https:' ? url.toString() : '';
    } catch {
      return '';
    }
  }

  function appendLine(output, label, value, { code = false } = {}) {
    output.append(document.createTextNode(`${label}: `));
    if (code) {
      const element = document.createElement('code');
      element.textContent = String(value || '');
      output.append(element);
    } else {
      output.append(document.createTextNode(String(value || '')));
    }
    output.append(document.createElement('br'));
  }

  function renderOnboardingPackage(output, result) {
    if (!output) return;
    output.replaceChildren();

    const heading = document.createElement('strong');
    heading.textContent = `Onboarding package ${result.copied ? 'copied' : 'created'}.`;
    output.append(heading, document.createElement('br'));

    appendLine(output, 'Login', result.staff?.portalEmail);
    appendLine(output, 'Temporary password', result.temporaryPassword, { code:true });

    output.append(document.createTextNode('Discord invite: '));
    const inviteUrl = safeHttpsUrl(result.discordInviteUrl);
    if (inviteUrl) {
      const link = document.createElement('a');
      link.href = inviteUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = inviteUrl;
      output.append(link);
    } else {
      output.append(document.createTextNode('Invite URL unavailable'));
    }
    output.append(document.createElement('br'));

    const note = document.createElement('small');
    note.textContent = 'The invite expires in seven days and can be used once. Copy these details before leaving this page.';
    output.append(note);
  }

  function showOnboardingMessage(message) {
    if (!message || document.querySelector('.onboarding-notice')) return;
    const staffView = document.querySelector('#staff .page-heading');
    if (!staffView) return;
    const notice = document.createElement('div');
    notice.className = 'onboarding-notice';
    const heading = document.createElement('strong');
    heading.textContent = 'Finish account setup';
    const detail = document.createElement('span');
    detail.textContent = String(message);
    notice.append(heading, detail);
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
        const result = await createInvite(event.target);
        event.target.reset();
        renderOnboardingPackage(output, result);
      } catch (error) {
        if (output) output.textContent = error.message;
      }
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
