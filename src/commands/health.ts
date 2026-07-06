import { existsSync } from 'node:fs';
import { eventsIntact, gatherLive, headResolvable, inConflict, opInProgress, refExists } from '../git.js';
import { computeHealth, type HealthReport } from '../health.js';
import { lockStatus } from '../lock.js';
import { lockPath } from '../paths.js';
import { findActiveGoal, goalPath, readGoal } from '../state.js';

export function goalHealth(repo: string, id?: string, now = Date.now()): HealthReport & { goalId: string } {
  let goal;
  try {
    goal = id && existsSync(goalPath(repo, id)) ? readGoal(goalPath(repo, id)) : findActiveGoal(repo);
  } catch {
    return { goalId: id ?? '', verdict: 'invalid-state', details: { reason: 'goal JSON parse failed' } };
  }
  if (!goal) throw new Error('coco: no matching goal');

  // Malformed-but-parseable goal (e.g. events not an array) → invalid-state, not a crash.
  if (!Array.isArray(goal.events)) {
    return { goalId: String((goal as { id?: unknown }).id ?? id ?? ''), verdict: 'invalid-state', details: { reason: 'events is not an array' } };
  }

  // Probe HEAD before gatherLive() — treeHash uses HEAD^{tree}, which throws on a
  // broken/unborn HEAD; report invalid-state as JSON instead of crashing.
  if (!headResolvable(repo)) {
    return { goalId: goal.id, verdict: 'invalid-state', details: { headResolvable: false } };
  }

  const live = gatherLive(repo, goal);
  const git = {
    headResolvable: true,
    branchExists: refExists(repo, `refs/heads/${goal.branch}`),
    baseExists: refExists(repo, goal.base),
    inConflict: inConflict(repo),
    opInProgress: opInProgress(repo),
    eventsIntact: eventsIntact(repo, goal.events),
  };
  const lock = lockStatus(lockPath(repo), now);
  const report = computeHealth({
    goal, live, git,
    lock: { held: lock.held, stale: lock.stale },
    now, staleThresholdSec: 900,
    opTimeoutSec: 3600, // an inFlight op past 1h (Oracle's own tool_timeout) is hung → in-flight-timeout
  });
  return { goalId: goal.id, ...report };
}
