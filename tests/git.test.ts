import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { currentBranch, ffMerge, gatherLive, isAncestor, isClean, treeHash } from '../src/git.js';
import type { GoalState } from '../src/types.js';
import { commit, g, tmpRepo } from './helpers.js';

test('treeHash changes with content, isClean reflects working tree', () => {
  const repo = tmpRepo();
  const t0 = treeHash(repo);
  expect(isClean(repo)).toBe(true);
  writeFileSync(join(repo, 'a.txt'), 'hi');
  expect(isClean(repo)).toBe(false);
  commit(repo, 'a.txt', 'hi', 'add a');
  expect(treeHash(repo)).not.toBe(t0);
  expect(isClean(repo)).toBe(true);
});

test('isAncestor is true for main→HEAD on a branch off main', () => {
  const repo = tmpRepo();
  g(repo, ['branch', 'coco/g1', 'main']);
  g(repo, ['checkout', 'coco/g1']);
  expect(currentBranch(repo)).toBe('coco/g1');
  expect(isAncestor(repo, 'main', 'HEAD')).toBe(true);
});

test('isAncestor is false when main has advanced past the branch point', () => {
  const repo = tmpRepo();
  g(repo, ['branch', 'coco/g1', 'main']);
  commit(repo, 'm.txt', 'main-moved', 'advance main');
  g(repo, ['checkout', 'coco/g1']);
  expect(isAncestor(repo, 'main', 'HEAD')).toBe(false);
});

test('ffMerge fast-forwards main to the branch', () => {
  const repo = tmpRepo();
  g(repo, ['branch', 'coco/g1', 'main']);
  g(repo, ['checkout', 'coco/g1']);
  commit(repo, 'f.txt', 'feature', 'feature work');
  const res = ffMerge(repo, 'main', 'coco/g1');
  expect(res.ok).toBe(true);
  expect(currentBranch(repo)).toBe('main');
});

test('gatherLive reports branch + ancestry + clean tree', () => {
  const repo = tmpRepo();
  g(repo, ['branch', 'coco/g1', 'main']);
  g(repo, ['checkout', 'coco/g1']);
  const goal = { branch: 'coco/g1', base: 'main' } as GoalState;
  const live = gatherLive(repo, goal);
  expect(live).toMatchObject({ onBranch: true, baseMerged: true, treeClean: true });
  expect(typeof live.tHead).toBe('string');
});
