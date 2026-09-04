import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildOAuth1Authorization } from '../supabase/functions/mobilesentrix-sync/oauth1.js';
import {
  apiItems,
  buildCatalogUrl,
  normalizeProduct,
  safeSupplierError,
  safeSupplierPath,
} from '../supabase/functions/mobilesentrix-sync/catalog.js';

const authorization = await buildOAuth1Authorization({
  url: 'http://photos.example.net/photos?file=vacation.jpg&size=original',
  method: 'GET',
  consumerKey: 'dpf43f3p2l4k3l03',
  consumerSecret: 'kd94hf93k423kf44',
  token: 'nnch734d00sl2jdk',
  tokenSecret: 'pfkkdhi9sl3r4s00',
  nonce: 'kllo9940pd9333jh',
  timestamp: '1191242096',
});
assert.match(
  authorization,
  /oauth_signature="tR3%2BTy81lMeYAr%2FFid0kMTYa%2FWM%3D"/,
  'OAuth 1.0a signature must match the RFC 5849 example.',
);

const callbackAuthorization = await buildOAuth1Authorization({
  url: 'https://www.mobilesentrix.com/oauth/initiate',
  method: 'POST',
  consumerKey: 'consumer-key',
  consumerSecret: 'consumer-secret',
  nonce: 'fixed-nonce',
  timestamp: '1700000000',
  extraOAuthParameters: {
    oauth_callback: 'https://portal.gotcracked.co/?mobilesentrix_oauth=callback',
  },
});
assert.match(
  callbackAuthorization,
  /oauth_callback="https%3A%2F%2Fportal\.gotcracked\.co%2F%3Fmobilesentrix_oauth%3Dcallback"/,
  'The registered Portal callback must be signed and sent in the OAuth Authorization header.',
);
assert.doesNotMatch(callbackAuthorization, /consumer-secret/);

const catalogUrl = buildCatalogUrl({
  api_base_url: 'https://www.mobilesentrix.com',
  catalog_path: '/api/rest/products',
  pagination_mode: 'magento1',
}, 3, 100);
assert.equal(catalogUrl.pathname, '/api/rest/products');
assert.equal(catalogUrl.searchParams.get('page'), '3');
assert.equal(catalogUrl.searchParams.get('limit'), '100');
assert.equal(catalogUrl.searchParams.get('order'), 'entity_id');
assert.equal(catalogUrl.searchParams.get('dir'), 'asc');
assert.throws(
  () => safeSupplierPath('/\\attacker.example/catalog'),
  /same-origin|configured supplier host/i,
  'Backslash-based cross-origin paths must be rejected before credentials are attached.',
);
assert.throws(
  () => safeSupplierPath('//attacker.example/catalog'),
  /same-origin|configured supplier host/i,
  'Protocol-relative paths must be rejected before credentials are attached.',
);

const keyedProducts = apiItems({
  12: {
    entity_id: '12',
    sku: 'MS-IP15-BAT',
    name: 'iPhone 15 Replacement Battery',
    final_price_without_tax: '24.99',
    is_saleable: '1',
    image: '/i/p/iphone-15-battery.jpg',
  },
  13: {
    entity_id: '13',
    sku: 'MS-S24-OLED',
    name: 'Galaxy S24 OLED Assembly',
    final_price_without_tax: 109.5,
    is_saleable: '0',
  },
});
assert.equal(keyedProducts.length, 2, 'Magento 1 object-keyed product responses must be parsed.');

const normalized = normalizeProduct(keyedProducts[0]);
assert.equal(normalized.sku, 'MS-IP15-BAT');
assert.equal(normalized.brand, 'Apple');
assert.equal(normalized.category, 'Batteries');
assert.equal(normalized.priceCents, 2499);
assert.equal(normalized.availability, 'In stock');
assert.equal(normalized.image, 'https://www.mobilesentrix.com/media/catalog/product/i/p/iphone-15-battery.jpg');
assert.equal(normalized.canonicalKey, 'mobilesentrix:ms-ip15-bat');

const sanitized = safeSupplierError(
  '<html><script>secret=abc</script><body>Unauthorized token=super-secret-value</body></html>',
  401,
);
assert.equal(sanitized.includes('super-secret-value'), false);
assert.match(sanitized, /token=\[redacted\]/i);

const sanitizedJson = safeSupplierError(
  JSON.stringify({ messages: { error: [{ message: 'Unauthorized token=super-secret-json' }] } }),
  401,
);
assert.equal(sanitizedJson.includes('super-secret-json'), false);
assert.match(sanitizedJson, /token=\[redacted\]/i);

const [runtimeLoader, portalModule, portalIndex] = await Promise.all([
  readFile(new URL('../portal-runtime-loader.js', import.meta.url), 'utf8'),
  readFile(new URL('../mobilesentrix-integration.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
]);
assert.match(
  runtimeLoader,
  /mobilesentrix_oauth[\s\S]{0,160}criticalScripts\.push\('mobilesentrix-integration\.js'\)/,
  'The OAuth callback must bootstrap the integration even when the Portal opens on the dashboard.',
);
assert.match(
  portalModule,
  /function clearOAuthCallbackUrl\(\)[\s\S]{0,220}location\.hash='settings'/,
  'The callback must remove OAuth query parameters and route into Settings.',
);
assert.match(
  portalIndex,
  /portal-runtime-loader\.js\?v=20260903-mobilesentrix-oauth1/,
  'The runtime-loader cache key must change with the OAuth callback bootstrap.',
);

console.log('MobileSentrix OAuth, pagination, normalization, error-safety, and Portal callback tests passed.');
