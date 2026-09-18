(() => {
  'use strict';

  const client = window.supabaseClient;
  if (!client) return;
  const params = new URLSearchParams(window.location.search);
  const inviteFromUrl = params.get('invite');
  if (inviteFromUrl) sessionStorage.setItem('gc-staff-invite', inviteFromUrl);

  const WORKSTATION_INTENT = 'gc-workstation-enroll-intent';
  const WORKSTATION_DEVICE = 'gc-workstation-device-id';
  const WORKSTATION_GRANT = 'gc-workstation-enrollment-grant';
  const WORKSTATION_LABEL = 'gc-workstation-enrollment-label';
  const WORKSTATION_REQUEST_LABEL = 'gc-workstation-request-label';
  const KIOSK_INTENT = 'gc-kiosk-setup-intent';

  function ensureDeviceId() {
    let value = localStorage.getItem(WORKSTATION_DEVICE);
    if (value && value.length >= 16) return value;
    value = `${crypto.randomUUID?.() || Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(4)).join('-')}`;
    localStorage.setItem(WORKSTATION_DEVICE, value);
    return value;
  }

  function authMessage(message, isError = false) {
    const output = document.querySelector('#login-error');
    if (!output) return;
    output.textContent = message || '';
    output.classList.toggle('success', Boolean(message) && !isError);
  }

  async function signInWithDiscord() {
    sessionStorage.setItem('gc-discord-auth-started', '1');
    const invite = sessionStorage.getItem('gc-staff-invite');
    const approval = new URL(window.location.href).searchParams.get('marlon-approval');
    const redirect = new URL(window.location.href);
    const redirectParams = new URLSearchParams();
    if (invite) redirectParams.set('invite', invite);
    if (approval) redirectParams.set('marlon-approval', approval);
    redirect.search = redirectParams.size ? `?${redirectParams.toString()}` : '';
    redirect.hash = approval ? '#support-tickets' : '';
    const { error } = await client.auth.signInWithOAuth({
      provider: 'discord',
      // Do not force a new Discord consent screen for an already signed-in user.
      // Supabase still creates and validates a fresh OAuth state for each explicit login.
      options: { redirectTo: redirect.toString() }
    });
    if (error) throw error;
  }

  async function signInWithGoogle() {
    sessionStorage.setItem('gc-google-auth-started','1');
    const redirect = new URL(window.location.href);
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirect.toString(), scopes: 'openid email profile', queryParams: { access_type:'offline', prompt:'select_account' } }
    });
    if (error) throw error;
  }

  async function verifyDiscordSession({ force = false } = {}) {
    if (!client) return { authorized:false, reason:'client-unavailable', transient:true };
    const restored = window.GotCrackedAuth?.restoreSession
      ? await window.GotCrackedAuth.restoreSession()
      : await client.auth.getSession().then(({data,error}) => ({ session:data?.session || null, error }));
    const session = restored?.session;
    if (restored?.error || !session) return { authorized:false, reason:'no-session', transient:Boolean(restored?.error) };

    const hasDiscord = session.user.identities?.some(identity => identity.provider === 'discord');
    if (!hasDiscord) return { authorized:true, skipped:true };
    // A cached user id does not prove this particular login was verified.
    // Ask the database, which also checks revocation and the current session id.
    const verified = await client.rpc('portal_session_authorized');
    if (!force && !verified.error && verified.data === true) return { authorized:true, cached:true };

    const inviteToken = sessionStorage.getItem('gc-staff-invite');
    const { data, error } = await client.functions.invoke('discord-verify', { body: { inviteToken: inviteToken || null } });
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
    return { authorized:true, data };
  }

  let verificationPromise = null;
  function verifyOnce(options = {}) {
    if (verificationPromise) return verificationPromise;
    verificationPromise = verifyDiscordSession(options).finally(() => { verificationPromise = null; });
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

  async function beginWorkstationEnrollment() {
    if (sessionStorage.getItem(WORKSTATION_INTENT) !== '1') return false;
    const deviceId = ensureDeviceId();
    const requestedLabel = sessionStorage.getItem(WORKSTATION_REQUEST_LABEL)?.trim() || 'Shared shop computer';
    authMessage(`Authorizing ${requestedLabel}…`);
    const { data, error } = await client.functions.invoke('workstation-enroll', {
      body: { deviceId, deviceLabel:requestedLabel }
    });
    if (error || !data?.ok) {
      sessionStorage.removeItem(WORKSTATION_INTENT);
      throw new Error(data?.error || error?.message || 'Unable to enroll this workstation.');
    }

    sessionStorage.setItem(WORKSTATION_GRANT, data.enrollmentToken);
    sessionStorage.setItem(WORKSTATION_LABEL, data.deviceLabel || requestedLabel);
    sessionStorage.removeItem(WORKSTATION_INTENT);
    sessionStorage.removeItem(WORKSTATION_REQUEST_LABEL);

    const verified = await client.auth.verifyOtp({ token_hash:data.otpTokenHash, type:'email' });
    if (verified.error || !verified.data?.session) throw verified.error || new Error('The one-time workstation sign-in could not be completed.');
    const grant = sessionStorage.getItem(WORKSTATION_GRANT) || '';
    const label = sessionStorage.getItem(WORKSTATION_LABEL) || 'Shared shop computer';
    const completed = await client.rpc('complete_workstation_enrollment', {
      enrollment_token:grant,
      device_id:deviceId,
      device_label:label
    });
    if (completed.error || !completed.data?.ok) throw completed.error || new Error('The workstation trust record could not be completed.');

    sessionStorage.removeItem(WORKSTATION_GRANT);
    sessionStorage.removeItem(WORKSTATION_LABEL);
    sessionStorage.removeItem('gotcracked-staff');
    sessionStorage.removeItem('gc-discord-verified-user');
    window.GotCrackedAuth?.clear?.();
    location.replace(`${location.pathname}#dashboard`);
    return true;
  }

  async function resumeWorkstationEnrollment() {
    const grant = sessionStorage.getItem(WORKSTATION_GRANT);
    if (!grant) return false;
    const restored = window.GotCrackedAuth?.restoreSession ? await window.GotCrackedAuth.restoreSession({force:true}) : null;
    const session = restored?.session;
    if (!session || session.user.identities?.some(identity => identity.provider === 'discord')) return false;
    const deviceId = ensureDeviceId();
    const completed = await client.rpc('complete_workstation_enrollment', {
      enrollment_token:grant,
      device_id:deviceId,
      device_label:sessionStorage.getItem(WORKSTATION_LABEL) || 'Shared shop computer'
    });
    if (completed.error || !completed.data?.ok) throw completed.error || new Error('The workstation enrollment expired. Sign in with Discord and enroll it again.');
    sessionStorage.removeItem(WORKSTATION_GRANT);
    sessionStorage.removeItem(WORKSTATION_LABEL);
    sessionStorage.removeItem('gotcracked-staff');
    location.replace(`${location.pathname}#dashboard`);
    return true;
  }

  async function downloadKioskSetupFromLogin() {
    if (sessionStorage.getItem(KIOSK_INTENT) !== '1') return false;
    const restored = window.GotCrackedAuth?.restoreSession
      ? await window.GotCrackedAuth.restoreSession({ force:true })
      : await client.auth.getSession().then(({data,error}) => ({session:data?.session || null,error}));
    const token = restored?.session?.access_token;
    if (!token) throw new Error('Sign in again to prepare kiosk setup.');
    authMessage('Preparing the protected kiosk setup…');
    const endpoint = `${String(client.supabaseUrl || '').replace(/\/$/, '')}/functions/v1/private-kiosk-download`;
    if (!endpoint.startsWith('https://')) throw new Error('Kiosk setup is unavailable outside the secure Portal connection.');
    const headers = { Authorization:`Bearer ${token}`, 'Content-Type':'application/json' };
    if (client.supabaseKey) headers.apikey = client.supabaseKey;
    const response = await fetch(endpoint, { method:'POST', headers, body:'{}', cache:'no-store' });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload?.error || 'Only active owners and managers can prepare kiosk setup.');
    }
    const bundle = await response.blob();
    if (bundle.size < 512) throw new Error('Portal returned an invalid kiosk bundle.');
    const disposition = response.headers.get('content-disposition') || '';
    const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || 'gotcracked-kiosk-setup.zip';
    const url = URL.createObjectURL(bundle);
    const link = document.createElement('a');
    link.href = url; link.download = filename; link.style.display = 'none';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    sessionStorage.removeItem(KIOSK_INTENT);
    sessionStorage.setItem('gc-kiosk-setup-ready', '1');
    return true;
  }

  async function createInvite(form) {
    const fields = Object.fromEntries(new FormData(form));
    const { data, error } = await client.functions.invoke('staff-invite', { body: fields });
    if (error || !data?.ok) throw new Error(data?.error || error?.message || 'Unable to onboard the employee.');
    const packageText = `GotCracked welcome package\nEmployee: ${data.staff.displayName}\nRole: ${data.staff.jobTitle || data.staff.role}\nEmployee address: ${data.staff.portalEmail}\n\n1. Join the staff Discord: ${data.discordInviteUrl}\n2. Open the private Portal invitation: ${data.portalInviteUrl}\n3. Continue with Discord and complete the guided onboarding checklist.\n4. Create a personal workstation PIN when prompted.\n\nPortal access uses Discord. No temporary password is issued.`;
    let copied = false;
    try { await navigator.clipboard.writeText(packageText); copied = true; } catch {}
    return { ...data, packageText, copied };
  }

  function safeHttpsUrl(value) {
    try { const url = new URL(String(value || '')); return url.protocol === 'https:' ? url.toString() : ''; }
    catch { return ''; }
  }

  function appendLine(output, label, value, { code = false } = {}) {
    output.append(document.createTextNode(`${label}: `));
    if (code) { const element=document.createElement('code'); element.textContent=String(value||''); output.append(element); }
    else output.append(document.createTextNode(String(value || '')));
    output.append(document.createElement('br'));
  }

  function appendSafeLink(output, label, value) {
    output.append(document.createTextNode(`${label}: `));
    const url=safeHttpsUrl(value);
    if (url) { const link=document.createElement('a'); link.href=url; link.target='_blank'; link.rel='noopener noreferrer'; link.textContent=url; output.append(link); }
    else output.append(document.createTextNode('Unavailable'));
    output.append(document.createElement('br'));
  }

  function renderOnboardingPackage(output, result) {
    if (!output) return;
    output.replaceChildren();
    const heading=document.createElement('strong');
    heading.textContent=`Premium onboarding package ${result.copied ? 'created and copied' : 'created'}.`;
    output.append(heading,document.createElement('br'));
    appendLine(output,'Employee address',result.staff?.portalEmail);
    appendSafeLink(output,'Staff Discord',result.discordInviteUrl);
    appendSafeLink(output,'Private Portal invitation',result.portalInviteUrl);
    const note=document.createElement('small');
    note.textContent='The private Portal invitation and Discord invite expire in seven days. No temporary password is created.';
    output.append(note);
    if (result.welcomeEmailBody) {
      const copy=document.createElement('button');
      copy.type='button'; copy.className='text-button'; copy.textContent='Copy welcome email';
      copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(`Subject: ${result.welcomeEmailSubject}\n\n${result.welcomeEmailBody}`);copy.textContent='Welcome email copied';}catch{copy.textContent='Copy unavailable';}});
      output.append(document.createElement('br'),copy);
    }
    document.dispatchEvent(new CustomEvent('gc-staff-invite-created',{detail:result}));
  }

  function showOnboardingMessage(message) {
    if (!message || document.querySelector('.onboarding-notice')) return;
    const staffView=document.querySelector('#staff .page-heading');
    if (!staffView) return;
    const notice=document.createElement('div'); notice.className='onboarding-notice';
    const heading=document.createElement('strong'); heading.textContent='Finish account setup';
    const detail=document.createElement('span'); detail.textContent=String(message);
    notice.append(heading,detail); staffView.insertAdjacentElement('afterend',notice);
  }

  function wireUi() {
    document.querySelector('#google-login')?.addEventListener('click', async event => {
      const button=event.currentTarget; button.disabled=true; button.textContent='Connecting to Google…';
      try { await signInWithGoogle(); }
      catch (error) { authMessage(error.message,true); button.disabled=false; button.textContent='Continue with Google Workspace'; }
    });
    document.querySelector('#discord-login')?.addEventListener('click', async event => {
      const button=event.currentTarget; button.disabled=true; button.textContent='Connecting to Discord…';
      try { await signInWithDiscord(); }
      catch (error) { authMessage(error.message,true); button.disabled=false; button.textContent='Continue with Discord'; }
    });
    const priorError=sessionStorage.getItem('gc-auth-error');
    if(priorError){authMessage(priorError,true);sessionStorage.removeItem('gc-auth-error');}
    const onboardingMessage=sessionStorage.getItem('gc-onboarding-message');
    if(onboardingMessage){showOnboardingMessage(onboardingMessage);sessionStorage.removeItem('gc-onboarding-message');}
    document.addEventListener('gc-onboarding-required',event=>showOnboardingMessage(event.detail));

    document.addEventListener('click',async event=>{
      if(event.target.closest('#link-discord')){event.target.disabled=true;try{await linkDiscord();}catch(error){alert(error.message);event.target.disabled=false;}}
    });
    document.addEventListener('submit',async event=>{
      if(event.target.id!=='staff-invite-form')return;
      event.preventDefault();
      const output=document.querySelector('#staff-invite-output');
      try{const result=await createInvite(event.target);event.target.reset();renderOnboardingPackage(output,result);}
      catch(error){if(output)output.textContent=error.message;}
    });
  }

  window.GotCrackedDiscordReady=Promise.resolve({ready:true});

  function scheduleBackgroundVerify(force=false) {
    const run=async()=>{
      const result=await verifyOnce({force}).catch(error=>({authorized:false,transient:true,reason:error?.message}));
      if(result.authorized && sessionStorage.getItem(WORKSTATION_INTENT)==='1') {
        try { await beginWorkstationEnrollment(); return; }
        catch(error){sessionStorage.setItem('gc-auth-error',error?.message||'Workstation enrollment failed.');authMessage(error?.message,true);}
      }
      if(result.authorized && sessionStorage.getItem(KIOSK_INTENT)==='1') {
        try { await downloadKioskSetupFromLogin(); return; }
        catch(error){sessionStorage.removeItem(KIOSK_INTENT);sessionStorage.setItem('gc-auth-error',error?.message||'Kiosk setup could not be prepared.');authMessage(error?.message,true);}
      }
      if(!result.authorized&&result.transient)setTimeout(()=>verifyOnce({force:false}).catch(()=>{}),15000);
    };
    if(force)return setTimeout(run,50);
    if('requestIdleCallback'in window)window.requestIdleCallback(run,{timeout:4000});else setTimeout(run,3000);
  }

  client.auth.onAuthStateChange((event,session)=>{
    if(event==='SIGNED_OUT'){sessionStorage.removeItem('gc-discord-verified-user');return;}
    if(event==='SIGNED_IN'&&session){
      const oauthJustStarted=sessionStorage.getItem('gc-discord-auth-started')==='1';
      scheduleBackgroundVerify(oauthJustStarted);
    }
  });

  resumeWorkstationEnrollment().catch(error=>{sessionStorage.removeItem(WORKSTATION_GRANT);sessionStorage.removeItem(WORKSTATION_LABEL);sessionStorage.setItem('gc-auth-error',error?.message||'Workstation enrollment expired.');});
  scheduleBackgroundVerify(false);
  wireUi();
})();

