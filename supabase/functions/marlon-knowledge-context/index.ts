import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY') || '';
const PORTAL_ORIGIN = 'https://portal.gotcracked.co';

const cors = {
  'Access-Control-Allow-Origin': PORTAL_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const stop = new Set(['the','a','an','and','or','but','to','of','for','with','on','in','at','by','from','is','it','this','that','i','we','you','my','our','your','can','could','would','should','do','does','how','what','why','when','where','who','about','help','need','want','please']);

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {status, headers:cors});
}

function words(value: unknown) {
  return [...new Set(String(value ?? '').toLowerCase().replace(/[^a-z0-9+#.-]+/g,' ').split(/\s+/).filter(w => w.length > 1 && !stop.has(w)))];
}

function haystack(record: Record<string, unknown>) {
  return JSON.stringify(record).toLowerCase();
}

function score(queryWords: string[], record: Record<string, unknown>, boosts: Record<string, number> = {}) {
  const text = haystack(record);
  let total = 0;
  for (const word of queryWords) {
    if (!text.includes(word)) continue;
    total += 2;
    for (const [key, weight] of Object.entries(boosts)) {
      const value = record[key];
      if (value != null && JSON.stringify(value).toLowerCase().includes(word)) total += weight;
    }
  }
  return total;
}

function compact(value: unknown, max = 2200) {
  return String(value ?? '').replace(/\s+/g,' ').trim().slice(0,max);
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&quot;/gi,'"')
    .replace(/&#39;|&apos;/gi,"'")
    .replace(/&lt;/gi,'<')
    .replace(/&gt;/gi,'>')
    .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)));
}

function stripHtml(value: string) {
  return decodeHtml(value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi,' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi,' ')
    .replace(/<!--([\s\S]*?)-->/g,' ')
    .replace(/<[^>]+>/g,' '));
}

function safeHttps(value: string) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return null;
    return u;
  } catch { return null; }
}

