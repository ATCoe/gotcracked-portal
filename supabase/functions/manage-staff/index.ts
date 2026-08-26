import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
    headers: { ...cors(request), 'Content-Type': 'application/json' }
  });
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors(request) });
  if (request.method !== 'POST') return json(request, { error: 'Method not allowed.' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const authorization = request.headers.get('Authorization') || '';
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authorization } }
    });
    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json(request, { error: 'Sign in required.' }, 401);

    const { data: actor } = await admin.from('profiles').select('id,location_id,role,active').eq('id', user.id).single();
    if (!actor?.active || !['owner', 'manager'].includes(actor.role)) {
      return json(request, { error: 'Only active owners and managers can manage staff.' }, 403);
    }

    const body = await request.json();
    if (body.action === 'list') {
      const result = await admin.from('profiles')
        .select('id,display_name,role,active,discord_user_id')
        .eq('location_id', actor.location_id)
        .order('display_name');
      if (result.error) throw result.error;
      return json(request, { staff: result.data || [] });
    }
    const targetUserId = String(body.targetUserId || '');
    if (!targetUserId) return json(request, { error: 'A staff member is required.' }, 400);
    if (targetUserId === user.id && body.active === false) {
      return json(request, { error: 'You cannot deactivate your own account.' }, 400);
    }

    const { data: target } = await admin.from('profiles')
      .select('id,location_id,display_name,role,active,discord_user_id')
      .eq('id', targetUserId)
      .single();
    if (!target || target.location_id !== actor.location_id) {
      return json(request, { error: 'Staff member not found for this location.' }, 404);
    }
    if (target.role === 'owner' && (actor.role !== 'owner' || target.id === user.id || body.role !== undefined)) {
      return json(request, { error: 'Owner roles are protected; another owner may only activate or deactivate the account.' }, 403);
    }
    if (actor.role === 'manager' && target.role === 'manager') {
      return json(request, { error: 'Managers cannot manage other managers.' }, 403);
    }

    const updates: Record<string, unknown> = {};
    if (typeof body.active === 'boolean') updates.active = body.active;
    if (body.role !== undefined) {
      const role = String(body.role);
      if (!['manager', 'technician', 'front_desk'].includes(role)) return json(request, { error: 'That role cannot be assigned.' }, 400);
      if (role === 'manager' && actor.role !== 'owner') return json(request, { error: 'Only an owner can assign the manager role.' }, 403);
      updates.role = role;
    }
    if (!Object.keys(updates).length && !body.removeFromDiscord) return json(request, { error: 'No staff changes were requested.' }, 400);

    let updated = target;
    if (Object.keys(updates).length) {
      const result = await admin.from('profiles').update(updates).eq('id', target.id).select('id,display_name,role,active,discord_user_id').single();
      if (result.error) throw result.error;
      updated = result.data;
    }

    let discordRemoved = false;
    let warning: string | null = null;
    if (body.removeFromDiscord && target.discord_user_id) {
      const botToken = Deno.env.get('DISCORD_BOT_TOKEN');
      const guildId = Deno.env.get('DISCORD_GUILD_ID');
      if (!botToken || !guildId) warning = 'Portal access changed, but Discord removal is not configured.';
      else {
        const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${target.discord_user_id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bot ${botToken}`, 'X-Audit-Log-Reason': 'GotCracked Portal staff deactivation' }
        });
        if (response.ok || response.status === 404) discordRemoved = true;
        else warning = `Portal access changed, but Discord removal failed (${response.status}).`;
      }
    }

    return json(request, { staff: updated, discordRemoved, warning });
  } catch (error) {
    console.error(error);
    return json(request, { error: 'Unable to update staff access.' }, 500);
  }
});
