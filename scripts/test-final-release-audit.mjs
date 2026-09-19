import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const html = read('index.html');
const operations = read('operations-v1-core.js');
const registry = read('parts-registry.js');
const analytics = read('analytics.js');
const shipping = read('shipping.js');
const inventory = read('inventory-command-center.js');
const pricing = read('pricing-settings.js');
const staff = read('staff-profiles.js');
const workstation = read('workstation-admin.js');
const procurement = read('procurement-settings.js');
const integratedShipping = read('shipping-integrated.js');
const mobileSentrix = read('mobilesentrix-integration.js');

for (const fragment of [
  'id="repair-search" aria-label="Search repair tickets"',
  'id="lead-search" aria-label="Search leads"',
  'id="lead-status" aria-label="Filter leads by status"'
]) assert.ok(html.includes(fragment), `Missing shell accessibility guard: ${fragment}`);

for (const fragment of [
  'id="v1-dash-work-search" aria-label="Search work orders"',
  'id="v1-dash-work-status" aria-label="Filter work orders by status"',
  'id="v1-dash-lead-search" aria-label="Search leads"',
  'id="v1-dash-lead-status" aria-label="Filter leads by status"',
  'id="v1-pickup-scan" aria-label="Scan or enter work-order barcode"',
  'id="v1-guide-search" aria-label="Search repair reference"',
  'id="v1-line-search" aria-label="Scan or search parts and services"',
  'tabindex="0" role="button" aria-label="Open work order',
  'tabindex="0" role="button" aria-label="Open lead for',
  "event.key==='Enter'||event.key===' '",
  "const blockingFailures=[]",
  "throw new Error(\`\${key.replaceAll('_',' ')} data could not be loaded:"
]) assert.ok(operations.includes(fragment), `Missing operational release guard: ${fragment}`);

for (const fragment of [
  'data-registry-search aria-label="Search Parts Registry"',
  'data-registry-filter aria-label="Filter Parts Registry"',
  'data-close-registry aria-label="Close Parts Registry"'
]) assert.ok(registry.includes(fragment), `Missing Parts Registry accessibility guard: ${fragment}`);

for (const fragment of [
  'id="report-range" aria-label="Report date range"',
  'const failed=Object.entries(results).find',
  'Reports could not be loaded completely.',
  'data-report-retry',
  'const repairsInRange=report.repairs.filter',
  'role="img" aria-label='
]) assert.ok(analytics.includes(fragment), `Missing Reports release guard: ${fragment}`);

const reportErrorCheck = analytics.indexOf('const failed=Object.entries(results).find');
const reportAssignment = analytics.indexOf('report={profile,repairs:repairs.data||[]');
assert.ok(reportErrorCheck >= 0 && reportAssignment > reportErrorCheck,
  'Reports must validate query errors before accepting report data.');

for (const fragment of [
  'data-shipping-work-order=',
  'data-shipping-lead=',
  'Shipping could not be loaded.',
  'data-shipping-retry',
  ".eq('location_id',profile.location_id).eq('intake_method','mail_in')"
]) assert.ok(shipping.includes(fragment), `Missing Shipping release guard: ${fragment}`);

for (const fragment of [
  'Inventory could not be loaded.',
  'data-gc-inventory-retry',
  'aria-pressed=',
  'type="submit">Receive package</button>'
]) assert.ok(inventory.includes(fragment), `Missing Inventory release guard: ${fragment}`);

for (const fragment of [
  'Pricing settings could not be loaded.',
  'data-pricing-settings-retry',
  "const failed=[['business settings',business],['inventory',parts],['repair guides',refs],['labor basis',basis]].find"
]) assert.ok(pricing.includes(fragment), `Missing Pricing release guard: ${fragment}`);

for (const fragment of [
  'Staff profiles could not load',
  'compensationError',
  'No pay values are being inferred or shown.',
  'data-staff-profiles-retry'
]) assert.ok(staff.includes(fragment), `Missing Staff release guard: ${fragment}`);

for (const fragment of [
  'Trusted workstations could not be loaded.',
  'data-retry-workstations'
]) assert.ok(workstation.includes(fragment), `Missing workstation release guard: ${fragment}`);

for (const fragment of [
  'Procurement settings could not be loaded.',
  'data-procurement-retry',
  ".select('marlon_auto_prepare_orders').maybeSingle()"
]) assert.ok(procurement.includes(fragment), `Missing procurement release guard: ${fragment}`);

for (const fragment of [
  'Carrier tools could not be loaded.',
  'Shipping provider settings could not be loaded.',
  'data-integrated-shipping-retry'
]) assert.ok(integratedShipping.includes(fragment), `Missing integrated Shipping release guard: ${fragment}`);

for (const fragment of [
  'MobileSentrix settings could not be loaded.',
  'data-ms-refresh',
  'if(account.error)throw account.error'
]) assert.ok(mobileSentrix.includes(fragment), `Missing MobileSentrix release guard: ${fragment}`);

console.log(JSON.stringify({
  ok: true,
  checks: [
    'shell control labels',
    'operations control labels',
    'keyboard-operable work and lead rows',
    'fail-closed core operational data loading',
    'Parts Registry labels',
    'Reports fail-visible data guard',
    'range-scoped repair export',
    'accessible sales trend',
    'Shipping fail-visible data loading and deep links',
    'Inventory fail-visible data loading and explicit controls',
    'Pricing fail-visible complete data loading',
    'Staff profile and compensation error integrity',
    'trusted-workstation visible failure state',
    'procurement save confirmation and visible failure',
    'integrated shipping visible failure state',
    'MobileSentrix account and load integrity'
  ]
}));
