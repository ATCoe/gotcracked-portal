(() => {
  'use strict';

  const client = window.supabaseClient;
  if (!client || window.GotCrackedTimeClock) return;

  const state = {
    data:null,
    busy:false,
    lastLoadedAt:0,
    timer:null,
    poller:null
  };

  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[c]);
  const profile = () => window.GotCrackedRuntimeProfile || window.GotCrackedOperationsV1?.state?.profile || null;
  const statusLabel = value => value === 'working' ? 'Working' : value === 'on_break' ? 'On break' : 'Off clock';
  const statusDetail = data => {
    if (!data || data.state === 'off_clock') return 'Ready when you are.';
    if (data.state === 'on_break') return `Break started ${clock(data.break_started_at)}.`;
    return `Clocked in ${clock(data.clock_in)}.`;
  };
  const clock = value => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit'}).format(date);
  };
  const elapsed = data => {
    if (!data || data.state === 'off_clock') return '0:00';
    const base = Number(data.paid_seconds || 0);
    const loaded = Number(state.lastLoadedAt || Date.now());
    const extra = data.state === 'working' ? Math.max(0,Math.floor((Date.now()-loaded)/1000)) : 0;
    const seconds = Math.max(0,base+extra);
    const hours = Math.floor(seconds/3600);
    const minutes = Math.floor((seconds%3600)/60);
    return `${hours}:${String(minutes).padStart(2,'0')}`;
  };

  function miniHost(){ return document.getElementById('sidebar-time-clock'); }
  function dashboardHost(){ return document.getElementById('dashboard-time-clock'); }

  function actionButtons(data, compact=false){
    if (!data || data.state === 'off_clock') {
      return `<button type="button" class="gc-clock-primary" data-timeclock-action="clock_in">Clock in</button>`;
    }
    if (data.state === 'on_break') {
      return `<button type="button" class="gc-clock-primary" data-timeclock-action="break_end">End break</button><button type="button" class="gc-clock-danger" data-timeclock-action="clock_out">Clock out</button>`;
    }
    return `<button type="button" class="gc-clock-secondary" data-timeclock-action="break_start">Start break</button><button type="button" class="gc-clock-danger" data-timeclock-action="clock_out">Clock out</button>`;
  }

  function renderMini(){
    const host=miniHost();
    if(!host) return;
    const data=state.data || {state:'off_clock'};
    host.className=`gc-timeclock-mini ${state.busy?'gc-timeclock-busy':''}`;
    host.dataset.state=data.state || 'off_clock';
    host.innerHTML=`<div class="gc-timeclock-mini-head"><span class="gc-timeclock-state">${esc(statusLabel(data.state))}</span><strong data-timeclock-elapsed>${esc(elapsed(data))}</strong></div><div class="gc-timeclock-mini-actions">${actionButtons(data,true)}</div><span class="gc-timeclock-mini-note">${esc(statusDetail(data))}</span>`;
  }

  function renderDashboard(){
    const host=dashboardHost();
    if(!host) return;
    const data=state.data || {state:'off_clock'};
    host.className=`gc-dashboard-clock ${state.busy?'gc-timeclock-busy':''}`;
    host.dataset.state=data.state || 'off_clock';
    host.innerHTML=`<div class="gc-dashboard-clock-main"><span class="gc-dashboard-clock-icon" aria-hidden="true">◷</span><div class="gc-dashboard-clock-copy"><small>Time clock</small><strong>${esc(statusLabel(data.state))}</strong><span>${esc(statusDetail(data))}</span></div></div><div class="gc-dashboard-clock-time"><strong data-timeclock-elapsed>${esc(elapsed(data))}</strong><div class="gc-dashboard-clock-actions">${actionButtons(data,false)}</div></div>`;
  }

  function render(){ renderMini(); renderDashboard(); }

  function tick(){
    document.querySelectorAll('[data-timeclock-elapsed]').forEach(node=>{ node.textContent=elapsed(state.data); });
  }

  async function canUse(){
    const {data,error}=await client.rpc('has_permission',{permission_key:'timeclock.use'});
    if(error) throw error;
    return Boolean(data);
  }

  async function load({quiet=false}={}){
    const p=profile();
    if(!p?.id || !p?.location_id) return;
    try{
      if(!(await canUse())){
        miniHost()?.remove();
        dashboardHost()?.remove();
        return;
      }
      const {data,error}=await client.rpc('get_time_clock_state');
      if(error) throw error;
      state.data=data || {state:'off_clock'};
      state.lastLoadedAt=Date.now();
      render();
    }catch(error){
      console.error('Time clock state failed:',error);
      if(!quiet) window.GotCrackedDiagnostics?.error?.(error,{context:'Time clock unavailable'});
    }
  }

  async function act(action,button){
    if(state.busy) return;
    state.busy=true;
    render();
    try{
      const {data,error}=await client.rpc('time_clock_action',{action});
      if(error) throw error;
      state.data=data || {state:'off_clock'};
      state.lastLoadedAt=Date.now();
      render();
      document.dispatchEvent(new CustomEvent('gc-timeclock-change',{detail:state.data}));
      window.GotCrackedCrossUserSync?.pollNow?.();
    }catch(error){
      console.error('Time clock action failed:',error);
      window.GotCrackedDiagnostics?.error?.(error,{context:'Time clock update failed'});
      await load({quiet:true});
    }finally{
      state.busy=false;
      render();
      if(button) button.disabled=false;
    }
  }

  document.addEventListener('click',event=>{
    const button=event.target instanceof Element ? event.target.closest('[data-timeclock-action]') : null;
    if(!button) return;
    event.preventDefault();
    button.disabled=true;
    act(button.dataset.timeclockAction,button);
  });

  document.addEventListener('gc-cross-user-sync',()=>load({quiet:true}));
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') load({quiet:true}); });
  window.addEventListener('focus',()=>load({quiet:true}));
  window.addEventListener('online',()=>load({quiet:true}));

  state.timer=setInterval(tick,1000);
  state.poller=setInterval(()=>{ if(document.visibilityState==='visible') load({quiet:true}); },30000);
  setTimeout(()=>load(),100);

  window.GotCrackedTimeClock={
    load,
    action:act,
    get state(){ return state.data; },
    stop(){ clearInterval(state.timer); clearInterval(state.poller); }
  };
})();
