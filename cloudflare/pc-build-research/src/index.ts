import puppeteer from '@cloudflare/puppeteer';

interface Env {
  AI: Ai;
  BROWSER: Fetcher;
  AI_MODEL: string;
  RESEARCH_SHARED_TOKEN: string;
}

type Json = Record<string, unknown>;
const coreCategories = ['CPU','CPU Cooler','Motherboard','Memory','Storage','GPU','Case','Power Supply'];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type':'application/json', 'cache-control':'no-store' } });

function statefulBuilderUrl(value: unknown) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && /(^|\.)newegg\.com$/i.test(url.hostname) && url.pathname.startsWith('/tools/custom-pc-builder/pl/ID-') && Boolean(url.searchParams.get('tempPcbId') || (url.searchParams.get('diywishlist') && url.searchParams.get('diywishlist') !== '0'));
  } catch { return false; }
}

function parseAiJson(result: unknown): Json {
  const response = (result as { response?: unknown })?.response;
  if (response && typeof response === 'object') return response as Json;
  const text = String(response || '').replace(/^```(?:json)?\s*|\s*```$/g, '');
  return JSON.parse(text) as Json;
}

async function collectPublicEvidence(env: Env, survey: Json) {
  const browser = await puppeteer.launch(env.BROWSER);
  const page = await browser.newPage();
  try {
    await page.setUserAgent('GotCracked-PC-Research/1.0 (+https://gotcracked.co/privacy.html)');
    const query = encodeURIComponent(`${String(survey.primaryUse || 'custom PC')} ${String(survey.resolution || '')} PC parts`);
    await page.goto(`https://www.newegg.com/p/pl?d=${query}`, { waitUntil:'domcontentloaded', timeout:25000 });
    const evidence = await page.evaluate(() => Array.from(document.querySelectorAll('.item-cell')).slice(0, 24).map(card => ({
      name: card.querySelector('.item-title')?.textContent?.trim() || '',
      price: card.querySelector('.price-current')?.textContent?.trim() || '',
      url: (card.querySelector('.item-title') as HTMLAnchorElement | null)?.href || '',
      availability: card.textContent?.includes('OUT OF STOCK') ? 'out_of_stock' : 'shown'
    })).filter(item => item.name && item.url));
    return evidence;
  } finally { await browser.close(); }
}

async function verifyWithNewegg(env: Env, recommendation: Json) {
  const browser = await puppeteer.launch(env.BROWSER);
  const page = await browser.newPage();
  try {
    // Public builder only: never authenticate, add to cart, or enter personal data.
    await page.goto('https://www.newegg.com/tools/custom-pc-builder', { waitUntil:'domcontentloaded', timeout:30000 });
    const parts = Array.isArray(recommendation.parts) ? recommendation.parts as Json[] : [];
    const evidence = parts.filter(part => coreCategories.includes(String(part.category))).map(part => ({ category:String(part.category), name:String(part.name || ''), url:String(part.newegg_product_url || '') }));
    // A provider-produced URL is treated only as a navigation candidate. Browser Run must load it and observe configured state.
    const candidate = String((recommendation.newegg_compatibility as Json | undefined)?.builder_url || '');
    if (!statefulBuilderUrl(candidate)) return { verified:false, reason:'Browser Run did not receive a stateful Newegg Builder URL.', evidence };
    await page.goto(candidate, { waitUntil:'domcontentloaded', timeout:30000 });
    const observedUrl = page.url();
    const body = await page.evaluate(() => document.body.innerText.slice(0, 120000));
    const checked = evidence.filter(part => part.name && body.toLowerCase().includes(part.name.toLowerCase().slice(0, 35))).map(part => part.category);
    const wattageMatch = body.match(/(?:minimum|required|estimated)[^\d]{0,30}(\d{3,4})\s*w/i);
    const minWattage = Number(wattageMatch?.[1] || 0);
    const allObserved = evidence.length >= 7 && evidence.every(part => checked.includes(part.category));
    return { verified:statefulBuilderUrl(observedUrl) && allObserved && minWattage > 0, builderUrl:observedUrl, checkedCategories:[...new Set(checked)], minWattage, evidence, reason:allObserved ? '' : 'Exact selected models were not all observable in the stateful Builder.' };
  } finally { await browser.close(); }
}

async function research(env: Env, survey: Json, partBudgetCents: number) {
  const retailEvidence = await collectPublicEvidence(env, survey);
  const prompt = `Return JSON only. You are GotCracked's PC parts research assistant. Select a complete new-parts build for the anonymous survey and a parts budget of $${(partBudgetCents/100).toFixed(0)}. Use only current HTTPS product evidence supplied below; never invent a price or URL. If evidence is insufficient, set newegg_compatibility.status to manual_review. Include build_name, customer_summary, performance_summary, upgrade_summary, compatibility_summary, budget_note, budget_fit, estimated_wattage, parts, newegg_compatibility, and spec_checks. Parts need category, name, price_cents, retailer, source_url, newegg_product_url, rationale. Required categories: CPU, Motherboard, Memory, Storage, Case, Power Supply and normally CPU Cooler and GPU. Compatibility must include exact sockets, DDR generation, form factors, GPU/case dimensions, cooler fit, storage interfaces, BIOS support, PSU connectors and wattage. A verified status is only provisional: Browser Run will independently downgrade it unless it observes a stateful Newegg Builder. Do not include customer-facing individual prices.\nSURVEY=${JSON.stringify(survey)}\nRETAIL_EVIDENCE=${JSON.stringify(retailEvidence)}`;
  const aiResult = await env.AI.run(env.AI_MODEL as keyof AiModels, { messages:[{ role:'system', content:'Be conservative. Missing current evidence always means manual_review.' },{ role:'user', content:prompt }], response_format:{ type:'json_object' } } as never);
  const recommendation = parseAiJson(aiResult);
  const browserAudit = await verifyWithNewegg(env, recommendation);
  const audit = (recommendation.newegg_compatibility && typeof recommendation.newegg_compatibility === 'object' ? recommendation.newegg_compatibility : {}) as Json;
  recommendation.newegg_compatibility = {
    ...audit,
    status: browserAudit.verified ? 'verified' : 'manual_review',
    builder_url: browserAudit.builderUrl || '',
    min_wattage_estimate: browserAudit.minWattage || 0,
    checked_categories: browserAudit.checkedCategories || [],
    notes: browserAudit.verified ? 'Browser Run loaded the stateful Newegg build and observed every selected core model.' : browserAudit.reason,
    manufacturer_crosscheck: String(audit.manufacturer_crosscheck || '')
  };
  return { recommendation, model:env.AI_MODEL, browserAudit };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') return json({ error:'Method not allowed.' }, 405);
    const authorization = request.headers.get('authorization');
    if (!env.RESEARCH_SHARED_TOKEN || authorization !== `Bearer ${env.RESEARCH_SHARED_TOKEN}`) return json({ error:'Unauthorized.' }, 401);
    try {
      const body = await request.json() as Json;
      const survey = body.survey;
      const partBudgetCents = Number(body.partBudgetCents);
      if (!survey || typeof survey !== 'object' || !Number.isInteger(partBudgetCents) || partBudgetCents < 40000) return json({ error:'Invalid research request.' }, 400);
      return json(await research(env, survey as Json, partBudgetCents));
    } catch (error) {
      console.error('PC build research failed', error);
      return json({ error:'Cloudflare research could not complete.' }, 503);
    }
  }
};

