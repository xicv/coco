import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tryGit } from './git.js';
import { initRepo } from './commands/init.js';

/** Resolve to the git work-tree root so repo commands work from any subdirectory. */
function gitTop(cwd: string): string {
  const r = tryGit(cwd, ['rev-parse', '--show-toplevel']);
  return r.ok && r.out.trim() ? r.out.trim() : cwd;
}

function posNum(name: string, raw: string | undefined, def: number): number {
  if (raw == null) return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`coco: --${name} must be a positive number`);
  return n;
}
function posInt(name: string, raw: string | undefined, def: number): number {
  const n = posNum(name, raw, def);
  if (!Number.isInteger(n)) throw new Error(`coco: --${name} must be a positive integer`);
  return n;
}
import { goalStart } from './commands/goalStart.js';
import { goalRecord } from './commands/goalRecord.js';
import { goalStatus } from './commands/goalStatus.js';
import { goalClear } from './commands/goalClear.js';
import { goalOpStart, goalOpClear } from './commands/goalOp.js';
import { goalOracleUnavailable } from './commands/goalOracle.js';
import { parseOracleVerdict } from './oracleVerdict.js';
import { verifyStart, verifyResult } from './commands/verify.js';
import type { ReviewUnavailable } from './types.js';
import { mergeGoal } from './commands/merge.js';
import { goalHealth } from './commands/health.js';
import { guardHook, runGuard } from './commands/guard.js';
import { defaultPaths, installHooks, uninstallHooks } from './commands/installHooks.js';
import { cocoDone, cocoNext } from './commands/backlog.js';
import { auditReport } from './commands/audit.js';
import { readAudit } from './audit.js';
import { cleanDoctor, runDoctor } from './commands/doctor.js';
import { improveDigest } from './improve/digest.js';
import { improveCheck, improveCheckDiff } from './improve/protected.js';
import { notify } from './commands/notify.js';
import { runWatch } from './commands/watch.js';
import { installWatchdog, listWatchdogs, uninstallWatchdog } from './commands/watchdog.js';
import type { Phase, Verdict } from './types.js';

