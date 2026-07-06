import { expect, test } from 'vitest';
import { initRepo } from '../src/commands/init.js';
import { goalStart } from '../src/commands/goalStart.js';
import { goalRecord } from '../src/commands/goalRecord.js';
import { headSha } from '../src/git.js';
import { goalPath, readGoal } from '../src/state.js';
import { tmpRepo } from './helpers.js';

test('goal start stamps createdAt = updatedAt = lastActivityAt and lastOperation', () => {
  const repo = tmpRepo();
  initRepo(repo);
  const id = goalStart(repo, { objective: 'x', maxFixRounds: 3, acceptanceChecks: [] }).goalId;
  const g = readGoal(goalPath(repo, id));
  expect(g.createdAt).toBeTruthy();
  expect(g.updatedAt).toBe(g.createdAt);
  expect(g.lastActivityAt).toBe(g.createdAt);
  expect(g.lastOperation).toBe('goal-start');
});

test('recording advances updatedAt/lastActivityAt, keeps createdAt, labels the op', async () => {
  const repo = tmpRepo();
  initRepo(repo);
  const id = goalStart(repo, { objective: 'x', maxFixRounds: 3, acceptanceChecks: [] }).goalId;
  const before = readGoal(goalPath(repo, id));
  await new Promise((r) => setTimeout(r, 5));
  goalRecord(repo, { goal: id, phase: 'plan', expectedSha: headSha(repo) });
  const after = readGoal(goalPath(repo, id));
  expect(after.createdAt).toBe(before.createdAt);
  expect(Date.parse(after.updatedAt!)).toBeGreaterThanOrEqual(Date.parse(before.updatedAt!));
  expect(after.lastOperation).toBe('record:plan');
});
