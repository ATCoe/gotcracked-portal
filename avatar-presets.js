(() => {
  'use strict';
  if (window.GotCrackedAvatarPresets) return;

  const presets = [
    {
      id:'micro-bot', name:'Micro Bot',
      svg:`<svg viewBox="0 0 96 96" aria-hidden="true"><defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0a1b31"/><stop offset="1" stop-color="#0f3b5d"/></linearGradient></defs><circle cx="48" cy="48" r="46" fill="url(#a)"/><path d="M48 17v10M42 17h12" stroke="#55d8ff" stroke-width="4" stroke-linecap="round"/><rect x="24" y="29" width="48" height="38" rx="12" fill="#132a40" stroke="#62dcff" stroke-width="3"/><circle cx="38" cy="46" r="6" fill="#6bf4ff"/><circle cx="58" cy="46" r="6" fill="#6bf4ff"/><path d="M34 59h28" stroke="#7aa9c7" stroke-width="3" stroke-linecap="round"/><path d="M23 40h-7v16h7M73 40h7v16h-7" stroke="#4eb5dc" stroke-width="3"/><path d="M31 72v8M48 72v8M65 72v8" stroke="#6bf4ff" stroke-width="3" stroke-linecap="round"/></svg>`
    },
    {
      id:'solder-spark', name:'Solder Spark',
      svg:`<svg viewBox="0 0 96 96" aria-hidden="true"><circle cx="48" cy="48" r="46" fill="#15192b"/><path d="M23 67L55 35" stroke="#f7b24a" stroke-width="9" stroke-linecap="round"/><path d="M19 72l11-2-8-8z" fill="#d7dde8"/><path d="M58 32l14-14" stroke="#657a93" stroke-width="8" stroke-linecap="round"/><path d="M68 24l8 8" stroke="#9aa9b8" stroke-width="5"/><path d="M57 49l7-11 2 10 11-5-7 11 10 2-15 12 1-12z" fill="#52dcff"/><circle cx="47" cy="56" r="5" fill="#ff8d3d"/></svg>`
    },
    {
      id:'chip-core', name:'Chip Core',
      svg:`<svg viewBox="0 0 96 96" aria-hidden="true"><defs><radialGradient id="c"><stop stop-color="#5ff3ff"/><stop offset=".5" stop-color="#2b83ff"/><stop offset="1" stop-color="#101b37"/></radialGradient></defs><circle cx="48" cy="48" r="46" fill="#071326"/><rect x="25" y="25" width="46" height="46" rx="10" fill="#14243a" stroke="#4fa6ff" stroke-width="3"/><rect x="35" y="35" width="26" height="26" rx="6" fill="url(#c)"/><g stroke="#6ee8ff" stroke-width="3"><path d="M19 33h7M19 47h7M19 61h7M70 33h7M70 47h7M70 61h7M33 19v7M47 19v7M61 19v7M33 70v7M47 70v7M61 70v7"/></g><path d="M42 41h12v12H42z" fill="#d9fbff" opacity=".75"/></svg>`
    },
    {
      id:'circuit-fox', name:'Circuit Fox',
      svg:`<svg viewBox="0 0 96 96" aria-hidden="true"><circle cx="48" cy="48" r="46" fill="#171326"/><path d="M23 29l16 8 9-12 9 12 16-8-7 28-18 16-18-16z" fill="#f06a3d" stroke="#ffb16f" stroke-width="2"/><path d="M31 36l9 7 8-5 8 5 9-7-4 17-13 11-13-11z" fill="#2c2032"/><path d="M37 48h8M51 48h8" stroke="#71e7ff" stroke-width="4" stroke-linecap="round"/><path d="M48 55v8M48 63l-7 5M48 63l7 5" stroke="#71e7ff" stroke-width="2"/><circle cx="29" cy="28" r="3" fill="#71e7ff"/><circle cx="67" cy="28" r="3" fill="#71e7ff"/></svg>`
    },
    {
      id:'volt-cat', name:'Volt Cat',
      svg:`<svg viewBox="0 0 96 96" aria-hidden="true"><circle cx="48" cy="48" r="46" fill="#081c24"/><path d="M25 34l8-14 10 12h10l10-12 8 14v27c0 10-10 18-23 18S25 71 25 61z" fill="#163747" stroke="#45e3d4" stroke-width="3"/><path d="M36 48h8M52 48h8" stroke="#c8fff7" stroke-width="4" stroke-linecap="round"/><path d="M50 34l-8 15h8l-5 14 13-19h-8l6-10z" fill="#ffd43d"/><path d="M39 66c6 4 12 4 18 0" stroke="#45e3d4" stroke-width="2" fill="none"/></svg>`
    },
    {
      id:'scope-owl', name:'Scope Owl',
      svg:`<svg viewBox="0 0 96 96" aria-hidden="true"><circle cx="48" cy="48" r="46" fill="#101727"/><path d="M25 31l14-8 9 10 9-10 14 8-3 32-20 15-20-15z" fill="#24324a" stroke="#7b8dff" stroke-width="3"/><circle cx="37" cy="47" r="11" fill="#09111f" stroke="#63e6ff" stroke-width="3"/><circle cx="59" cy="47" r="11" fill="#09111f" stroke="#63e6ff" stroke-width="3"/><path d="M31 47h4l2-5 4 10 3-5h4M53 47h4l2-5 4 10 3-5h2" stroke="#66ffb5" stroke-width="2" fill="none"/><path d="M44 61l4 5 4-5" fill="#f8b54b"/></svg>`
    },
    {
      id:'pcb-skull', name:'PCB Skull',
      svg:`<svg viewBox="0 0 96 96" aria-hidden="true"><circle cx="48" cy="48" r="46" fill="#071810"/><path d="M28 41c0-15 9-23 20-23s20 8 20 23c0 10-4 17-10 21v12H38V62c-6-4-10-11-10-21z" fill="#c8f4dd" stroke="#38d47e" stroke-width="3"/><circle cx="39" cy="45" r="7" fill="#0b2216"/><circle cx="57" cy="45" r="7" fill="#0b2216"/><path d="M44 58h8l-4-7z" fill="#0b2216"/><path d="M39 67v7M45 67v7M51 67v7M57 67v7" stroke="#0b2216" stroke-width="3"/><g stroke="#50ff9a" stroke-width="2"><path d="M28 32h-9v-7M68 32h9v-7M26 54H16v8M70 54h10v8"/></g><g fill="#50ff9a"><circle cx="19" cy="25" r="3"/><circle cx="77" cy="25" r="3"/><circle cx="16" cy="62" r="3"/><circle cx="80" cy="62" r="3"/></g></svg>`
    },
    {
      id:'capacitor-crew', name:'Capacitor Crew',
      svg:`<svg viewBox="0 0 96 96" aria-hidden="true"><circle cx="48" cy="48" r="46" fill="#201521"/><rect x="30" y="22" width="36" height="48" rx="12" fill="#643660" stroke="#ff7dc8" stroke-width="3"/><rect x="34" y="27" width="28" height="6" rx="3" fill="#f5b2de"/><circle cx="41" cy="47" r="5" fill="#fff0f8"/><circle cx="55" cy="47" r="5" fill="#fff0f8"/><path d="M39 58c6 5 12 5 18 0" stroke="#fff0f8" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M39 70v10M57 70v10" stroke="#ff7dc8" stroke-width="4"/><path d="M23 39h7M66 39h7M23 55h7M66 55h7" stroke="#ff9bd4" stroke-width="3"/></svg>`
    },
    {
      id:'repair-raven', name:'Repair Raven',
      svg:`<svg viewBox="0 0 96 96" aria-hidden="true"><circle cx="48" cy="48" r="46" fill="#10131e"/><path d="M25 54c2-19 14-31 34-31 8 0 14 2 19 5-8 2-14 6-17 11 7 0 12 3 15 7-9 0-14 3-18 8-5 7-13 14-28 17z" fill="#273149" stroke="#677cff" stroke-width="3"/><circle cx="53" cy="36" r="5" fill="#73e3ff"/><path d="M59 43l22 5-20 8" fill="#aab5c8"/><path d="M25 69l13-13" stroke="#ffad47" stroke-width="6" stroke-linecap="round"/><path d="M20 75l10-3-7-7z" fill="#d8e0eb"/></svg>`
    },
    {
      id:'gear-gecko', name:'Gear Gecko',
      svg:`<svg viewBox="0 0 96 96" aria-hidden="true"><circle cx="48" cy="48" r="46" fill="#102116"/><path d="M31 59c-7-9-4-23 6-29 9-5 20-2 25 6 5 8 3 17-3 22-5 4-12 4-17 1-4-2-8 1-7 5 1 5 8 7 14 5 8-2 12-8 14-13" fill="none" stroke="#6ee17b" stroke-width="8" stroke-linecap="round"/><circle cx="42" cy="38" r="4" fill="#d6ffbc"/><path d="M59 20l3 7 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" fill="#ffcb4c"/><path d="M21 63l12-12" stroke="#6bc8ff" stroke-width="5"/><path d="M17 69l9-2-6-6z" fill="#d8e1ea"/></svg>`
    }
  ];

  const byId = new Map(presets.map(item=>[item.id,item]));
  function get(value){ return byId.get(String(value||'').replace(/^preset:/,'')) || null; }
  function render(value){ return get(value)?.svg || ''; }
  function isPreset(value){ return String(value||'').startsWith('preset:') && Boolean(get(value)); }

  window.GotCrackedAvatarPresets={presets,get,render,isPreset};
})();
