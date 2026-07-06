import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test } from 'vitest';
import { initRepo } from '../src/commands/init.js';
import { goalStart } from '../src/commands/goalStart.js';
import { goalRecord } from '../src/commands/goalRecord.js';
import { goalClear } from '../src/commands/goalClear.js';
import { autoMergeGoal, mergeGoal } from '../src/commands/merge.js';
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

const OK_FILES = { 'src/feature.ts': 'export const x = 1;\n', 'tests/feature.test.ts': 'test.skip("x", () => {});\n' };

/** Drive an auto-merge-eligible goal to merge-gate, committing `files` as the implement diff. */
function readyAuto(repo: string, files: Record<string, string>, autoMergeAllowed = true): string {
  initRepo(repo);
  const id = goalStart(repo, { objective: 'feat x', maxFixRounds: 3, acceptanceChecks: [], autoMergeAllowed }).goalId;
  goalRecord(repo, { goal: id, phase: 'plan', expectedSha: headSha(repo) });
  for (const [f, content] of Object.entries(files)) {
    const abs = join(repo, f);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  g(repo, ['add', '-A']);
  g(repo, ['commit', '-m', 'work']);
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

// --- Layer 2 auto-merge ---

test('autoMergeGoal fast-forwards and marks achieved on a green, low-risk diff with consent', () => {
  const repo = tmpRepo();
  const id = readyAuto(repo, OK_FILES);
  const res = autoMergeGoal(repo, id, { expectedSha: headSha(repo) });
  expect(res.merged).toBe(true);
  expect(res.mergedSha).toBeTruthy();
  expect(res.risk?.allowed).toBe(true);
  expect(currentBranch(repo)).toBe('main');
  expect(readGoal(goalPath(repo, id)).state).toBe('achieved');
});

test('autoMergeGoal refuses (human-merge) when the goal did not opt in', () => {
  const repo = tmpRepo();
  const id = readyAuto(repo, OK_FILES, false);
  const res = autoMergeGoal(repo, id, { expectedSha: headSha(repo) });
  expect(res.merged).toBe(false);
  expect(res.next).toBe('human-merge');
  expect(res.reason).toMatch(/not enabled/);
  expect(readGoal(goalPath(repo, id)).state).toBe('active');
});

test('autoMergeGoal refuses (continue-loop) on an expectedSha mismatch', () => {
  const repo = tmpRepo();
  const id = readyAuto(repo, OK_FILES);
  const res = autoMergeGoal(repo, id, { expectedSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' });
  expect(res.merged).toBe(false);
  expect(res.next).toBe('continue-loop');
  expect(res.reason).toMatch(/expectedSha/);
  expect(readGoal(goalPath(repo, id)).state).toBe('active');
});

test('autoMergeGoal refuses (continue-loop) when a merge gate is unmet (review blocking)', () => {
  const repo = tmpRepo();
  const id = readyAuto(repo, OK_FILES);
  goalRecord(repo, { goal: id, phase: 'review', verdict: 'blocking', expectedSha: headSha(repo) });
  const res = autoMergeGoal(repo, id, { expectedSha: headSha(repo) });
  expect(res.merged).toBe(false);
  expect(res.next).toBe('continue-loop');
  expect(res.reason).toMatch(/review/);
});

test('autoMergeGoal refuses (human-merge) when the diff has no tests', () => {
  const repo = tmpRepo();
  const id = readyAuto(repo, { 'src/feature.ts': 'export const x = 1;\n' });
  const res = autoMergeGoal(repo, id, { expectedSha: headSha(repo) });
  expect(res.merged).toBe(false);
  expect(res.next).toBe('human-merge');
  expect(res.reason).toMatch(/no test files/);
});

test('risk-tier gates auto-merge but NOT the human path (no coupling)', () => {
  const repo = tmpRepo();
  const id = readyAuto(repo, { 'src/auth/login.ts': 'export const x = 1;\n', 'tests/login.test.ts': 'test.skip("x", () => {});\n' });
  const auto = autoMergeGoal(repo, id, { expectedSha: headSha(repo) });
  expect(auto.merged).toBe(false);
  expect(auto.next).toBe('human-merge');
  expect(auto.reason).toMatch(/sensitive/);
  expect(readGoal(goalPath(repo, id)).state).toBe('active'); // untouched by the refusal

  const human = mergeGoal(repo, id); // human CLI ignores risk-tier entirely
  expect(human.merged).toBe(true);
  expect(readGoal(goalPath(repo, id)).state).toBe('achieved');
});
