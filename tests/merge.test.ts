import { expect, test } from 'vitest';
import { initRepo } from '../src/commands/init.js';
import { goalStart } from '../src/commands/goalStart.js';
import { goalRecord } from '../src/commands/goalRecord.js';
import { goalClear } from '../src/commands/goalClear.js';
import { mergeGoal } from '../src/commands/merge.js';
import { currentBranch, headSha } from '../src/git.js';
import { goalPath, readGoal } from '../src/state.js';
import { commit, g, tmpRepo } from './helpers.js';

/** Drive a goal to a ready (merge-gate) state and return its id. */
function ready(repo: string): string {
  initRepo(repo);
  const id = goalStart(repo, { objective: 'feat x', maxFixRounds: 3, acceptanceChecks: [] }).goalId;
  goalRecord(repo, { goal: id, phase: 'plan', expectedSha: headSha(repo) });
  commit(repo, 'a.txt', 'feature', 'work');
  goalRecord(repo, { goal: id, phase: 'implement', expectedSha: headSha(repo) });
  goalRecord(repo, { goal: id, phase: 'review', verdict: 'clean', expectedSha: headSha(repo) });
  goalRecord(repo, { goal: id, phase: 'verify', verdict: 'pass', expectedSha: headSha(repo) });
  return id;
}

test('merge fast-forwards main and marks the goal achieved', () => {
  const repo = tmpRepo();
  const id = ready(repo);
  const res = mergeGoal(repo, id);
  expect(res.merged).toBe(true);
  expect(currentBranch(repo)).toBe('main');
  expect(readGoal(goalPath(repo, id)).state).toBe('achieved');
});

test('merge refuses when the latest review is not clean', () => {
  const repo = tmpRepo();
  const id = ready(repo);
  goalRecord(repo, { goal: id, phase: 'review', verdict: 'blocking', expectedSha: headSha(repo) });
  const res = mergeGoal(repo, id);
  expect(res.merged).toBe(false);
  expect(res.reason).toMatch(/review/);
  expect(readGoal(goalPath(repo, id)).state).toBe('active');
});

test('reverting to an old clean tree does NOT let merge through', () => {
  const repo = tmpRepo();
  const id = ready(repo);
  const cleanTip = headSha(repo);
  commit(repo, 'a.txt', 'regression', 'break it');
  goalRecord(repo, { goal: id, phase: 'implement', expectedSha: headSha(repo) });
  goalRecord(repo, { goal: id, phase: 'review', verdict: 'blocking', expectedSha: headSha(repo) });
  g(repo, ['reset', '--hard', cleanTip]); // restore the earlier tree
  const res = mergeGoal(repo, id);
  expect(res.merged).toBe(false); // fresh epoch: needs new review/verify
});

test('merge refuses (rebase-needed) when main advanced past the branch point', () => {
  const repo = tmpRepo();
  const id = ready(repo);
  const branch = `coco/${id}`;
  g(repo, ['checkout', 'main']);
  commit(repo, 'm.txt', 'main-moved', 'advance main');
  g(repo, ['checkout', branch]);
  const res = mergeGoal(repo, id);
  expect(res.merged).toBe(false);
  expect(res.reason).toMatch(/rebase|behind/);
  expect(readGoal(goalPath(repo, id)).state).toBe('active');
});

test('goal clear cancels the active goal', () => {
  const repo = tmpRepo();
  const id = ready(repo);
  goalClear(repo, id);
  expect(readGoal(goalPath(repo, id)).state).toBe('cancelled');
});
