(() => {
  'use strict';
  const id = 'gc-intake-modal-release-style';
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = 'intake-modal-release.css?v=20260825-release16';
  document.head.appendChild(link);
})();
