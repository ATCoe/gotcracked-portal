import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const allowedOrigins = new Set(['https://gotcracked.co', 'https://www.gotcracked.co']);
const cors = (origin: string | null) => ({
  'Access-Control-Allow-Origin': allowedOrigins.has(origin || '') ? origin! : 'https://gotcracked.co',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
  'Vary': 'Origin'
});
const json = (origin: string | null, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors(origin) });
const clean = (value: unknown, max = 1200) => String(value || '').trim().slice(0, max);
const digits = (value: unknown) => String(value || '').replace(/\D/g, '');
const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, '0')).join('');
const hash = async (value: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
const clientKey = (request: Request) => request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || `ua:${request.headers.get('user-agent') || 'unknown'}`;
const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100);
const normalized = (value: unknown) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const isNeweggUrl = (value: unknown) => {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && (url.hostname === 'newegg.com' || url.hostname === 'www.newegg.com' || url.hostname.endsWith('.newegg.com'));
  } catch { return false; }
};
const isStatefulNeweggBuilderUrl = (value: unknown) => {
  try {
    const url = new URL(String(value || ''));
    if (!isNeweggUrl(url.href) || !url.pathname.startsWith('/tools/custom-pc-builder/pl/ID-')) return false;
    const temporaryBuild = clean(url.searchParams.get('tempPcbId'), 220);
    const wishlist = clean(url.searchParams.get('diywishlist'), 80);
    return Boolean(temporaryBuild || (wishlist && wishlist !== '0'));
  } catch { return false; }
};

const partCategories = ['CPU','CPU Cooler','Motherboard','Memory','Storage','GPU','Case','Power Supply','Operating System','Monitor','Other'];
const builderCategories = ['CPU','CPU Cooler','Motherboard','Memory','Storage','GPU','Case','Power Supply'];

const recommendationSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    build_name: { type: 'string' },
    customer_summary: { type: 'string' },
    performance_summary: { type: 'string' },
    upgrade_summary: { type: 'string' },
    compatibility_summary: { type: 'string' },
    budget_note: { type: 'string' },
    budget_fit: { type: 'boolean' },
    estimated_wattage: { type: 'integer' },
    newegg_compatibility: {
      type: 'object', additionalProperties: false,
      properties: {
        status: { type: 'string', enum: ['verified','manual_review'] },
        builder_url: { type: 'string' },
        min_wattage_estimate: { type: 'integer' },
        checked_categories: { type: 'array', items: { type: 'string', enum: builderCategories } },
        notes: { type: 'string' },
        manufacturer_crosscheck: { type: 'string' }
      },
      required: ['status','builder_url','min_wattage_estimate','checked_categories','notes','manufacturer_crosscheck']
    },
    spec_checks: {
      type: 'object', additionalProperties: false,
      properties: {
        cpu_socket: { type: 'string' },
        motherboard_socket: { type: 'string' },
        memory_type: { type: 'string' },
        motherboard_memory_type: { type: 'string' },
        motherboard_form_factor: { type: 'string' },
        case_supported_form_factors: { type: 'array', items: { type: 'string' } },
        gpu_length_mm: { type: 'integer' },
        case_gpu_clearance_mm: { type: 'integer' },
        psu_watts: { type: 'integer' },
        cooler_fit_verified: { type: 'boolean' },
        storage_interface_verified: { type: 'boolean' },
        psu_connectors_verified: { type: 'boolean' },
        bios_support_verified: { type: 'boolean' }
      },
      required: ['cpu_socket','motherboard_socket','memory_type','motherboard_memory_type','motherboard_form_factor','case_supported_form_factors','gpu_length_mm','case_gpu_clearance_mm','psu_watts','cooler_fit_verified','storage_interface_verified','psu_connectors_verified','bios_support_verified']
    },
    parts: {
      type: 'array', minItems: 7, maxItems: 11,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          category: { type: 'string', enum: partCategories },
          name: { type: 'string' },
          price_cents: { type: 'integer' },
          retailer: { type: 'string' },
          source_url: { type: 'string' },
          newegg_product_url: { type: 'string' },
          rationale: { type: 'string' }
        },
        required: ['category','name','price_cents','retailer','source_url','newegg_product_url','rationale']
      }
    }
  },
  required: ['build_name','customer_summary','performance_summary','upgrade_summary','compatibility_summary','budget_note','budget_fit','estimated_wattage','newegg_compatibility','spec_checks','parts']
};

