import { currentBranch } from '../git.js';
import { withLock } from '../lock.js';
import { findActiveGoal, touchAndWrite } from '../state.js';
import type { InFlight, Phase } from '../types.js';

const KINDS: ReadonlyArray<InFlight['kind']> = ['oracle', 'test'];
const PHASES: Phase[] = ['plan', 'implement', 'review', 'verify'];

/** Mark a long Oracle/test op as in flight, so health tells a legit long op from a stalled loop.
 * The loop calls this before consulting Oracle / running the test suite; the matching
 * goalRecord (or goalOpClear) clears it. */
export function goalOpStart(repo: string, opts: { goal: string; phase: Phase; kind: InFlight['kind']; now?: Date }): InFlight {
  return withLock(repo, () => {
    if (!PHASES.includes(opts.phase)) throw new Error(`coco: invalid phase '${opts.phase}'`);
    if (!KINDS.includes(opts.kind)) throw new Error("coco: op kind must be oracle|test");
    const goal = findActiveGoal(repo);
    if (!goal || goal.id !== opts.goal) throw new Error(`coco: no active goal '${opts.goal}'`);
    if (currentBranch(repo) !== goal.branch) throw new Error(`coco: not on goal branch ${goal.branch}`);
    // Don't silently overwrite a live marker: that would reset the timeout and hide an older hung
    // op. The caller must op-clear (or record) the previous op first.
    if (goal.inFlight) {
      throw new Error(`coco: an op is already in flight (${goal.inFlight.kind} ${goal.inFlight.phase} since ${goal.inFlight.startedAt}); clear it first`);
    }
    const inFlight: InFlight = { phase: opts.phase, kind: opts.kind, startedAt: (opts.now ?? new Date()).toISOString() };
    goal.inFlight = inFlight;
    touchAndWrite(repo, goal, `op-start:${opts.phase}:${opts.kind}`);
    return inFlight;
  });
}

/** Clear the transient markers — the in-flight op AND the review-unavailable pause. Idempotent.
 * Use to resume the loop after the human has resolved an Oracle issue. */
export function goalOpClear(repo: string, opts: { goal: string }): void {
  withLock(repo, () => {
    const goal = findActiveGoal(repo);
    if (!goal || goal.id !== opts.goal) throw new Error(`coco: no active goal '${opts.goal}'`);
    delete goal.inFlight;
    delete goal.reviewUnavailable;
    touchAndWrite(repo, goal, 'op-clear');
  });
}
