(()=>{
  'use strict';
  if(window.GotCrackedOperatorRequestContext)return;

  const PROJECT_ORIGIN='https://uvpmmbioerejeyybfntb.supabase.co';
  const TOKEN_KEY='gc-workstation-operator-token';
  const originalFetch=window.fetch.bind(window);

  function operatorToken(){
    try{return sessionStorage.getItem(TOKEN_KEY)||'';}catch{return '';}
  }
  function requestUrl(input){
    try{return typeof input==='string'?input:String(input?.url||input||'');}catch{return '';}
  }
  function shouldAttach(url){
    return Boolean(url&&url.startsWith(`${PROJECT_ORIGIN}/rest/v1/`));
  }

  window.fetch=(input,init={})=>{
    const token=operatorToken();
    const url=requestUrl(input);
    if(!token||!shouldAttach(url))return originalFetch(input,init);
    const sourceHeaders=input instanceof Request?input.headers:undefined;
    const headers=new Headers(init?.headers||sourceHeaders||undefined);
    headers.set('x-gc-operator-token',token);
    if(input instanceof Request){
      const request=new Request(input,{...init,headers});
      return originalFetch(request);
    }
    return originalFetch(input,{...init,headers});
  };

  function sync(){
    document.documentElement.dataset.gcOperatorContext=operatorToken()?'verified':'none';
  }
  document.addEventListener('gc-workstation-operator-changed',sync);
  window.addEventListener('storage',event=>{if(event.key===TOKEN_KEY)sync();});
  sync();
  window.GotCrackedOperatorRequestContext={version:'1.0.0',token:operatorToken,sync};
})();
