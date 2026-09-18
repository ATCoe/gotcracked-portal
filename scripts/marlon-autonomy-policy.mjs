const PROTECTED_PATTERNS = [
  /\b(auth(?:entication|orization)?|permission|permissions|rls|role|security boundary)\b/i,
  /\b(payment|payments|billing|checkout|refund)\b/i,
  /\b(secret|secrets|credential|credentials|oauth|password)\b/i,
  /\b(drop|truncate|purge|erase|factory reset|delete data|schema|migration)\b/i,
  /\b(place|submit|approve|pay for|buy)\b.{0,32}\b(supplier|vendor|order|purchase|paid service|procurement)\b/i,
  /\b(game save|games? server|valheim|tamercore)\b/i,
  /\b(cloudflare|infrastructure|terraform|kubernetes|production deploy|irreversible)\b/i
];

const MOBILE_PATTERN = /\b(android|mobile|ios|iphone|ipad|play store|app store)\b/i;
const HIGH_COMPLEXITY_PATTERN = /\b(outage|downtime|restart|reboot|rewrite|rebuild|major redesign|large migration)\b/i;

export function classifyAutonomousWork(ticket = {}) {
  const text = [
    ticket.title,
    ticket.description,
    ticket.category,
    ticket.surface,
    JSON.stringify(ticket.context || {})
  ].filter(Boolean).join(' ');
  const protectedReasons = PROTECTED_PATTERNS
    .filter(pattern => pattern.test(text))
    .map(pattern => pattern.source);
  const highComplexity = HIGH_COMPLEXITY_PATTERN.test(text);
  const mobile = MOBILE_PATTERN.test(text) || String(ticket.surface || '').toLowerCase() === 'mobile';
  const portal = !mobile && ['portal', 'website', 'repository'].includes(String(ticket.surface || '').toLowerCase());

  return {
    allowed: protectedReasons.length === 0 && !highComplexity && portal,
    protected: protectedReasons.length > 0 || highComplexity || !portal,
    reasons: [
      ...protectedReasons.map(() => 'protected-system-or-irreversible-action'),
      ...(highComplexity ? ['high-complexity-or-disruptive-change'] : []),
      ...(!portal ? ['unsupported-or-non-Portal-surface'] : [])
    ],
    mobile,
    releasePriority: mobile ? 'non_blocking' : 'portal'
  };
}

export function isRecipeBlocker(plan = {}) {
  const text = [plan.outcome, plan.blocker, plan.diagnosis].filter(Boolean).join(' ');
  return /recipe|verified patch|known fix|unsupported pattern|outside .*set/i.test(text);
}

export function investigationRequest(ticket, plan = {}) {
  return {
    ...ticket,
    context: {
      ...(ticket.context || {}),
      bounded_investigation: true,
      investigation_reason: isRecipeBlocker(plan)
        ? 'planner-recipe-limit'
        : 'planner-needs-more-evidence'
    },
    description: [
      ticket.description,
      'Investigate this Portal finding using the standard inspect -> understand -> plan -> edit -> test workflow.',
      'Do not reject it solely because no hard-coded recipe exists. Keep the scope bounded to this ticket and preserve protected-system controls.'
    ].filter(Boolean).join('\n\n')
  };
}

export function retryDelay(attempt, baseMs = 5000, maxMs = 120000) {
  const exponent = Math.max(0, Math.min(Number(attempt) || 0, 6));
  return Math.min(maxMs, baseMs * (2 ** exponent));
}

export const MAX_PLANNER_ATTEMPTS = 2;
