import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const STORE = path.join(process.cwd(), 'agent-jobs.json');
const MAX_JOBS = 50;
const MAX_CONCURRENT = 1;
export const AGENT_ROLES = {
  research: 'Investigate source, production evidence, and root cause. Do not modify anything.',
  portal_ui: 'Plan a narrow Portal UI/UX repair in an isolated worktree. Do not deploy or change protected systems.',
  customer_site: 'Plan a narrow customer-site UI/UX repair in an isolated worktree. Do not deploy or change protected systems.',
  visual_qa: 'Run the AuroraServer headless Chromium visual-QA runner against the Portal before proposing work. Capture desktop/mobile screenshots, DOM overflow/loading-state evidence, console/network failures, and accessibility/layout findings. Return evidence-backed bounded repairs; never claim a visual audit without artifacts.',
  support: 'Diagnose support tickets from supplied evidence and draft a concise resolution or escalation.',
  release: 'Verify a proposed release against supplied checks and define required production evidence. Do not deploy or announce.'
};

let jobs = [];
let running = 0;

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE, 'utf8'));
    jobs = Array.isArray(parsed) ? parsed.slice(-MAX_JOBS) : [];
  } catch { jobs = []; }
}
function saveStore() {
  const safe = jobs.slice(-MAX_JOBS);
  fs.writeFileSync(STORE, JSON.stringify(safe, null, 2) + '\n', { mode: 0o600 });
}
function clean(value, max = 4000) { return String(value ?? '').trim().slice(0, max); }
function publicJob(job) {
  const { task, result, ...meta } = job;
  return { ...meta, task: clean(task, 800), result: result ? clean(result, 4000) : null };
}

readStore();

export function status() {
  return {
    maxConcurrent: MAX_CONCURRENT,
    running,
    roles: Object.keys(AGENT_ROLES),
    queue: jobs.filter(job => ['queued', 'running'].includes(job.status)).map(publicJob),
    recent: jobs.slice(-12).reverse().map(publicJob)
  };
}

export function assign(input = {}) {
  const role = clean(input.role, 40);
  const task = clean(input.task, 4000);
  const surface = clean(input.surface || 'both', 40);
  if (!AGENT_ROLES[role]) throw new Error('Unknown Marlon agent role.');
  if (task.length < 8) throw new Error('Agent task must describe a concrete bounded job.');
  if (jobs.filter(job => ['queued', 'running'].includes(job.status)).length >= 8) {
    throw new Error('Marlon agent queue is at capacity. Wait for an active job to finish.');
  }
  const job = {
    id: crypto.randomUUID(),
    role, surface, task,
    requestedBy: clean(input.requestedBy,100), locationId: clean(input.locationId,100),
    status: 'queued',
    createdAt: new Date().toISOString(),
    startedAt: null, completedAt: null,
    result: null, error: null
  };
  jobs.push(job); saveStore();
  return publicJob(job);
}

function workerSystem(job) {
  return `You are Marlon's ${job.role} worker. ${AGENT_ROLES[job.role]}
You are subordinate to Marlon and may not claim execution. Return concise JSON with:
summary, evidence_needed, safe_next_actions, risks, approval_required.
Use the Marlon operating kit: inspect production and source; run \\`node portal-visual-qa.mjs\\` before UI conclusions; use an isolated fresh worktree for changes; run targeted tests; capture artifacts; commit only intended files; use CI/deployment gates; verify production before patch notes or announcements.
For ordinary low-risk UI, UX, link, loading-state, error-state, accessibility, performance, branding, and deterministic support repairs, recommend execution through Marlon's guarded one-canary executor rather than leaving a proposal idle.
Never include secrets. Never weaken auth, authorization, RLS, payments, or supplier controls. Protected or consequential changes require the established approval gate.
Task surface: ${job.surface}. Assigned task: ${job.task}`;
}

async function runJob(job, runAI) {
  job.status = 'running'; job.startedAt = new Date().toISOString(); saveStore();
  try {
    const response = await runAI(workerSystem(job), [{ role: 'user', content: job.task }], 1100);
    job.result = clean(response?.response || response, 6000);
    job.status = 'completed';
  } catch (error) {
    job.error = clean(error?.message || error, 1000);
    job.status = 'failed';
  }
  job.completedAt = new Date().toISOString(); saveStore();
}

export async function drain(runAI) {
  if (running >= MAX_CONCURRENT) return;
  const job = jobs.find(item => item.status === 'queued');
  if (!job) return;
  running += 1;
  try { await runJob(job, runAI); }
  finally {
    running -= 1;
    if (jobs.some(item => item.status === 'queued')) queueMicrotask(() => drain(runAI));
  }
}

export function getJob(id) {
  const job = jobs.find(item => item.id === clean(id, 100));
  return job ? publicJob(job) : null;
}
