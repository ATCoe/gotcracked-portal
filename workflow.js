(() => {
  'use strict';

  window.GotCrackedRepairs = [];

  const repairStatusLabels = {
    checked_in: 'Checked in (legacy)', in_diagnosis: 'In diagnosis (legacy)', awaiting_approval: 'Awaiting approval (legacy)', waiting_on_parts: 'Waiting on parts (legacy)', in_repair: 'In repair (legacy)', ready_for_pickup: 'Ready for pickup (legacy)', completed: 'Completed (legacy)',
    awaiting_repair: 'Awaiting Repair', need_to_order_parts: 'Need to Order Parts', awaiting_parts: 'Awaiting Parts', diagnostic_in_progress: 'Diagnostic in Progress', repair_in_progress: 'Repair in Progress', quality_inspection: 'Quality Inspection', awaiting_callback: 'Awaiting Callback', repaired: 'Repaired – Ready for Pickup', sale_complete: 'Sale Complete', abandoned: 'Abandoned', unrepairable: 'Unrepairable', customer_declined: 'Customer Declined', cancelled: 'Cancelled'
  };

  const loginScreen=document.querySelector('#login-screen');
  const loginForm=document.querySelector('#login-form');
  const loginEmail=document.querySelector('#login-email');
  const loginPassword=document.querySelector('#login-password');
  const loginError=document.querySelector('#login-error');
  const signOutButton=document.querySelector('#sign-out');
  const signInPanel=document.querySelector('#sign-in-panel');
  const forgotPasswordPanel=document.querySelector('#forgot-password-panel');
  const newPasswordPanel=document.querySelector('#new-password-panel');
  const forgotPasswordForm=document.querySelector('#forgot-password-form');
  const newPasswordForm=document.querySelector('#new-password-form');
  let recoveryMode=window.location.hash.includes('type=recovery');

  const report=(error,context)=>window.GotCrackedDiagnostics?.error?.(error,{context});
  function renderRepairs(){if(window.GotCrackedUI?.filterRepairs)window.GotCrackedUI.filterRepairs();else window.GotCrackedUI?.renderRepairs?.(window.GotCrackedRepairs);}
  function showLoginError(message){if(!loginError)return;loginError.textContent=message||'';loginError.style.display=message?'block':'none';}
  function clearLoginError(){showLoginError('');}
  function setMessage(element,message,isError=false){if(!element)return;element.textContent=message||'';element.classList.toggle('error',Boolean(isError));}
  function showAuthPanel(panel){[signInPanel,forgotPasswordPanel,newPasswordPanel].forEach(item=>{if(!item)return;const active=item===panel;item.classList.toggle('hidden',!active);item.setAttribute('aria-hidden',String(!active));});loginScreen?.classList.remove('hidden');}
  function clearRecoveryUrl(){window.history.replaceState({},document.title,window.location.pathname+window.location.search);}
  function showRecoveryPanel(){recoveryMode=true;showAuthPanel(newPasswordPanel);setMessage(document.querySelector('#new-password-message'),'Use the form below to set your new password.');document.querySelector('#new-password')?.focus();}

  function setStaff(staff){
    const nameElement=document.querySelector('#staff-name'),roleElement=document.querySelector('#staff-role'),initialsElement=document.querySelector('#staff-initials');
    if(nameElement)nameElement.textContent=staff.name||'Staff';
    if(roleElement)roleElement.textContent=staff.role||'Staff';
    if(initialsElement)initialsElement.textContent=(staff.name||'Staff').split(' ').filter(Boolean).map(part=>part[0]).join('').slice(0,2).toUpperCase();
  }

  async function localSignOut(message=''){
    sessionStorage.removeItem('gotcracked-staff');
    sessionStorage.removeItem('gc-workstation-operator-token');
    sessionStorage.removeItem('gc-workstation-operator');
    sessionStorage.removeItem('gc-workstation-operator-expiry');
    try{await window.supabaseClient.auth.signOut({scope:'local'});}catch{}
    loginScreen?.classList.remove('hidden');
    if(message)showLoginError(message);
  }

  async function rejectUntrustedWorkstation(){
    await localSignOut('This shared workstation is not enrolled or has been revoked. Choose “Set up Front Desk Workstation” and authorize it with an owner or manager Discord account.');
  }

  async function prepareHumanSession(session){
    if(!session)return false;
    const hasDiscord=session.user?.identities?.some(identity=>identity.provider==='discord');
    if(hasDiscord){
      const verified=await window.GotCrackedVerifyDiscord?.({force:true});
      if(!verified?.authorized){
        if(!verified?.transient)await localSignOut(verified?.reason||'Discord access could not be verified.');
        else showLoginError('Discord verification is temporarily unavailable. Please retry in a moment.');
        return false;
      }
    }
    return true;
  }

  async function loadProfile(userId,session=null){
    const {data:profile,error}=await window.supabaseClient.from('profiles').select('*').eq('id',userId).single();
    if(error){report(error,'Staff profile could not be loaded');showLoginError('Your account signed in, but your staff profile could not be loaded.');return false;}
    if(!profile){showLoginError('Your account signed in, but no staff profile was found.');return false;}
    if(!profile.active){await localSignOut('Your GotCracked staff access is inactive. Contact an owner or manager.');return false;}

    if(profile.account_type==='shared_workstation'){
      const trusted=await window.supabaseClient.rpc('get_my_trusted_workstation_status');
      if(trusted.error||!trusted.data?.trusted){await rejectUntrustedWorkstation();return false;}
    }else{
      const activeSession=session||(await window.supabaseClient.auth.getSession()).data?.session||null;
      const viaDiscord=activeSession?.user?.identities?.some(identity=>identity.provider==='discord');
      if(!viaDiscord){
        if(profile.role!=='owner'){
          await localSignOut('Human staff access requires Discord authentication. Use “Continue with Discord” to sign in.');
          return false;
        }
        const registered=await window.supabaseClient.rpc('register_owner_recovery_session');
        if(registered.error||registered.data!==true){
          await localSignOut('Owner password access is only available as a verified recovery session. Use Discord for normal Portal access.');
          return false;
        }
      }else{
        await window.supabaseClient.rpc('touch_portal_human_session').catch?.(()=>{});
      }
    }

    const staff={id:userId,name:profile.display_name||'Staff',role:profile.role||'Staff',account_type:profile.account_type||'staff'};
    sessionStorage.setItem('gotcracked-staff',JSON.stringify(staff));setStaff(staff);
    window.GotCrackedNeedsDiscordLink=profile.account_type!=='shared_workstation'&&!profile.discord_user_id;
    loginScreen?.classList.add('hidden');
    if(window.GotCrackedNeedsDiscordLink){
      const message='Link your individual Discord account in Staff access. Discord is the normal human sign-in method; owner password access is recovery-only.';
      sessionStorage.setItem('gc-onboarding-message',message);
      document.dispatchEvent(new CustomEvent('gc-onboarding-required',{detail:message}));
      setTimeout(()=>document.querySelector('[data-view="staff"]')?.click(),0);
    }
    return true;
  }

  async function loadRepairs(){
    if(!window.supabaseClient){report('Supabase client unavailable.','Repair tickets could not be loaded');return;}
    const {data,error}=await window.supabaseClient.from('repair_tickets').select(`*,customers (first_name, last_name),devices (model),profiles:assigned_user_id (display_name)`).order('ticket_number',{ascending:false});
    if(error){report(error,'Repair tickets could not be loaded');return;}
    window.GotCrackedRepairs=(data||[]).map(ticket=>{const customerName=`${ticket.customers?.first_name||''} ${ticket.customers?.last_name||''}`.trim();return{id:ticket.ticket_number,customer:customerName||ticket.customer_id||'Unknown customer',device:ticket.devices?.model||ticket.device_id||'Unknown device',service:ticket.customer_issue||'No service listed',tech:ticket.profiles?.display_name||ticket.assigned_user_id||'—',statusKey:ticket.status||'awaiting_repair',status:repairStatusLabels[ticket.status]||ticket.status||'Awaiting Repair',updated:ticket.updated_at?new Date(ticket.updated_at).toLocaleString():'Recently updated',icon:'▯'};});renderRepairs();
  }

  async function loadSession(){
    await window.GotCrackedDiscordReady;
    if(!window.supabaseClient){showLoginError('The portal could not connect to authentication.');return;}
    if(recoveryMode){showRecoveryPanel();return;}
    try{
      const {data,error}=await window.supabaseClient.auth.getSession();
      if(error){report(error,'Portal session could not be restored');return;}
      const session=data?.session;if(!session)return;
      const isWorkstationSession=!session.user?.identities?.some(identity=>identity.provider==='discord');
      if(!isWorkstationSession&&!(await prepareHumanSession(session)))return;
      if(await loadProfile(session.user.id,session))await loadRepairs();
    }catch(error){report(error,'Portal session could not be restored');showLoginError(error?.message||'Portal sign-in could not be completed.');}
  }

  document.querySelector('#forgot-password')?.addEventListener('click',()=>{clearLoginError();setMessage(document.querySelector('#forgot-password-message'),'');showAuthPanel(forgotPasswordPanel);document.querySelector('#reset-email')?.focus();});
  document.querySelector('[data-show-sign-in]')?.addEventListener('click',()=>{showAuthPanel(signInPanel);loginEmail?.focus();});

  forgotPasswordForm?.addEventListener('submit',async event=>{
    event.preventDefault();const message=document.querySelector('#forgot-password-message'),email=document.querySelector('#reset-email')?.value?.trim();
    if(!email){setMessage(message,'Enter your owner recovery email.',true);return;}if(!window.supabaseClient){setMessage(message,'The portal could not connect to authentication. Please refresh and try again.',true);return;}
    const button=forgotPasswordForm.querySelector('button[type="submit"]');if(button){button.disabled=true;button.textContent='Sending…';}setMessage(message,'');
    try{const {error}=await window.supabaseClient.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin+window.location.pathname});if(error)throw error;setMessage(message,'If this email belongs to an owner recovery account, a reset link has been sent.');}catch(error){setMessage(message,error?.message||'Unable to send the reset link. Please try again.',true);}finally{if(button){button.disabled=false;button.textContent='Send reset link';}}
  });

  newPasswordForm?.addEventListener('submit',async event=>{
    event.preventDefault();const message=document.querySelector('#new-password-message'),password=document.querySelector('#new-password')?.value||'',confirmation=document.querySelector('#confirm-password')?.value||'';
    if(password.length<8){setMessage(message,'Use a password with at least 8 characters.',true);return;}if(password!==confirmation){setMessage(message,'The passwords do not match.',true);return;}
    const button=newPasswordForm.querySelector('button[type="submit"]');if(button){button.disabled=true;button.textContent='Saving…';}setMessage(message,'');
    try{const {error}=await window.supabaseClient.auth.updateUser({password});if(error)throw error;await window.supabaseClient.auth.signOut({scope:'local'});clearRecoveryUrl();recoveryMode=false;newPasswordForm.reset();showAuthPanel(signInPanel);showLoginError('Owner recovery password updated. Sign in with your new password.');loginEmail?.focus();}catch(error){setMessage(message,error?.message||'Unable to save the new password. Request another reset link and try again.',true);}finally{if(button){button.disabled=false;button.textContent='Save new password';}}
  });

  window.supabaseClient?.auth.onAuthStateChange(event=>{if(event==='PASSWORD_RECOVERY')showRecoveryPanel();});

  let loginInProgress=false;
  async function handleLogin(event){
    event?.preventDefault();event?.stopPropagation();if(loginInProgress)return;loginInProgress=true;clearLoginError();
    if(!window.supabaseClient){showLoginError('Authentication is not available. Please refresh the portal.');loginInProgress=false;return;}
    const email=loginEmail?.value?.trim()||'',password=loginPassword?.value||'';
    if(!email){showLoginError('Please enter your owner recovery email.');loginEmail?.focus();loginInProgress=false;return;}if(!password){showLoginError('Please enter your password.');loginPassword?.focus();loginInProgress=false;return;}
    const submitButton=loginForm?.querySelector('button[type="submit"]');if(submitButton){submitButton.disabled=true;submitButton.textContent='Signing in...';}
    try{
      const {data,error}=await window.supabaseClient.auth.signInWithPassword({email,password});if(error){showLoginError(error.message||'Unable to sign in.');return;}if(!data?.user){showLoginError('Sign-in completed without a user account.');return;}
      const profileCheck=await window.supabaseClient.from('profiles').select('role,account_type').eq('id',data.user.id).maybeSingle();
      if(profileCheck.error||profileCheck.data?.role!=='owner'||profileCheck.data?.account_type==='shared_workstation'){try{await window.supabaseClient.auth.signOut({scope:'local'});}catch{}showLoginError('Password sign-in is reserved for owner account recovery. Staff use Discord; shared computers use secure workstation enrollment.');return;}
      if(!(await loadProfile(data.user.id,data.session)))return;await loadRepairs();
    }catch(error){showLoginError(error?.message||'An unexpected error occurred while signing in.');}finally{if(submitButton){submitButton.disabled=false;submitButton.textContent='Sign in to portal';}loginInProgress=false;}
  }

  loginForm?.addEventListener('submit',handleLogin);
  loginForm?.querySelector('button[type="submit"]')?.addEventListener('click',event=>{event.preventDefault();handleLogin(event);});
  signOutButton?.addEventListener('click',async event=>{event.preventDefault();try{await window.supabaseClient?.auth.signOut({scope:'local'});}catch(error){report(error,'Sign out failed');}sessionStorage.removeItem('gotcracked-staff');sessionStorage.removeItem('gc-workstation-operator-token');sessionStorage.removeItem('gc-workstation-operator');sessionStorage.removeItem('gc-workstation-operator-expiry');window.GotCrackedRepairs=[];loginScreen?.classList.remove('hidden');renderRepairs();});

  loadSession();
})();
