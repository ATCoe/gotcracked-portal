(() => {
  'use strict';

  const DEFAULTS = {
    name: 'Marlon',
    endpoint: 'https://crackwave-ai.austncoe.workers.dev',
    role: 'Employee Support',
    title: 'Employee Support & Portal Reliability AI',
    version: '1.3.1',
    avatar: 'assets/marlon-avatar.svg',
    launcherLabel: 'Need Help?',
    badge: 'assets/marlon-badge.svg',
    badgeLabel: 'Employee Support AI',
    badgeTone: 'cyan',
    callVoice: 'orion'
  };

  const AVATAR_BUCKET = 'marlon-avatars';
  const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
  const AVATAR_MIME_TYPES = new Set(['image/png','image/jpeg','image/webp','image/gif']);

  window.GotCrackedMarlonConfig = Object.freeze({...DEFAULTS});

  const clean = value => String(value ?? '').trim();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'})[c]);
  const training = () => localStorage.getItem('gc-training-store') === '1';
  let profile = null;
  let identity = {
    displayName: DEFAULTS.name,
    roleLabel: DEFAULTS.role,
    avatarUrl: DEFAULTS.avatar,
    launcherLabel: DEFAULTS.launcherLabel,
    discordSync: true
  };
  let canManage = false;
  let avatarPreviewObjectUrl = '';

  function installKnowledgeBridge() {
    if (window.__gcMarlonKnowledgeFetchWrapped) return;
    window.__gcMarlonKnowledgeFetchWrapped = true;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if (method !== 'POST' || !url.startsWith(DEFAULTS.endpoint) || !url.includes('/portal/chat')) return nativeFetch(input, init);

      try {
        const rawBody = init?.body ?? (input instanceof Request ? await input.clone().text() : '');
        const payload = typeof rawBody === 'string' ? JSON.parse(rawBody || '{}') : null;
        const messages = Array.isArray(payload?.messages) ? payload.messages : [];
        const latest = [...messages].reverse().find(message => message?.role === 'user');
        const query = clean(latest?.content).slice(0,1200);
        if (query && window.supabaseClient?.functions?.invoke) {
          const knowledge = await window.supabaseClient.functions.invoke('marlon-knowledge-context',{body:{query}});
          if (!knowledge.error && knowledge.data?.ok && knowledge.data?.context) {
            payload.context = {
              ...(payload.context || {}),
              knowledge: knowledge.data.context,
              knowledgePolicy: 'Ground the answer in GotCracked repair procedures, current OEM/manufacturer guidance, approved gaming/platform sources, supplier data, and business policy supplied here. Prefer current OEM safety/service guidance when sources conflict. Never confuse supplier availability with GotCracked on-hand inventory. State uncertainty instead of inventing facts.'
            };
            const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
            headers.set('Content-Type','application/json');
            return nativeFetch(url,{...init,method:'POST',headers,body:JSON.stringify(payload)});
          }
        }
      } catch (error) {
        console.warn('Marlon knowledge grounding was unavailable for this turn.',error);
      }
      return nativeFetch(input,init);
    };
  }

  function safeHttpsUrl(value) {
    const text = clean(value);
    if (!text) return '';
    try {
      const url = new URL(text, location.origin);
      return url.protocol === 'https:' ? url.toString() : '';
    } catch { return ''; }
  }

  function normalized(raw = {}) {
    return {
      displayName: clean(raw.marlon_display_name || raw.displayName) || DEFAULTS.name,
      roleLabel: clean(raw.marlon_role_label || raw.roleLabel) || DEFAULTS.role,
      avatarUrl: clean(raw.marlon_avatar_url || raw.avatarUrl) || DEFAULTS.avatar,
      launcherLabel: clean(raw.marlon_launcher_label || raw.launcherLabel) || DEFAULTS.launcherLabel,
      discordSync: raw.marlon_discord_avatar_sync ?? raw.discordSync ?? true
    };
  }

  function apply(next) {
    identity = normalized(next);
    window.GotCrackedMarlonIdentity = Object.freeze({...identity});

    const root = document.querySelector('.gc-marlon');
    if (!root) return;
    const avatar = root.querySelector('.gc-marlon-avatar');
    const title = root.querySelector('.gc-marlon-title strong');
    const role = root.querySelector('.gc-marlon-title small');
    const launcher = root.querySelector('.gc-marlon-launcher');
    const panel = root.querySelector('.gc-marlon-panel');

    if (avatar) {
      avatar.src = identity.avatarUrl;
      avatar.alt = identity.displayName;
      avatar.onerror = () => { avatar.src = DEFAULTS.avatar; };
    }
    if (title) title.textContent = identity.displayName;
    if (role) role.textContent = `${identity.roleLabel} · Portal Reliability`;
    if (launcher) {
      launcher.dataset.label = identity.launcherLabel;
      launcher.setAttribute('aria-label', `Open ${identity.displayName} support`);
    }
    root.setAttribute('aria-label', `${identity.displayName} employee support`);
    panel?.setAttribute('aria-label', `${identity.displayName} employee support`);
  }

  function trainingIdentity() {
    try { return normalized(JSON.parse(localStorage.getItem('gc-training-marlon-identity-v1') || 'null') || {}); }
    catch { return normalized({}); }
  }

  async function resolveProfile(candidate = null) {
    profile = candidate || window.GotCrackedRuntimeProfile || window.GotCrackedOperationsV1?.state?.profile || profile;
    if (profile?.id && profile?.location_id) return profile;
    const client = window.supabaseClient;
    if (!client) return null;
    const {data:{user}} = await client.auth.getUser();
    if (!user) return null;
    const result = await client.from('profiles').select('id,location_id,display_name,role,active').eq('id',user.id).maybeSingle();
    if (!result.error) profile = result.data;
    return profile;
  }

  async function load(candidate = null) {
    const staff = await resolveProfile(candidate);
    if (!staff?.location_id) return apply(identity);
    if (training()) {
      apply(trainingIdentity());
      return;
    }
    const client = window.supabaseClient;
    if (!client) return;
    const result = await client.from('business_settings')
      .select('marlon_display_name,marlon_role_label,marlon_avatar_url,marlon_launcher_label,marlon_discord_avatar_sync')
      .eq('location_id',staff.location_id)
      .maybeSingle();
    if (!result.error && result.data) apply(result.data);
  }

  async function permission() {
    if (!window.supabaseClient) return false;
    const result = await window.supabaseClient.rpc('has_permission',{permission_key:'settings.manage'});
    canManage = !result.error && result.data === true;
    return canManage;
  }

  function injectStyle() {
    if (document.getElementById('gc-marlon-settings-style')) return;
    const style = document.createElement('style');
    style.id = 'gc-marlon-settings-style';
    style.textContent = `
      .gc-marlon-settings-preview{display:flex;align-items:center;gap:14px;padding:14px;border:1px solid var(--line,#d9e2ec);border-radius:14px;margin:12px 0 16px}.gc-marlon-settings-preview img{width:64px;height:64px;border-radius:18px;object-fit:cover;background:#0d2230}.gc-marlon-settings-preview strong,.gc-marlon-settings-preview small{display:block}.gc-marlon-settings-preview small{margin-top:3px;opacity:.72}.gc-marlon-setting-row{display:flex;align-items:center;gap:10px}.gc-marlon-setting-row input[type="checkbox"]{width:auto}.gc-marlon-settings-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.gc-marlon-avatar-upload{display:grid;gap:8px}.gc-marlon-avatar-upload input[type="file"]{padding:12px;border:1px dashed var(--line,#d9e2ec);border-radius:12px;background:rgba(16,185,249,.05);cursor:pointer}.gc-marlon-avatar-upload small{display:block}.gc-marlon-avatar-file-status{font-size:.82rem;opacity:.74}
    `;
    document.head.appendChild(style);
  }

  function renderSettings() {
    const host = document.getElementById('settings');
    if (!host || !canManage) return;
    injectStyle();
    if (avatarPreviewObjectUrl) {
      URL.revokeObjectURL(avatarPreviewObjectUrl);
      avatarPreviewObjectUrl = '';
    }
    document.getElementById('gc-marlon-identity-settings')?.remove();
    const avatar = safeHttpsUrl(identity.avatarUrl) || identity.avatarUrl || DEFAULTS.avatar;
    host.insertAdjacentHTML('beforeend', `<section id="gc-marlon-identity-settings">
      <article class="card" style="margin-top:18px">
        <div class="card-title"><div><p class="eyebrow">AI teammate</p><h2>Marlon identity</h2><p>One identity for Portal support and Marlon’s Discord bot profile. The launcher stays intentionally simple.</p></div></div>
        <div class="gc-marlon-settings-preview"><img src="${esc(avatar)}" alt="Marlon avatar preview"><div><strong>${esc(identity.displayName)}</strong><small>${esc(identity.roleLabel)}</small><small>Launcher: ${esc(identity.launcherLabel)}</small></div></div>
        <form id="gc-marlon-identity-form" class="settings-list">
          <label>Display name<input name="display_name" maxlength="40" value="${esc(identity.displayName)}" autocomplete="off"></label>
          <label>Role label<input name="role_label" maxlength="80" value="${esc(identity.roleLabel)}" autocomplete="off"></label>
          <label class="gc-marlon-avatar-upload">Avatar image<input name="avatar_file" type="file" accept="image/png,image/jpeg,image/webp,image/gif"><small>Upload a square PNG, JPEG, WebP, or GIF up to 5 MB. The image is securely stored in Supabase and can also sync to Discord.</small><span class="gc-marlon-avatar-file-status" data-avatar-file-status>No new image selected.</span></label>
          <label>Launcher label<input name="launcher_label" maxlength="24" value="${esc(identity.launcherLabel)}" autocomplete="off"><small>Desktop shows this label; small screens use a simple ? button.</small></label>
          <label class="gc-marlon-setting-row"><input name="discord_sync" type="checkbox" ${identity.discordSync?'checked':''}> Keep Discord avatar sync enabled</label>
          <p class="auth-message" role="status"></p>
          <div class="gc-marlon-settings-actions"><button class="primary-button" type="submit">Save Marlon</button><button class="secondary-button" type="button" data-sync-marlon-discord>Sync avatar to Discord</button></div>
        </form>
      </article>
    </section>`);
  }

  function validateAvatarFile(file) {
    if (!file || file.size < 1) throw new Error('Choose an image to upload.');
    if (!AVATAR_MIME_TYPES.has(file.type)) throw new Error('Use a PNG, JPEG, WebP, or GIF image.');
    if (file.size > AVATAR_MAX_BYTES) throw new Error('Marlon’s avatar must be 5 MB or smaller.');
  }

  async function uploadAvatar(file, staff) {
    validateAvatarFile(file);
    const objectPath = `${staff.location_id}/marlon-avatar`;
    const uploaded = await window.supabaseClient.storage.from(AVATAR_BUCKET).upload(objectPath,file,{
      cacheControl:'3600',
      contentType:file.type,
      upsert:true
    });
    if (uploaded.error) throw new Error(uploaded.error.message || 'Unable to upload Marlon’s avatar.');
    const publicResult = window.supabaseClient.storage.from(AVATAR_BUCKET).getPublicUrl(objectPath);
    const publicUrl = safeHttpsUrl(publicResult.data?.publicUrl);
    if (!publicUrl) throw new Error('Supabase did not return a valid avatar URL.');
    const cacheBusted = new URL(publicUrl);
    cacheBusted.searchParams.set('v',String(Date.now()));
    return cacheBusted.toString();
  }

  async function save(form) {
    const output = form.querySelector('.auth-message');
    const values = Object.fromEntries(new FormData(form));
    const avatarFile = form.elements.avatar_file?.files?.[0] || null;
    let avatarUrl = safeHttpsUrl(identity.avatarUrl) || null;
    const staff = await resolveProfile();

    if (avatarFile) {
      if (training()) throw new Error('Avatar uploads are unavailable in Training Store.');
      if (!staff?.location_id) throw new Error('Store location is unavailable.');
      output.textContent = 'Uploading Marlon’s avatar…';
      avatarUrl = await uploadAvatar(avatarFile,staff);
    }

    const payload = {
      marlon_display_name: clean(values.display_name) || DEFAULTS.name,
      marlon_role_label: clean(values.role_label) || DEFAULTS.role,
      marlon_avatar_url: avatarUrl,
      marlon_launcher_label: clean(values.launcher_label).slice(0,24) || DEFAULTS.launcherLabel,
      marlon_discord_avatar_sync: form.elements.discord_sync.checked,
      updated_at: new Date().toISOString()
    };
    if (training()) {
      localStorage.setItem('gc-training-marlon-identity-v1',JSON.stringify(payload));
      apply(payload);
      output.textContent = 'Training Store Marlon settings saved.';
      renderSettings();
      return;
    }
    if (!staff?.location_id) throw new Error('Store location is unavailable.');
    const result = await window.supabaseClient.from('business_settings').upsert({location_id:staff.location_id,...payload},{onConflict:'location_id'});
    if (result.error) throw result.error;
    apply(payload);
    window.dispatchEvent(new CustomEvent('gc-marlon-settings-updated',{detail:payload}));
    output.textContent = avatarFile ? 'Marlon’s image and settings are saved.' : 'Marlon settings saved.';
    renderSettings();
    if (payload.marlon_discord_avatar_sync && payload.marlon_avatar_url) await syncDiscord(document.querySelector('#gc-marlon-identity-form .auth-message'));
  }

  async function syncDiscord(output = null) {
    if (training()) {
      if (output) output.textContent = 'Discord sync is disabled in Training Store.';
      return;
    }
    if (!identity.discordSync) throw new Error('Enable Discord avatar sync first.');
    if (!safeHttpsUrl(identity.avatarUrl)) throw new Error('Upload and save an avatar first.');
    if (output) output.textContent = 'Syncing Marlon’s avatar to Discord…';
    const result = await window.supabaseClient.functions.invoke('marlon-profile-sync',{body:{}});
    if (result.error || !result.data?.ok) throw new Error(result.data?.error || result.error?.message || 'Discord avatar sync failed.');
    if (output) output.textContent = result.data.skipped ? 'Discord avatar sync is disabled.' : 'Marlon’s Discord avatar is synced.';
  }

  async function prepareSettings() {
    await load();
    if (!await permission()) return;
    renderSettings();
  }

  window.addEventListener('gotcracked:staff-ready', event => { void load(event.detail); if (location.hash.startsWith('#settings')) void prepareSettings(); });
  window.addEventListener('gc-marlon-settings-updated', event => apply(event.detail));
  document.addEventListener('gc-view-changed', () => { if (location.hash.startsWith('#settings')) setTimeout(()=>void prepareSettings(),80); });
  window.addEventListener('hashchange', () => { if (location.hash.startsWith('#settings')) setTimeout(()=>void prepareSettings(),80); });
  document.addEventListener('change', event => {
    if (!event.target?.matches?.('#gc-marlon-identity-form input[name="avatar_file"]')) return;
    const file = event.target.files?.[0];
    const form = event.target.form;
    const output = form?.querySelector('.auth-message');
    const status = form?.querySelector('[data-avatar-file-status]');
    const preview = document.querySelector('#gc-marlon-identity-settings .gc-marlon-settings-preview img');
    try {
      validateAvatarFile(file);
      if (avatarPreviewObjectUrl) URL.revokeObjectURL(avatarPreviewObjectUrl);
      avatarPreviewObjectUrl = URL.createObjectURL(file);
      if (preview) preview.src = avatarPreviewObjectUrl;
      if (status) status.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB selected`;
      if (output) output.textContent = 'Preview ready. Save Marlon to upload it.';
    } catch (error) {
      event.target.value = '';
      if (status) status.textContent = 'No new image selected.';
      if (output) output.textContent = error.message || 'Unable to use that image.';
    }
  });
  document.addEventListener('submit', event => {
    if (event.target?.id !== 'gc-marlon-identity-form') return;
    event.preventDefault();
    const form = event.target;
    const output = form.querySelector('.auth-message');
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    void save(form)
      .catch(error => { if (output) output.textContent = error.message || 'Unable to save Marlon settings.'; })
      .finally(() => { if (submit?.isConnected) submit.disabled = false; });
  });
  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-sync-marlon-discord]');
    if (!button) return;
    const output = document.querySelector('#gc-marlon-identity-form .auth-message');
    button.disabled = true;
    void syncDiscord(output).catch(error => { if (output) output.textContent = error.message || 'Unable to sync Marlon to Discord.'; }).finally(()=>{button.disabled=false;});
  });

  installKnowledgeBridge();
  if (window.GotCrackedRuntimeProfile) void load(window.GotCrackedRuntimeProfile);
})();