import type { GoalEvent } from './types.js';

export interface DerivedFacts {
  implementAtEpoch: boolean;
  latestReview: 'clean' | 'blocking' | 'none';
  latestVerify: 'pass' | 'fail' | 'none';
  fixRounds: number;
}

/** Events since the branch last arrived at `tHead` (all have tree === tHead). */
export function epochEvents(events: GoalEvent[], tHead: string): GoalEvent[] {
  let start = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].tree !== tHead) {
      start = i + 1;
      break;
    }
  }
  return events.slice(start);
}

export function deriveFacts(events: GoalEvent[], tHead: string): DerivedFacts {
  const epoch = epochEvents(events, tHead);
  const reviews = epoch.filter((e) => e.phase === 'review');
  const verifies = epoch.filter((e) => e.phase === 'verify');

  const epochReview = reviews.length
    ? (reviews[reviews.length - 1].verdict as 'clean' | 'blocking')
    : 'none';
  const epochVerify = verifies.length
    ? (verifies[verifies.length - 1].verdict as 'pass' | 'fail')
    : 'none';

  // Monotonic per-tree, GLOBALLY for BAD verdicts: a tree that was ever blocking/fail stays that way
  // even after the branch left it and returned to an identical tHead — otherwise a revert to a
  // previously-rejected tree would re-bless it. clean/pass stay epoch-local (a revert to an earlier
  // clean tree must NOT revive its approval — see epochEvents), so only bad verdicts carry across.
  const blockedForTree = events.some((e) => e.tree === tHead && e.phase === 'review' && e.verdict === 'blocking');
  const failedForTree = events.some((e) => e.tree === tHead && e.phase === 'verify' && e.verdict === 'fail');
  const latestReview = blockedForTree ? 'blocking' : epochReview;
  const latestVerify = failedForTree ? 'fail' : epochVerify;

  // fixRounds: distinct trees whose LATEST review verdict is 'blocking'.
  const latestByTree = new Map<string, 'clean' | 'blocking'>();
  for (const e of events) {
    if (e.phase === 'review' && e.verdict) latestByTree.set(e.tree, e.verdict as 'clean' | 'blocking');
  }
  let fixRounds = 0;
  for (const v of latestByTree.values()) if (v === 'blocking') fixRounds++;

  return {
    implementAtEpoch: epoch.some((e) => e.phase === 'implement'),
    latestReview,
    latestVerify,
    fixRounds,
  };
}
