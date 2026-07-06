import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tryGit } from './git.js';

export interface VerifyConfig {
  testCommand: string;
  timeoutSec?: number;
  outputLimitBytes?: number;
}

/** Parse a `coco.config.json` body into a VerifyConfig, or null if missing/malformed. */
function parseVerifyConfig(raw: string): VerifyConfig | null {
  try {
    const cfg = JSON.parse(raw) as { verify?: Partial<VerifyConfig> };
    const v = cfg?.verify;
    if (!v || typeof v.testCommand !== 'string' || !v.testCommand.trim()) return null;
    return {
      testCommand: v.testCommand,
      timeoutSec: typeof v.timeoutSec === 'number' && v.timeoutSec > 0 ? v.timeoutSec : undefined,
      outputLimitBytes: typeof v.outputLimitBytes === 'number' && v.outputLimitBytes > 0 ? v.outputLimitBytes : undefined,
    };
  } catch {
    return null;
  }
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

/** Non-blocking warnings about a goal branch's verification policy (surfaced, never gated). */
export function verifyConfigWarnings(repo: string, base: string, head = 'HEAD'): string[] {
  return verifyTestCommandChange(repo, base, head) === 'none' ? [] : [VERIFY_TEST_COMMAND_CHANGED_WARNING];
}
