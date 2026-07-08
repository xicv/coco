import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { ensureGitignore, legacyStoreDir, storeDir } from './paths.js';

export interface StoreMigration {
  migrated: boolean;
  from?: string;
  to?: string;
}

/** One-time, idempotent move of a pre-0.7 `.coco-store/` into `.coco/store/`. Runs on every
 * store command but is a no-op unless the legacy dir exists AND the new one does not — so it never
 * clobbers an already-migrated (or freshly created) store. Filesystem-only: it moves the directory
 * and leaves git alone. If the legacy roadmap.md was tracked, git will show it as deleted at the old
 * path (the new location is git-ignored); the user commits that deletion. */
export function migrateLegacyStore(repo: string): StoreMigration {
  const legacy = legacyStoreDir(repo);
  const target = storeDir(repo);
  if (!existsSync(legacy) || existsSync(target)) return { migrated: false };
  mkdirSync(dirname(target), { recursive: true }); // ensure `.coco/` exists
  renameSync(legacy, target);
  ensureGitignore(repo); // fail-closed: the moved store must be git-ignored even if `coco init` never ran
  return { migrated: true, from: legacy, to: target };
}
