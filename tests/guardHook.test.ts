import { expect, test } from 'vitest';
import { guardHook, runGuard } from '../src/commands/guard.js';
import { initRepo } from '../src/commands/init.js';
import { goalStart } from '../src/commands/goalStart.js';
import { goalClear } from '../src/commands/goalClear.js';
import { tmpRepo } from './helpers.js';

test('runGuard blocks a raw merge only while a goal is active', () => {
  const repo = tmpRepo();
  initRepo(repo);
  expect(runGuard(repo, 'git merge feature').block).toBe(false); // no goal yet

  const id = goalStart(repo, { objective: 'x', maxFixRounds: 3, acceptanceChecks: [] }).goalId;
  expect(runGuard(repo, 'git merge feature').block).toBe(true);
  expect(runGuard(repo, 'git commit -m x').block).toBe(false);
  expect(runGuard(repo, 'coco merge --goal ' + id).block).toBe(false);

  goalClear(repo, id);
  expect(runGuard(repo, 'git merge feature').block).toBe(false); // goal cancelled → allowed again
});

test('runGuard is a no-op outside a git repo', () => {
  expect(runGuard('/tmp', 'git merge feature').block).toBe(false);
});

test('runGuard follows `git -C <repo>` and `cd <repo> &&` to the active repo', () => {
  const active = tmpRepo();
  initRepo(active);
  goalStart(active, { objective: 'x', maxFixRounds: 3, acceptanceChecks: [] });
  const elsewhere = tmpRepo(); // a different repo, no goal, as the payload cwd

  expect(runGuard(elsewhere, `git -C ${active} merge feature`).block).toBe(true);
  expect(runGuard(elsewhere, `cd ${active} && git merge feature`).block).toBe(true);
  expect(runGuard(elsewhere, `git merge feature`).block).toBe(false); // targets `elsewhere` (no goal)
});

test('guardHook emits deny JSON for a blocked op with an active goal', () => {
  const repo = tmpRepo();
  initRepo(repo);
  goalStart(repo, { objective: 'x', maxFixRounds: 3, acceptanceChecks: [] });
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git merge coco/x' }, cwd: repo });
  const out = guardHook(payload);
  const parsed = JSON.parse(out);
  expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
  expect(parsed.hookSpecificOutput.permissionDecisionReason).toMatch(/coco merge --goal/);
});

test('guardHook allows (empty) for a safe command', () => {
  const repo = tmpRepo();
  initRepo(repo);
  goalStart(repo, { objective: 'x', maxFixRounds: 3, acceptanceChecks: [] });
  expect(guardHook(JSON.stringify({ tool_input: { command: 'git status' }, cwd: repo }))).toBe('');
});

test('runGuard does not false-positive on a git op inside a quoted arg', () => {
  const repo = tmpRepo();
  initRepo(repo);
  goalStart(repo, { objective: 'x', maxFixRounds: 3, acceptanceChecks: [] });
  expect(runGuard(repo, 'git commit -m "a; git push origin main"').block).toBe(false);
  expect(runGuard(repo, 'echo "cd /x && git merge y"').block).toBe(false);
});

test('guardHook fails OPEN on a malformed payload (never breaks the agent)', () => {
  expect(guardHook('not json')).toBe('');
  expect(guardHook('{}')).toBe('');
  expect(guardHook(JSON.stringify({ tool_input: {} }))).toBe('');
});
