import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { initRepo } from '../src/commands/init.js';
import { goalStart } from '../src/commands/goalStart.js';
import { goalPath, readGoal } from '../src/state.js';
import { currentBranch } from '../src/git.js';
import { commit, g, tmpRepo } from './helpers.js';

test('goal start creates a goal file, branch, and returns nextAction=plan', () => {
  const repo = tmpRepo();
  initRepo(repo);
  const res = goalStart(repo, { objective: 'Add CSV export', maxFixRounds: 5, acceptanceChecks: ['csv valid'] });
  expect(res.goalId).toMatch(/^goal-\d{8}-\d{4}-add-csv-export$/);
  expect(res.nextAction).toBe('plan');
  expect(existsSync(goalPath(repo, res.goalId))).toBe(true);
  expect(currentBranch(repo)).toBe(`coco/${res.goalId}`);
});

test('goal start uses an explicit base branch override', () => {
  const repo = tmpRepo();
  initRepo(repo);
  g(repo, ['checkout', '-b', 'develop']);
  commit(repo, 'dev.txt', 'dev\n', 'develop work');
  g(repo, ['checkout', 'main']);
  const id = goalStart(repo, { objective: 'from develop', maxFixRounds: 5, acceptanceChecks: [], base: 'develop' }).goalId;
  expect(readGoal(goalPath(repo, id)).base).toBe('develop');
  expect(currentBranch(repo)).toBe(`coco/${id}`);
});

test('goal start allocates a suffix when the minute/objective id already exists', () => {
  const repo = tmpRepo();
  initRepo(repo);
  const now = new Date('2026-07-08T01:02:03.000Z');
  const first = goalStart(repo, { objective: 'same', maxFixRounds: 5, acceptanceChecks: [], now }).goalId;
  // Simulate a terminal prior goal so a second start is allowed while its branch/file remain.
  const p = goalPath(repo, first);
  const g1 = readGoal(p);
  writeFileSync(p, JSON.stringify({ ...g1, state: 'cancelled' }, null, 2));
  g(repo, ['checkout', 'main']);
  const second = goalStart(repo, { objective: 'same', maxFixRounds: 5, acceptanceChecks: [], now }).goalId;
  expect(second).toBe(`${first}-2`);
});

test('goal start refuses if the repo was not coco-initialized (no `coco init`)', () => {
  const repo = tmpRepo(); // a git repo, but no coco init (no .gitignore .coco/)
  expect(() => goalStart(repo, { objective: 'x', maxFixRounds: 5, acceptanceChecks: [] })).toThrow(/coco init/);
});

test('goal start rejects an invalid budget', () => {
  const repo = tmpRepo();
  initRepo(repo);
  expect(() => goalStart(repo, { objective: 'x', maxFixRounds: 5, acceptanceChecks: [], budget: { maxWallClockMin: 0 } })).toThrow(/positive/);
  expect(() => goalStart(repo, { objective: 'x', maxFixRounds: 5, acceptanceChecks: [], budget: { maxWallClockMin: Number.NaN } })).toThrow(/positive/);
  expect(() => goalStart(repo, { objective: 'x', maxFixRounds: 5, acceptanceChecks: [], budget: { maxWallClockMin: -5 } })).toThrow(/positive/);
});

test('goal start refuses when a goal is already active', () => {
  const repo = tmpRepo();
  initRepo(repo);
  goalStart(repo, { objective: 'first', maxFixRounds: 5, acceptanceChecks: [] });
  expect(() => goalStart(repo, { objective: 'second', maxFixRounds: 5, acceptanceChecks: [] })).toThrow(/active/);
});

test('goal start persists autoMergeAllowed only when requested (forward consent)', () => {
  const on = tmpRepo();
  initRepo(on);
  const a = goalStart(on, { objective: 'auto on', maxFixRounds: 5, acceptanceChecks: [], autoMergeAllowed: true }).goalId;
  expect(readGoal(goalPath(on, a)).autoMergeAllowed).toBe(true);

  const off = tmpRepo();
  initRepo(off);
  const b = goalStart(off, { objective: 'auto off', maxFixRounds: 5, acceptanceChecks: [] }).goalId;
  expect(readGoal(goalPath(off, b)).autoMergeAllowed).toBeUndefined();
});
