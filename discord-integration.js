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
    if (restored?.error || !session) return { authorized:false, reason:'no-session', transient:Boolean(restored?.error) };

    const hasDiscord = session.user.identities?.some(identity => identity.provider === 'discord');
    if (!hasDiscord) return { authorized:true, skipped:true };
    const verifiedUser = sessionStorage.getItem('gc-discord-verified-user');
    if (!force && verifiedUser === session.user.id) return { authorized:true, cached:true };

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

  function injectWorkstationEnrollmentUi() {
    if (document.getElementById('workstation-enroll')) return;
    const discord=document.getElementById('discord-login');
    if (!discord) return;
    const wrap=document.createElement('div'); wrap.className='gc-workstation-enroll-login';
    const heading=document.createElement('p'); heading.className='gc-shop-setup-heading'; heading.textContent='Set up this shop device';
    const label=document.createElement('label'); label.className='gc-workstation-label'; label.htmlFor='workstation-device-label'; label.textContent='Computer name';
    const input=document.createElement('input'); input.id='workstation-device-label'; input.name='workstation-device-label'; input.type='text'; input.maxLength=120; input.autocomplete='off'; input.placeholder='e.g. Front desk, Bench 2, Receiving';
    const button=document.createElement('button'); button.id='workstation-enroll'; button.type='button'; button.className='secondary-button'; button.textContent='Set up shared shop computer';
    const kiosk=document.createElement('button'); kiosk.id='kiosk-setup-download'; kiosk.type='button'; kiosk.className='text-button gc-kiosk-login-action'; kiosk.textContent='Download self-service kiosk setup';
    const note=document.createElement('small'); note.textContent='Owners and managers authorize shared shop computers with Discord. Kiosk setup is prepared only for an approved tablet.';
    wrap.append(heading,label,input,button,kiosk,note); discord.insertAdjacentElement('afterend',wrap);
    if (!document.getElementById('gc-workstation-enroll-login-style')) {
      const style=document.createElement('style'); style.id='gc-workstation-enroll-login-style'; style.textContent='.gc-workstation-enroll-login{display:grid;gap:9px;margin-top:18px;padding-top:18px;border-top:1px solid rgba(143,183,221,.18)}.gc-shop-setup-heading{margin:0;color:#dceafb;font-size:12px;font-weight:850;letter-spacing:.08em;text-transform:uppercase}.gc-workstation-label{display:grid;gap:6px;color:#9eb2ca;font-size:12px;font-weight:750}.gc-workstation-label+input{width:100%;min-height:44px}.gc-workstation-enroll-login .secondary-button{width:100%}.gc-kiosk-login-action{justify-self:start;padding:4px 0;color:#79c8ff;font-weight:750}.gc-workstation-enroll-login small{display:block;line-height:1.45;opacity:.72}'; document.head.appendChild(style);
    }
  }

  function wireUi() {
    injectWorkstationEnrollmentUi();
    document.querySelector('#discord-login')?.addEventListener('click', async event => {
      const button=event.currentTarget; button.disabled=true; button.textContent='Connecting to Discord…';
      try { await signInWithDiscord(); }
      catch (error) { authMessage(error.message,true); button.disabled=false; button.textContent='Continue with Discord'; }
    });
    document.querySelector('#workstation-enroll')?.addEventListener('click', async event => {
      const button=event.currentTarget; const deviceLabel=document.querySelector('#workstation-device-label')?.value?.trim() || 'Shared shop computer'; button.disabled=true; button.textContent='Opening secure authorization…';
      sessionStorage.setItem(WORKSTATION_INTENT,'1');
      sessionStorage.setItem(WORKSTATION_REQUEST_LABEL,deviceLabel);
      try { await signInWithDiscord(); }
      catch(error){sessionStorage.removeItem(WORKSTATION_INTENT);sessionStorage.removeItem(WORKSTATION_REQUEST_LABEL);authMessage(error.message,true);button.disabled=false;button.textContent='Set up shared shop computer';}
    });
    document.querySelector('#kiosk-setup-download')?.addEventListener('click', async event => {
      const button=event.currentTarget; button.disabled=true; button.textContent='Opening secure authorization…';
      sessionStorage.setItem(KIOSK_INTENT,'1');
      try { await signInWithDiscord(); }
      catch(error){sessionStorage.removeItem(KIOSK_INTENT);authMessage(error.message,true);button.disabled=false;button.textContent='Download self-service kiosk setup';}
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

