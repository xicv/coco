import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { initRepo } from '../src/commands/init.js';

function emptyDir(): string {
  return mkdtempSync(join(tmpdir(), 'coco-init-'));
}
function head(repo: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
}

test('init bootstraps a git repo on main with a commit and .coco', () => {
  const dir = emptyDir();
  initRepo(dir);
  expect(existsSync(join(dir, '.git'))).toBe(true);
  expect(execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()).toBe('main');
  expect(existsSync(join(dir, '.coco', 'goals'))).toBe(true);
  expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('.coco/');
  expect(head(dir)).toMatch(/^[0-9a-f]{7,}/);
});

test('init is idempotent', () => {
  const dir = emptyDir();
  initRepo(dir);
  const h = head(dir);
  initRepo(dir);
  expect(head(dir)).toBe(h);
});

test('init refuses to sweep pre-existing staged changes into its commit', () => {
  const dir = emptyDir();
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
  writeFileSync(join(dir, 'secret.txt'), 'sekret\n');
  execFileSync('git', ['add', 'secret.txt'], { cwd: dir });
  expect(() => initRepo(dir)).toThrow(/staged changes/);
  // the pre-staged file was NOT committed — it is still only in the index
  const stillStaged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: dir, encoding: 'utf8' }).trim();
  expect(stillStaged).toContain('secret.txt');
});
