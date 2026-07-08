import { readAuditDetailed, type AuditRecord } from '../audit.js';

// Deterministic analysis over the captured audit stream (no LLM). Surfaces the signals coco-improve
// reflects on: where the loop churns (fix rounds), where it fails (verify), where Oracle falls over
// (outages), whether audit itself is trustworthy, and what structured human feedback says.

export interface GoalAuditSummary {
  goalId: string;
  actions: number;
  fixRounds: number; // distinct blocking review trees
  verifyFails: number;
  oracleOutages: number;
  reachedMerge: boolean;
  finalState?: string;
  verifyToMergeSec?: number; // last clean verify pass → merge/auto-merge latency (human-merge wait)
}

export interface FeedbackSummary {
  total: number;
  negative: number;
  avgRating?: number;
  byKind: Record<string, { total: number; negative: number; avgRating?: number }>;
  topTags: [string, number][];
}

export interface AuditValidityFailure {
  goalId?: string;
  line?: number;
  code: string;
  detail: string;
}

export interface AuditValidityReport {
  ok: boolean;
  totalLines: number;
  validRecords: number;
  invalidRecords: number;
  failures: AuditValidityFailure[];
}

export interface AuditReport {
  totalRecords: number;
  totals: { goals: number; fixRounds: number; verifyFails: number; oracleOutages: number; merges: number };
  validity: AuditValidityReport;
  feedback: FeedbackSummary;
  goals: GoalAuditSummary[];
}

const isMerge = (a: string): boolean => a === 'merge' || a === 'auto-merge' || a === 'merge:verify-policy-ack';
const isFeedback = (r: AuditRecord): boolean => r.action.startsWith('feedback:');

/** Fix rounds = distinct trees that got a blocking review — matching the epoch model in src/epoch.ts
 * (a blocking tree can never later be clean on the SAME tree), NOT the raw count of blocking records
 * (re-reviews of one tree must not inflate churn). */
function distinctBlockingTrees(recs: AuditRecord[]): number {
  const trees = new Set<string>();
  for (const r of recs) if (r.action === 'record:review:blocking' && r.tree) trees.add(r.tree);
  return trees.size;
}

function summarize(goalId: string, recs: AuditRecord[]): GoalAuditSummary {
  const nonFeedback = recs.filter((r) => !isFeedback(r));
  const s: GoalAuditSummary = {
    goalId,
    actions: nonFeedback.length,
    fixRounds: distinctBlockingTrees(nonFeedback),
    verifyFails: nonFeedback.filter((r) => r.action === 'record:verify:fail').length,
    oracleOutages: nonFeedback.filter((r) => r.action.startsWith('oracle-unavailable')).length,
    reachedMerge: nonFeedback.some((r) => isMerge(r.action) || r.state === 'achieved'),
  };
  const last = nonFeedback[nonFeedback.length - 1];
  if (last) s.finalState = last.state;

  // human-merge latency: last clean verify pass → the FIRST merge at/after it (guards a stray earlier merge record)
  const lastPass = [...nonFeedback].reverse().find((r) => r.action === 'record:verify:pass');
  if (lastPass) {
    const merge = nonFeedback.find((r) => isMerge(r.action) && Date.parse(r.at) >= Date.parse(lastPass.at));
    if (merge) {
      const dt = (Date.parse(merge.at) - Date.parse(lastPass.at)) / 1000;
      if (Number.isFinite(dt)) s.verifyToMergeSec = Math.round(dt);
    }
  }
  return s;
}

function feedbackSummary(recs: AuditRecord[]): FeedbackSummary {
  const feedback = recs.filter((r) => isFeedback(r) && typeof r.rating === 'number');
  const byKindRaw = new Map<string, AuditRecord[]>();
  const tags = new Map<string, number>();
  for (const r of feedback) {
    const k = r.kind ?? r.action.replace(/^feedback:/, '');
    const arr = byKindRaw.get(k);
    if (arr) arr.push(r);
    else byKindRaw.set(k, [r]);
    for (const t of r.tags ?? []) tags.set(t, (tags.get(t) ?? 0) + 1);
  }
  const avg = (xs: AuditRecord[]): number | undefined => {
    const nums = xs.map((r) => r.rating).filter((v): v is number => typeof v === 'number');
    return nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : undefined;
  };
  const byKind: FeedbackSummary['byKind'] = {};
  for (const [k, xs] of byKindRaw) {
    const a = avg(xs);
    byKind[k] = {
      total: xs.length,
      negative: xs.filter((r) => (r.rating ?? 5) <= 2).length,
      ...(a !== undefined ? { avgRating: a } : {}),
    };
  }
  const a = avg(feedback);
  return {
    total: feedback.length,
    negative: feedback.filter((r) => (r.rating ?? 5) <= 2).length,
    ...(a !== undefined ? { avgRating: a } : {}),
    byKind,
    topTags: [...tags.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10),
  };
}

