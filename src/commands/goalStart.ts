import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { auditGoalWrite } from '../audit.js';
import { resolveBaseBranch } from '../cocoConfig.js';
import { checkout, createBranch, gatherLive, isClean, treeOfRef, tryGit } from '../git.js';
import { nextAction, type NextAction } from '../gate.js';
import { GOAL_SCHEMA_VERSION } from '../goalSchema.js';
import { isImproveOriginTask } from '../improve/originGate.js';
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
  base?: string; // optional per-goal override; defaults to workflow.baseBranch / repo default branch
  autoMergeAllowed?: boolean; // forward consent for Layer 2 auto-merge (from `$coco-loop --auto` / `coco goal start --auto-merge`)
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

function branchExists(repo: string, branch: string): boolean {
  return tryGit(repo, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).ok;
}

/** Keep the existing human-friendly minute slug for the first goal, but retry with a numeric suffix
 * when a cancelled/finished goal with the same objective already left a branch or goal file behind. */
function uniqueGoalId(repo: string, objective: string, now: Date): string {
  const base = goalId(objective, now);
  for (let i = 0; i < 100; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    if (!existsSync(goalPath(repo, candidate)) && !branchExists(repo, `coco/${candidate}`)) return candidate;
  }
  throw new Error(`coco: could not allocate a unique goal id for '${base}'`);
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
    const id = uniqueGoalId(repo, opts.objective, nowDate);
    const branch = `coco/${id}`;
    const base = opts.base ?? resolveBaseBranch(repo);
    const baseTree = treeOfRef(repo, base); // snapshot the base tree so a no-op implement can be rejected
    createBranch(repo, branch, base); // branch from the resolved base ref regardless of current HEAD
    checkout(repo, branch);

    const now = nowDate.toISOString();
    const goal: GoalState = {
      schemaVersion: GOAL_SCHEMA_VERSION,
      id,
      objective: opts.objective,
      branch,
      base,
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
      // Freeze improve-origin ONCE, now — never re-derived at merge (branch/store can't retro-flip it).
      ...(opts.backlogTaskId && isImproveOriginTask(repo, opts.backlogTaskId) ? { improveOrigin: true } : {}),
      ...(opts.autoMergeAllowed ? { autoMergeAllowed: true } : {}),
      ...(opts.budget ? { budget: opts.budget } : {}),
    };
    writeGoal(goalPath(repo, id), goal);
    auditGoalWrite(repo, goal, 'goal-start'); // goalStart writes directly (new goal), so audit here too

    return { goalId: id, nextAction: nextAction(goal, gatherLive(repo, goal)) };
  });
}
