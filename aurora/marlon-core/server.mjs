import http from 'node:http';
import fs from 'node:fs';
import { authorizePortal, canReadAgentJob } from './portal-auth.mjs';
import worker from './worker.mjs';
import { assign as assignAgent, drain as drainAgents, getJob as getAgentJob, status as agentStatus } from './agents.mjs';

const HOST = process.env.MARLON_HOST || '127.0.0.1';
const PORT = Number(process.env.MARLON_PORT || 8788);
const OLLAMA = process.env.MARLON_OLLAMA_URL || 'http://127.0.0.1:11435';
const GI_B = 1024 ** 3;

function hostResources() {
  let available = 0;
  let load1 = 99;
  try {
    const mem = fs.readFileSync('/proc/meminfo', 'utf8');
    const match = mem.match(/^MemAvailable:\s+(\d+)\s+kB/im);
    available = match ? Number(match[1]) * 1024 : 0;
    load1 = Number(fs.readFileSync('/proc/loadavg', 'utf8').split(/\s+/)[0]);
  } catch {}
  return { available, load1 };
}

function chooseModel(input = {}) {
  const maxTokens = Number(input.max_completion_tokens || input.max_tokens || 900);
  const heavy = maxTokens >= 1400;
  const resources = hostResources();
  const allow7b = heavy && resources.available >= 8 * GI_B && resources.load1 < 6;
  return { model: allow7b ? 'qwen2.5:7b' : 'qwen2.5:3b', heavy, resources, maxTokens };
}
async function ollamaRun(_requestedModel, input = {}) {
  const pick = chooseModel(input);
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const temperature = Number.isFinite(Number(input.temperature)) ? Number(input.temperature) : 0.2;
  const numPredict = Math.min(Math.max(pick.maxTokens, 64), 4096);
  const body = {
    model: pick.model,
    messages,
    stream: false,
    keep_alive: pick.heavy ? '0s' : '60s',
    options: {
      temperature,
      num_predict: numPredict,
      num_ctx: pick.heavy ? 16384 : 8192,
      top_p: 0.9
    }
  };
  const response = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(pick.heavy ? 300000 : 150000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `Ollama failed (${response.status}).`);
  const text = String(data?.message?.content || data?.response || '').trim();
  if (!text) throw new Error('Ollama returned an empty response.');
  return { response: text, model: `local/${pick.model}` };
}
const env = {
  AI: { run: ollamaRun },
  PORTAL_ASSISTANT_NAME: process.env.PORTAL_ASSISTANT_NAME || 'Marlon',
  PUBLIC_ASSISTANT_NAME: process.env.PUBLIC_ASSISTANT_NAME || 'Marlon Customer Care',
  DISCORD_ASSISTANT_NAME: process.env.DISCORD_ASSISTANT_NAME || 'CrackWave',
  SUPABASE_URL: process.env.SUPABASE_URL || 'https://uvpmmbioerejeyybfntb.supabase.co',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
  AUDIT_SHARED_SECRET: process.env.AUDIT_SHARED_SECRET || ''
};

const MOBILE_SENTRIX_RELAY_PATH = '/internal/mobilesentrix-relay';
const MOBILE_SENTRIX_ALLOWED_PATHS = new Set(['/oauth/initiate', '/oauth/token']);
const PORTAL_ORIGINS = new Set(['https://portal.gotcracked.co']);

