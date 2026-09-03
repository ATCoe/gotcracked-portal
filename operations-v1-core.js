(() => {
  'use strict';

  const client = window.supabaseClient;
  if (!client) return;

  const VERSION = '20260825-v1ops4';
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
      if(!document.getElementById('v1-store-menu-style')){const style=document.createElement('style');style.id='v1-store-menu-style';style.textContent='.topbar .location{position:relative}.v1-store-switch{display:flex;align-items:center;gap:8px}.v1-store-switch-menu{position:absolute;top:calc(100% + 8px);left:0;z-index:30;min-width:220px;padding:6px;border:1px solid rgba(148,163,184,.28);border-radius:12px;background:#101d2b;box-shadow:0 18px 40px rgba(0,0,0,.3)}.v1-store-switch-menu[hidden]{display:none}.v1-store-option{display:flex;width:100%;align-items:center;gap:9px;padding:10px;border:0;border-radius:8px;background:transparent;color:#e5eef7;text-align:left;cursor:pointer}.v1-store-option:hover,.v1-store-option:focus-visible{background:rgba(59,130,246,.18)}.v1-store-option[aria-current="true"]{background:rgba(45,212,191,.12)}.v1-store-option small{display:block;color:#93a8bb;margin-top:2px}';document.head.appendChild(style);}
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
    return items.map(lead=>{const stage=leadStage(lead);return `<tr data-v1-lead="${lead.id}"><td><strong>${esc(lead.name||'Unknown customer')}</strong><small>${esc(lead.phone||lead.email||'No contact')}</small></td><td><strong>${esc([lead.manufacturer,lead.model].filter(Boolean).join(' ')||lead.device_category||lead.service||'Repair inquiry')}</strong><small>${esc(lead.customer_issue||lead.service||lead.notes||'')}</small></td><td>${pill(stage,leadLabel(stage))}</td><td>${lead.contact_attempted_at?new Date(lead.contact_attempted_at).toLocaleString():'No attempt'}</td><td>${new Date(lead.created_at).toLocaleString()}</td></tr>`;}).join('');
  }

  function renderDashboard(){
    if(!can('dashboard.view'))return;
    const host=document.querySelector('#dashboard .content-grid');if(!host)return;
    host.className='v1-dashboard-grid';
    const active=state.workOrders.filter(t=>!TERMINAL.has(t.status));
    host.innerHTML=`<article class="v1-ops-card"><div class="v1-ops-card-head"><div><h2>Work Orders</h2><p>One searchable table for the shop.</p></div><div class="v1-table-tools"><input id="v1-dash-work-search" placeholder="Search work orders"><select id="v1-dash-work-status"><option value="active">Active</option><option value="all">All</option><option value="ready">Ready for pickup</option></select></div></div><div class="v1-table-wrap"><table class="v1-table"><thead><tr><th>Work order</th><th>Customer</th><th>Device / issue</th><th>Status</th><th>Tech</th></tr></thead><tbody id="v1-dash-work-body">${workRows(active)}</tbody></table></div></article>${can('leads.view')?`<article class="v1-ops-card"><div class="v1-ops-card-head"><div><h2>Leads</h2><p>Contact, qualify, and move customers toward intake.</p></div><div class="v1-table-tools"><input id="v1-dash-lead-search" placeholder="Search leads"><select id="v1-dash-lead-status"><option value="all">All statuses</option>${LEAD_STAGES.map(s=>`<option value="${s}">${leadLabel(s)}</option>`).join('')}</select></div></div><div class="v1-table-wrap"><table class="v1-table"><thead><tr><th>Customer</th><th>Device / issue</th><th>Status</th><th>Last contact</th><th>Created</th></tr></thead><tbody id="v1-dash-lead-body">${leadRows(state.leads)}</tbody></table></div></article>`:''}`;
    const greeting=document.querySelector('#dashboard .page-heading h1');if(greeting)greeting.textContent=`Good ${new Date().getHours()<12?'morning':new Date().getHours()<17?'afternoon':'evening'}, ${firstName()}.`;
    const metrics=document.querySelectorAll('#dashboard .metrics article strong');
    const today=new Date().toISOString().slice(0,10);const appts=state.appointments.filter(a=>(a.preferred_date||a.starts_at||'').startsWith(today)).length;const ready=state.workOrders.filter(t=>['repaired','ready_for_pickup'].includes(t.status)).length;const sales=state.workOrders.filter(t=>['sale_complete','completed'].includes(t.status)&&(t.completed_at||t.updated_at||'').startsWith(today)).reduce((sum,t)=>sum+(t.total_cents||0),0);
    [active.length,appts,ready,money(sales)].forEach((value,index)=>{if(metrics[index])metrics[index].textContent=value;});
  }

  function redrawDashboard(){
    const q=(document.getElementById('v1-dash-work-search')?.value||'').toLowerCase();const status=document.getElementById('v1-dash-work-status')?.value||'active';let rows=state.workOrders.filter(t=>text(t.ticket_number,t.customer_issue,t.customers?.first_name,t.customers?.last_name,t.customers?.phone,t.devices?.manufacturer,t.devices?.model,t.status).includes(q));if(status==='active')rows=rows.filter(t=>!TERMINAL.has(t.status));else if(status==='ready')rows=rows.filter(t=>['repaired','ready_for_pickup'].includes(t.status));const body=document.getElementById('v1-dash-work-body');if(body)body.innerHTML=workRows(rows);
    const lq=(document.getElementById('v1-dash-lead-search')?.value||'').toLowerCase();const ls=document.getElementById('v1-dash-lead-status')?.value||'all';const leads=state.leads.filter(l=>(ls==='all'||leadStage(l)===ls)&&text(l.name,l.phone,l.email,l.device_category,l.manufacturer,l.model,l.customer_issue,l.service).includes(lq));const lbody=document.getElementById('v1-dash-lead-body');if(lbody)lbody.innerHTML=leadRows(leads);
  }

  function renderRepairs(){
    if(!can('repairs.view'))return;
    const host=document.getElementById('repairs');if(!host)return;
    host.innerHTML=`<div class="page-heading"><div><p class="eyebrow">Repair workflow</p><h1>Work Orders</h1><p class="subtle">Search the complete repair pipeline and open the technician workspace.</p></div><div class="v1-actions">${can('repairs.intake')?'<button class="secondary-button" data-v1-walkin>Walk-In</button>':''}<button class="primary-button" data-open-ticket>+ New Work Order</button></div></div><article class="v1-ops-card"><div class="v1-ops-card-head"><div><h2>Work-order table</h2><p>${state.workOrders.length} records</p></div><div class="v1-table-tools"><input id="v1-repair-search" placeholder="Search work order, customer, device, phone"><select id="v1-repair-status"><option value="active">Active</option><option value="all">All</option>${Object.entries(REPAIR_LABELS).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></div></div><div class="v1-table-wrap"><table class="v1-table"><thead><tr><th>Work order</th><th>Customer</th><th>Device / issue</th><th>Status</th><th>Tech</th></tr></thead><tbody id="v1-repair-body">${workRows(state.workOrders.filter(t=>!TERMINAL.has(t.status)))}</tbody></table></div></article>`;
  }
  function redrawRepairs(){
    const q=(document.getElementById('v1-repair-search')?.value||'').toLowerCase(),status=document.getElementById('v1-repair-status')?.value||'active';let rows=state.workOrders.filter(t=>text(t.ticket_number,t.customer_issue,t.customers?.first_name,t.customers?.last_name,t.customers?.phone,t.customers?.email,t.devices?.manufacturer,t.devices?.model,t.status).includes(q));rows=status==='active'?rows.filter(t=>!TERMINAL.has(t.status)):status==='all'?rows:rows.filter(t=>t.status===status);const body=document.getElementById('v1-repair-body');if(body)body.innerHTML=workRows(rows);
  }

  function renderLeads(){
    if(!can('leads.view'))return;
    const host=document.getElementById('leads');if(!host)return;
    const counts=Object.fromEntries(LEAD_STAGES.map(stage=>[stage,state.leads.filter(l=>leadStage(l)===stage).length]));
    host.innerHTML=`<div class="page-heading"><div><p class="eyebrow">Customer pipeline</p><h1>Leads</h1><p class="subtle">Every new lead starts in Need to Contact. A contact note is required before it can advance.</p></div>${can('leads.manage')?'<button class="primary-button" data-v1-new-lead>+ New Lead</button>':''}</div><div class="v1-stage-tabs"><button data-v1-lead-filter="all" class="${state.leadFilter==='all'?'active':''}">All <b>${state.leads.length}</b></button>${LEAD_STAGES.map(stage=>`<button data-v1-lead-filter="${stage}" class="${state.leadFilter===stage?'active':''}">${leadLabel(stage)} <b>${counts[stage]}</b></button>`).join('')}</div><article class="v1-ops-card"><div class="v1-ops-card-head"><div><h2>${state.leadFilter==='all'?'All leads':leadLabel(state.leadFilter)}</h2><p>Click a lead to open its workflow drawer.</p></div><div class="v1-table-tools"><input id="v1-lead-search" placeholder="Search name, contact, device, issue"></div></div><div class="v1-table-wrap"><table class="v1-table"><thead><tr><th>Customer</th><th>Device / issue</th><th>Status</th><th>Last contact</th><th>Created</th></tr></thead><tbody id="v1-lead-body"></tbody></table></div></article>`;
    redrawLeads();
    const badge=document.getElementById('lead-count');const active=state.leads.filter(l=>!['converted','lost'].includes(leadStage(l))).length;if(badge){badge.textContent=active;badge.hidden=!active;}
  }
  function redrawLeads(){const q=(document.getElementById('v1-lead-search')?.value||'').toLowerCase();const rows=state.leads.filter(l=>(state.leadFilter==='all'||leadStage(l)===state.leadFilter)&&text(l.name,l.phone,l.email,l.device_category,l.manufacturer,l.model,l.customer_issue,l.service,l.notes).includes(q));const body=document.getElementById('v1-lead-body');if(body)body.innerHTML=leadRows(rows);}

  async function openLead(id){
    const lead=state.leads.find(l=>l.id===id);if(!lead)return;
    let events=lead._events||[];
    if(!state.training){const result=await client.from('lead_events').select('*,profiles:actor_user_id(display_name)').eq('lead_id',id).order('created_at',{ascending:false});if(!result.error)events=result.data||[];}
    const stage=leadStage(lead);const drawer=document.getElementById('v1-lead-drawer');const content=document.getElementById('v1-lead-drawer-content');
    const canConvert=stage!=='converted'&&stage!=='lost'&&(stage!=='need_to_contact'||Boolean(lead.contact_attempted_at));
    content.innerHTML=`<div class="v1-drawer-head"><div><p class="v1-kicker">Lead workflow</p><h2>${esc(lead.name||'Lead')}</h2>${pill(stage,leadLabel(stage))}</div><button class="icon-button" type="button" data-v1-close-drawer>×</button></div><div class="v1-drawer-body"><section class="v1-drawer-section"><h3>Lead details</h3><p><strong>Contact</strong><br>${esc(lead.phone||lead.email||'Not supplied')}</p><p><strong>Device</strong><br>${esc([lead.manufacturer,lead.model].filter(Boolean).join(' ')||lead.device_category||lead.device_model||'Not identified')}</p><p><strong>Issue</strong><br>${esc(lead.customer_issue||lead.service||lead.notes||'Not recorded')}</p><p><strong>Source</strong><br>${esc(lead.source||'Portal')}</p></section>${can('leads.manage')?`<form id="v1-lead-appointment" class="v1-drawer-section v1-form"><h3>${lead.appointment_id?'Reschedule appointment':'Schedule appointment'}</h3><div class="v1-form-grid"><label>Appointment date<input name="date" type="date" value="${esc(lead.preferred_date||'')}" required></label><label>Time<input name="time" type="time" value="${/^\d\d:\d\d/.test(lead.preferred_time||'')?esc(lead.preferred_time.slice(0,5)):''}" required></label><label class="full">Service / purpose<input name="service" value="${esc(lead.customer_issue||lead.service||'Repair consultation')}" required></label><label class="full">Scheduling note<textarea name="note" placeholder="Confirmed with customer, arrival instructions, etc."></textarea></label></div><input type="hidden" name="lead_id" value="${lead.id}"><button class="primary-button">${lead.appointment_id?'Update appointment':'Schedule appointment'}</button><p class="operation-status"></p></form><form id="v1-lead-update" class="v1-drawer-section v1-form"><h3>Move lead forward</h3>${stage==='need_to_contact'?'<div class="v1-required-note">A contact attempt and note are required before this lead can leave Need to Contact.</div>':''}<label>Next stage<select name="status">${LEAD_STAGES.map(s=>`<option value="${s}" ${s===stage?'selected':''}>${leadLabel(s)}</option>`).join('')}</select></label>${stage==='need_to_contact'?'<label>Contact attempt made<select name="contact_attempt"><option value="false">No</option><option value="true">Yes — contacted or attempted</option></select></label>':''}<label>Required activity note<textarea name="note" required placeholder="Called customer, confirmed issue, voicemail left, parts discussed, etc."></textarea></label><input type="hidden" name="lead_id" value="${lead.id}"><button class="primary-button">Save update</button><p class="operation-status"></p></form>${canConvert?`<button class="secondary-button" type="button" data-v1-convert-lead="${lead.id}">Create Pending Work Order</button>`:''}`:''}<section class="v1-drawer-section"><h3>Activity</h3>${events.length?events.map(event=>`<div class="v1-event"><span class="v1-event-dot"></span><div><strong>${esc(friendly(event.event_type||'activity'))}</strong><small>${new Date(event.created_at).toLocaleString()} · ${esc(event.profiles?.display_name||'Staff')}</small><p>${esc(event.message||'')}</p></div></div>`).join(''):'<p>No activity yet.</p>'}</section></div>`;
    drawer.classList.add('open');document.getElementById('v1-drawer-backdrop').hidden=false;
  }
  function closeDrawer(){document.getElementById('v1-lead-drawer')?.classList.remove('open');const backdrop=document.getElementById('v1-drawer-backdrop');if(backdrop)backdrop.hidden=true;}

  function setStatus(form,message,isError=false){const status=form.querySelector('.operation-status');if(status){status.textContent=message;status.classList.toggle('v1-error',isError);status.classList.toggle('v1-success',!isError);}if(isError){const contexts={"v1-workflow-form":'Failure to create work order note',"v1-checkout-form":'Failure to complete checkout',"v1-po-form":'Failure to save purchase order'};window.GotCrackedDiagnostics?.error(message,{context:contexts[form.id]||'Portal operation failed'});}}
  async function updateLead(form){
    const data=Object.fromEntries(new FormData(form));const lead=state.leads.find(l=>l.id===data.lead_id);if(!lead)return;const current=leadStage(lead);if(!data.note?.trim())return setStatus(form,'A lead activity note is required.',true);if(current==='need_to_contact'&&data.status!=='need_to_contact'&&data.contact_attempt!=='true'&&!lead.contact_attempted_at)return setStatus(form,'Record a contact attempt before moving this lead forward.',true);
    if(state.training){lead.pipeline_status=data.status;lead.status=data.status==='converted'?'won':data.status==='lost'?'lost':data.status==='need_to_contact'?'new':'qualified';lead.updated_at=now();if(data.contact_attempt==='true')lead.contact_attempted_at=now();lead.last_contact_note=data.note.trim();lead._events=lead._events||[];lead._events.unshift({id:uid('event'),event_type:data.contact_attempt==='true'?'contact_attempt':'status_changed',message:data.note.trim(),created_at:now(),profiles:{display_name:state.profile.display_name}});saveTraining();closeDrawer();renderAll();return;}
    const result=await client.rpc('advance_lead_status',{target_lead:data.lead_id,next_status:data.status,update_note:data.note.trim(),contact_attempt:data.contact_attempt==='true'});if(result.error)return setStatus(form,result.error.message,true);closeDrawer();await reload();
  }

  async function scheduleLead(form){
    const data=Object.fromEntries(new FormData(form)),lead=state.leads.find(item=>item.id===data.lead_id);if(!lead)return;
    if(!data.date||!data.time||!data.service?.trim())return setStatus(form,'Date, time, and service are required.',true);
    const startsAt=new Date(`${data.date}T${data.time}:00`).toISOString();
    if(state.training){
      const appointment=state.appointments.find(item=>item.id===lead.appointment_id)||{id:uid('appointment'),created_at:now()};
      Object.assign(appointment,{lead_id:lead.id,customer_name:lead.name,preferred_date:data.date,preferred_time:data.time,starts_at:startsAt,device_description:[lead.manufacturer,lead.model].filter(Boolean).join(' ')||lead.device_model||lead.device_category||'Device',service_requested:data.service.trim(),status:'scheduled',notes:data.note?.trim()||null});
      if(!state.appointments.includes(appointment))state.appointments.unshift(appointment);lead.appointment_id=appointment.id;lead.preferred_date=data.date;lead.preferred_time=data.time;lead.expected_arrival_at=startsAt;lead._events=lead._events||[];lead._events.unshift({id:uid('event'),event_type:'appointment_scheduled',message:`Appointment scheduled for ${data.date} at ${data.time}. ${data.note||''}`.trim(),created_at:now(),profiles:{display_name:state.profile.display_name}});saveTraining();closeDrawer();renderAll();return;
    }
    const record={location_id:state.profile.location_id,lead_id:lead.id,customer_id:lead.customer_id||null,device_description:[lead.manufacturer,lead.model].filter(Boolean).join(' ')||lead.device_model||lead.device_category||'Device',service_requested:data.service.trim(),preferred_date:data.date,preferred_time:data.time,starts_at:startsAt,service_mode:'walk_in',status:'scheduled',notes:data.note?.trim()||'Scheduled from lead workflow'};
    const result=lead.appointment_id?await client.from('appointments').update(record).eq('id',lead.appointment_id).select().single():await client.from('appointments').insert(record).select().single();
    if(result.error)return setStatus(form,result.error.message,true);
    const leadUpdate=await client.from('leads').update({appointment_id:result.data.id,preferred_date:data.date,preferred_time:data.time,expected_arrival_at:startsAt,updated_at:now()}).eq('id',lead.id);
    if(leadUpdate.error)return setStatus(form,leadUpdate.error.message,true);
    await client.from('lead_events').insert({lead_id:lead.id,actor_user_id:state.profile.id,event_type:'appointment_scheduled',message:`Appointment scheduled for ${new Date(startsAt).toLocaleString()}. ${data.note||''}`.trim()});
    closeDrawer();await reload();
  }

  async function convertLead(id){
    const lead=state.leads.find(l=>l.id===id);if(!lead)return;
    if(leadStage(lead)==='need_to_contact'&&!lead.contact_attempted_at){alert('Record a contact attempt before converting this lead.');return;}
    if(state.training){
      let customer=state.customers.find(c=>digits(c.phone)===digits(lead.phone)||(lead.email&&String(c.email||'').toLowerCase()===String(lead.email).toLowerCase()));
      if(!customer){const names=String(lead.name||'Training Customer').trim().split(/\s+/);const last=names.length>1?names.pop():'Customer';customer={id:uid('customer'),location_id:'training',first_name:names.join(' ')||'Training',last_name:last,phone:lead.phone||'(555) 010-0000',phone_normalized:digits(lead.phone),contact_phone:lead.phone||'(555) 010-0000',email:lead.email||'training@example.test',address_line_1:'Training address required at intake',city:'Training City',state:'VA',postal_code:'00000',devices:[]};state.customers.unshift(customer);}
      let device=(customer.devices||[]).find(d=>String(d.manufacturer||'').toLowerCase()===String(lead.manufacturer||'').toLowerCase()&&String(d.model||'').toLowerCase()===String(lead.model||'').toLowerCase());
      if(!device){device={id:uid('device'),customer_id:customer.id,category:lead.device_category||'Other',manufacturer:lead.manufacturer||null,model:lead.model||'Unspecified device',device_condition:'Fair',last_seen_at:now()};customer.devices=customer.devices||[];customer.devices.push(device);}
      const ticket={id:uid('ticket'),ticket_number:900000+state.workOrders.length+2,location_id:'training',customer_id:customer.id,device_id:device.id,status:'awaiting_customer',customer_issue:lead.customer_issue||lead.service||'Repair inquiry',lead_id:lead.id,created_at:now(),updated_at:now(),customers:{...customer},devices:{...device},profiles:null,work_order_items:[],ticket_events:[]};state.workOrders.unshift(ticket);lead.pipeline_status='converted';lead.status='won';lead.converted_ticket_id=ticket.id;saveTraining();closeDrawer();renderAll();openWorkOrder(ticket.id);return;
    }
    let customer=null;const phone=digits(lead.phone);
    if(phone){const result=await client.from('customers').select('*').eq('phone_normalized',phone).maybeSingle();if(!result.error)customer=result.data;}
    if(!customer&&lead.email){const result=await client.from('customers').select('*').ilike('email',lead.email).maybeSingle();if(!result.error)customer=result.data;}
    if(!customer){const names=String(lead.name||'Customer').trim().split(/\s+/);const last=names.length>1?names.pop():'Customer';const result=await client.from('customers').insert({location_id:state.profile.location_id,first_name:names.join(' ')||'Customer',last_name:last,phone:lead.phone||'',phone_normalized:phone,contact_phone:lead.phone||'',email:lead.email||null}).select().single();if(result.error)return alert(result.error.message);customer=result.data;}
    let device=null;const existingDevices=await client.from('devices').select('*').eq('customer_id',customer.id);if(!existingDevices.error)device=(existingDevices.data||[]).find(d=>String(d.manufacturer||'').toLowerCase()===String(lead.manufacturer||'').toLowerCase()&&String(d.model||'').toLowerCase()===String(lead.model||'').toLowerCase());
    if(!device){const result=await client.from('devices').insert({customer_id:customer.id,category:lead.device_category||'Other',manufacturer:lead.manufacturer||null,model:lead.model||'Unspecified device',last_seen_at:now()}).select().single();if(result.error)return alert(result.error.message);device=result.data;}
    const ticketResult=await client.from('repair_tickets').insert({location_id:state.profile.location_id,customer_id:customer.id,device_id:device.id,status:'awaiting_customer',customer_issue:lead.customer_issue||lead.service||'Repair inquiry',lead_id:lead.id,intake_method:'walk_in'}).select().single();if(ticketResult.error)return alert(ticketResult.error.message);
    await client.from('leads').update({pipeline_status:'converted',status:'won',customer_id:customer.id,device_id:device.id,converted_ticket_id:ticketResult.data.id,updated_at:now()}).eq('id',lead.id);
    await client.from('lead_events').insert({lead_id:lead.id,actor_user_id:state.profile.id,event_type:'converted',message:`Converted to ${ticketCode(ticketResult.data.ticket_number)} · Awaiting Customer`});
    closeDrawer();await reload();openWorkOrder(ticketResult.data.id);
  }

  function renderReady(){
    if(!can('ready_pickup.view'))return;
    const host=document.getElementById('ready-pickup');if(!host)return;const rows=state.workOrders.filter(t=>['repaired','ready_for_pickup'].includes(t.status));
    host.innerHTML=`<div class="page-heading"><div><p class="eyebrow">Front counter</p><h1>Ready for Pickup</h1><p class="subtle">Scan the work-order label or choose a completed device from the list.</p></div></div><article class="v1-ops-card"><div class="v1-ops-card-head"><div><h2>Pickup queue</h2><p>${rows.length} device${rows.length===1?'':'s'} waiting</p></div><div class="v1-table-tools"><input id="v1-pickup-scan" autocomplete="off" placeholder="Scan GC work-order barcode"></div></div><div class="v1-table-wrap"><table class="v1-table"><thead><tr><th>Work order</th><th>Customer</th><th>Device</th><th>Ready since</th><th>Balance</th></tr></thead><tbody>${rows.map(t=>`<tr data-v1-work-order="${t.id}"><td><strong>${ticketCode(t.ticket_number)}</strong></td><td><strong>${esc(`${t.customers?.first_name||''} ${t.customers?.last_name||''}`.trim())}</strong><small>${esc(t.customers?.phone||'')}</small></td><td>${esc([t.devices?.manufacturer,t.devices?.model].filter(Boolean).join(' ')||'Device')}</td><td>${new Date(t.ready_for_pickup_at||t.updated_at||t.created_at).toLocaleString()}</td><td>${money(t.total_cents||0)}</td></tr>`).join('')||'<tr><td colspan="5">No devices are ready for pickup.</td></tr>'}</tbody></table></div></article>`;
  }

  function renderReference(){
    if(!can('reference.view'))return;const host=document.getElementById('repair-reference');if(!host)return;
    host.innerHTML=`<div class="page-heading"><div><p class="eyebrow">Internal knowledge</p><h1>Repair Reference</h1><p class="subtle">Staff-only diagnostic and repair reference. Not customer-facing.</p></div></div><div class="v1-reference-search"><input id="v1-guide-search" placeholder="Search PS5 HDMI, battery drain, cracked screen, no power..."></div><div id="v1-guide-grid" class="v1-guide-grid"></div>`;redrawGuides();
  }
  function redrawGuides(){const q=(document.getElementById('v1-guide-search')?.value||'').toLowerCase();const guides=state.guides.filter(g=>text(g.title,g.device_category,g.manufacturer,g.model_family,g.symptom,g.summary,g.tags||[],g.likely_causes||[]).includes(q));const grid=document.getElementById('v1-guide-grid');if(grid)grid.innerHTML=guides.map(g=>`<details class="v1-guide"><summary><strong>${esc(g.title)}</strong><small>${esc(g.device_category||'All devices')} · ${esc(g.symptom||'Reference')}</small><div class="v1-guide-tags">${(g.tags||[]).map(tag=>`<span>${esc(tag)}</span>`).join('')}</div></summary><div class="v1-guide-body"><p>${esc(g.summary||'')}</p><h4>Likely causes</h4><ul>${(g.likely_causes||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul><h4>Diagnostic reference</h4><ol>${(g.diagnostic_steps||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ol>${g.tools_notes?`<h4>Tools / bench notes</h4><p>${esc(g.tools_notes)}</p>`:''}${g.parts_notes?`<h4>Parts notes</h4><p>${esc(g.parts_notes)}</p>`:''}${g.cautions?`<h4>Cautions</h4><p>${esc(g.cautions)}</p>`:''}</div></details>`).join('')||'<p class="empty-state">No matching guides.</p>';}

  function poLabel(po){return `PO-${String(po.po_number||po.id).replace(/\D/g,'').slice(-6).padStart(6,'0')}`;}
  function poStatus(v){return ({draft:'Draft',ordered:'Ordered',partial:'Partially Received',received:'Received',cancelled:'Cancelled'})[v]||friendly(v);}
  function renderPurchasing(){
    if(!can('purchasing.view'))return;const host=document.getElementById('purchasing');if(!host)return;
    host.innerHTML=`<div class="page-heading"><div><p class="eyebrow">Purchasing</p><h1>Purchase Orders</h1><p class="subtle">Document MobileSentrix, Amazon, and other orders, receive stock, and print DYMO labels.</p></div>${can('purchasing.manage')?'<button class="primary-button" data-v1-new-po>+ New PO</button>':''}</div><article class="v1-ops-card"><div class="v1-table-wrap"><table class="v1-table"><thead><tr><th>PO</th><th>Supplier</th><th>External order</th><th>Status</th><th>Ordered</th><th></th></tr></thead><tbody>${state.purchaseOrders.map(po=>`<tr><td><strong>${poLabel(po)}</strong></td><td>${esc(po.supplier_name)}</td><td>${esc(po.external_order_number||'—')}</td><td>${pill(po.status,poStatus(po.status))}</td><td>${po.ordered_at?new Date(po.ordered_at).toLocaleDateString():'Draft'}</td><td><button class="secondary-button" data-v1-open-po="${po.id}">Open / receive</button></td></tr>`).join('')||'<tr><td colspan="6">No purchase orders yet.</td></tr>'}</tbody></table></div></article>`;
  }

  function openPO(po=null){
    const dialog=document.getElementById('v1-po-dialog');const content=document.getElementById('v1-po-content');const lines=po?state.poItems.filter(i=>i.purchase_order_id===po.id):[];
    if(!po){
      content.innerHTML=`<div class="v1-intake-head"><div><p class="v1-kicker">Purchasing</p><h2>Create Purchase Order</h2></div><button type="button" class="icon-button" data-v1-close-po>×</button></div><div class="v1-intake-body"><input type="hidden" name="mode" value="create"><div class="v1-form-grid"><label>Supplier<select name="supplier_name" required><option value="">Choose supplier</option>${[...new Set(['MobileSentrix','Amazon',...state.suppliers.map(s=>s.name)])].map(name=>`<option>${esc(name)}</option>`).join('')}</select></label><label>External order #<input name="external_order_number" placeholder="Supplier/Amazon order number"></label><label class="full">First part<select name="inventory_item_id" required><option value="">Choose inventory item</option>${state.inventory.map(i=>`<option value="${i.id}">${esc(i.sku||'NO SKU')} · ${esc(i.name)}</option>`).join('')}</select></label><label>Quantity ordered<input name="quantity_ordered" type="number" min="1" value="1" required></label><label>Unit cost<input name="unit_cost" type="number" min="0" step="0.01"></label><label class="full">PO notes<textarea name="notes"></textarea></label></div></div><div class="v1-intake-actions"><span></span><button class="primary-button">Create PO</button></div>`;
    } else {
      content.innerHTML=`<div class="v1-intake-head"><div><p class="v1-kicker">Purchase order</p><h2>${poLabel(po)} · ${esc(po.supplier_name)}</h2></div><button type="button" class="icon-button" data-v1-close-po>×</button></div><div class="v1-intake-body"><input type="hidden" name="mode" value="view"><input type="hidden" name="po_id" value="${po.id}"><p><strong>External order:</strong> ${esc(po.external_order_number||'Not recorded')} · ${poStatus(po.status)}</p><div class="v1-po-lines">${lines.map(line=>{const open=Math.max(0,line.quantity_ordered-line.quantity_received),pct=Math.min(100,Math.round((line.quantity_received/line.quantity_ordered)*100));return `<div class="v1-po-line"><div><strong>${esc(line.inventory_items?.name||line.description)}</strong><small>${esc(line.inventory_items?.sku||line.supplier_sku||'')}</small><div class="v1-receive-progress"><i style="width:${pct}%"></i></div><small>${line.quantity_received}/${line.quantity_ordered} received</small></div><input name="receive_${line.id}" type="number" min="0" max="${open}" value="0" aria-label="Quantity to receive"><span>${open} open</span>${open&&can('purchasing.manage')?`<button type="button" class="secondary-button" data-v1-receive-one="${line.id}">Receive</button>`:'<span>Complete</span>'}</div>`;}).join('')||'<p>No PO lines.</p>'}</div>${can('purchasing.manage')&&po.status!=='received'&&po.status!=='cancelled'?`<section class="v1-po-add-line"><h3>Add another PO item</h3><div class="v1-form-grid"><label class="full">Part<select id="v1-po-add-part"><option value="">Choose inventory item</option>${state.inventory.map(i=>`<option value="${i.id}">${esc(i.sku||'NO SKU')} · ${esc(i.name)}</option>`).join('')}</select></label><label>Quantity<input id="v1-po-add-qty" type="number" min="1" value="1"></label><label>Unit cost<input id="v1-po-add-cost" type="number" min="0" step="0.01"></label></div><button type="button" class="secondary-button" data-v1-add-po-line="${po.id}">Add item</button></section>`:''}</div><div class="v1-intake-actions"><button type="button" class="secondary-button" data-v1-close-po>Close</button><span></span></div>`;
    }
    dialog.showModal();
  }

  async function savePO(form){
    const data=Object.fromEntries(new FormData(form));if(data.mode!=='create')return;const inv=state.inventory.find(i=>i.id===data.inventory_item_id);if(!inv)return;
    if(state.training){const po={id:uid('po'),po_number:800000+state.purchaseOrders.length+1,location_id:'training',supplier_name:data.supplier_name,external_order_number:data.external_order_number||null,status:'ordered',ordered_at:now(),notes:data.notes||'',created_at:now(),updated_at:now()};state.purchaseOrders.unshift(po);state.poItems.push({id:uid('poitem'),purchase_order_id:po.id,inventory_item_id:inv.id,description:inv.name,supplier_sku:inv.supplier_sku||null,quantity_ordered:Number(data.quantity_ordered),quantity_received:0,unit_cost_cents:Math.round(Number(data.unit_cost||0)*100),label_printed_qty:0,inventory_items:{name:inv.name,sku:inv.sku,sell_price_cents:inv.sell_price_cents,quantity_on_hand:inv.quantity_on_hand}});saveTraining();form.closest('dialog').close();renderPurchasing();return;}
    const poResult=await client.from('purchase_orders').insert({location_id:state.profile.location_id,supplier_name:data.supplier_name,external_order_number:data.external_order_number||null,status:'ordered',ordered_at:now(),notes:data.notes||null,created_by:state.profile.id}).select().single();if(poResult.error)return alert(poResult.error.message);const lineResult=await client.from('purchase_order_items').insert({purchase_order_id:poResult.data.id,inventory_item_id:inv.id,supplier_sku:inv.supplier_sku||null,description:inv.name,quantity_ordered:Number(data.quantity_ordered),unit_cost_cents:Math.round(Number(data.unit_cost||0)*100)});if(lineResult.error)return alert(lineResult.error.message);form.closest('dialog').close();await reload();
  }

  async function addPOLine(poId){
    const partId=document.getElementById('v1-po-add-part')?.value,qty=Number(document.getElementById('v1-po-add-qty')?.value||0),cost=Math.round(Number(document.getElementById('v1-po-add-cost')?.value||0)*100);const inv=state.inventory.find(i=>i.id===partId);if(!inv||qty<1)return alert('Choose a part and quantity.');
    if(state.training){state.poItems.push({id:uid('poitem'),purchase_order_id:poId,inventory_item_id:inv.id,description:inv.name,supplier_sku:inv.supplier_sku||null,quantity_ordered:qty,quantity_received:0,unit_cost_cents:cost,label_printed_qty:0,inventory_items:{name:inv.name,sku:inv.sku,sell_price_cents:inv.sell_price_cents,quantity_on_hand:inv.quantity_on_hand}});saveTraining();openPO(state.purchaseOrders.find(p=>p.id===poId));return;}
    const result=await client.from('purchase_order_items').insert({purchase_order_id:poId,inventory_item_id:inv.id,supplier_sku:inv.supplier_sku||null,description:inv.name,quantity_ordered:qty,unit_cost_cents:cost});if(result.error)return alert(result.error.message);await reload();openPO(state.purchaseOrders.find(p=>p.id===poId));
  }

  async function receivePOItem(id,qty){
    qty=Number(qty);if(!qty||qty<1)return;const line=state.poItems.find(i=>i.id===id);if(!line)return;
    if(state.training){const inv=state.inventory.find(i=>i.id===line.inventory_item_id);line.quantity_received+=qty;if(inv){inv.quantity_on_hand+=qty;if(line.unit_cost_cents)inv.cost_cents=line.unit_cost_cents;}const po=state.purchaseOrders.find(p=>p.id===line.purchase_order_id);const lines=state.poItems.filter(i=>i.purchase_order_id===po.id);po.status=lines.every(i=>i.quantity_received>=i.quantity_ordered)?'received':'partial';if(po.status==='received')po.received_at=now();saveTraining();if(inv&&confirm(`${qty} ${inv.name} received. Print DYMO SKU label${qty===1?'':'s'} now?`))printInventoryLabel(inv,qty);renderPurchasing();openPO(po);return;}
    const result=await client.rpc('receive_purchase_order_item',{target_item:id,receive_quantity:qty});if(result.error)return alert(result.error.message);const inv=state.inventory.find(i=>i.id===result.data?.inventory_item_id);if(inv&&confirm(`${qty} ${inv.name} received. Print DYMO SKU label${qty===1?'':'s'} now?`))printInventoryLabel(inv,qty);const poId=line.purchase_order_id;await reload();openPO(state.purchaseOrders.find(p=>p.id===poId));
  }

  function renderPermissions(){
    if(!can('staff.manage'))return;const host=document.getElementById('staff');if(!host)return;let panel=document.getElementById('v1-permission-panel');if(!panel){panel=document.createElement('article');panel.id='v1-permission-panel';panel.className='card';host.appendChild(panel);}const overrideMap=new Map(state.overrides.map(o=>[`${o.profile_id}:${o.permission_key}`,o.enabled]));
    const staff=state.staff.length?state.staff:(window.GotCrackedStaffProfiles?.state?.profiles||[]);
    panel.innerHTML=`<div class="card-title"><div><h2>User permissions</h2><p>Role defaults apply automatically. Management can override individual permissions; owner access is always full.</p></div></div><div class="v1-permissions">${staff.map(member=>{const locked=member.role==='owner'||(state.profile.role==='manager'&&member.role==='manager');return `<section class="v1-permission-person"><header><div><strong>${esc(member.display_name)}</strong><small>${friendly(member.role)} · ${member.active?'Active':'Inactive'}</small></div><span>${member.role==='owner'?'Full access':'Role defaults + overrides'}</span></header><div class="v1-permission-grid">${state.defs.map(def=>{const compound=`${member.id}:${def.permission_key}`,has=overrideMap.has(compound),value=member.role==='owner'?true:(has?overrideMap.get(compound):defaultPermission(member.role,def.permission_key));return `<div class="v1-permission-toggle"><div><strong>${esc(def.label)}</strong><small>${esc(def.group_name)}${has?' · Override':' · Role default'}</small></div><label class="v1-switch"><input type="checkbox" data-v1-permission="${member.id}:${def.permission_key}" ${value?'checked':''} ${locked?'disabled':''}><span></span></label></div>`;}).join('')}</div></section>`;}).join('')||'<p>No staff available.</p>'}</div><p class="v1-permission-note">Technicians default to repair/intake/reference access. Front Desk defaults to intake, lead handling, customer records, and pickup. Managers and Owners default to inventory, counts, purchasing, pricing, reports, and administration.</p>`;
  }
  async function setPermission(memberId,key,enabled,input){if(state.training){input.checked=enabled;return;}const result=await client.rpc('set_staff_permission_override',{target_profile:memberId,target_permission:key,target_enabled:enabled});if(result.error){alert(result.error.message);input.checked=!enabled;return;}await reload();}

  function renderTrainingSettings(){
    if(!can('settings.manage'))return;const host=document.getElementById('settings');if(!host)return;let card=document.getElementById('v1-training-settings');if(!card){card=document.createElement('article');card.id='v1-training-settings';card.className='card';host.prepend(card);}card.innerHTML=`<div class="card-title"><div><h2>Training Store</h2><p>Sandbox workflows are isolated in this browser and never create production records.</p></div>${state.training?'<span class="v1-training-chip">TRAINING ACTIVE</span>':pill('production','Main Store')}</div><div class="v1-actions"><button class="secondary-button" type="button" data-v1-store-switch>${state.training?'Return to Main Store':'Open Training Store'}</button><button class="secondary-button" type="button" data-v1-reset-training>Reset training data</button></div>`;
  }

  function deviceImage(category){const key=String(category||'Other').toLowerCase();return ['phone','tablet','laptop','desktop','console'].includes(key)?`assets/device-${key}.svg`:'assets/gotcracked-mark.png';}
  function findIntake(ticket){return state.intakes.find(i=>i.ticket_id===ticket.id||i.id===ticket.intake_session_id);}
  function suggestions(ticket){const intake=findIntake(ticket);const source=text(ticket.customer_issue,ticket.intake_summary,intake?.generated_summary,JSON.stringify(intake?.visual_findings||{}),JSON.stringify(intake?.functional_findings||{}));return state.guides.map(guide=>{let score=0;(guide.tags||[]).forEach(tag=>{if(source.includes(String(tag).toLowerCase()))score+=18;});if(ticket.devices?.category&&String(guide.device_category||'').toLowerCase()===String(ticket.devices.category).toLowerCase())score+=25;return {guide,score:Math.min(100,score)};}).filter(x=>x.score>=25).sort((a,b)=>b.score-a.score).slice(0,3);}
  function lineRows(lines){return lines.map(line=>`<div class="v1-line-item ${line.damaged?'damaged':''}"><div><strong>${esc(line.description)}</strong><small>${esc(line.sku||line.item_type)} · ${line.quantity||1} × ${money(line.unit_price_cents||0)}${line.damaged?' · DAMAGED':''}</small></div><strong>${money((line.quantity||1)*(line.unit_price_cents||0))}</strong><div class="v1-line-menu"><button type="button" data-v1-remove-line="${line.id}">Remove</button>${line.item_type==='part'&&!line.damaged?`<button type="button" data-v1-damage-line="${line.id}">Mark damaged</button>`:''}</div></div>`).join('')||'<p class="empty-state">No parts or services added.</p>';}

  function openWorkOrder(id){
    const ticket=state.workOrders.find(t=>t.id===id);if(!ticket)return;state.currentWorkOrder=ticket;window.GotCrackedUI?.activateView?.('work-order');const host=document.getElementById('work-order');const customer=ticket.customers||{},device=ticket.devices||{},matches=suggestions(ticket),lines=ticket.work_order_items||[],ready=['repaired','ready_for_pickup'].includes(ticket.status);
    host.innerHTML=`<div class="v1-workorder-head"><div><p class="v1-kicker">Work Order ${state.training?'· TRAINING':''}</p><h1>${ticketCode(ticket.ticket_number)}</h1>${pill(ticket.status,repairLabel(ticket.status))}</div><div class="v1-actions">${can('labels.work_order')?`<button class="secondary-button" data-v1-print-ticket="${ticket.id}">Print DYMO Label</button>`:''}<button class="secondary-button" data-v1-toggle-workflow>Workflow</button></div></div><div class="v1-workorder-layout" id="v1-workorder-layout"><main class="v1-workorder-main"><section class="v1-device-card"><div class="v1-device-image"><img src="${deviceImage(device.category)}" alt="${esc(device.category||'Device')} reference"></div><div><div class="v1-device-meta"><div class="v1-meta-block"><small>Customer</small><strong>${esc(`${customer.first_name||''} ${customer.last_name||''}`.trim())}</strong></div><div class="v1-meta-block"><small>Contact</small><strong>${esc(customer.contact_phone||customer.phone||'—')}</strong></div><div class="v1-meta-block"><small>Email</small><strong>${esc(customer.email||'—')}</strong></div><div class="v1-meta-block"><small>Device</small><strong>${esc([device.manufacturer,device.model].filter(Boolean).join(' ')||device.category||'Device')}</strong></div><div class="v1-meta-block"><small>Model / serial</small><strong>${esc([device.model_number,device.serial_number].filter(Boolean).join(' · ')||'—')}</strong></div><div class="v1-meta-block"><small>Color / storage</small><strong>${esc([device.color,device.storage_size].filter(Boolean).join(' · ')||'—')}</strong></div><div class="v1-meta-block"><small>Condition</small><strong>${esc(device.device_condition||'Not recorded')}</strong></div><div class="v1-meta-block"><small>IMEI</small><strong>${esc(device.imei||'—')}</strong></div></div><div class="v1-summary"><strong>Customer complaint:</strong> ${esc(ticket.customer_issue||'Not recorded')}<br><br><strong>Initial intake:</strong> ${esc(ticket.intake_summary||findIntake(ticket)?.generated_summary||'Physical intake has not been completed yet.')}</div></div></section>${customerRepairView(ticket)}${matches.length?`<section class="card"><div class="card-title"><div><h2>Suggested repair paths</h2><p>Deterministic matches from intake findings and the internal reference database. Technician confirmation is required.</p></div></div><div class="v1-suggestions">${matches.map(match=>`<article class="v1-suggestion"><header><h4>${esc(match.guide.title)}</h4><span class="v1-confidence">${match.score}% match</span></header><p>${esc((match.guide.likely_causes||[]).join(' · '))}</p></article>`).join('')}</div></section>`:''}<section class="card"><div class="card-title"><div><h2>Parts & services</h2><p>Scan a DYMO part barcode or search by SKU/service name.</p></div></div><div class="v1-line-search"><input id="v1-line-search" autocomplete="off" placeholder="Scan barcode or type part / service SKU"><div id="v1-line-results" class="v1-search-results" hidden></div></div><div class="v1-line-list">${lineRows(lines)}</div><div class="v1-ticket-totals"><span>Subtotal <strong>${money(ticket.subtotal_cents||lines.reduce((sum,line)=>sum+(line.unit_price_cents||0)*(line.quantity||1),0))}</strong></span><span>Tax <strong>${money(ticket.tax_cents||0)}</strong></span><span>Total <strong>${money(ticket.total_cents||0)}</strong></span></div></section></main><aside class="v1-workflow-panel"><div class="v1-drawer-head"><div><p class="v1-kicker">Technician workflow</p><h2>${repairLabel(ticket.status)}</h2></div><button class="icon-button" type="button" data-v1-toggle-workflow>×</button></div><div class="v1-drawer-body"><form id="v1-workflow-form" class="v1-drawer-section v1-form"><h3>Status & notes</h3><label>Next status<select name="status"><option value="${ticket.status}">${repairLabel(ticket.status)} — no change</option>${(REPAIR_NEXT[ticket.status]||[]).map(status=>`<option value="${status}">${repairLabel(status)}</option>`).join('')}</select></label><label>Required progress note<textarea name="note" placeholder="Diagnosis, work performed, customer contact, QC result, or outcome"></textarea></label><label>Note visibility<select name="visibility"><option value="internal">Staff only</option><option value="customer">Show in customer account</option></select></label><input type="hidden" name="ticket_id" value="${ticket.id}"><button class="primary-button" ${can('repairs.workflow')?'':'disabled'}>Save workflow update</button><p class="operation-status"></p></form>${ready&&can('ready_pickup.checkout')?`<form id="v1-checkout-form" class="v1-drawer-section v1-form v1-checkout"><h3>Pickup checkout</h3><p>Confirm payment, then complete pickup and move the work order to Sale Complete.</p><label>Amount received<input name="amount" type="number" min="0" step="0.01" value="${((ticket.total_cents||0)/100).toFixed(2)}"></label><label>Payment method<select name="method"><option value="card">Card</option><option value="cash">Cash</option><option value="online">Online</option><option value="warranty">Warranty / redo</option><option value="no_charge">No-charge service</option><option value="other">Other</option></select></label><label>Reference<input name="reference" placeholder="Receipt / transaction reference"></label><input type="hidden" name="ticket_id" value="${ticket.id}"><button class="primary-button">Complete Pickup</button><p class="operation-status"></p></form>`:''}<section class="v1-drawer-section"><h3>Activity</h3>${(ticket.ticket_events||[]).slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).map(event=>`<div class="v1-event"><span class="v1-event-dot"></span><div><strong>${esc(friendly(event.event_type||'update'))}</strong><small>${new Date(event.created_at).toLocaleString()} · ${esc(event.actor?.display_name||'Staff')} · ${event.visibility==='customer'?'Customer-visible':'Internal'}</small><p>${esc(event.message||'')}</p></div></div>`).join('')||'<p>No activity yet.</p>'}</section></div></aside></div>`;
  }

  function searchCatalog(query){const q=query.trim().toLowerCase();if(!q)return[];return [...state.inventory.map(x=>({...x,_type:'part',_price:x.sell_price_cents||0})),...state.services.map(x=>({...x,_type:'service',_price:x.price_cents||0}))].filter(x=>text(x.sku,x.name,x.category).includes(q)).slice(0,12);}
  async function addLine(type,id){
    const ticket=state.currentWorkOrder,source=type==='part'?state.inventory.find(i=>i.id===id):state.services.find(i=>i.id===id);if(!ticket||!source)return;
    if(state.training){const line={id:uid('line'),ticket_id:ticket.id,item_type:type,catalog_id:id,description:source.name,sku:source.sku,quantity:1,unit_price_cents:source.sell_price_cents??source.price_cents??0,taxable:source.taxable!==false,inventory_applied:type==='part',damaged:false};ticket.work_order_items=ticket.work_order_items||[];ticket.work_order_items.push(line);if(type==='part'&&source.quantity_on_hand>0)source.quantity_on_hand-=1;ticket.updated_at=now();saveTraining();openWorkOrder(ticket.id);return;}
    const result=await client.rpc('save_work_order',{target_ticket:ticket.id,ticket_changes:{status:ticket.status,assigned_user_id:ticket.assigned_user_id||'',priority:ticket.priority||'normal',public_notes:ticket.public_notes||'',internal_notes:ticket.internal_notes||'',intake_method:ticket.intake_method||'walk_in',shipping_status:ticket.shipping_status||'not_applicable'},new_line:{item_type:type,catalog_id:id,description:source.name,quantity:1,unit_price_cents:source.sell_price_cents??source.price_cents??0,taxable:source.taxable!==false,inventory_applied:type==='part'},manual_discount_cents:0,manual_discount_reason:null,entered_promo_code:null});if(result.error)return alert(result.error.message);const ticketId=ticket.id;await reload();openWorkOrder(ticketId);
  }
  async function removeLine(id){const ticket=state.currentWorkOrder;if(!ticket||!confirm('Remove this item from the work order?'))return;if(state.training){const index=ticket.work_order_items.findIndex(x=>x.id===id);if(index>=0){const [line]=ticket.work_order_items.splice(index,1);if(line.item_type==='part'&&line.inventory_applied){const inv=state.inventory.find(i=>i.id===line.catalog_id);if(inv)inv.quantity_on_hand+=line.quantity||1;}}saveTraining();openWorkOrder(ticket.id);return;}const result=await client.from('work_order_items').delete().eq('id',id);if(result.error)return alert(result.error.message);const ticketId=ticket.id;await reload();openWorkOrder(ticketId);}
  async function damageLine(id){const note=prompt('Required damage note: what happened to this part?');if(!note?.trim())return;const ticket=state.currentWorkOrder;if(!ticket)return;if(state.training){const line=ticket.work_order_items.find(x=>x.id===id);if(line){line.damaged=true;line.damaged_at=now();line.damage_note=note.trim();}saveTraining();openWorkOrder(ticket.id);return;}const result=await client.rpc('mark_work_order_item_damaged',{target_line:id,damage_note:note.trim()});if(result.error)return alert(result.error.message);const ticketId=ticket.id;await reload();openWorkOrder(ticketId);}

  async function updateWorkflow(form){
    const data=Object.fromEntries(new FormData(form));const ticket=state.workOrders.find(t=>t.id===data.ticket_id);if(!ticket)return;if(!data.note?.trim())return setStatus(form,'A progress note is required.',true);
    const visibility=data.visibility==='customer'?'customer':'internal';
    if(state.training){const previous=ticket.status;ticket.status=data.status;ticket.updated_at=now();if(data.status==='repaired')ticket.ready_for_pickup_at=now();ticket.ticket_events=ticket.ticket_events||[];ticket.ticket_events.push({id:uid('event'),event_type:data.status!==previous?'status_changed':'note',message:data.note.trim(),visibility,created_at:now(),actor:{display_name:state.profile.display_name}});saveTraining();renderAll();openWorkOrder(ticket.id);return;}
    if(data.status!==ticket.status){const result=await client.rpc('advance_repair_status',{target_ticket:ticket.id,next_status:data.status,update_note:data.note.trim(),update_attachments:[],update_visibility:visibility});if(result.error)return setStatus(form,result.error.message,true);}else{const result=await client.rpc('add_repair_update',{target_ticket:ticket.id,update_note:data.note.trim(),update_attachments:[],update_visibility:visibility});if(result.error)return setStatus(form,result.error.message,true);}const ticketId=ticket.id;await reload();openWorkOrder(ticketId);
  }

  async function checkout(form){
    const data=Object.fromEntries(new FormData(form));const ticket=state.workOrders.find(t=>t.id===data.ticket_id);if(!ticket)return;
    if(state.training){ticket.payment_status='paid';ticket.amount_paid_cents=Math.round(Number(data.amount||0)*100);ticket.payment_method=data.method;ticket.payment_reference=data.reference||null;ticket.paid_at=now();ticket.status='sale_complete';ticket.pickup_at=now();ticket.completed_at=now();ticket.updated_at=now();ticket.ticket_events=ticket.ticket_events||[];ticket.ticket_events.push({id:uid('event'),event_type:'sale_complete',message:'Training checkout completed.',created_at:now(),actor:{display_name:state.profile.display_name}});saveTraining();renderAll();window.GotCrackedUI?.activateView?.('ready-pickup');return;}
    const payment=await client.rpc('confirm_repair_payment',{target_ticket:ticket.id,paid_amount_cents:Math.round(Number(data.amount||0)*100),paid_method:data.method,paid_reference:data.reference?.trim()||null,payment_note:'Pickup checkout'});if(payment.error)return setStatus(form,payment.error.message,true);const advance=await client.rpc('advance_repair_status',{target_ticket:ticket.id,next_status:'sale_complete',update_note:'Customer picked up device. Checkout completed.',update_attachments:[],update_visibility:'internal'});if(advance.error)return setStatus(form,advance.error.message,true);await reload();window.GotCrackedUI?.activateView?.('ready-pickup');
  }

  function printDymo({title,subtitle='',code='',price='',phone='',copies=1}){
    const template=state.settings?.label_template||'30252';const sizes={'30252':['3.5in','1.125in'],'30336':['2.125in','1in'],'30334':['2.25in','1.25in'],'1760756':['4in','2.25in']};const [width,height]=sizes[template]||sizes['30252'];const popup=window.open('','_blank','width=760,height=520');if(!popup)return alert('Allow pop-ups for Portal label printing.');
    const patterns={'0':0x034,'1':0x121,'2':0x061,'3':0x160,'4':0x031,'5':0x130,'6':0x070,'7':0x025,'8':0x124,'9':0x064,A:0x109,B:0x049,C:0x148,D:0x019,E:0x118,F:0x058,G:0x00d,H:0x10c,I:0x04c,J:0x01c,K:0x103,L:0x043,M:0x142,N:0x013,O:0x112,P:0x052,Q:0x007,R:0x106,S:0x046,T:0x016,U:0x181,V:0x0c1,W:0x1c0,X:0x091,Y:0x190,Z:0x0d0,'-':0x085,'.':0x184,' ':0x0c4,'$':0x0a8,'/':0x0a2,'+':0x08a,'%':0x02a,'*':0x094};const clean=String(code||'GC').toUpperCase().replace(/[^0-9A-Z. $/+%\-]/g,'-').slice(0,32);let x=0,bars='';for(const char of `*${clean}*`){const pattern=patterns[char]??patterns['-'];for(let i=0;i<9;i++){const barWidth=pattern&(1<<(8-i))?3:1;if(i%2===0)bars+=`<rect x="${x}" y="0" width="${barWidth}" height="34"/>`;x+=barWidth;}x+=1;}const svg=`<svg viewBox="0 0 ${x} 34" preserveAspectRatio="none">${bars}</svg>`;const labels=Array.from({length:Math.max(1,copies)},()=>`<section class="label"><img src="${new URL('assets/gotcracked-mark.png',location.href)}"><div><small>GOTCRACKED ${state.training?'· TRAINING':''}</small><h1>${esc(title)}</h1><p>${esc(subtitle)}</p><div class="barcode">${svg}</div><code>${esc(clean)}</code><footer>${price?`<strong>${esc(price)}</strong>`:''}${phone?`<span>${esc(phone)}</span>`:''}</footer></div></section>`).join('');
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
    if(event.key==='Escape'){const toggle=document.querySelector('[data-v1-store-menu-toggle]'),menu=document.querySelector('.v1-store-switch-menu:not([hidden])');if(menu){menu.hidden=true;toggle?.setAttribute('aria-expanded','false');toggle?.focus();}}
  });

  document.addEventListener('click',async event=>{
    const target=event.target instanceof Element?event.target:null;if(!target)return;
    const menuToggle=target.closest('[data-v1-store-menu-toggle]');
    if(menuToggle){event.preventDefault();const menu=menuToggle.parentElement?.querySelector('.v1-store-switch-menu');if(menu){menu.hidden=!menu.hidden;menuToggle.setAttribute('aria-expanded',String(!menu.hidden));if(!menu.hidden)menu.querySelector('[aria-current="true"]')?.focus();}return;}
    const option=target.closest('[data-v1-store-option]');
    if(option){event.preventDefault();const menu=option.closest('.v1-store-switch-menu');if(menu){menu.hidden=true;menu.previousElementSibling?.setAttribute('aria-expanded','false');}await switchStore(option.dataset.v1StoreOption==='training');return;}
    if(target.closest('[data-v1-store-switch]')){event.preventDefault();await switchStore();return;}
    if(!target.closest('.topbar .location'))document.querySelector('.v1-store-switch-menu:not([hidden])')?.setAttribute('hidden','');
    if(target.closest('[data-v1-reset-training]')){if(confirm('Reset all Training Store sandbox data?')){localStorage.removeItem('gc-training-data-v1');if(state.training){loadTraining();renderAll();}}return;}
    const filter=target.closest('[data-v1-lead-filter]');if(filter){state.leadFilter=filter.dataset.v1LeadFilter;renderLeads();return;}
    const lead=target.closest('[data-v1-lead]');if(lead){openLead(lead.dataset.v1Lead);return;}
    const work=target.closest('[data-v1-work-order]');if(work){openWorkOrder(work.dataset.v1WorkOrder);return;}
    if(target.closest('[data-v1-close-drawer]')||target.id==='v1-drawer-backdrop'){closeDrawer();return;}
    if(target.closest('[data-v1-new-lead]')){startLead();return;}
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


