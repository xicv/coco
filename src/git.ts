import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { GoalState } from './types.js';
import type { LiveGit } from './gate.js';

export function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** Run git, capturing failure instead of throwing. */
export function tryGit(cwd: string, args: string[]): { ok: boolean; out: string } {
  try {
    return { ok: true, out: execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
  } catch (e) {
    const err = e as { stderr?: Buffer; message?: string };
    return { ok: false, out: (err.stderr?.toString() ?? err.message ?? '').trim() };
  }
}

export function headSha(cwd: string): string {
  return git(cwd, ['rev-parse', 'HEAD']);
}
export function treeHash(cwd: string): string {
  return git(cwd, ['rev-parse', 'HEAD^{tree}']);
}
/** The git tree hash of an arbitrary ref (e.g. the branch base) — used to detect no-op work. */
export function treeOfRef(cwd: string, ref: string): string {
  return git(cwd, ['rev-parse', `${ref}^{tree}`]);
}
export function isClean(cwd: string): boolean {
  return git(cwd, ['status', '--porcelain']) === '';
}
export function currentBranch(cwd: string): string {
  return git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
}
export function isAncestor(cwd: string, base: string, head: string): boolean {
  return tryGit(cwd, ['merge-base', '--is-ancestor', base, head]).ok;
}
export function createBranch(cwd: string, name: string, from: string): void {
  git(cwd, ['branch', name, from]);
}
export function checkout(cwd: string, ref: string): void {
  git(cwd, ['checkout', ref]);
}
/** Checkout `into`, then fast-forward-only merge `branch`. */
export function ffMerge(cwd: string, into: string, branch: string): { ok: boolean; out: string } {
  const co = tryGit(cwd, ['checkout', into]);
  if (!co.ok) return co;
  return tryGit(cwd, ['merge', '--ff-only', branch]);
}

export function gatherLive(cwd: string, goal: GoalState): LiveGit {
  return {
    tHead: treeHash(cwd),
    treeClean: isClean(cwd),
    onBranch: currentBranch(cwd) === goal.branch,
    baseMerged: isAncestor(cwd, goal.base, 'HEAD'),
  };
}

// --- health probes (used by `coco health`) ---
export function refExists(cwd: string, ref: string): boolean {
  return tryGit(cwd, ['rev-parse', '--verify', '--quiet', ref]).ok;
}
export function headResolvable(cwd: string): boolean {
  return tryGit(cwd, ['rev-parse', '-q', '--verify', 'HEAD^{commit}']).ok;
}
export function inConflict(cwd: string): boolean {
  return git(cwd, ['ls-files', '-u']) !== '';
}
export function opInProgress(cwd: string): boolean {
  for (const name of ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'sequencer']) {
    const p = tryGit(cwd, ['rev-parse', '--git-path', name]);
    if (p.ok && existsSync(resolve(cwd, p.out))) return true;
  }
  return false;
}
export function eventsIntact(cwd: string, events: { commit: string; tree: string }[]): boolean {
  for (const e of events) {
    if (!tryGit(cwd, ['cat-file', '-e', `${e.commit}^{commit}`]).ok) return false;
    if (!tryGit(cwd, ['cat-file', '-e', `${e.tree}^{tree}`]).ok) return false;
  }
  return true;
}