function outputText(response: any) {
  for (const item of response?.output || []) for (const content of item?.content || []) if (content?.type === 'output_text' && typeof content.text === 'string') return content.text;
  return '';
}

async function allow(admin: ReturnType<typeof createClient>, request: Request) {
  const result = await admin.rpc('consume_public_rate_limit', { p_kind:'custom-pc-build', p_key_hash:await hash(clientKey(request)), p_limit:6, p_window_seconds:3600 });
  if (result.error) { console.error('PC build rate limiter unavailable:', result.error.message); throw new Error('PC build rate limiter unavailable.'); }
  return result.data === true;
}

function publicRecommendation(raw: any) {
  return {
    buildName: raw.build_name,
    summary: raw.customer_summary,
    performance: raw.performance_summary,
    upgradePath: raw.upgrade_summary,
    compatibility: raw.compatibility_summary,
    compatibilityMethod: 'Cross-checked in Newegg PC Builder and against manufacturer specifications.',
    budgetNote: raw.budget_note,
    budgetFit: raw.budget_fit,
    estimatedWattage: raw.estimated_wattage,
    parts: (raw.parts || []).map((part: any) => ({ category:part.category, name:part.name, rationale:part.rationale }))
  };
}

function validateCompatibility(raw: any) {
  const audit = raw.newegg_compatibility || {};
  const specs = raw.spec_checks || {};
  if (audit.status !== 'verified') throw new Error('Newegg PC Builder compatibility could not be verified.');
  if (!isStatefulNeweggBuilderUrl(audit.builder_url)) throw new Error('A stateful Newegg PC Builder verification link is required; a generic Builder page is not accepted.');

  const categories = new Set((raw.parts || []).map((part: any) => part.category));
  for (const required of ['CPU','Motherboard','Memory','Storage','Case','Power Supply']) if (!categories.has(required)) throw new Error(`Complete build is missing ${required}.`);
  const selectedBuilderCategories = builderCategories.filter(category => categories.has(category));
  const checked = new Set(audit.checked_categories || []);
  for (const category of selectedBuilderCategories) if (!checked.has(category)) throw new Error(`Newegg compatibility did not verify ${category}.`);
  for (const part of raw.parts || []) if (builderCategories.includes(part.category) && !isNeweggUrl(part.newegg_product_url)) throw new Error(`Newegg product evidence is missing for ${part.category}.`);

  if (!specs.cpu_socket || normalized(specs.cpu_socket) !== normalized(specs.motherboard_socket)) throw new Error('CPU and motherboard sockets do not match.');
  if (!specs.memory_type || normalized(specs.memory_type) !== normalized(specs.motherboard_memory_type)) throw new Error('Memory generation is not compatible with the motherboard.');
  const supportedForms = (specs.case_supported_form_factors || []).map(normalized);
  if (!specs.motherboard_form_factor || !supportedForms.includes(normalized(specs.motherboard_form_factor))) throw new Error('Motherboard form factor is not supported by the case.');

  if (categories.has('GPU')) {
    if (!(specs.gpu_length_mm > 0) || !(specs.case_gpu_clearance_mm > 0) || specs.gpu_length_mm > specs.case_gpu_clearance_mm) throw new Error('GPU physical clearance is not verified.');
  }
  const minWattage = Number(audit.min_wattage_estimate || 0);
  const psuWatts = Number(specs.psu_watts || 0);
  const requiredPsu = Math.max(minWattage + 100, Math.ceil(minWattage * 1.2));
  if (!(minWattage > 0) || psuWatts < requiredPsu) throw new Error(`Power supply does not have required headroom over Newegg's ${minWattage} W minimum estimate.`);
  if (!specs.cooler_fit_verified) throw new Error('CPU cooler / radiator fit is not verified.');
  if (!specs.storage_interface_verified) throw new Error('Storage interface compatibility is not verified.');
  if (!specs.psu_connectors_verified) throw new Error('PSU connector compatibility is not verified.');
  if (!specs.bios_support_verified) throw new Error('Motherboard BIOS support for the selected CPU is not verified.');

  return {
    status: 'verified',
    method: 'Interactive Newegg PC Builder + manufacturer specification cross-check + server assertions',
    builder_url: audit.builder_url,
    newegg_min_wattage_estimate: minWattage,
    selected_builder_categories: selectedBuilderCategories,
    checked_categories: [...checked],
    server_checks: {
      cpu_socket: `${specs.cpu_socket} = ${specs.motherboard_socket}`,
      memory: `${specs.memory_type} = ${specs.motherboard_memory_type}`,
      motherboard_case_fit: `${specs.motherboard_form_factor} supported by case`,
      gpu_clearance_mm: categories.has('GPU') ? { gpu:specs.gpu_length_mm, case:specs.case_gpu_clearance_mm } : null,
      psu: { selected_watts:psuWatts, newegg_minimum_watts:minWattage, required_headroom_watts:requiredPsu },
      cooler_fit_verified: true,
      storage_interface_verified: true,
      psu_connectors_verified: true,
      bios_support_verified: true
    },
    newegg_notes: audit.notes,
    manufacturer_crosscheck: audit.manufacturer_crosscheck
  };
}

