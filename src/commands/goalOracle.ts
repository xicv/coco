import { currentBranch, headSha, treeHash } from '../git.js';
import { EVIDENCE_MAX } from './goalRecord.js';
import { appendIncident } from '../incidents.js';
import { withLock } from '../lock.js';
import { findActiveGoal, touchAndWrite } from '../state.js';
import type { ReviewUnavailable } from '../types.js';

const REASONS: ReadonlyArray<ReviewUnavailable['reason']> = ['preflight-failed', 'oracle-timeout', 'oracle-error', 'ambiguous-verdict'];

/** Record that Oracle is unavailable / gave no usable verdict for plan|review, after the agent's
 * own retry-once. Sets the durable reviewUnavailable marker (loop pauses, merge refused), clears
 * any inFlight op, and logs an incident. Does NOT append a review event — reviews stay clean|blocking.
 * Cleared by goalOpClear (resume) or a later successful record. */
export function goalOracleUnavailable(
  repo: string,
  opts: { goal: string; phase: ReviewUnavailable['phase']; reason: ReviewUnavailable['reason']; attempts?: number; evidence?: string; now?: Date },
): ReviewUnavailable {
  return withLock(repo, () => {
    if (opts.phase !== 'plan' && opts.phase !== 'review') throw new Error('coco: oracle-unavailable phase must be plan|review');
    if (!REASONS.includes(opts.reason)) throw new Error(`coco: oracle-unavailable reason must be one of ${REASONS.join('|')}`);
    const goal = findActiveGoal(repo);
    if (!goal || goal.id !== opts.goal) throw new Error(`coco: no active goal '${opts.goal}'`);
    if (currentBranch(repo) !== goal.branch) throw new Error(`coco: not on goal branch ${goal.branch}`);
    const marker: ReviewUnavailable = {
      at: (opts.now ?? new Date()).toISOString(),
      phase: opts.phase,
      commit: headSha(repo),
      tree: treeHash(repo),
      reason: opts.reason,
      attempts: opts.attempts != null && opts.attempts > 0 ? Math.floor(opts.attempts) : 1,
      ...(opts.evidence ? { evidence: opts.evidence.slice(0, EVIDENCE_MAX) } : {}),
    };
    goal.reviewUnavailable = marker;
    delete goal.inFlight; // the failed op is over
    appendIncident(repo, 'review-unavailable', { goalId: goal.id, phase: marker.phase, reason: marker.reason, attempts: marker.attempts });
    touchAndWrite(repo, goal, `oracle-unavailable:${marker.phase}:${marker.reason}`);
    return marker;
  });
}
