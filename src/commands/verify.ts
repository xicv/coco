import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readVerifyConfig, VERIFY_TEST_COMMAND_CHANGED_WARNING, verifyTestCommandChange } from '../cocoConfig.js';
import { currentBranch, headSha, isClean, treeHash } from '../git.js';
import { withLock } from '../lock.js';
import { cocoDir } from '../paths.js';
import { findActiveGoal, touchAndWrite } from '../state.js';
import type { GoalEvent, GoalState, InFlight } from '../types.js';
import { goalOpClear } from './goalOp.js';
import { goalRecord } from './goalRecord.js';
import { goalStatus } from './goalStatus.js';

const DEFAULT_OUTPUT_LIMIT = 65536;

function runsDir(repo: string): string {
  return join(cocoDir(repo), 'verify-runs');
}
function runDir(repo: string, runId: string): string {
  return join(runsDir(repo), runId);
}
interface RunMeta {
  runId: string;
  goalId: string;
  expectedSha: string;
  tree: string;
  command: string;
  startedAt: string;
  verifyTestCommandChanged?: boolean; // goal diff changed verify.testCommand — surfaced as a warning
}
/** Keep the last `limit` bytes of output — chatty suites must not exhaust memory downstream. */
function tailBytes(s: string, limit: number): string {
  if (s.length <= limit) return s;
  return `…(${s.length - limit} earlier bytes truncated)…\n${s.slice(s.length - limit)}`;
}

export interface VerifyStartResult {
  runId: string;
  status: 'running';
  command: string;
  warnings?: string[];
}

/** Start a coco-owned verify run: coco (not the agent) runs the configured testCommand in the
 * background and later records pass|fail from the exit code. Validates preconditions, sets
 * inFlight{verify,test}, spawns a DETACHED shell that writes out.log + exit.code, returns a runId.
 * The command + all paths are passed via env (never string-interpolated) — injection-safe. */
export function verifyStart(repo: string, opts: { goal: string; expectedSha: string; now?: Date }): VerifyStartResult {
  return withLock(repo, () => {
    const goal = findActiveGoal(repo);
    if (!goal || goal.id !== opts.goal) throw new Error(`coco: no active goal '${opts.goal}'`);
    if (currentBranch(repo) !== goal.branch) throw new Error(`coco: not on goal branch ${goal.branch}`);
    if (goal.inFlight) throw new Error('coco: an op is already in flight; wait for it or op-clear first');
    const head = headSha(repo);
    if (head !== opts.expectedSha) throw new Error(`coco: HEAD moved (expected ${opts.expectedSha}, got ${head})`);
    if (!isClean(repo)) throw new Error('coco: verify requires a clean tree (commit first)');
    if (goalStatus(repo, goal.id).nextAction !== 'verify') throw new Error(`coco: nextAction is not verify — run coco_goal_status`);
    const cfg = readVerifyConfig(repo);
    if (!cfg) throw new Error('coco: no verify.testCommand in coco.config.json — configure the test command coco should run (there is no default and no agent-reported fallback)');

    const runId = `${(opts.now ?? new Date()).toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`;
    const dir = runDir(repo, runId);
    mkdirSync(dir, { recursive: true });
    const outLog = join(dir, 'out.log');
    const exitFile = join(dir, 'exit.code');
    const cmdChanged = verifyTestCommandChange(repo, goal.base) !== 'none';
    const meta: RunMeta = { runId, goalId: goal.id, expectedSha: head, tree: treeHash(repo), command: cfg.testCommand, startedAt: (opts.now ?? new Date()).toISOString(), ...(cmdChanged ? { verifyTestCommandChanged: true } : {}) };
    writeFileSync(join(dir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);

    // Detached: run the committed test command in the background; a watchdog TERM/KILLs it after
    // the timeout so a hung suite can't run forever — either way we write $? so verifyResult always
    // resolves. Command + all paths come via env vars, never interpolated into the script (injection-safe).
    const timeoutSec = cfg.timeoutSec ?? 3600; // default 1h (matches health's in-flight-timeout)
    // `set -m` puts the backgrounded test in its OWN process group (pgid = test_pid), so the
    // watchdog can `kill -TERM -"$test_pid"` the whole subtree (test + workers), not just the
    // wrapper — while this outer shell (a different group) survives to write $?.
    const script = [
      'set -m',
      'sh -c "$COCO_TEST_CMD" > "$COCO_OUT" 2>&1 &',
      'test_pid=$!',
      '( sleep "$COCO_TIMEOUT"; kill -TERM -"$test_pid" 2>/dev/null; sleep 5; kill -KILL -"$test_pid" 2>/dev/null ) &',
      'killer_pid=$!',
      'wait "$test_pid"; code=$?',
      'kill "$killer_pid" 2>/dev/null',
      'printf %s "$code" > "$COCO_EXIT"',
    ].join('\n');
    const child = spawn('/bin/sh', ['-c', script], {
      cwd: repo,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, COCO_TEST_CMD: cfg.testCommand, COCO_OUT: outLog, COCO_EXIT: exitFile, COCO_TIMEOUT: String(timeoutSec) },
    });
    child.unref();

    const inFlight: InFlight = { phase: 'verify', kind: 'test', startedAt: meta.startedAt, runId };
    goal.inFlight = inFlight;
    touchAndWrite(repo, goal, `verify-start:${runId}`);
    return { runId, status: 'running', command: cfg.testCommand, ...(cmdChanged ? { warnings: [VERIFY_TEST_COMMAND_CHANGED_WARNING] } : {}) };
  });
}

