import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const html = read('index.html');
const operations = read('operations-v1-core.js');
const registry = read('parts-registry.js');
const analytics = read('analytics.js');

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
  "event.key==='Enter'||event.key===' '"
]) assert.ok(operations.includes(fragment), `Missing operational accessibility guard: ${fragment}`);

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

assert.doesNotMatch(analytics, /report=\{profile,repairs:repairs\.data\|\|\[\].*render\(\);\s*\}/s,
  'Reports must not silently render partial query results without checking errors first.');

console.log(JSON.stringify({
  ok: true,
  checks: [
    'shell control labels',
    'operations control labels',
    'keyboard-operable work and lead rows',
    'Parts Registry labels',
    'Reports fail-visible data guard',
    'range-scoped repair export',
    'accessible sales trend'
  ]
}));
