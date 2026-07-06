import { expect, test } from 'vitest';
import { FINGERPRINT_N, failureSignature, updateFailureLoop } from '../src/fingerprint.js';
import { isStuck } from '../src/gate.js';
import type { DerivedFacts } from '../src/epoch.js';
import type { FailureLoop, GoalEvent, GoalState, Phase, Verdict } from '../src/types.js';

const ev = (phase: Phase, verdict: Verdict | undefined, evidence?: string): GoalEvent => ({
  phase,
  at: '2026-01-01T00:00:00Z',
  commit: 'c',
  tree: 't',
  ...(verdict ? { verdict } : {}),
  ...(evidence ? { evidence } : {}),
});

test('failureSignature is set only for review:blocking / verify:fail', () => {
  expect(failureSignature(ev('review', 'clean', 'x'))).toBeNull();
  expect(failureSignature(ev('verify', 'pass', 'x'))).toBeNull();
  expect(failureSignature(ev('plan', undefined, 'x'))).toBeNull();
  expect(failureSignature(ev('review', 'blocking', 'x'))).toMatch(/^review:blocking:/);
  expect(failureSignature(ev('verify', 'fail', 'x'))).toMatch(/^verify:fail:/);
});

test('signature normalizes whitespace + case in evidence', () => {
  expect(failureSignature(ev('verify', 'fail', 'Test  A\nFAILED'))).toBe(failureSignature(ev('verify', 'fail', 'test a failed')));
});

test('same failure grows the count; an interleaved clean review does NOT reset a verify-fail track', () => {
  let fl: FailureLoop | undefined;
  fl = updateFailureLoop(fl, ev('verify', 'fail', 'boom'));
  expect(fl.count).toBe(1);
  fl = updateFailureLoop(fl, ev('review', 'clean', 'ok')); // clean review that interleaves the loop
  expect(fl.count).toBe(1); // NOT reset
  fl = updateFailureLoop(fl, ev('verify', 'fail', 'boom'));
  expect(fl.count).toBe(2);
  fl = updateFailureLoop(fl, ev('verify', 'fail', 'boom'));
  expect(fl.count).toBe(FINGERPRINT_N);
});

test('a different failure signature restarts the count at 1', () => {
  let fl = updateFailureLoop(undefined, ev('verify', 'fail', 'boom'));
  fl = updateFailureLoop(fl, ev('verify', 'fail', 'boom'));
  fl = updateFailureLoop(fl, ev('verify', 'fail', 'a different error'));
  expect(fl.count).toBe(1);
});

test('verify:pass resolves a verify-fail track (reset to 0)', () => {
  let fl = updateFailureLoop(undefined, ev('verify', 'fail', 'boom'));
  fl = updateFailureLoop(fl, ev('verify', 'pass', 'green'));
  expect(fl.count).toBe(0);
  expect(fl.key).toBe('');
});

test('review:clean resolves a review-blocking track', () => {
  let fl = updateFailureLoop(undefined, ev('review', 'blocking', 'same issue'));
  fl = updateFailureLoop(fl, ev('review', 'clean', 'fixed'));
  expect(fl.count).toBe(0);
});

const facts = (o: Partial<DerivedFacts>): DerivedFacts => ({ implementAtEpoch: true, latestReview: 'clean', latestVerify: 'fail', fixRounds: 0, ...o });
const goalWith = (fl: Partial<FailureLoop>, maxFixRounds = 5): GoalState =>
  ({ maxFixRounds, failureLoop: { key: 'verify:fail:x', count: 0, history: [], ...fl } } as GoalState);

test('isStuck fires at FINGERPRINT_N repeats even while under maxFixRounds', () => {
  expect(isStuck(goalWith({ count: FINGERPRINT_N }), facts({}))).toBe(true);
});

test('isStuck stays false below the fingerprint threshold and under budget', () => {
  expect(isStuck(goalWith({ count: FINGERPRINT_N - 1 }), facts({ latestReview: 'blocking', latestVerify: 'none', fixRounds: 1 }))).toBe(false);
});
