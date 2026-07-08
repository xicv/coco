import { isAbsolute, relative, resolve } from 'node:path';
import { minimatch } from 'minimatch';
import { tryGit } from '../git.js';

// Paths coco-improve may NEVER propose changing. A self-edit that weakens the gate is the classic
// self-improvement failure, so this is enforced in CODE (via `coco improve check`) — not skill prose.
// It covers: (1) the referee — gate/verdict/verify/merge/risk, the git+state+lock it runs on, and the
// CLI/MCP surfaces that expose it; (2) the metrics/evaluator — improve must not edit what measures it;
// (3) improve's own guard (src/improve/**) and runtime state (.coco/**).
export const PROTECTED_PATHS: readonly string[] = [
  // --- referee / gate ---
  'src/gate.ts',
  'src/epoch.ts',
  'src/fingerprint.ts',
  'src/oracleVerdict.ts',
  'src/state.ts',
  'src/lock.ts',
  'src/git.ts',
  'src/commands/goalStart.ts',
  'src/commands/goalRecord.ts',
  'src/commands/goalOracle.ts',
  'src/commands/goalOp.ts',
  'src/commands/verify.ts',
  'src/commands/merge.ts',
  'src/autoMergeRisk.ts',
  'src/cocoConfig.ts',
  'src/backlog.ts',
  'coco.config.json',
  // --- surfaces that expose / gate the referee ---
  'src/cli.ts',
  'src/mcp/tools.ts',
  'src/mcp/server.ts',
  // --- metrics / evaluator (improve must not game its own measurements) ---
  'src/audit.ts',
  'src/commands/audit.ts',
  'src/commands/doctor.ts',
  // the whole store layer — it validates improve's OWN specs, routes that gate, and enforces the
  // local-only privacy boundary (pack sends only shared cards); improve must weaken none of it
  'src/store/**',
  // --- improve's own enforcement + skill guardrails + runtime state ---
  'src/improve/**',
  'skills/coco-improve/**', // improve must not rewrite its own instructions/guardrails
  '.coco/**',
];

/** Canonicalise a caller path to a repo-relative, lower-cased POSIX path — resolving dot segments,
 * relativising absolutes, and normalising separators. Returns null for a path that escapes the repo
 * or is empty/unresolvable: the guard treats those as REJECTED (fail-closed for a security boundary). */
export function canonicalize(repo: string, path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed) return null;
  const root = resolve(repo);
  const abs = isAbsolute(trimmed) ? resolve(trimmed) : resolve(root, trimmed);
  const rel = relative(root, abs).replace(/\\/g, '/');
  if (rel === '' || rel === '..' || rel.startsWith('../')) return null; // repo root itself, or escapes the repo
  return rel.toLowerCase();
}

/** True if `path` targets a protected file — OR is unresolvable/outside the repo (fail-closed).
 * Matching is case-insensitive (the denylist is lower-case; the canonical form is lower-cased). */
export function isProtected(repo: string, path: string): boolean {
  const c = canonicalize(repo, path);
  if (c === null) return true; // reject anything we can't pin to a repo-relative file
  return PROTECTED_PATHS.some((glob) => c === glob.toLowerCase() || minimatch(c, glob.toLowerCase(), { dot: true }));
}

export interface ImproveCheckResult {
  ok: boolean;
  checked: number;
  protected: string[]; // the ORIGINAL caller paths that are protected/rejected (deduped)
}

/** Refuse a proposal touching any protected path. `ok:false` => a human-authored referee-change goal
 * is required OUTSIDE auto-improve. Reports the original path strings so the caller sees what it sent. */
export function improveCheck(repo: string, paths: string[]): ImproveCheckResult {
  const hits = [...new Set(paths.filter((p) => isProtected(repo, p)))];
  return { ok: hits.length === 0, checked: paths.length, protected: hits };
}

/** The set of files the working tree (and, with `base`, `base...HEAD`) actually changes — so the
 * guard binds to the REAL diff, not just caller-declared paths. */
export function changedFiles(repo: string, base?: string): string[] {
  const names = new Set<string>();
  const add = (out: string) => {
    for (const l of out.split('\n')) {
      const t = l.trim();
      if (t) names.add(t);
    }
  };
  for (const args of [['diff', '--name-only', 'HEAD'], ['diff', '--name-only', '--cached']]) {
    const r = tryGit(repo, args);
    if (r.ok) add(r.out);
  }
  if (base) {
    const r = tryGit(repo, ['diff', '--name-only', `${base}...HEAD`]);
    if (r.ok) add(r.out);
  }
  return [...names];
}

/** Reality-bound check: refuse if any ACTUALLY-changed file is protected. */
export function improveCheckDiff(repo: string, base?: string): ImproveCheckResult {
  return improveCheck(repo, changedFiles(repo, base));
}
