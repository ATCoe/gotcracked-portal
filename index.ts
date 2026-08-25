import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://portal.gotcracked.co',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const allowedRoles = new Set(['owner', 'manager', 'technician', 'front_desk']);

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function temporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const random = Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
  return `Gc!${random}7a`;
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return response({ ok: false, error: 'Method not allowed.' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const secretKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY');
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');

  if (!supabaseUrl || !secretKey) {
    return response({ ok: false, error: 'The staff manager is missing its server configuration.' }, 500);
  }

  if (!token) {
    return response({ ok: false, error: 'Sign in again before managing staff accounts.' }, 401);
  }

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
  });

  const { data: callerData, error: callerError } = await admin.auth.getUser(token);
  const caller = callerData?.user;

  if (callerError || !caller) {
    return response({ ok: false, error: 'Your session could not be verified. Sign in again.' }, 401);
  }

  const { data: callerProfile, error: profileError } = await admin
    .from('profiles')
    .select('id, display_name, role, active, location_id')
    .eq('id', caller.id)
    .single();

  if (profileError || !callerProfile || callerProfile.role !== 'owner' || !callerProfile.active) {
    return response({ ok: false, error: 'Only an active owner can manage staff accounts.' }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return response({ ok: false, error: 'The request was not valid.' }, 400);
  }

  const action = String(body.action || '');

  async function audit(eventType, targetUserId, details = {}) {
    await admin.from('staff_account_events').insert({
      actor_user_id: caller.id,
      target_user_id: targetUserId,
      event_type: eventType,
      details
    });
  }

  try {
    if (action === 'list') {
      const [{ data: authData, error: authError }, { data: profiles, error: profilesError }] = await Promise.all([
        admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
        admin.from('profiles').select('id, display_name, role, active, must_change_password, created_at').order('display_name')
      ]);

      if (authError) throw authError;
      if (profilesError) throw profilesError;

      const authById = new Map((authData.users || []).map(user => [user.id, user]));
      const accounts = (profiles || []).map(profile => {
        const authUser = authById.get(profile.id);
        return {
          id: profile.id,
          email: authUser?.email || '',
          displayName: profile.display_name,
          role: profile.role,
          active: profile.active,
          mustChangePassword: profile.must_change_password,
          lastSignInAt: authUser?.last_sign_in_at || null,
          createdAt: authUser?.created_at || profile.created_at
        };
      });

      return response({ ok: true, accounts });
    }

    if (action === 'create') {
      const email = String(body.email || '').trim().toLowerCase();
      const displayName = String(body.displayName || '').trim();
      const role = String(body.role || 'owner');

      if (!/^[^\s@]+@gotcracked\.co$/i.test(email)) {
        return response({ ok: false, error: 'Use a @gotcracked.co login address.' }, 400);
      }
      if (displayName.length < 2 || displayName.length > 80) {
        return response({ ok: false, error: 'Enter a staff display name.' }, 400);
      }
      if (!allowedRoles.has(role)) {
        return response({ ok: false, error: 'Choose a valid staff role.' }, 400);
      }

      const password = temporaryPassword();
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName }
      });

      if (createError || !created.user) throw createError || new Error('The Auth account was not created.');

      const { error: insertError } = await admin.from('profiles').insert({
        id: created.user.id,
        location_id: callerProfile.location_id,
        display_name: displayName,
        role,
        active: true,
        must_change_password: true
      });

      if (insertError) {
        await admin.auth.admin.deleteUser(created.user.id);
        throw insertError;
      }

      await audit('account_created', created.user.id, { email, role });
      return response({ ok: true, temporaryPassword: password });
    }

    const userId = String(body.userId || '');
    if (!/^[0-9a-f-]{36}$/i.test(userId)) {
      return response({ ok: false, error: 'Choose a valid staff account.' }, 400);
    }
    if (userId === caller.id) {
      return response({ ok: false, error: 'Use “Change my password” for your own account. Your own access and role cannot be changed here.' }, 400);
    }

    const { data: target, error: targetError } = await admin
      .from('profiles')
      .select('id, display_name, role, active')
      .eq('id', userId)
      .single();

    if (targetError || !target) {
      return response({ ok: false, error: 'That staff profile was not found.' }, 404);
    }

    if (action === 'reset_password') {
      const password = temporaryPassword();
      const { error: passwordError } = await admin.auth.admin.updateUserById(userId, { password });
      if (passwordError) throw passwordError;

      const { error: flagError } = await admin
        .from('profiles')
        .update({ must_change_password: true })
        .eq('id', userId);
      if (flagError) throw flagError;

      await audit('temporary_password_issued', userId);
      return response({ ok: true, temporaryPassword: password });
    }

    if (action === 'set_active') {
      const active = body.active === true;
      const { error: activeError } = await admin.from('profiles').update({ active }).eq('id', userId);
      if (activeError) throw activeError;

      await audit(active ? 'account_enabled' : 'account_disabled', userId);
      return response({ ok: true });
    }

    if (action === 'set_role') {
      const role = String(body.role || '');
      if (!allowedRoles.has(role)) {
        return response({ ok: false, error: 'Choose a valid staff role.' }, 400);
      }

      const { error: roleError } = await admin.from('profiles').update({ role }).eq('id', userId);
      if (roleError) throw roleError;

      await audit('role_changed', userId, { from: target.role, to: role });
      return response({ ok: true });
    }

    return response({ ok: false, error: 'Unknown staff management action.' }, 400);
  } catch (error) {
    console.error('manage-staff failed', { action, error });
    const message = error instanceof Error ? error.message : 'The staff account request failed.';
    return response({ ok: false, error: message }, 500);
  }
});
