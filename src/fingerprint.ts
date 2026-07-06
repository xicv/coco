import { createHash } from 'node:crypto';
import type { FailureLoop, GoalEvent } from './types.js';

/** A failure repeated this many times in a row is a stuck loop → escalate-human. */
export const FINGERPRINT_N = 3;
const HISTORY_MAX = 10;

/** The failure signature for a review:blocking / verify:fail event, else null (not a failure).
 * Key = phase + verdict + a hash of the NORMALIZED evidence (the failure content), so two
 * failures are "the same" only when their reported detail matches. commit/tree are deliberately
 * NOT in the key — a new tree is fix progress, tracked in history for audit, not sameness. */
export function failureSignature(ev: GoalEvent): string | null {
  const isFailure = (ev.phase === 'review' && ev.verdict === 'blocking') || (ev.phase === 'verify' && ev.verdict === 'fail');
  if (!isFailure) return null;
  const norm = (ev.evidence ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  const hash = createHash('sha256').update(norm).digest('hex').slice(0, 12);
  return `${ev.phase}:${ev.verdict}:${hash}`;
}

/** Fold an event into the failure-loop counter. A failure with the SAME signature as the tracked
 * one grows the count; a different failure signature restarts at 1. A non-failure only resets the
 * counter when it RESOLVES the tracked failure (verify:pass clears a verify:fail track; review:clean
 * clears a review:blocking track) — the review:clean that interleaves a verify-fail loop must NOT
 * reset it, else the counter could never accumulate. Only failures append to the bounded history.
 * Never called on status/health polling — only on an actual goalRecord. */
export function updateFailureLoop(prev: FailureLoop | undefined, ev: GoalEvent): FailureLoop {
  const sig = failureSignature(ev);
  const priorHistory = prev?.history ?? [];
  if (sig) {
    const count = prev && prev.key === sig ? prev.count + 1 : 1; // same failure grows; different restarts
    const history = [...priorHistory, { key: sig, at: ev.at, commit: ev.commit, tree: ev.tree }].slice(-HISTORY_MAX);
    return { key: sig, count, history };
  }
  const resolves =
    (prev?.key.startsWith('verify:fail') && ev.phase === 'verify' && ev.verdict === 'pass') ||
    (prev?.key.startsWith('review:blocking') && ev.phase === 'review' && ev.verdict === 'clean');
  if (resolves) return { key: '', count: 0, history: priorHistory };
  return prev ?? { key: '', count: 0, history: [] }; // otherwise keep the counter (don't reset mid-loop)
}