async function researchBuild(survey: Record<string, unknown>, partBudgetCents: number) {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.');
  const model = Deno.env.get('PC_BUILD_RESEARCH_MODEL') || 'gpt-5.4-mini';
  const prompt = `You are the sourcing and compatibility engine for GotCracked, an electronics repair and custom-PC shop in Blacksburg, Virginia. Build a CURRENT new-parts PC recommendation for the customer survey below.

NON-NEGOTIABLE NEWEGG COMPATIBILITY WORKFLOW:
1. Use the computer tool to open Newegg's current Custom PC Builder at https://www.newegg.com/tools/custom-pc-builder and actually configure the proposed core components in the interactive Builder. Do not merely read or cite the generic Builder landing page.
2. Start with the CPU. Select or validate the exact CPU, motherboard, memory, GPU when used, case, power supply, storage, and CPU cooler. Confirm the Builder continues to accept each exact model as the configuration is assembled.
3. Capture a stateful Newegg Builder URL for the configured build. A generic /tools/custom-pc-builder URL is NOT evidence. The returned builder_url must be a Newegg /tools/custom-pc-builder/pl/ID-... URL containing a tempPcbId or a non-zero diywishlist parameter representing the configured state.
4. For each selected core hardware part, return the exact Newegg product URL for the same model in newegg_product_url even if another retailer has the best current price.
5. Record Newegg's minimum wattage estimate from the configured build when available and check the PSU against it.
6. If the computer tool cannot interact with the Builder, any exact part cannot be selected in the compatibility-filtered flow, a stateful Builder URL cannot be captured, or the wattage estimate cannot be verified, set newegg_compatibility.status to manual_review. Never fabricate Builder state or claim verification from general product knowledge.
7. Browsing safety: do NOT sign in to Newegg, do NOT add products to a cart, do NOT begin checkout, do NOT place an order, and do NOT submit any personal information. The Builder is used only for compatibility verification and reading public product/build information.
8. Newegg states its Builder is an aid rather than a manufacturer guarantee. ALSO verify current manufacturer/product specifications for CPU socket/chipset/BIOS support, RAM generation, motherboard/case form factor, GPU length clearance, cooler/radiator fit, M.2/SATA interfaces, PSU capacity/connectors, and any special power adapters.
9. Fill spec_checks with the concrete values used for those checks. Do not guess dimensions, sockets, connectors, or BIOS support. If a required value cannot be verified from current product/manufacturer information, set Newegg status manual_review.

SOURCING AND PERFORMANCE RULES:
- Use web search for current US retail availability and pricing. Prioritize Newegg and Amazon; use Micro Center, B&H, Best Buy, manufacturer stores, or other reputable US retailers only when materially better/current.
- New components only. No auctions, used/refurbished listings, questionable marketplace fulfillment, or out-of-stock placeholder prices.
- Every price_cents must be a current price from source_url. Never invent MSRP or historical pricing.
- Available PARTS budget: ${money(partBudgetCents)}. GotCracked service labor is added separately by the server.
- Optimize for the customer's actual games/apps, resolution, FPS, image quality, ray tracing, noise, aesthetics, longevity, and upgrade goals.
- Use a quality PSU with at least 20% or 100 W headroom (whichever is greater) above Newegg's minimum estimate.
- If goals cannot honestly fit the budget, return the closest practical build and budget_fit=false.
- RAM is currently unusually expensive. Do not under-spec memory below practical workload needs simply to hide the market price.
- Include Windows only if needed. Include a monitor only when the customer's budget scope includes it.
- Keep customer-facing explanations concise and do not mention individual part prices.

Customer survey JSON:
${JSON.stringify(survey)}`;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization:`Bearer ${apiKey}`, 'Content-Type':'application/json' },
    body: JSON.stringify({
      model,
      store: false,
      max_tool_calls: 28,
      tools: [{ type:'web_search' }, { type:'computer' }],
      input: prompt,
      text: { format: { type:'json_schema', name:'pc_build_recommendation', strict:true, schema:recommendationSchema } }
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `Research provider failed (${response.status}).`);
  const text = outputText(data);
  if (!text) throw new Error('Research provider returned no structured recommendation.');
  const recommendation = JSON.parse(text);
  if (!Array.isArray(recommendation.parts) || recommendation.parts.length < 7) throw new Error('Recommendation did not contain a complete parts list.');
  for (const part of recommendation.parts) {
    const price = Number(part.price_cents);
    if (!Number.isInteger(price) || price < 100 || price > 1_000_000) throw new Error(`Invalid researched price for ${part.category}.`);
    let source: URL;
    try { source = new URL(part.source_url); } catch { throw new Error(`Invalid source URL for ${part.category}.`); }
    if (source.protocol !== 'https:') throw new Error(`Non-HTTPS price source for ${part.category}.`);
  }
  const compatibilityAudit = validateCompatibility(recommendation);
  return { recommendation, compatibilityAudit, model };
}

