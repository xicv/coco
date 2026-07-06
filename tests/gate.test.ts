import { expect, test } from 'vitest';
import { mergeDecision, nextAction } from '../src/gate.js';
import type { GoalEvent, GoalState } from '../src/types.js';

function ev(phase: GoalEvent['phase'], tree: string, verdict?: GoalEvent['verdict']): GoalEvent {
  return { phase, tree, verdict, at: '2026-07-04T00:00:00Z', commit: 'c-' + tree };
}
function goal(events: GoalEvent[], over: Partial<GoalState> = {}): GoalState {
  return {
    id: 'g1', objective: 'x', branch: 'coco/g1', base: 'main', state: 'active',
    maxFixRounds: 3, acceptanceChecks: [], events, ...over,
  };
}
const live = (over = {}) => ({ tHead: 'T1', treeClean: true, onBranch: true, baseMerged: true, ...over });

test('dirty tree → commit-or-revert (highest priority)', () => {
  expect(nextAction(goal([]), live({ treeClean: false }))).toBe('commit-or-revert');
});
test('main advanced → rebase-needed', () => {
  expect(nextAction(goal([]), live({ baseMerged: false }))).toBe('rebase-needed');
});
test('empty goal → plan', () => {
  expect(nextAction(goal([]), live())).toBe('plan');
});
test('plan but no implement in epoch → implement', () => {
  expect(nextAction(goal([ev('plan', 'T1')]), live())).toBe('implement');
});
test('implemented, no review → review', () => {
  expect(nextAction(goal([ev('plan', 'T1'), ev('implement', 'T1')]), live())).toBe('review');
});
test('blocking review under budget → fix', () => {
  const es = [ev('plan', 'T1'), ev('implement', 'T1'), ev('review', 'T1', 'blocking')];
  expect(nextAction(goal(es), live())).toBe('fix');
});
test('blocking review at/over budget → escalate-human', () => {
  const es = [
    ev('plan', 'T1'), ev('implement', 'Ta'), ev('review', 'Ta', 'blocking'),
    ev('implement', 'Tb'), ev('review', 'Tb', 'blocking'),
    ev('implement', 'Tc'), ev('review', 'Tc', 'blocking'),
  ];
  expect(nextAction(goal(es, { maxFixRounds: 3 }), live({ tHead: 'Tc' }))).toBe('escalate-human');
});
test('clean review, no verify → verify', () => {
  const es = [ev('plan', 'T1'), ev('implement', 'T1'), ev('review', 'T1', 'clean')];
  expect(nextAction(goal(es), live())).toBe('verify');
});
test('clean review + verify fail → fix (not verify again)', () => {
  const es = [ev('plan', 'T1'), ev('implement', 'T1'), ev('review', 'T1', 'clean'), ev('verify', 'T1', 'fail')];
  expect(nextAction(goal(es), live())).toBe('fix');
});
test('clean review + verify pass → merge-gate', () => {
  const es = [ev('plan', 'T1'), ev('implement', 'T1'), ev('review', 'T1', 'clean'), ev('verify', 'T1', 'pass')];
  expect(nextAction(goal(es), live())).toBe('merge-gate');
});
test('non-active goal → none', () => {
  expect(nextAction(goal([], { state: 'achieved' }), live())).toBe('none');
});
test('off the goal branch → wrong-branch (never guide edits/tests on e.g. main)', () => {
  expect(nextAction(goal([ev('plan', 'T1'), ev('implement', 'T1')]), live({ onBranch: false }))).toBe('wrong-branch');
});

test('mergeDecision allows only when every gate holds', () => {
  const es = [ev('plan', 'T1'), ev('implement', 'T1'), ev('review', 'T1', 'clean'), ev('verify', 'T1', 'pass')];
  expect(mergeDecision(goal(es), live())).toEqual({ allowed: true });
});
test('mergeDecision refuses when latest review is blocking at the same tree', () => {
  const es = [
    ev('implement', 'T1'), ev('review', 'T1', 'clean'), ev('verify', 'T1', 'pass'),
    ev('review', 'T1', 'blocking'),
  ];
  const d = mergeDecision(goal(es), live());
  expect(d.allowed).toBe(false);
});
test('mergeDecision refuses when branch is behind main', () => {
  const es = [ev('implement', 'T1'), ev('review', 'T1', 'clean'), ev('verify', 'T1', 'pass')];
  expect(mergeDecision(goal(es), live({ baseMerged: false })).allowed).toBe(false);
});
test('mergeDecision refuses when not on the goal branch', () => {
  const es = [ev('implement', 'T1'), ev('review', 'T1', 'clean'), ev('verify', 'T1', 'pass')];
  expect(mergeDecision(goal(es), live({ onBranch: false })).allowed).toBe(false);
});

const reviewUnavailable = { at: '2026-07-04T00:00:00Z', phase: 'review' as const, commit: 'c', tree: 'T1', reason: 'oracle-timeout' as const, attempts: 2 };

test('reviewUnavailable pauses the loop → escalate-human', () => {
  const es = [ev('plan', 'T1'), ev('implement', 'T1')];
  expect(nextAction(goal(es, { reviewUnavailable }), live())).toBe('escalate-human');
});

test('reviewUnavailable is absolute — it beats the git-recovery states (dirty tree)', () => {
  const es = [ev('plan', 'T1'), ev('implement', 'T1')];
  // dirty tree would normally be commit-or-revert; a durable Oracle pause outranks it so status
  // and health agree (both point to the human) rather than telling the loop to keep working.
  expect(nextAction(goal(es, { reviewUnavailable }), live({ treeClean: false }))).toBe('escalate-human');
});

test('reviewUnavailable refuses merge even with a clean review + pass verify (no stale false-green)', () => {
  const es = [ev('plan', 'T1'), ev('implement', 'T1'), ev('review', 'T1', 'clean'), ev('verify', 'T1', 'pass')];
  const d = mergeDecision(goal(es, { reviewUnavailable }), live());
  expect(d.allowed).toBe(false);
  expect(d.reason).toMatch(/unavailable/i);
});
