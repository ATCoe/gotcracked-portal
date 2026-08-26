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

const recommendationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    build_name: { type: 'string' },
    customer_summary: { type: 'string' },
    performance_summary: { type: 'string' },
    upgrade_summary: { type: 'string' },
    compatibility_summary: { type: 'string' },
    budget_note: { type: 'string' },
    budget_fit: { type: 'boolean' },
    estimated_wattage: { type: 'integer' },
    parts: {
      type: 'array', minItems: 7, maxItems: 11,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          category: { type: 'string', enum: ['CPU','CPU Cooler','Motherboard','Memory','Storage','GPU','Case','Power Supply','Operating System','Monitor','Other'] },
          name: { type: 'string' },
          price_cents: { type: 'integer' },
          retailer: { type: 'string' },
          source_url: { type: 'string' },
          rationale: { type: 'string' }
        },
        required: ['category','name','price_cents','retailer','source_url','rationale']
      }
    }
  },
  required: ['build_name','customer_summary','performance_summary','upgrade_summary','compatibility_summary','budget_note','budget_fit','estimated_wattage','parts']
};

function outputText(response: any) {
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  return '';
}

async function allow(admin: ReturnType<typeof createClient>, request: Request) {
  const result = await admin.rpc('consume_public_rate_limit', {
    p_kind: 'custom-pc-build',
    p_key_hash: await hash(clientKey(request)),
    p_limit: 6,
    p_window_seconds: 3600
  });
  if (result.error) {
    console.error('PC build rate limiter unavailable:', result.error.message);
    return true;
  }
  return result.data === true;
}

function publicRecommendation(raw: any) {
  return {
    buildName: raw.build_name,
    summary: raw.customer_summary,
    performance: raw.performance_summary,
    upgradePath: raw.upgrade_summary,
    compatibility: raw.compatibility_summary,
    budgetNote: raw.budget_note,
    budgetFit: raw.budget_fit,
    estimatedWattage: raw.estimated_wattage,
    parts: (raw.parts || []).map((part: any) => ({ category: part.category, name: part.name, rationale: part.rationale }))
  };
}

async function researchBuild(survey: Record<string, unknown>, partBudgetCents: number) {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.');
  const model = Deno.env.get('PC_BUILD_RESEARCH_MODEL') || 'gpt-5-mini';
  const prompt = `You are the sourcing and compatibility engine for GotCracked, an electronics repair and custom-PC shop in Blacksburg, Virginia. Build a CURRENT new-parts PC recommendation for the customer survey below.

Rules:
- Use live web search before choosing parts. Prioritize current US listings from Newegg and Amazon; use Micro Center, B&H, Best Buy, manufacturer stores, or other reputable US retailers only when they are a materially better/current source.
- New components only. Do not use auctions, used/refurbished listings, marketplace sellers with unclear fulfillment, or out-of-stock placeholder prices.
- Every returned price must be a current price you found in the cited source URL. Do not invent MSRP or historical prices.
- The available PARTS budget is ${money(partBudgetCents)}. This excludes GotCracked assembly/service labor, which is calculated separately by our server.
- Optimize the actual configuration for the customer's use. For gaming, prioritize the games, resolution, target frame rate, image quality, ray tracing preference, and monitor scope in the survey rather than chasing prestige parts.
- Verify CPU socket, motherboard/chipset, RAM type, case/motherboard/GPU/cooler dimensions, PSU capacity/connectors, cooling needs, and storage interfaces.
- Use a quality PSU with appropriate headroom. Avoid questionable no-name components.
- If the requested goals cannot honestly fit the parts budget, return the closest practical system and set budget_fit false with a concise explanation.
- RAM is currently unusually expensive. Do not solve that by under-speccing memory below the workload's practical needs; choose the minimum sensible capacity and account for current market prices.
- Include Windows only if the survey says an OS license is needed. Include a monitor only if the survey budget scope includes one.
- Return concise customer-facing explanations. Do not mention individual prices in summaries.

Customer survey JSON:
${JSON.stringify(survey)}`;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      store: false,
      tools: [{ type: 'web_search' }],
      input: prompt,
      text: { format: { type: 'json_schema', name: 'pc_build_recommendation', strict: true, schema: recommendationSchema } }
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
    let url: URL;
    try { url = new URL(part.source_url); } catch { throw new Error(`Invalid source URL for ${part.category}.`); }
    if (url.protocol !== 'https:') throw new Error(`Non-HTTPS source for ${part.category}.`);
  }
  return { recommendation, model };
}

