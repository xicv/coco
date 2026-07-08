import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { initRepo } from '../src/commands/init.js';
import { goalStart } from '../src/commands/goalStart.js';
import { upsertCard } from '../src/store/manifest.js';
import { appendBacklogTask } from '../src/store/backlogPromote.js';
import { storePack } from '../src/store/commands.js';
import { makeCardId, parseCard } from '../src/store/schema.js';
import { tmpRepo } from './helpers.js';

const storeSrcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'store');

function tsFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...tsFilesRecursive(p));
    else if (e.endsWith('.ts')) out.push(p);
  }
  return out;
}

test('coco-store source files contain no NUL/control bytes (encoding guard)', () => {
  for (const f of tsFilesRecursive(storeSrcDir)) {
    // eslint-disable-next-line no-control-regex
    expect(/\u0000/.test(readFileSync(f, 'utf8')), `${f} contains a NUL byte`).toBe(false);
  }
});

test('coco-store code (all of src/store/**) never imports the referee: goal / merge / state', () => {
  const forbidden =
    /(from|import)\s*\(?\s*['"][^'"]*\/(state|gate|epoch|lock)(\.js)?['"]|(from|import)\s*\(?\s*['"][^'"]*\/commands\/(goalRecord|goalStart|goalStatus|goalClear|goalOp|goalOracle|merge|verify|health)(\.js)?['"]/;
  const files = tsFilesRecursive(storeSrcDir);
  expect(files.length).toBeGreaterThan(0);
  for (const f of files) {
    expect(readFileSync(f, 'utf8'), `${f} must not import referee/goal/merge/state (static or dynamic)`).not.toMatch(forbidden);
  }
});

function snapshotGoals(repo: string): Record<string, string> {
  const dir = join(repo, '.coco', 'goals');
  const snap: Record<string, string> = {};
  if (!existsSync(dir)) return snap;
  for (const f of readdirSync(dir)) snap[f] = readFileSync(join(dir, f), 'utf8');
  return snap;
}

test('store operations — incl. pack — never touch .coco/goals (one-way boundary, snapshot)', () => {
  const repo = tmpRepo();
  initRepo(repo);
  goalStart(repo, { objective: 'x', maxFixRounds: 3, acceptanceChecks: [] });
  const before = snapshotGoals(repo);
  upsertCard(repo, parseCard({ id: makeCardId('T', 'b'), type: 'doc', title: 'T', body: 'b', timestamp: '2026-01-01T00:00:00Z' }));
  appendBacklogTask(repo, { id: 'task-x', title: 'X' });
  storePack(repo, { goalId: 'g1' });
  expect(snapshotGoals(repo)).toEqual(before);
});

test('pack refuses a path-traversal goalId — cannot escape .coco/store/briefs into .coco/goals', () => {
  const repo = tmpRepo();
  initRepo(repo);
  goalStart(repo, { objective: 'x', maxFixRounds: 3, acceptanceChecks: [] });
  const before = snapshotGoals(repo);
  expect(() => storePack(repo, { goalId: '../../.coco/goals/g1' })).toThrow(/invalid goalId/);
  expect(() => storePack(repo, { goalId: '../../BACKLOG' })).toThrow(/invalid goalId/);
  expect(snapshotGoals(repo)).toEqual(before); // nothing written under goals
});