/** The verify event already recorded for this run — crash recovery: goalRecord ran but result.json
 * wasn't cached before the process died, so we must NOT record a second (double-counting) event. */
function recordedVerifyEvent(goal: GoalState, runId: string): GoalEvent | undefined {
  for (let i = goal.events.length - 1; i >= 0; i--) {
    const e = goal.events[i];
    if (e.phase === 'verify' && e.runId === runId && (e.verdict === 'pass' || e.verdict === 'fail')) return e;
  }
  return undefined;
}

export type VerifyResultReport =
  | { runId: string; status: 'running' }
  | { runId: string; status: 'aborted'; reason: string; exitCode: number; warnings?: string[] }
  | { runId: string; status: 'done'; verdict: 'pass' | 'fail'; exitCode: number; nextAction: string; warnings?: string[] };

/** Poll a verify run. Running → {running}. Done → re-validate HEAD===expectedSha + clean tree (a
 * long test run must not race the referee), then record verify pass|fail via the internal
 * goalRecord (which clears inFlight). If HEAD moved or the tests dirtied the tree → abort without
 * recording. Not wrapped in withLock: it delegates all mutations to goalRecord / goalOpClear. */
export function verifyResult(repo: string, opts: { goal: string; runId: string }): VerifyResultReport {
  let goal = findActiveGoal(repo);
  if (!goal || goal.id !== opts.goal) throw new Error(`coco: no active goal '${opts.goal}'`);
  // runId is both a path segment and a trust anchor — reject traversal/garbage before touching disk.
  // The charset blocks '/'; the all-dots guard blocks '.'/'..' which would still escape verify-runs/.
  if (!/^[A-Za-z0-9._-]+$/.test(opts.runId) || /^\.+$/.test(opts.runId)) throw new Error(`coco: invalid runId '${opts.runId}'`);
  const dir = runDir(repo, opts.runId);
  const metaPath = join(dir, 'meta.json');
  if (!existsSync(metaPath)) throw new Error(`coco: no verify run '${opts.runId}'`);
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as RunMeta;
  if (meta.goalId !== goal.id) throw new Error(`coco: verify run '${opts.runId}' is for goal '${meta.goalId}', not '${goal.id}'`);
  const warn = meta.verifyTestCommandChanged ? { warnings: [VERIFY_TEST_COMMAND_CHANGED_WARNING] } : {};

  const resultPath = join(dir, 'result.json');
  const exitFile = join(dir, 'exit.code');
  const readExit = (fallback: number): number => {
    if (!existsSync(exitFile)) return fallback;
    const n = Number.parseInt(readFileSync(exitFile, 'utf8').trim(), 10);
    return Number.isNaN(n) ? fallback : n;
  };

  // The DURABLE verify event is the SOLE source of truth for a verdict — only goalRecord writes it,
  // under lock. Whenever it exists, (re)build the authoritative `done` result FROM it and refresh the
  // cache; never trust the runtime result.json for a `done` verdict (it could be forged, stale, or
  // drifted to a different verdict). This is also the crash-recovery path (event recorded, cache lost).
  const baseGoal = goal; // stable non-null handle (outer `goal` is reassigned after the claim below)
  const fromEvent = (): VerifyResultReport | undefined => {
    const recorded = recordedVerifyEvent(findActiveGoal(repo) ?? baseGoal, opts.runId);
    if (!recorded) return undefined;
    const verdict = recorded.verdict as 'pass' | 'fail';
    const result: VerifyResultReport = { runId: opts.runId, status: 'done', verdict, exitCode: readExit(verdict === 'pass' ? 0 : 1), nextAction: goalStatus(repo, baseGoal.id).nextAction, ...warn };
    writeFileSync(resultPath, `${JSON.stringify(result)}\n`);
    return result;
  };
  const backed = fromEvent();
  if (backed) return backed;

  // No durable event yet. A cached aborted/running asserts no green → safe to return verbatim; a
  // cached `done` with no backing event is forged/stale → ignore it and fall through.
  if (existsSync(resultPath)) {
    const cached = JSON.parse(readFileSync(resultPath, 'utf8')) as VerifyResultReport;
    if (cached.status !== 'done') return cached;
  }

  if (!existsSync(exitFile)) return { runId: opts.runId, status: 'running' };

  // The run finished. Claim it EXACTLY once (O_EXCL) so concurrent pollers don't double-record.
  // Crash recovery: a claim with no result.json after CLAIM_STALE_MS means the claimer died
  // mid-record — reclaim it rather than reporting `running` forever.
  const claimPath = join(dir, 'claimed');
  const CLAIM_STALE_MS = 30_000;
  if (existsSync(claimPath) && !existsSync(resultPath)) {
    let staleMs = CLAIM_STALE_MS + 1;
    try {
      staleMs = Date.now() - statSync(claimPath).mtimeMs;
    } catch {
      /* claim vanished — treat as stale and reclaim */
    }
    if (staleMs <= CLAIM_STALE_MS) return { runId: opts.runId, status: 'running' }; // a fresh claim is recording
    try {
      rmSync(claimPath);
    } catch {
      /* another poller already cleared it */
    }
  }
  try {
    writeFileSync(claimPath, '', { flag: 'wx' });
  } catch {
    // Lost the claim (another poller is recording, or a forger pre-created 'claimed'). Re-derive from
    // the durable event if it now exists; otherwise report running — NEVER return an unbacked cache.
    return fromEvent() ?? { runId: opts.runId, status: 'running' };
  }

  // Re-read the goal AFTER claiming so the binding check sees the freshest inFlight.
  goal = findActiveGoal(repo) ?? goal;
  // Sole claimant now. Bind this result to the run coco actually started: only the verifyStart that
  // spawned this run set goal.inFlight.runId. A forged/stale run dir (no matching in-flight test op,
  // and — checked above — no durable recorded event) is refused so the agent can't self-report a pass.
  if (goal.inFlight?.kind !== 'test' || goal.inFlight.runId !== opts.runId) {
    try {
      rmSync(claimPath);
    } catch {
      /* best-effort release */
    }
    throw new Error(`coco: verify result '${opts.runId}' is not bound to an in-flight coco verify run (forged or stale) — run coco_goal_verify_start`);
  }

  const exitCode = readExit(1); // missing/garbage exit code → treat as fail
  const rawOut = existsSync(join(dir, 'out.log')) ? readFileSync(join(dir, 'out.log'), 'utf8') : '';
  const limit = readVerifyConfig(repo)?.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT;
  const output = tailBytes(rawOut, limit);

  let result: VerifyResultReport;
  const head = headSha(repo);
  if (head !== meta.expectedSha || !isClean(repo)) {
    const reason = head !== meta.expectedSha ? 'HEAD moved during the test run' : 'the test run left the tree dirty';
    goalOpClear(repo, { goal: goal.id }); // clear inFlight; do NOT record a verdict against changed state
    result = { runId: opts.runId, status: 'aborted', reason, exitCode, ...warn };
  } else {
    const verdict: 'pass' | 'fail' = exitCode === 0 ? 'pass' : 'fail';
    const evidence = `verify command: ${meta.command}\nexit: ${exitCode}\n--- output tail ---\n${output}`;
    // Stamp the runId so a re-poll after a crash-mid-cache recovers from the durable event (above)
    // instead of recording a second verify event.
    goalRecord(repo, { goal: goal.id, phase: 'verify', verdict, expectedSha: head, evidence, runId: opts.runId });
    result = { runId: opts.runId, status: 'done', verdict, exitCode, nextAction: goalStatus(repo, goal.id).nextAction, ...warn };
  }
  writeFileSync(resultPath, `${JSON.stringify(result)}\n`); // cache → every later poll is idempotent
  return result;
}
