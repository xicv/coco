import { deriveFacts, type DerivedFacts } from './epoch.js';
import { FINGERPRINT_N } from './fingerprint.js';
import type { GoalState } from './types.js';

export type NextAction =
  | 'wrong-branch'
  | 'commit-or-revert'
  | 'rebase-needed'
  | 'plan'
  | 'implement'
  | 'review'
  | 'fix'
  | 'escalate-human'
  | 'verify'
  | 'merge-gate'
  | 'none';

export interface LiveGit {
  tHead: string;
  treeClean: boolean;
  onBranch: boolean;
  baseMerged: boolean;
}

/** A goal is stuck when it has exhausted its fix budget on a blocking review, OR the same
 * failure signature has repeated FINGERPRINT_N times in a row (fingerprint stuck-detection). */
export function isStuck(goal: GoalState, f: DerivedFacts): boolean {
  if (f.latestReview === 'blocking' && f.fixRounds >= goal.maxFixRounds) return true;
  if ((goal.failureLoop?.count ?? 0) >= FINGERPRINT_N) return true;
  return false;
}

export function nextAction(goal: GoalState, live: LiveGit): NextAction {
  if (goal.state !== 'active') return 'none';
  // Absolute human-pause: Oracle down/ambiguous ranks above the git-recovery actions so status
  // and health agree (status must not say "commit-or-revert" while health says review-unavailable).
  if (goal.reviewUnavailable) return 'escalate-human';
  if (!live.onBranch) return 'wrong-branch'; // never guide edits/tests on the wrong branch (e.g. main)
  if (!live.treeClean) return 'commit-or-revert';
  if (!live.baseMerged) return 'rebase-needed';

  const f = deriveFacts(goal.events, live.tHead);
  if (!goal.events.some((e) => e.phase === 'plan')) return 'plan';
  if (!f.implementAtEpoch) return 'implement';
  if (f.latestReview === 'none') return 'review';
  if (f.latestReview === 'blocking') return isStuck(goal, f) ? 'escalate-human' : 'fix';
  // latestReview === 'clean'
  if (f.latestVerify === 'pass') return 'merge-gate';
  if (f.latestVerify === 'fail') return isStuck(goal, f) ? 'escalate-human' : 'fix';
  return 'verify';
}

export function mergeDecision(goal: GoalState, live: LiveGit): { allowed: boolean; reason?: string } {
  if (goal.state !== 'active') return { allowed: false, reason: 'goal not active' };
  if (goal.reviewUnavailable) return { allowed: false, reason: 'Oracle review unavailable — resolve and re-review first' };
  if (!live.onBranch) return { allowed: false, reason: 'not on goal branch' };
  if (!live.treeClean) return { allowed: false, reason: 'working tree dirty' };

  const f = deriveFacts(goal.events, live.tHead);
  if (!f.implementAtEpoch) return { allowed: false, reason: 'no implement in current epoch' };
  if (f.latestReview !== 'clean') return { allowed: false, reason: `latest review is ${f.latestReview}` };
  if (f.latestVerify !== 'pass') return { allowed: false, reason: `verify is ${f.latestVerify}` };
  if (!live.baseMerged) return { allowed: false, reason: 'branch behind main; rebase needed' };
  return { allowed: true };
}
