(()=>{
  'use strict';
  if(window.GotCrackedMarlonTaskGuard||!window.supabaseClient||!window.fetch)return;
  const client=window.supabaseClient;
  const nativeFetch=window.fetch.bind(window);
  let capabilityCache=null;
  let capabilityAt=0;
  const CACHE_MS=60000;
  const clean=v=>String(v??'').trim();

  function highLevelIntent(text){
    const value=clean(text).toLowerCase();
    const action=/\b(make|add|create|move|change|update|modify|deploy|release|replace|remove|delete|migrate|restructure|reorganize|rearrange|redesign|rewrite|rebuild|overhaul|restart|reboot|integrate|enable|disable|configure|implement|apply|ship|publish)\b/.test(value);
    const risk=/\b(authentication|authorization|auth|permission|permissions|role|roles|rls|payment|payments|billing|checkout|database|schema|migration|migrations|secret|secrets|credential|credentials|production|deploy|deployment|cloudflare|downtime|restart|reboot|delete|purge|destructive|discord server|channel structure|webhook|integration|workflow|major|entire|whole|restructure|reorganize|redesign|rewrite|rebuild|overhaul|ui|layout|navigation|sidebar|dashboard|header|footer|menu|modal|dialog|component|components|interface|section|panel|page structure|visual hierarchy|workflow interface)\b/.test(value);
    return action&&risk;
  }
  function actionableIntent(text){
    const value=clean(text).toLowerCase().replace(/\s+/g,' ');
    if(!value)return false;
    const action=/\b(fix|repair|change|update|modify|add|create|remove|replace|implement|apply|configure|integrate|translate|redesign|rebuild|move|rename|enable|disable|make|build|improve|correct|resolve)\b/.test(value);
    const request=/\b(i want|i need|i'd like|i would like|please|can you|could you|would you|we need|we want|let's|lets)\b/.test(value)||/^(fix|repair|change|update|modify|add|create|remove|replace|implement|apply|configure|integrate|translate|redesign|rebuild|move|rename|enable|disable|make|build|improve|correct|resolve)\b/.test(value);
    const informational=/\b(explain|tell me|show me|what is|what does|why is|how does|how do i)\b/.test(value)&&!/\b(fix|change|update|add|implement|apply|build|make|resolve|translate)\b/.test(value);
    return action&&request&&!informational;
  }
  function surfaceFor(text){const v=clean(text).toLowerCase();if(/\bcloudflare\b/.test(v))return'cloudflare';if(/\bdiscord\b/.test(v))return'discord';if(/\brepository|github|repo\b/.test(v))return'repository';if(/\bwebsite|site\b/.test(v))return'website';return'portal'}
  function categoryFor(text,surface){const v=clean(text).toLowerCase();if(/\b(account|login|sign.?in|password|profile)\b/.test(v))return'account';if(/\b(data|database|record|sync|realtime)\b/.test(v))return'data';if(/\b(deploy|deployment|cloudflare|release)\b/.test(v))return'deployment';if(/\b(workflow|process|queue|onboarding)\b/.test(v))return'workflow';if(surface==='website')return'website_ui';if(surface==='portal'&&/\b(ui|layout|screen|page|button|modal|panel|sidebar|dashboard|error message|error code)\b/.test(v))return'portal_ui';return'general'}
  function titleFor(text){return clean(text).replace(/\s+/g,' ').replace(/^(please\s+|can you\s+|could you\s+|would you\s+|i(?: would|'d)? like (?:you )?to\s+|i need (?:you )?to\s+|i want (?:you )?to\s+)/i,'').slice(0,180)||'Marlon action request'}
  function fingerprint(text,surface){const value=`${surface}|${clean(text).toLowerCase().replace(/\s+/g,' ')}`;let hash=2166136261;for(let i=0;i<value.length;i++){hash^=value.charCodeAt(i);hash=Math.imul(hash,16777619)}return`marlon-v1-${(hash>>>0).toString(36)}-${value.length}`}

  async function capabilities(){
    if(capabilityCache&&Date.now()-capabilityAt<CACHE_MS)return capabilityCache;
    try{const {data,error}=await client.rpc('get_marlon_execution_capabilities');if(error)throw error;capabilityCache=data||{};capabilityAt=Date.now();return capabilityCache}catch(error){console.warn('Marlon capability registry unavailable:',error);return{}}
  }
  async function ensureTicket(text,source){
    if(!actionableIntent(text)||highLevelIntent(text))return null;
    const surface=surfaceFor(text);
    const {data,error}=await client.rpc('ensure_marlon_chat_ticket',{
      p_title:titleFor(text),p_description:clean(text).slice(0,5000),p_surface:surface,p_category:categoryFor(text,surface),
      p_fingerprint:fingerprint(text,surface),p_source:source==='call'?'marlon_call':'marlon_chat',
      p_context:{view:location.hash||'#dashboard',path:location.pathname,requested_scope:clean(text).slice(0,4000),tracked_by:'marlon-task-guard'}
    });
    if(error)throw error;
    const row=Array.isArray(data)?data[0]:data;
    if(!row?.id)throw new Error('Marlon could not create a Support Desk record for this work request.');
    return{id:row.id,ticketNumber:row.ticket_number,code:`SUP-${String(row.ticket_number||0).padStart(4,'0')}`,status:row.status||'open',surface:row.surface||surface,title:row.title||titleFor(text)};
  }
  function executionPolicy(caps){
    return 'Execution truth rule: capability registry is authoritative. Never say a task is being implemented, deployed, monitored, fixed, verified, or completed unless the matching capability is active and an actual execution receipt/status proves it. A Support Desk ticket only proves the request is logged/queued. If an executor is blocked or degraded, state that accurately and keep the ticket at Open/Waiting rather than claiming work is underway. Owner approval authorizes scope but does not itself prove an executor ran.';
  }

  window.fetch=async function marlonTaskGuardFetch(input,init={}){
    const url=typeof input==='string'?input:input?.url||'';
    const method=String(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();
    if(method!=='POST'||!String(url).includes('/portal/chat'))return nativeFetch(input,init);
    try{
      const raw=init?.body??(input instanceof Request?await input.clone().text():'');
      const payload=typeof raw==='string'?JSON.parse(raw||'{}'):null;
      if(!payload)return nativeFetch(input,init);
      const messages=Array.isArray(payload.messages)?payload.messages:[];
      const latest=[...messages].reverse().find(m=>m?.role==='user');
      const text=clean(latest?.content);
      const source=payload?.context?.source==='call'?'call':'text';
      const [caps,ticket]=await Promise.all([capabilities(),ensureTicket(text,source)]);
      payload.context={...(payload.context||{}),executionCapabilities:caps,executionPolicy:executionPolicy(caps),workTicket:ticket};
      const headers=new Headers(init?.headers||(input instanceof Request?input.headers:undefined));headers.set('Content-Type','application/json');
      const response=await nativeFetch(url,{...init,method:'POST',headers,body:JSON.stringify(payload)});
      if(!ticket)return response;
      const data=await response.clone().json().catch(()=>null);
      if(!data?.reply)return response;
      const reply=String(data.reply).includes(ticket.code)?String(data.reply):`${data.reply}\n\nTracked as ${ticket.code}.`;
      const outHeaders=new Headers(response.headers);outHeaders.set('Content-Type','application/json');
      return new Response(JSON.stringify({...data,reply,workTicket:ticket}),{status:response.status,statusText:response.statusText,headers:outHeaders});
    }catch(error){
      console.error('Marlon task guard failed:',error);
      throw error;
    }
  };

  window.GotCrackedMarlonTaskGuard={version:'1.0.0',capabilities,ensureTicket,actionableIntent,highLevelIntent,get cachedCapabilities(){return capabilityCache}};
})();