function auditInvariants(records: AuditRecord[]): AuditValidityFailure[] {
  const failures: AuditValidityFailure[] = [];
  const byGoal = new Map<string, AuditRecord[]>();
  for (const r of records) {
    if (r.action.startsWith('record:review:') && (r.phase !== 'review' || !['clean', 'blocking'].includes(r.verdict ?? ''))) {
      failures.push({ goalId: r.goalId, code: 'bad-review-record', detail: `${r.action} must carry phase=review and verdict clean|blocking` });
    }
    if (r.action.startsWith('record:verify:') && (r.phase !== 'verify' || !['pass', 'fail'].includes(r.verdict ?? ''))) {
      failures.push({ goalId: r.goalId, code: 'bad-verify-record', detail: `${r.action} must carry phase=verify and verdict pass|fail` });
    }
    if (r.action.startsWith('feedback:') && (!r.kind || typeof r.rating !== 'number')) {
      failures.push({ goalId: r.goalId, code: 'bad-feedback-record', detail: `${r.action} must carry kind and rating` });
    }
    const arr = byGoal.get(r.goalId);
    if (arr) arr.push(r);
    else byGoal.set(r.goalId, [r]);
  }

  for (const [goalId, recs] of byGoal) {
    let prev = -Infinity;
    let sawVerifyPass = false;
    for (const r of recs) {
      const t = Date.parse(r.at);
      if (!Number.isFinite(t)) failures.push({ goalId, code: 'bad-timestamp', detail: `${r.action} has an unparseable timestamp` });
      if (Number.isFinite(t) && t < prev) failures.push({ goalId, code: 'non-monotonic-time', detail: `${r.action} timestamp moved backwards` });
      if (Number.isFinite(t)) prev = t;
      if (r.action === 'record:verify:pass') sawVerifyPass = true;
      if (isMerge(r.action) && !sawVerifyPass) failures.push({ goalId, code: 'merge-before-verify-pass', detail: `${r.action} appeared before any verify pass` });
    }
  }
  return failures;
}

/** Validate audit shape + cross-record invariants. Read-only and deterministic. */
export function auditValidate(repo: string): AuditValidityReport {
  const detailed = readAuditDetailed(repo);
  const parseFailures: AuditValidityFailure[] = detailed.invalid.map((i) => ({ line: i.line, code: 'invalid-line', detail: `${i.reason} [${i.rawHash}]` }));
  const failures = [...parseFailures, ...auditInvariants(detailed.records)];
  return {
    ok: failures.length === 0,
    totalLines: detailed.totalLines,
    validRecords: detailed.records.length,
    invalidRecords: detailed.invalid.length,
    failures,
  };
}

/** Aggregate the audit stream per goal (insertion order preserved). Read-only, deterministic. */
export function auditReport(repo: string): AuditReport {
  const detailed = readAuditDetailed(repo);
  const recs = detailed.records;
  const byGoal = new Map<string, AuditRecord[]>();
  for (const r of recs) {
    if (isFeedback(r)) continue;
    const arr = byGoal.get(r.goalId);
    if (arr) arr.push(r);
    else byGoal.set(r.goalId, [r]);
  }
  const goals = [...byGoal.entries()].map(([id, rs]) => summarize(id, rs));
  const validity = auditValidate(repo);
  return {
    totalRecords: recs.length,
    totals: {
      goals: goals.length,
      fixRounds: goals.reduce((n, g) => n + g.fixRounds, 0),
      verifyFails: goals.reduce((n, g) => n + g.verifyFails, 0),
      oracleOutages: goals.reduce((n, g) => n + g.oracleOutages, 0),
      merges: goals.filter((g) => g.reachedMerge).length,
    },
    validity,
    feedback: feedbackSummary(recs),
    goals,
  };
}
