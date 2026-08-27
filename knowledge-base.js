(() => {
  'use strict';

  const VERSION = '20260827-kb2';
  const KB_VIEW = 'repair-reference';
  const NAV_GROUPS = [
    ['Workspace', ['dashboard']],
    ['Service Desk', ['repairs', 'ready-pickup', 'appointments', 'customers', 'leads']],
    ['Store Operations', ['shipping', 'inventory', 'purchasing']],
    ['Team', ['schedule']],
    ['Knowledge', [KB_VIEW]],
    ['Management', ['reports', 'staff']]
  ];
  const SOURCES = [
    {key:'gotcracked',name:'GotCracked',type:'Internal',status:'Live',description:'GotCracked diagnostic paths, bench procedures, cautions, and technician reference data.',action:'Browse internal guides'},
    {key:'ifixit',name:'iFixit',type:'Third-party',status:'License required',description:'Industry repair guides and device teardowns. Commercial guide ingestion stays disabled until a commercial content/API license is in place.',url:'https://www.ifixit.com/Device',action:'Open iFixit'},
    {key:'apple',name:'Apple Self Service Repair',type:'Manufacturer',status:'Official',description:'Apple repair manuals, parts and tool requirements for supported iPhone, iPad, Mac, display, and Beats repairs.',url:'https://support.apple.com/self-service-repair',action:'Open Apple manuals'},
    {key:'samsung',name:'Samsung Self-Repair',type:'Manufacturer',status:'Official',description:'Samsung model-specific self-repair documentation, genuine parts, and supported repair resources.',url:'https://www.samsung.com/us/support/self-repair/',action:'Open Samsung repair'},
    {key:'google',name:'Google Pixel Repair',type:'Manufacturer',status:'Official',description:'Pixel repair manuals, genuine-parts guidance, and Pixel Repair Diagnostics resources.',url:'https://support.google.com/pixelphone/answer/14257407?hl=en',action:'Open Pixel repair'}
  ];

  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[c]);
  const words = value => String(value || '').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
  const haystack = (...values) => values.flat(Infinity).filter(Boolean).join(' ').toLowerCase();
  const view = () => location.hash.slice(1).split('/')[0] || 'dashboard';
  const state = {query:'',category:'all',mode:'guides'};
  let navObserver = null;
  let hostObserver = null;
  let navFrame = 0;
  let rendering = false;

  function ensureStyles(){
    for(const file of ['knowledge-base.css','knowledge-base-layout-fix.css']){
      if(document.querySelector(`link[data-gc-kb-style="${file}"]`))continue;
      const link=document.createElement('link');link.rel='stylesheet';link.href=`${file}?v=${VERSION}`;link.dataset.gcKbStyle=file;document.head.appendChild(link);
    }
  }

  function observeNav(nav){
    if(!navObserver)return;
    navObserver.observe(nav,{childList:true,subtree:true});
  }

  function premiumLink(link){
    const active=link.classList.contains('active'),hidden=link.classList.contains('v1-hidden');
    link.className=`nav-link gc-kb-nav${active?' active':''}${hidden?' v1-hidden':''}`;
    link.href='#repair-reference';link.dataset.view=KB_VIEW;link.setAttribute('aria-label','Knowledge Base');
    link.innerHTML='<span class="gc-kb-nav-icon" aria-hidden="true">◇</span><span class="gc-kb-nav-copy"><strong>Knowledge Base</strong><small>Repair intelligence</small></span><em class="gc-kb-pro">PRO</em>';
  }

  function organizeSidebar(){
    const nav=document.querySelector('.sidebar nav');if(!nav)return;
    const reconnect=Boolean(navObserver);if(reconnect)navObserver.disconnect();
    try{
      const links=[...nav.querySelectorAll('a.nav-link[data-view]')];if(!links.length)return;
      const byView=new Map(links.map(link=>[link.dataset.view,link]));
      if(byView.get(KB_VIEW))premiumLink(byView.get(KB_VIEW));
      nav.querySelectorAll('.gc-nav-section-label').forEach(node=>node.remove());
      const claimed=new Set();
      for(const [labelName,views] of NAV_GROUPS){
        const group=views.map(name=>byView.get(name)).filter(Boolean);if(!group.length)continue;
        const label=document.createElement('div');label.className=`gc-nav-section-label${labelName==='Knowledge'?' gc-nav-section-label-kb':''}`;label.textContent=labelName;nav.appendChild(label);
        group.forEach(link=>{claimed.add(link);nav.appendChild(link);});
      }
      const leftovers=links.filter(link=>!claimed.has(link));
      if(leftovers.length){const label=document.createElement('div');label.className='gc-nav-section-label';label.textContent='More';nav.appendChild(label);leftovers.forEach(link=>nav.appendChild(link));}
      nav.dataset.gcOrganized=VERSION;
    }finally{if(reconnect)observeNav(nav);}
  }

  function scheduleSidebar(){if(navFrame)return;navFrame=requestAnimationFrame(()=>{navFrame=0;organizeSidebar();});}
  function watchSidebar(){
    const nav=document.querySelector('.sidebar nav');if(!nav||navObserver)return;
    navObserver=new MutationObserver(records=>{
      if(records.some(record=>[...record.addedNodes].some(node=>node instanceof Element&&(node.matches?.('a.nav-link[data-view]')||node.querySelector?.('a.nav-link[data-view]')))))scheduleSidebar();
    });
    observeNav(nav);
  }

  const guides=()=>window.GotCrackedOperationsV1?.state?.guides||[];
  const sourceOf=guide=>guide.source_name||guide.source||'GotCracked';
  const categories=()=>[...new Set(guides().map(g=>g.device_category).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b)));
  function filtered(){
    const q=state.query.trim().toLowerCase();
    return guides().filter(g=>(state.category==='all'||String(g.device_category||'').toLowerCase()===state.category)&&(!q||haystack(g.title,g.device_category,g.manufacturer,g.model_family,g.symptom,g.summary,g.tags,g.likely_causes,g.diagnostic_steps,g.tools_notes,g.parts_notes,g.cautions,sourceOf(g)).includes(q)));
  }

  function sourceCards(){return SOURCES.map(s=>`<article class="gc-kb-source-card"><div class="gc-kb-source-head"><div class="gc-kb-source-logo" aria-hidden="true">${s.key==='gotcracked'?'GC':esc(s.name.slice(0,1))}</div><div><small>${esc(s.type)}</small><h3>${esc(s.name)}</h3></div><span class="gc-kb-source-status ${esc(s.status.toLowerCase().replace(/[^a-z0-9]+/g,'-'))}">${esc(s.status)}</span></div><p>${esc(s.description)}</p>${s.url?`<a class="gc-kb-source-action" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.action)} ↗</a>`:`<button class="gc-kb-source-action" type="button" data-kb-internal>${esc(s.action)} →</button>`}</article>`).join('');}

  function guideCard(g){
    const tags=Array.isArray(g.tags)?g.tags:[],causes=Array.isArray(g.likely_causes)?g.likely_causes:[],steps=Array.isArray(g.diagnostic_steps)?g.diagnostic_steps:[];
    const source=sourceOf(g),sourceUrl=g.source_url||g.reference_url||'',tools=g.tools_notes||g.tools||'',parts=g.parts_notes||g.parts||'';
    const meta=[g.difficulty||g.skill_level?`Skill: ${g.difficulty||g.skill_level}`:'',g.estimated_time||g.time_estimate?`Time: ${g.estimated_time||g.time_estimate}`:''].filter(Boolean);
    let verified='';if(g.verified_at||g.updated_at){const d=new Date(g.verified_at||g.updated_at);if(!Number.isNaN(d.getTime()))verified=d.toLocaleDateString();}
    return `<details class="gc-kb-guide"><summary><div class="gc-kb-guide-main"><div class="gc-kb-guide-type">${esc(g.device_category||'Repair')} · ${esc(source)}</div><h3>${esc(g.title||'Untitled repair path')}</h3><p>${esc(g.symptom||g.summary||'Technician repair reference')}</p><div class="gc-kb-guide-tags">${tags.slice(0,6).map(tag=>`<span>${esc(tag)}</span>`).join('')}</div></div><div class="gc-kb-guide-summary-meta">${meta.map(item=>`<span>${esc(item)}</span>`).join('')}<b aria-hidden="true">⌄</b></div></summary><div class="gc-kb-guide-detail">${g.summary?`<section><h4>Overview</h4><p>${esc(g.summary)}</p></section>`:''}${causes.length?`<section><h4>Likely causes</h4><ul>${causes.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></section>`:''}${steps.length?`<section class="gc-kb-walkthrough"><h4>Diagnostic / repair path</h4><ol>${steps.map((item,i)=>`<li><span>${i+1}</span><p>${esc(item)}</p></li>`).join('')}</ol></section>`:''}${tools?`<section><h4>Tools & bench notes</h4><p>${esc(tools)}</p></section>`:''}${parts?`<section><h4>Parts notes</h4><p>${esc(parts)}</p></section>`:''}${g.cautions?`<section class="gc-kb-caution"><h4>Safety / cautions</h4><p>${esc(g.cautions)}</p></section>`:''}<footer><span>Source: <strong>${esc(source)}</strong>${verified?` · Updated ${esc(verified)}`:''}</span>${sourceUrl?`<a href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer">Open source ↗</a>`:''}</footer></div></details>`;
  }

  function renderResults(){
    const host=document.getElementById('gc-kb-results');if(!host)return;const rows=filtered();const count=document.getElementById('gc-kb-result-count');if(count)count.textContent=`${rows.length} repair path${rows.length===1?'':'s'}`;
    host.innerHTML=rows.map(guideCard).join('')||'<div class="gc-kb-empty"><span aria-hidden="true">⌕</span><h3>No matching repair path</h3><p>Try a model, symptom, component, or broader device category. You can also open an authoritative source from the Source Library.</p></div>';
  }

  function setMode(mode){state.mode=mode==='sources'?'sources':'guides';document.querySelectorAll('[data-kb-mode]').forEach(b=>b.classList.toggle('active',b.dataset.kbMode===state.mode));document.querySelectorAll('[data-kb-panel]').forEach(p=>p.classList.toggle('gc-kb-hidden',p.dataset.kbPanel!==state.mode));}
  function bind(){
    document.getElementById('gc-kb-search-input')?.addEventListener('input',e=>{state.query=e.target.value;renderResults();});
    document.querySelectorAll('[data-kb-category]').forEach(b=>b.addEventListener('click',()=>{state.category=b.dataset.kbCategory;document.querySelectorAll('[data-kb-category]').forEach(x=>x.classList.toggle('active',x===b));renderResults();}));
    document.querySelectorAll('[data-kb-mode]').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.kbMode)));
    document.querySelector('[data-kb-internal]')?.addEventListener('click',()=>setMode('guides'));
  }

  function renderKnowledgeBase(){
    const host=document.getElementById(KB_VIEW);if(!host||rendering)return;rendering=true;
    const cats=categories();if(state.category!=='all'&&!cats.some(c=>String(c).toLowerCase()===state.category))state.category='all';
    const buttons=['all',...cats.map(c=>String(c).toLowerCase())];
    const sourceCount=new Set(guides().map(sourceOf)).size;
    host.innerHTML=`<div class="gc-kb-shell"><section class="gc-kb-hero"><div class="gc-kb-hero-copy"><div class="gc-kb-kicker"><span>PRO</span> Repair Intelligence</div><h1>Knowledge Base</h1><p>One technician workspace for diagnostics, repair walkthroughs, safety notes, parts context, and trusted repair sources.</p></div><div class="gc-kb-hero-stats"><div><strong>${guides().length}</strong><span>Internal repair paths</span></div><div><strong>${cats.length}</strong><span>Device categories</span></div><div><strong>${Math.max(sourceCount,1)+4}</strong><span>Knowledge sources</span></div></div></section><section class="gc-kb-search-panel"><div class="gc-kb-search"><span aria-hidden="true">⌕</span><input id="gc-kb-search-input" value="${esc(state.query)}" placeholder="Search device, model, symptom, component, or repair…" autocomplete="off"><kbd>/</kbd></div><div class="gc-kb-mode-tabs" role="tablist" aria-label="Knowledge Base sections"><button type="button" class="${state.mode==='guides'?'active':''}" data-kb-mode="guides">Repair Library</button><button type="button" class="${state.mode==='sources'?'active':''}" data-kb-mode="sources">Source Library</button></div></section><section class="gc-kb-library ${state.mode==='guides'?'':'gc-kb-hidden'}" data-kb-panel="guides"><div class="gc-kb-category-row">${buttons.map(key=>`<button type="button" data-kb-category="${esc(key)}" class="${state.category===key?'active':''}">${esc(key==='all'?'All Devices':words(key))}</button>`).join('')}</div><div class="gc-kb-section-head"><div><p class="eyebrow">Technician library</p><h2>Repair Paths</h2></div><span id="gc-kb-result-count"></span></div><div id="gc-kb-results" class="gc-kb-results"></div></section><section class="gc-kb-source-library ${state.mode==='sources'?'':'gc-kb-hidden'}" data-kb-panel="sources"><div class="gc-kb-section-head"><div><p class="eyebrow">Authoritative references</p><h2>Source Library</h2></div><span>External sources open in a new tab</span></div><div class="gc-kb-source-grid">${sourceCards()}</div><article class="gc-kb-licensing-note"><div aria-hidden="true">§</div><div><strong>Source licensing is enforced by design.</strong><p>GotCracked-owned procedures can live directly in the Portal. Third-party content is linked or integrated only when its license permits commercial use. iFixit content remains external until commercial licensing is approved.</p></div></article></section></div>`;
    rendering=false;bind();renderResults();
  }

  function watchHost(){
    const host=document.getElementById(KB_VIEW);if(!host||hostObserver)return;
    hostObserver=new MutationObserver(()=>{if(!rendering&&view()===KB_VIEW&&!host.querySelector('.gc-kb-shell'))requestAnimationFrame(renderKnowledgeBase);});
    hostObserver.observe(host,{childList:true});
  }

  function upgradeWorkOrder(){
    const host=document.getElementById('work-order');if(!host)return;
    host.querySelectorAll('.card-title h2').forEach(n=>{if(n.textContent.trim()==='Suggested repair paths')n.textContent='Knowledge Base Matches';});
    host.querySelectorAll('.card-title p').forEach(n=>{if(n.textContent.includes('internal reference database'))n.textContent='Deterministic matches from intake findings and the GotCracked Knowledge Base. Technician confirmation is required.';});
  }
  function upgradePermissions(){
    document.querySelectorAll('#staff .v1-permission-toggle strong').forEach(n=>{if(n.textContent.trim()==='View repair reference')n.textContent='View Knowledge Base';if(n.textContent.trim()==='Manage repair reference')n.textContent='Manage Knowledge Base';});
  }
  function handle(name){scheduleSidebar();if(name===KB_VIEW){renderKnowledgeBase();watchHost();}if(name==='work-order')setTimeout(upgradeWorkOrder,0);if(name==='staff')setTimeout(upgradePermissions,0);}

  document.addEventListener('keydown',e=>{if(e.key==='/'&&view()===KB_VIEW&&!(e.target instanceof HTMLInputElement)&&!(e.target instanceof HTMLTextAreaElement)&&!(e.target instanceof HTMLSelectElement)){e.preventDefault();document.getElementById('gc-kb-search-input')?.focus();}});
  document.addEventListener('gc-view-changed',e=>handle(typeof e.detail==='string'?e.detail:view()));
  document.addEventListener('gc-portal-runtime-ready',()=>handle(view()));
  window.addEventListener('hashchange',()=>handle(view()));
  window.addEventListener('pageshow',()=>handle(view()));

  ensureStyles();organizeSidebar();watchSidebar();setTimeout(()=>handle(view()),0);setTimeout(()=>handle(view()),1200);
  window.GotCrackedKnowledgeBase={render:renderKnowledgeBase,organizeSidebar,get guides(){return guides();},get sources(){return SOURCES.map(x=>({...x}));}};
})();
