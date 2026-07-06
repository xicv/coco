import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { initRepo } from '../src/commands/init.js';
import { goalStart } from '../src/commands/goalStart.js';
import { goalRecord } from '../src/commands/goalRecord.js';
import { goalOracleUnavailable } from '../src/commands/goalOracle.js';
import { headSha } from '../src/git.js';
import { goalPath, readGoal } from '../src/state.js';
import { commit, g, tmpRepo } from './helpers.js';

function startGoal(repo: string) {
  initRepo(repo);
  return goalStart(repo, { objective: 'feat x', maxFixRounds: 3, acceptanceChecks: [] }).goalId;
}

test('record refuses when HEAD != expected-sha', () => {
  const repo = tmpRepo();
  const id = startGoal(repo);
  expect(() => goalRecord(repo, { goal: id, phase: 'plan', expectedSha: 'deadbeef' })).toThrow(/HEAD/);
});

test('record refuses review before an implement in the epoch', () => {
  const repo = tmpRepo();
  const id = startGoal(repo);
  commit(repo, 'a.txt', '1', 'work');
  expect(() =>
    goalRecord(repo, { goal: id, phase: 'review', verdict: 'clean', expectedSha: headSha(repo) }),
  ).toThrow(/implement/);
});

test('record refuses verify before a clean review', () => {
  const repo = tmpRepo();
  const id = startGoal(repo);
  commit(repo, 'a.txt', '1', 'work');
  goalRecord(repo, { goal: id, phase: 'implement', expectedSha: headSha(repo) });
  expect(() =>
    goalRecord(repo, { goal: id, phase: 'verify', verdict: 'pass', expectedSha: headSha(repo) }),
  ).toThrow(/clean review/);
});

test('record refuses a review with a verify verdict', () => {
  const repo = tmpRepo();
  const id = startGoal(repo);
  commit(repo, 'a.txt', '1', 'work');
  goalRecord(repo, { goal: id, phase: 'implement', expectedSha: headSha(repo) });
  expect(() =>
    goalRecord(repo, { goal: id, phase: 'review', verdict: 'pass', expectedSha: headSha(repo) }),
  ).toThrow(/verdict/);
});

test('record refuses review/verify on a dirty tree', () => {
  const repo = tmpRepo();
  const id = startGoal(repo);
  commit(repo, 'a.txt', '1', 'work');
  goalRecord(repo, { goal: id, phase: 'implement', expectedSha: headSha(repo) });
  writeFileSync(join(repo, 'dirty.txt'), 'x');
  expect(() =>
    goalRecord(repo, { goal: id, phase: 'review', verdict: 'clean', expectedSha: headSha(repo) }),
  ).toThrow(/clean tree|dirty/);
});

test('record appends an event bound to current commit + tree', () => {
  const repo = tmpRepo();
  const id = startGoal(repo);
  commit(repo, 'a.txt', '1', 'work');
  goalRecord(repo, { goal: id, phase: 'implement', expectedSha: headSha(repo), evidence: '3 passing' });
  const goal = readGoal(goalPath(repo, id));
  expect(goal.events.at(-1)).toMatchObject({ phase: 'implement', evidence: '3 passing' });
  expect(goal.events.at(-1)!.tree).toMatch(/^[0-9a-f]{7,}/);
});

test('record refuses when not on the goal branch', () => {
  const repo = tmpRepo();
  const id = startGoal(repo);
  g(repo, ['checkout', 'main']);
  expect(() => goalRecord(repo, { goal: id, phase: 'plan', expectedSha: headSha(repo) })).toThrow(/branch/);
});

test('record refuses upgrading a blocking review to clean at the same tree', () => {
  const repo = tmpRepo();
  const id = startGoal(repo);
  commit(repo, 'a.txt', '1', 'work');
  goalRecord(repo, { goal: id, phase: 'implement', expectedSha: headSha(repo) });
  goalRecord(repo, { goal: id, phase: 'review', verdict: 'blocking', expectedSha: headSha(repo) });
  expect(() =>
    goalRecord(repo, { goal: id, phase: 'review', verdict: 'clean', expectedSha: headSha(repo) }),
  ).toThrow(/upgrade a blocking review/);
});

