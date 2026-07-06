import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test } from 'vitest';
import { goalRecord } from '../src/commands/goalRecord.js';
import { cocoDoneTool, cocoGoalOpClear, cocoGoalOpStart, cocoGoalOracleUnavailable, cocoGoalRecord, cocoGoalStart, cocoGoalStatus, cocoHealth, cocoInit, cocoMerge, cocoNextTool } from '../src/mcp/tools.js';
import { headSha } from '../src/git.js';
import { commit, g, tmpRepo } from './helpers.js';

test('cocoInit + cocoGoalStart over a temp repo returns status with headSha', () => {
  const repo = tmpRepo();
  cocoInit({ repoDir: repo });
  const res = cocoGoalStart({ repoDir: repo, objective: 'feat x' });
  expect(res.goalId).toMatch(/^goal-/);
  expect(res.status.nextAction).toBe('plan');
  expect(res.status.headSha).toMatch(/^[0-9a-f]{7,}/);
});

test('cocoGoalRecord requires non-empty evidence', () => {
  const repo = tmpRepo();
  cocoInit({ repoDir: repo });
  const id = cocoGoalStart({ repoDir: repo, objective: 'x' }).goalId;
  expect(() =>
    cocoGoalRecord({ repoDir: repo, goalId: id, phase: 'plan', expectedSha: headSha(repo), evidence: '   ' }),
  ).toThrow(/evidence/);
});

test('review record parses Oracle verdict server-side; ambiguous is rejected, clean advances', () => {
  const repo = tmpRepo();
  cocoInit({ repoDir: repo });
  const id = cocoGoalStart({ repoDir: repo, objective: 'x' }).goalId;
  cocoGoalRecord({ repoDir: repo, goalId: id, phase: 'plan', expectedSha: headSha(repo), evidence: 'planned' });
  commit(repo, 'a.txt', '1', 'work');
  cocoGoalRecord({ repoDir: repo, goalId: id, phase: 'implement', expectedSha: headSha(repo), evidence: 'built' });

  // ambiguous → rejected, nothing recorded
  expect(() =>
    cocoGoalRecord({
      repoDir: repo, goalId: id, phase: 'review', expectedSha: headSha(repo),
      evidence: 'oracle', reviewOutput: 'VERDICT: clean\nVERDICT: blocking',
    }),
  ).toThrow(/verdict/i);

  // clean → recorded, status advances to verify
  const r = cocoGoalRecord({
    repoDir: repo, goalId: id, phase: 'review', expectedSha: headSha(repo),
    evidence: 'oracle', reviewOutput: 'Looks good.\nVERDICT: clean',
  });
  expect(r.event.verdict).toBe('clean');
  expect(r.status.nextAction).toBe('verify');
});

test('an ambiguous review sets a durable review-unavailable pause (never false-green), op-clear resumes', () => {
  const repo = tmpRepo();
  cocoInit({ repoDir: repo });
  const id = cocoGoalStart({ repoDir: repo, objective: 'x' }).goalId;
  cocoGoalRecord({ repoDir: repo, goalId: id, phase: 'plan', expectedSha: headSha(repo), evidence: 'planned' });
  commit(repo, 'a.txt', '1', 'work');
  cocoGoalRecord({ repoDir: repo, goalId: id, phase: 'implement', expectedSha: headSha(repo), evidence: 'built' });
  cocoGoalOpStart({ repoDir: repo, goalId: id, phase: 'review', kind: 'oracle' });
  expect(cocoHealth({ repoDir: repo }).verdict).toBe('operation-in-progress'); // op in flight
  expect(() =>
    cocoGoalRecord({ repoDir: repo, goalId: id, phase: 'review', expectedSha: headSha(repo), evidence: 'oracle', reviewOutput: 'no verdict line here' }),
  ).toThrow(/verdict/i);
  // durable pause: not healthy, not still operation-in-progress; loop stops
  expect(cocoHealth({ repoDir: repo }).verdict).toBe('review-unavailable');
  expect(cocoGoalStatus({ repoDir: repo }).nextAction).toBe('escalate-human');
  // op-clear resumes the loop once the human has resolved Oracle
  cocoGoalOpClear({ repoDir: repo, goalId: id });
  expect(cocoHealth({ repoDir: repo }).verdict).toBe('healthy');
  expect(cocoGoalStatus({ repoDir: repo }).nextAction).toBe('review');
});

