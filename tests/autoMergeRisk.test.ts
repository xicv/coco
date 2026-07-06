import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test } from 'vitest';
import { assessAutoMergeRisk } from '../src/autoMergeRisk.js';
import { g, tmpRepo } from './helpers.js';

/** Create branch `name` off main and commit the given files (paths → contents). */
function branchWith(repo: string, name: string, files: Record<string, string>): void {
  g(repo, ['checkout', '-b', name, 'main']);
  for (const [f, content] of Object.entries(files)) {
    const abs = join(repo, f);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  g(repo, ['add', '-A']);
  g(repo, ['commit', '-m', 'work']);
}

const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n') + '\n';

test('clean small diff with a test file is allowed', () => {
  const repo = tmpRepo();
  branchWith(repo, 'b', { 'src/feature.ts': 'export const x = 1;\n', 'tests/feature.test.ts': 'test.skip("x", () => {});\n' });
  const r = assessAutoMergeRisk(repo, 'main', 'b');
  expect(r.allowed).toBe(true);
  expect(r.hasTests).toBe(true);
  expect(r.sensitiveHits).toEqual([]);
});

test('sensitive path (auth) blocks even with tests present', () => {
  const repo = tmpRepo();
  branchWith(repo, 'b', { 'src/auth/login.ts': 'export const login = 1;\n', 'tests/login.test.ts': 'test.skip("x",()=>{});\n' });
  const r = assessAutoMergeRisk(repo, 'main', 'b');
  expect(r.allowed).toBe(false);
  expect(r.reason).toMatch(/sensitive/);
  expect(r.sensitiveHits).toContain('src/auth/login.ts');
});

test('editing coco.config.json blocks auto-merge (policy self-tamper guard)', () => {
  const repo = tmpRepo();
  branchWith(repo, 'b', {
    'coco.config.json': JSON.stringify({ autoMerge: { maxChangedLines: 999999, sensitiveGlobs: [] } }),
    'tests/x.test.ts': 'test.skip("x",()=>{});\n',
  });
  const r = assessAutoMergeRisk(repo, 'main', 'b');
  expect(r.allowed).toBe(false);
  expect(r.reason).toMatch(/sensitive/);
  expect(r.sensitiveHits).toContain('coco.config.json');
});

test('oversized diff (> default 500 lines) is blocked', () => {
  const repo = tmpRepo();
  branchWith(repo, 'b', { 'src/big.ts': lines(600), 'tests/big.test.ts': 'test.skip("x",()=>{});\n' });
  const r = assessAutoMergeRisk(repo, 'main', 'b');
  expect(r.allowed).toBe(false);
  expect(r.reason).toMatch(/too large/);
  expect(r.changedLines).toBeGreaterThan(500);
});

test('a diff with no test files is blocked', () => {
  const repo = tmpRepo();
  branchWith(repo, 'b', { 'src/feature.ts': 'export const x = 1;\n' });
  const r = assessAutoMergeRisk(repo, 'main', 'b');
  expect(r.allowed).toBe(false);
  expect(r.reason).toMatch(/no test files/);
  expect(r.hasTests).toBe(false);
});

test('policy is read from the BASE ref, not HEAD (custom base limit applies)', () => {
  const repo = tmpRepo();
  // Commit a strict policy onto main FIRST so it lives at the base ref.
  writeFileSync(join(repo, 'coco.config.json'), JSON.stringify({ autoMerge: { maxChangedLines: 50 } }));
  g(repo, ['add', '-A']);
  g(repo, ['commit', '-m', 'strict policy']);
  // A 60-line change (no config edit, has tests, nothing sensitive) must be blocked by the base's 50-line cap.
  branchWith(repo, 'b', { 'src/mid.ts': lines(60), 'tests/mid.test.ts': 'test.skip("x",()=>{});\n' });
  const r = assessAutoMergeRisk(repo, 'main', 'b');
  expect(r.allowed).toBe(false);
  expect(r.reason).toMatch(/too large/);
});

test('empty diff is blocked', () => {
  const repo = tmpRepo();
  g(repo, ['checkout', '-b', 'b', 'main']); // no commits → identical to base
  const r = assessAutoMergeRisk(repo, 'main', 'b');
  expect(r.allowed).toBe(false);
  expect(r.reason).toMatch(/empty diff/);
});

test('explicit policy param overrides base config (used by callers/tests)', () => {
  const repo = tmpRepo();
  branchWith(repo, 'b', { 'docs/guide.md': lines(3), 'tests/x.test.ts': 'test.skip("x",()=>{});\n' });
  const strict = { maxChangedLines: 500, sensitiveGlobs: ['docs/**'], testGlobs: ['**/*.test.*'] };
  const r = assessAutoMergeRisk(repo, 'main', 'b', strict);
  expect(r.allowed).toBe(false);
  expect(r.sensitiveHits).toContain('docs/guide.md');
});