test('record refuses upgrading a failing verify to pass at the same tree', () => {
  const repo = tmpRepo();
  const id = startGoal(repo);
  commit(repo, 'a.txt', '1', 'work');
  goalRecord(repo, { goal: id, phase: 'implement', expectedSha: headSha(repo) });
  goalRecord(repo, { goal: id, phase: 'review', verdict: 'clean', expectedSha: headSha(repo) });
  goalRecord(repo, { goal: id, phase: 'verify', verdict: 'fail', expectedSha: headSha(repo) });
  expect(() =>
    goalRecord(repo, { goal: id, phase: 'verify', verdict: 'pass', expectedSha: headSha(repo) }),
  ).toThrow(/upgrade a failing verify/);
});

test('record rejects a no-op implement (tree identical to the branch base)', () => {
  const repo = tmpRepo();
  const id = startGoal(repo);
  goalRecord(repo, { goal: id, phase: 'plan', expectedSha: headSha(repo) });
  // no commit → HEAD tree still equals the base tree → a no-op implement
  expect(() => goalRecord(repo, { goal: id, phase: 'implement', expectedSha: headSha(repo) })).toThrow(/no-op implement|identical to the branch base/);
});

test('reviewUnavailable survives a non-Oracle (implement) record; an Oracle-phase record clears it', () => {
  const repo = tmpRepo();
  const id = startGoal(repo);
  goalRecord(repo, { goal: id, phase: 'plan', expectedSha: headSha(repo) });
  commit(repo, 'a.txt', '1', 'w1');
  goalRecord(repo, { goal: id, phase: 'implement', expectedSha: headSha(repo) });
  goalOracleUnavailable(repo, { goal: id, phase: 'review', reason: 'oracle-timeout', attempts: 1 });
  // a further implement (real new tree) must NOT silently un-pause the loop
  commit(repo, 'a.txt', '2', 'w2');
  goalRecord(repo, { goal: id, phase: 'implement', expectedSha: headSha(repo) });
  expect(readGoal(goalPath(repo, id)).reviewUnavailable).toBeDefined();
  // a clean review (Oracle came back) clears it
  goalRecord(repo, { goal: id, phase: 'review', verdict: 'clean', expectedSha: headSha(repo) });
  expect(readGoal(goalPath(repo, id)).reviewUnavailable).toBeUndefined();
});

test('a WORSE verdict may still override at the same tree (safety downgrade)', () => {
  const repo = tmpRepo();
  const id = startGoal(repo);
  commit(repo, 'a.txt', '1', 'work');
  goalRecord(repo, { goal: id, phase: 'implement', expectedSha: headSha(repo) });
  goalRecord(repo, { goal: id, phase: 'review', verdict: 'clean', expectedSha: headSha(repo) });
  expect(() =>
    goalRecord(repo, { goal: id, phase: 'review', verdict: 'blocking', expectedSha: headSha(repo) }),
  ).not.toThrow();
});

test('record refuses a clean review after reverting to a previously-blocked tree (tree-global monotonicity)', () => {
  const repo = tmpRepo();
  const id = startGoal(repo);
  commit(repo, 'a.txt', '1', 't1');
  const t1 = headSha(repo);
  goalRecord(repo, { goal: id, phase: 'implement', expectedSha: headSha(repo) });
  goalRecord(repo, { goal: id, phase: 'review', verdict: 'blocking', expectedSha: headSha(repo) });
  commit(repo, 'a.txt', '2', 't2');
  goalRecord(repo, { goal: id, phase: 'implement', expectedSha: headSha(repo) });
  // revert the working tree to t1's content and commit → an identical tree to the blocked one
  g(repo, ['checkout', t1, '--', '.']);
  g(repo, ['commit', '-m', 'revert to t1 tree']);
  goalRecord(repo, { goal: id, phase: 'implement', expectedSha: headSha(repo) });
  expect(() =>
    goalRecord(repo, { goal: id, phase: 'review', verdict: 'clean', expectedSha: headSha(repo) }),
  ).toThrow(/upgrade a blocking review|blocking/);
});
