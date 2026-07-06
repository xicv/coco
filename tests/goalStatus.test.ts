import { expect, test } from 'vitest';
import { initRepo } from '../src/commands/init.js';
import { goalStart } from '../src/commands/goalStart.js';
import { goalRecord } from '../src/commands/goalRecord.js';
import { goalStatus } from '../src/commands/goalStatus.js';
import { headSha } from '../src/git.js';
import { commit, tmpRepo } from './helpers.js';

function drive(repo: string) {
  initRepo(repo);
  return goalStart(repo, { objective: 'feat x', maxFixRounds: 3, acceptanceChecks: [] }).goalId;
}

test('status walks plan → implement → review → verify → merge-gate', () => {
  const repo = tmpRepo();
  const id = drive(repo);
  expect(goalStatus(repo, id).nextAction).toBe('plan');

  goalRecord(repo, { goal: id, phase: 'plan', expectedSha: headSha(repo) });
  expect(goalStatus(repo, id).nextAction).toBe('implement');

  commit(repo, 'a.txt', '1', 'work');
  goalRecord(repo, { goal: id, phase: 'implement', expectedSha: headSha(repo) });
  expect(goalStatus(repo, id).nextAction).toBe('review');

  goalRecord(repo, { goal: id, phase: 'review', verdict: 'clean', expectedSha: headSha(repo) });
  expect(goalStatus(repo, id).nextAction).toBe('verify');

  goalRecord(repo, { goal: id, phase: 'verify', verdict: 'pass', expectedSha: headSha(repo) });
  expect(goalStatus(repo, id).nextAction).toBe('merge-gate');
});

test('status is pure: repeated calls do not change fixRounds or state', () => {
  const repo = tmpRepo();
  const id = drive(repo);
  goalRecord(repo, { goal: id, phase: 'plan', expectedSha: headSha(repo) });
  commit(repo, 'a.txt', '1', 'work');
  goalRecord(repo, { goal: id, phase: 'implement', expectedSha: headSha(repo) });
  goalRecord(repo, { goal: id, phase: 'review', verdict: 'blocking', expectedSha: headSha(repo) });
  const a = goalStatus(repo, id);
  const b = goalStatus(repo, id);
  expect(a).toEqual(b);
  expect(a.nextAction).toBe('fix');
  expect(a.facts.fixRounds).toBe(1);
});
