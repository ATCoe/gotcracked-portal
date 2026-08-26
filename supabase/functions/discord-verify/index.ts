import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const bytesToHex = (bytes: Uint8Array) => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
async function sha256(value: string) { return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))); }

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authorization = request.headers.get('Authorization') || '';
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
    const admin = createClient(url, service);
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return reply({ authorized: false, error: 'Sign in required.' }, 401);

    const discordIdentity = user.identities?.find(identity => identity.provider === 'discord');
    const discordId = String(discordIdentity?.identity_data?.provider_id || discordIdentity?.identity_data?.sub || discordIdentity?.id || '');
    if (!discordId) return reply({ authorized: false, error: 'No Discord identity was found.' }, 403);

    const guildId = Deno.env.get('DISCORD_GUILD_ID')!;
    const botToken = Deno.env.get('DISCORD_BOT_TOKEN')!;
    const memberResponse = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${discordId}`, { headers: { Authorization: `Bot ${botToken}` } });
    if (!memberResponse.ok) return reply({ authorized: false, error: 'Join the GotCracked staff Discord before accessing the Portal.' }, 403);
    const member = await memberResponse.json();

    let { data: profile } = await admin.from('profiles').select('*').eq('id', user.id).maybeSingle();
    const { inviteToken } = await request.json().catch(() => ({ inviteToken: null }));
    if (!profile && inviteToken) {
      const tokenHash = await sha256(inviteToken);
      const { data: invite } = await admin.from('staff_invitations').select('*').eq('token_hash', tokenHash).is('used_at', null).gt('expires_at', new Date().toISOString()).maybeSingle();
      if (!invite || (invite.discord_user_id && invite.discord_user_id !== discordId)) return reply({ authorized: false, error: 'This staff invitation is invalid, expired, or belongs to another Discord account.' }, 403);
      const identity = discordIdentity.identity_data || {};
      const created = await admin.from('profiles').insert({ id: user.id, location_id: invite.location_id, display_name: invite.display_name || member.nick || identity.full_name || identity.name || identity.user_name || 'Staff', role: invite.role, active: true, discord_user_id: discordId }).select().single();
      if (created.error) throw created.error;
      profile = created.data;
      await admin.from('staff_invitations').update({ used_at: new Date().toISOString(), used_by: user.id }).eq('id', invite.id);
    }
    if (!profile?.active) return reply({ authorized: false, error: 'Your GotCracked staff account is not active.' }, 403);

    const identity = discordIdentity.identity_data || {};
    await admin.from('profiles').update({
      discord_user_id: discordId,
      discord_username: identity.user_name || identity.preferred_username || member.user?.username,
      discord_avatar_url: identity.avatar_url || null,
      discord_verified_at: new Date().toISOString(),
      last_portal_login_at: new Date().toISOString()
    }).eq('id', user.id);
    return reply({ authorized: true, role: profile.role, discordUserId: discordId });
  } catch (error) { console.error(error); return reply({ authorized: false, error: 'Discord access verification failed.' }, 500); }
});
