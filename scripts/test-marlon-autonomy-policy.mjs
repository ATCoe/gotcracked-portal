import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  classifyAutonomousWork,
  investigationRequest,
  isRecipeBlocker,
  retryDelay
} from './marlon-autonomy-policy.mjs';

const routine = classifyAutonomousWork({
  surface: 'portal',
  title: 'Repair broken keyboard navigation in the work-order dialog',
  description: 'A Portal workflow control is unreachable by keyboard.'
});
assert.equal(routine.allowed, true);
assert.equal(routine.releasePriority, 'portal');

const purchaseOrderUi = classifyAutonomousWork({
  surface: 'portal',
  title: 'Repair Purchase Orders page filter',
  description: 'The existing filter loses focus after the results render.'
});
assert.equal(purchaseOrderUi.allowed, true);
assert.equal(classifyAutonomousWork({
  surface: 'portal',
  title: 'Place a paid supplier order for replacement screens'
}).allowed, false);

const broadRoutine = classifyAutonomousWork({
  surface: 'portal',
  title: 'Fix spacing across the whole customer directory',
  description: 'Measured desktop layout issue only.'
});
assert.equal(broadRoutine.allowed, true);

const unknown = investigationRequest(
  { surface: 'portal', title: 'Repair stale work-order status', description: 'Status remains stale after save.' },
  { outcome: 'blocked', blocker: 'outside the verified recipe set' }
);
assert.equal(isRecipeBlocker({ blocker: 'outside the verified recipe set' }), true);
assert.equal(unknown.context.bounded_investigation, true);
assert.match(unknown.description, /Do not reject/i);

for (const text of [
  'Change authentication permissions',
  'Drop the database migration table',
  'Place a paid supplier order',
  'Modify a game save',
  'Change Cloudflare infrastructure'
]) {
  assert.equal(classifyAutonomousWork({ surface: 'portal', title: text }).allowed, false, text);
}

assert.equal(classifyAutonomousWork({ surface: 'mobile', title: 'Fix a mobile label' }).releasePriority, 'non_blocking');
assert.equal(classifyAutonomousWork({ surface: 'mobile', title: 'Fix mobile authentication' }).allowed, false);
assert.deepEqual([retryDelay(0), retryDelay(1), retryDelay(2)], [5000, 10000, 20000]);
assert.equal(retryDelay(99), 120000);

const executor = fs.readFileSync(new URL('./marlon-executor.mjs', import.meta.url), 'utf8');
assert.match(executor, /requiredStages/);
assert.match(executor, /browser_ui_qa/);
const controls = fs.readFileSync(new URL('../supabase/migrations/20260918053000_marlon_general_autonomy_controls.sql', import.meta.url), 'utf8');
assert.match(controls, /marlon_execution_recover_stale/);
assert.match(controls, /gotcracked-marlon-single-active-worker/);
assert.match(controls, /context->>'execution_retry_count'/);
assert.match(controls, /execution_retry_exhausted/);
assert.match(controls, /'execution_next_attempt_at',null/);
const workerGuard = controls.slice(
  controls.indexOf('create or replace function public.marlon_execution_admit_run'),
  controls.indexOf('drop trigger if exists marlon_execution_single_worker_guard')
);
assert.doesNotMatch(workerGuard, /waiting_window/);
console.log(JSON.stringify({
  ok: true,
  checks: [
    'general investigation routing',
    'protected work blocking',
    'mobile priority',
    'bounded backoff',
    'ticket-level stale retry budget',
    'waiting windows do not occupy the compute worker'
  ]
}));
