import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tryGit } from './git.js';

export interface VerifyConfig {
  testCommand: string;
  timeoutSec?: number;
  outputLimitBytes?: number;
}

export interface WorkflowConfig {
  baseBranch?: string;
}

function parseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Parse a `coco.config.json` body into a VerifyConfig, or null if missing/malformed. */
function parseVerifyConfig(raw: string): VerifyConfig | null {
  const cfg = asObject(parseJson(raw));
  const v = asObject(cfg?.verify);
  if (!v || typeof v.testCommand !== 'string' || !v.testCommand.trim()) return null;
  return {
    testCommand: v.testCommand,
    timeoutSec: typeof v.timeoutSec === 'number' && v.timeoutSec > 0 ? v.timeoutSec : undefined,
    outputLimitBytes: typeof v.outputLimitBytes === 'number' && v.outputLimitBytes > 0 ? v.outputLimitBytes : undefined,
  };
}

/** Read the TRACKED `coco.config.json` at the repo root (NOT `.coco/`, which is git-ignored runtime
 * state). Returns the verify config, or null if the file/field is missing or malformed. The test
 * command is committed repo policy — that is what makes it safe for coco to run in a shell. */
export function readVerifyConfig(repo: string): VerifyConfig | null {
  const p = join(repo, 'coco.config.json');
  if (!existsSync(p)) return null;
  return parseVerifyConfig(readFileSync(p, 'utf8'));
}

/** The parsed verify config as committed at a git ref (for base-vs-HEAD comparison). */
function readVerifyConfigAtRef(repo: string, ref: string): VerifyConfig | null {
  const r = tryGit(repo, ['show', `${ref}:coco.config.json`]);
  return r.ok ? parseVerifyConfig(r.out) : null;
}

export type VerifyTestCommandChange = 'added' | 'removed' | 'changed' | 'none';

/** Did the PARSED verify.testCommand change between `base` and `head`? Compares the parsed value, so
 * JSON-formatting-only or unrelated timeoutSec/outputLimitBytes edits are 'none'. */
export function verifyTestCommandChange(repo: string, base: string, head = 'HEAD'): VerifyTestCommandChange {
  const baseCmd = readVerifyConfigAtRef(repo, base)?.testCommand ?? null;
  const headCmd = readVerifyConfigAtRef(repo, head)?.testCommand ?? null;
  if (baseCmd === headCmd) return 'none';
  if (baseCmd === null) return 'added';
  if (headCmd === null) return 'removed';
  return 'changed';
}

export const VERIFY_TEST_COMMAND_CHANGED_WARNING =
  'verify.testCommand differs between base and HEAD — verify ran the branch version, so review should confirm this verification-policy change';

export const VERIFY_TEST_COMMAND_CHANGE_ACK =
  'verify.testCommand changed in this goal. Human merge requires explicit acknowledgement: `coco merge --goal <id> --ack-verify-policy-change`';

export const VERIFY_NOT_CONFIGURED_WARNING =
  'coco.config.json has no verify.testCommand set — coco runs this itself at the verify gate (there is no agent fallback), so configure it before you get there';

// --- Workflow policy (coco.config.json → `workflow`) ---

function parseWorkflowConfig(raw: string): WorkflowConfig {
  const cfg = asObject(parseJson(raw));
  const w = asObject(cfg?.workflow);
  const baseBranch = typeof w?.baseBranch === 'string' && w.baseBranch.trim() ? w.baseBranch.trim() : undefined;
  return { ...(baseBranch ? { baseBranch } : {}) };
}

export function readWorkflowConfig(repo: string): WorkflowConfig {
  const p = join(repo, 'coco.config.json');
  if (!existsSync(p)) return {};
  return parseWorkflowConfig(readFileSync(p, 'utf8'));
}

function localRefExists(repo: string, ref: string): boolean {
  return tryGit(repo, ['rev-parse', '--verify', '--quiet', ref]).ok;
}

/** Resolve the branch a new goal should fork from. Config wins; otherwise prefer the repo's default
 * remote branch, then common local defaults, then the current branch. */