test('coco_goal_oracle_unavailable pauses the loop; a later successful review clears it', () => {
  const repo = tmpRepo();
  cocoInit({ repoDir: repo });
  const id = cocoGoalStart({ repoDir: repo, objective: 'x' }).goalId;
  cocoGoalRecord({ repoDir: repo, goalId: id, phase: 'plan', expectedSha: headSha(repo), evidence: 'planned' });
  commit(repo, 'a.txt', '1', 'work');
  cocoGoalRecord({ repoDir: repo, goalId: id, phase: 'implement', expectedSha: headSha(repo), evidence: 'built' });
  const r = cocoGoalOracleUnavailable({ repoDir: repo, goalId: id, phase: 'review', reason: 'oracle-timeout', attempts: 2 });
  expect(r.reviewUnavailable.reason).toBe('oracle-timeout');
  expect(cocoHealth({ repoDir: repo }).verdict).toBe('review-unavailable');
  expect(cocoGoalStatus({ repoDir: repo }).nextAction).toBe('escalate-human');
  // resume + a good review clears the marker and advances
  cocoGoalOpClear({ repoDir: repo, goalId: id });
  const rec = cocoGoalRecord({ repoDir: repo, goalId: id, phase: 'review', expectedSha: headSha(repo), evidence: 'oracle', reviewOutput: 'VERDICT: clean' });
  expect(rec.status.nextAction).toBe('verify');
});

test('resolveRepo rejects a relative repoDir', () => {
  expect(() => cocoGoalStatus({ repoDir: 'relative/path' })).toThrow(/absolute/);
});

test('cocoInit on a SUBDIRECTORY does not create a nested repo — operates on the root', () => {
  const repo = tmpRepo();
  const sub = join(repo, 'packages', 'app');
  mkdirSync(sub, { recursive: true });
  const res = cocoInit({ repoDir: sub });
  expect(existsSync(join(sub, '.git'))).toBe(false); // no nested repo
  expect(existsSync(join(repo, '.coco', 'goals'))).toBe(true); // state at the root
  expect(res.repoDir).toBe(realpathSync(repo));
});

test('a subdirectory normalizes to the repo root for goal tools', () => {
  const repo = tmpRepo();
  cocoInit({ repoDir: repo });
  const sub = join(repo, 'src');
  mkdirSync(sub, { recursive: true });
  const started = cocoGoalStart({ repoDir: repo, objective: 'x' });
  // status via the subdir must resolve to the same goal at the root
  expect(cocoGoalStatus({ repoDir: sub, goalId: started.goalId }).goalId).toBe(started.goalId);
});

test('MCP record rejects extraneous phase fields (no verify-via-review smuggling)', () => {
  const repo = tmpRepo();
  cocoInit({ repoDir: repo });
  const id = cocoGoalStart({ repoDir: repo, objective: 'x' }).goalId;
  // verdict on plan → rejected
  expect(() =>
    cocoGoalRecord({ repoDir: repo, goalId: id, phase: 'plan', expectedSha: headSha(repo), evidence: 'p', verdict: 'pass' }),
  ).toThrow(/verdict/i);
  // reviewOutput on implement → rejected
  commit(repo, 'a.txt', '1', 'w');
  expect(() =>
    cocoGoalRecord({ repoDir: repo, goalId: id, phase: 'implement', expectedSha: headSha(repo), evidence: 'i', reviewOutput: 'VERDICT: clean' }),
  ).toThrow(/reviewOutput/i);
});

