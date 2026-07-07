import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { cleanDoctor, runDoctor } from '../src/commands/doctor.js';
import { goalStart } from '../src/commands/goalStart.js';
import { initRepo } from '../src/commands/init.js';
import { isGuardInstalled } from '../src/commands/installHooks.js';
import { goalsDir } from '../src/paths.js';
import { g, tmpRepo } from './helpers.js';

function initedRepo(): string {
  const repo = tmpRepo();
  initRepo(repo);
  g(repo, ['add', '-A']);
  g(repo, ['commit', '--allow-empty', '-m', 'coco init']);
  return repo;
}
// An EMPTY home so the wiring checks read no real ~/.codex/~/.claude config.
const emptyHome = (): string => mkdtempSync(join(tmpdir(), 'coco-home-'));

function mkRun(repo: string, runId: string, goalId?: string): string {
  const dir = join(repo, '.coco', 'verify-runs', runId);
  mkdirSync(dir, { recursive: true });
  if (goalId) writeFileSync(join(dir, 'meta.json'), JSON.stringify({ runId, goalId }));
  writeFileSync(join(dir, 'out.log'), 'output\n');
  return dir;
}

test('runDoctor produces a grouped report with a consistent summary', () => {
  const repo = initedRepo();
  const rep = runDoctor(repo, { home: emptyHome() });

  const names = rep.checks.map((c) => c.name);
  expect(names).toEqual(expect.arrayContaining(['node', 'git', 'git repo', 'coco initialized', 'verify.testCommand', 'oracle MCP', 'active goal']));
  expect(rep.summary.ok + rep.summary.warn + rep.summary.fail).toBe(rep.checks.length); // every check tallied

  const by = (n: string) => rep.checks.find((c) => c.name === n)!;
  expect(by('node').status).toBe('ok');
  expect(by('git repo').status).toBe('ok');
  expect(by('coco initialized').status).toBe('ok');
  expect(by('active goal').detail).toBe('no active goal'); // fresh init, none active
  expect(by('oracle MCP').status).toBe('warn'); // empty home → not registered
});

test('verify.testCommand check: warn when unset, ok when configured', () => {
  const repo = initedRepo();
  expect(runDoctor(repo, { home: emptyHome() }).checks.find((c) => c.name === 'verify.testCommand')!.status).toBe('warn');

  writeFileSync(join(repo, 'coco.config.json'), JSON.stringify({ verify: { testCommand: 'pnpm test' } }));
  const c = runDoctor(repo, { home: emptyHome() }).checks.find((x) => x.name === 'verify.testCommand')!;
  expect(c.status).toBe('ok');
  expect(c.detail).toBe('pnpm test');
});

test('cleanDoctor: reclaims terminal + orphaned runs only; preserves active/blocked/unreadable; never touches goals/audit', () => {
  const repo = initedRepo();
  const { goalId } = goalStart(repo, { objective: 'doctor clean', maxFixRounds: 5, acceptanceChecks: [] });
  // sibling goal files in terminal + blocked lifecycle states
  writeFileSync(join(goalsDir(repo), 'goal-term.json'), JSON.stringify({ id: 'goal-term', state: 'achieved', events: [] }));
  writeFileSync(join(goalsDir(repo), 'goal-block.json'), JSON.stringify({ id: 'goal-block', state: 'blocked', events: [] }));

  const activeRun = mkRun(repo, 'run-active', goalId); // active → preserve
  const blockedRun = mkRun(repo, 'run-blocked', 'goal-block'); // blocked/resumable → preserve
  const terminalRun = mkRun(repo, 'run-terminal', 'goal-term'); // achieved → reclaim
  const orphanRun = mkRun(repo, 'run-orphan', 'goal-gone'); // no such goal → reclaim
  const noMetaRun = mkRun(repo, 'run-nometa'); // unreadable meta → preserve (unattributable)

  const dry = cleanDoctor(repo);
  expect(dry.applied).toBe(false);
  expect(dry.reclaimedBytes).toBe(0);
  expect(dry.targets.map((t) => t.path).sort()).toEqual([orphanRun, terminalRun].sort());
  expect(existsSync(terminalRun)).toBe(true); // dry-run deletes nothing

  cleanDoctor(repo, { apply: true });
  expect(existsSync(terminalRun)).toBe(false);
  expect(existsSync(orphanRun)).toBe(false);
  expect(existsSync(activeRun)).toBe(true);
  expect(existsSync(blockedRun)).toBe(true);
  expect(existsSync(noMetaRun)).toBe(true);
  // never touches the goal ledger or the audit log
  expect(readdirSync(goalsDir(repo)).length).toBeGreaterThan(0);
  expect(existsSync(join(repo, '.coco', 'audit.ndjson'))).toBe(true);
});

test('doctor MCP probe ignores commented-out config.toml blocks', () => {
  const repo = initedRepo();
  const home = mkdtempSync(join(tmpdir(), 'coco-home-'));
  mkdirSync(join(home, '.codex'), { recursive: true });
  writeFileSync(join(home, '.codex', 'config.toml'), '# [mcp_servers.oracle]\n# enabled = true\n');
  expect(runDoctor(repo, { home }).checks.find((c) => c.name === 'oracle MCP')!.status).toBe('warn');
});

test('isGuardInstalled is fail-closed on malformed or missing config', () => {
  const dir = mkdtempSync(join(tmpdir(), 'coco-hooks-'));
  writeFileSync(join(dir, 'settings.json'), '{ not valid json');
  expect(isGuardInstalled(join(dir, 'settings.json'))).toBe(false);
  expect(isGuardInstalled(join(dir, 'missing.json'))).toBe(false);
});