async function notifyLead(lead: Record<string, any>, reference: string, totalCents: number | null) {
  const token = Deno.env.get('DISCORD_BOT_TOKEN');
  const channelId = Deno.env.get('DISCORD_LEAD_CHANNEL_ID');
  if (!token || !channelId) return;
  const fields = [
    { name: 'Contact', value: [lead.phone, lead.email].filter(Boolean).join(' · ') || 'No contact details', inline: false },
    { name: 'Reference', value: reference, inline: true },
    { name: 'Estimate', value: totalCents == null ? 'Manual research required' : money(totalCents), inline: true }
  ];
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      allowed_mentions: { parse: [] },
      embeds: [{ title: `Custom PC build · ${lead.name}`, description: lead.notes || 'New custom PC build request', color: 0x0a8fff, fields, footer: { text: 'GotCracked custom PC build request' }, timestamp: new Date().toISOString() }]
    })
  });
  if (!response.ok) console.error('PC build Discord alert failed:', response.status, await response.text());
}

Deno.serve(async request => {
  const origin = request.headers.get('Origin');
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });
  if (request.method !== 'POST') return json(origin, { error: 'Method not allowed.' }, 405);
  if (!allowedOrigins.has(origin || '')) return json(origin, { error: 'Origin not allowed.' }, 403);

  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    if (!(await allow(admin, request))) return json(origin, { error: 'Too many build requests from this connection. Please try again later.' }, 429);

    const body = await request.json();
    if (clean(body.companyWebsite, 100)) return json(origin, { error: 'Unable to submit the build request.' }, 400);
    const startedAt = Number(body.formStartedAt || 0);
    if (!startedAt || Date.now() - startedAt < 4000 || Date.now() - startedAt > 86400000) return json(origin, { error: 'Please reload the page and try again.' }, 400);

    const customerName = clean(body.customerName, 160);
    const customerEmail = clean(body.customerEmail, 160).toLowerCase();
    const customerPhone = clean(body.customerPhone, 40);
    const preferredContact = clean(body.preferredContact, 20) || 'No preference';
    const budgetDollars = Number(body.budget);
    if (!customerName || !/^\S+@\S+\.\S+$/.test(customerEmail) || digits(customerPhone).length < 7 || !Number.isFinite(budgetDollars) || budgetDollars < 700 || body.consent !== 'on') {
      return json(origin, { error: 'Complete the required contact, budget, and consent fields.' }, 400);
    }

    const locationId = Deno.env.get('DEFAULT_LOCATION_ID')!;
    if (!locationId) throw new Error('DEFAULT_LOCATION_ID is not configured.');
    const settingsResult = await admin.from('business_settings').select('custom_pc_build_service_charge_cents,custom_pc_build_estimate_valid_days').eq('location_id', locationId).maybeSingle();
    if (settingsResult.error) throw settingsResult.error;
    const serviceChargeCents = Number(settingsResult.data?.custom_pc_build_service_charge_cents ?? 24999);
    const validDays = Number(settingsResult.data?.custom_pc_build_estimate_valid_days ?? 7);
    const budgetCents = Math.round(budgetDollars * 100);
    const partBudgetCents = budgetCents - serviceChargeCents;
    if (partBudgetCents < 40000) return json(origin, { error: `The entered budget is below the practical minimum after the custom-build service. Increase the budget and try again.` }, 400);

    const survey = {
      primaryUse: clean(body.primaryUse, 80),
      secondaryUses: clean(body.secondaryUses, 400),
      games: clean(body.games, 800),
      creativeApps: clean(body.creativeApps, 500),
      resolution: clean(body.resolution, 40),
      targetFps: clean(body.targetFps, 40),
      imageQuality: clean(body.imageQuality, 60),
      rayTracing: clean(body.rayTracing, 40),
      budget: budgetDollars,
      budgetScope: clean(body.budgetScope, 60),
      rgb: clean(body.rgb, 60),
      color: clean(body.color, 40),
      caseSize: clean(body.caseSize, 60),
      noise: clean(body.noise, 60),
      storage: clean(body.storage, 60),
      wifi: clean(body.wifi, 20),
      osNeeded: clean(body.osNeeded, 20),
      upgradePriority: clean(body.upgradePriority, 60),
      longevity: clean(body.longevity, 40),
      existingParts: clean(body.existingParts, 800),
      notes: clean(body.notes, 1000)
    };

    const reference = `GCP-${crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`;
    const leadNotes = [
      'Custom PC build survey',
      `Budget: ${money(budgetCents)}`,
      `Primary use: ${survey.primaryUse || 'Not specified'}`,
      survey.games ? `Games: ${survey.games}` : null,
      survey.resolution ? `Target: ${survey.resolution} · ${survey.targetFps || 'FPS flexible'} · ${survey.imageQuality || 'quality flexible'}` : null,
      `Aesthetics: ${survey.color || 'any'} · ${survey.rgb || 'RGB flexible'}`,
      survey.notes || null
    ].filter(Boolean).join('\n');

    const leadResult = await admin.from('leads').insert({
      external_id: `pcbuild-${crypto.randomUUID()}`,
      public_reference: reference,
      location_id: locationId,
      name: customerName,
      phone: customerPhone,
      email: customerEmail,
      service: 'Custom PC build',
      source: 'gotcracked.co/custom-pc-build',
      notes: leadNotes,
      status: 'new'
    }).select().single();
    if (leadResult.error) throw leadResult.error;

    const requestResult = await admin.from('pc_build_requests').insert({
      location_id: locationId,
      lead_id: leadResult.data.id,
      public_reference: reference,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      preferred_contact: preferredContact,
      survey,
      service_charge_cents: serviceChargeCents,
      status: 'research_pending',
      research_provider: 'openai'
    }).select().single();
    if (requestResult.error) throw requestResult.error;

    try {
      const researched = await researchBuild(survey, partBudgetCents);
      const raw = researched.recommendation;
      const partsCostCents = raw.parts.reduce((sum: number, part: any) => sum + Number(part.price_cents || 0), 0);
      const totalCents = partsCostCents + serviceChargeCents;
      const validUntil = new Date(Date.now() + validDays * 86400000).toISOString();
      const internalParts = raw.parts;
      const sourceUrls = [...new Set(raw.parts.map((part: any) => part.source_url))];
      const customer = publicRecommendation(raw);

      const update = await admin.from('pc_build_requests').update({
        recommendation: customer,
        internal_parts: internalParts,
        source_urls: sourceUrls,
        parts_cost_cents: partsCostCents,
        estimated_total_cents: totalCents,
        estimate_valid_until: validUntil,
        status: 'estimated',
        research_model: researched.model,
        research_error: null,
        updated_at: new Date().toISOString()
      }).eq('id', requestResult.data.id);
      if (update.error) throw update.error;

      await admin.from('lead_events').insert({ lead_id: leadResult.data.id, event_type: 'note', message: `Automated custom-PC research completed. Customer estimate: ${money(totalCents)}. Internal parts research is stored on PC build request ${reference}.` });
      await notifyLead({ ...leadResult.data, notes: leadNotes }, reference, totalCents);

      return json(origin, {
        ok: true,
        reference,
        status: 'estimated',
        recommendation: customer,
        estimatedTotalCents: totalCents,
        estimateValidUntil: validUntil,
        ramMarketNotice: 'Memory prices are unusually high as AI/data-center demand and HBM production consume more global DRAM capacity. Industry forecasts expect supply to remain constrained through 2027, with more meaningful relief potentially arriving in late 2027 into 2028 as new capacity ramps. This estimate uses current market pricing and may change.'
      }, 201);
    } catch (researchError) {
      console.error('Custom PC research failed:', researchError);
      const message = researchError instanceof Error ? researchError.message : 'Automated research failed.';
      await admin.from('pc_build_requests').update({ status: 'manual_review', research_error: message.slice(0, 1000), updated_at: new Date().toISOString() }).eq('id', requestResult.data.id);
      await admin.from('lead_events').insert({ lead_id: leadResult.data.id, event_type: 'note', message: 'Automated custom-PC research could not complete. Manual build review is required.' });
      await notifyLead({ ...leadResult.data, notes: leadNotes }, reference, null);
      return json(origin, { ok: true, reference, status: 'manual_review', message: 'Your build survey was received. A GotCracked specialist will review the configuration and current parts market before sending the estimate.' }, 202);
    }
  } catch (error) {
    console.error(error);
    return json(origin, { error: 'Unable to prepare the custom PC build request right now. Please contact GotCracked for help.' }, 500);
  }
});
