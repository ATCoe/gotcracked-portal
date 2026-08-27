(() => {
  'use strict';

  const VERSION = '20260827-kb3';
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
    {key:'gotcracked',name:'GotCracked',type:'Internal',status:'Live',description:'Original GotCracked diagnostic paths, intake logic, bench procedures, cautions, and technician verification workflows.',action:'Browse internal guides'},
    {key:'ifixit',name:'iFixit',type:'Third-party',status:'External / license',description:'Large cross-brand library of repair guides, troubleshooting, and teardowns. Commercial ingestion is disabled until GotCracked has commercial permission.',url:'https://www.ifixit.com/Device',action:'Open iFixit'},
    {key:'repairwiki',name:'Repair Wiki',type:'Third-party',status:'External',description:'Board-level and device repair reference material. Keep linked externally unless content is deliberately handled under its applicable attribution/share-alike license.',url:'https://repair.wiki/',action:'Open Repair Wiki'},
    {key:'tca',name:'Tech Care Association',type:'Industry',status:'Reference',description:'Industry repair-resource directory pointing technicians toward professional repair, diagnostics, safety, and training references.',url:'https://techcareassociation.org/free-professional-tech-repair-guides-instructions/',action:'Open TCA resources'},
    {key:'apple',name:'Apple Self Service Repair',type:'Manufacturer',status:'Official',description:'Repair manuals, parts/tool requirements, safety information, diagnostics, and post-repair workflows for supported iPhone, iPad, Mac, displays, and Beats.',url:'https://support.apple.com/self-service-repair',action:'Open Apple manuals'},
    {key:'samsung',name:'Samsung Self-Repair',type:'Manufacturer',status:'Official',description:'Model-specific self-repair documentation, genuine parts, tools, and guidance for supported mobile, tablet, laptop, and other Samsung products.',url:'https://www.samsung.com/us/support/self-repair/',action:'Open Samsung repair'},
    {key:'google',name:'Google Pixel Repair',type:'Manufacturer',status:'Official',description:'Pixel repair manuals, Repair Mode, genuine-parts guidance, and Pixel Repair Diagnostics for supported Pixel phones and Pixel Tablet.',url:'https://support.google.com/pixelphone/answer/14257407?hl=en',action:'Open Pixel repair'},
    {key:'motorola',name:'Motorola Right to Repair',type:'Manufacturer',status:'Official',description:'Parts lists, disassembly/assembly manuals, service documentation, detailed schematics, Software Fix, and Device Help diagnostics for supported Motorola phones.',url:'https://en-us.support.motorola.com/app/right-to-repair/',action:'Open Motorola repair'},
    {key:'xiaomi',name:'Xiaomi Self-Repair',type:'Manufacturer',status:'Official',description:'Self-repair manuals, original parts, and support for selected Xiaomi phones, tablets, and other products in participating regions.',url:'https://www.mi.com/global/support/self-repair/',action:'Open Xiaomi repair'},
    {key:'oneplus',name:'OnePlus Support',type:'Manufacturer',status:'Official',description:'OnePlus troubleshooting, software, warranty, and repair-service references used to separate software and hardware faults before bench work.',url:'https://www.oneplus.com/us/support/troubleshooting/details',action:'Open OnePlus support'},
    {key:'oppo',name:'OPPO Support',type:'Manufacturer',status:'Official',description:'OPPO troubleshooting, software-update, warranty, service, and repair resources for supported phone families.',url:'https://support.oppo.com/en/',action:'Open OPPO support'},
    {key:'vivo',name:'vivo Support',type:'Manufacturer',status:'Official',description:'vivo FAQs, system/software resources, testing, service-center, and repair support for supported devices.',url:'https://www.vivo.com/en/support/',action:'Open vivo support'},
    {key:'asus',name:'ASUS Self Replacement',type:'Manufacturer',status:'Official',description:'Service manuals, parts guidance, self-replacement workflows, MyASUS/UEFI diagnostics, and support for phones, laptops, desktops, mini-PCs, Chromebooks, and gaming handhelds.',url:'https://www.asus.com/us/support/faq/1051611/',action:'Open ASUS repair'},
    {key:'hmd',name:'HMD / Nokia Self-Repair',type:'Manufacturer',status:'Official',description:'HMD repairability and self-repair program for supported HMD and Nokia phones, with parts and guide pathways through approved partners.',url:'https://www.hmd.com/en_int/self-repair/',action:'Open HMD repair'},
    {key:'nothing',name:'Nothing Support',type:'Manufacturer',status:'Official',description:'Nothing and CMF troubleshooting for power/charging, camera, system, connectivity, audio, calling, and device functions.',url:'https://support.nothing.tech/hc/en-us/categories/7455115681041-Troubleshooting',action:'Open Nothing support'},
    {key:'surface',name:'Microsoft Surface Service Guides',type:'Manufacturer',status:'Official',description:'Detailed Surface disassembly, reassembly, repair, safety, diagnostics, and repair-tool documentation across supported Surface laptops, 2-in-1s, and desktops.',url:'https://learn.microsoft.com/en-us/surface/service-guides/surface-service-guides',action:'Open Surface guides'},
    {key:'dell',name:'Dell Self-Repair',type:'Manufacturer',status:'Official',description:'Owner guides, teardown/service manuals, compatible parts, AR-assisted replacement, diagnostics, drivers, BIOS, and support for Dell PCs.',url:'https://www.dell.com/support/contents/en-us/article/warranty/self-repair',action:'Open Dell repair'},
    {key:'hp',name:'HP Support',type:'Manufacturer',status:'Official',description:'Model-specific Maintenance and Service Guides, troubleshooting, diagnostics, firmware, and manuals for HP laptops and desktops.',url:'https://support.hp.com/us-en/',action:'Open HP support'},
    {key:'lenovo',name:'Lenovo Support',type:'Manufacturer',status:'Official',description:'Hardware maintenance/service references, diagnostics, drivers, firmware, repair status, and model support for Lenovo tablets, laptops, desktops, and handheld PCs.',url:'https://support.lenovo.com/us/en/',action:'Open Lenovo support'},
    {key:'acer',name:'Acer Support',type:'Manufacturer',status:'Official',description:'Manuals, drivers, troubleshooting, self-help, warranty, and repair pathways for Acer laptops, desktops, tablets, and related products.',url:'https://www.acer.com/us-en/support',action:'Open Acer support'},
    {key:'msi',name:'MSI Support',type:'Manufacturer',status:'Official',description:'Manuals, BIOS/firmware, drivers, troubleshooting, and support references for MSI laptops, desktops, handheld PCs, and components.',url:'https://www.msi.com/support',action:'Open MSI support'},
    {key:'framework',name:'Framework Guides',type:'Manufacturer',status:'Official',description:'Official setup, upgrade, replacement, troubleshooting, and advanced repair/rework guides for Framework laptops and modules.',url:'https://frame.work/support',action:'Open Framework guides'},
    {key:'chromebook',name:'Google Chromebook Help',type:'Platform',status:'Official',description:'ChromeOS troubleshooting, recovery, update, hardware/system checks, and platform guidance to pair with each Chromebook OEM service manual.',url:'https://support.google.com/chromebook/?hl=en',action:'Open Chromebook help'},
    {key:'playstation',name:'PlayStation Support',type:'Manufacturer',status:'Official',description:'PS4/PS5 hardware troubleshooting, Safe Mode, system-software recovery, manuals, connectivity tools, and repair pathways.',url:'https://www.playstation.com/en-us/support/',action:'Open PlayStation support'},
    {key:'xbox',name:'Xbox Support',type:'Manufacturer',status:'Official',description:'Xbox console/controller troubleshooting, system, network, accessory, update, and service references. Board-level work uses separate exact-revision references.',url:'https://support.xbox.com/en-US/',action:'Open Xbox support'},
    {key:'nintendo',name:'Nintendo Support',type:'Manufacturer',status:'Official',description:'Switch, Switch OLED, Switch Lite, Switch 2, controller, charging, dock/display, software, and accessory troubleshooting.',url:'https://en-americas-support.nintendo.com/',action:'Open Nintendo support'},
    {key:'valve',name:'Valve Steam Deck Support',type:'Manufacturer',status:'Official',description:'Steam Deck device/software/dock troubleshooting and Valve support; Valve also links to iFixit for parts and repair guides.',url:'https://help.steampowered.com/en/wizard/HelpWithSteamDeck',action:'Open Steam Deck support'},
    {key:'rogally',name:'ASUS ROG Ally Service Guides',type:'Manufacturer',status:'Official',description:'ROG Ally customer self-repair service manuals plus ASUS diagnostics and post-repair configuration resources.',url:'https://www.asus.com/us/supportonly/rog%20ally%20%282023%29/helpdesk_service_guide/',action:'Open ROG Ally guides'}
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
      const link=document.createElement('link');
      link.rel='stylesheet';
      link.href=`${file}?v=${VERSION}`;
      link.dataset.gcKbStyle=file;
      document.head.appendChild(link);
    }
  }

  function observeNav(nav){
    if(!navObserver)return;
    navObserver.observe(nav,{childList:true,subtree:true});
  }

  function premiumLink(link){
    const active=link.classList.contains('active');
    const hidden=link.classList.contains('v1-hidden');
    link.className=`nav-link gc-kb-nav${active?' active':''}${hidden?' v1-hidden':''}`;
    link.href='#repair-reference';
    link.dataset.view=KB_VIEW;
    link.setAttribute('aria-label','Knowledge Base');
    link.innerHTML='<span class="gc-kb-nav-icon" aria-hidden="true">◇</span><span class="gc-kb-nav-copy"><strong>Knowledge Base</strong><small>Repair intelligence</small></span><em class="gc-kb-pro">PRO</em>';
  }

  function organizeSidebar(){
    const nav=document.querySelector('.sidebar nav');
    if(!nav)return;
    const reconnect=Boolean(navObserver);
    if(reconnect)navObserver.disconnect();
    try{
      const links=[...nav.querySelectorAll('a.nav-link[data-view]')];
      if(!links.length)return;
      const byView=new Map(links.map(link=>[link.dataset.view,link]));
      if(byView.get(KB_VIEW))premiumLink(byView.get(KB_VIEW));
      nav.querySelectorAll('.gc-nav-section-label').forEach(node=>node.remove());
      const claimed=new Set();
      for(const [labelName,views] of NAV_GROUPS){
        const group=views.map(name=>byView.get(name)).filter(Boolean);
        if(!group.length)continue;
        const label=document.createElement('div');
        label.className=`gc-nav-section-label${labelName==='Knowledge'?' gc-nav-section-label-kb':''}`;
        label.textContent=labelName;
        nav.appendChild(label);
        group.forEach(link=>{claimed.add(link);nav.appendChild(link);});
      }
      const leftovers=links.filter(link=>!claimed.has(link));
      if(leftovers.length){
        const label=document.createElement('div');
        label.className='gc-nav-section-label';
        label.textContent='More';
        nav.appendChild(label);
        leftovers.forEach(link=>nav.appendChild(link));
      }
      nav.dataset.gcOrganized=VERSION;
    } finally {
      if(reconnect)observeNav(nav);
    }
  }

  function scheduleSidebar(){
    if(navFrame)return;
    navFrame=requestAnimationFrame(()=>{navFrame=0;organizeSidebar();});
  }

  function watchSidebar(){
    const nav=document.querySelector('.sidebar nav');
    if(!nav||navObserver)return;
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
    return guides().filter(g=>{
      const categoryOk=state.category==='all'||String(g.device_category||'').toLowerCase()===state.category;
      const queryOk=!q||haystack(g.title,g.device_category,g.manufacturer,g.model_family,g.symptom,g.summary,g.tags,g.likely_causes,g.diagnostic_steps,g.tools_notes,g.parts_notes,g.cautions,sourceOf(g),g.source_type,g.verification_notes).includes(q);
      return categoryOk&&queryOk;
    });
  }

  function statusClass(status){
    return String(status||'').toLowerCase().replace(/[^a-z0-9]+/g,'-');
  }

  function sourceCards(){
    return SOURCES.map(s=>`<article class="gc-kb-source-card"><div class="gc-kb-source-head"><div class="gc-kb-source-logo" aria-hidden="true">${s.key==='gotcracked'?'GC':esc(s.name.slice(0,1))}</div><div><small>${esc(s.type)}</small><h3>${esc(s.name)}</h3></div><span class="gc-kb-source-status ${esc(statusClass(s.status))}">${esc(s.status)}</span></div><p>${esc(s.description)}</p>${s.url?`<a class="gc-kb-source-action" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.action)} ↗</a>`:`<button class="gc-kb-source-action" type="button" data-kb-internal>${esc(s.action)} →</button>`}</article>`).join('');
  }

  function guideCard(g){
    const tags=Array.isArray(g.tags)?g.tags:[];
    const causes=Array.isArray(g.likely_causes)?g.likely_causes:[];
    const steps=Array.isArray(g.diagnostic_steps)?g.diagnostic_steps:[];
    const source=sourceOf(g);
    const sourceUrl=g.source_url||g.reference_url||'';
    const tools=g.tools_notes||g.tools||'';
    const parts=g.parts_notes||g.parts||'';
    const device=[g.manufacturer,g.model_family].filter(Boolean).join(' ');
    const meta=[device?device:'',g.difficulty||g.skill_level?`Skill: ${g.difficulty||g.skill_level}`:'',g.bench_time_minutes?`Bench: ${g.bench_time_minutes} min`:'',g.source_type&&g.source_type!=='internal'?words(g.source_type):''].filter(Boolean);
    let verified='';
    if(g.verified_at||g.updated_at){const d=new Date(g.verified_at||g.updated_at);if(!Number.isNaN(d.getTime()))verified=d.toLocaleDateString();}
    return `<details class="gc-kb-guide"><summary><div class="gc-kb-guide-main"><div class="gc-kb-guide-type">${esc(g.device_category||'Repair')} · ${esc(source)}</div><h3>${esc(g.title||'Untitled repair path')}</h3><p>${esc(g.symptom||g.summary||'Technician repair reference')}</p><div class="gc-kb-guide-tags">${tags.slice(0,7).map(tag=>`<span>${esc(tag)}</span>`).join('')}</div></div><div class="gc-kb-guide-summary-meta">${meta.map(item=>`<span>${esc(item)}</span>`).join('')}<b aria-hidden="true">⌄</b></div></summary><div class="gc-kb-guide-detail">${g.summary?`<section><h4>Overview</h4><p>${esc(g.summary)}</p></section>`:''}${causes.length?`<section><h4>Likely causes</h4><ul>${causes.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></section>`:''}${steps.length?`<section class="gc-kb-walkthrough"><h4>Diagnostic / repair path</h4><ol>${steps.map((item,i)=>`<li><span>${i+1}</span><p>${esc(item)}</p></li>`).join('')}</ol></section>`:''}${tools?`<section><h4>Tools & bench notes</h4><p>${esc(tools)}</p></section>`:''}${parts?`<section><h4>Parts notes</h4><p>${esc(parts)}</p></section>`:''}${g.cautions?`<section class="gc-kb-caution"><h4>Safety / cautions</h4><p>${esc(g.cautions)}</p></section>`:''}${g.verification_notes?`<section><h4>Source verification</h4><p>${esc(g.verification_notes)}</p></section>`:''}<footer><span>Source: <strong>${esc(source)}</strong>${verified?` · Verified ${esc(verified)}`:''}</span>${sourceUrl?`<a href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer">Open source ↗</a>`:''}</footer></div></details>`;
  }

  function renderResults(){
    const host=document.getElementById('gc-kb-results');
    if(!host)return;
    const rows=filtered();
    const count=document.getElementById('gc-kb-result-count');
    if(count)count.textContent=`${rows.length} repair intelligence entr${rows.length===1?'y':'ies'}`;
    host.innerHTML=rows.map(guideCard).join('')||'<div class="gc-kb-empty"><span aria-hidden="true">⌕</span><h3>No matching repair intelligence</h3><p>Try a manufacturer, model family, symptom, component, platform, or broader device category. You can also open an authoritative source from the Source Library.</p></div>';
  }

  function setMode(mode){
    state.mode=mode==='sources'?'sources':'guides';
    document.querySelectorAll('[data-kb-mode]').forEach(b=>b.classList.toggle('active',b.dataset.kbMode===state.mode));
    document.querySelectorAll('[data-kb-panel]').forEach(p=>p.classList.toggle('gc-kb-hidden',p.dataset.kbPanel!==state.mode));
  }

  function bind(){
    document.getElementById('gc-kb-search-input')?.addEventListener('input',e=>{state.query=e.target.value;renderResults();});
    document.querySelectorAll('[data-kb-category]').forEach(b=>b.addEventListener('click',()=>{state.category=b.dataset.kbCategory;document.querySelectorAll('[data-kb-category]').forEach(x=>x.classList.toggle('active',x===b));renderResults();}));
    document.querySelectorAll('[data-kb-mode]').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.kbMode)));
    document.querySelector('[data-kb-internal]')?.addEventListener('click',()=>setMode('guides'));
  }

  function renderKnowledgeBase(){
    const host=document.getElementById(KB_VIEW);
    if(!host||rendering)return;
    rendering=true;
    const cats=categories();
    if(state.category!=='all'&&!cats.some(c=>String(c).toLowerCase()===state.category))state.category='all';
    const buttons=['all',...cats.map(c=>String(c).toLowerCase())];
    const manufacturers=new Set(guides().map(g=>g.manufacturer).filter(Boolean)).size;
    const internal=guides().filter(g=>(g.source_type||'internal')==='internal').length;
    host.innerHTML=`<div class="gc-kb-shell"><section class="gc-kb-hero"><div class="gc-kb-hero-copy"><div class="gc-kb-kicker"><span>PRO</span> Repair Intelligence</div><h1>Knowledge Base</h1><p>One technician workspace for diagnostics, repair walkthroughs, teardowns and service references, safety notes, parts context, OEM procedures, and trusted repair sources.</p></div><div class="gc-kb-hero-stats"><div><strong>${guides().length}</strong><span>Repair intelligence entries</span></div><div><strong>${internal}</strong><span>GotCracked repair paths</span></div><div><strong>${manufacturers}</strong><span>Manufacturers indexed</span></div><div><strong>${SOURCES.length}</strong><span>Source ecosystems</span></div></div></section><section class="gc-kb-search-panel"><div class="gc-kb-search"><span aria-hidden="true">⌕</span><input id="gc-kb-search-input" value="${esc(state.query)}" placeholder="Search brand, device, model, symptom, component, source, or repair…" autocomplete="off"><kbd>/</kbd></div><div class="gc-kb-mode-tabs" role="tablist" aria-label="Knowledge Base sections"><button type="button" class="${state.mode==='guides'?'active':''}" data-kb-mode="guides">Repair Library</button><button type="button" class="${state.mode==='sources'?'active':''}" data-kb-mode="sources">Source Library</button></div></section><section class="gc-kb-library ${state.mode==='guides'?'':'gc-kb-hidden'}" data-kb-panel="guides"><div class="gc-kb-category-row">${buttons.map(key=>`<button type="button" data-kb-category="${esc(key)}" class="${state.category===key?'active':''}">${esc(key==='all'?'All Devices':words(key))}</button>`).join('')}</div><div class="gc-kb-section-head"><div><p class="eyebrow">Technician library</p><h2>Repair Intelligence</h2></div><span id="gc-kb-result-count"></span></div><div id="gc-kb-results" class="gc-kb-results"></div></section><section class="gc-kb-source-library ${state.mode==='sources'?'':'gc-kb-hidden'}" data-kb-panel="sources"><div class="gc-kb-section-head"><div><p class="eyebrow">Authoritative references</p><h2>Source Library</h2></div><span>${SOURCES.length} source ecosystems · external sources open in a new tab</span></div><div class="gc-kb-source-grid">${sourceCards()}</div><article class="gc-kb-licensing-note"><div aria-hidden="true">§</div><div><strong>Source provenance and licensing are enforced by design.</strong><p>GotCracked-authored diagnostic procedures live directly in the Portal. Manufacturer/source entries contain original GotCracked summaries and outbound references rather than copied manuals. iFixit remains external because its standard license is noncommercial; commercial ingestion requires permission/license. Repair Wiki remains an external attributed reference unless content is intentionally imported under compatible attribution/share-alike handling.</p></div></article></section></div>`;
    rendering=false;
    bind();
    renderResults();
  }

  function watchHost(){
    const host=document.getElementById(KB_VIEW);
    if(!host||hostObserver)return;
    hostObserver=new MutationObserver(()=>{if(!rendering&&view()===KB_VIEW&&!host.querySelector('.gc-kb-shell'))requestAnimationFrame(renderKnowledgeBase);});
    hostObserver.observe(host,{childList:true});
  }

  function upgradeWorkOrder(){
    const host=document.getElementById('work-order');
    if(!host)return;
    host.querySelectorAll('.card-title h2').forEach(n=>{if(n.textContent.trim()==='Suggested repair paths')n.textContent='Knowledge Base Matches';});
    host.querySelectorAll('.card-title p').forEach(n=>{if(n.textContent.includes('internal reference database'))n.textContent='Deterministic matches from intake findings and the GotCracked Knowledge Base. Technician confirmation is required.';});
  }

  function upgradePermissions(){
    document.querySelectorAll('#staff .v1-permission-toggle strong').forEach(n=>{if(n.textContent.trim()==='View repair reference')n.textContent='View Knowledge Base';if(n.textContent.trim()==='Manage repair reference')n.textContent='Manage Knowledge Base';});
  }

  function handle(name){
    scheduleSidebar();
    if(name===KB_VIEW){renderKnowledgeBase();watchHost();}
    if(name==='work-order')setTimeout(upgradeWorkOrder,0);
    if(name==='staff')setTimeout(upgradePermissions,0);
  }

  document.addEventListener('keydown',e=>{if(e.key==='/'&&view()===KB_VIEW&&!(e.target instanceof HTMLInputElement)&&!(e.target instanceof HTMLTextAreaElement)&&!(e.target instanceof HTMLSelectElement)){e.preventDefault();document.getElementById('gc-kb-search-input')?.focus();}});
  document.addEventListener('gc-view-changed',e=>handle(typeof e.detail==='string'?e.detail:view()));
  document.addEventListener('gc-portal-runtime-ready',()=>handle(view()));
  window.addEventListener('hashchange',()=>handle(view()));
  window.addEventListener('pageshow',()=>handle(view()));

  ensureStyles();
  organizeSidebar();
  watchSidebar();
  setTimeout(()=>handle(view()),0);
  setTimeout(()=>handle(view()),1200);

  window.GotCrackedKnowledgeBase={render:renderKnowledgeBase,organizeSidebar,get guides(){return guides();},get sources(){return SOURCES.map(x=>({...x}));}};
})();
