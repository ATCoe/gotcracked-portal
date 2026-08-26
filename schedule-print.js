(() => {
  'use strict';

  if (window.GotCrackedSchedulePrint) return;

  const profile = () => window.GotCrackedRuntimeProfile || window.GotCrackedOperationsV1?.state?.profile || null;
  const board = () => window.GotCrackedScheduleBoard?.state || null;
  const parseDate = value => new Date(`${value}T12:00:00`);
  const formatDate = (value, options={month:'short',day:'numeric'}) => new Intl.DateTimeFormat('en-US',options).format(parseDate(value));

  function payloadFromState(){
    const state = board();
    const summary = state?.summary;
    const p = profile();
    if(!summary || !summary.week_start) return null;
    const weekEnd = summary.week_end || (()=>{ const d=parseDate(summary.week_start); d.setDate(d.getDate()+6); return d.toISOString().slice(0,10); })();
    return {
      location_name:p?.locations?.name || document.querySelector('.location')?.textContent?.replace('⌄','').trim() || 'GotCracked',
      week_start:summary.week_start,
      week_end:weekEnd,
      week_label:`${formatDate(summary.week_start)} – ${formatDate(weekEnd,{month:'short',day:'numeric',year:'numeric'})}`,
      status:summary.status || 'unpublished',
      staff:Array.isArray(summary.staff)?summary.staff:[],
      days:Array.isArray(summary.days)?summary.days:[],
      shifts:Array.isArray(summary.shifts)?summary.shifts:[],
      time_off:Array.isArray(summary.time_off)?summary.time_off:[],
      generated_at:new Date().toISOString(),
      generated_by:p?.display_name || 'GotCracked staff'
    };
  }

  function ensureButton(){
    if(location.hash.slice(1).split('/')[0] !== 'schedule') return;
    const actions=document.querySelector('#schedule .gc-schedule-toolbar-actions');
    if(!actions || actions.querySelector('[data-print-schedule]')) return;
    const button=document.createElement('button');
    button.type='button';
    button.className='secondary-button';
    button.dataset.printSchedule='true';
    button.textContent='Print schedule';
    actions.appendChild(button);
  }

  function openPrint(){
    const payload=payloadFromState();
    if(!payload){
      window.GotCrackedDiagnostics?.error?.(new Error('The schedule has not finished loading yet.'),{context:'Unable to print schedule'});
      return;
    }
    if(!payload.staff.length && payload.status === 'unpublished'){
      window.GotCrackedDiagnostics?.error?.(new Error('There is no published schedule for this week.'),{context:'Unable to print schedule'});
      return;
    }

    const job=`${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
    try{
      sessionStorage.setItem(`gc-schedule-print:${job}`,JSON.stringify(payload));
    }catch(error){
      window.GotCrackedDiagnostics?.error?.(error,{context:'Unable to prepare schedule printout'});
      return;
    }

    const popup=window.open(`schedule-print.html?job=${encodeURIComponent(job)}`,'_blank','noopener');
    if(!popup){
      sessionStorage.removeItem(`gc-schedule-print:${job}`);
      window.GotCrackedDiagnostics?.error?.(new Error('Allow pop-ups for portal.gotcracked.co to print the schedule.'),{context:'Print window blocked'});
    }
  }

  document.addEventListener('click',event=>{
    if(event.target instanceof Element && event.target.closest('[data-print-schedule]')){
      event.preventDefault();
      openPrint();
    }
  });

  document.addEventListener('gc-view-changed',event=>{
    const view=typeof event.detail==='string'?event.detail:event.detail?.view;
    if(view==='schedule') setTimeout(ensureButton,60);
  });
  document.addEventListener('gc-cross-user-sync',()=>setTimeout(ensureButton,80));
  document.addEventListener('gc-timeclock-change',()=>setTimeout(ensureButton,80));
  window.addEventListener('hashchange',()=>setTimeout(ensureButton,80));

  const observerTarget=document.getElementById('schedule-board');
  if(observerTarget){
    const observer=new MutationObserver(()=>ensureButton());
    observer.observe(observerTarget,{childList:true,subtree:false});
  }

  window.GotCrackedSchedulePrint={open:openPrint,ensureButton};
  setTimeout(ensureButton,120);
})();