function out(obj: unknown): void {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const repo = gitTop(process.cwd());
  const [cmd, sub, ...rest] = argv;

  try {
    if (cmd === 'init') {
      initRepo(repo);
      out({ ok: true });
      return 0;
    }

    if (cmd === 'merge') {
      const { values } = parseArgs({ args: [sub, ...rest].filter(Boolean), options: { goal: { type: 'string' } }, allowPositionals: true });
      if (!values.goal) throw new Error('coco merge requires --goal');
      out(mergeGoal(repo, values.goal));
      return 0;
    }

    if (cmd === 'guard') {
      const { values } = parseArgs({
        args: [sub, ...rest].filter(Boolean),
        options: { command: { type: 'string' }, cwd: { type: 'string' } },
        allowPositionals: true,
      });
      const d = runGuard(values.cwd ?? repo, values.command ?? '');
      out(d);
      return d.block ? 1 : 0;
    }

    if (cmd === 'install-watchdog') {
      const { values } = parseArgs({
        args: [sub, ...rest].filter(Boolean),
        options: { repo: { type: 'string' }, 'interval-min': { type: 'string' }, 'stale-min': { type: 'string' } },
        allowPositionals: true,
      });
      out(
        installWatchdog({
          repo: values.repo ? gitTop(resolve(values.repo)) : repo,
          intervalMin: posInt('interval-min', values['interval-min'], 30),
          staleMin: posNum('stale-min', values['stale-min'], 30),
          cocoBin: resolve(process.argv[1] ?? ''),
        }),
      );
      return 0;
    }

    if (cmd === 'uninstall-watchdog') {
      const { values } = parseArgs({
        args: [sub, ...rest].filter(Boolean),
        options: { repo: { type: 'string' }, label: { type: 'string' } },
        allowPositionals: true,
      });
      out(uninstallWatchdog(values.label ? { label: values.label } : { repo: values.repo ? gitTop(resolve(values.repo)) : repo }));
      return 0;
    }

    if (cmd === 'list-watchdogs') {
      out(listWatchdogs());
      return 0;
    }

    if (cmd === 'install-hooks' || cmd === 'uninstall-hooks') {
      const home = process.env.HOME;
      if (!home) throw new Error('coco: HOME is not set');
      const cocoBin = resolve(process.argv[1] ?? '');
      const paths = defaultPaths(home, cocoBin);
      if (cmd === 'install-hooks') {
        installHooks(paths);
        out({ ok: true, action: 'install-hooks', scripts: [paths.codexScript, paths.claudeScript] });
      } else {
        uninstallHooks(paths);
        out({ ok: true, action: 'uninstall-hooks' });
      }
      return 0;
    }

    if (cmd === 'guard-hook') {
      let payload = '';
      try {
        payload = readFileSync(0, 'utf8');
      } catch {
        payload = '';
      }
      const deny = guardHook(payload);
      if (deny) process.stdout.write(`${deny}\n`);
      return 0;
    }

    if (cmd === 'next') {
      out(cocoNext(repo));
      return 0;
    }

    if (cmd === 'notify') {
      const { values } = parseArgs({
        args: [sub, ...rest].filter(Boolean),
        options: { title: { type: 'string' }, message: { type: 'string' } },
        allowPositionals: true,
      });
      out(notify(values.title ?? 'coco', values.message ?? ''));
      return 0;
    }

    if (cmd === 'watch') {
      const { values } = parseArgs({
        args: [sub, ...rest].filter(Boolean),
        options: { 'stale-min': { type: 'string' }, repo: { type: 'string' } },
        allowPositionals: true,
      });
      const target = values.repo ? gitTop(resolve(values.repo)) : repo;
      out(runWatch(target, { staleThresholdSec: posNum('stale-min', values['stale-min'], 30) * 60 }));
      return 0;
    }

    if (cmd === 'done') {
      const { values } = parseArgs({
        args: [sub, ...rest].filter(Boolean),
        options: { task: { type: 'string' } },
        allowPositionals: true,
      });
      if (!values.task) throw new Error('coco done requires --task <id>');
      out(cocoDone(repo, values.task));
      return 0;
    }

    if (cmd === 'health') {
      const { values } = parseArgs({
        args: [sub, ...rest].filter(Boolean),
        options: { goal: { type: 'string' }, active: { type: 'boolean' }, json: { type: 'boolean' } },
        allowPositionals: true,
      });
      out(goalHealth(repo, values.goal)); // --active is the default (active goal); output is always JSON
      return 0;
    }

    if (cmd === 'goal') {
      if (sub === 'start') {
        const { values } = parseArgs({
          args: rest,
          options: {
            objective: { type: 'string' },
            acceptance: { type: 'string' },
            'max-fix-rounds': { type: 'string' },
            'max-wall-min': { type: 'string' },
            'auto-merge': { type: 'boolean' },
          },
        });
        if (!values.objective) throw new Error('coco goal start requires --objective');
        out(
          goalStart(repo, {
            objective: values.objective,
            acceptanceChecks: values.acceptance ? values.acceptance.split(';').map((s) => s.trim()).filter(Boolean) : [],
            maxFixRounds: values['max-fix-rounds'] ? Number(values['max-fix-rounds']) : 5,
            autoMergeAllowed: values['auto-merge'] === true ? true : undefined,
            budget: values['max-wall-min'] ? { maxWallClockMin: Number(values['max-wall-min']) } : undefined,
          }),
        );
        return 0;
      }

      if (sub === 'record') {
        const { values } = parseArgs({
          args: rest,
          options: {
            goal: { type: 'string' },
            phase: { type: 'string' },
            'expected-sha': { type: 'string' },
            'review-output': { type: 'string' },
            evidence: { type: 'string' },
          },
        });
        if (!values.goal || !values.phase || !values['expected-sha']) {
          throw new Error('coco goal record requires --goal --phase --expected-sha');
        }
        if (values.phase === 'verify') {
          throw new Error('coco: verify is coco-owned — use `coco goal verify`, not `goal record --phase verify`');
        }
        // A review verdict may ONLY come from Oracle's raw text, run through the strict fail-closed
        // parser — same as the MCP path. There is deliberately no caller-asserted --verdict flag
        // (that was a false-green backdoor: `--phase review --verdict clean` with no Oracle).
        let verdict: Verdict | undefined;
        if (values.phase === 'review') {
          verdict = parseOracleVerdict(values['review-output'] ?? '') ?? undefined;
          if (!verdict) {
            throw new Error('coco: review requires --review-output ending in a line "VERDICT: clean" or "VERDICT: blocking"');
          }
        } else if (values['review-output'] !== undefined) {
          throw new Error(`coco: ${values.phase} takes no --review-output (review-only)`);
        }
        out(
          goalRecord(repo, {
            goal: values.goal,
            phase: values.phase as Phase,
            expectedSha: values['expected-sha'],
            verdict,
            evidence: values.evidence,
          }),
        );
        return 0;
      }

      if (sub === 'status') {
        const { values } = parseArgs({ args: rest, options: { goal: { type: 'string' } } });
        out(goalStatus(repo, values.goal));
        return 0;
      }

      if (sub === 'clear') {
        const { values } = parseArgs({ args: rest, options: { goal: { type: 'string' } } });
        if (!values.goal) throw new Error('coco goal clear requires --goal');
        goalClear(repo, values.goal);
        out({ ok: true });
        return 0;
      }

      if (sub === 'op-start') {
        const { values } = parseArgs({ args: rest, options: { goal: { type: 'string' }, phase: { type: 'string' }, kind: { type: 'string' } } });
        if (!values.goal || !values.phase || !values.kind) throw new Error('coco goal op-start requires --goal --phase --kind');
        out(goalOpStart(repo, { goal: values.goal, phase: values.phase as Phase, kind: values.kind as 'oracle' | 'test' }));
        return 0;
      }

      if (sub === 'op-clear') {
        const { values } = parseArgs({ args: rest, options: { goal: { type: 'string' } } });
        if (!values.goal) throw new Error('coco goal op-clear requires --goal');
        goalOpClear(repo, { goal: values.goal });
        out({ ok: true });
        return 0;
      }

      if (sub === 'verify') {
        const { values } = parseArgs({ args: rest, options: { goal: { type: 'string' }, 'expected-sha': { type: 'string' } } });
        if (!values.goal || !values['expected-sha']) throw new Error('coco goal verify requires --goal --expected-sha');
        const started = verifyStart(repo, { goal: values.goal, expectedSha: values['expected-sha'] });
        const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
        for (;;) {
          const r = verifyResult(repo, { goal: values.goal, runId: started.runId });
          if (r.status !== 'running') {
            out(r);
            return 0;
          }
          sleep(150);
        }
      }

      if (sub === 'oracle-unavailable') {
        const { values } = parseArgs({
          args: rest,
          options: { goal: { type: 'string' }, phase: { type: 'string' }, reason: { type: 'string' }, attempts: { type: 'string' }, evidence: { type: 'string' } },
        });
        if (!values.goal || !values.phase || !values.reason) throw new Error('coco goal oracle-unavailable requires --goal --phase --reason');
        out(
          goalOracleUnavailable(repo, {
            goal: values.goal,
            phase: values.phase as ReviewUnavailable['phase'],
            reason: values.reason as ReviewUnavailable['reason'],
            attempts: values.attempts ? Number(values.attempts) : undefined,
            evidence: values.evidence,
          }),
        );
        return 0;
      }
    }

    if (cmd === 'doctor') {
      if (sub === undefined || sub === 'report') {
        out(runDoctor(repo));
        return 0;
      }
      if (sub === 'clean') {
        const { values } = parseArgs({ args: rest, options: { apply: { type: 'boolean' } } });
        out(cleanDoctor(repo, { apply: values.apply === true }));
        return 0;
      }
      // fall through to the unknown-command error for a typo'd subcommand
    }

    if (cmd === 'improve') {
      // coco-improve slice 1: deterministic, code-owned. `digest` reads the audit corpus; `check`
      // is the protected-path guard (referee/metrics/self off-limits). Propose-only skill comes later.
      if (sub === 'digest') {
        out(improveDigest(repo));
        return 0;
      }
      if (sub === 'check') {
        const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { diff: { type: 'boolean' }, base: { type: 'string' } } });
        if (!values.diff && !positionals.length) throw new Error('usage: coco improve check <path...>  |  coco improve check --diff [--base <ref>]');
        const res = values.diff ? improveCheckDiff(repo, values.base) : improveCheck(repo, positionals);
        out(res);
        return res.ok ? 0 : 3; // non-zero when a protected path is targeted — gates CI/scripts
      }
      // fall through to the unknown-command error for a typo'd subcommand
    }

    if (cmd === 'audit') {
      // coco-audit capture is automatic (domain-layer chokepoint); these are the human read surfaces.
      if (sub === 'list') {
        const { values } = parseArgs({ args: rest, options: { goal: { type: 'string' } } });
        const recs = readAudit(repo);
        out(values.goal ? recs.filter((r) => r.goalId === values.goal) : recs);
        return 0;
      }
      if (sub === undefined || sub === 'report') {
        out(auditReport(repo));
        return 0;
      }
      // fall through to the unknown-command error rather than silently reporting on a typo'd subcommand
    }

    process.stderr.write(`coco: unknown command '${[cmd, sub].filter(Boolean).join(' ')}'\n`);
    return 2;
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return 1;
  }
}
