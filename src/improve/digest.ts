import { auditReport, type FeedbackSummary } from '../commands/audit.js';

// coco-improve digest: a DETERMINISTIC (no-LLM, no web) read over the audit corpus that surfaces
// the loop's pain signals for the reflective skill to reason about. It reports only STRUCTURAL
// signals (the audit records carry structural facts, not semantic prose), and it gates on sample
// size so a thin history can't manufacture confident "findings" from noise.

const MIN_GOALS = 5; // below this the audit window is too small to claim anything → insufficient-data
const MIN_FEEDBACK = 3; // below this structured feedback is too sparse to claim a product-quality signal

// Every proposal that flows from this digest must carry these — the invariant is signal QUALITY,
// never throughput. Optimising the wrong metric (fewer fix rounds / faster merge) rewards weaker
// scrutiny, which is exactly what coco exists to prevent.
export const IMPROVE_ANTI_GOALS: readonly string[] = [
  'Target signal quality — fewer false-greens, stalls, and Oracle outages — never a smaller number for its own sake.',
  'Never optimise throughput: time-to-merge, fix-round count, and verify pass-rate reward weaker scrutiny.',
  'The referee is off-limits (gate / verdict / verify / merge / risk / metrics). Validate every proposed target with `coco improve check`.',
  'Oracle-reliability fixes must NOT loosen retry-once or verdict strictness in the loop skill — improve availability, never scrutiny.',
  'Human feedback is evidence to investigate, not proof; every proposal needs a falsifiable eval or explicit non-regression check.',
];

export interface ImproveSignal {
  key: string;
  status: 'signal' | 'clear' | 'insufficient-data';
  detail: string;
  sample: number; // how many goals/records/feedback entries informed this signal
  safeToActOn: boolean; // false = diagnostic/observational only; NOT a valid optimisation target
  researchTopic?: string; // a fired safeToActOn signal only: the GENERIC, code-controlled query to research (never any coco/audit specifics — so nothing private can leak into an external search)
}

// Static, GENERIC research queries — code-controlled so no repo/audit data can ever enter an external
// search. Attached ONLY to a fired safeToActOn signal (see `signal()`). Keep these free of any dynamic
// coco state (names, paths, ids, counts, timestamps).
const RESEARCH_TOPICS: Record<string, string> = {
  'oracle-reliability': 'reliable retry, backoff, and resume patterns for flaky LLM or tool calls in agent skill instructions',
  'goal-quality-feedback': 'best practices for writing verifiable software engineering goals for AI coding agents',
  'status-clarity-feedback': 'best practices for progress status and recovery messages in AI coding agent workflows',
};

export interface ImproveDigest {
  window: { goals: number; records: number; feedback: number; invalidAudit: number };
  minGoals: number;
  minFeedback: number;
  sufficient: boolean;
  signals: ImproveSignal[];
  antiGoals: readonly string[];
}

function signal(key: string, sufficient: boolean, fired: boolean, detail: string, sample: number, inherentlySafe: boolean): ImproveSignal {
  const status: ImproveSignal['status'] = !sufficient ? 'insufficient-data' : fired ? 'signal' : 'clear';
  // safeToActOn is a LIVE flag: true only for a fired signal that is inherently safe — never while
  // 'clear' or 'insufficient-data' (so a consumer can't act on a non-signal).
  const safeToActOn = status === 'signal' && inherentlySafe;
  // A research topic rides ONLY on a fired safeToActOn signal — so research happens only where an
  // actionable improvement exists, and only against the static code-controlled query.
  const topic = safeToActOn ? RESEARCH_TOPICS[key] : undefined;
  return { key, status, detail, sample, safeToActOn, ...(topic ? { researchTopic: topic } : {}) };
}

function fbKind(f: FeedbackSummary, kind: string): { total: number; negative: number; avgRating?: number } {
  return f.byKind[kind] ?? { total: 0, negative: 0 };
}

