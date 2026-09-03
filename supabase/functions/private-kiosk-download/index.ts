import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { KIOSK_BUNDLE_BASE64 } from './kiosk-bundle.ts';

const allowedOrigins = new Set([
  'https://portal.gotcracked.co',
  'http://localhost:8788',
  'http://127.0.0.1:8788'
]);

function cors(request: Request) {
  const origin = request.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'https://portal.gotcracked.co',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(request), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function decodeBundle() {
  return Uint8Array.from(atob(KIOSK_BUNDLE_BASE64), character => character.charCodeAt(0));
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors(request) });
  if (request.method !== 'POST') return json(request, { error: 'Method not allowed.' }, 405);
  if (!allowedOrigins.has(request.headers.get('origin') || '')) return json(request, { error: 'Origin not allowed.' }, 403);

  try {
    const authorization = request.headers.get('authorization') || '';
    if (!authorization.startsWith('Bearer ')) return json(request, { error: 'Sign in is required.' }, 401);

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authorization } } }
    );
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json(request, { error: 'Sign in is required.' }, 401);

    const { data: access, error: accessError } = await userClient.rpc('portal_kiosk_download_access_status');
    if (accessError || access?.allowed !== true) {
      return json(request, { error: 'An active owner or manager session is required to download kiosk setup.' }, 403);
    }

    return new Response(decodeBundle(), {
      status: 200,
      headers: {
        ...cors(request),
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="gotcracked-kiosk-0.1.0.zip"',
        'Cache-Control': 'no-store, private',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (error) {
    console.error('private-kiosk-download', error);
    return json(request, { error: 'Unable to prepare kiosk setup. Please sign in again and retry.' }, 500);
  }
});