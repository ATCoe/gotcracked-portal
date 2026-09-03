Warning: truncated output (original token count: 29679)
Total output lines: 670

(() => {
  'use strict';

  const client = window.supabaseClient;
  if (!client) return;

  const VERSION = '20260903-record-lifecycle1';
  for (const href of [`operations-v1.css?v=${VERSION}`, `operations-v1-extra.css?v=${VERSION}`]) {
    if (![...document.styleSheets].some(sheet => sheet.href?.includes(href.split('?')[0]))) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      document.head.appendChild(link);
    }
  }

  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[c]);
  const friendly = value => String(value || '').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
  const money = cents => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((Number(cents)||0)/100);
  const digits = value => String(value || '').replace(/\D/g,'');
  const now = () => new Date().toISOString();
  const uid = prefix => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const ticketCode = value => `GC-${String(value || '').replace(/\D/g,'').padStart(6,'0')}`;
  const text = (...values) => values.flat().filter(Boolean).join(' ').toLowerCase();

  const TERMINAL = new Set(['sale_complete','abandoned','unrepairable','customer_declined','cancelled','completed']);
  const LEAD_STAGES = ['need_to_contact','awaiting_customer','awaiting_device','need_to_order_part','awaiting_parts','converted','lost'];
  const LEAD_LABELS = {
    need_to_contact:'Need to Contact', awaiting_customer:'Awaiting Customer', awaiting_device:'Awaiting Device',
    need_to_order_part:'Need to Order Part', awaiting_parts:'Awaiting Parts', converted:'Converted', lost:'Lost'
  };
  const REPAIR_LABELS = {
    awaiting_customer:'Awaiting Customer', awaiting_repair:'Awaiting Repair', need_to_order_parts:'Need to Order Parts', awaiting_parts:'Awaiting Parts',
    diagnostic_in_progress:'Diagnostic in Progress', repair_in_progress:'Repair in Progress', quality_inspection:'Quality Inspection',
    awaiting_callback:'Awaiting Callback', repaired:'Repaired – Ready for Pickup', sale_complete:'Sale Complete', abandoned:'Abandoned',
    unrepairable:'Unrepairable', customer_declined:'Customer Declined', cancelled:'Cancelled', checked_in:'Checked In', in_diagnosis:'In Diagnosis',
    awaiting_approval:'Awaiting Approval', waiting_on_parts:'Waiting on Parts', in_repair:'In Repair', ready_for_pickup:'Ready for Pickup', completed:'Completed'
  };
  const REPAIR_NEXT = {
    awaiting_customer:['awaiting_repair','cancelled'],
    awaiting_repair:['diagnostic_in_progress','need_to_order_parts','awaiting_parts','awaiting_callback','unrepairable','customer_declined','cancelled'],
    diagnostic_in_progress:['need_to_order_parts','awaiting_parts','repair_in_progress','quality_inspection','awaiting_callback','unrepairable','customer_declined','cancelled'],
    need_to_order_parts:['awaiting_parts','awaiting_callback','cancelled'],
    awaiting_parts:['diagnostic_in_progress','repair_in_progress','awaiting_callback','cancelled'],
    repair_in_progress:['need_to_order_parts','awaiting_parts','quality_inspection','awaiting_callback','unrepairable','cancelled'],
    quality_inspection:['diagnostic_in_progress','repair_in_progress','repaired','unrepairable'],
    awaiting_callback:['awaiting_repair','diagnostic_in_progress','repair_in_progress','customer_declined','unrepairable','cancelled'],
    repaired:['sale_complete'],
    checked_in:['awaiting_repair'], in_diagnosis:['diagnostic_in_progress'], awaiting_approval:['awaiting_repair'],
    waiting_on_parts:['awaiting_parts'], in_repair:['repair_in_progress'], ready_for_pickup:['repaired']
  };

  const PERMISSIONS = [
    ['dashboard.view','View dashboard','General'],['repairs.view','View work orders','Repairs'],['repairs.intake','Create intake / work orders','Repairs'],
    ['repairs.workflow','Update repair workflow','Repairs'],['ready_pickup.view','View ready-for-pickup queue','Front counter'],
    ['ready_pickup.checkout','Checkout ready devices','Front counter'],['leads.view','View leads','Leads'],['leads.manage','Contact and advance leads','Leads'],
    ['customers.view','View customers','Customers'],['customers.edit','Edit customers','Customers'],['inventory.view','View inventory','Inventory'],
    ['inventory.manage','Manage inventory','Inventory'],['inventory.count','Perform inventory counts','Inventory'],['purchasing.view','View purchase orders','Purchasing'],
    ['purchasing.manage','Manage purchase orders','Purchasing'],['reference.view','View repair reference','Knowledge'],['reference.manage','Manage repair reference','Knowledge'],
    ['reports.view','View reports','Management'],['staff.manage','Manage staff access','Management'],['settings.manage','Manage settings','Management'],
    ['pricing.override','Override prices / discounts','Management'],['labels.work_order','Print work-order labels','Labels'],['labels.inventory','Print inventory labels','Labels']
  ];
  const ROLE_DEFAULTS = {
    owner:new Set(PERMISSIONS.map(([key])=>key)),
    manager:new Set(PERMISSIONS.map(([key])=>key)),
    technician:new Set(['dashboard.view','repairs.view','repairs.intake','repairs.workflow','ready_pickup.view','leads.view','leads.manage','customers.view','inventory.view','reference.view','labels.work_order']),
    front_desk:new Set(['dashboard.view','repairs.view','repairs.intake','ready_pickup.view','ready_pickup.checkout','leads.view','leads.manage','customers.view','customers.edit','inventory.view','reference.view','labels.work_order'])
  };

  const CHECKLISTS = {
    Phone:{visual:['screen_glass','display_image','frame_condition','back_glass','camera_lenses','charging_port','liquid_signs','previous_repair'],functional:['power','boot','touch','charging','buttons','cameras','speaker','microphone','biometrics','wifi_bluetooth','battery_symptoms']},
    Tablet:{visual:['screen_glass','display_image','frame_condition','back_panel','camera_lenses','charging_port','liquid_signs','previous_repair'],functional:['power','boot','touch','charging','buttons','cameras','speaker','microphone','wifi_bluetooth','battery_symptoms']},
    Laptop:{visual:['display_panel','hinges','chassis','keyboard_condition','trackpad_condition','charging_port','other_ports','liquid_signs','previous_repair'],functional:['power','post_boot','internal_display','external_display','keyboard','trackpad','charging','battery_symptoms','usb_ports','wifi','camera','speaker','fan_thermals','storage_symptoms']},
    Desktop:{visual:['case_condition','ports','cables_received','liquid_signs','previous_repair'],functional:['power','post_boot','display_output','fans','usb_ports','network','audio','storage_symptoms','thermal_symptoms']},
    Console:{visual:['housing_condition','hdmi_port','usb_ports','power_port','disc_drive_condition','liquid_signs','previous_repair','missing_panels_screws'],functional:['power','boot','display_output','hdmi_stability','usb_function','controller_pairing','disc_read','fan_noise','unexpected_shutdown','network']},
    Other:{visual:['exterior_condition','ports','liquid_signs','previous_repair'],functional:['power','boot','primary_function']}
  };

  const BUILTIN_GUIDES = [
    {id:'g1',device_category:'Phone',title:'Phone display damage',symptom:'Cracked glass, no image, display artifacts, or touch failure',summary:'Use after impact when the display assembly, frame, or connector may be affected.',tags:['screen','cracked','display','touch','glass','oled','lcd'],likely_causes:['Damaged display assembly','Display connector damage','Frame deformation'],diagnostic_steps:['Document glass and frame condition before disassembly.','Verify image and touch behavior before repair.','Inspect frame alignment and connector area.','Complete full display, touch, biometric, and proximity testing after repair.'],cautions:'Stop and address battery safety first if impact has damaged or swollen the battery.'},
    {id:'g2',device_category:'Phone',title:'Phone battery degradation',symptom:'Rapid drain, unexpected shutdown, heat, or swelling',summary:'Use when runtime has fallen, shutdowns occur at remaining percentage, or physical swelling is suspected.',tags:['battery','drain','shutdown','swollen','heat','charging'],likely_causes:['Degraded battery','Swollen battery','Charging-system issue','High background draw'],diagnostic_steps:['Document OS battery-health information when available.','Check for enclosure/display lift before charging.','Confirm charging behavior and abnormal heat.','Verify charging, temperature, and boot behavior after replacement.'],cautions:'Do not continue charging a visibly swollen, punctured, smoking, or unusually hot battery.'},
    {id:'g3',device_category:'Phone',title:'Charging failure diagnosis',symptom:'Will not charge or charging cuts in and out',summary:'Use for loose, contaminated, physically damaged, or electronically failed charging paths.',tags:['charging','port','usb-c','lightning','power','intermittent'],likely_causes:['Contaminated charging port','Damaged charging port','Battery failure','Power-management fault'],diagnostic_steps:['Verify complaint with known-good power source.','Inspect port for debris and connector damage.','Confirm battery response and charging behavior.','Escalate to board-level power diagnosis when port/battery causes are excluded.'],cautions:'Stop if liquid damage, battery swelling, or abnormal heat is observed.'},
    {id:'g4',device_category:'Laptop',title:'Laptop thermal diagnosis',symptom:'Hot chassis, loud fan, throttling, or shutdown under load',summary:'Use for suspected thermal restriction, fan failure, or degraded cooling performance.',tags:['laptop','heat','thermal','fan','shutdown','throttle'],likely_causes:['Dust restriction','Fan failure','Degraded thermal interface','Cooling assembly issue','High background load'],diagnostic_steps:['Inspect intake/exhaust obstruction and fan operation.','Confirm temperatures and throttling under controlled load.','Inspect cooling assembly seating and contamination when opened.','Retest thermals after service.'],cautions:'Disconnect power/battery before internal cleaning.'},
    {id:'g5',device_category:'Console',title:'Console no-display / HDMI diagnosis',symptom:'Console powers on but has no stable video output',summary:'Use for PlayStation/Xbox HDMI damage and no-display complaints.',tags:['console','ps5','xbox','hdmi','no display','video','port'],likely_causes:['Damaged HDMI connector','Lifted pads or traces','HDMI/video encoder fault','Board-level video-path failure'],diagnostic_steps:['Confirm power/boot separately from video.','Test known-good display, cable, and input.','Inspect HDMI connector condition and stability.','If connector damage is not the full cause, escalate through the video path.','Verify stable output after repair.'],cautions:'Board-level HDMI work requires appropriate microsoldering skill; inspect pads/traces before committing to connector-only repair.'},
    {id:'g6',device_category:'Other',title:'Liquid exposure triage',symptom:'Water or other liquid exposure',summary:'Use for recent liquid contact where safety and data-preservation decisions come first.',tags:['liquid','water','corrosion','no power','intermittent'],likely_causes:['Connector corrosion','Board corrosion','Battery damage','Module damage'],diagnostic_steps:['Document external condition and exposure timeline.','Do not promise recovery before internal inspection.','Disconnect power/battery as appropriate after opening.','Inspect for corrosion/residue and determine repair or board escalation.'],cautions:'Do not charge devices showing active liquid, corrosion, battery damage, smoke, or abnormal heat.'}
  ];

  const state = {
    profile:null, permissions:new Map(), defs:[], overrides:[], staff:[], customers:[], workOrders:[], leads:[], inventory:[], services:[], guides:[], templates:[], suppliers:[], purchaseOrders:[], poItems:[], intakes:[], appointments:[], settings:null,
    training:localStorage.getItem('gc-training-store')==='1', migrationReady:true, leadFilter:'all', intake:null, currentWorkOrder:null
  };

  function defaultPermission(role,key){ return role==='owner'||ROLE_DEFAULTS[role]?.has(key)||false; }
  function can(key){ return state.permissions.get(key) ?? defaultPermission(state.profile?.role,key); }
  function leadStage(lead){ return lead.pipeline_status || (lead.status==='won'?'converted':lead.status==='lost'?'lost':['claimed','qualified'].includes(lead.status)?'awaiting_customer':'need_to_contact'); }
  function leadLabel(v){ return LEAD_LABELS[v]||friendly(v); }
  function repairLabel(v){ return REPAIR_LABELS[v]||friendly(v); }
  const CUSTOMER_REPAIR_COPY = {
    checked_in:['Checked In','We have the device and the repair is queued for the next step.'], awaiting_repair:['Checked In','The repair is queued for diagnosis or repair.'],
    in_diagnosis:['Being Diagnosed','A technician is evaluating the device before recommending the repair path.'], diagnostic_in_progress:['Being Diagnosed','A technician is evaluating the device before recommending the repair path.'],
    awaiting_approval:['Approval Needed','The customer needs to review and approve the current estimate before billable work continues.'], awaiting_customer:['We Need You','GotCracked needs information or a decision from the customer.'], awaiting_callback:['We Need You','A customer callback or response is needed before the repair continues.'],
    need_to_order_parts:['Preparing Parts','The repair path is confirmed and the needed parts are being sourced.'], waiting_on_parts:['Parts Ordered','The required part is on the way. No customer action is needed right now.'], awaiting_parts:['Parts Ordered','The required part is on the way. No customer action is needed right now.'],
    in_repair:['Repair In Progress','A technician is actively working on the device.'], repair_in_progress:['Repair In Progress','A technician is actively working on the device.'], testing_in_progress:['Testing','The repair is being tested before final inspection.'], quality_inspection:['Final Quality Check','The device is going through final testing before pickup.'],
    ready_for_pickup:['Ready for Pickup','The repair passed final checks. The customer can review the balance and pickup details.'], repaired:['Ready for Pickup','The repair passed final checks. The customer can review the balance and pickup details.'], sale_complete:['Repair Complete','The repair is complete. Receipt and warranty details remain in the customer account.'], completed:['Repair Complete','The repair is complete. Receipt and warranty details remain in the customer account.'],
    customer_declined:['Repair Declined','The customer declined the repair estimate.'], unrepairable:['Unable to Repair','GotCracked will explain the available next options.'], cancelled:['Cancelled','This repair is no longer active.'], abandoned:['Closed','This repair has been closed.']
  };
  function customerRepairView(ticket){
    const [label,next]=CUSTOMER_REPAIR_COPY[ticket.status]||[friendly(ticket.status||'Repair update'),'The customer can open their GotCracked account for the latest repair update.'];
    const total=Math.max(0,Number(ticket.total_cents||0)),paid=Math.max(0,Number(ticket.amount_paid_cents||0)),due=Math.max(0,total-paid),note=String(ticket.public_notes||'').trim();
    return `<section class="card v1-customer-preview"><div class="card-title"><div><p class="v1-kicker">Customer Account Preview</p><h2>${esc(label)}</h2><p>What the customer sees instead of the internal Portal workflow.</p></div><a class="secondary-button" href="https://gotcracked.co/account.html" target="_blank" rel="noopener">Open customer sign-in ↗</a></div><div class="v1-device-meta"><div class="v1-meta-block"><small>Customer status</small><strong>${esc(label)}</strong></div><div class="v1-meta-block"><small>Balance</small><strong>${due?money(due):'Paid / none due'}</strong></div><div class="v1-meta-block"><small>Payment</small><strong>${esc(friendly(ticket.payment_status||'unpaid'))}</strong></div><div class="v1-meta-block"><small>Secure access</small><strong>Phone/email + code</strong></div></div><div class="v1-summary"><strong>What happens next:</strong> ${esc(next)}${note?`<br><br><strong>Customer-visible note:</strong> ${esc(note)}`:''}</div></section>`;
  }
  function pill(value,label){ return `<span class="v1-status ${esc(value)}">${esc(label||friendly(value))}</span>`; }
  function firstName(){ return String(state.profile?.display_name||'Staff').split(/\s+/)[0]; }

  function seedTraining(){
    const raw=localStorage.getItem('gc-training-data-v1');
    if(raw){try{return JSON.parse(raw);}catch{}}
    const customerId='training-customer-1',deviceId='training-device-1';
    const data={
      customers:[{id:customerId,location_id:'training',first_name:'Taylor',last_name:'Morgan',phone:'(555) 010-4100',phone_normalized:'5550104100',contact_phone:'(555) 010-4100',email:'taylor@example.test',address_line_1:'101 Campus Way',city:'Training City',state:'VA',postal_code:'00000',devices:[{id:deviceId,customer_id:customerId,category:'Console',manufacturer:'Sony',model:'PlayStation 5',model_number:'CFI-1215A',color:'White',storage_size:'825 GB',device_condition:'Fair',serial_number:'TRAIN-PS5-001',last_seen_at:now()}]}],
      workOrders:[{id:'training-ticket-1',ticket_number:900001,location_id:'training',customer_id:customerId,device_id:deviceId,status:'awaiting_repair',customer_issue:'Powers on but no display output.',intake_summary:'Initial intake inspection: Console powers on and appears to boot. No display output observed. HDMI port shows visible physical damage. No obvious liquid exposure observed.',created_at:now(),updated_at:now(),customers:{first_name:'Taylor',last_name:'Morgan',phone:'(555) 010-4100',contact_phone:'(555) 010-4100',email:'taylor@example.test'},devices:{category:'Console',manufacturer:'Sony',model:'PlayStation 5',model_number:'CFI-1215A',color:'White',storage_size:'825 GB',device_condition:'Fair',serial_number:'TRAIN-PS5-001'},profiles:{display_name:'Training Tech'},work_order_items:[],ticket_events:[]}],
      leads:[{id:'training-lead-1',location_id:'training',name:'Jordan Student',phone:'(555) 010-4200',email:'jordan@example.test',device_category:'Phone',manufacturer:'Apple',model:'iPhone 15',customer_issue:'Cracked screen after a drop.',service:'Screen repair',source:'Website',pipeline_status:'need_to_contact',status:'new',created_at:now(),updated_at:now()}],
      inventory:[{id:'training-part-1',sku:'PART-DEMO-001',name:'Training PS5 HDMI Port',category:'Console part',quantity_on_hand:5,reorder_point:2,cost_cents:499,sell_price_cents:2499,supplier_name:'MobileSentrix',active:true},{id:'training-part-2',sku:'PART-DEMO-002',name:'Training Phone Battery',category:'Phone battery',quantity_on_hand:8,reorder_point:3,cost_cents:1299,sell_price_cents:3999,supplier_name:'MobileSentrix',active:true}],
      services:[{id:'training-svc-1',sku:'SVC-DIAG',name:'Diagnostic Service',category:'Diagnostic',price_cents:3999,taxable:false,active:true},{id:'training-svc-2',sku:'SVC-HDMI',name:'HDMI Port Replacement Labor',category:'Console repair',price_cents:12900,taxable:true,active:true}],
      purchaseOrders:[],poItems:[],guides:BUILTIN_GUIDES,intakes:[],appointments:[]
    };
    localStorage.setItem('gc-training-data-v1',JSON.stringify(data));
    return data;
  }
  function saveTraining(){
    localStorage.setItem('gc-training-data-v1',JSON.stringify({customers:state.customers,workOrders:state.workOrders,leads:state.leads,inventory:state.inventory,services:state.services,purchaseOrders:state.purchaseOrders,poItems:state.poItems,guides:state.guides,intakes:state.intakes,appointments:state.appointments}));
  }
  function loadTraining(){
    const data=seedTraining();
    Object.assign(state,{customers:data.customers||[],workOrders:data.workOrders||[],leads:data.leads||[],inventory:data.inventory||[],services:data.services||[],purchaseOrders:data.purchaseOrders||[],poItems:data.poItems||[],guides:data.guides||BUILTIN_GUIDES,intakes:data.intakes||[],appointments:data.appointments||[],suppliers:[{id:'train-s1',name:'MobileSentrix'},{id:'train-s2',name:'Amazon'},{id:'train-s3',name:'Other Vendor'}]});
  }

  async function initProfile(){
    const {data:{user}}=await client.auth.getUser();
    if(!user)return false;
    const profileResult=await client.from('profiles').select('*,locations(name,timezone)').eq('id',user.id).single();
    if(profileResult.error)return false;
    state.profile=profileResult.data;
    state.defs=PERMISSIONS.map(([permission_key,label,group_name])=>({permission_key,label,group_name}));
    const [defsResult,overrideResult]=await Promise.all([client.from('permission_definitions').select('*'),client.from('staff_permission_overrides').select('*').eq('profile_id',user.id)]);
    if(!defsResult.error)state.defs=defsResult.data||state.defs;else state.migrationReady=false;
    const overrides=!overrideResult.error?(overrideResult.data||[]):[];
    if(overrideResult.error)state.migrationReady=false;
    const overrideMap=new Map(overrides.map(x=>[x.permission_key,x.enabled]));
    state.defs.forEach(def=>state.permissions.set(def.permission_key,state.profile.role==='owner'?true:(overrideMap.has(def.permission_key)?overrideMap.get(def.permission_key):defaultPermission(state.profile.role,def.permission_key))));
    return true;
  }

  async function loadProduction(){
    const loc=state.profile.location_id;
    const jobs={
      customers:client.from('customers').select('*,devices(*),repair_tickets(id,ticket_number,status,customer_issue,total_cents,created_at,device_id)').order('created_at',{ascending:false}).limit(1000),
      workOrders:can('repairs.view')?client.from('repair_tickets').select('*,customers(*),devices(*),profiles:assigned_user_id(display_name),work_order_items(*),ticket_events(*,actor:actor_user_id(display_name))').eq('location_id',loc).order('created_at',{ascending:false}).limit(500):Promise.resolve({data:[]}),
      leads:can('leads.view')?client.from('leads').select('*').order('created_at',{ascending:false}).limit(500):Promise.resolve({data:[]}),
      inventory:can('inventory.view')?client.from('inventory_items').select('*').eq('active',true).order('name').limit(5000):Promise.resolve({data:[]}),
      services:client.from('services').select('*').eq('active',true).order('name'),
      guides:can('reference.view')?client.from('repair_guides').select('*').eq('active',true).order('device_category').order('title'):Promise.resolve({data:[]}),
      templates:can('repairs.intake')?client.from('intake_templates').select('*').eq('active',true):Promise.resolve({data:[]}),
      purchaseOrders:can('purchasing.view')?client.from('purchase_orders').select('*').eq('location_id',loc).order('created_at',{ascending:false}):Promise.resolve({data:[]}),
      poItems:can('purchasing.view')?client.from('purchase_order_items').select('*,inventory_items(name,sku,sell_price_cents,quantity_on_hand)').order('created_at'):Promise.resolve({data:[]}),
      intakes:can('repairs.view')?client.from('intake_sessions').select('*').eq('location_id',loc).order('created_at',{ascending:false}):Promise.resolve({data:[]}),
      suppliers:can('purchasing.view')?client.from('suppliers').select('*').eq('active',true).order('name'):Promise.resolve({data:[]}),
      appointments:client.from('appointments').select('*').order('preferred_date').limit(200),
      settings:client.from('business_settings').select('*').eq('location_id',loc).maybeSingle()
    };
    if(can('staff.manage')){
      jobs.staff=client.functions.invoke('manage-staff',{body:{action:'list'}});
      jobs.overrides=client.from('staff_permission_overrides').select('*');
    }
    const entries=Object.entries(jobs);
    const results=await Promise.all(entries.map(([,promise])=>promise));
    results.forEach((result,index)=>{
      const key=entries[index][0];
      if(result.error){if(['guides','templates','purchaseOrders','poItems','intakes','overrides'].includes(key))state.migrationReady=false;return;}
      if(key==='staff')state.staff=result.data?.staff||[];
      else if(key==='settings')state.settings=result.data||null;
      else if(key==='overrides')state.overrides=result.data||[];
      else state[key]=result.data||[];
    });
    if(!state.guides.length)state.guides=BUILTIN_GUIDES;
  }

  async function reload(){
    if(state.training)loadTraining();else await loadProduction();
    ensureShell();
    applyPermissions();
    renderAll();
  }

  function ensureShell(){
    const main=document.querySelector('.app-shell main');
    const nav=document.querySelector('.sidebar nav');
    if(!main||!nav)return;
    // A previous selector runtime injected a bright contrast style into live sessions.
    // Remove that stale layer before this module renders the single authoritative control.
    document.getElementById('gc-store-selector-contrast')?.remove();
    document.querySelectorAll('style').forEach(style=>{
      const css=style.textContent||'';
      if(css.includes('.topbar .location .v1-store-switch')&&css.includes('#f8fbff'))style.remove();
    });
    const addAfter=(selector,html)=>nav.querySelector(selector)?.insertAdjacentHTML('afterend',html);
    if(!nav.querySelector('[data-view="ready-pickup"]'))addAfter('[data-view="repairs"]','<a class="nav-link" href="#ready-pickup" data-view="ready-pickup"><span>✓</span>Ready for Pickup <b id="ready-count" hidden>0</b></a>');
    if(!nav.querySelector('[data-view="repair-reference"]'))addAfter('[data-view="inventory"]','<a class="nav-link" href="#repair-reference" data-view="repair-reference"><span>⌕</span>Repair Reference</a><a class="nav-link" href="#purchasing" data-view="purchasing"><span>▣</span>Purchasing</a>');
    for(const id of ['ready-pickup','repair-reference','purchasing','work-order']){
      if(!document.getElementById(id)){const section=document.createElement('section');section.id=id;section.className='view';main.appendChild(section);}
    }
    if(!document.getElementById('v1-intake-dialog')){const dialog=document.createElement('dialog');dialog.id='v1-intake-dialog';dialog.innerHTML='<div id="v1-intake-root"></div>';document.body.appendChild(dialog);}
    if(!document.getElementById('v1-lead-drawer')){const drawer=document.createElement('aside');drawer.id='v1-lead-drawer';drawer.className='v1-right-drawer';drawer.innerHTML='<div id="v1-lead-drawer-content"></div>';document.body.appendChild(drawer);const backdrop=document.createElement('button');backdrop.id='v1-drawer-backdrop';backdrop.className='v1-drawer-backdrop';backdrop.type='button';backdrop.hidden=true;backdrop.setAttribute('aria-label','Close panel');document.body.appendChild(backdrop);}
    if(!document.getElementById('v1-po-dialog')){const dialog=document.createElement('dialog');dialog.id='v1-po-dialog';dialog.innerHTML='<form id="v1-po-form"><div id="v1-po-content"></div></form>';document.body.appendChild(dialog);}
    const location=document.querySelector('.topbar .location');
    if(location){
      location.innerHTML=`<button class="v1-store-switch" type="button" data-v1-store-menu-toggle aria-haspopup="menu" aria-expanded="false"><span class="status-dot"></span><strong>${state.training?'Training Store':esc(state.profile?.locations?.name||'Main Store')}</strong></button><div class="v1-store-switch-menu" role="menu" hidden><button class="v1-store-option" type="button" role="menuitem" data-v1-store-option="production" aria-current="${state.training?'false':'true'}"><span class="status-dot"></span><span><strong>${esc(state.profile?.locations?.name||'Main Store')}</strong><small>Live production data</small></span></button><button class="v1-store-option" type="button" role="menuitem" data-v1-store-option="training" aria-current="${state.training?'true':'false'}"><span>◌</span><span><strong>Training Store</strong><small>Sandbox data only</small></span></button></div>`;
    }
    document.body.classList.toggle('training-store',state.training);
    let banner=document.getElementById('v1-training-banner');
    if(state.training&&!banner){banner=document.createElement('div');banner.id='v1-training-banner';banner.className='v1-training-banner';banner.innerHTML='<strong>TRAINING STORE</strong><span>Sandbox mode — no production customers, leads, work orders, inventory, POs, or sales are changed.</span><button type="button" data-v1-store-switch>Return to Main Store</button>';main.prepend(banner);}
    if(!state.training&&banner)banner.remove();
    document.querySelectorAll('[data-open-ticket]').forEach(button=>button.textContent='+ New Work Order');
    for(const heading of [document.querySelector('#dashboard .page-heading'),document.querySelector('#repairs .page-heading')]){
      if(!heading||heading.querySelector('[data-v1-walkin]'))continue;
      const old=heading.querySelector('[data-open-ticket]');
      if(!old)continue;
      const actions=document.createElement('div');actions.className='v1-actions';old.before(actions);actions.appendChild(old);actions.insertAdjacentHTML('afterbegin','<button class="secondary-button" data-v1-walkin>Walk-In</button>');
    }
    const appointmentButton=document.querySelector('#appointments [data-open-ticket]');
    if(appointmentButton){appointmentButton.removeAttribute('data-open-ticket');appointmentButton.dataset.v1Walkin='1';appointmentButton.textContent='+ Walk-In';}
  }

  function applyPermissions(){
    const mapping={repairs:'repairs.view','ready-pickup':'ready_pickup.view',leads:'leads.view',customers:'customers.view',inventory:'inventory.view','repair-reference':'reference.view',purchasing:'purchasing.view',reports:'reports.view',staff:'staff.manage',settings:'settings.manage'};
    for(const [view,key] of Object.entries(mapping))document.querySelectorAll(`[data-view="${view}"]`).forEach(node=>node.classList.toggle('v1-hidden',!can(key)));
    document.querySelectorAll('[data-v1-walkin]').forEach(node=>node.classList.toggle('v1-hidden',!can('repairs.intake')));
    document.querySelectorAll('[data-live-action="inventory"],[data-adjust-part],[data-loss-part],[data-audit-action]').forEach(node=>node.classList.toggle('v1-hidden',!can('inventory.manage')));
  }

  function renderAll(){
    renderDashboard();renderRepairs();renderLeads();renderReady();renderReference();renderPurchasing();renderPermissions();renderTrainingSettings();
    const ready=state.workOrders.filter(t=>['repaired','ready_for_pickup'].includes(t.status));
    const badge=document.getElementById('ready-count');if(badge){badge.textContent=ready.length;badge.hidden=!ready.length;}
  }

  function workRows(items){
    return items.map(t=>`<tr data-v1-work-order="${esc(t.id)}"><td><strong>${ticketCode(t.ticket_number)}</strong><small>${new Date(t.updated_at||t.created_at).toLocaleString()}</small></td><td><strong>${esc(`${t.customers?.first_name||''} ${t.customers?.last_name||''}`.trim()||'Customer')}</strong><small>${esc(t.customers?.phone||t.customers?.email||'')}</small></td><td><strong>${esc([t.devices?.manufacturer,t.devices?.model].filter(Boolean).join(' ')||'Device')}</strong><small>${esc(t.customer_issue||'No issue recorded')}</small></td><td>${pill(t.status,repairLabel(t.status))}</td><td>${esc(t.profiles?.display_name||'Unassigned')}</td></tr>`).join('');
  }
  function leadRows(items){
    return items.map(lead=>{const stage=leadStage(lead);return `<tr data-v1-lead="${lead.id}"><td><strong>${esc(lead.name||'Unknown customer')}</strong><small>${esc(lead.phone||lead.email||'No contact')}</small></td><td><strong>${esc([lead.manufacturer,lead.model].filter(Boolean).join(' ')||lead.device_category||lead.service||'Repair inquiry')}</strong><small>${esc(lead.customer_issue||lead.service||lead.notes||'')}</small></td><td>${pill(stage,leadLabel(stage))}</td><td>${lead.contact_attempted_at?new Date(lead.contact_attempted_at).toLocaleString():'No a…13679 tokens truncated…x0a8,'/':0x0a2,'+':0x08a,'%':0x02a,'*':0x094};const clean=String(code||'GC').toUpperCase().replace(/[^0-9A-Z. $/+%\-]/g,'-').slice(0,32);let x=0,bars='';for(const char of `*${clean}*`){const pattern=patterns[char]??patterns['-'];for(let i=0;i<9;i++){const barWidth=pattern&(1<<(8-i))?3:1;if(i%2===0)bars+=`<rect x="${x}" y="0" width="${barWidth}" height="34"/>`;x+=barWidth;}x+=1;}const svg=`<svg viewBox="0 0 ${x} 34" preserveAspectRatio="none">${bars}</svg>`;const labels=Array.from({length:Math.max(1,copies)},()=>`<section class="label"><img src="${new URL('assets/gotcracked-mark.png',location.href)}"><div><small>GOTCRACKED ${state.training?'· TRAINING':''}</small><h1>${esc(title)}</h1><p>${esc(subtitle)}</p><div class="barcode">${svg}</div><code>${esc(clean)}</code><footer>${price?`<strong>${esc(price)}</strong>`:''}${phone?`<span>${esc(phone)}</span>`:''}</footer></div></section>`).join('');
    popup.document.write(`<!doctype html><html><head><style>@page{size:${width} ${height};margin:0}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif}.label{page-break-after:always;width:${width};height:${height};padding:.08in .12in;display:grid;grid-template-columns:.72in 1fr;gap:.09in;align-items:center;overflow:hidden}.label:last-child{page-break-after:auto}img{width:.66in;height:.66in;object-fit:contain}h1{font-size:13pt;margin:1px 0 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}p{font-size:7.5pt;margin:0 0 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}small{font-size:6pt;font-weight:700;letter-spacing:.08em}.barcode{height:.26in}.barcode svg{width:100%;height:100%;fill:#000;display:block}code{display:block;text-align:center;font-size:6.5pt;font-weight:700}footer{display:flex;justify-content:space-between;font-size:7pt;margin-top:1px}</style></head><body>${labels}<script>addEventListener('load',()=>setTimeout(()=>print(),250));<\/script></body></html>`);popup.document.close();
  }
  function printTicketLabel(ticket){printDymo({title:ticketCode(ticket.ticket_number),subtitle:`${ticket.customers?.first_name||''} ${ticket.customers?.last_name||''} · ${[ticket.devices?.manufacturer,ticket.devices?.model].filter(Boolean).join(' ')}`.trim(),code:ticketCode(ticket.ticket_number),phone:state.settings?.label_show_customer_phone?ticket.customers?.phone||'':'',copies:1});}
  function printInventoryLabel(item,copies=1){printDymo({title:item.name,subtitle:item.category||'GotCracked inventory',code:item.sku||'NO-SKU',price:state.settings?.label_show_price!==false?money(item.sell_price_cents||0):'',copies});}

  function openIntake(prefill={}){
    if(!can('repairs.intake'))return;
    state.intake={step:0,search:'',customer:prefill.customer||null,newCustomer:prefill.customer?{...prefill.customer}:{},device:prefill.device||null,newDevice:prefill.device?{...prefill.device}:{category:'Phone'},complaint:prefill.customer_issue||prefill.pendingTicket?.customer_issue||'',visual:{},functional:{},lead:prefill.lead||null,pendingTicket:prefill.pendingTicket||null};
    renderIntake();document.getElementById('v1-intake-dialog').showModal();
  }
  function renderIntake(){const root=document.getElementById('v1-intake-root'),x=state.intake;if(!root||!x)return;const steps=['Customer','Profile','Device','Inspection','Review'];root.innerHTML=`<div class="v1-intake-shell"><div class="v1-intake-head"><div><p class="v1-kicker">Walk-In Intake ${state.training?'· TRAINING':''}</p><h2>${steps[x.step]}</h2></div><button class="icon-button" type="button" data-v1-close-intake>×</button></div><div class="v1-stepper">${steps.map((_,i)=>`<span class="v1-step ${i<x.step?'done':i===x.step?'active':''}"></span>`).join('')}</div><div class="v1-intake-body">${intakeStepHTML(x)}</div><div class="v1-intake-actions"><button type="button" class="secondary-button" data-v1-intake-prev ${x.step===0?'disabled':''}>Back</button>${x.step<4?'<button type="button" class="primary-button" data-v1-intake-next>Continue</button>':'<button type="button" class="primary-button" data-v1-intake-create>Create Work Order</button>'}</div></div>`;bindIntakeInputs();}
  function intakeStepHTML(x){
    if(x.step===0){const q=x.search.toLowerCase(),matches=state.customers.filter(c=>text(c.first_name,c.last_name,c.phone,c.email).includes(q)).slice(0,10);return `<h3>Find customer</h3><p>Start with phone number or email. Existing profiles and saved devices prevent duplicate entry.</p><div class="v1-form"><label>Phone or email<input id="v1-intake-search" value="${esc(x.search)}" placeholder="Phone number or email" autofocus></label></div><div class="v1-customer-results">${x.search?matches.map(c=>`<button type="button" class="v1-choice ${x.customer?.id===c.id?'selected':''}" data-v1-intake-customer="${c.id}"><strong>${esc(c.first_name)} ${esc(c.last_name)}</strong><small>${esc(c.phone)} · ${esc(c.email||'No email')} · ${(c.devices||[]).length} saved device(s)</small></button>`).join('')||'<p>No matching customer. Continue to create a profile.</p>':'<p class="v1-muted">Enter a phone number or email to search.</p>'}</div>`;}
    if(x.step===1){const c=x.newCustomer;return `<h3>${x.customer?'Confirm customer':'Customer onboarding'}</h3><p>Only customer name and phone number are required. Everything else can be completed later.</p><div class="v1-form-grid"><label>Customer name <span class="v1-required">Required</span><input data-intake-customer="first_name" value="${esc(c.first_name||'')}"></label><label>Last name (optional)<input data-intake-customer="last_name" value="${esc(c.last_name||'')}"></label><label>Phone number <span class="v1-required">Required</span><input data-intake-customer="phone" inputmode="tel" value="${esc(c.phone||'')}"></label><label>Alternate phone<input data-intake-customer="contact_phone" inputmode="tel" value="${esc(c.contact_phone&&c.contact_phone!==c.phone?c.contact_phone:'')}"></label><label class="full">Email<input data-intake-customer="email" type="email" value="${esc(c.email||'')}"></label><label class="full">Address<input data-intake-customer="address_line_1" value="${esc(c.address_line_1||'')}"></label><label>City<input data-intake-customer="city" value="${esc(c.city||'')}"></label><label>State<input data-intake-customer="state" value="${esc(c.state||'')}"></label><label>ZIP<input data-intake-customer="postal_code" value="${esc(c.postal_code||'')}"></label></div>`;}
    if(x.step===2){const devices=x.customer?.devices||[],d=x.newDevice;return `<h3>Select or add device</h3><p>Existing customers can reuse a saved device; condition and diagnostics are still performed fresh every visit.</p>${devices.length?`<div class="v1-device-choices">${devices.map(dev=>`<button type="button" class="v1-choice ${x.device?.id===dev.id?'selected':''}" data-v1-intake-device="${dev.id}"><strong>${esc([dev.manufacturer,dev.model].filter(Boolean).join(' ')||dev.category)}</strong><small>${esc(dev.color||'Color not recorded')} · ${esc(dev.serial_number||dev.imei||'No serial/IMEI')}</small></button>`).join('')}<button type="button" class="v1-choice ${!x.device?'selected':''}" data-v1-intake-new-device>+ Add new device</button></div>`:''}<div class="v1-device-types">${['Phone','Tablet','Laptop','Desktop','Console','Other'].map(cat=>`<button type="button" data-v1-device-category="${cat}" class="${d.category===cat?'selected':''}">${cat}</button>`).join('')}</div><div class="v1-form-grid"><label>Manufacturer<input data-intake-device="manufacturer" value="${esc(d.manufacturer||'')}" placeholder="Apple, Samsung, Google, Sony..."></label><label>Model<input data-intake-device="model" value="${esc(d.model||'')}"></label><label>Model number<input data-intake-device="model_number" value="${esc(d.model_number||'')}"></label><label>Color<input data-intake-device="color" value="${esc(d.color||'')}"></label><label>Storage<input data-intake-device="storage_size" value="${esc(d.storage_size||'')}"></label><label>Condition<select data-intake-device="device_condition"><option value="">Choose</option>${['Bad','Fair','Good','Like New'].map(v=>`<option ${d.device_condition===v?'selected':''}>${v}</option>`).join('')}</select></label><label>Serial number<input data-intake-device="serial_number" value="${esc(d.serial_number||'')}"></label><label>IMEI<input data-intake-device="imei" value="${esc(d.imei||'')}"></label><label class="full">Accessories received<input data-intake-device="accessories_text" value="${esc(d.accessories_text||'')}" placeholder="Power cable, case, controller, charger..."></label><label class="full">Customer-reported issue<textarea data-intake-complaint>${esc(x.complaint||'')}</textarea></label></div>`;}
    if(x.step===3){const category=x.newDevice.category||'Other',template=CHECKLISTS[category]||CHECKLISTS.Other;return `<h3>${esc(category)} intake inspection</h3><p>Record what front-of-house actually observes. Use Not Tested when a function cannot be safely verified.</p><div class="v1-checklist">${[['Visual inspection',template.visual,'visual'],['Functional pre-check',template.functional,'functional']].map(([group,items,bucket])=>`<section class="v1-check-group"><h4>${group}</h4>${items.map(key=>`<label class="v1-check-row"><span>${friendly(key)}</span><select data-intake-check="${bucket}:${key}"><option value="not_tested">Not Tested</option><option value="pass" ${x[bucket][key]==='pass'?'selected':''}>Pass / Normal</option><option value="fail" ${x[bucket][key]==='fail'?'selected':''}>Fail / Problem</option><option value="damaged" ${x[bucket][key]==='damaged'?'selected':''}>Damaged</option><option value="observed" ${x[bucket][key]==='observed'?'selected':''}>Observed</option><option value="not_applicable" ${x[bucket][key]==='not_applicable'?'selected':''}>N/A</option></select></label>`).join('')}</section>`).join('')}</div>`;}
    const summary=generateSummary(x);return `<div class="v1-review"><div class="v1-review-card"><h4>Customer</h4><p>${esc(x.newCustomer.first_name||'')} ${esc(x.newCustomer.last_name||'')} · ${esc(x.newCustomer.phone||'')} · ${esc(x.newCustomer.email||'')}</p></div><div class="v1-review-card"><h4>Device</h4><p>${esc([x.newDevice.manufacturer,x.newDevice.model].filter(Boolean).join(' ')||x.newDevice.category)} · ${esc(x.newDevice.color||'')} · ${esc(x.newDevice.storage_size||'')} · ${esc(x.newDevice.device_condition||'Condition not recorded')}</p></div><div class="v1-review-card"><h4>Customer complaint</h4><p>${esc(x.complaint)}</p></div><div class="v1-review-card"><h4>Generated intake summary</h4><p>${esc(summary)}</p></div><p class="v1-muted">The structured checklist is saved separately and powers suggested repair references on the work order.</p></div>`;
  }
  function bindIntakeInputs(){document.querySelectorAll('[data-intake-customer]').forEach(el=>el.addEventListener('input',()=>state.intake.newCustomer[el.dataset.intakeCustomer]=el.value));document.querySelectorAll('[data-intake-device]').forEach(el=>el.addEventListener('input',()=>state.intake.newDevice[el.dataset.intakeDevice]=el.value));document.querySelector('[data-intake-complaint]')?.addEventListener('input',event=>state.intake.complaint=event.target.value);document.querySelectorAll('[data-intake-check]').forEach(el=>el.addEventListener('change',()=>{const [bucket,key]=el.dataset.intakeCheck.split(':');state.intake[bucket][key]=el.value;}));}
  function generateSummary(x){const bad=[],good=[];for(const bucket of ['visual','functional'])for(const [key,value] of Object.entries(x[bucket])){if(['fail','damaged','observed'].includes(value))bad.push(`${friendly(key)}: ${friendly(value)}`);else if(value==='pass')good.push(`${friendly(key)} normal`);}let summary=`Initial intake inspection for ${[x.newDevice.manufacturer,x.newDevice.model].filter(Boolean).join(' ')||x.newDevice.category||'device'}. Customer reports: ${x.complaint||'No complaint recorded'}.`;if(bad.length)summary+=` Observed concerns: ${bad.join('; ')}.`;if(good.length)summary+=` Functions/conditions observed as normal: ${good.join('; ')}.`;if(!bad.length&&!good.length)summary+=' Functional testing was not completed or findings were not recorded.';return summary;}
  function validStep(){const x=state.intake;if(x.step===1)return Boolean(x.newCustomer.first_name?.trim()&&x.newCustomer.phone?.trim());return true;}

  async function createFromIntake(){
    const x=state.intake,summary=generateSummary(x);let customer=x.customer,device=x.device;
    if(state.training){
      if(customer)Object.assign(customer,x.newCustomer);else{customer={id:uid('customer'),location_id:'training',...x.newCustomer,phone_normalized:digits(x.newCustomer.phone),devices:[]};state.customers.unshift(customer);}
      if(device){Object.assign(device,x.newDevice,{last_seen_at:now()});}else{device={id:uid('device'),customer_id:customer.id,...x.newDevice,accessories:x.newDevice.accessories_text?[x.newDevice.accessories_text]:[],last_seen_at:now()};customer.devices=customer.devices||[];customer.devices.push(device);}
      const intake={id:uid('intake'),location_id:'training',customer_id:customer.id,device_id:device.id,lead_id:x.lead?.id||null,customer_complaint:x.complaint,visual_findings:x.visual,functional_findings:x.functional,generated_summary:summary,completed_by:state.profile.id,completed_at:now(),created_at:now()};
      let ticket=x.pendingTicket;
      if(ticket){ticket.status='awaiting_repair';ticket.arrived_at=now();ticket.intake_summary=summary;ticket.intake_session_id=intake.id;ticket.customer_id=customer.id;ticket.device_id=device.id;ticket.customer_issue=x.complaint;ticket.customers={...customer};ticket.devices={...device};ticket.updated_at=now();}
      else{ticket={id:uid('ticket'),ticket_number:900000+state.workOrders.length+1,location_id:'training',customer_id:customer.id,device_id:device.id,status:'awaiting_repair',customer_issue:x.complaint,intake_summary:summary,intake_session_id:intake.id,arrived_at:now(),created_at:now(),updated_at:now(),customers:{...customer},devices:{...device},profiles:null,work_order_items:[],ticket_events:[]};state.workOrders.unshift(ticket);}
      intake.ticket_id=ticket.id;state.intakes.unshift(intake);saveTraining();document.getElementById('v1-intake-dialog').close();renderAll();openWorkOrder(ticket.id);if(can('labels.work_order')&&confirm(`Create ${ticketCode(ticket.ticket_number)}. Print the DYMO device label now?`))printTicketLabel(ticket);return;
    }
    const customerPayload={location_id:state.profile.location_id,first_name:x.newCustomer.first_name.trim(),last_name:x.newCustomer.last_name?.trim()||'',phone:x.newCustomer.phone.trim(),phone_normalized:digits(x.newCustomer.phone),contact_phone:x.newCustomer.contact_phone?.trim()||x.newCustomer.phone.trim(),email:x.newCustomer.email?.trim().toLowerCase()||null,address_line_1:x.newCustomer.address_line_1?.trim()||null,address_line_2:x.newCustomer.address_line_2?.trim()||null,city:x.newCustomer.city?.trim()||null,state:x.newCustomer.state?.trim()||null,postal_code:x.newCustomer.postal_code?.trim()||null};
    if(customer){const result=await client.from('customers').update(customerPayload).eq('id',customer.id).select().single();if(result.error)return alert(result.error.message);customer=result.data;}else{const result=await client.from('customers').insert(customerPayload).select().single();if(result.error)return alert(result.error.message);customer=result.data;}
    const devicePayload={category:x.newDevice.category||'Other',manufacturer:x.newDevice.manufacturer?.trim()||null,model:x.newDevice.model?.trim()||'Unknown device',model_number:x.newDevice.model_number?.trim()||null,color:x.newDevice.color?.trim()||null,storage_size:x.newDevice.storage_size?.trim()||null,device_condition:x.newDevice.device_condition||null,serial_number:x.newDevice.serial_number?.trim()||null,imei:x.newDevice.imei?.trim()||null,accessories:x.newDevice.accessories_text?[x.newDevice.accessories_text]:[],last_seen_at:now()};
    if(device){const result=await client.from('devices').update(devicePayload).eq('id',device.id).eq('customer_id',customer.id).select().single();if(result.error)return alert(result.error.message);device=result.data;}else{const result=await client.from('devices').insert({customer_id:customer.id,...devicePayload}).select().single();if(result.error)return alert(result.error.message);device=result.data;}
    const intakeResult=await client.from('intake_sessions').insert({location_id:state.profile.location_id,customer_id:customer.id,device_id:device.id,lead_id:x.lead?.id||null,intake_method:'walk_in',customer_complaint:x.complaint,visual_findings:x.visual,functional_findings:x.functional,generated_summary:summary,completed_by:state.profile.id,completed_at:now()}).select().single();if(intakeResult.error)return alert(intakeResult.error.message);
    let ticket=x.pendingTicket;
    if(ticket){const result=await client.from('repair_tickets').update({status:'awaiting_repair',arrived_at:now(),intake_summary:summary,intake_session_id:intakeResult.data.id,customer_id:customer.id,device_id:device.id,customer_issue:x.complaint}).eq('id',ticket.id).select().single();if(result.error)return alert(result.error.message);ticket=result.data;}
    else{const result=await client.from('repair_tickets').insert({location_id:state.profile.location_id,customer_id:customer.id,device_id:device.id,status:'awaiting_repair',customer_issue:x.complaint,intake_summary:summary,intake_session_id:intakeResult.data.id,arrived_at:now(),intake_method:'walk_in'}).select().single();if(result.error)return alert(result.error.message);ticket=result.data;}
    await client.from('intake_sessions').update({ticket_id:ticket.id}).eq('id',intakeResult.data.id);document.getElementById('v1-intake-dialog').close();await reload();const full=state.workOrders.find(t=>t.id===ticket.id);if(full){openWorkOrder(full.id);if(can('labels.work_order')&&confirm(`Create ${ticketCode(full.ticket_number)}. Print the DYMO device label now?`))printTicketLabel(full);}
  }

  function startLead(){
    const name=prompt('Customer name');if(!name)return;const phone=prompt('Phone number')||'';const email=prompt('Email')||'';const issue=prompt('Customer-reported issue')||'';
    if(state.training){state.leads.unshift({id:uid('lead'),location_id:'training',name,phone,email,customer_issue:issue,service:issue,source:'Portal',pipeline_status:'need_to_contact',status:'new',created_at:now(),updated_at:now()});saveTraining();renderAll();return;}
    client.functions.invoke('create-lead',{body:{name,phone:phone||null,email:email||null,service:issue||'Repair inquiry',source:'portal',notes:null}}).then(async({data,error})=>{if(error)return alert(error.message);const id=data?.id||data?.lead?.id;if(id)await client.from('leads').update({pipeline_status:'need_to_contact',customer_issue:issue}).eq('id',id);await reload();});
  }

  let storeSwitchBusy=false;
  async function switchStore(nextTraining=!state.training){
    if(storeSwitchBusy)return;
    storeSwitchBusy=true;
    if(Boolean(nextTraining)===state.training){storeSwitchBusy=false;return;}
    state.training=Boolean(nextTraining);
    localStorage.setItem('gc-training-store',state.training?'1':'0');
    state.currentWorkOrder=null;
    state.intake=null;
    closeDrawer();
    document.querySelectorAll('dialog[open]').forEach(dialog=>{try{dialog.close();}catch{}});
    document.dispatchEvent(new CustomEvent('gc-store-mode-changed',{detail:{training:state.training}}));
    try{
      await reload();
      window.GotCrackedUI?.activateView?.('dashboard');
      window.GotCrackedDirectory?.render?.();
    }finally{storeSwitchBusy=false;}
  }

  document.addEventListener('input',event=>{
    if(['v1-dash-work-search','v1-dash-lead-search'].includes(event.target.id))redrawDashboard();
    if(event.target.id==='v1-repair-search')redrawRepairs();
    if(event.target.id==='v1-lead-search')redrawLeads();
    if(event.target.id==='v1-guide-search')redrawGuides();
    if(event.target.id==='v1-intake-search'){state.intake.search=event.target.value;renderIntake();const input=document.getElementById('v1-intake-search');if(input){input.focus();input.setSelectionRange(input.value.length,input.value.length);}}
    if(event.target.id==='v1-line-search'){const results=document.getElementById('v1-line-results'),rows=searchCatalog(event.target.value);if(results){results.hidden=!rows.length;results.innerHTML=rows.map(row=>`<button type="button" data-v1-add-line="${row._type}:${row.id}"><span><strong>${esc(row.sku||'NO SKU')} · ${esc(row.name)}</strong><small>${row._type==='part'?`${row.quantity_on_hand} on hand`:'Service'}</small></span><strong>${money(row._price)}</strong></button>`).join('');}}
  });
  document.addEventListener('change',event=>{
    if(['v1-dash-work-status','v1-dash-lead-status'].includes(event.target.id))redrawDashboard();
    if(event.target.id==='v1-repair-status')redrawRepairs();
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Enter'&&event.target.id==='v1-pickup-scan'){event.preventDefault();const scanned=event.target.value.trim().toUpperCase(),number=scanned.replace(/\D/g,'');const ticket=state.workOrders.find(t=>['repaired','ready_for_pickup'].includes(t.status)&&(String(t.ticket_number)===number||ticketCode(t.ticket_number)===scanned));if(ticket)openWorkOrder(ticket.id);else alert('No ready work order matches that barcode.');event.target.value='';}
    if(event.key==='Escape'){closeDrawer();const results=document.getElementById('v1-line-results');if(results)results.hidden=true;}
    if(event.key==='Escape'){const toggle=document.querySelector('[data-v1-store-menu-toggle]'),menu=document.querySelector('.v1-store-switch-menu:not([hidden])');if(menu){menu.hidden=true;toggle?.setAttribute('aria-expanded','false');toggle?.parentElement?.removeAttribute('data-menu-open');toggle?.focus();}}
  });

  document.addEventListener('click',async event=>{
    const target=event.target instanceof Element?event.target:null;if(!target)return;
    const menuToggle=target.closest('[data-v1-store-menu-toggle]');
    if(menuToggle){event.preventDefault();const menu=menuToggle.parentElement?.querySelector('.v1-store-switch-menu');if(menu){menu.hidden=!menu.hidden;menuToggle.setAttribute('aria-expanded',String(!menu.hidden));menuToggle.parentElement?.toggleAttribute('data-menu-open',!menu.hidden);if(!menu.hidden)menu.querySelector('[aria-current="true"]')?.focus();}return;}
    const option=target.closest('[data-v1-store-option]');
    if(option){event.preventDefault();const menu=option.closest('.v1-store-switch-menu');if(menu){menu.hidden=true;menu.previousElementSibling?.setAttribute('aria-expanded','false');menu.parentElement?.removeAttribute('data-menu-open');}await switchStore(option.dataset.v1StoreOption==='training');return;}
    if(target.closest('[data-v1-store-switch]')){event.preventDefault();await switchStore();return;}
    if(!target.closest('.topbar .location')){const menu=document.querySelector('.v1-store-switch-menu:not([hidden])');menu?.setAttribute('hidden','');menu?.parentElement?.removeAttribute('data-menu-open');}
    if(target.closest('[data-v1-reset-training]')){if(confirm('Reset all Training Store sandbox data?')){localStorage.removeItem('gc-training-data-v1');if(state.training){loadTraining();renderAll();}}return;}
    const filter=target.closest('[data-v1-lead-filter]');if(filter){state.leadFilter=filter.dataset.v1LeadFilter;renderLeads();return;}
    const lead=target.closest('[data-v1-lead]');if(lead){openLead(lead.dataset.v1Lead);return;}
    const cancelWork=target.closest('[data-v1-cancel-work-order]');if(cancelWork){await cancelWorkOrder(cancelWork.dataset.v1CancelWorkOrder);return;}
    const work=target.closest('[data-v1-work-order]');if(work){openWorkOrder(work.dataset.v1WorkOrder);return;}
    if(target.closest('[data-v1-close-drawer]')||target.id==='v1-drawer-backdrop'){closeDrawer();return;}
    if(target.closest('[data-v1-new-lead]')){startLead();return;}
    const cancelLead=target.closest('[data-v1-cancel-lead]');if(cancelLead){await cancelLeadRecord(cancelLead.dataset.v1CancelLead);return;}
    const convert=target.closest('[data-v1-convert-lead]');if(convert){await convertLead(convert.dataset.v1ConvertLead);return;}
    if(target.closest('[data-v1-walkin]')){event.preventDefault();openIntake();return;}
    if(target.closest('[data-v1-close-intake]')){document.getElementById('v1-intake-dialog')?.close();return;}
    const customer=target.closest('[data-v1-intake-customer]');if(customer){const record=state.customers.find(c=>c.id===customer.dataset.v1IntakeCustomer)||null;state.intake.customer=record;state.intake.newCustomer=record?{...record}:{};renderIntake();return;}
    if(target.closest('[data-v1-intake-new-device]')){state.intake.device=null;state.intake.newDevice={category:'Phone'};renderIntake();return;}
    const device=target.closest('[data-v1-intake-device]');if(device){const record=state.intake.customer?.devices?.find(d=>d.id===device.dataset.v1IntakeDevice)||null;state.intake.device=record;state.intake.newDevice=record?{...record}:{category:'Phone'};renderIntake();return;}
    const category=target.closest('[data-v1-device-category]');if(category){state.intake.newDevice.category=category.dataset.v1DeviceCategory;renderIntake();return;}
    if(target.closest('[data-v1-intake-prev]')){state.intake.step=Math.max(0,state.intake.step-1);renderIntake();return;}
    if(target.closest('[data-v1-intake-next]')){if(!validStep())return alert('Complete the required fields before continuing.');state.intake.step=Math.min(4,state.intake.step+1);if(state.intake.step===1&&!state.intake.customer){const q=state.intake.search;if(q.includes('@'))state.intake.newCustomer.email=q;else state.intake.newCustomer.phone=q;}renderIntake();return;}
    if(target.closest('[data-v1-intake-create]')){if(!validStep())return alert('Complete the required fields first.');await createFromIntake();return;}
    const add=target.closest('[data-v1-add-line]');if(add){const [type,id]=add.dataset.v1AddLine.split(':');await addLine(type,id);return;}
    const remove=target.closest('[data-v1-remove-line]');if(remove){await removeLine(remove.dataset.v1RemoveLine);return;}
    const damage=target.closest('[data-v1-damage-line]');if(damage){await damageLine(damage.dataset.v1DamageLine);return;}
    const print=target.closest('[data-v1-print-ticket]');if(print){const ticket=state.workOrders.find(t=>t.id===print.dataset.v1PrintTicket);if(ticket)printTicketLabel(ticket);return;}
    if(target.closest('[data-v1-toggle-workflow]')){document.getElementById('v1-workorder-layout')?.classList.toggle('drawer-collapsed');return;}
    if(target.closest('[data-v1-new-po]')){openPO();return;}
    const open=target.closest('[data-v1-open-po]');if(open){openPO(state.purchaseOrders.find(po=>po.id===open.dataset.v1OpenPo));return;}
    if(target.closest('[data-v1-close-po]')){document.getElementById('v1-po-dialog')?.close();return;}
    const receive=target.closest('[data-v1-receive-one]');if(receive){const input=document.querySelector(`[name="receive_${CSS.escape(receive.dataset.v1ReceiveOne)}"]`);await receivePOItem(receive.dataset.v1ReceiveOne,input?.value||0);return;}
    const addPo=target.closest('[data-v1-add-po-line]');if(addPo){await addPOLine(addPo.dataset.v1AddPoLine);return;}
  },true);

  document.addEventListener('submit',async event=>{
    if(event.target.id==='v1-lead-update'){event.preventDefault();await updateLead(event.target);}
    else if(event.target.id==='v1-lead-appointment'){event.preventDefault();await scheduleLead(event.target);}
    else if(event.target.id==='v1-workflow-form'){event.preventDefault();await updateWorkflow(event.target);}
    else if(event.target.id==='v1-checkout-form'){event.preventDefault();await checkout(event.target);}
    else if(event.target.id==='v1-po-form'){event.preventDefault();await savePO(event.target);}
  });
  document.addEventListener('change',async event=>{
    const input=event.target.closest('[data-v1-permission]');if(!input)return;const value=input.dataset.v1Permission,index=value.indexOf(':');await setPermission(value.slice(0,index),value.slice(index+1),input.checked,input);
  });

  window.addEventListener('gc-view-changed',event=>{
    if(event.detail==='dashboard')renderDashboard();
    if(event.detail==='repairs')renderRepairs();
    if(event.detail==='leads')renderLeads();
    if(event.detail==='ready-pickup')renderReady();
    if(event.detail==='repair-reference')renderReference();
    if(event.detail==='purchasing')renderPurchasing();
    if(event.detail==='staff')renderPermissions();
    if(event.detail==='settings')renderTrainingSettings();
  });
  window.addEventListener('gc-staff-profiles-loaded',()=>renderPermissions());

  let realtimeChannel=null,realtimeReloadTimer=null,realtimeReloading=false,realtimeReloadQueued=false,realtimeSubscribed=false,realtimeRetryTimer=null;
  function queueRealtimeReload(){
    clearTimeout(realtimeReloadTimer);
    realtimeReloadTimer=setTimeout(async()=>{
      if(state.training)return;
      if(realtimeReloading){realtimeReloadQueued=true;return;}
      realtimeReloading=true;
      try{await reload();window.GotCrackedDirectory?.requestRefresh?.();if(state.currentWorkOrder?.id&&document.getElementById('work-order')?.classList.contains('active-view'))openWorkOrder(state.currentWorkOrder.id);}
      finally{realtimeReloading=false;if(realtimeReloadQueued){realtimeReloadQueued=false;queueRealtimeReload();}}
    },180);
  }
  async function subscribeRealtime(){
    if(realtimeChannel||state.training)return;
    const {data:{session}}=await client.auth.getSession();
    if(!session?.access_token)return;
    await client.realtime.setAuth(session.access_token);
    const tables=['leads','appointments','repair_tickets','customers','devices','intake_sessions','work_order_items','ticket_events','purchase_orders','purchase_order_items'];
    realtimeChannel=client.channel(`portal-v1-operations-${state.profile.location_id}`);
    tables.forEach(table=>realtimeChannel.on('postgres_changes',{event:'*',schema:'public',table},queueRealtimeReload));
    realtimeChannel.subscribe(status=>{
      realtimeSubscribed=status==='SUBSCRIBED';
      if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED'){
        console.warn('Portal realtime is reconnecting:',status);
        clearTimeout(realtimeRetryTimer);
        realtimeRetryTimer=setTimeout(async()=>{const old=realtimeChannel;realtimeChannel=null;if(old)await client.removeChannel(old);subscribeRealtime();},2500);
      }
    });
  }

  // Realtime is primary. This low-frequency authoritative refresh is a safety
  // net for sleeping laptops, network transitions, and browser websocket loss.
  setInterval(()=>{if(!state.training&&document.visibilityState==='visible'&&!document.querySelector('dialog[open]')&&!document.activeElement?.closest('form'))queueRealtimeReload();},15000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')queueRealtimeReload();});
  window.addEventListener('online',()=>{queueRealtimeReload();if(!realtimeSubscribed)subscribeRealtime();});

  async function start(){
    if(!(await initProfile()))return;
    ensureShell();await reload();subscribeRealtime();
    if(!state.migrationReady&&!state.training){const heading=document.querySelector('#dashboard .page-heading');if(heading&&!document.querySelector('.v1-migration-warning'))heading.insertAdjacentHTML('afterend','<div class="card v1-migration-warning"><strong>Portal 1.0 database upgrade pending.</strong><p>Apply Supabase migrations 0002 and 0003 before using new production intake, lead, purchasing, reference, and permission features. Training Store remains isolated and safe to use.</p></div>');}
    window.GotCrackedOperationsV1={reload,openWorkOrder,openIntake,printTicketLabel,printInventoryLabel,renderPermissions,state};
  }

  client.auth.onAuthStateChange(event=>{if(['SIGNED_IN','INITIAL_SESSION'].includes(event))setTimeout(start,900);});
  setTimeout(start,1400);
})();