test('cocoHealth returns a verdict', () => {
  const repo = tmpRepo();
  cocoInit({ repoDir: repo });
  cocoGoalStart({ repoDir: repo, objective: 'x' });
  expect(cocoHealth({ repoDir: repo }).verdict).toBe('healthy');
});

test('coco_next / coco_done read and update BACKLOG.md', () => {
  const repo = tmpRepo();
  cocoInit({ repoDir: repo });
  writeFileSync(
    join(repo, 'BACKLOG.md'),
    ['### t1 — Task one', '```yaml', 'id: t1', 'status: ready', 'priority: high', '```', 'body one'].join('\n'),
  );
  const task = cocoNextTool({ repoDir: repo }).task;
  expect(task?.id).toBe('t1');
  expect(task).not.toHaveProperty('raw'); // public shape — no internal offsets/raw
  cocoDoneTool({ repoDir: repo, taskId: 't1' });
  expect(cocoNextTool({ repoDir: repo }).task).toBeNull(); // marked done → nothing ready
});

test('backlogTaskId threads through goal start into status (durable coco_done)', () => {
  const repo = tmpRepo();
  cocoInit({ repoDir: repo });
  const r = cocoGoalStart({ repoDir: repo, objective: 'x', backlogTaskId: 'task-9' });
  expect(r.status.backlogTaskId).toBe('task-9');
  expect(cocoGoalStatus({ repoDir: repo }).backlogTaskId).toBe('task-9');
});

/** Drive an auto-merge-eligible goal to merge-gate via the MCP start + a risk-safe diff. */
function mergeReadyAuto(repo: string, autoMergeAllowed: boolean): string {
  cocoInit({ repoDir: repo });
  const id = cocoGoalStart({ repoDir: repo, objective: 'feat x', autoMergeAllowed }).goalId;
  goalRecord(repo, { goal: id, phase: 'plan', expectedSha: headSha(repo) });
  for (const [f, c] of Object.entries({ 'src/f.ts': 'export const x = 1;\n', 'tests/f.test.ts': 'test.skip("x", () => {});\n' })) {
    const abs = join(repo, f);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, c);
  }
  g(repo, ['add', '-A']);
  g(repo, ['commit', '-m', 'work']);
  goalRecord(repo, { goal: id, phase: 'implement', expectedSha: headSha(repo) });
  goalRecord(repo, { goal: id, phase: 'review', verdict: 'clean', expectedSha: headSha(repo) });
  goalRecord(repo, { goal: id, phase: 'verify', verdict: 'pass', expectedSha: headSha(repo) });
  return id;
}

test('autoMergeAllowed threads through cocoGoalStart into status; omitted by default', () => {
  const on = tmpRepo();
  cocoInit({ repoDir: on });
  expect(cocoGoalStart({ repoDir: on, objective: 'x', autoMergeAllowed: true }).status.autoMergeAllowed).toBe(true);
  const off = tmpRepo();
  cocoInit({ repoDir: off });
  expect(cocoGoalStart({ repoDir: off, objective: 'x' }).status.autoMergeAllowed).toBeUndefined();
});

test('cocoMerge auto-merges an opted-in, green, low-risk goal', () => {
  const repo = tmpRepo();
  const id = mergeReadyAuto(repo, true);
  const res = cocoMerge({ repoDir: repo, goalId: id, expectedSha: headSha(repo) });
  expect(res.merged).toBe(true);
  expect(res.mergedSha).toMatch(/^[0-9a-f]{7,}/);
});

test('cocoMerge refuses a non-opted-in goal with next=human-merge', () => {
  const repo = tmpRepo();
  const id = mergeReadyAuto(repo, false);
  const res = cocoMerge({ repoDir: repo, goalId: id, expectedSha: headSha(repo) });
  expect(res.merged).toBe(false);
  expect(res.next).toBe('human-merge');
});
