import { existsSync, mkdirSync } from 'node:fs';
import { expect, test } from 'vitest';
import { withLock } from '../src/lock.js';
import { cocoDir } from '../src/paths.js';
import { findActiveGoal, goalPath, readGoal, writeGoal } from '../src/state.js';
import type { GoalState } from '../src/types.js';
import { tmpRepo } from './helpers.js';

function newGoal(id: string, state: GoalState['state'] = 'active'): GoalState {
  return { id, objective: 'x', branch: `coco/${id}`, base: 'main', state, maxFixRounds: 3, acceptanceChecks: [], events: [] };
}

test('writeGoal + readGoal round-trips atomically', () => {
  const repo = tmpRepo();
  mkdirSync(cocoDir(repo) + '/goals', { recursive: true });
  const p = goalPath(repo, 'g1');
  writeGoal(p, newGoal('g1'));
  expect(readGoal(p).id).toBe('g1');
});

test('findActiveGoal returns only the active goal', () => {
  const repo = tmpRepo();
  mkdirSync(cocoDir(repo) + '/goals', { recursive: true });
  writeGoal(goalPath(repo, 'g1'), newGoal('g1', 'achieved'));
  writeGoal(goalPath(repo, 'g2'), newGoal('g2', 'active'));
  expect(findActiveGoal(repo)?.id).toBe('g2');
});

test('withLock is exclusive: nested acquisition throws', () => {
  const repo = tmpRepo();
  mkdirSync(cocoDir(repo), { recursive: true });
  expect(() => withLock(repo, () => withLock(repo, () => 1))).toThrow(/lock/);
});

test('withLock releases the lock on success', () => {
  const repo = tmpRepo();
  mkdirSync(cocoDir(repo), { recursive: true });
  withLock(repo, () => 1);
  expect(existsSync(cocoDir(repo) + '/lock')).toBe(false);
  expect(withLock(repo, () => 42)).toBe(42);
});
