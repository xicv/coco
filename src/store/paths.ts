import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** All coco-store paths live under `.coco/store/` at the repo root, alongside the loop's runtime
 * state in `.coco/`. The whole `.coco/` tree is git-IGNORED (fail-closed: nothing under it is ever
 * committed), so the store — roadmap.md included — is entirely local. The roadmap still rides along
 * in a `pack` brief to Oracle (see pack.ts): "git-local" here means "not committed", NOT "never
 * shared with the review brain". */
export function storeDir(repo: string): string {
  return join(repo, '.coco', 'store');
}

/** The pre-0.7 store location. Retained only so `migrateLegacyStore` can move an existing
 * `.coco-store/` into `.coco/store/` on the next store command. */
export function legacyStoreDir(repo: string): string {
  return join(repo, '.coco-store');
}
export function roadmapPath(repo: string): string {
  return join(storeDir(repo), 'roadmap.md');
}
export function manifestPath(repo: string): string {
  return join(storeDir(repo), 'resources.ndjson');
}
export function briefsDir(repo: string): string {
  return join(storeDir(repo), 'briefs');
}
export function briefPath(repo: string, goalId: string): string {
  // goalId becomes a path segment — reject anything but a safe slug so `../../goals/g1`
  // can't escape .coco/store/briefs/ and violate the one-way boundary.
  if (!/^[A-Za-z0-9._-]+$/.test(goalId)) throw new Error(`coco-store: invalid goalId '${goalId}' (must match [A-Za-z0-9._-]+)`);
  return join(briefsDir(repo), `${goalId}.md`);
}
export function pendingDir(repo: string): string {
  return join(storeDir(repo), 'pending');
}
export function assetsDir(repo: string): string {
  return join(storeDir(repo), '_assets');
}

/** The .gitignore line coco-store needs. The store now lives under `.coco/store/`, and the whole
 * `.coco/` tree is git-ignored, so a single line covers everything (roadmap.md included) — no
 * per-subpath rules and no negation. `coco init` may already ignore `.coco/`; this is the store's
 * self-contained guarantee for repos where only `coco-store` ran. */
export const STORE_GITIGNORE_LINES = ['.coco/store/'];

/** Idempotently guarantee the store's local data is git-ignored. Any store write path (init, viz,
 * promote) and the legacy migration call this so store data is never left committable, even in a
 * repo where `coco init` never ran. */
export function ensureGitignore(repo: string): void {
  const p = join(repo, '.gitignore');
  const existing = existsSync(p) ? readFileSync(p, 'utf8') : '';
  const lines = existing.split('\n').map((l) => l.trim());
  const missing = STORE_GITIGNORE_LINES.filter((l) => !lines.includes(l));
  if (missing.length) appendFileSync(p, `${existing && !existing.endsWith('\n') ? '\n' : ''}# coco-store local data\n${missing.join('\n')}\n`);
}
