import { existsSync, lstatSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { auditPath } from '../audit.js';
import { readVerifyConfig, VERIFY_NOT_CONFIGURED_WARNING } from '../cocoConfig.js';
import { tryGit } from '../git.js';
import { incidentsPath } from '../incidents.js';
import { lockStatus } from '../lock.js';
import { cocoDir, goalsDir, lockPath } from '../paths.js';
import { readGoal } from '../state.js';
import { storeDir } from '../store/paths.js';
import { cocoVersion } from '../version.js';
import { auditValidate } from './audit.js';
import { goalHealth } from './health.js';
import { defaultPaths, isGuardInstalled } from './installHooks.js';
import { listWatchdogs } from './watchdog.js';

// coco-doctor: a deterministic (no-LLM), read-only diagnostic that AGGREGATES existing primitives
// (health, verify config, hooks, watchdog) plus environment/prereq/data-hygiene checks it adds.
// It never replaces `coco health` — it surrounds it. Cleanup is a separate, consent-gated step.

export type CheckStatus = 'ok' | 'warn' | 'fail';
export interface Check {
  group: 'environment' | 'repo' | 'wiring' | 'goal' | 'data';
  name: string;
  status: CheckStatus;
  detail: string;
}
export interface DoctorReport {
  checks: Check[];
  summary: { ok: number; warn: number; fail: number };
}

const runsDir = (repo: string): string => join(cocoDir(repo), 'verify-runs');

function safeReaddir(dir: string): string[] {
  try {
    return existsSync(dir) ? readdirSync(dir) : [];
  } catch {
    return [];
  }
}
function fileSize(p: string): number {
  try {
    return existsSync(p) ? statSync(p).size : 0;
  } catch {
    return 0;
  }
}
function dirSize(dir: string): number {
  let total = 0;
  for (const e of safeReaddir(dir)) {
    const p = join(dir, e);
    try {
      const st = lstatSync(p); // lstat, not stat — never follow a symlink out of the repo
      if (st.isSymbolicLink()) continue;
      total += st.isDirectory() ? dirSize(p) : st.size;
    } catch {
      // skip an entry that vanished / can't be stat'd
    }
  }
  return total;
}

/** .gitignore lists `.coco/` (the check goalStart uses to gate `coco init`). Tolerant of a read error. */
function cocoInitialized(repo: string): boolean {
  try {
    const gi = join(repo, '.gitignore');
    return existsSync(gi) && readFileSync(gi, 'utf8').split('\n').map((l) => l.trim()).includes('.coco/');
  } catch {
    return false;
  }
}

/** Config-presence probe (a HINT, not a live connect): does ~/.codex/config.toml register this MCP
 * server in an UNcommented block? Comment lines are stripped so a disabled `# [mcp_servers.x]` block
 * never reads as configured. */
function mcpConfigured(home: string, server: string): boolean {
  try {
    const p = join(home, '.codex', 'config.toml');
    if (!existsSync(p)) return false;
    const uncommented = readFileSync(p, 'utf8').split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    return uncommented.includes(`[mcp_servers.${server}]`);
  } catch {
    return false;
  }
}

function environmentChecks(repo: string): Check[] {
  const major = Number(process.versions.node.split('.')[0]);
  const git = tryGit(repo, ['--version']);
  return [
    { group: 'environment', name: 'node', status: major >= 20 ? 'ok' : 'fail', detail: `${process.version} (need >=20)` },
    { group: 'environment', name: 'git', status: git.ok ? 'ok' : 'fail', detail: git.ok ? git.out.trim() : 'git not found on PATH' },
    { group: 'environment', name: 'coco version', status: 'ok', detail: cocoVersion() },
  ];
}

function repoChecks(repo: string): Check[] {
  const isRepo = tryGit(repo, ['rev-parse', '--git-dir']).ok;
  const inited = cocoInitialized(repo);
  const cfg = readVerifyConfig(repo);
  return [
    { group: 'repo', name: 'git repo', status: isRepo ? 'ok' : 'fail', detail: isRepo ? repo : 'not inside a git work tree' },
    { group: 'repo', name: 'coco initialized', status: inited ? 'ok' : 'warn', detail: inited ? '.coco/ is gitignored' : 'run `coco init`' },
    { group: 'repo', name: 'verify.testCommand', status: cfg ? 'ok' : 'warn', detail: cfg ? cfg.testCommand : VERIFY_NOT_CONFIGURED_WARNING },
    { group: 'repo', name: 'coco-store', status: 'ok', detail: existsSync(storeDir(repo)) ? 'present' : 'not initialized (optional)' },
  ];
}

function wiringChecks(repo: string, home: string): Check[] {
  const paths = defaultPaths(home, '');
  const codexHook = isGuardInstalled(paths.codexHooksJson);
  const claudeHook = isGuardInstalled(paths.claudeSettings);
  const hookStatus: CheckStatus = codexHook && claudeHook ? 'ok' : codexHook || claudeHook ? 'warn' : 'warn';
  const watchdogs = listWatchdogs(home).filter((w) => w.repo === repo);
  return [
    { group: 'wiring', name: 'merge-guard hooks', status: hookStatus, detail: `codex:${codexHook ? 'yes' : 'no'} claude:${claudeHook ? 'yes' : 'no'}` + (hookStatus === 'ok' ? '' : ' — run `coco install-hooks`') },
    { group: 'wiring', name: 'coco MCP', status: mcpConfigured(home, 'coco') ? 'ok' : 'warn', detail: mcpConfigured(home, 'coco') ? 'registered in ~/.codex/config.toml' : 'not registered in ~/.codex/config.toml' },
    { group: 'wiring', name: 'oracle MCP', status: mcpConfigured(home, 'oracle') ? 'ok' : 'warn', detail: mcpConfigured(home, 'oracle') ? 'registered (review brain)' : 'not registered — the Oracle review gate cannot run' },
    { group: 'wiring', name: 'watchdog', status: 'ok', detail: watchdogs.length ? `${watchdogs.length} installed` : 'none (optional)' },
  ];
}

function goalCheck(repo: string, now: number): Check {
  try {
    const h = goalHealth(repo, undefined, now);
    const good = h.verdict === 'healthy' || h.verdict === 'operation-in-progress';
    return { group: 'goal', name: 'active goal', status: good ? 'ok' : 'warn', detail: `${h.goalId}: ${h.verdict}` };
  } catch {
    return { group: 'goal', name: 'active goal', status: 'ok', detail: 'no active goal' };
  }
}

function dataChecks(repo: string, now: number): Check[] {
  const goalFiles = safeReaddir(goalsDir(repo)).filter((f) => f.endsWith('.json'));
  const byState: Record<string, number> = {};
  for (const f of goalFiles) {
    try {
      const st = readGoal(join(goalsDir(repo), f)).state;
      byState[st] = (byState[st] ?? 0) + 1;
    } catch {
      byState.unreadable = (byState.unreadable ?? 0) + 1;
    }
  }
  const runs = safeReaddir(runsDir(repo));
  const runBytes = dirSize(runsDir(repo));
  const ls = lockStatus(lockPath(repo), now);
  const lockDetail = ls.stale ? 'stale (held by a dead process) — `coco doctor clean`' : ls.held ? 'held (op in progress)' : 'free';
  const logBytes = fileSize(auditPath(repo)) + fileSize(incidentsPath(repo));
  const audit = auditValidate(repo);
  return [
    { group: 'data', name: 'goals', status: 'ok', detail: goalFiles.length ? JSON.stringify(byState) : 'none' },
    { group: 'data', name: 'audit validity', status: audit.ok ? 'ok' : 'fail', detail: audit.ok ? `${audit.validRecords} valid record(s)` : `${audit.failures.length} failure(s), ${audit.invalidRecords} invalid line(s) — run \`coco audit validate\`` },
    { group: 'data', name: 'verify-runs', status: runs.length > 20 ? 'warn' : 'ok', detail: `${runs.length} run(s), ${Math.round(runBytes / 1024)} KB` + (runs.length > 20 ? ' — `coco doctor clean`' : '') },
    { group: 'data', name: 'logs', status: 'ok', detail: `audit+incidents ${Math.round(logBytes / 1024)} KB` },
    { group: 'data', name: 'lock', status: ls.stale ? 'warn' : 'ok', detail: lockDetail },
  ];
}

/** Run a check group, converting any thrown error into a single 'fail' check — so one broken probe
 * (unreadable .gitignore/config/plist) degrades that group instead of aborting the whole report. */
function safeGroup(group: Check['group'], fn: () => Check[]): Check[] {
  try {
    return fn();
  } catch (e) {
    return [{ group, name: `${group} checks`, status: 'fail', detail: `check errored: ${(e as Error).message}` }];
  }
}

/** Aggregate all checks into one read-only report. `opts.home`/`opts.now` are injectable for tests. */
export function runDoctor(repo: string, opts: { home?: string; now?: number } = {}): DoctorReport {
  const home = opts.home ?? homedir();
  const now = opts.now ?? Date.now();
  const checks: Check[] = [
    ...safeGroup('environment', () => environmentChecks(repo)),
    ...safeGroup('repo', () => repoChecks(repo)),
    ...safeGroup('wiring', () => wiringChecks(repo, home)),
    ...safeGroup('goal', () => [goalCheck(repo, now)]),
    ...safeGroup('data', () => dataChecks(repo, now)),
  ];
  const summary = { ok: 0, warn: 0, fail: 0 };
  for (const c of checks) summary[c.status]++;
  return { checks, summary };
}

// --- Consent-gated cleanup (dry-run by default) ---

export interface CleanTarget {
  kind: 'verify-run';
  path: string;
  bytes: number;
  detail: string;
}
export interface CleanReport {
  applied: boolean;
  targets: CleanTarget[];
  reclaimedBytes: number;
}

const TERMINAL_STATES = new Set(['achieved', 'failed', 'cancelled']);

/** Propose (default) or apply (`opts.apply`) SAFE cleanup of the verify-run cache. A run is
 * reclaimable ONLY if its owning goal is terminal (achieved/failed/cancelled) or gone (orphaned).
 * Runs for a LIVE goal (active OR blocked/resumable), and runs whose meta can't be read (unattributable),
 * are preserved. Never touches goal ledgers or the audit/incident logs. The stale lock is NOT cleaned
 * here — it self-heals via the serialized break path in lock.ts; doctor only REPORTS it. */
export function cleanDoctor(repo: string, opts: { apply?: boolean } = {}): CleanReport {
  // Snapshot each goal's lifecycle state so we can tell terminal/orphaned from live (active/blocked).
  const goalState = new Map<string, string>();
  for (const f of safeReaddir(goalsDir(repo)).filter((f) => f.endsWith('.json'))) {
    try {
      const gs = readGoal(join(goalsDir(repo), f));
      goalState.set(gs.id, gs.state);
    } catch {
      // an unreadable goal file simply won't shield its runs from the orphan rule below
    }
  }

  const targets: CleanTarget[] = [];
  for (const runId of safeReaddir(runsDir(repo))) {
    const dir = join(runsDir(repo), runId);
    let goalId: string | undefined;
    try {
      goalId = (JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as { goalId?: string }).goalId;
    } catch {
      // unreadable/partial meta → can't attribute it → do NOT auto-delete (leave it for a human)
    }
    if (!goalId) continue;
    const st = goalState.get(goalId);
    const reclaimable = st === undefined || TERMINAL_STATES.has(st); // orphaned or terminal only
    if (!reclaimable) continue; // preserve active + blocked (resumable) goals' runs
    targets.push({ kind: 'verify-run', path: dir, bytes: dirSize(dir), detail: `run for ${goalId} (${st ?? 'orphaned'})` });
  }

  let reclaimed = 0;
  if (opts.apply) {
    for (const t of targets) {
      try {
        rmSync(t.path, { recursive: true, force: true });
        reclaimed += t.bytes;
      } catch {
        // best-effort — a file that vanished mid-clean is fine
      }
    }
  }
  return { applied: opts.apply === true, targets, reclaimedBytes: opts.apply ? reclaimed : targets.reduce((n, t) => n + t.bytes, 0) };
}
