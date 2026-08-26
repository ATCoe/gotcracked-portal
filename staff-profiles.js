(() => {
  'use strict';
  if (window.GotCrackedStaffProfiles) return;
  const client=window.supabaseClient; if(!client) return;
  const state={profiles:[],selected:null,canManage:false,busy:false,previewUrl:null};
  const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[c]);
  const current=()=>window.GotCrackedRuntimeProfile||window.GotCrackedOperationsV1?.state?.profile||null;
  const presets=()=>window.GotCrackedAvatarPresets?.presets||[];
  const isPreset=value=>window.GotCrackedAvatarPresets?.isPreset?.(value)||false;
  const presetSvg=value=>window.GotCrackedAvatarPresets?.render?.(value)||'';
  const initials=name=>String(name||'GC').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase()||'GC';
  const roleLabel=v=>String(v||'staff').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());

  function style(){
    if(document.querySelector('link[data-gc-staff-profiles]'))return;
    const l=document.createElement('link');l.rel='stylesheet';l.href='staff-profiles.css?v=20260826-sp2';l.dataset.gcStaffProfiles='true';document.head.appendChild(l);
  }

  function avatarInner(p){
    const value=p?.avatar_url||'';
    if(isPreset(value)) return presetSvg(value);
    if(value) return `<img src="${esc(value)}" alt="">`;
    return esc(initials(p?.display_name));
  }
  function avatarMarkup(p,size=''){return `<span class="gc-staff-avatar ${size} ${p?.avatar_url?'has-image':''}">${avatarInner(p)}</span>`;}

  function ensureProfileView(){
    const main=document.querySelector('.app-shell main');if(!main)return;
    if(!document.getElementById('profile')){
      const s=document.createElement('section');s.id='profile';s.className='view';s.innerHTML='<div id="gc-profile-view"></div>';
      const settings=document.getElementById('settings');settings?settings.insertAdjacentElement('beforebegin',s):main.appendChild(s);
    }
    const card=document.querySelector('.sidebar .profile');
    if(card&&!card.dataset.gcProfileBound){card.dataset.gcProfileBound='true';card.classList.add('gc-profile-launcher');card.title='Open your staff profile';}
  }

  function presetGalleryMarkup(selected=''){
    return `<section class="gc-avatar-preset-section full"><div class="gc-avatar-preset-head"><div><strong>Repair avatar gallery</strong><small>Choose a GotCracked electronics avatar or upload your own.</small></div><button class="text-button" type="button" data-avatar-clear>Use initials</button></div><div class="gc-avatar-preset-grid">${presets().map(item=>{const value=`preset:${item.id}`;return `<button type="button" class="gc-avatar-preset ${selected===value?'selected':''}" data-avatar-preset="${esc(value)}" aria-label="Use ${esc(item.name)} avatar"><span>${item.svg}</span><small>${esc(item.name)}</small></button>`;}).join('')}</div></section>`;
  }

  function ensureDialog(){
    if(document.getElementById('gc-staff-profile-dialog'))return;
    const d=document.createElement('dialog');d.id='gc-staff-profile-dialog';d.className='gc-staff-profile-dialog';
    d.innerHTML=`<form id="gc-staff-profile-form"><div class="gc-profile-dialog-head"><div><p class="eyebrow">Staff account</p><h2>Edit profile</h2></div><button type="button" class="icon-button" data-profile-close>×</button></div><div class="gc-profile-dialog-body"><input type="hidden" name="id"><input type="hidden" name="avatar_preset"><div class="gc-profile-photo-editor full"><div data-profile-preview></div><div class="gc-profile-photo-actions"><label class="secondary-button">Upload your own<input name="avatar" type="file" accept="image/jpeg,image/png,image/webp" hidden></label><small>JPG, PNG, or WebP · 2 MB max</small></div></div><div data-avatar-gallery class="full"></div><label>Display name<input name="display_name" maxlength="120" required></label><label>Job title<input name="job_title" maxlength="120" placeholder="Repair Technician"></label><label>Phone<input name="phone" maxlength="40" inputmode="tel"></label><label class="full">Bio<textarea name="bio" maxlength="600" placeholder="Skills, specialties, certifications, or a short team bio."></textarea></label><p class="gc-profile-message full" role="status"></p></div><div class="gc-profile-dialog-actions"><button type="button" class="secondary-button" data-profile-close>Cancel</button><button type="submit" class="primary-button">Save profile</button></div></form>`;
    document.body.appendChild(d);
  }

  async function load(){
    const p=current();if(!p?.location_id)return;
    const perm=await client.rpc('has_permission',{permission_key:'staff.manage'});state.canManage=Boolean(perm.data);
    const {data,error}=await client.from('profiles').select('id,location_id,display_name,role,active,avatar_url,job_title,phone,bio,discord_user_id,discord_username,recovery_email,portal_email,onboarding_status,discord_invite_expires_at,created_at,updated_at').eq('location_id',p.location_id).order('display_name');
    if(error){console.warn('Staff profiles unavailable:',error.message);return;}
    state.profiles=data||[];syncCurrentProfile();renderProfileView(state.selected||current()?.id);renderStaffCards();decorateActivity();
  }

  function syncCurrentProfile(){
    const p=current(),row=state.profiles.find(x=>x.id===p?.id);if(!p||!row)return;Object.assign(p,row);
    const avatar=document.getElementById('staff-initials');if(avatar){avatar.innerHTML=avatarInner(row);avatar.classList.toggle('has-image',Boolean(row.avatar_url));}
    const name=document.getElementById('staff-name');if(name)name.textContent=row.display_name;
  }

  function renderProfileView(id=current()?.id){
    const host=document.getElementById('gc-profile-view');if(!host)return;
    const p=state.profiles.find(x=>x.id===id)||state.profiles.find(x=>x.id===current()?.id);
    if(!p){host.innerHTML='<div class="empty-card"><h2>Profile unavailable</h2></div>';return;}
    state.selected=p.id;
    const canEdit=p.id===current()?.id||state.canManage;
    host.innerHTML=`<div class="gc-profile-page-head"><div><p class="eyebrow">Staff identity</p><h1>${p.id===current()?.id?'My profile':'Employee profile'}</h1><p>Profile details are used throughout the Portal for staff identity and repair activity.</p></div>${canEdit?`<button class="primary-button" type="button" data-edit-profile="${p.id}">Edit profile</button>`:''}</div><section class="gc-profile-hero"><div class="gc-profile-photo">${avatarMarkup(p,'xl')}</div><div class="gc-profile-copy"><h2>${esc(p.display_name)}</h2><p>${esc(p.job_title||roleLabel(p.role))}</p><div class="gc-profile-badges"><span>${esc(roleLabel(p.role))}</span><span>${p.active?'Active':'Inactive'}</span>${p.discord_user_id?'<span>Discord linked</span>':''}${p.onboarding_status&&p.onboarding_status!=='active'?`<span>${esc(p.onboarding_status.replaceAll('_',' '))}</span>`:''}${isPreset(p.avatar_url)?'<span>GotCracked avatar</span>':''}</div></div></section><div class="gc-profile-grid"><article><small>Portal login</small><strong>${esc(p.portal_email||'Legacy account')}</strong></article><article><small>Portal role</small><strong>${esc(roleLabel(p.role))}</strong></article><article><small>Discord</small><strong>${esc(p.discord_username||(p.discord_user_id?'Linked':'Not linked'))}</strong></article><article><small>Onboarding</small><strong>${esc((p.onboarding_status||'active').replaceAll('_',' '))}</strong></article></div><article class="gc-profile-bio"><h2>About</h2><p>${esc(p.bio||'No profile bio yet.')}</p></article>`;
  }

  function renderStaffCards(){
    const staff=document.getElementById('staff');if(!staff)return;
    let host=document.getElementById('gc-staff-profiles');
    if(!host){host=document.createElement('section');host.id='gc-staff-profiles';host.className='card gc-staff-profiles';const list=document.getElementById('staff-management-list');list?list.insertAdjacentElement('afterend',host):staff.appendChild(host);}
    host.innerHTML=`<div class="card-title"><div><h2>Employee profiles</h2><p>Names, photos, job titles, and team identity used throughout the Portal.</p></div></div><div class="gc-staff-profile-grid">${state.profiles.map(p=>`<button type="button" class="gc-staff-profile-card" data-open-profile="${p.id}">${avatarMarkup(p,'lg')}<span><strong>${esc(p.display_name)}</strong><small>${esc(p.job_title||roleLabel(p.role))}</small></span><em>${p.active?'Active':'Inactive'}</em></button>`).join('')}</div>`;
  }

  function revokePreview(){if(state.previewUrl){URL.revokeObjectURL(state.previewUrl);state.previewUrl=null;}}
  function setDialogPreview(form,p,avatarValue){
    const preview=form.querySelector('[data-profile-preview]');if(preview)preview.innerHTML=avatarMarkup({...p,avatar_url:avatarValue},'xl');
    form.querySelectorAll('[data-avatar-preset]').forEach(button=>button.classList.toggle('selected',button.dataset.avatarPreset===avatarValue));
  }

  function openEdit(id){
    const p=state.profiles.find(x=>x.id===id);if(!p)return;
    if(id!==current()?.id&&!state.canManage)return alert('You do not have permission to edit this employee profile.');
    ensureDialog();revokePreview();
    const d=document.getElementById('gc-staff-profile-dialog'),f=d.querySelector('form');
    f.elements.id.value=p.id;f.elements.display_name.value=p.display_name||'';f.elements.job_title.value=p.job_title||'';f.elements.phone.value=p.phone||'';f.elements.bio.value=p.bio||'';f.elements.avatar.value='';
    f.elements.avatar_preset.value=isPreset(p.avatar_url)?p.avatar_url:'';
    f.querySelector('[data-avatar-gallery]').innerHTML=presetGalleryMarkup(isPreset(p.avatar_url)?p.avatar_url:'');
    setDialogPreview(f,p,p.avatar_url||'');f.querySelector('.gc-profile-message').textContent='';d.showModal();
  }

  async function uploadAvatar(targetId,file){
    if(!file?.size)return null;
    if(file.size>2*1024*1024)throw new Error('Profile photos must be 2 MB or smaller.');
    if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Use a JPG, PNG, or WebP profile photo.');
    const ext=file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg';const path=`${targetId}/${crypto.randomUUID()}.${ext}`;
    const {error}=await client.storage.from('staff-avatars').upload(path,file,{contentType:file.type,upsert:false});if(error)throw error;
    return client.storage.from('staff-avatars').getPublicUrl(path).data.publicUrl;
  }

  async function save(form){
    if(state.busy)return;state.busy=true;
    const msg=form.querySelector('.gc-profile-message');msg.textContent='Saving profile…';
    const data=Object.fromEntries(new FormData(form));const target=state.profiles.find(x=>x.id===data.id);
    try{
      let avatar=target?.avatar_url||null;const file=form.elements.avatar.files?.[0];
      if(file?.size) avatar=await uploadAvatar(data.id,file);
      else if(data.avatar_preset==='__clear__') avatar=null;
      else if(data.avatar_preset) avatar=data.avatar_preset;
      let result;
      if(data.id===current()?.id) result=await client.rpc('update_my_staff_profile',{new_display_name:data.display_name.trim(),new_job_title:data.job_title.trim()||null,new_phone:data.phone.trim()||null,new_bio:data.bio.trim()||null,new_avatar_url:avatar});
      else result=await client.rpc('update_staff_profile_details',{target_profile:data.id,new_display_name:data.display_name.trim(),new_job_title:data.job_title.trim()||null,new_phone:data.phone.trim()||null,new_bio:data.bio.trim()||null,new_avatar_url:avatar});
      if(result.error)throw result.error;
      revokePreview();document.getElementById('gc-staff-profile-dialog')?.close();await load();window.GotCrackedCrossUserSync?.pollNow?.();
    }catch(error){msg.textContent=error.message||'Unable to save profile.';}finally{state.busy=false;}
  }

  function decorateActivity(){
    const map=new Map(state.profiles.map(p=>[p.display_name,p]));
    document.querySelectorAll('.v1-event,.repair-event').forEach(row=>{
      if(row.querySelector('.gc-event-avatar'))return;
      const text=row.querySelector('small')?.textContent||'';const match=[...map.keys()].find(name=>name&&text.includes(name));const p=match?map.get(match):null;if(!p)return;
      const avatar=document.createElement('span');avatar.className='gc-event-avatar';avatar.innerHTML=avatarInner(p);
      const content=row.querySelector(':scope > div:last-child, :scope > div');content?.insertAdjacentElement('afterbegin',avatar);row.classList.add('gc-event-with-avatar');
    });
  }

  document.addEventListener('click',event=>{
    const t=event.target instanceof Element?event.target:null;if(!t)return;
    if(t.closest('.sidebar .profile')&&!t.closest('#sign-out')){event.preventDefault();ensureProfileView();renderProfileView();window.GotCrackedUI?.activateView?.('profile');return;}
    const card=t.closest('[data-open-profile]');if(card){renderProfileView(card.dataset.openProfile);window.GotCrackedUI?.activateView?.('profile');return;}
    const edit=t.closest('[data-edit-profile]');if(edit){openEdit(edit.dataset.editProfile);return;}
    const preset=t.closest('[data-avatar-preset]');if(preset){const form=preset.closest('form'),p=state.profiles.find(x=>x.id===form?.elements.id.value);if(!form||!p)return;revokePreview();form.elements.avatar.value='';form.elements.avatar_preset.value=preset.dataset.avatarPreset;setDialogPreview(form,p,preset.dataset.avatarPreset);return;}
    if(t.closest('[data-avatar-clear]')){const form=t.closest('form'),p=state.profiles.find(x=>x.id===form?.elements.id.value);if(!form||!p)return;revokePreview();form.elements.avatar.value='';form.elements.avatar_preset.value='__clear__';setDialogPreview(form,{...p,display_name:form.elements.display_name.value},'');return;}
    if(t.closest('[data-profile-close]')){revokePreview();document.getElementById('gc-staff-profile-dialog')?.close();}
  });

  document.addEventListener('change',event=>{
    const input=event.target;if(!input?.matches?.('#gc-staff-profile-form [name="avatar"]'))return;
    const form=input.closest('form'),p=state.profiles.find(x=>x.id===form?.elements.id.value),file=input.files?.[0];if(!form||!p||!file)return;
    revokePreview();state.previewUrl=URL.createObjectURL(file);form.elements.avatar_preset.value='';
    const preview=form.querySelector('[data-profile-preview]');if(preview)preview.innerHTML=`<span class="gc-staff-avatar xl has-image"><img src="${esc(state.previewUrl)}" alt="Preview"></span>`;
    form.querySelectorAll('[data-avatar-preset]').forEach(button=>button.classList.remove('selected'));
  });

  document.addEventListener('submit',event=>{if(event.target?.id!=='gc-staff-profile-form')return;event.preventDefault();save(event.target);});
  document.addEventListener('gc-view-changed',event=>{if(event.detail==='staff'||event.detail==='profile'){load();setTimeout(decorateActivity,80);}});
  const observer=new MutationObserver(()=>{ensureProfileView();decorateActivity();});observer.observe(document.body,{childList:true,subtree:true});
  style();ensureProfileView();ensureDialog();setTimeout(load,400);
  window.GotCrackedStaffProfiles={load,openEdit,state,avatarMarkup};
})();
