import { join } from 'node:path';

/** All coco-store paths live under `.coco-store/` at the repo root. Tracking policy (§5.4):
 * roadmap.md is TRACKED; resources.ndjson + briefs/ + pending/ + _assets/ are git-IGNORED so
 * nothing `visibility:"local"` is ever committed. */
export function storeDir(repo: string): string {
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
  // goalId becomes a path segment — reject anything but a safe slug so `../../.coco/goals/g1`
  // can't escape .coco-store/briefs/ and violate the one-way boundary.
  if (!/^[A-Za-z0-9._-]+$/.test(goalId)) throw new Error(`coco-store: invalid goalId '${goalId}' (must match [A-Za-z0-9._-]+)`);
  return join(briefsDir(repo), `${goalId}.md`);
}
export function pendingDir(repo: string): string {
  return join(storeDir(repo), 'pending');
}
export function assetsDir(repo: string): string {
  return join(storeDir(repo), '_assets');
}

/** The .gitignore lines coco-store needs (local data never tracked; roadmap.md stays tracked). */
export const STORE_GITIGNORE_LINES = [
  '.coco-store/resources.ndjson',
  '.coco-store/briefs/',
  '.coco-store/pending/',
  '.coco-store/_assets/',
];
