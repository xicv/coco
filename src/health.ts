import { deriveFacts } from './epoch.js';
import { nextAction, type LiveGit } from './gate.js';
import type { GoalState } from './types.js';

export type HealthVerdict =
  | 'healthy' | 'needs-human' | 'stuck' | 'budget-exceeded'
  | 'wrong-branch' | 'missing-branch' | 'missing-base'
  | 'conflict' | 'operation-in-progress' | 'invalid-state'
  | 'in-flight-timeout' | 'stalled' | 'review-unavailable'
  | 'achieved' | 'blocked' | 'failed' | 'cancelled';

export interface HealthGit {
  headResolvable: boolean;
  branchExists: boolean;
  baseExists: boolean;
  inConflict: boolean;
  opInProgress: boolean;
  eventsIntact: boolean;
}

export interface HealthInputs {
  goal: GoalState;
  live: LiveGit;
  git: HealthGit;
  lock: { held: boolean; stale: boolean };
  now: number;
  staleThresholdSec: number;
  opTimeoutSec: number; // an inFlight op older than this is a hung op → in-flight-timeout
}

export interface HealthReport {
  verdict: HealthVerdict;
  details: Record<string, unknown>;
}

export function computeHealth(i: HealthInputs): HealthReport {
  const { goal, live, git, lock, now, staleThresholdSec, opTimeoutSec } = i;
  const staleForSec = goal.updatedAt ? Math.round((now - Date.parse(goal.updatedAt)) / 1000) : null;
  const activityStale = staleForSec !== null && staleForSec > staleThresholdSec;
  const base: Record<string, unknown> = { lock, staleForSec, activityStale };

  if (goal.state !== 'active') return { verdict: goal.state, details: base };

  // Malformed-but-parseable state, or a budget we can't evaluate, is invalid — not healthy.
  const budgetSet = goal.budget?.maxWallClockMin != null;
  const budgetUnevaluable = budgetSet && (!goal.createdAt || Number.isNaN(Date.parse(goal.createdAt)));
  if (!git.headResolvable || !git.eventsIntact || !Array.isArray(goal.events) || budgetUnevaluable) {
    return { verdict: 'invalid-state', details: { ...base, headResolvable: git.headResolvable, eventsIntact: git.eventsIntact } };
  }

  // Oracle unavailable / gave no usable verdict → durable human-pause. Ranks above the git checks
  // (matching gate.nextAction) so coco_goal_status and coco_health always agree while paused.
  if (goal.reviewUnavailable) {
    return { verdict: 'review-unavailable', details: { ...base, reviewUnavailable: goal.reviewUnavailable } };
  }

  if (git.inConflict) return { verdict: 'conflict', details: base };
  if (git.opInProgress) return { verdict: 'operation-in-progress', details: base };
  if (!git.branchExists) return { verdict: 'missing-branch', details: base };
  if (!git.baseExists) return { verdict: 'missing-base', details: base };
  if (!live.onBranch) return { verdict: 'wrong-branch', details: base };

  // A long Oracle/test op in flight: legit (operation-in-progress) while young; a hung op
  // (over opTimeoutSec, or a malformed startedAt) needs a human. Handled as a unit before the
  // loop verdicts because while an op runs the loop should wait, not compute a fresh action.
  if (goal.inFlight) {
    const startedMs = Date.parse(goal.inFlight.startedAt);
    const opElapsedSec = Number.isNaN(startedMs) ? null : Math.round((now - startedMs) / 1000);
    const details = { ...base, inFlight: goal.inFlight, opElapsedSec };
    // Timeout on: unparseable startedAt (null), an op past the timeout, OR a startedAt in the
    // future beyond a small clock-skew grace (a negative elapsed must not read as a fresh op).
    if (opElapsedSec === null || opElapsedSec > opTimeoutSec || opElapsedSec < -60) {
      return { verdict: 'in-flight-timeout', details };
    }
    return { verdict: 'operation-in-progress', details };
  }

  // Loop verdict FIRST: a real pause (stuck / merge-gate) wins over budget so we never hide
  // "ready to merge" or "stuck" behind "you took too long". nextAction is the single source of
  // truth for stuck — it folds in both the fix-budget and the fingerprint (see gate.isStuck).
  const na = nextAction(goal, live);
  if (na === 'escalate-human') {
    const facts = deriveFacts(goal.events, live.tHead);
    return { verdict: 'stuck', details: { ...base, nextAction: na, fixRounds: facts.fixRounds, failureLoop: goal.failureLoop } };
  }
  if (na === 'merge-gate') return { verdict: 'needs-human', details: { ...base, nextAction: na } };

  // budget-exceeded before stalled: an explicit wall-clock cap is the configured stop reason and
  // should win over the implicit "loop went quiet" detector. Both only replace `healthy`.
  if (budgetSet && goal.createdAt) {
    const elapsedMin = (now - Date.parse(goal.createdAt)) / 60000;
    if (elapsedMin > (goal.budget?.maxWallClockMin ?? Infinity)) {
      return { verdict: 'budget-exceeded', details: { ...base, nextAction: na, elapsedMin: Math.round(elapsedMin), maxWallClockMin: goal.budget?.maxWallClockMin } };
    }
  }

  // No op in flight and no budget cap hit, but the loop should be acting
  // (plan/implement/review/fix/verify) and hasn't for a while → stalled (the driver stopped).
  const agentActions: ReadonlyArray<string> = ['plan', 'implement', 'review', 'fix', 'verify'];
  if (activityStale && agentActions.includes(na)) {
    return { verdict: 'stalled', details: { ...base, nextAction: na } };
  }

  return { verdict: 'healthy', details: { ...base, nextAction: na } };
}
