import { existsSync } from 'node:fs';
import { expect, test } from 'vitest';
import { initRepo } from '../src/commands/init.js';
import { goalStart } from '../src/commands/goalStart.js';
import { goalPath } from '../src/state.js';
import { currentBranch } from '../src/git.js';
import { tmpRepo } from './helpers.js';

test('goal start creates a goal file, branch, and returns nextAction=plan', () => {
  const repo = tmpRepo();
  initRepo(repo);
  const res = goalStart(repo, { objective: 'Add CSV export', maxFixRounds: 5, acceptanceChecks: ['csv valid'] });
  expect(res.goalId).toMatch(/^goal-\d{8}-\d{4}-add-csv-export$/);
  expect(res.nextAction).toBe('plan');
  expect(existsSync(goalPath(repo, res.goalId))).toBe(true);
  expect(currentBranch(repo)).toBe(`coco/${res.goalId}`);
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
