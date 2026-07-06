import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { runWatch, shouldAlert } from '../src/commands/watch.js';
import { appleScript } from '../src/commands/notify.js';
import { initRepo } from '../src/commands/init.js';
import { goalStart } from '../src/commands/goalStart.js';
import { goalClear } from '../src/commands/goalClear.js';
import { goalPath } from '../src/state.js';
import { g, tmpRepo } from './helpers.js';

test('shouldAlert: dedup keyed on (goalId, reason)', () => {
  const last = { goalId: 'g1', reason: 'needs-human' };
  expect(shouldAlert('g1', 'needs-human', 0, 1800, null)).toEqual({ notify: true, reason: 'needs-human' });
  expect(shouldAlert('g1', 'needs-human', 0, 1800, last)).toEqual({ notify: false, reason: 'needs-human' });
  expect(shouldAlert('g1', 'stuck', 0, 1800, last)).toEqual({ notify: true, reason: 'stuck' }); // reason change
  expect(shouldAlert('g2', 'needs-human', 0, 1800, last)).toEqual({ notify: true, reason: 'needs-human' }); // new goal, same problem
  expect(shouldAlert('g1', 'healthy', 5000, 1800, null)).toEqual({ notify: true, reason: 'stalled' });
  expect(shouldAlert('g1', 'healthy', 0, 1800, null)).toEqual({ notify: false, reason: 'healthy' });
});

test('runWatch alerts once per problem, and a NEW goal with the same problem re-alerts', () => {
  const repo = tmpRepo();
  initRepo(repo);
  const id1 = goalStart(repo, { objective: 'x', maxFixRounds: 3, acceptanceChecks: [] }).goalId;
  g(repo, ['checkout', 'main']); // wrong-branch
  const spy = vi.fn();

  expect(runWatch(repo, {}, spy).notified).toBe(true);
  expect(runWatch(repo, {}, spy).notified).toBe(false); // dedup
  expect(spy).toHaveBeenCalledTimes(1);

  goalClear(repo, id1);
  runWatch(repo, {}, spy); // no active goal → records no-goal
  const id2 = goalStart(repo, { objective: 'y', maxFixRounds: 3, acceptanceChecks: [] }).goalId;
  expect(id2).not.toBe(id1);
  g(repo, ['checkout', 'main']);
  expect(runWatch(repo, {}, spy).notified).toBe(true); // new goal, same problem → re-alerts
  expect(spy).toHaveBeenCalledTimes(2);
});

test('runWatch alerts invalid-state for a malformed active goal (not silent no-goal)', () => {
  const repo = tmpRepo();
  initRepo(repo);
  const id = goalStart(repo, { objective: 'x', maxFixRounds: 3, acceptanceChecks: [] }).goalId;
  const p = goalPath(repo, id);
  const goal = JSON.parse(readFileSync(p, 'utf8'));
  goal.events = null; // corrupt but parseable
  writeFileSync(p, JSON.stringify(goal));
  const spy = vi.fn();
  const r = runWatch(repo, {}, spy);
  expect(r.verdict).toBe('invalid-state');
  expect(r.notified).toBe(true);
});

test('runWatch is a no-op with no active goal', () => {
  const repo = tmpRepo();
  initRepo(repo);
  const spy = vi.fn();
  expect(runWatch(repo, {}, spy).notified).toBe(false);
  expect(spy).not.toHaveBeenCalled();
});

test('appleScript escapes quotes/backslashes and flattens newlines (no injection/break)', () => {
  const s = appleScript('ti"tle', 'a"b\\c\nd`e$(f)');
  expect(s).toBe('display notification "a\\"b\\\\c d`e$(f)" with title "ti\\"tle"');
  expect(s).not.toMatch(/\n/);
});
