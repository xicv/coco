import { readAudit, type AuditRecord } from '../audit.js';

// Deterministic analysis over the captured audit stream (no LLM). Surfaces the signals coco-improve
// will later reflect on: where the loop churns (fix rounds), where it fails (verify), where Oracle
// falls over (outages), and how long a green goal waits for the human merge.

export interface GoalAuditSummary {
  goalId: string;
  actions: number;
  fixRounds: number; // blocking reviews recorded
  verifyFails: number;
  oracleOutages: number;
  reachedMerge: boolean;
  finalState?: string;
  verifyToMergeSec?: number; // last clean verify pass → merge/auto-merge latency (human-merge wait)
}

export interface AuditReport {
  totalRecords: number;
  totals: { goals: number; fixRounds: number; verifyFails: number; oracleOutages: number; merges: number };
  goals: GoalAuditSummary[];
}

const isMerge = (a: string): boolean => a === 'merge' || a === 'auto-merge';

/** Fix rounds = distinct trees that got a blocking review — matching the epoch model in src/epoch.ts
 * (a blocking tree can never later be clean on the SAME tree), NOT the raw count of blocking records
 * (re-reviews of one tree must not inflate churn). */
function distinctBlockingTrees(recs: AuditRecord[]): number {
  const trees = new Set<string>();
  for (const r of recs) if (r.action === 'record:review:blocking' && r.tree) trees.add(r.tree);
  return trees.size;
}

function summarize(goalId: string, recs: AuditRecord[]): GoalAuditSummary {
  const s: GoalAuditSummary = {
    goalId,
    actions: recs.length,
    fixRounds: distinctBlockingTrees(recs),
    verifyFails: recs.filter((r) => r.action === 'record:verify:fail').length,
    oracleOutages: recs.filter((r) => r.action.startsWith('oracle-unavailable')).length,
    reachedMerge: recs.some((r) => isMerge(r.action) || r.state === 'achieved'),
  };
  const last = recs[recs.length - 1];
  if (last) s.finalState = last.state;

  // human-merge latency: last clean verify pass → the FIRST merge at/after it (guards a stray earlier merge record)
  const lastPass = [...recs].reverse().find((r) => r.action === 'record:verify:pass');
  if (lastPass) {
    const merge = recs.find((r) => isMerge(r.action) && Date.parse(r.at) >= Date.parse(lastPass.at));
    if (merge) {
      const dt = (Date.parse(merge.at) - Date.parse(lastPass.at)) / 1000;
      if (Number.isFinite(dt)) s.verifyToMergeSec = Math.round(dt);
    }
  }
  return s;
}

/** Aggregate the audit stream per goal (insertion order preserved). Read-only, deterministic. */
export function auditReport(repo: string): AuditReport {
  const recs = readAudit(repo);
  const byGoal = new Map<string, AuditRecord[]>();
  for (const r of recs) {
    const arr = byGoal.get(r.goalId);
    if (arr) arr.push(r);
    else byGoal.set(r.goalId, [r]);
  }
  const goals = [...byGoal.entries()].map(([id, rs]) => summarize(id, rs));
  return {
    totalRecords: recs.length,
    totals: {
      goals: goals.length,
      fixRounds: goals.reduce((n, g) => n + g.fixRounds, 0),
      verifyFails: goals.reduce((n, g) => n + g.verifyFails, 0),
      oracleOutages: goals.reduce((n, g) => n + g.oracleOutages, 0),
      merges: goals.filter((g) => g.reachedMerge).length,
    },
    goals,
  };
}
