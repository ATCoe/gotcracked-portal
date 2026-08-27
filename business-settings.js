(() => {
  'use strict';

  const client = window.supabaseClient;
  if (!client) return;

  const training = () => localStorage.getItem('gc-training-store') === '1';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const DAYS = [
    ['mon','Monday'],['tue','Tuesday'],['wed','Wednesday'],['thu','Thursday'],
    ['fri','Friday'],['sat','Saturday'],['sun','Sunday']
  ];
  const DEFAULT_HOURS = {mon:['09:00','18:00'],tue:['09:00','18:00'],wed:['09:00','18:00'],thu:['09:00','18:00'],fri:['09:00','18:00'],sat:['10:00','16:00'],sun:null};
  let profile = null;
  let settings = null;
  let canManageSettings = false;

  const isManager = () => canManageSettings;
  const clean = value => String(value ?? '').trim();
  const safeUrl = value => {
    const text = clean(value);
    if (!text) return null;
    try {
      const url = new URL(text);
      if (!['https:','http:'].includes(url.protocol)) throw new Error('Unsupported URL');
      return url.toString();
    } catch { return null; }
  };

  async function identity() {
    profile = window.GotCrackedRuntimeProfile || window.GotCrackedOperationsV1?.state?.profile || profile;
    if (!profile?.id) {
      const { data:{ user } } = await client.auth.getUser();
      if (!user) return null;
      const result = await client.from('profiles').select('id,location_id,display_name,role,active').eq('id',user.id).maybeSingle();
      if (!result.error) profile = result.data;
    }
    if (!profile?.id) return null;
    const permission = await client.rpc('has_permission',{permission_key:'settings.manage'});
    canManageSettings = permission.error ? ['owner','manager'].includes(profile.role) : Boolean(permission.data);
    return profile;
  }

  function trainingSettings() {
    const raw = JSON.parse(localStorage.getItem('gc-training-business-settings-v1') || 'null');
    return raw || {
      store_hours: DEFAULT_HOURS,
      store_timezone: 'America/New_York',
      website_url: 'https://gotcracked.co/',
      google_business_profile_url: '',
      google_business_place_id: '',
      google_search_console_property: 'gotcracked.co',
      google_analytics_measurement_id: '',
      google_analytics_property_id: ''
    };
  }

  async function load() {
    if (training()) { settings = trainingSettings(); return; }
    const result = await client.from('business_settings')
      .select('location_id,store_hours,store_timezone,website_url,google_business_profile_url,google_business_place_id,google_search_console_property,google_analytics_measurement_id,google_analytics_property_id')
      .eq('location_id',profile.location_id)
      .maybeSingle();
    if (result.error) throw result.error;
    settings = result.data || { store_hours: DEFAULT_HOURS, store_timezone:'America/New_York' };
  }

  function injectStyle() {
    if (document.getElementById('gc-business-settings-style')) return;
    const style = document.createElement('style');
    style.id = 'gc-business-settings-style';
    style.textContent = `
      .gc-hours-grid{display:grid;gap:10px;margin:12px 0 18px}.gc-hours-row{display:grid;grid-template-columns:minmax(110px,1fr) auto minmax(120px,.8fr) minmax(120px,.8fr);gap:12px;align-items:center;padding:12px 14px;border:1px solid var(--line,#d9e2ec);border-radius:12px}.gc-hours-day{font-weight:700}.gc-hours-open{display:flex;align-items:center;gap:8px;white-space:nowrap}.gc-hours-row input[type="time"]{width:100%}.gc-hours-row.is-closed input[type="time"]{opacity:.45;pointer-events:none}.gc-settings-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.gc-google-status{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:14px 0}.gc-google-status article{border:1px solid var(--line,#d9e2ec);border-radius:12px;padding:12px}.gc-google-status small{display:block;margin-bottom:4px}.gc-google-status strong{font-size:.95rem}.gc-integration-links{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.gc-integration-links a{text-decoration:none}@media(max-width:720px){.gc-hours-row{grid-template-columns:1fr 1fr}.gc-hours-day{grid-column:1}.gc-hours-open{grid-column:2;justify-self:end}.gc-hours-row label{margin:0}.gc-hours-row input[type="time"]{min-height:44px}}
    `;
    document.head.appendChild(style);
  }

  function hoursRows() {
    const hours = settings?.store_hours || DEFAULT_HOURS;
    return DAYS.map(([key,label]) => {
      const range = Array.isArray(hours?.[key]) ? hours[key] : null;
      const open = Boolean(range);
      return `<div class="gc-hours-row ${open?'':'is-closed'}" data-day="${key}">
        <span class="gc-hours-day">${label}</span>
        <label class="gc-hours-open"><input type="checkbox" name="${key}_open" ${open?'checked':''}> Open</label>
        <label>Opens<input type="time" name="${key}_start" value="${esc(range?.[0] || '09:00')}" ${open?'':'disabled'}></label>
        <label>Closes<input type="time" name="${key}_end" value="${esc(range?.[1] || '18:00')}" ${open?'':'disabled'}></label>
      </div>`;
    }).join('');
  }

  function configured(value) { return clean(value) ? 'Configured' : 'Not configured'; }

  function render() {
    const host = document.getElementById('settings');
    if (!host || !isManager()) return;
    injectStyle();
    document.getElementById('gc-business-presence-settings')?.remove();

    const businessUrl = safeUrl(settings?.google_business_profile_url);
    const websiteUrl = safeUrl(settings?.website_url);
    const searchProperty = clean(settings?.google_search_console_property);
    const measurementId = clean(settings?.google_analytics_measurement_id);

    host.insertAdjacentHTML('afterbegin', `<section id="gc-business-presence-settings">
      <div class="page-heading"><div><p class="eyebrow">Business configuration</p><h1>Settings</h1><p class="subtle">Store operations, Google presence, website monitoring, pricing, and integrations.</p></div></div>

      <article class="card">
        <div class="card-title"><div><p class="eyebrow">Store operations</p><h2>Store hours</h2><p>These are the canonical hours for GotCracked. Keep them aligned with the website and Google Business Profile.</p></div></div>
        <form id="gc-store-hours-form" class="settings-list">
          <div class="gc-hours-grid">${hoursRows()}</div>
          <label>Store timezone
            <select name="store_timezone">
              ${['America/New_York','America/Chicago','America/Denver','America/Los_Angeles','UTC'].map(zone=>`<option value="${zone}" ${zone===(settings?.store_timezone||'America/New_York')?'selected':''}>${zone}</option>`).join('')}
            </select>
          </label>
          <p class="auth-message" role="status"></p>
          <div class="gc-settings-actions"><button class="primary-button" type="submit">Save store hours</button><button class="secondary-button" type="button" data-copy-monday-hours>Apply Monday to weekdays</button></div>
        </form>
      </article>

      <article class="card" style="margin-top:18px">
        <div class="card-title"><div><p class="eyebrow">Google & web</p><h2>Search presence and traffic monitoring</h2><p>Configure the public identifiers used to manage GotCracked on Google Search/Maps and monitor website performance.</p></div></div>
        <div class="gc-google-status">
          <article><small>Business Profile</small><strong>${configured(settings?.google_business_profile_url || settings?.google_business_place_id)}</strong></article>
          <article><small>Search Console</small><strong>${configured(searchProperty)}</strong></article>
          <article><small>Google Analytics 4</small><strong>${configured(measurementId)}</strong></article>
          <article><small>Website</small><strong>${websiteUrl ? 'Configured' : 'Not configured'}</strong></article>
        </div>
        <form id="gc-google-web-form" class="settings-list">
          <label>Website URL<input name="website_url" type="url" placeholder="https://gotcracked.co/" value="${esc(settings?.website_url || '')}"><small>Public website only.</small></label>
          <label>Google Business Profile / Maps URL<input name="google_business_profile_url" type="url" placeholder="https://..." value="${esc(settings?.google_business_profile_url || '')}"></label>
          <label>Google Place ID<input name="google_business_place_id" autocomplete="off" placeholder="Google Place ID" value="${esc(settings?.google_business_place_id || '')}"></label>
          <label>Search Console property<input name="google_search_console_property" autocomplete="off" placeholder="gotcracked.co" value="${esc(searchProperty)}"><small>Use the domain property (recommended) or exact URL-prefix property configured in Search Console.</small></label>
          <label>GA4 Measurement ID<input name="google_analytics_measurement_id" autocomplete="off" placeholder="G-XXXXXXXXXX" value="${esc(measurementId)}"></label>
          <label>GA4 Property ID<input name="google_analytics_property_id" inputmode="numeric" autocomplete="off" placeholder="123456789" value="${esc(settings?.google_analytics_property_id || '')}"></label>
          <div class="demo-note"><strong>Security:</strong> this screen stores non-secret public identifiers only. Google OAuth tokens, client secrets, API keys, and service credentials must remain in protected server-side secrets—not in Portal fields or browser code.</div>
          <p class="auth-message" role="status"></p>
          <button class="primary-button" type="submit">Save Google & web settings</button>
        </form>
        <div class="gc-integration-links">
          <a class="secondary-button" href="https://business.google.com/" target="_blank" rel="noopener">Manage Google Business ↗</a>
          <a class="secondary-button" href="https://search.google.com/search-console" target="_blank" rel="noopener">Open Search Console ↗</a>
          <a class="secondary-button" href="https://analytics.google.com/analytics/web/" target="_blank" rel="noopener">Open Google Analytics ↗</a>
          ${businessUrl?`<a class="secondary-button" href="${esc(businessUrl)}" target="_blank" rel="noopener">View public profile ↗</a>`:''}
          ${websiteUrl?`<a class="secondary-button" href="${esc(websiteUrl)}" target="_blank" rel="noopener">Open website ↗</a>`:''}
        </div>
      </article>
    </section>`);
  }

  function readHours(form) {
    const hours = {};
    for (const [key,label] of DAYS) {
      const row = form.querySelector(`[data-day="${key}"]`);
      const open = row?.querySelector(`[name="${key}_open"]`)?.checked;
      if (!open) { hours[key] = null; continue; }
      const start = row.querySelector(`[name="${key}_start"]`)?.value;
      const end = row.querySelector(`[name="${key}_end"]`)?.value;
      if (!start || !end) throw new Error(`${label} needs both an opening and closing time.`);
      if (start >= end) throw new Error(`${label} closing time must be after opening time.`);
      hours[key] = [start,end];
    }
    return hours;
  }

  async function saveHours(form) {
    const status = form.querySelector('.auth-message');
    try {
      const storeHours = readHours(form);
      const storeTimezone = clean(form.elements.store_timezone.value) || 'America/New_York';
      if (training()) {
        settings = {...trainingSettings(),...settings,store_hours:storeHours,store_timezone:storeTimezone};
        localStorage.setItem('gc-training-business-settings-v1',JSON.stringify(settings));
        status.textContent = 'Training Store hours saved.';
        render();
        return;
      }
      const result = await client.from('business_settings').upsert({location_id:profile.location_id,store_hours:storeHours,store_timezone:storeTimezone,updated_at:new Date().toISOString()},{onConflict:'location_id'});
      if (result.error) { window.GotCrackedDiagnostics?.error?.(result.error,{context:'Unable to save store hours'}); throw result.error; }
      settings = {...settings,store_hours:storeHours,store_timezone:storeTimezone};
      status.textContent = 'Store hours saved.';
    } catch (error) { status.textContent = error.message || 'Unable to save store hours.'; }
  }

  async function saveGoogle(form) {
    const status = form.querySelector('.auth-message');
    try {
      const raw = Object.fromEntries(new FormData(form));
      const website = clean(raw.website_url);
      const profileUrl = clean(raw.google_business_profile_url);
      if (website && !safeUrl(website)) throw new Error('Enter a valid website URL including https://.');
      if (profileUrl && !safeUrl(profileUrl)) throw new Error('Enter a valid Google Business Profile / Maps URL.');
      const measurement = clean(raw.google_analytics_measurement_id).toUpperCase();
      if (measurement && !/^G-[A-Z0-9]+$/.test(measurement)) throw new Error('GA4 Measurement ID must use the G-XXXXXXXX format.');
      const propertyId = clean(raw.google_analytics_property_id);
      if (propertyId && !/^\d+$/.test(propertyId)) throw new Error('GA4 Property ID must contain numbers only.');
      const payload = {
        website_url: website ? safeUrl(website) : null,
        google_business_profile_url: profileUrl ? safeUrl(profileUrl) : null,
        google_business_place_id: clean(raw.google_business_place_id) || null,
        google_search_console_property: clean(raw.google_search_console_property) || null,
        google_analytics_measurement_id: measurement || null,
        google_analytics_property_id: propertyId || null
      };
      if (training()) {
        settings = {...trainingSettings(),...settings,...payload};
        localStorage.setItem('gc-training-business-settings-v1',JSON.stringify(settings));
        render();
        return;
      }
      const result = await client.from('business_settings').upsert({location_id:profile.location_id,...payload,updated_at:new Date().toISOString()},{onConflict:'location_id'});
      if (result.error) { window.GotCrackedDiagnostics?.error?.(result.error,{context:'Unable to save Google & web settings'}); throw result.error; }
      settings = {...settings,...payload};
      status.textContent = 'Google & web settings saved.';
      setTimeout(render,350);
    } catch (error) { status.textContent = error.message || 'Unable to save Google & web settings.'; }
  }

  document.addEventListener('change', event => {
    const toggle = event.target.closest?.('#gc-store-hours-form input[type="checkbox"]');
    if (!toggle) return;
    const row = toggle.closest('.gc-hours-row');
    const closed = !toggle.checked;
    row.classList.toggle('is-closed',closed);
    row.querySelectorAll('input[type="time"]').forEach(input => { input.disabled = closed; });
  });

  document.addEventListener('click', event => {
    if (!event.target.closest?.('[data-copy-monday-hours]')) return;
    const form = document.getElementById('gc-store-hours-form');
    if (!form) return;
    const monday = form.querySelector('[data-day="mon"]');
    const open = monday.querySelector('[name="mon_open"]').checked;
    const start = monday.querySelector('[name="mon_start"]').value;
    const end = monday.querySelector('[name="mon_end"]').value;
    for (const key of ['tue','wed','thu','fri']) {
      const row = form.querySelector(`[data-day="${key}"]`);
      row.querySelector(`[name="${key}_open"]`).checked = open;
      row.querySelector(`[name="${key}_start"]`).value = start;
      row.querySelector(`[name="${key}_end"]`).value = end;
      row.classList.toggle('is-closed',!open);
      row.querySelectorAll('input[type="time"]').forEach(input=>{input.disabled=!open;});
    }
  });

  document.addEventListener('submit', event => {
    if (event.target.id === 'gc-store-hours-form') { event.preventDefault(); saveHours(event.target); }
    if (event.target.id === 'gc-google-web-form') { event.preventDefault(); saveGoogle(event.target); }
  });

  async function init() {
    try {
      await identity();
      if (!profile?.active || !isManager()) return;
      await load();
      render();
    } catch (error) {
      console.error('Business settings failed to load:',error);
      window.GotCrackedDiagnostics?.error?.(error,{context:'Business settings failed to load'});
    }
  }

  init();
})();
