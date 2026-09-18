(() => {
  'use strict';
  const client=window.supabaseClient;
  const DEVICE='gc-workstation-device-id',REQUEST='gc-workstation-pair-request-id',RECOVERY='gc-workstation-pair-recovery';
  const input=document.getElementById('request-id'),status=document.getElementById('pairing-status');
  const requestApproval=document.getElementById('request-approval');
  const check=document.getElementById('check-approval'),resume=document.getElementById('complete-pairing'),open=document.getElementById('open-portal');
  let timer=null,busy=false;
  const validId=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  function show(message,state='pending'){status.textContent=message;document.documentElement.dataset.enrollmentState=state;}
  function proof(){let value=localStorage.getItem(DEVICE);if(!value||value.length<32||value.length>256){value=[...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('');localStorage.setItem(DEVICE,value);}return value;}
  function saved(){try{return JSON.parse(sessionStorage.getItem(RECOVERY)||'null');}catch{return null;}}
  function stop(){clearTimeout(timer);timer=null;}
  async function call(action){
    const response=await fetch(`${client.supabaseUrl}/functions/v1/workstation-enroll-approval`,{method:'POST',cache:'no-store',referrerPolicy:'no-referrer',
      headers:{'Content-Type':'application/json',apikey:client.supabaseKey},body:JSON.stringify({action,requestId:input.value.trim(),deviceId:proof()}),signal:AbortSignal.timeout(15000)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.ok)throw new Error(data.error||'Enrollment is temporarily unavailable. Check its status before retrying.');
    return data;
  }
  async function requestFreshApproval(){
    if(!['127.0.0.1','localhost'].includes(location.hostname))throw new Error('Fresh approvals can only be requested from the AuroraServer local pairing page.');
    if(saved())throw new Error('Resume the saved enrollment before requesting another approval.');
    const existing=await trusted();if(existing){success(existing);return;}
    requestApproval.disabled=true;check.disabled=true;show('Sending a device-bound approval request to your linked Discord account…');
    try{
      const response=await fetch(`http://${location.hostname}:8788/internal/workstation-enrollment/request`,{method:'POST',cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',
        headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId:proof(),deviceLabel:'AuroraServer GotCracked'}),signal:AbortSignal.timeout(18000)});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||!data.ok)throw new Error(data.error||'Unable to request secure Discord approval.');
      input.value=data.requestId;localStorage.setItem(REQUEST,data.requestId);
      show(`Secure approval sent${data.approver?` to ${data.approver}`:''}. Waiting for the Discord button…`);
      await poll();
    }finally{requestApproval.disabled=false;check.disabled=false;}
  }
  async function trusted(){const auth=await client.auth.getSession();if(auth.error)throw new Error('Session restore is unavailable.');if(!auth.data?.session)return null;const result=await client.rpc('get_my_trusted_workstation_status');if(result.error)throw new Error('Workstation trust verification is unavailable. Do not assume enrollment succeeded.');return result.data?.trusted===true?result.data:null;}
  function success(data){stop();sessionStorage.removeItem(RECOVERY);resume.hidden=true;check.disabled=false;open.hidden=false;show(`Trusted workstation verified: ${data.device_label||'Shared shop computer'}. Personal operator PIN is still required in Portal.`,'trusted');}
  async function finish(){
    if(busy)return;busy=true;stop();resume.disabled=true;check.disabled=true;
    try{
      let pending=saved();
      const existing=await trusted();if(existing){success(existing);return;}
      if(!pending){show('Approval verified. Claiming this browser enrollment once…');pending={...(await call('redeem')),requestId:input.value.trim()};sessionStorage.setItem(RECOVERY,JSON.stringify(pending));}
      if(pending.requestId!==input.value.trim())throw new Error('Saved enrollment belongs to another request. Do not mix approvals.');
      if(Date.parse(pending.grantExpiresAt)<=Date.now()){sessionStorage.removeItem(RECOVERY);throw new Error('Saved enrollment expired. A fresh Discord approval is required.');}
      if(!pending.verifiedUserId){
        show('Creating the dedicated shared-workstation session…');
        const result=await client.auth.verifyOtp({token_hash:pending.otpTokenHash,type:'email'});
        if(result.error||!result.data?.session)throw new Error('One-time workstation sign-in failed. Check status; never reuse an old approval.');
        pending.verifiedUserId=result.data.session.user.id;delete pending.otpTokenHash;
        sessionStorage.setItem(RECOVERY,JSON.stringify(pending));
      }
      const user=await client.auth.getUser();
      if(user.error||user.data?.user?.id!==pending.verifiedUserId)throw new Error('Workstation session identity does not match this enrollment.');
      show('Binding the server trust record to this browser session…');
      const result=await client.rpc('complete_workstation_enrollment',{enrollment_token:pending.enrollmentToken,device_id:proof(),device_label:pending.deviceLabel});
      if(result.error||!result.data?.ok){const verified=await trusted();if(verified){success(verified);return;}throw new Error('The trust record is not confirmed. Resume this saved enrollment before it expires.');}
      const verified=await trusted();if(!verified)throw new Error('Enrollment completion returned without verified browser trust.');success(verified);
    }catch(error){show(error.message||'Enrollment could not be confirmed.','error');resume.hidden=!saved();}
    finally{busy=false;resume.disabled=false;check.disabled=false;}
  }
  async function poll(){
    stop();if(busy)return;
    if(!validId(input.value.trim())){show('Enter the request ID provided by your administrator.','error');return;}
    localStorage.setItem(REQUEST,input.value.trim());check.disabled=true;
    try{
      const result=await call('status');
      if(result.status==='approved'){show('Your Discord approval is verified. Completing this browser enrollment…');await finish();return;}
      if(result.status==='consumed'){
        const verified=await trusted();if(verified){success(verified);return;}
        if(saved()){resume.hidden=false;show('The approval was claimed. Resume the saved completion; do not redeem it again.');}
        else show('The approval was claimed but this browser has no saved completion or verified trust. A fresh approval is required.','error');return;
      }
      if(['expired','denied'].includes(result.status)){show(`This enrollment was ${result.status}. A fresh administrator request is required.`,'error');return;}
      show(`Waiting for your secure Discord approval. Expires ${new Date(result.expiresAt).toLocaleTimeString()}. No QR login or pairing code is needed.`);
      timer=setTimeout(poll,5000);
    }catch(error){show(error.message||'Unable to check enrollment status.','error');}
    finally{check.disabled=false;}
  }
  document.getElementById('pairing-form').addEventListener('submit',event=>{event.preventDefault();poll();});
  requestApproval.addEventListener('click',()=>requestFreshApproval().catch(error=>show(error.message||'Unable to request secure Discord approval.','error')));
  resume.addEventListener('click',finish);window.addEventListener('pagehide',stop);
  if(!client){show('Portal authentication library did not load. Reload before continuing.','error');check.disabled=true;requestApproval.disabled=true;return;}
  try{
    proof();input.value=localStorage.getItem(REQUEST)||'';
    requestApproval.hidden=!['127.0.0.1','localhost'].includes(location.hostname);
    if(saved()){resume.hidden=false;show('An unfinished enrollment is saved in this tab. Resume it before expiry.');}
    else show(requestApproval.hidden?'This browser is ready for a device-bound approval request.':'This browser is ready. Send a fresh secure approval to Discord when needed.');
    setTimeout(()=>trusted().then(existing=>{if(existing)success(existing)}).catch(()=>{}),0);
  }catch{show('Persistent browser storage is unavailable. Enrollment cannot safely continue.','error');check.disabled=true;requestApproval.disabled=true;}
})();
