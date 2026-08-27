(()=>{
  'use strict';
  if(window.__gcMarlonReportingBridge)return;window.__gcMarlonReportingBridge=true;
  const client=window.supabaseClient;if(!client)return;
  const previousFetch=window.fetch.bind(window);
  const clean=v=>String(v??'').trim();
  const reportingIntent=text=>/\b(bookkeep|bookkeeping|books|report|reporting|profit|loss|margin|sales|revenue|tax|tender|payment|receipt|reconcil|audit|employee performance|employee sales|recognition|inventory value|purchase order|p&l|income statement)\b/i.test(text);
  const auditIntent=text=>/\b(run|perform|do|check|cross[- ]?audit|audit)\b.*\b(audit|books|bookkeeping|sales|reconcil|receipt|payment)\b/i.test(text)||/\bcross[- ]?audit\b/i.test(text);
  const capacityIntent=text=>/\b(queue|workload|capacity|appointment|booking|booked|same[- ]?day|turnaround|repair time|repair timing|how long|throughput|repair in progress|parts delay|parts availability)\b/i.test(text);
  const trimReporting=data=>data?{available:data.available,range_start:data.range_start,range_end:data.range_end,days:data.days,summary:data.summary,profit_and_loss:data.profit_and_loss,tax:data.tax,payments:(data.payments||[]).slice(0,12),audit:data.audit?{...data.audit,findings:(data.audit.findings||[]).slice(0,16)}:null,employee_recognition:data.employee_recognition?{...data.employee_recognition,employees:(data.employee_recognition.employees||[]).slice(0,8)}:null,daily:(data.daily||[]).slice(-14),scope_note:data.scope_note}:null;
  const trimCapacity=data=>data?{available:data.available,policy:data.policy,timing:data.timing?{days:data.timing.days,measurement:data.timing.measurement,overall:data.timing.overall,by_device_class:data.timing.by_device_class,recent_tickets:(data.timing.recent_tickets||[]).slice(0,10)}:null,forecast:data.forecast?{target_date:data.forecast.target_date,scheduled_technician_minutes:data.forecast.scheduled_technician_minutes,capacity_utilization:data.forecast.capacity_utilization,usable_repair_minutes:data.forecast.usable_repair_minutes,actionable_queue_minutes:data.forecast.actionable_queue_minutes,blocked_backlog_minutes:data.forecast.blocked_backlog_minutes,appointment_minutes:data.forecast.appointment_minutes,remaining_capacity_minutes:data.forecast.remaining_capacity_minutes,capacity_source:data.forecast.capacity_source,queue:(data.forecast.queue||[]).slice(0,12),appointments:(data.forecast.appointments||[]).slice(0,12)}:null}:null;
  async function contextFor(text){
    const out={};
    if(reportingIntent(text)){
      try{const rpc=auditIntent(text)?await client.rpc('run_bookkeeping_cross_audit',{p_range_start:null,p_range_end:null,p_persist:true}):await client.rpc('get_marlon_reporting_context',{p_days:30});if(!rpc.error)out.reporting=auditIntent(text)?{audit:rpc.data,mode:'fresh_persisted_cross_audit'}:trimReporting(rpc.data)}catch(error){console.warn('Marlon reporting context unavailable',error)}
      out.reportingPolicy='Act as GotCracked bookkeeping/reporting auditor. Analyze and cross-check records in detail, but do not alter, post, delete, refund, close, or manufacture sales/accounting entries. Distinguish Portal management reporting from a complete GAAP financial statement and explicitly identify data limitations.';
    }
    if(capacityIntent(text)){
      try{const rpc=await client.rpc('get_marlon_repair_capacity_context',{p_days:90,p_date:null});if(!rpc.error)out.repairCapacity=trimCapacity(rpc.data)}catch(error){console.warn('Marlon repair capacity context unavailable',error)}
      out.capacityPolicy='Measure repair labor only while status is repair_in_progress; paused statuses such as parts/customer/approval do not count. Phones are the only category eligible for a same-day promise, and only when parts and conservative capacity both permit it. Treat every other device class as multi-day.';
    }
    return out;
  }
  window.fetch=async(input,init={})=>{
    const url=typeof input==='string'?input:input?.url||'';const method=String(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();
    if(method!=='POST'||!url.includes('/portal/chat'))return previousFetch(input,init);
    try{
      const raw=init?.body??(input instanceof Request?await input.clone().text():'');const payload=typeof raw==='string'?JSON.parse(raw||'{}'):null;const messages=Array.isArray(payload?.messages)?payload.messages:[];const latest=[...messages].reverse().find(m=>m?.role==='user');const text=clean(latest?.content);
      if(text&&payload){const operational=await contextFor(text);if(Object.keys(operational).length){payload.context={...(payload.context||{}),operational:{...(payload.context?.operational||{}),...operational}};window.GotCrackedMarlonOperationalContext={...(window.GotCrackedMarlonOperationalContext||{}),...operational};const headers=new Headers(init?.headers||(input instanceof Request?input.headers:undefined));headers.set('Content-Type','application/json');return previousFetch(url,{...init,method:'POST',headers,body:JSON.stringify(payload)})}}
    }catch(error){console.warn('Marlon reporting/capacity context bridge unavailable for this turn.',error)}
    return previousFetch(input,init);
  };
})();
