import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkout, createBranch, gatherLive, isClean, treeOfRef } from '../git.js';
import { nextAction, type NextAction } from '../gate.js';
import { withLock } from '../lock.js';
import { findActiveGoal, goalPath, writeGoal } from '../state.js';
import type { GoalBudget, GoalState } from '../types.js';

function cocoInitialized(repo: string): boolean {
  const gi = join(repo, '.gitignore');
  return existsSync(gi) && readFileSync(gi, 'utf8').split('\n').includes('.coco/');
}

export interface StartOptions {
  objective: string;
  maxFixRounds: number;
  acceptanceChecks: string[];
  backlogTaskId?: string;
  budget?: GoalBudget;
  now?: Date;
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'goal'
  );
}

export function goalId(objective: string, now: Date): string {
  const iso = now.toISOString(); // 2026-07-04T10:30:00.000Z
  const day = iso.slice(0, 10).replace(/-/g, '');
  const hm = iso.slice(11, 16).replace(':', '');
  return `goal-${day}-${hm}-${slugify(objective)}`;
}

export function goalStart(
  repo: string,
  opts: StartOptions,
): { goalId: string; nextAction: NextAction } {
  if (opts.budget) {
    const m = opts.budget.maxWallClockMin;
    if (m == null || !Number.isFinite(m) || m <= 0) {
      throw new Error('coco: budget.maxWallClockMin must be a positive number');
    }
  }
  return withLock(repo, () => {
    if (!cocoInitialized(repo)) throw new Error('coco: repo not initialized for coco — run `coco init` first');
    if (findActiveGoal(repo)) throw new Error('coco: a goal is already active — clear it first');
    if (!isClean(repo)) throw new Error('coco: working tree must be clean to start a goal');

    const nowDate = opts.now ?? new Date();
    const id = goalId(opts.objective, nowDate);
    const branch = `coco/${id}`;
    const baseTree = treeOfRef(repo, 'main'); // snapshot the base tree so a no-op implement can be rejected
    createBranch(repo, branch, 'main'); // branch from the main ref regardless of current HEAD
    checkout(repo, branch);

    const now = nowDate.toISOString();
    const goal: GoalState = {
      id,
      objective: opts.objective,
      branch,
      base: 'main',
      baseTree,
      state: 'active',
      maxFixRounds: opts.maxFixRounds,
      acceptanceChecks: opts.acceptanceChecks,
      events: [],
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
      lastOperation: 'goal-start',
      ...(opts.backlogTaskId ? { backlogTaskId: opts.backlogTaskId } : {}),
      ...(opts.budget ? { budget: opts.budget } : {}),
    };
    writeGoal(goalPath(repo, id), goal);

    return { goalId: id, nextAction: nextAction(goal, gatherLive(repo, goal)) };
  });
}
