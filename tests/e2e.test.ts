import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

// Resolve the project-local tsx + entry by ABSOLUTE path so they work even
// though we run with cwd = a temp repo outside the coco project.
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsxBin = join(projectRoot, 'node_modules', '.bin', 'tsx');
const entry = join(projectRoot, 'src', 'bin', 'coco.ts');

function coco(repo: string, args: string[]): string {
  return execFileSync(tsxBin, [entry, ...args], { cwd: repo, encoding: 'utf8' }).trim();
}
function gitc(repo: string, args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: repo, encoding: 'utf8' }).trim();
}
function head(repo: string): string {
  return gitc(repo, ['rev-parse', 'HEAD']);
}

test('end-to-end happy path via the CLI reaches merge-gate then merges', { timeout: 30000 }, () => {
  const repo = mkdtempSync(join(tmpdir(), 'coco-e2e-'));
  coco(repo, ['init']);
  const id = JSON.parse(coco(repo, ['goal', 'start', '--objective', 'e2e feature'])).goalId;

  coco(repo, ['goal', 'record', '--goal', id, '--phase', 'plan', '--expected-sha', head(repo)]);

  // a real change + the tracked verify config so coco runs the tests itself (exit 0 → pass)
  writeFileSync(join(repo, 'f.txt'), 'feature\n');
  writeFileSync(join(repo, 'coco.config.json'), `${JSON.stringify({ verify: { testCommand: 'true' } })}\n`);
  gitc(repo, ['add', 'f.txt', 'coco.config.json']);
  gitc(repo, ['commit', '-m', 'impl']);

  coco(repo, ['goal', 'record', '--goal', id, '--phase', 'implement', '--expected-sha', head(repo)]);
  // review verdict comes from Oracle's raw text via the strict parser — no caller-asserted --verdict
  coco(repo, ['goal', 'record', '--goal', id, '--phase', 'review', '--review-output', 'Looks good.\nVERDICT: clean', '--expected-sha', head(repo)]);
  // coco-owned verify: coco runs the configured testCommand and derives pass|fail from the exit code
  const vr = JSON.parse(coco(repo, ['goal', 'verify', '--goal', id, '--expected-sha', head(repo)]));
  expect(vr.status).toBe('done');
  expect(vr.verdict).toBe('pass');

  expect(JSON.parse(coco(repo, ['goal', 'status', '--goal', id])).nextAction).toBe('merge-gate');
  expect(JSON.parse(coco(repo, ['health', '--goal', id])).verdict).toBe('needs-human');
  // spec §5.4 shape: `coco health --active --json`
  expect(JSON.parse(coco(repo, ['health', '--active', '--json'])).verdict).toBe('needs-human');
  expect(JSON.parse(coco(repo, ['merge', '--goal', id])).merged).toBe(true);
});

test('CLI review goes through the strict Oracle parser — no --verdict false-green backdoor', () => {
  const repo = mkdtempSync(join(tmpdir(), 'coco-e2e-'));
  coco(repo, ['init']);
  const id = JSON.parse(coco(repo, ['goal', 'start', '--objective', 'guard'])).goalId;
  coco(repo, ['goal', 'record', '--goal', id, '--phase', 'plan', '--expected-sha', head(repo)]);
  writeFileSync(join(repo, 'f.txt'), 'x\n');
  gitc(repo, ['add', 'f.txt']);
  gitc(repo, ['commit', '-m', 'impl']);
  coco(repo, ['goal', 'record', '--goal', id, '--phase', 'implement', '--expected-sha', head(repo)]);

  // the old backdoor is gone: --verdict is no longer an accepted option for review
  expect(() => coco(repo, ['goal', 'record', '--goal', id, '--phase', 'review', '--verdict', 'clean', '--expected-sha', head(repo)])).toThrow();
  // review-output without a real VERDICT line fails closed
  expect(() => coco(repo, ['goal', 'record', '--goal', id, '--phase', 'review', '--review-output', 'looks fine to me', '--expected-sha', head(repo)])).toThrow();
  // nothing recorded → still at review
  expect(JSON.parse(coco(repo, ['goal', 'status', '--goal', id])).nextAction).toBe('review');
});
