(() => {
  'use strict';
  if (window.GotCrackedStaffProfiles) return;

  const client = window.supabaseClient;
  if (!client) return;

  const VERSION = '20260828-compensation2';
  const state = {profiles:[], compensation:[], selected:null, canManage:false, canManagePay:false, busy:false, previewUrl:null};

  const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'
  })[c]);
  const current = () => window.GotCrackedRuntimeProfile || window.GotCrackedOperationsV1?.state?.profile || null;
  const presets = () => window.GotCrackedAvatarPresets?.presets || [];
  const isPreset = value => window.GotCrackedAvatarPresets?.isPreset?.(value) || false;
  const presetSvg = value => window.GotCrackedAvatarPresets?.render?.(value) || '';
  const initials = name => String(name || 'GC').trim().split(/\s+/).slice(0,2).map(x => x[0] || '').join('').toUpperCase() || 'GC';
  const roleLabel = v => String(v || 'staff').replaceAll('_',' ').replace(/\b\w/g, c => c.toUpperCase());
  const dollars = cents => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((Number(cents)||0)/100);
  const payFor = id => state.compensation.find(x => x.profile_id === id) || null;
  function paySummaryMarkup(p) {
    if (!state.canManagePay) return '';
    const pay=payFor(p.id), type=pay?.employment_type || (p.role==='owner'?'owner':'hourly');
    let amount='Not set';
    if(type==='hourly') amount=pay?.hourly_rate_cents>0?`${dollars(pay.hourly_rate_cents)}/hr`:'Not set';
    if(type==='salary') amount=pay?.weekly_salary_cents>0?`${dollars(pay.weekly_salary_cents)}/week (${dollars(pay.weekly_salary_cents*52)}/yr)`:'Not set';
    if(type==='owner') amount='Owner / no base payroll wage';
    const commission=Number(pay?.commission_percent||0)>0&&pay?.commission_scope==='store_sales'?` · ${Number(pay.commission_percent).toFixed(2).replace(/\.00$/,'')}% store sales/repair commission`:'';
    return `<article class="gc-profile-bio"><h2>Compensation</h2><p><strong>${esc(roleLabel(type))}</strong> · ${esc(amount)}${esc(commission)}${pay?.effective_at?` · effective ${esc(pay.effective_at)}`:''}</p></article>`;
  }

  function style() {
    if (document.querySelector('link[data-gc-staff-profiles]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'staff-profiles.css?v=20260828-comp1';
    l.dataset.gcStaffProfiles = 'true';
    document.head.appendChild(l);
  }

  function avatarInner(p) {
    const value = p?.avatar_url || '';
    if (isPreset(value)) return presetSvg(value);
    if (value) return `<img src="${esc(value)}" alt="">`;
    return esc(initials(p?.display_name));
  }

  function avatarMarkup(p, size='') {
    return `<span class="gc-staff-avatar ${size} ${p?.avatar_url ? 'has-image' : ''}">${avatarInner(p)}</span>`;
  }

  function ensureProfileView() {
    const main = document.querySelector('.app-shell main');
    if (!main) return;

    if (!document.getElementById('profile')) {
      const s = document.createElement('section');
      s.id = 'profile';
      s.className = 'view';
      s.innerHTML = '<div id="gc-profile-view"></div>';
      const settings = document.getElementById('settings');
      settings ? settings.insertAdjacentElement('beforebegin', s) : main.appendChild(s);
    }

    const card = document.querySelector('.sidebar .profile');
    if (card && !card.dataset.gcProfileBound) {
      card.dataset.gcProfileBound = 'true';
      card.classList.add('gc-profile-launcher');
      card.title = 'Open your staff profile';
    }
  }

  function presetGalleryMarkup(selected='') {
    return `<section class="gc-avatar-preset-section full"><div class="gc-avatar-preset-head"><div><strong>Repair avatar gallery</strong><small>Choose a GotCracked electronics avatar or upload your own.</small></div><button class="text-button" type="button" data-avatar-clear>Use initials</button></div><div class="gc-avatar-preset-grid">${presets().map(item => {
      const value = `preset:${item.id}`;
      return `<button type="button" class="gc-avatar-preset ${selected === value ? 'selected' : ''}" data-avatar-preset="${esc(value)}" aria-label="Use ${esc(item.name)} avatar"><span>${item.svg}</span><small>${esc(item.name)}</small></button>`;
    }).join('')}</div></section>`;
  }

  function bindProfileForm(form) {
    if (!form || form.dataset.gcProfileSaveBound === 'true') return;
    form.dataset.gcProfileSaveBound = 'true';

    // Bind to the form itself so unrelated document-level form handlers cannot
    // prevent a profile save from reaching this module.
    form.addEventListener('submit', event => {
      event.preventDefault();
      event.stopPropagation();
      if (!form.reportValidity()) return;
      void save(form);
    });

    const saveButton = form.querySelector('[data-profile-save]');
    saveButton?.addEventListener('click', event => {
      // Direct click fallback for browsers/pages where another handler interferes
      // with a synthetic/default submit event.
      event.preventDefault();
      event.stopPropagation();
      if (!form.reportValidity()) return;
      void save(form);
    });
  }

  function ensureDialog() {
    let d = document.getElementById('gc-staff-profile-dialog');
    if (!d) {
      d = document.createElement('dialog');
      d.id = 'gc-staff-profile-dialog';
      d.className = 'gc-staff-profile-dialog';
      d.innerHTML = `<form id="gc-staff-profile-form"><div class="gc-profile-dialog-head"><div><p class="eyebrow">Staff account</p><h2>Edit profile</h2></div><button type="button" class="icon-button" data-profile-close>×</button></div><div class="gc-profile-dialog-body"><input type="hidden" name="id"><input type="hidden" name="avatar_preset"><div class="gc-profile-photo-editor full"><div data-profile-preview></div><div class="gc-profile-photo-actions"><label class="secondary-button">Upload your own<input name="avatar" type="file" accept="image/jpeg,image/png,image/webp" hidden></label><small>JPG, PNG, or WebP · 2 MB max</small></div></div><div data-avatar-gallery class="full"></div><label>Display name<input name="display_name" maxlength="120" required></label><label>Job title<input name="job_title" maxlength="120" placeholder="Repair Technician"></label><label>Phone<input name="phone" maxlength="40" inputmode="tel"></label><label class="full">Bio<textarea name="bio" maxlength="600" placeholder="Skills, specialties, certifications, or a short team bio."></textarea></label><p class="gc-profile-message full" role="status"></p></div><div class="gc-profile-dialog-actions"><button type="button" class="secondary-button" data-profile-close>Cancel</button><button type="submit" class="primary-button" data-profile-save>Save profile</button></div></form>`;
      document.body.appendChild(d);
    }
    bindProfileForm(d.querySelector('#gc-staff-profile-form'));
    return d;
  }

  async function load() {
    const p = current();
    if (!p?.location_id) return;

    const perm = await client.rpc('has_permission', {permission_key:'staff.manage'});
    state.canManage = Boolean(perm.data);
    state.canManagePay = current()?.role === 'owner';

    const {data, error} = await client
      .from('profiles')
      .select('id,location_id,display_name,role,active,avatar_url,job_title,phone,bio,discord_user_id,discord_username,recovery_email,portal_email,onboarding_status,discord_invite_expires_at,created_at,updated_at')
      .eq('location_id', p.location_id)
      .order('display_name');

    if (error) {
      console.warn('Staff profiles unavailable:', error.message);
      return;
    }

    state.profiles = data || [];
    if (state.canManagePay) {
      const pay = await client.from('staff_compensation').select('*').eq('location_id', p.location_id);
      if (pay.error) console.warn('Staff compensation unavailable:', pay.error.message);
      state.compensation = pay.data || [];
    } else state.compensation = [];
    syncCurrentProfile();
    renderProfileView(state.selected || current()?.id);
    renderStaffCards();
    decorateActivity();
  }

  function syncCurrentProfile() {
    const p = current();
    const row = state.profiles.find(x => x.id === p?.id);
    if (!p || !row) return;

    Object.assign(p, row);
    const avatar = document.getElementById('staff-initials');
    if (avatar) {
      avatar.innerHTML = avatarInner(row);
      avatar.classList.toggle('has-image', Boolean(row.avatar_url));
    }
    const name = document.getElementById('staff-name');
    if (name) name.textContent = row.display_name;
  }

  function renderProfileView(id=current()?.id) {
    const host = document.getElementById('gc-profile-view');
    if (!host) return;

    const p = state.profiles.find(x => x.id === id) || state.profiles.find(x => x.id === current()?.id);
    if (!p) {
      host.innerHTML = '<div class="empty-card"><h2>Profile unavailable</h2></div>';
      return;
    }

    state.selected = p.id;
    const canEdit = p.id === current()?.id || state.canManage;
    host.innerHTML = `<div class="gc-profile-page-head"><div><p class="eyebrow">Staff identity</p><h1>${p.id === current()?.id ? 'My profile' : 'Employee profile'}</h1><p>Profile details are used throughout the Portal for staff identity and repair activity.</p></div>${canEdit ? `<button class="primary-button" type="button" data-edit-profile="${p.id}">Edit profile</button>` : ''}</div><section class="gc-profile-hero"><div class="gc-profile-photo">${avatarMarkup(p,'xl')}</div><div class="gc-profile-copy"><h2>${esc(p.display_name)}</h2><p>${esc(p.job_title || roleLabel(p.role))}</p><div class="gc-profile-badges"><span>${esc(roleLabel(p.role))}</span><span>${p.active ? 'Active' : 'Inactive'}</span>${p.discord_user_id ? '<span>Discord linked</span>' : ''}${p.onboarding_status && p.onboarding_status !== 'active' ? `<span>${esc(p.onboarding_status.replaceAll('_',' '))}</span>` : ''}${isPreset(p.avatar_url) ? '<span>GotCracked avatar</span>' : ''}</div></div></section><div class="gc-profile-grid"><article><small>Portal login</small><strong>${esc(p.portal_email || 'Legacy account')}</strong></article><article><small>Portal role</small><strong>${esc(roleLabel(p.role))}</strong></article><article><small>Discord</small><strong>${esc(p.discord_username || (p.discord_user_id ? 'Linked' : 'Not linked'))}</strong></article><article><small>Onboarding</small><strong>${esc((p.onboarding_status || 'active').replaceAll('_',' '))}</strong></article></div><article class="gc-profile-bio"><h2>About</h2><p>${esc(p.bio || 'No profile bio yet.')}</p></article>${paySummaryMarkup(p)}`;
  }

  function renderStaffCards() {
    const staff = document.getElementById('staff');
    if (!staff) return;

    let host = document.getElementById('gc-staff-profiles');
    if (!host) {
      host = document.createElement('section');
      host.id = 'gc-staff-profiles';
      host.className = 'card gc-staff-profiles';
      const list = document.getElementById('staff-management-list');
      list ? list.insertAdjacentElement('afterend', host) : staff.appendChild(host);
    }

    host.innerHTML = `<div class="card-title"><div><h2>Employee profiles</h2><p>Names, photos, job titles, and team identity used throughout the Portal.</p></div></div><div class="gc-staff-profile-grid">${state.profiles.map(p => `<button type="button" class="gc-staff-profile-card" data-open-profile="${p.id}">${avatarMarkup(p,'lg')}<span><strong>${esc(p.display_name)}</strong><small>${esc(p.job_title || roleLabel(p.role))}</small></span><em>${p.active ? 'Active' : 'Inactive'}</em></button>`).join('')}</div>`;
  }

  function ensureCompensationFields(form,p) {
    form.querySelector('[data-compensation-fields]')?.remove();
    if (!state.canManagePay) return;
    const pay=payFor(p.id), type=pay?.employment_type || (p.role==='owner'?'owner':'hourly');
    const hourly=((pay?.hourly_rate_cents||0)/100).toFixed(2);
    const weekly=((pay?.weekly_salary_cents||0)/100).toFixed(2);
    const commission=Number(pay?.commission_percent||0);
    const commissionScope=pay?.commission_scope||'none';
    const effective=pay?.effective_at || new Date().toISOString().slice(0,10);
    const section=document.createElement('section'); section.className='gc-profile-compensation full'; section.dataset.compensationFields='true';
    const typeOptions=p.role==='owner'?'<option value="owner">Owner</option><option value="hourly">Hourly</option><option value="salary">Salary</option>':'<option value="hourly">Hourly</option><option value="salary">Salary</option>';
    section.innerHTML=`<div class="gc-profile-comp-head"><div><strong>Compensation</strong><small>Owner only. Base pay and optional commission are tracked separately.</small></div></div><div class="gc-profile-comp-grid"><label>Pay type<select name="pay_type">${typeOptions}</select></label><label data-pay-hourly>Hourly wage ($/hr)<input name="hourly_wage" type="number" min="0" max="1000" step="0.01" value="${hourly}"></label><label data-pay-salary>Weekly salary ($/week)<input name="weekly_salary" type="number" min="0" max="1000000" step="0.01" value="${weekly}"></label><label>Commission scope<select name="commission_scope"><option value="none">No commission</option><option value="store_sales">Store sales & repairs</option></select></label><label data-pay-commission>Commission rate (%)<input name="commission_percent" type="number" min="0" max="100" step="0.25" value="${commission}"></label><label>Effective date<input name="pay_effective_at" type="date" value="${effective}" required></label></div><p>Salary is entered weekly and annualized automatically. Store commission is calculated from finalized receipt subtotal before tax, with discounts/refunds reflected in the receipt subtotal. Commission stays separate from bench labor cost.</p>`;
    form.querySelector('.gc-profile-message')?.insertAdjacentElement('beforebegin',section);
    const select=section.querySelector('[name="pay_type"]'); select.value=type;
    const commissionSelect=section.querySelector('[name="commission_scope"]'); commissionSelect.value=commissionScope;
    const sync=()=>{section.querySelector('[data-pay-hourly]').hidden=select.value!=='hourly';section.querySelector('[data-pay-salary]').hidden=select.value!=='salary';section.querySelector('[data-pay-commission]').hidden=commissionSelect.value==='none'};
    select.addEventListener('change',sync); commissionSelect.addEventListener('change',sync); sync();
  }

  async function saveCompensation(form,profileId) {
    if (!state.canManagePay) return;
    const type=form.elements.pay_type?.value || 'hourly';
    const hourly=Math.max(0,Number(form.elements.hourly_wage?.value||0));
    const weekly=Math.max(0,Number(form.elements.weekly_salary?.value||0));
    const commissionScope=form.elements.commission_scope?.value||'none';
    const commissionPercent=commissionScope==='store_sales'?Math.max(0,Math.min(100,Number(form.elements.commission_percent?.value||0))):0;
    const effective=form.elements.pay_effective_at?.value || new Date().toISOString().slice(0,10);
    const row={profile_id:profileId,location_id:current().location_id,employment_type:type,hourly_rate_cents:type==='hourly'?Math.round(hourly*100):0,weekly_salary_cents:type==='salary'?Math.round(weekly*100):0,commission_scope:commissionScope,commission_percent:commissionPercent,effective_at:effective,updated_at:new Date().toISOString()};
    const result=await client.from('staff_compensation').upsert(row,{onConflict:'profile_id'});
    if(result.error) throw result.error;
  }

  function revokePreview() {
    if (!state.previewUrl) return;
    URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = null;
  }

  function setDialogPreview(form, p, avatarValue) {
    const preview = form.querySelector('[data-profile-preview]');
    if (preview) preview.innerHTML = avatarMarkup({...p, avatar_url:avatarValue}, 'xl');
    form.querySelectorAll('[data-avatar-preset]').forEach(button => {
      button.classList.toggle('selected', button.dataset.avatarPreset === avatarValue);
    });
  }

  function openEdit(id) {
    const p = state.profiles.find(x => x.id === id);
    if (!p) return;
    if (id !== current()?.id && !state.canManage) {
      return alert('You do not have permission to edit this employee profile.');
    }

    const d = ensureDialog();
    revokePreview();
    const f = d.querySelector('form');
    f.elements.id.value = p.id;
    f.elements.display_name.value = p.display_name || '';
    f.elements.job_title.value = p.job_title || '';
    f.elements.phone.value = p.phone || '';
    f.elements.bio.value = p.bio || '';
    f.elements.avatar.value = '';
    f.elements.avatar_preset.value = isPreset(p.avatar_url) ? p.avatar_url : '';
    ensureCompensationFields(f,p);
    f.querySelector('[data-avatar-gallery]').innerHTML = presetGalleryMarkup(isPreset(p.avatar_url) ? p.avatar_url : '');
    setDialogPreview(f, p, p.avatar_url || '');
    f.querySelector('.gc-profile-message').textContent = '';
    d.showModal();
  }

  async function uploadAvatar(targetId, file) {
    if (!file?.size) return null;
    if (file.size > 2 * 1024 * 1024) throw new Error('Profile photos must be 2 MB or smaller.');
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Use a JPG, PNG, or WebP profile photo.');

    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${targetId}/${crypto.randomUUID()}.${ext}`;
    const {error} = await client.storage.from('staff-avatars').upload(path, file, {contentType:file.type, upsert:false});
    if (error) throw error;
    return client.storage.from('staff-avatars').getPublicUrl(path).data.publicUrl;
  }

  function mergeSavedProfile(saved) {
    if (!saved?.id) return;
    const index = state.profiles.findIndex(p => p.id === saved.id);
    if (index >= 0) state.profiles[index] = {...state.profiles[index], ...saved};
    if (saved.id === current()?.id) Object.assign(current(), saved);
  }

  async function save(form) {
    if (state.busy) return;
    state.busy = true;

    const msg = form?.querySelector('.gc-profile-message');
    const submit = form?.querySelector('[data-profile-save]');
    if (msg) msg.textContent = 'Saving profile…';
    if (submit) submit.disabled = true;

    try {
      if (!form) throw new Error('Profile form is unavailable.');
      const data = Object.fromEntries(new FormData(form));
      const target = state.profiles.find(x => x.id === data.id);
      if (!target) throw new Error('Profile data is unavailable. Refresh the Portal and try again.');

      const displayName = String(data.display_name || '').trim();
      const jobTitle = String(data.job_title || '').trim() || null;
      const phone = String(data.phone || '').trim() || null;
      const bio = String(data.bio || '').trim() || null;

      if (!displayName) throw new Error('Display name is required.');

      let avatar = target.avatar_url || null;
      const file = form.elements.avatar?.files?.[0];
      if (file?.size) avatar = await uploadAvatar(String(data.id), file);
      else if (data.avatar_preset === '__clear__') avatar = null;
      else if (data.avatar_preset) avatar = String(data.avatar_preset);

      const args = {
        new_display_name: displayName,
        new_job_title: jobTitle,
        new_phone: phone,
        new_bio: bio,
        new_avatar_url: avatar
      };

      const result = data.id === current()?.id
        ? await client.rpc('update_my_staff_profile', args)
        : await client.rpc('update_staff_profile_details', {target_profile:data.id, ...args});

      if (result.error) throw result.error;

      const saved = Array.isArray(result.data) ? result.data[0] : result.data;
      mergeSavedProfile(saved);
      await saveCompensation(form, String(data.id));

      // Re-read after the write so the user never sees stale profile state.
      await load();

      const persisted = state.profiles.find(p => p.id === data.id);
      if (!persisted) throw new Error('Profile saved, but the updated record could not be reloaded.');

      revokePreview();
      document.getElementById('gc-staff-profile-dialog')?.close();
      window.GotCrackedCrossUserSync?.pollNow?.();
      document.dispatchEvent(new CustomEvent('gc-staff-profile-updated', {
        detail: {profileId:data.id, updatedAt:persisted.updated_at || null}
      }));
    } catch (error) {
      const message = error?.message || 'Unable to save profile.';
      if (msg) msg.textContent = message;
      console.error('Staff profile save failed:', error);
      window.GotCrackedDiagnostics?.error?.(error, {context:'Unable to save staff profile'});
    } finally {
      state.busy = false;
      if (submit) submit.disabled = false;
    }
  }

  function decorateActivity() {
    const map = new Map(state.profiles.map(p => [p.display_name, p]));
    document.querySelectorAll('.v1-event,.repair-event').forEach(row => {
      if (row.querySelector('.gc-event-avatar')) return;
      const text = row.querySelector('small')?.textContent || '';
      const match = [...map.keys()].find(name => name && text.includes(name));
      const p = match ? map.get(match) : null;
      if (!p) return;

      const avatar = document.createElement('span');
      avatar.className = 'gc-event-avatar';
      avatar.innerHTML = avatarInner(p);
      const content = row.querySelector(':scope > div:last-child, :scope > div');
      content?.insertAdjacentElement('afterbegin', avatar);
      row.classList.add('gc-event-with-avatar');
    });
  }

  document.addEventListener('click', event => {
    const t = event.target instanceof Element ? event.target : null;
    if (!t) return;

    if (t.closest('.sidebar .profile') && !t.closest('#sign-out')) {
      event.preventDefault();
      ensureProfileView();
      renderProfileView();
      window.GotCrackedUI?.activateView?.('profile');
      return;
    }

    const card = t.closest('[data-open-profile]');
    if (card) {
      renderProfileView(card.dataset.openProfile);
      window.GotCrackedUI?.activateView?.('profile');
      return;
    }

    const edit = t.closest('[data-edit-profile]');
    if (edit) {
      openEdit(edit.dataset.editProfile);
      return;
    }

    const preset = t.closest('[data-avatar-preset]');
    if (preset) {
      const form = preset.closest('form');
      const p = state.profiles.find(x => x.id === form?.elements.id.value);
      if (!form || !p) return;
      revokePreview();
      form.elements.avatar.value = '';
      form.elements.avatar_preset.value = preset.dataset.avatarPreset;
      setDialogPreview(form, p, preset.dataset.avatarPreset);
      return;
    }

    if (t.closest('[data-avatar-clear]')) {
      const form = t.closest('form');
      const p = state.profiles.find(x => x.id === form?.elements.id.value);
      if (!form || !p) return;
      revokePreview();
      form.elements.avatar.value = '';
      form.elements.avatar_preset.value = '__clear__';
      setDialogPreview(form, {...p, display_name:form.elements.display_name.value}, '');
      return;
    }

    if (t.closest('[data-profile-close]')) {
      revokePreview();
      document.getElementById('gc-staff-profile-dialog')?.close();
    }
  });

  document.addEventListener('change', event => {
    const input = event.target;
    if (!input?.matches?.('#gc-staff-profile-form [name="avatar"]')) return;

    const form = input.closest('form');
    const p = state.profiles.find(x => x.id === form?.elements.id.value);
    const file = input.files?.[0];
    if (!form || !p || !file) return;

    revokePreview();
    state.previewUrl = URL.createObjectURL(file);
    form.elements.avatar_preset.value = '';
    const preview = form.querySelector('[data-profile-preview]');
    if (preview) preview.innerHTML = `<span class="gc-staff-avatar xl has-image"><img src="${esc(state.previewUrl)}" alt="Preview"></span>`;
    form.querySelectorAll('[data-avatar-preset]').forEach(button => button.classList.remove('selected'));
  });

  document.addEventListener('gc-view-changed', event => {
    if (event.detail === 'staff' || event.detail === 'profile') {
      load();
      setTimeout(decorateActivity, 80);
    }
  });

  const observer = new MutationObserver(() => {
    ensureProfileView();
    decorateActivity();
  });
  observer.observe(document.body, {childList:true, subtree:true});

  style();
  ensureProfileView();
  ensureDialog();
  setTimeout(load, 400);

  window.GotCrackedStaffProfiles = {version:VERSION, load, openEdit, save, state, avatarMarkup};
})();
