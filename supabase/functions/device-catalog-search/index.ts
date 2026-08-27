import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const allowedOrigins = new Set(['https://portal.gotcracked.co']);
const cors = (origin: string | null) => ({
  'Access-Control-Allow-Origin': allowedOrigins.has(origin || '') ? origin! : 'https://portal.gotcracked.co',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
  'Vary': 'Origin'
});
const json = (origin: string | null, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors(origin) });
const clean = (value: unknown, max = 180) => String(value || '').trim().slice(0, max);
const allowedCategories = new Set(['Phone','Tablet','Laptop','Desktop','Console','Other']);
const userAgent = 'GotCracked-Device-Catalog/1.0 (https://gotcracked.co)';

function claimValues(entity: any, property: string) {
  return (entity?.claims?.[property] || []).map((claim: any) => claim?.mainsnak?.datavalue?.value).filter(Boolean);
}
function entityId(value: any) { return typeof value?.id === 'string' ? value.id : null; }
function firstText(values: any[]) { const value = values.find(v => typeof v === 'string' && v.trim()); return value ? String(value).trim() : null; }
function yearFromClaims(entity: any) {
  for (const property of ['P577','P571']) {
    const value = claimValues(entity, property).find((v: any) => typeof v?.time === 'string');
    if (value?.time) { const match = value.time.match(/[+-](\d{4})-/); if (match) return Number(match[1]); }
  }
  return null;
}
async function wikidata(params: URLSearchParams) {
  const response = await fetch(`https://www.wikidata.org/w/api.php?${params}`, { headers: { 'User-Agent': userAgent, 'Accept': 'application/json' } });
  if (!response.ok) throw new Error(`Wikidata request failed (${response.status}).`);
  return response.json();
}
async function fetchEntities(ids: string[]) {
  if (!ids.length) return {};
  const result = await wikidata(new URLSearchParams({ action:'wbgetentities', format:'json', ids:ids.join('|'), props:'labels|descriptions|claims|sitelinks', languages:'en' }));
  return result.entities || {};
}
async function commonsImage(filename: string | null) {
  if (!filename) return null;
  const params = new URLSearchParams({ action:'query', format:'json', prop:'imageinfo', titles:`File:${filename}`, iiprop:'url|extmetadata', iiurlwidth:'560', origin:'*' });
  const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, { headers:{ 'User-Agent':userAgent, 'Accept':'application/json' } });
  if (!response.ok) return null;
  const payload = await response.json();
  const page = Object.values(payload?.query?.pages || {})[0] as any;
  const info = page?.imageinfo?.[0];
  if (!info) return null;
  const meta = info.extmetadata || {};
  const strip = (value: unknown) => String(value || '').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
  return { url: info.thumburl || info.url || null, source: 'Wikimedia Commons', license: strip(meta.LicenseShortName?.value || meta.License?.value), author: strip(meta.Artist?.value || meta.Credit?.value), attribution_url: info.descriptionurl || null };
}
function looksRelevant(description: string, category: string) {
  const d = description.toLowerCase();
  if (!d) return true;
  const groups: Record<string,string[]> = { Phone:['phone','smartphone','mobile phone','handset'], Tablet:['tablet','tablet computer'], Laptop:['laptop','notebook','portable computer'], Desktop:['desktop','personal computer','computer'], Console:['game console','video game console','handheld console','gaming handheld'], Other:[] };
  return !(groups[category] || []).length || groups[category].some(term => d.includes(term));
}
async function candidateFromEntity(entity: any, manufacturerLabels: Record<string,string>) {
  const qid = entity?.id || '';
  const name = entity?.labels?.en?.value || qid;
  const description = entity?.descriptions?.en?.value || '';
  const manufacturerQid = entityId(claimValues(entity,'P176')[0]);
  const manufacturer = manufacturerQid ? manufacturerLabels[manufacturerQid] || null : null;
  const modelNumbers = claimValues(entity,'P296').filter((v:any)=>typeof v === 'string').map(String);
  const imageFilename = firstText(claimValues(entity,'P18'));
  const image = await commonsImage(imageFilename);
  return { qid,name,description,manufacturer,manufacturer_qid:manufacturerQid, model_numbers:modelNumbers, release_year:yearFromClaims(entity), image };
}
async function searchCandidates(query: string, category: string) {
  const search = await wikidata(new URLSearchParams({ action:'wbsearchentities',format:'json',language:'en',type:'item',limit:'12',search:query }));
  const ids = (search.search || []).map((item:any)=>item.id).filter(Boolean);
  const entities = await fetchEntities(ids);
  const manufacturerIds = [...new Set(Object.values(entities).map((entity:any)=>entityId(claimValues(entity,'P176')[0])).filter(Boolean))] as string[];
  const manufacturerEntities = await fetchEntities(manufacturerIds);
  const manufacturerLabels: Record<string,string> = {};
  for (const [id,entity] of Object.entries(manufacturerEntities) as [string,any][]) manufacturerLabels[id] = entity?.labels?.en?.value || id;
  const candidates = [];
  for (const id of ids) {
    const entity = entities[id];
    if (!entity) continue;
    const description = entity?.descriptions?.en?.value || '';
    if (!looksRelevant(description, category)) continue;
    candidates.push(await candidateFromEntity(entity, manufacturerLabels));
    if (candidates.length >= 8) break;
  }
  return candidates;
}
async function importCandidate(admin: any, qid: string, category: string) {
  const entities = await fetchEntities([qid]);
  const entity = entities[qid];
  if (!entity || entity.missing !== undefined) throw new Error('Device record was not found in Wikidata.');
  const manufacturerQid = entityId(claimValues(entity,'P176')[0]);
  const manufacturerEntities = manufacturerQid ? await fetchEntities([manufacturerQid]) : {};
  const manufacturerName = manufacturerQid ? manufacturerEntities[manufacturerQid]?.labels?.en?.value || 'Unknown manufacturer' : 'Unknown manufacturer';
  const candidate = await candidateFromEntity(entity, manufacturerQid ? {[manufacturerQid]:manufacturerName} : {});
  const manufacturerSlug = manufacturerName.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || `wikidata-${manufacturerQid || 'unknown'}`;
  const manufacturerUpsert = await admin.from('device_catalog_manufacturers').upsert({ name:manufacturerName, slug:manufacturerSlug, categories:[category], source_system:'wikidata', source_key:manufacturerQid || `manufacturer:${manufacturerSlug}`, source_url:manufacturerQid ? `https://www.wikidata.org/wiki/${manufacturerQid}` : null, active:true, updated_at:new Date().toISOString() }, { onConflict:'slug' }).select().single();
  if (manufacturerUpsert.error) throw manufacturerUpsert.error;
  const modelPayload = { manufacturer_id:manufacturerUpsert.data.id, category, name:candidate.name, family:candidate.name, release_year:candidate.release_year, model_numbers:candidate.model_numbers || [], colors:[], storage_options:[], image_url:candidate.image?.url || null, image_source:candidate.image?.source || null, image_license:candidate.image?.license || null, image_author:candidate.image?.author || null, image_attribution_url:candidate.image?.attribution_url || null, source_system:'wikidata', source_key:qid, source_url:`https://www.wikidata.org/wiki/${qid}`, metadata:{description:candidate.description}, active:true, updated_at:new Date().toISOString() };
  const existing = await admin.from('device_catalog_models').select('id').eq('source_system','wikidata').eq('source_key',qid).maybeSingle();
  let saved;
  if (existing.data?.id) {
    const update = await admin.from('device_catalog_models').update(modelPayload).eq('id',existing.data.id).select('*,device_catalog_manufacturers(name)').single();
    if (update.error) throw update.error;
    saved = update.data;
  } else {
    const insert = await admin.from('device_catalog_models').insert(modelPayload).select('*,device_catalog_manufacturers(name)').single();
    if (insert.error) throw insert.error;
    saved = insert.data;
  }
  return saved;
}
function normalizeName(value: unknown) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
async function enrichLocalModel(admin: any, modelId: string) {
  const localResult = await admin.from('device_catalog_models').select('*,device_catalog_manufacturers(name)').eq('id',modelId).single();
  if (localResult.error || !localResult.data) throw localResult.error || new Error('Local device model was not found.');
  const local = localResult.data;
  const manufacturer = local.device_catalog_manufacturers?.name || '';
  const candidates = await searchCandidates([manufacturer,local.name].filter(Boolean).join(' '),local.category);
  const wanted = normalizeName(local.name), wantedManufacturer = normalizeName(manufacturer);
  const match = candidates.find((candidate:any) => {
    const candidateName = normalizeName(candidate.name), candidateManufacturer = normalizeName(candidate.manufacturer);
    const nameMatch = candidateName === wanted || candidateName.includes(wanted) || wanted.includes(candidateName);
    const manufacturerMatch = !wantedManufacturer || !candidateManufacturer || candidateManufacturer === wantedManufacturer || candidateManufacturer.includes(wantedManufacturer) || wantedManufacturer.includes(candidateManufacturer);
    return nameMatch && manufacturerMatch;
  });
  if (!match) return local;
  const patch:any = { image_url:match.image?.url || local.image_url || null, image_source:match.image?.source || local.image_source || null, image_license:match.image?.license || local.image_license || null, image_author:match.image?.author || local.image_author || null, image_attribution_url:match.image?.attribution_url || local.image_attribution_url || null, source_url:`https://www.wikidata.org/wiki/${match.qid}`, metadata:{...(local.metadata || {}),wikidata_qid:match.qid,wikidata_description:match.description || null}, updated_at:new Date().toISOString() };
  if ((!local.model_numbers || !local.model_numbers.length) && match.model_numbers?.length) patch.model_numbers=match.model_numbers;
  if (!local.release_year && match.release_year) patch.release_year=match.release_year;
  const updated = await admin.from('device_catalog_models').update(patch).eq('id',modelId).select('*,device_catalog_manufacturers(name)').single();
  if (updated.error) throw updated.error;
  return updated.data;
}