export function resolveBaseBranch(repo: string): string {
  const configured = readWorkflowConfig(repo).baseBranch;
  if (configured) return configured;

  const originHead = tryGit(repo, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (originHead.ok) {
    const b = originHead.out.trim().replace(/^origin\//, '');
    if (b) return b;
  }

  for (const candidate of ['main', 'master', 'trunk', 'develop']) {
    if (localRefExists(repo, candidate)) return candidate;
  }

  const current = tryGit(repo, ['branch', '--show-current']);
  return current.ok && current.out.trim() ? current.out.trim() : 'main';
}

// --- Layer 2 auto-merge policy (coco.config.json → `autoMerge`) ---

export interface AutoMergeConfig {
  maxChangedLines: number; // block auto-merge above this many added+deleted lines
  sensitiveGlobs: string[]; // any changed file matching one of these blocks auto-merge (→ human)
  testGlobs: string[]; // a diff must touch at least one file matching these (else block)
}

/** Conservative defaults. Auto-merge is opt-in per goal; these only shape WHEN it's allowed once
 * opted in. Deliberately broad on the sensitive side — false-blocks fall back to a human merge. */
export const DEFAULT_AUTO_MERGE_CONFIG: AutoMergeConfig = {
  maxChangedLines: 500,
  sensitiveGlobs: [
    'migrations/**',
    '**/migrations/**',
    '**/auth/**',
    '**/*auth*',
    '**/*secret*',
    '**/*credential*',
    'security/**',
    '**/security/**',
    'deployment/**',
    '**/deployment/**',
    '.github/workflows/**',
    'Dockerfile*',
    '**/Dockerfile*',
    'docker-compose*.yml',
    '**/docker-compose*.yml',
  ],
  testGlobs: ['**/*.test.*', '**/*.spec.*', '**/test/**', '**/tests/**', '**/__tests__/**'],
};

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function uniq(xs: string[]): string[] {
  return [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
}

/** Parse the `autoMerge` block. User globs are ADDITIVE by default so a partial config cannot
 * accidentally relax coco's conservative defaults; explicit `replaceDefault*Globs:true` is required
 * for replacement, and `.coco/**` + `coco.config.json` still remain always-sensitive in autoMergeRisk. */
function parseAutoMergeConfig(raw: string): AutoMergeConfig {
  const cfg = asObject(parseJson(raw));
  const a = asObject(cfg?.autoMerge);
  if (!a) return DEFAULT_AUTO_MERGE_CONFIG;

  const sensitiveRaw = isStringArray(a.sensitiveGlobs) ? a.sensitiveGlobs : [];
  const sensitiveAdd = isStringArray(a.additionalSensitiveGlobs) ? a.additionalSensitiveGlobs : [];
  const testRaw = isStringArray(a.testGlobs) ? a.testGlobs : [];
  const testAdd = isStringArray(a.additionalTestGlobs) ? a.additionalTestGlobs : [];
  const replaceSensitive = a.replaceDefaultSensitiveGlobs === true;
  const replaceTests = a.replaceDefaultTestGlobs === true;

  return {
    maxChangedLines:
      typeof a.maxChangedLines === 'number' && a.maxChangedLines > 0
        ? Math.floor(a.maxChangedLines)
        : DEFAULT_AUTO_MERGE_CONFIG.maxChangedLines,
    sensitiveGlobs: uniq([...(replaceSensitive ? [] : DEFAULT_AUTO_MERGE_CONFIG.sensitiveGlobs), ...sensitiveRaw, ...sensitiveAdd]),
    testGlobs: uniq([...(replaceTests ? [] : DEFAULT_AUTO_MERGE_CONFIG.testGlobs), ...testRaw, ...testAdd]),
  };
}

/** Read the auto-merge policy as committed AT `ref` (always the goal BASE, never HEAD) so a branch
 * cannot relax the policy that governs its own auto-merge. Missing config → conservative defaults. */
export function readAutoMergePolicyAtRef(repo: string, ref: string): AutoMergeConfig {
  const r = tryGit(repo, ['show', `${ref}:coco.config.json`]);
  return r.ok ? parseAutoMergeConfig(r.out) : DEFAULT_AUTO_MERGE_CONFIG;
}

/** Non-blocking warnings about a goal branch's verification policy (surfaced, never gated). Emitted
 * at goal-start and every cycle, so a missing verify.testCommand is discoverable up front rather than
 * only when the loop reaches the verify gate. */
export function verifyConfigWarnings(repo: string, base: string, head = 'HEAD'): string[] {
  const warnings: string[] = [];
  if (verifyTestCommandChange(repo, base, head) !== 'none') warnings.push(VERIFY_TEST_COMMAND_CHANGED_WARNING);
  if (readVerifyConfigAtRef(repo, head) === null) warnings.push(VERIFY_NOT_CONFIGURED_WARNING);
  return warnings;
}
