(() => {
  'use strict';

  if (window.GotCrackedAccountSync) return;
  const client = window.supabaseClient;
  if (!client) return;

  const VERSION = '20260826-account1';
  const OWNER_KEY = 'gc-account-sync-owner';
  const POLL_MS = 30000;
  const WATCH_MS = 700;
  const RETRY_MS = 5000;

  const descriptors = [
    { pref:'theme', local:'gc-portal-theme', type:'string', defaultValue:'system' },
    { pref:'directory_dashboard', local:'gc-directory-persistent-dashboard', session:'gc-directory-dashboard', type:'json', defaultValue:{} },
    { pref:'directory_leads', local:'gc-directory-persistent-leads', session:'gc-directory-leads', type:'json', defaultValue:{} },
    { pref:'saved_filters_dashboard', local:'gc-directory-saved-filters-dashboard', type:'json', defaultValue:[] },
    { pref:'saved_filters_leads', local:'gc-directory-saved-filters-leads', type:'json', defaultValue:[] }
  ];

  const state = {
    profileId:null,
    preferences:{},
    updatedAt:null,
    ready:false,
    applying:false,
    pushBusy:false,
    pollBusy:false,
    pending:new Map(),
    localSnapshot:new Map(),
    realtimeChannel:null,
    realtimeStatus:'idle',
    retryTimer:null
  };

  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const stable = value => {
    try { return JSON.stringify(value); }
    catch { return String(value); }
  };

  function storageFor(name){
    try { return name === 'session' ? window.sessionStorage : window.localStorage; }
    catch { return null; }
  }

  function parseRaw(raw,type){
    if (raw == null) return undefined;
    if (type === 'json') {
      try { return JSON.parse(raw); }
      catch { return undefined; }
    }
    return String(raw);
  }

  function serialize(value,type){
    if (type === 'json') return JSON.stringify(value ?? null);
    return String(value ?? '');
  }

  function readDescriptor(desc){
    const local = storageFor('local');
    const session = storageFor('session');
    let raw = local?.getItem(desc.local);
    if (raw == null && desc.session) raw = session?.getItem(desc.session);
    return parseRaw(raw,desc.type);
  }

  function writeDescriptor(desc,value){
    const raw = serialize(value,desc.type);
    storageFor('local')?.setItem(desc.local,raw);
    if (desc.session) storageFor('session')?.setItem(desc.session,raw);
  }

  function defaultPreferences(){
    return Object.fromEntries(descriptors.map(desc=>[desc.pref,clone(desc.defaultValue)]));
  }

  function collectLocal({allowExisting=true}={}){
    const result={};
    for (const desc of descriptors) {
      const value=allowExisting ? readDescriptor(desc) : undefined;
      result[desc.pref]=value === undefined ? clone(desc.defaultValue) : value;
    }
    return result;
  }

  function markSnapshot(){
    for (const desc of descriptors) state.localSnapshot.set(desc.pref,stable(readDescriptor(desc)));
  }

  function currentProfile(){
    return window.GotCrackedRuntimeProfile || window.GotCrackedOperationsV1?.state?.profile || null;
  }

  async function waitForProfile(){
    const current=currentProfile();
    if(current?.id) return current;
    return window.GotCrackedRuntime?.waitForProfile?.() || null;
  }

  function applyTheme(value){
    const preference=['light','dark','system'].includes(value) ? value : 'system';
    if (window.GotCrackedTheme?.preference !== preference) window.GotCrackedTheme?.set?.(preference);
  }

  function applyPreferences(next,{source='remote'}={}){
    if(!next || typeof next!=='object') return [];
    const changed=[];
    state.applying=true;
    try {
      for(const desc of descriptors){
        if(!(desc.pref in next)) continue;
        const value=clone(next[desc.pref]);
        if(stable(state.preferences[desc.pref])!==stable(value)) changed.push(desc.pref);
        state.preferences[desc.pref]=value;
        writeDescriptor(desc,value);
        if(desc.pref==='theme') applyTheme(value);
      }
      markSnapshot();
    } finally {
      state.applying=false;
    }
    if(changed.length){
      document.dispatchEvent(new CustomEvent('gc-account-preferences-updated',{detail:{source,keys:changed,preferences:clone(state.preferences)}}));
    }
    return changed;
  }

  async function pushPreference(pref,value){
    state.pending.set(pref,clone(value));
    if(state.pushBusy || !state.profileId) return;
    state.pushBusy=true;
    try{
      while(state.pending.size){
        const [key,next]=state.pending.entries().next().value;
        state.pending.delete(key);
        const {data,error}=await client.rpc('set_my_portal_preference',{pref_key:key,pref_value:next});
        if(error){
          console.warn('Account preference sync failed:',error.message);
          state.pending.set(key,next);
          break;
        }
        if(data && typeof data==='object') state.preferences={...state.preferences,...data};
      }
    } finally {
      state.pushBusy=false;
    }
  }

  async function seedMissing(remote,local){
    const merged={...(remote||{})};
    for(const desc of descriptors){
      if(desc.pref in merged) continue;
      const value=clone(local[desc.pref]);
      merged[desc.pref]=value;
      await pushPreference(desc.pref,value);
    }
    return merged;
  }

  async function fetchRemote(){
    if(!state.profileId) return null;
    const {data,error}=await client
      .from('portal_user_preferences')
      .select('preferences,updated_at')
      .eq('profile_id',state.profileId)
      .maybeSingle();
    if(error){
      console.warn('Account preference record unavailable:',error.message);
      return null;
    }
    return data || {preferences:null,updated_at:null};
  }

  async function refreshRemote({source='poll'}={}){
    if(state.pollBusy || !state.profileId || document.visibilityState==='hidden') return;
    state.pollBusy=true;
    try{
      const row=await fetchRemote();
      if(!row?.preferences) return;
      if(row.updated_at && row.updated_at===state.updatedAt) return;
      state.updatedAt=row.updated_at || state.updatedAt;
      applyPreferences(row.preferences,{source});
    } finally { state.pollBusy=false; }
  }

  async function connectRealtime(){
    if(state.realtimeChannel || !state.profileId) return;
    try{
      const {data:{session}}=await client.auth.getSession();
      if(!session?.access_token) return;
      await client.realtime.setAuth(session.access_token);
      state.realtimeChannel=client
        .channel(`gc-account-sync-${state.profileId}`)
        .on('postgres_changes',{
          event:'*',schema:'public',table:'portal_user_preferences',
          filter:`profile_id=eq.${state.profileId}`
        },payload=>{
          const row=payload.new || null;
          if(!row?.preferences) return;
          state.updatedAt=row.updated_at || state.updatedAt;
          applyPreferences(row.preferences,{source:'realtime'});
        })
        .subscribe(status=>{
          state.realtimeStatus=status;
          if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)){
            const old=state.realtimeChannel;
            state.realtimeChannel=null;
            if(old) client.removeChannel(old).catch(()=>{});
            clearTimeout(state.retryTimer);
            state.retryTimer=setTimeout(connectRealtime,RETRY_MS);
          }
        });
    } catch(error){
      state.realtimeStatus='error';
      state.realtimeChannel=null;
      console.warn('Account preference Realtime connection failed; polling remains active.',error);
      clearTimeout(state.retryTimer);
      state.retryTimer=setTimeout(connectRealtime,RETRY_MS);
    }
  }

  async function initialize(){
    const profile=await waitForProfile();
    if(!profile?.id) throw new Error('Staff profile unavailable for account sync.');
    state.profileId=profile.id;

    const localOwner=storageFor('local')?.getItem(OWNER_KEY) || null;
    const sameOwner=!localOwner || localOwner===state.profileId;
    const local=collectLocal({allowExisting:sameOwner});
    const row=await fetchRemote();
    let remote=row?.preferences && typeof row.preferences==='object' ? row.preferences : {};
    state.updatedAt=row?.updated_at || null;

    remote=await seedMissing(remote,local);
    if(!Object.keys(remote).length) remote=defaultPreferences();
    state.preferences={...remote};
    applyPreferences(remote,{source:'initial'});
    storageFor('local')?.setItem(OWNER_KEY,state.profileId);
    markSnapshot();
    state.ready=true;
    document.dispatchEvent(new CustomEvent('gc-account-sync-ready',{detail:{profileId:state.profileId,preferences:clone(state.preferences)}}));
    connectRealtime();
    return clone(state.preferences);
  }

  function watchLocal(){
    if(!state.ready || state.applying) return;
    for(const desc of descriptors){
      const value=readDescriptor(desc);
      if(value===undefined) continue;
      const serialized=stable(value);
      const before=state.localSnapshot.get(desc.pref);
      if(serialized===before) continue;
      state.localSnapshot.set(desc.pref,serialized);
      state.preferences[desc.pref]=clone(value);
      pushPreference(desc.pref,value);
    }
  }

  document.addEventListener('gc-theme-change',()=>setTimeout(watchLocal,0));
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible'){
      refreshRemote({source:'visibility'});
      if(!state.realtimeChannel) connectRealtime();
    }
  });
  window.addEventListener('online',()=>{
    refreshRemote({source:'online'});
    if(!state.realtimeChannel) connectRealtime();
  });

  client.auth.onAuthStateChange((event,session)=>{
    if(event==='SIGNED_OUT'){
      state.ready=false;
      state.profileId=null;
      state.preferences={};
      state.updatedAt=null;
      if(state.realtimeChannel) client.removeChannel(state.realtimeChannel).catch(()=>{});
      state.realtimeChannel=null;
      state.realtimeStatus='signed-out';
      return;
    }
    if(session && ['SIGNED_IN','INITIAL_SESSION','TOKEN_REFRESHED'].includes(event)){
      client.realtime.setAuth(session.access_token).catch(()=>{});
    }
  });

  const watchTimer=setInterval(watchLocal,WATCH_MS);
  const pollTimer=setInterval(()=>refreshRemote({source:'poll'}),POLL_MS);
  const ready=initialize().catch(error=>{
    console.error('Account-wide Portal sync failed to initialize:',error);
    document.dispatchEvent(new CustomEvent('gc-account-sync-error',{detail:{message:error.message||String(error)}}));
    throw error;
  });

  window.GotCrackedAccountSync={
    version:VERSION,
    ready,
    get state(){return state;},
    get(key){return clone(state.preferences[key]);},
    set(key,value){state.preferences[key]=clone(value);return pushPreference(key,value);},
    refresh:()=>refreshRemote({source:'manual'}),
    stop(){clearInterval(watchTimer);clearInterval(pollTimer);clearTimeout(state.retryTimer);if(state.realtimeChannel)client.removeChannel(state.realtimeChannel).catch(()=>{});}
  };
})();
