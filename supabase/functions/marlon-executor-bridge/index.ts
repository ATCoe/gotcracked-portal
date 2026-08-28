import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const EXPECTED_ISSUER = 'https://token.actions.githubusercontent.com';
const EXPECTED_AUDIENCE = 'gotcracked-marlon-executor';
const EXPECTED_REPOSITORIES = new Set(['ATCoe/gotcracked-portal','ATCoe/gotcracked-site']);
const EXPECTED_REF = 'refs/heads/main';
const JWKS_URL = 'https://token.actions.githubusercontent.com/.well-known/jwks';

let jwksCache: { keys: JsonWebKey[]; expiresAt: number } | null = null;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function b64urlBytes(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function b64urlJson(value: string) {
  return JSON.parse(new TextDecoder().decode(b64urlBytes(value)));
}

async function getJwks() {
  const now = Date.now();
  if (jwksCache && jwksCache.expiresAt > now) return jwksCache.keys;
  const res = await fetch(JWKS_URL, { headers: { 'User-Agent': 'GotCracked-Marlon-Executor' } });
  if (!res.ok) throw new Error(`GitHub JWKS unavailable (${res.status}).`);
  const body: any = await res.json();
  if (!Array.isArray(body?.keys)) throw new Error('GitHub JWKS payload is invalid.');
  jwksCache = { keys: body.keys, expiresAt: now + 60 * 60 * 1000 };
  return jwksCache.keys;
}

async function verifyGithubOidc(request: Request) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) throw new Error('GitHub OIDC bearer token required.');
  const token = auth.slice(7).trim();
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid GitHub OIDC token.');
  const header: any = b64urlJson(parts[0]);
  const claims: any = b64urlJson(parts[1]);
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Unsupported GitHub OIDC signing algorithm.');
  const keys = await getJwks();
  const jwk: any = keys.find((key: any) => key.kid === header.kid);
  if (!jwk) throw new Error('GitHub OIDC signing key not found.');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const verified = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    b64urlBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  if (!verified) throw new Error('GitHub OIDC signature verification failed.');
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== EXPECTED_ISSUER) throw new Error('Unexpected GitHub OIDC issuer.');
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(EXPECTED_AUDIENCE)) throw new Error('Unexpected GitHub OIDC audience.');
  if (claims.exp && Number(claims.exp) < now - 30) throw new Error('GitHub OIDC token expired.');
  if (claims.nbf && Number(claims.nbf) > now + 30) throw new Error('GitHub OIDC token not active yet.');
  if (!EXPECTED_REPOSITORIES.has(String(claims.repository || ''))) throw new Error('Unexpected GitHub repository.');
  if (claims.ref !== EXPECTED_REF) throw new Error('Executor may run only from main.');
  if (!['schedule', 'workflow_dispatch'].includes(String(claims.event_name || ''))) throw new Error('Unsupported GitHub Actions event.');
  return claims;
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'POST required.' }, 405);
  try {
    const claims = await verifyGithubOidc(request);
    const body: any = await request.json().catch(() => ({}));
    const action = String(body.action || '').trim().toLowerCase();
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const executor = `github-actions:${claims.repository || 'unknown'}:${claims.run_id || 'unknown'}:${claims.run_attempt || '1'}`;

    if (action === 'claim') {
      const { data, error } = await admin.rpc('claim_next_marlon_execution', { p_executor: executor, p_repository: claims.repository });
      if (error) throw error;
      let history: any[] = [];
      if (data?.ticket?.id) {
        const prior = await admin.rpc('marlon_execution_history_context', { p_ticket_id: data.ticket.id, p_limit: 8 });
        if (prior.error) console.error('Marlon execution history lookup failed', prior.error);
        else if (Array.isArray(prior.data)) history = prior.data;
      }
      return json({ ok: true, executor, ...data, history });
    }

    if (action === 'proposal_context') {
      if (claims.repository !== 'ATCoe/gotcracked-portal') throw new Error('Proposal scouting is restricted to the Portal orchestration workflow.');
      const { data, error } = await admin.from('portal_suggestions')
        .select('id,surface,title,description,status,owner_review_state,created_at')
        .eq('source','marlon')
        .order('created_at',{ascending:false})
        .limit(100);
      if (error) throw error;
      return json({ ok: true, proposals: data || [] });
    }

    if (action === 'create_proposal') {
      if (claims.repository !== 'ATCoe/gotcracked-portal') throw new Error('Proposal creation is restricted to the Portal orchestration workflow.');
      const proposal = body.proposal && typeof body.proposal === 'object' ? body.proposal : null;
      if (!proposal) return json({ error: 'proposal is required.' }, 400);
      const { data, error } = await admin.rpc('create_marlon_improvement_proposal', {
        p_surface: proposal.surface ?? 'portal',
        p_title: proposal.title ?? '',
        p_description: proposal.description ?? '',
        p_business_value: proposal.businessValue ?? null,
        p_user_impact: proposal.userImpact ?? null,
        p_complexity: proposal.complexity ?? 'medium',
        p_suggestion_type: proposal.suggestionType ?? 'workflow_improvement',
        p_evidence: {
          evidence_summary: proposal.evidenceSummary ?? null,
          github_run_id: claims.run_id || null,
          github_sha: claims.sha || null,
          scout_source: 'portal-and-website'
        }
      });
      if (error) throw error;
      return json({ ok: true, proposal: data });
    }

    if (action === 'deployment_gate') {
      const ticketId = String(body.ticketId || '').trim();
      const commitSha = String(body.commitSha || '').trim();
      const changeSize = String(body.changeSize || 'small').trim().toLowerCase();
      const featureUpdate = body.featureUpdate === true;
      if (!ticketId || !commitSha) return json({ error: 'ticketId and commitSha are required.' }, 400);
      const { data, error } = await admin.rpc('marlon_deployment_gate', {
        p_ticket: ticketId,
        p_commit_sha: commitSha,
        p_change_size: changeSize,
        p_feature_update: featureUpdate
      });
      if (error) throw error;
      return json({ ok: true, gate: data });
    }

    if (action === 'report') {
      const runId = String(body.runId || '').trim();
      const status = String(body.status || '').trim();
      if (!runId || !status) return json({ error: 'runId and status are required.' }, 400);
      const { data, error } = await admin.rpc('report_marlon_execution', {
        p_run_id: runId,
        p_status: status,
        p_diagnosis: body.diagnosis ?? null,
        p_patch_summary: body.patchSummary ?? null,
        p_resolution: body.resolution ?? null,
        p_commit_sha: body.commitSha ?? null,
        p_deployment_url: body.deploymentUrl ?? null,
        p_verification: body.verification && typeof body.verification === 'object' ? body.verification : {},
        p_error: body.error ?? null,
        p_metadata: {
          ...(body.metadata && typeof body.metadata === 'object' ? body.metadata : {}),
          github_run_id: claims.run_id || null,
          github_run_attempt: claims.run_attempt || null,
          github_actor: claims.actor || null,
          github_sha: claims.sha || null
        }
      });
      if (error) throw error;
      return json({ ok: true, ...data });
    }

    return json({ error: 'Unknown executor action.' }, 400);
  } catch (error: any) {
    console.error('Marlon executor bridge error', error);
    return json({ error: String(error?.message || error || 'Executor request failed.') }, 401);
  }
});
