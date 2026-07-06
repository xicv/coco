import { execFileSync } from 'node:child_process';
import { expect, test } from 'vitest';
import { initRepo } from '../src/commands/init.js';
import { goalStart } from '../src/commands/goalStart.js';
import { goalRecord } from '../src/commands/goalRecord.js';
import { goalHealth } from '../src/commands/health.js';
import { goalOpStart, goalOpClear } from '../src/commands/goalOp.js';
import { headSha } from '../src/git.js';
import { commit, g, tmpRepo } from './helpers.js';

function start(repo: string, maxFixRounds = 2) {
  initRepo(repo);
  return goalStart(repo, { objective: 'x', maxFixRounds, acceptanceChecks: [] }).goalId;
}

test('healthy mid-loop', () => {
  const repo = tmpRepo();
  const id = start(repo);
  goalRecord(repo, { goal: id, phase: 'plan', expectedSha: headSha(repo) });
  expect(goalHealth(repo, id).verdict).toBe('healthy');
});

test('wrong-branch when checked out to main', () => {
  const repo = tmpRepo();
  const id = start(repo);
  g(repo, ['checkout', 'main']);
  expect(goalHealth(repo, id).verdict).toBe('wrong-branch');
});

test('conflict is detected', () => {
  const repo = tmpRepo();
  const id = start(repo);
  commit(repo, 'c.txt', 'branch\n', 'branch change');
  g(repo, ['checkout', 'main']);
  commit(repo, 'c.txt', 'main\n', 'main change');
  g(repo, ['checkout', `coco/${id}`]);
  try {
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'merge', 'main'], { cwd: repo });
  } catch {
    // expected: merge conflict leaves the repo mid-merge
  }
  expect(goalHealth(repo, id).verdict).toBe('conflict');
});

test('stuck at max fix rounds', () => {
  const repo = tmpRepo();
  const id = start(repo, 2);
  goalRecord(repo, { goal: id, phase: 'plan', expectedSha: headSha(repo) });
  commit(repo, 'a.txt', '1', 'w1');
  goalRecord(repo, { goal: id, phase: 'implement', expectedSha: headSha(repo) });
  goalRecord(repo, { goal: id, phase: 'review', verdict: 'blocking', expectedSha: headSha(repo) });
  commit(repo, 'a.txt', '2', 'w2');
  goalRecord(repo, { goal: id, phase: 'implement', expectedSha: headSha(repo) });
  goalRecord(repo, { goal: id, phase: 'review', verdict: 'blocking', expectedSha: headSha(repo) });
  expect(goalHealth(repo, id).verdict).toBe('stuck');
});

test('budget-exceeded once the wall-clock cap passes (mid-loop)', () => {
  const repo = tmpRepo();
  initRepo(repo);
  const id = goalStart(repo, { objective: 'x', maxFixRounds: 2, acceptanceChecks: [], budget: { maxWallClockMin: 30 } }).goalId;
  expect(goalHealth(repo, id).verdict).toBe('healthy'); // just created → within budget
  const future = Date.now() + 31 * 60_000;
  expect(goalHealth(repo, id, future).verdict).toBe('budget-exceeded');
});

test('budget never hides a ready-to-merge state (merge-gate wins)', () => {
  const repo = tmpRepo();
  initRepo(repo);
  const id = goalStart(repo, { objective: 'x', maxFixRounds: 2, acceptanceChecks: [], budget: { maxWallClockMin: 30 } }).goalId;
  goalRecord(repo, { goal: id, phase: 'plan', expectedSha: headSha(repo) });
  commit(repo, 'a.txt', '1', 'w');
  goalRecord(repo, { goal: id, phase: 'implement', expectedSha: headSha(repo) });
  goalRecord(repo, { goal: id, phase: 'review', verdict: 'clean', expectedSha: headSha(repo) });
  goalRecord(repo, { goal: id, phase: 'verify', verdict: 'pass', expectedSha: headSha(repo) });
  const future = Date.now() + 31 * 60_000;
  expect(goalHealth(repo, id, future).verdict).toBe('needs-human'); // not budget-exceeded
});

test('needs-human at merge-gate', () => {
  const repo = tmpRepo();
  const id = start(repo);
  goalRecord(repo, { goal: id, phase: 'plan', expectedSha: headSha(repo) });
  commit(repo, 'a.txt', '1', 'w');
  goalRecord(repo, { goal: id, phase: 'implement', expectedSha: headSha(repo) });
  goalRecord(repo, { goal: id, phase: 'review', verdict: 'clean', expectedSha: headSha(repo) });
  goalRecord(repo, { goal: id, phase: 'verify', verdict: 'pass', expectedSha: headSha(repo) });
  expect(goalHealth(repo, id).verdict).toBe('needs-human');
});

test('operation-in-progress while a fresh Oracle/test op is in flight', () => {
  const repo = tmpRepo();
  const id = start(repo);
  goalOpStart(repo, { goal: id, phase: 'plan', kind: 'oracle' });
  expect(goalHealth(repo, id).verdict).toBe('operation-in-progress');
});

test('in-flight-timeout when an op runs past the 1h op timeout', () => {
  const repo = tmpRepo();
  const id = start(repo);
  goalOpStart(repo, { goal: id, phase: 'plan', kind: 'oracle' });
  const future = Date.now() + 61 * 60_000;
  expect(goalHealth(repo, id, future).verdict).toBe('in-flight-timeout');
});

test('stalled when the loop should act but has gone quiet (no op in flight)', () => {
  const repo = tmpRepo();
  const id = start(repo);
  goalRecord(repo, { goal: id, phase: 'plan', expectedSha: headSha(repo) }); // nextAction → implement
  const future = Date.now() + 16 * 60_000; // past the 15-min stale threshold
  expect(goalHealth(repo, id, future).verdict).toBe('stalled');
});

test('recording a phase clears the in-flight marker', () => {
  const repo = tmpRepo();
  const id = start(repo);
  goalOpStart(repo, { goal: id, phase: 'plan', kind: 'oracle' });
  goalRecord(repo, { goal: id, phase: 'plan', expectedSha: headSha(repo) });
  expect(goalHealth(repo, id).verdict).toBe('healthy'); // inFlight cleared → not operation-in-progress
});

test('goalOpClear removes the in-flight marker', () => {
  const repo = tmpRepo();
  const id = start(repo);
  goalOpStart(repo, { goal: id, phase: 'plan', kind: 'oracle' });
  goalOpClear(repo, { goal: id });
  expect(goalHealth(repo, id).verdict).toBe('healthy');
});

test('op-start refuses to overwrite an existing in-flight op (no hidden hung op)', () => {
  const repo = tmpRepo();
  const id = start(repo);
  goalOpStart(repo, { goal: id, phase: 'plan', kind: 'oracle' });
  expect(() => goalOpStart(repo, { goal: id, phase: 'review', kind: 'oracle' })).toThrow(/already in flight/);
});

test('a future startedAt reads as in-flight-timeout, not a fresh op', () => {
  const repo = tmpRepo();
  const id = start(repo);
  goalOpStart(repo, { goal: id, phase: 'plan', kind: 'oracle', now: new Date(Date.now() + 10 * 60_000) });
  expect(goalHealth(repo, id).verdict).toBe('in-flight-timeout');
});
