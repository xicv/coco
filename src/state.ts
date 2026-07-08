import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { auditGoalWrite } from './audit.js';
import { parseGoalFile, stampGoalSchema } from './goalSchema.js';
import { goalsDir } from './paths.js';
import type { GoalState } from './types.js';

export function goalPath(repo: string, id: string): string {
  return join(goalsDir(repo), `${id}.json`);
}

export function readGoal(path: string): GoalState {
  return parseGoalFile(readFileSync(path, 'utf8'));
}

/** Atomic write: temp file + rename. */
export function writeGoal(path: string, goal: GoalState): void {
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(stampGoalSchema(goal), null, 2)}\n`);
  renameSync(tmp, path);
}

/** Stamp activity fields and persist (heartbeat, spec §5.4). */
export function touchAndWrite(repo: string, goal: GoalState, operation: string): void {
  const now = new Date().toISOString();
  goal.updatedAt = now;
  goal.lastActivityAt = now;
  goal.lastOperation = operation;
  writeGoal(goalPath(repo, goal.id), goal);
  auditGoalWrite(repo, goal, operation); // best-effort trajectory capture — the domain-layer chokepoint
}

export function findActiveGoal(repo: string): GoalState | null {
  const dir = goalsDir(repo);
  if (!existsSync(dir)) return null;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const goal = readGoal(join(dir, f));
    if (goal.state === 'active') return goal;
  }
  return null;
}
