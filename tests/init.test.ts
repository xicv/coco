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

test('init scaffolds a committed, parseable coco.config.json with a fill-me-in testCommand', () => {
  const dir = emptyDir();
  initRepo(dir);
  const p = join(dir, 'coco.config.json');
  expect(existsSync(p)).toBe(true);
  // committed (tracked), not just written to the working tree
  expect(execFileSync('git', ['ls-files', 'coco.config.json'], { cwd: dir, encoding: 'utf8' }).trim()).toBe('coco.config.json');
  const cfg = JSON.parse(readFileSync(p, 'utf8')) as { verify: { testCommand: string; timeoutSec: number } };
  expect(cfg.verify.testCommand).toBe(''); // placeholder — surfaced as a non-blocking warning until set
  expect(typeof cfg.verify.timeoutSec).toBe('number');
  // init leaves a clean tree (a dirty tree would make goalStart return commit-or-revert)
  expect(execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }).trim()).toBe('');
});

test('init never overwrites an existing coco.config.json', () => {
  const dir = emptyDir();
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
  const custom = `${JSON.stringify({ verify: { testCommand: 'my-project-tests' } }, null, 2)}\n`;
  writeFileSync(join(dir, 'coco.config.json'), custom);
  execFileSync('git', ['add', 'coco.config.json'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'seed config'], { cwd: dir });
  initRepo(dir);
  expect(readFileSync(join(dir, 'coco.config.json'), 'utf8')).toBe(custom); // untouched
  expect(execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }).trim()).toBe('');
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

test('init refuses BEFORE scaffolding — no coco.config.json/.gitignore leak on the staged path', () => {
  // Existing repo with HEAD and .coco/ already ignored (needsIgnore=false), no coco.config.json,
  // plus an unrelated staged change. init must refuse WITHOUT leaving a scaffolded file untracked.
  const dir = emptyDir();
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
  writeFileSync(join(dir, '.gitignore'), '.coco/\n');
  execFileSync('git', ['add', '.gitignore'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'seed'], { cwd: dir });
  writeFileSync(join(dir, 'other.txt'), 'x\n');
  execFileSync('git', ['add', 'other.txt'], { cwd: dir });

  expect(() => initRepo(dir)).toThrow(/staged changes/);
  // no scaffolded config was leaked to the working tree
  expect(existsSync(join(dir, 'coco.config.json'))).toBe(false);
  // the tree holds ONLY the user's own staged change — nothing coco wrote
  expect(execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }).trim()).toBe('A  other.txt');
});
