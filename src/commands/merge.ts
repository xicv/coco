import { checkout, ffMerge, gatherLive } from '../git.js';
import { mergeDecision } from '../gate.js';
import { withLock } from '../lock.js';
import { findActiveGoal, touchAndWrite } from '../state.js';

export function mergeGoal(repo: string, id: string): { merged: boolean; reason?: string } {
  return withLock(repo, () => {
    const goal = findActiveGoal(repo);
    if (!goal || goal.id !== id) throw new Error(`coco: no active goal '${id}'`);

    const decision = mergeDecision(goal, gatherLive(repo, goal));
    if (!decision.allowed) return { merged: false, reason: decision.reason };

    // FF-only merge. ffMerge checks out `base` first; if the FF fails (main moved
    // between validation and here), restore the goal branch so a retry is sane.
    const res = ffMerge(repo, goal.base, goal.branch);
    if (!res.ok) {
      checkout(repo, goal.branch);
      return { merged: false, reason: `rebase-needed: ${res.out}` };
    }

    goal.state = 'achieved';
    touchAndWrite(repo, goal, 'merge');
    return { merged: true };
  });
}