Deno.serve(async request => {
  const origin = request.headers.get('Origin');
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });
  if (request.method !== 'POST') return json(origin,{error:'Method not allowed.'},405);
  if (!allowedOrigins.has(origin || '')) return json(origin,{error:'Origin not allowed.'},403);
  try {
    const authorization = request.headers.get('Authorization') || '';
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global:{headers:{Authorization:authorization}} });
    const userResult = await userClient.auth.getUser();
    if (userResult.error || !userResult.data.user) return json(origin,{error:'Sign in required.'},401);
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const profile = await admin.from('profiles').select('id,active,location_id').eq('id',userResult.data.user.id).single();
    if (profile.error || !profile.data?.active || !profile.data?.location_id) return json(origin,{error:'Active staff access is required.'},403);
    const body = await request.json();
    const action = clean(body.action,20) || 'search';
    const category = clean(body.category,20);
    if (!allowedCategories.has(category)) return json(origin,{error:'Choose a valid device category.'},400);
    if (action === 'search') {
      const query = clean(body.query,120);
      if (query.length < 2) return json(origin,{error:'Enter at least two characters.'},400);
      const candidates = await searchCandidates(query,category);
      return json(origin,{candidates,source:'Wikidata / Wikimedia Commons'});
    }
    if (action === 'import') {
      const qid = clean(body.qid,24).toUpperCase();
      if (!/^Q\d+$/.test(qid)) return json(origin,{error:'Choose a valid Wikidata device record.'},400);
      const model = await importCandidate(admin,qid,category);
      return json(origin,{model,source:'Wikidata / Wikimedia Commons'},201);
    }
    if (action === 'enrich') {
      const modelId = clean(body.model_id,64);
      if (!/^[0-9a-f-]{36}$/i.test(modelId)) return json(origin,{error:'Choose a valid local device model.'},400);
      const model = await enrichLocalModel(admin,modelId);
      return json(origin,{model,source:'Wikidata / Wikimedia Commons'});
    }
    return json(origin,{error:'Unsupported action.'},400);
  } catch (error) {
    console.error(error);
    return json(origin,{error:'Unable to search the global device catalog right now.'},500);
  }
});