function cors(request) {
  const origin = request.headers.get('origin') || '';
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, x-gc-operator-token',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin'
  };
  if (PORTAL_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

async function handleMobileSentrixRelay(request) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  const access = await authorizePortal(request, env, ['inventory.manage','settings.manage']);
  if (!access.ok) {
    return new Response(JSON.stringify({ ok: false, error: access.error }), {
      status: access.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control':'no-store' }
    });
  }
  let body = {};
  try { body = await request.json(); } catch {}
  const path = String(body.path || '');
  const vendorAuthorization = String(body.vendorAuthorization || '');
  const vendorBody = typeof body.body === 'string' ? body.body : '';
  if (!MOBILE_SENTRIX_ALLOWED_PATHS.has(path) || !vendorAuthorization.startsWith('OAuth ') || vendorAuthorization.length > 4096 || vendorBody !== '') {
    return new Response(JSON.stringify({ ok: false, error: 'Relay request rejected.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  const vendorResponse = await fetch(`https://www.mobilesentrix.com${path}`, {
    method: 'POST',
    headers: {
      Authorization: vendorAuthorization,
      Accept: 'application/x-www-form-urlencoded, text/plain, */*',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'
    },
    body: vendorBody,
    redirect: 'manual',
    signal: AbortSignal.timeout(25000)
  });
  const text = await vendorResponse.text();
  return new Response(JSON.stringify({
    ok: vendorResponse.ok,
    status: vendorResponse.status,
    contentType: vendorResponse.headers.get('content-type') || '',
    text: text.slice(0, 8192)
  }), {
    // The relay transport succeeded; the caller handles the supplier status.
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function agentJson(request, body, status = 200) {
  return Response.json(body, { status, headers:{...cors(request),'Cache-Control':'no-store'} });
}

const runAgentInference = (system, messages, maxTokens) => ollamaRun('agent', {
  messages: [{ role:'system', content:system }, ...messages],
  max_completion_tokens:maxTokens,
  temperature:0.1
});

async function handleAgents(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status:204, headers:cors(request) });
  const access = await authorizePortal(request, env, ['dashboard.view']);
  if (!access.ok) {
    return agentJson(request, { ok:false, error:access.error }, access.status);
  }
  const management = await authorizePortal(request, env, ['settings.manage']);
  const isManager = management.ok;
  const isAutomation = access.profile.account_type === 'automation' && access.profile.role === 'automation';
  if (!isManager && !isAutomation) return agentJson(request,{ok:false,error:'Agent management access required.'},403);
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/agents/status') {
    const status=agentStatus();
    status.queue=status.queue.filter(job=>canReadAgentJob(job,access.profile,isManager));
    status.recent=status.recent.filter(job=>canReadAgentJob(job,access.profile,isManager));
    return agentJson(request, { ok:true, ...status });
  }
  if (request.method === 'GET' && url.pathname === '/agents/job') {
    const job = getAgentJob(url.searchParams.get('id') || '');
    const allowed=canReadAgentJob(job,access.profile,isManager);
    return agentJson(request, allowed ? { ok:true, job } : { ok:false, error:'Agent job not found.' }, allowed ? 200 : 404);
  }
  if (request.method === 'POST' && url.pathname === '/agents/assign') {
    let body = {};
    try { body = await request.json(); } catch {}
    try {
      const job = assignAgent({...body,requestedBy:access.profile.id,locationId:access.profile.location_id});
      void drainAgents(runAgentInference);
      return agentJson(request, { ok:true, job }, 202);
    } catch (error) {
      return agentJson(request, { ok:false, error:String(error?.message || error) }, 400);
    }
  }
  return agentJson(request, { ok:false, error:'Agent endpoint not found.' }, 404);
}

async function nodeRequest(req) {
  const chunks = [];
  let bytes=0;
  for await (const chunk of req) {
    bytes+=chunk.length;
    if(bytes>1024*1024)throw Object.assign(new Error('Request too large.'),{status:413});
    chunks.push(Buffer.from(chunk));
  }
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = req.headers.host || `127.0.0.1:${PORT}`;
  const init = { method: req.method, headers: req.headers };
  if (body && !['GET', 'HEAD'].includes(String(req.method))) init.body = body;
  return new Request(`${proto}://${host}${req.url || '/'}`, init);
}

async function writeResponse(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const bytes = Buffer.from(await response.arrayBuffer());
  res.end(bytes);
}
const server = http.createServer(async (req, res) => {
  try {
    const request = await nodeRequest(req);
    const requestUrl = new URL(request.url);
    if (requestUrl.pathname === MOBILE_SENTRIX_RELAY_PATH) {
      const response = await handleMobileSentrixRelay(request);
      await writeResponse(res, response);
      return;
    }
    if (requestUrl.pathname.startsWith('/agents/')) {
      const response = await handleAgents(request);
      await writeResponse(res, response);
      return;
    }
    if (requestUrl.pathname.startsWith('/portal/') && request.method !== 'OPTIONS') {
      const access=await authorizePortal(request,env,['dashboard.view']);
      if(!access.ok){await writeResponse(res,agentJson(request,{ok:false,error:access.error},access.status));return;}
    }
    const pending = [];
    const ctx = { waitUntil(promise) { pending.push(Promise.resolve(promise).catch(console.error)); } };
    const response = await worker.fetch(request, env, ctx);
    await writeResponse(res, response);
    if (pending.length) void Promise.allSettled(pending);
  } catch (error) {
    console.error('Marlon core request failed', error);
    if (!res.headersSent) res.writeHead(error?.status === 413 ? 413 : 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Marlon core request failed.' }));
  }
});

server.requestTimeout = 320000;
server.headersTimeout = 325000;
server.keepAliveTimeout = 65000;
server.listen(PORT, HOST, () => {
  console.log(`Marlon core listening on http://${HOST}:${PORT}`);
  setTimeout(() => void drainAgents(runAgentInference), 2500).unref();
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