async function liveFetch(source: any) {
  const url = safeHttps(String(source.url || ''));
  if (!url || source.live_fetch !== true) return null;
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),3500);
  try {
    const r = await fetch(url.toString(),{
      redirect:'follow',
      signal:controller.signal,
      headers:{'User-Agent':'GotCracked-Marlon/1.0 (+https://gotcracked.co)','Accept':'text/html,text/plain,application/json;q=0.9,*/*;q=0.2'}
    });
    if (!r.ok) return {sourceName:source.source_name,url:url.toString(),status:r.status,available:false};
    const type = String(r.headers.get('content-type') || '').toLowerCase();
    const length = Number(r.headers.get('content-length') || 0);
    if (length > 450000) return {sourceName:source.source_name,url:url.toString(),available:false,reason:'source too large'};
    let text = await r.text();
    if (text.length > 450000) text = text.slice(0,450000);
    if (type.includes('html') || /<html|<body|<main/i.test(text)) text = stripHtml(text);
    return {sourceName:source.source_name,url:url.toString(),available:true,excerpt:compact(text,2400)};
  } catch {
    return {sourceName:source.source_name,url:url.toString(),available:false};
  } finally { clearTimeout(timer); }
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok',{headers:cors});
  if (request.method !== 'POST') return response({ok:false,error:'Method not allowed'},405);
  if (!SERVICE_KEY) return response({ok:false,error:'Knowledge service is not configured'},500);

  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i,'');
  if (!token) return response({ok:false,error:'Authentication required'},401);

  const userClient = createClient(SUPABASE_URL,ANON_KEY,{global:{headers:{Authorization:authHeader}},auth:{persistSession:false,autoRefreshToken:false}});
  const admin = createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:userError} = await userClient.auth.getUser();
  if (userError || !user) return response({ok:false,error:'Invalid Portal session'},401);

  const {data:profile,error:profileError} = await admin.from('profiles').select('id,location_id,display_name,role,active').eq('id',user.id).maybeSingle();
  if (profileError || !profile?.active || !profile.location_id) return response({ok:false,error:'Active staff profile required'},403);

  const permission=await userClient.rpc('has_permission',{permission_key:'reference.view'});
  if(permission.error||permission.data!==true)return response({ok:false,error:'Reference permission required.'},403);
  let body: any = {};
  try { body = await request.json(); } catch { return response({ok:false,error:'Invalid request'},400); }
  const query = compact(body?.query,1200);
  if (!query) return response({ok:true,context:{guides:[],parts:[],webSources:[],liveSources:[],business:null,generatedAt:new Date().toISOString()}});
  const q = words(query);

  const [guidesResult,partsResult,sourcesResult,businessResult] = await Promise.all([
    admin.from('repair_guides').select('id,slug,location_id,device_category,manufacturer,model_family,symptom,title,summary,diagnostic_steps,likely_causes,tools_notes,parts_notes,cautions,tags,difficulty,bench_time_minutes,source_type,source_name,source_url,source_license,verified_at,updated_at').eq('active',true).limit(400),
    admin.from('parts_registry_latest_source').select('*').limit(500),
    admin.from('marlon_web_sources').select('source_name,category,url,tags,trust_level,live_fetch,notes').eq('active',true).limit(200),
    admin.from('business_settings').select('warranty_months,store_hours,accepts_mail_in_repairs,default_shipping_carrier,mail_in_instructions,frequent_repair_discount_percent,frequent_repair_min_completed,abandoned_after_days,website_url,mobilesentrix_url,amazon_business_url,prepay_required_default,payment_routing_mode,custom_pc_build_service_charge_cents,custom_pc_build_estimate_valid_days').eq('location_id',profile.location_id).maybeSingle()
  ]);

  const guides = (guidesResult.data || [])
    .filter((g:any)=>!g.location_id || g.location_id === profile.location_id)
    .map((g:any)=>({record:g,score:score(q,g,{title:5,manufacturer:4,model_family:4,symptom:5,tags:4,summary:2})}))
    .filter((x:any)=>x.score>0)
    .sort((a:any,b:any)=>b.score-a.score)
    .slice(0,7)
    .map((x:any)=>({
      id:x.record.id,title:x.record.title,deviceCategory:x.record.device_category,manufacturer:x.record.manufacturer,modelFamily:x.record.model_family,symptom:x.record.symptom,
      summary:compact(x.record.summary,1200),diagnosticSteps:x.record.diagnostic_steps,likelyCauses:x.record.likely_causes,toolsNotes:compact(x.record.tools_notes,650),partsNotes:compact(x.record.parts_notes,650),cautions:compact(x.record.cautions,650),difficulty:x.record.difficulty,benchTimeMinutes:x.record.bench_time_minutes,
      sourceType:x.record.source_type,sourceName:x.record.source_name,sourceUrl:x.record.source_url,verifiedAt:x.record.verified_at,score:x.score
    }));

  const parts = (partsResult.data || [])
    .map((p:any)=>({record:p,score:score(q,p,{display_name:5,brand:4,model:5,category:3,subcategory:3,supplier_sku:5,source_name:2})}))
    .filter((x:any)=>x.score>0)
    .sort((a:any,b:any)=>b.score-a.score)
    .slice(0,7)
    .map((x:any)=>({partId:x.record.part_id,displayName:x.record.display_name,brand:x.record.brand,model:x.record.model,category:x.record.category,subcategory:x.record.subcategory,sourceName:x.record.source_name,supplierSku:x.record.supplier_sku,priceCents:x.record.price_cents,availability:x.record.availability,sourceUrl:x.record.source_url,stocked:x.record.stocked,score:x.score}));

  const webSources = (sourcesResult.data || [])
    .map((s:any)=>({record:s,score:score(q,s,{source_name:4,category:3,tags:5,notes:2}) + (s.trust_level==='primary'?1:0)}))
    .filter((x:any)=>x.score>0)
    .sort((a:any,b:any)=>b.score-a.score)
    .slice(0,6)
    .map((x:any)=>({...x.record,score:x.score}));

  const liveCandidates = webSources.filter((s:any)=>s.live_fetch === true).slice(0,3);
  const liveSources = (await Promise.all(liveCandidates.map(liveFetch))).filter(Boolean);

  const context = {
    query,
    staff:{role:profile.role},
    policy:{
      precedence:['GotCracked internal procedure','current manufacturer/OEM safety and service documentation','approved supplier data','secondary/reference sources'],
      rules:[
        'Treat supplier catalog availability as supplier availability, never GotCracked on-hand inventory unless stocked=true.',
        'For model-specific repairs, confirm exact model/revision and cite or name the supporting source when available.',
        'If internal guidance conflicts with newer OEM safety/service information, flag the conflict and prefer the current OEM safety requirement.',
        'Do not invent specifications, pricing, parts compatibility, repair steps, game information, or policies that are not supported by the provided context.',
        'Gaming knowledge may include consoles, handhelds, PC gaming hardware/software, official platform support, and GotCracked repair/sales context.'
      ]
    },
    guides,
    parts,
    webSources:webSources.map((s:any)=>({sourceName:s.source_name,category:s.category,url:s.url,tags:s.tags,trustLevel:s.trust_level,notes:s.notes,score:s.score})),
    liveSources,
    business:businessResult.data || null,
    generatedAt:new Date().toISOString()
  };

  return response({ok:true,context});
});

