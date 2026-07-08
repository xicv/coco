import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendAudit, auditPath } from '../audit.js';
import { deriveFacts } from '../epoch.js';
import { FINGERPRINT_N } from '../fingerprint.js';
import { nextAction } from '../gate.js';
import { parseOracleVerdict } from '../oracleVerdict.js';
import type { GoalEvent, GoalState } from '../types.js';
import { auditValidate } from './audit.js';

export interface EvalCaseResult {
  id: string;
  area: 'verdict' | 'epoch' | 'gate' | 'audit' | 'privacy' | 'self-improve';
  invariant: string;
  ok: boolean;
  detail?: string;
}

export interface EvalReport {
  ok: boolean;
  total: number;
  failed: number;
  cases: EvalCaseResult[];
}

type EvalCase = Omit<EvalCaseResult, 'ok' | 'detail'> & { run: () => boolean; detail?: string };

const ev = (phase: GoalEvent['phase'], tree: string, verdict?: GoalEvent['verdict']): GoalEvent => ({
  phase,
  tree,
  verdict,
  commit: `${tree}-commit`,
  at: '2026-07-08T00:00:00.000Z',
});

function activeGoal(partial: Partial<GoalState> = {}): GoalState {
  return {
    id: 'eval-goal',
    objective: 'eval',
    branch: 'coco/eval-goal',
    base: 'main',
    baseTree: 'base-tree',
    state: 'active',
    maxFixRounds: 5,
    acceptanceChecks: [],
    events: [],
    ...partial,
  };
}

function auditInvalidFixture(): boolean {
  const repo = mkdtempSync(join(tmpdir(), 'coco-eval-audit-'));
  appendAudit(repo, { v: 1, at: '2026-07-08T00:00:00.000Z', goalId: 'g', action: 'goal-start', state: 'active', events: 0 });
  appendAudit(repo, { v: 1, at: '2026-07-08T00:01:00.000Z', goalId: 'g', action: 'merge', state: 'achieved', events: 0 });
  writeFileSync(auditPath(repo), '{bad json\n', { flag: 'a' });
  const v = auditValidate(repo);
  return !v.ok && v.invalidRecords === 1 && v.failures.some((f) => f.code === 'merge-before-verify-pass');
}

const cases: EvalCase[] = [
  {
    id: 'oracle-verdict-ambiguous-fails-closed',
    area: 'verdict',
    invariant: 'Oracle text without an exact terminal verdict must not become clean.',
    run: () => parseOracleVerdict('Looks good to me') === null,
  },
  {
    id: 'oracle-verdict-clean-is-strict',
    area: 'verdict',
    invariant: 'Only an exact VERDICT line grants a clean review verdict.',
    run: () => parseOracleVerdict('Reviewed.\nVERDICT: clean') === 'clean',
  },
  {
    id: 'bad-verdict-sticks-to-tree',
    area: 'epoch',
    invariant: 'A tree that ever received a blocking review remains blocking for that tree.',
    run: () => deriveFacts([ev('implement', 't1'), ev('review', 't1', 'blocking'), ev('review', 't1', 'clean')], 't1').latestReview === 'blocking',
  },
  {
    id: 'revert-to-old-clean-tree-requires-fresh-review',
    area: 'epoch',
    invariant: 'Returning to an old clean tree does not revive its approval after later work.',
    run: () => deriveFacts([ev('implement', 'clean-tree'), ev('review', 'clean-tree', 'clean'), ev('implement', 'bad-tree'), ev('review', 'bad-tree', 'blocking')], 'clean-tree').latestReview === 'none',
  },
  {
    id: 'fingerprint-loop-escalates',
    area: 'gate',
    invariant: 'The same repeated failure fingerprint escalates to a human instead of looping forever.',
    run: () =>
      nextAction(
        activeGoal({
          events: [ev('implement', 't1'), ev('review', 't1', 'blocking')],
          failureLoop: { key: 'same-failure', count: FINGERPRINT_N, history: [] },
        }),
        { tHead: 't1', treeClean: true, onBranch: true, baseMerged: true },
      ) === 'escalate-human',
  },
  {
    id: 'review-unavailable-pauses-above-git-recovery',
    area: 'gate',
    invariant: 'Oracle unavailable/ambiguous verdict pauses durably before normal git recovery advice.',
    run: () =>
      nextAction(
        activeGoal({
          reviewUnavailable: { at: '2026-07-08T00:00:00.000Z', phase: 'review', commit: 'c', tree: 't', reason: 'ambiguous-verdict', attempts: 1 },
        }),
        { tHead: 't', treeClean: false, onBranch: true, baseMerged: true },
      ) === 'escalate-human',
  },
  {
    id: 'audit-invalidity-is-detected',
    area: 'audit',
    invariant: 'Invalid/torn audit lines and impossible merge ordering are detected before self-improvement trusts them.',
    run: auditInvalidFixture,
  },
];

export function runEval(): EvalReport {
  const results = cases.map((c): EvalCaseResult => {
    try {
      const ok = c.run();
      return { id: c.id, area: c.area, invariant: c.invariant, ok, ...(ok ? {} : { detail: c.detail ?? 'invariant returned false' }) };
    } catch (e) {
      return { id: c.id, area: c.area, invariant: c.invariant, ok: false, detail: (e as Error).message };
    }
  });
  const failed = results.filter((r) => !r.ok).length;
  return { ok: failed === 0, total: results.length, failed, cases: results };
}
