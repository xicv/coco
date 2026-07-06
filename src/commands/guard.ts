import { existsSync, readdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { currentBranch, tryGit } from '../git.js';
import { readGoal } from '../state.js';
import { goalsDir } from '../paths.js';
import { classifyOp, splitSegments, tokenize, type GuardDecision } from '../guard.js';

function safeCurrentBranch(repo: string): string | null {
  try {
    return currentBranch(repo);
  } catch {
    return null; // unborn/detached/broken HEAD → fail open
  }
}

function repoRoot(cwd: string): string | null {
  const r = tryGit(cwd, ['rev-parse', '--show-toplevel']);
  return r.ok && r.out.trim() ? r.out.trim() : null;
}

/** The base branch of the active goal in `repo`, or null if none is active. */
function activeGoalBase(repo: string): string | null {
  const dir = goalsDir(repo);
  if (!existsSync(dir)) return null;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const g = readGoal(join(dir, f));
      if (g.state === 'active') return g.base;
    } catch {
      // skip unreadable goal file
    }
  }
  return null;
}

function resolveDir(baseCwd: string, p: string): string {
  return isAbsolute(p) ? p : resolve(baseCwd, p);
}

/**
 * Evaluate a shell command (possibly chained) for a raw base-landing git op while a
 * coco goal is active. Tracks `cd` across chains and honors `git -C <path>`, so the
 * active-goal lookup uses the repo the command actually operates on.
 */
export function runGuard(cwd: string, command: string): GuardDecision {
  let effCwd = cwd;
  for (const seg of splitSegments(command)) {
    const tokens = tokenize(seg);
    if (tokens.length === 0) continue;

    if (tokens[0] === 'cd' && tokens[1]) {
      effCwd = resolveDir(effCwd, tokens[1]);
      continue;
    }

    // Target dir: `git -C <path>` overrides the effective cwd for that invocation.
    let dir = effCwd;
    if (tokens[0] === 'git') {
      const ci = tokens.indexOf('-C');
      if (ci >= 0 && tokens[ci + 1]) dir = resolveDir(effCwd, tokens[ci + 1]);
    }

    const repo = repoRoot(dir);
    if (!repo) continue;
    const base = activeGoalBase(repo);
    if (!base) continue; // no active goal here → never block

    const op = classifyOp(tokens, base, safeCurrentBranch(repo));
    if (op) {
      return {
        block: true,
        op,
        reason: `coco: a goal is active in ${repo} — do not run "${op}" directly. Land changes through the human checkpoint: coco merge --goal <id>.`,
      };
    }
  }
  return { block: false };
}

/**
 * Handle a raw PreToolUse hook payload (stdin JSON, same shape in Codex + Claude Code).
 * Returns the deny-JSON string to print, or '' to allow. FAILS OPEN on any parse/logic
 * error so a malformed payload can never break the agent.
 */
export function guardHook(payload: string): string {
  try {
    const j = JSON.parse(payload) as { tool_input?: { command?: string }; cwd?: string };
    const command = j.tool_input?.command;
    const cwd = j.cwd;
    if (typeof command !== 'string' || typeof cwd !== 'string' || !command || !cwd) return '';
    const d = runGuard(cwd, command);
    if (!d.block) return '';
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: d.reason,
      },
    });
  } catch {
    return '';
  }
}
