import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBacklog } from '../backlog.js';
import { readCards } from '../store/manifest.js';
import type { GoalState } from '../types.js';
import { improveCheckDiff } from './protected.js';

// The build-time half of the protected-path guard. `coco improve promote` checks DECLARED paths at
// propose time; this checks the ACTUAL committed diff at merge time. Origin is decided ONCE at goal
// start (isImproveOriginTask → goal.improveOrigin) and FROZEN into coco's trusted goal ledger, so the
// merge gate never re-reads mutable/local metadata — a branch can't erase its own origin, and a
// missing/corrupt store can't fail the gate open.
//
// SCOPE (by design): this gate binds the coco-improve PATH — a goal whose backlog task links a
// coco-improve spec. It is NOT a universal referee sandbox: a plain/ad-hoc goal (raw `coco-store
// promote`, no coco-improve spec) is deliberately not gated, so a human can still make a legitimate
// referee change. The universal backstops for ANY goal remain Oracle review + the human merge; this
// is defense-in-depth for the self-improvement path so improve can't quietly weaken its own gate.

/** Is this BACKLOG task coco-improve-origin? (its `links.spec` resolves to a spec card tagged
 * `coco-improve`.) Called ONCE at goal start. FAIL-CLOSED: a task that links a spec we cannot resolve
 * (missing/corrupt store, read error) is treated as improve-origin — a referee guard must not fail
 * open. A task with NO spec link is a plain task (not improve-origin). */
export function isImproveOriginTask(repo: string, taskId: string): boolean {
  try {
    const backlog = join(repo, 'BACKLOG.md');
    if (!existsSync(backlog)) return false;
    const task = parseBacklog(readFileSync(backlog, 'utf8')).find((n) => n.id === taskId);
    if (!task) return false;
    const specId = typeof task.links.spec === 'string' ? task.links.spec : undefined;
    if (!specId) return false; // no spec link → plain task → not improve-origin
    const card = readCards(repo).find((c) => c.id === specId);
    if (!card) return true; // links a spec we can't resolve → FAIL-CLOSED
    return card.type === 'spec' && (card.tags ?? []).includes('coco-improve');
  } catch {
    return true; // any read/parse failure on a lookup → FAIL-CLOSED (never fail open for the referee)
  }
}

/** Fail-closed merge gate: for a goal FROZEN as improve-origin at start (`goal.improveOrigin`), the
 * protected paths its committed diff (`base...HEAD`) touches. Empty for a non-improve goal or a clean
 * improve diff. Reads NO store at merge — only the frozen flag + the diff. Such a change may NEVER
 * merge; it needs a human-authored referee-change goal (a plain goal, not linked to a coco-improve spec). */
export function improveOriginProtectedHits(repo: string, goal: GoalState): string[] {
  if (!goal.improveOrigin) return [];
  return improveCheckDiff(repo, goal.base).protected;
}
