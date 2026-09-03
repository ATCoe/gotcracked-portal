/*
 * Portal Companion deliberately has no fetch cache. Staff and customer data
 * must always pass through the live Portal authorization layer, while Portal's
 * normal deployment headers keep the application code current.
 */
const PORTAL_COMPANION_RELEASE = '20260903-private-app1';

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'GC_PORTAL_COMPANION_RELEASE') {
    event.source?.postMessage({ type:'GC_PORTAL_COMPANION_RELEASE', release:PORTAL_COMPANION_RELEASE });
  }
});

