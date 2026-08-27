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
  const clock = value => {
    if (!value) return '';
    if (/^\d{2}:\d{2}/.test(String(value))) {
      const [h,m]=String(value).slice(0,5).split(':').map(Number);
      const d=new Date(); d.setHours(h,m,0,0);
      return new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit'}).format(d);
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit'}).format(date);
  };
  const day = value => {
    if(!value) return '';
    const date=new Date(`${String(value).slice(0,10)}T12:00:00`);
    return Number.isNaN(date.getTime())?'':new Intl.DateTimeFormat('en-US',{weekday:'short',month:'short',day:'numeric'}).format(date);
  };
  const hours = seconds => Math.max(0,Number(seconds)||0)/3600;
  const attendanceText = data => {
    if(!data?.clock_in_status) return '';
    const variance=Number(data.clock_in_variance_minutes);
    if(data.clock_in_status==='late'&&Number.isFinite(variance)) return `${Math.abs(variance)}m late`;
    if(data.clock_in_status==='early'&&Number.isFinite(variance)) return `${Math.abs(variance)}m early`;
    if(data.clock_in_status==='on_time') return 'On time';
    if(data.clock_in_status==='unscheduled') return 'Unscheduled clock-in';
    return '';
  };
  const shiftText = shift => shift ? `${clock(shift.starts_at)}–${clock(shift.ends_at)}${shift.role_label?` · ${shift.role_label}`:''}` : '';
  const statusDetail = data => {
    if (!data || data.state === 'off_clock') {
      if(data?.today_shift) return `Scheduled ${shiftText(data.today_shift)} today.`;
      if(data?.next_shift) return `Next shift ${day(data.next_shift.date)} · ${shiftText(data.next_shift)}.`;
      return 'Ready when you are.';
    }
    if (data.state === 'on_break') return `Break started ${clock(data.break_started_at)}.`;
    const attendance=attendanceText(data);
    return `Clocked in ${clock(data.clock_in)}${attendance?` · ${attendance}`:''}.`;
  };
  const elapsed = data => {
    if (!data || data.state === 'off_clock') return '0:00';
    const base = Number(data.paid_seconds || 0);
    const loaded = Number(state.lastLoadedAt || Date.now());
    const extra = data.state === 'working' ? Math.max(0,Math.floor((Date.now()-loaded)/1000)) : 0;
    const seconds = Math.max(0,base+extra);
    const h = Math.floor(seconds/3600);
    const minutes = Math.floor((seconds%3600)/60);
    return `${h}:${String(minutes).padStart(2,'0')}`;
  };
  const weeklyPaidHours = data => hours(data?.weekly_paid_seconds);
  const overtimeThreshold = data => Number(data?.overtime_warning_hours)||40;
  const overtimeRisk = data => weeklyPaidHours(data)>=overtimeThreshold(data);

  function miniHost(){ return document.getElementById('sidebar-time-clock'); }
  function dashboardHost(){ return document.getElementById('dashboard-time-clock'); }

  function injectStyle(){
    if(document.getElementById('gc-timeclock-premium-style')) return;
    const style=document.createElement('style');
    style.id='gc-timeclock-premium-style';
    style.textContent=`
      .gc-timeclock-week-context{display:flex;flex-wrap:wrap;gap:7px 12px;margin-top:8px;font-size:.78rem;color:var(--muted,#667085)}
      .gc-timeclock-week-context span{display:inline-flex;align-items:center;gap:5px}.gc-timeclock-week-context .is-warning{font-weight:750;color:#a15c00}
      .gc-timeclock-attendance{display:inline-flex;width:max-content;margin-top:4px;border-radius:999px;padding:2px 7px;font-size:.7rem;font-weight:800;background:rgba(43,124,255,.12)}
      .gc-timeclock-attendance.late,.gc-timeclock-attendance.unscheduled{background:rgba(180,35,24,.11);color:#b42318}
      @media(max-width:640px){.gc-timeclock-week-context{font-size:.74rem;gap:5px 9px}}
    `;
    document.head.appendChild(style);
  }

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
    const paid=weeklyPaidHours(data);
    const scheduled=Number(data.scheduled_week_hours)||0;
    const attendance=attendanceText(data);
    const hasPremiumContext='weekly_paid_seconds' in data || 'scheduled_week_hours' in data || data.today_shift || data.next_shift;
    host.className=`gc-dashboard-clock ${state.busy?'gc-timeclock-busy':''}`;
    host.dataset.state=data.state || 'off_clock';
    host.innerHTML=`<div class="gc-dashboard-clock-main"><span class="gc-dashboard-clock-icon" aria-hidden="true">◷</span><div class="gc-dashboard-clock-copy"><small>Time clock</small><strong>${esc(statusLabel(data.state))}</strong><span>${esc(statusDetail(data))}</span>${attendance?`<span class="gc-timeclock-attendance ${esc(data.clock_in_status||'')}">${esc(attendance)}</span>`:''}${hasPremiumContext?`<div class="gc-timeclock-week-context"><span class="${overtimeRisk(data)?'is-warning':''}">${paid.toFixed(1)}h paid this week</span><span>${scheduled.toFixed(1)}h scheduled</span><span>${overtimeThreshold(data).toFixed(0)}h overtime warning</span></div>`:''}</div></div><div class="gc-dashboard-clock-time"><strong data-timeclock-elapsed>${esc(elapsed(data))}</strong><div class="gc-dashboard-clock-actions">${actionButtons(data,false)}</div></div>`;
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

  injectStyle();
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