async function notifyLead(lead: Record<string, any>, reference: string, totalCents: number | null, compatibility = 'manual review') {
  const token = Deno.env.get('DISCORD_BOT_TOKEN');
  const channelId = Deno.env.get('DISCORD_LEAD_CHANNEL_ID');
  if (!token || !channelId) return;
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method:'POST', headers:{Authorization:`Bot ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({allowed_mentions:{parse:[]},embeds:[{title:`Custom PC build · ${lead.name}`,description:lead.notes||'New custom PC build request',color:0x0a8fff,fields:[{name:'Contact',value:[lead.phone,lead.email].filter(Boolean).join(' · ')||'No contact details',inline:false},{name:'Reference',value:reference,inline:true},{name:'Estimate',value:totalCents==null?'Manual research required':money(totalCents),inline:true},{name:'Compatibility',value:compatibility,inline:true}],footer:{text:'GotCracked custom PC build request'},timestamp:new Date().toISOString()}]})
  });
  if (!response.ok) console.error('PC build Discord alert failed:',response.status,await response.text());
}

Deno.serve(async request => {
  const origin = request.headers.get('Origin');
  if (request.method === 'OPTIONS') return new Response('ok',{headers:cors(origin)});
  if (request.method !== 'POST') return json(origin,{error:'Method not allowed.'},405);
  if (!allowedOrigins.has(origin || '')) return json(origin,{error:'Origin not allowed.'},403);
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    if (!(await allow(admin,request))) return json(origin,{error:'Too many build requests from this connection. Please try again later.'},429);
    const body = await request.json();
    if (clean(body.companyWebsite,100)) return json(origin,{error:'Unable to submit the build request.'},400);
    const startedAt=Number(body.formStartedAt||0);
    if(!startedAt||Date.now()-startedAt<4000||Date.now()-startedAt>86400000) return json(origin,{error:'Please reload the page and try again.'},400);

    const customerName=clean(body.customerName,160), customerEmail=clean(body.customerEmail,160).toLowerCase(), customerPhone=clean(body.customerPhone,40), preferredContact=clean(body.preferredContact,20)||'No preference', budgetDollars=Number(body.budget);
    if(!customerName||!/^\S+@\S+\.\S+$/.test(customerEmail)||digits(customerPhone).length<7||!Number.isFinite(budgetDollars)||budgetDollars<700||body.consent!=='on') return json(origin,{error:'Complete the required contact, budget, and consent fields.'},400);

    const locationId=Deno.env.get('DEFAULT_LOCATION_ID')!;
    if(!locationId) throw new Error('DEFAULT_LOCATION_ID is not configured.');
    const settingsResult=await admin.from('business_settings').select('custom_pc_build_service_charge_cents,custom_pc_build_estimate_valid_days').eq('location_id',locationId).maybeSingle();
    if(settingsResult.error) throw settingsResult.error;
    const serviceChargeCents=Number(settingsResult.data?.custom_pc_build_service_charge_cents??24999),validDays=Number(settingsResult.data?.custom_pc_build_estimate_valid_days??7),budgetCents=Math.round(budgetDollars*100),partBudgetCents=budgetCents-serviceChargeCents;
    if(partBudgetCents<40000) return json(origin,{error:'The entered budget is below the practical minimum after the custom-build service. Increase the budget and try again.'},400);

    const survey={primaryUse:clean(body.primaryUse,80),secondaryUses:clean(body.secondaryUses,400),games:clean(body.games,800),creativeApps:clean(body.creativeApps,500),resolution:clean(body.resolution,40),targetFps:clean(body.targetFps,40),imageQuality:clean(body.imageQuality,60),rayTracing:clean(body.rayTracing,40),budget:budgetDollars,budgetScope:clean(body.budgetScope,60),rgb:clean(body.rgb,60),color:clean(body.color,40),caseSize:clean(body.caseSize,60),noise:clean(body.noise,60),storage:clean(body.storage,60),wifi:clean(body.wifi,20),osNeeded:clean(body.osNeeded,20),upgradePriority:clean(body.upgradePriority,60),longevity:clean(body.longevity,40),existingParts:clean(body.existingParts,800),notes:clean(body.notes,1000)};
    const reference=`GCP-${crypto.randomUUID().replaceAll('-','').slice(0,8).toUpperCase()}`;
    const leadNotes=['Custom PC build survey',`Budget: ${money(budgetCents)}`,`Primary use: ${survey.primaryUse||'Not specified'}`,survey.games?`Games: ${survey.games}`:null,survey.resolution?`Target: ${survey.resolution} · ${survey.targetFps||'FPS flexible'} · ${survey.imageQuality||'quality flexible'}`:null,`Aesthetics: ${survey.color||'any'} · ${survey.rgb||'RGB flexible'}`,survey.existingParts?`Customer-owned/reused parts: ${survey.existingParts}`:null,survey.notes||null].filter(Boolean).join('\n');

    const leadResult=await admin.from('leads').insert({external_id:`pcbuild-${crypto.randomUUID()}`,public_reference:reference,location_id:locationId,name:customerName,phone:customerPhone,email:customerEmail,service:'Custom PC build',source:'gotcracked.co/custom-pc-build',notes:leadNotes,status:'new'}).select().single();
    if(leadResult.error) throw leadResult.error;
    const requestResult=await admin.from('pc_build_requests').insert({location_id:locationId,lead_id:leadResult.data.id,public_reference:reference,customer_name:customerName,customer_email:customerEmail,customer_phone:customerPhone,preferred_contact:preferredContact,survey,service_charge_cents:serviceChargeCents,status:'research_pending',compatibility_status:'pending',research_provider:'openai'}).select().single();
    if(requestResult.error) throw requestResult.error;

    if (survey.existingParts) {
      const reason='Customer-owned or reused components require exact-model and physical-condition verification before GotCracked can release an automated build price.';
      await admin.from('pc_build_requests').update({status:'manual_review',compatibility_status:'manual_review',research_error:reason,updated_at:new Date().toISOString()}).eq('id',requestResult.data.id);
      await admin.from('lead_events').insert({lead_id:leadResult.data.id,event_type:'note',message:reason});
      await notifyLead({...leadResult.data,notes:leadNotes},reference,null,'Customer-owned parts require manual review');
      return json(origin,{ok:true,reference,status:'manual_review',message:'Your build survey was received. Because you listed existing components to reuse, GotCracked will verify their exact model, condition, and compatibility before preparing the estimate. No automated price was released.'},202);
    }

    try {
      const researched=await researchBuild(survey,partBudgetCents),raw=researched.recommendation;
      const partsCostCents=raw.parts.reduce((sum:number,part:any)=>sum+Number(part.price_cents||0),0),totalCents=partsCostCents+serviceChargeCents,validUntil=new Date(Date.now()+validDays*86400000).toISOString();
      const internalParts=raw.parts,sourceUrls=[...new Set(raw.parts.flatMap((part:any)=>[part.source_url,part.newegg_product_url]).filter(Boolean))],customer=publicRecommendation(raw);
      const update=await admin.from('pc_build_requests').update({recommendation:customer,internal_parts:internalParts,source_urls:sourceUrls,parts_cost_cents:partsCostCents,estimated_total_cents:totalCents,estimate_valid_until:validUntil,status:'estimated',compatibility_status:'verified',compatibility_audit:researched.compatibilityAudit,research_model:researched.model,research_error:null,updated_at:new Date().toISOString()}).eq('id',requestResult.data.id);
      if(update.error) throw update.error;
      await admin.from('lead_events').insert({lead_id:leadResult.data.id,event_type:'note',message:`Automated custom-PC research completed. Interactive Newegg PC Builder + manufacturer compatibility verified. Customer estimate: ${money(totalCents)}. Internal sourcing is stored on PC build request ${reference}.`});
      await notifyLead({...leadResult.data,notes:leadNotes},reference,totalCents,'Interactive Newegg + manufacturer verified');
      return json(origin,{ok:true,reference,status:'estimated',recommendation:customer,estimatedTotalCents:totalCents,estimateValidUntil:validUntil,compatibilityVerified:true,compatibilityMethod:'Interactive Newegg PC Builder + manufacturer specifications',ramMarketNotice:'Memory prices are unusually high as AI/data-center demand and HBM production consume more global DRAM capacity. Industry forecasts expect supply to remain constrained through 2027, with more meaningful relief potentially arriving in late 2027 into 2028 as new capacity ramps. This estimate uses current market pricing and may change.'},201);
    } catch(researchError) {
      console.error('Custom PC research/compatibility failed:',researchError);
      const message=researchError instanceof Error?researchError.message:'Automated research failed.';
      await admin.from('pc_build_requests').update({status:'manual_review',compatibility_status:'manual_review',research_error:message.slice(0,1000),updated_at:new Date().toISOString()}).eq('id',requestResult.data.id);
      await admin.from('lead_events').insert({lead_id:leadResult.data.id,event_type:'note',message:`Automated custom-PC estimate held for manual review: ${message.slice(0,500)}`});
      await notifyLead({...leadResult.data,notes:leadNotes},reference,null,'Manual compatibility review required');
      return json(origin,{ok:true,reference,status:'manual_review',message:'Your build survey was received. Automated pricing was held because the complete configuration could not be verified in Newegg PC Builder and against manufacturer specifications. A GotCracked specialist will review it before an estimate is shown.'},202);
    }
  } catch(error) {
    console.error(error);
    return json(origin,{error:'Unable to prepare the custom PC build request right now. Please contact GotCracked for help.'},500);
  }
});