import { existsSync } from 'node:fs';
import { verifyConfigWarnings } from '../cocoConfig.js';
import { deriveFacts, type DerivedFacts } from '../epoch.js';
import { gatherLive, headSha } from '../git.js';
import { nextAction, type LiveGit, type NextAction } from '../gate.js';
import { findActiveGoal, goalPath, readGoal } from '../state.js';

export interface StatusReport {
  goalId: string;
  state: string;
  nextAction: NextAction;
  headSha: string; // current HEAD — chain this into the next record's expectedSha
  backlogTaskId?: string; // if this goal came from a BACKLOG.md task
  autoMergeAllowed?: boolean; // per-goal forward consent for Layer 2 auto-merge — driver reads this instead of relying on memory
  live: LiveGit;
  facts: DerivedFacts;
  warnings?: string[]; // non-blocking advisories (e.g. verify.testCommand changed in the goal diff)
}

export function goalStatus(repo: string, id?: string): StatusReport {
  const goal = id && existsSync(goalPath(repo, id)) ? readGoal(goalPath(repo, id)) : findActiveGoal(repo);
  if (!goal) throw new Error('coco: no matching goal');

  const live = gatherLive(repo, goal);
  // Describe the goal diff even when status is read from another branch (use the goal branch then).
  const warnings = verifyConfigWarnings(repo, goal.base, live.onBranch ? 'HEAD' : goal.branch);
  return {
    goalId: goal.id,
    state: goal.state,
    nextAction: nextAction(goal, live),
    headSha: headSha(repo),
    ...(goal.backlogTaskId ? { backlogTaskId: goal.backlogTaskId } : {}),
    ...(goal.autoMergeAllowed ? { autoMergeAllowed: true } : {}),
    live,
    facts: deriveFacts(goal.events, live.tHead),
    ...(warnings.length ? { warnings } : {}),
  };
}
