import { storePromote } from '../store/commands.js';
import { readCards } from '../store/manifest.js';
import { improveCheck, type ImproveCheckResult } from './protected.js';

// coco-improve promotion is CODE-GUARDED at BOTH ends: the protected-path check runs HERE on the
// declared --paths (propose time), AND the reality-bound check runs at MERGE time on the ACTUAL diff
// (improveOriginProtectedHits in src/improve/originGate.ts, wired into mergeGoal/autoMergeGoal) — so
// an improve-origin change can never merge a protected-path edit even if its task under-declared what
// it would touch.

export interface ImprovePromoteResult {
  ok: boolean;
  check: ImproveCheckResult;
  promoted?: string; // the backlog task id, when it passed the guard
}

export interface ImprovePromoteInput {
  spec: string; // the coco-improve spec id this task implements (links.spec)
  id: string; // task id — convention: `improve-<slug>`
  title: string;
  body?: string;
  paths: string[]; // the files the task will touch — the guard binds to these
  priority?: 'high' | 'medium' | 'low';
  dependsOn?: string[];
}

/** Guard THEN promote: refuse a task that targets any protected path; otherwise append it to the
 * backlog linked to its improve-spec. Never writes the backlog when the guard fails. */
export function improvePromote(repo: string, opts: ImprovePromoteInput): ImprovePromoteResult {
  if (!opts.paths.length) {
    throw new Error('coco improve promote: --paths is required (the files the task will touch, so the protected-path guard can bind to them)');
  }
  // --spec must resolve to an EXISTING coco-improve spec card — no dead links, no wrong-type promotion.
  const spec = readCards(repo).find((c) => c.id === opts.spec);
  if (!spec || spec.type !== 'spec' || !(spec.tags ?? []).includes('coco-improve')) {
    throw new Error(`coco improve promote: --spec '${opts.spec}' is not an existing coco-improve spec card — archive it first (coco-store add --type spec --tags coco-improve --visibility local)`);
  }

  const check = improveCheck(repo, opts.paths);
  if (!check.ok) return { ok: false, check }; // protected target → refused, backlog untouched

  // Declared paths are persisted INSIDE the task's yaml (backlogPromote), not the markdown body, so
  // they can't inject a node heading. The MERGE-time gate enforces the ACTUAL diff regardless.
  const { promoted } = storePromote(repo, {
    id: opts.id,
    title: opts.title,
    body: opts.body,
    priority: opts.priority,
    dependsOn: opts.dependsOn,
    specId: opts.spec,
    paths: opts.paths,
  });
  return { ok: true, check, promoted };
}
