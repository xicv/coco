import { expect, test } from 'vitest';
import type { GoalEvent } from '../src/types.js';
import { deriveFacts, epochEvents } from '../src/epoch.js';

function ev(phase: GoalEvent['phase'], tree: string, verdict?: GoalEvent['verdict']): GoalEvent {
  return { phase, tree, verdict, at: '2026-07-04T00:00:00Z', commit: 'c-' + tree };
}

test('epoch is the suffix since the branch last arrived at the current tree', () => {
  const events = [ev('implement', 'T1'), ev('review', 'T1', 'clean'), ev('implement', 'T2')];
  // Current tree T2: only the T2 events count.
  expect(epochEvents(events, 'T2').map((e) => e.phase)).toEqual(['implement']);
  // Current tree T1 but the latest activity already moved to T2 → no live T1 epoch:
  // old T1 approvals must NOT revive without fresh events (reverting-tree protection).
  expect(epochEvents(events, 'T1').map((e) => e.phase)).toEqual([]);
});

test('no-op commit (same tree) keeps the whole epoch', () => {
  const events = [ev('implement', 'T1'), ev('review', 'T1', 'clean'), ev('verify', 'T1', 'pass')];
  const f = deriveFacts(events, 'T1');
  expect(f).toEqual({ implementAtEpoch: true, latestReview: 'clean', latestVerify: 'pass', fixRounds: 0 });
});

test('reverting to an earlier clean tree does NOT revive its approval', () => {
  const events = [
    ev('implement', 'T1'), ev('review', 'T1', 'clean'), ev('verify', 'T1', 'pass'),
    ev('implement', 'T2'), ev('review', 'T2', 'blocking'),
    ev('implement', 'T1'),
  ];
  const f = deriveFacts(events, 'T1');
  expect(f.implementAtEpoch).toBe(true);
  expect(f.latestReview).toBe('none');
  expect(f.latestVerify).toBe('none');
});

test('latest verdict within the epoch wins', () => {
  const events = [ev('implement', 'T1'), ev('review', 'T1', 'clean'), ev('review', 'T1', 'blocking')];
  expect(deriveFacts(events, 'T1').latestReview).toBe('blocking');
});

test('a BAD verdict is tree-global — reverting to a previously blocked/failed tree stays bad', () => {
  // review: T1 blocked, moved to T2 (clean), reverted to the identical T1 tree → still blocking
  const reviewEvents = [
    ev('implement', 'T1'), ev('review', 'T1', 'blocking'),
    ev('implement', 'T2'), ev('review', 'T2', 'clean'),
    ev('implement', 'T1'),
  ];
  expect(deriveFacts(reviewEvents, 'T1').latestReview).toBe('blocking');

  // verify: T1 failed once; even a later (drifted) clean review on the reverted T1 keeps verify fail,
  // while clean/pass stay epoch-local (the good review shows, the historical fail still carries)
  const verifyEvents = [
    ev('implement', 'T1'), ev('review', 'T1', 'clean'), ev('verify', 'T1', 'fail'),
    ev('implement', 'T2'), ev('review', 'T2', 'clean'), ev('verify', 'T2', 'pass'),
    ev('implement', 'T1'), ev('review', 'T1', 'clean'),
  ];
  const f = deriveFacts(verifyEvents, 'T1');
  expect(f.latestReview).toBe('clean'); // clean is epoch-local (no blocking ever at T1)
  expect(f.latestVerify).toBe('fail'); // the historical fail for T1 carries across the revert
});

test('fixRounds counts distinct blocking trees, not raw events', () => {
  const events = [
    ev('review', 'T1', 'blocking'), ev('review', 'T1', 'blocking'),
    ev('review', 'T2', 'blocking'),
    ev('review', 'T3', 'clean'),
  ];
  expect(deriveFacts(events, 'T3').fixRounds).toBe(2);
});
