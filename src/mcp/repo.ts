import { realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { tryGit } from '../git.js';

function realAbs(repoDir: string): string {
  if (!repoDir || !isAbsolute(repoDir)) {
    throw new Error(`coco: repoDir must be an absolute path (got '${repoDir}')`);
  }
  try {
    return realpathSync(repoDir);
  } catch {
    throw new Error(`coco: repoDir does not exist: ${repoDir}`);
  }
}

/** The work-tree root if `real` is inside a NON-bare git work tree, else null. */
function gitToplevel(real: string): string | null {
  const inside = tryGit(real, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok || inside.out.trim() !== 'true') return null; // not a work tree, or bare
  const top = tryGit(real, ['rev-parse', '--show-toplevel']);
  if (!top.ok || !top.out.trim()) return null;
  return realpathSync(top.out.trim());
}

/**
 * For existing-repo tools: require a non-bare git work tree and normalize to its
 * ROOT — so passing a subdirectory operates on the repo, never a nested state dir.
 */
export function resolveRepo(repoDir: string): string {
  const top = gitToplevel(realAbs(repoDir));
  if (!top) throw new Error(`coco: repoDir is not a (non-bare) git work tree: ${repoDir}`);
  return top;
}

/**
 * For `coco_init`: if already inside a repo, return its ROOT (never create a nested
 * `.git` from a subdirectory); otherwise bootstrap a new repo at the given directory.
 */
export function resolveRepoForInit(repoDir: string): string {
  const real = realAbs(repoDir);
  return gitToplevel(real) ?? real;
}
