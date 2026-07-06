import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Run git with a fixed identity so temp repos work on any machine/CI. */
export function g(repo: string, args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
}

/** Create a temp repo on `main` with one seed commit. Returns its path. */
export function tmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'coco-'));
  g(dir, ['init', '-b', 'main']);
  writeFileSync(join(dir, 'seed.txt'), 'seed\n');
  g(dir, ['add', 'seed.txt']);
  g(dir, ['commit', '-m', 'seed']);
  return dir;
}

/** Write a file, stage, commit. Returns the new HEAD sha. */
export function commit(repo: string, file: string, content: string, msg: string): string {
  writeFileSync(join(repo, file), content);
  g(repo, ['add', file]);
  g(repo, ['commit', '-m', msg]);
  return g(repo, ['rev-parse', 'HEAD']);
}
