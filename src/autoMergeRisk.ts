import { minimatch } from 'minimatch';
import { type AutoMergeConfig, readAutoMergePolicyAtRef } from './cocoConfig.js';
import { tryGit } from './git.js';

/** Paths that ALWAYS block auto-merge, regardless of user config — the policy self-tamper guard.
 * `coco.config.json` is the policy itself; `.coco/**` is coco's runtime state. A branch cannot
 * relax these away (user `sensitiveGlobs` is added ON TOP of this list, never replaces it). */
const ALWAYS_SENSITIVE = ['coco.config.json', '.coco/**'];

export interface RiskReport {
  allowed: boolean;
  reason?: string; // set only when !allowed
  changedFiles: number;
  changedLines: number; // added + deleted
  sensitiveHits: string[]; // changed files that matched a sensitive glob
  hasTests: boolean;
}

function matchAny(path: string, globs: string[]): boolean {
  return globs.some((g) => minimatch(path, g, { dot: true }));
}

/** Files changed on `head` since it diverged from `base` (three-dot = the branch's own changes). */
export function changedFilesOf(repo: string, base: string, head: string): string[] {
  const r = tryGit(repo, ['diff', '--name-only', `${base}...${head}`]);
  return r.ok ? r.out.split('\n').map((s) => s.trim()).filter(Boolean) : [];
}

/** Total added + deleted lines between `base` and `head`. Binary files (numstat `-`) count as 0. */
export function changedLinesOf(repo: string, base: string, head: string): number {
  const r = tryGit(repo, ['diff', '--numstat', `${base}...${head}`]);
  if (!r.ok) return 0;
  let total = 0;
  for (const line of r.out.split('\n')) {
    const [add, del] = line.trim().split('\t');
    const a = Number(add);
    const d = Number(del);
    if (Number.isFinite(a)) total += a;
    if (Number.isFinite(d)) total += d;
  }
  return total;
}

/** Decide whether a goal branch's diff is safe to AUTO-merge (Layer 2). Policy is read at `base`
 * (tamper-resistant). This is a risk gate layered ON TOP of the existing mergeDecision gates — it
 * never loosens them; a block here means "fall back to a human merge", not "fail". */
export function assessAutoMergeRisk(
  repo: string,
  base: string,
  head: string,
  policy?: AutoMergeConfig,
): RiskReport {
  const cfg = policy ?? readAutoMergePolicyAtRef(repo, base);
  const files = changedFilesOf(repo, base, head);
  const lines = changedLinesOf(repo, base, head);
  const sensitiveHits = files.filter((f) => matchAny(f, [...ALWAYS_SENSITIVE, ...cfg.sensitiveGlobs]));
  const hasTests = files.some((f) => matchAny(f, cfg.testGlobs));

  const base_: RiskReport = {
    allowed: true,
    changedFiles: files.length,
    changedLines: lines,
    sensitiveHits,
    hasTests,
  };

  if (files.length === 0) return { ...base_, allowed: false, reason: 'auto-merge blocked: empty diff' };
  if (sensitiveHits.length > 0) {
    return { ...base_, allowed: false, reason: `auto-merge blocked: sensitive paths changed (${sensitiveHits.slice(0, 5).join(', ')})` };
  }
  if (lines > cfg.maxChangedLines) {
    return { ...base_, allowed: false, reason: `auto-merge blocked: diff too large (${lines} > ${cfg.maxChangedLines} lines)` };
  }
  if (!hasTests) return { ...base_, allowed: false, reason: 'auto-merge blocked: no test files in diff' };
  return base_;
}
