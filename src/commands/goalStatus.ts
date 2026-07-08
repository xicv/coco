import { existsSync } from 'node:fs';
import { verifyConfigWarnings } from '../cocoConfig.js';
import { deriveFacts, type DerivedFacts } from '../epoch.js';
import { currentBranch, gatherLive, headSha } from '../git.js';
import { nextAction, type LiveGit, type NextAction } from '../gate.js';
import { findActiveGoal, goalPath, readGoal } from '../state.js';

export interface StatusEdge {
  kind:
    | 'wrong-branch'
    | 'dirty-tree'
    | 'rebase-needed'
    | 'oracle-unavailable'
    | 'in-flight'
    | 'verify-policy-changed'
    | 'stuck'
    | 'merge-ready';
  detail: string;
  command?: string;
}

export interface StatusReport {
  goalId: string;
  state: string;
  base: string;
  branch: string;
  currentBranch: string;
  nextAction: NextAction;
  headSha: string; // current HEAD — chain this into the next record's expectedSha
  maxFixRounds: number; // the goal's fix budget — lets the progress card show "round N/max"
  backlogTaskId?: string; // if this goal came from a BACKLOG.md task
  autoMergeAllowed?: boolean; // per-goal forward consent for Layer 2 auto-merge — driver reads this instead of relying on memory
  live: LiveGit;
  facts: DerivedFacts;
  warnings?: string[]; // non-blocking advisories (e.g. verify.testCommand changed in the goal diff)
  warningLevel: 'none' | 'info' | 'warn' | 'block';
  edge?: StatusEdge;
  progressKey: string;
}

function edgeFor(goal: ReturnType<typeof readGoal>, na: NextAction, branch: string, warnings: string[]): StatusEdge | undefined {
  if (goal.inFlight) {
    return { kind: 'in-flight', detail: `${goal.inFlight.kind} ${goal.inFlight.phase} in flight since ${goal.inFlight.startedAt}` };
  }
  if (goal.reviewUnavailable) {
    return {
      kind: 'oracle-unavailable',
      detail: `${goal.reviewUnavailable.phase} unavailable: ${goal.reviewUnavailable.reason} after ${goal.reviewUnavailable.attempts} attempt(s)`,
      command: `coco goal op-clear --goal ${goal.id}`,
    };
  }
  if (na === 'wrong-branch') return { kind: 'wrong-branch', detail: `currently on ${branch}; goal branch is ${goal.branch}`, command: `git checkout ${goal.branch}` };
  if (na === 'commit-or-revert') return { kind: 'dirty-tree', detail: 'working tree is dirty; review/verify are blocked until committed or reverted' };
  if (na === 'rebase-needed') return { kind: 'rebase-needed', detail: `branch is behind ${goal.base}`, command: `git rebase ${goal.base}` };
  if (na === 'escalate-human') return { kind: 'stuck', detail: goal.failureLoop?.count ? `same failure repeated ${goal.failureLoop.count} time(s)` : 'fix budget or human blocker reached' };
  if (na === 'merge-gate') return { kind: 'merge-ready', detail: 'clean review + passing verify; awaiting human merge consent', command: `coco merge --goal ${goal.id}` };
  if (warnings.some((w) => w.includes('verify.testCommand differs'))) {
    return { kind: 'verify-policy-changed', detail: 'verify.testCommand changed in this goal; merge requires explicit acknowledgement', command: `coco merge --goal ${goal.id} --ack-verify-policy-change` };
  }
  return undefined;
}

function warningLevel(na: NextAction, warnings: string[], edge?: StatusEdge): StatusReport['warningLevel'] {
  if (na === 'escalate-human' || edge?.kind === 'oracle-unavailable' || edge?.kind === 'stuck') return 'block';
  if (edge?.kind === 'wrong-branch' || edge?.kind === 'dirty-tree' || edge?.kind === 'rebase-needed' || edge?.kind === 'verify-policy-changed') return 'warn';
  if (warnings.length) return 'info';
  return 'none';
}

export function goalStatus(repo: string, id?: string): StatusReport {
  const goal = id && existsSync(goalPath(repo, id)) ? readGoal(goalPath(repo, id)) : findActiveGoal(repo);
  if (!goal) throw new Error('coco: no matching goal');

  const live = gatherLive(repo, goal);
  const branch = currentBranch(repo);
  const facts = deriveFacts(goal.events, live.tHead);
  const na = nextAction(goal, live);
  // Describe the goal diff even when status is read from another branch (use the goal branch then).
  const warnings = verifyConfigWarnings(repo, goal.base, live.onBranch ? 'HEAD' : goal.branch);
  const edge = edgeFor(goal, na, branch, warnings);
  const head = headSha(repo);
  return {
    goalId: goal.id,
    state: goal.state,
    base: goal.base,
    branch: goal.branch,
    currentBranch: branch,
    nextAction: na,
    headSha: head,
    maxFixRounds: goal.maxFixRounds,
    ...(goal.backlogTaskId ? { backlogTaskId: goal.backlogTaskId } : {}),
    ...(goal.autoMergeAllowed ? { autoMergeAllowed: true } : {}),
    live,
    facts,
    ...(warnings.length ? { warnings } : {}),
    warningLevel: warningLevel(na, warnings, edge),
    ...(edge ? { edge } : {}),
    progressKey: `${goal.id}:${head.slice(0, 12)}:${na}:${edge?.kind ?? 'ok'}:${warnings.length}`,
  };
}