function feedbackSignal(
  key: string,
  f: FeedbackSummary,
  kind: string,
  label: string,
  inherentlySafe: boolean,
): ImproveSignal {
  const s = fbKind(f, kind);
  const sufficient = s.total >= MIN_FEEDBACK;
  const avg = s.avgRating;
  const fired = sufficient && (s.negative >= 2 || (avg !== undefined && avg <= 3));
  const detail = sufficient
    ? `${label}: ${s.total} feedback entr${s.total === 1 ? 'y' : 'ies'}, avg ${avg ?? 'n/a'}, ${s.negative} negative${fired ? ' — investigate this quality surface' : ''}`
    : `${label}: ${s.total}/${MIN_FEEDBACK} feedback entries — insufficient structured feedback`;
  return signal(key, sufficient, fired, detail, s.total, inherentlySafe);
}

/** Deterministic pain digest over the audit corpus. Read-only. */
export function improveDigest(repo: string): ImproveDigest {
  const rep = auditReport(repo);
  const goals = rep.totals.goals;
  const sufficient = goals >= MIN_GOALS;

  const highChurn = rep.goals.filter((g) => g.fixRounds >= 3).length;
  const verifyFailGoals = rep.goals.filter((g) => g.verifyFails > 0).length;
  const latencies = rep.goals.map((g) => g.verifyToMergeSec).filter((v): v is number => typeof v === 'number');
  const avgLatency = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : undefined;

  const signals: ImproveSignal[] = [
    // The one original signal safe to act on directly: Oracle reliability. A recurring outage is a
    // loop/skill guidance gap (retry/resume), fixing which improves signal availability without touching scrutiny.
    signal(
      'oracle-reliability',
      sufficient,
      rep.totals.oracleOutages >= 3,
      `${rep.totals.oracleOutages} Oracle outage(s) across ${goals} goal(s)${rep.totals.oracleOutages >= 3 ? ' — investigate retry/resume guidance in the loop skill' : ''}`,
      goals,
      true,
    ),
    // Safe product-quality signals: they target skill/workflow clarity, not referee looseness. Every
    // promoted task must still pass the protected-path guard and carry an eval/non-regression check.
    feedbackSignal('goal-quality-feedback', rep.feedback, 'goal-quality', 'goal quality', true),
    feedbackSignal('status-clarity-feedback', rep.feedback, 'status-clarity', 'status clarity', true),
    // Diagnostic only: implementation-quality complaints often point at scope/verification/review but
    // can tempt throughput optimisation. Use them to investigate; do not optimise the count directly.
    feedbackSignal('implementation-quality-feedback', rep.feedback, 'implementation-quality', 'implementation quality', false),
    // Audit validity is a trust substrate problem. It is surfaced prominently but not safe for
    // coco-improve because audit/metrics files are protected from self-improvement changes.
    signal(
      'audit-validity',
      true,
      !rep.validity.ok,
      rep.validity.ok ? 'audit stream valid' : `${rep.validity.failures.length} audit validity failure(s) — self-improvement must pause until a human fixes the audit substrate`,
      rep.validity.totalLines,
      false,
    ),
    // Diagnostic only: high churn points at a planning/skill gap — investigate the CAUSE; the count
    // itself must never be optimised (that would reward weaker review).
    signal(
      'recurring-churn',
      sufficient,
      highChurn >= 2,
      `${highChurn} goal(s) with >=3 fix rounds${highChurn >= 2 ? ' — likely a planning/skill gap; diagnose the cause, do NOT optimise the count' : ''}`,
      goals,
      false,
    ),
    // Observational metrics — surfaced for context, never a fire-able optimisation target.
    signal('verify-failures', sufficient, false, `${verifyFailGoals}/${goals} goal(s) hit a verify failure`, goals, false),
    signal(
      'human-merge-latency',
      sufficient,
      false,
      avgLatency != null ? `avg verify→merge ${avgLatency}s over ${latencies.length} merged goal(s)` : 'no merged goals in window',
      latencies.length,
      false,
    ),
  ];

  return {
    window: { goals, records: rep.totalRecords, feedback: rep.feedback.total, invalidAudit: rep.validity.invalidRecords },
    minGoals: MIN_GOALS,
    minFeedback: MIN_FEEDBACK,
    sufficient,
    signals,
    antiGoals: IMPROVE_ANTI_GOALS,
  };
}
