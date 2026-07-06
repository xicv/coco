import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { initRepo } from '../src/commands/init.js';
import { goalStart } from '../src/commands/goalStart.js';
import { goalRecord } from '../src/commands/goalRecord.js';
import { goalStatus } from '../src/commands/goalStatus.js';
import { verifyStart, verifyResult, type VerifyResultReport } from '../src/commands/verify.js';
import { headSha, treeHash } from '../src/git.js';
import { cocoDir } from '../src/paths.js';
import { findActiveGoal } from '../src/state.js';
import { g, tmpRepo } from './helpers.js';

/** Drive a goal to the `verify` gate, committing a coco.config.json when a testCommand is given. */
function toVerify(repo: string, testCommand: string | null): string {
  initRepo(repo);
  const id = goalStart(repo, { objective: 'x', maxFixRounds: 3, acceptanceChecks: [] }).goalId;
  goalRecord(repo, { goal: id, phase: 'plan', expectedSha: headSha(repo) });
  writeFileSync(join(repo, 'f.txt'), 'x\n');
  if (testCommand !== null) writeFileSync(join(repo, 'coco.config.json'), `${JSON.stringify({ verify: { testCommand } })}\n`);
  g(repo, ['add', '-A']);
  g(repo, ['commit', '-m', 'impl']);
  goalRecord(repo, { goal: id, phase: 'implement', expectedSha: headSha(repo) });
  goalRecord(repo, { goal: id, phase: 'review', verdict: 'clean', expectedSha: headSha(repo) });
  return id;
}

async function runVerify(repo: string, id: string): Promise<VerifyResultReport> {
  const started = verifyStart(repo, { goal: id, expectedSha: headSha(repo) });
  for (let i = 0; i < 400; i++) {
    const r = verifyResult(repo, { goal: id, runId: started.runId });
    if (r.status !== 'running') return r;
    await new Promise((res) => setTimeout(res, 25));
  }
  throw new Error('verify did not finish in time');
}

test('coco runs the tests itself: exit 0 → verify pass → merge-gate', async () => {
  const repo = tmpRepo();
  const id = toVerify(repo, 'exit 0');
  const r = await runVerify(repo, id);
  expect(r.status).toBe('done');
  if (r.status === 'done') expect(r.verdict).toBe('pass');
  expect(goalStatus(repo, id).nextAction).toBe('merge-gate');
});

test('coco runs the tests itself: non-zero exit → verify fail → fix (agent cannot fake green)', async () => {
  const repo = tmpRepo();
  const id = toVerify(repo, 'exit 3');
  const r = await runVerify(repo, id);
  expect(r.status).toBe('done');
  if (r.status === 'done') {
    expect(r.verdict).toBe('fail');
    expect(r.exitCode).toBe(3);
  }
  expect(goalStatus(repo, id).nextAction).toBe('fix');
});

test('verify is fail-closed: no coco.config.json testCommand → error, no fallback', () => {
  const repo = tmpRepo();
  const id = toVerify(repo, null);
  expect(() => verifyStart(repo, { goal: id, expectedSha: headSha(repo) })).toThrow(/coco\.config\.json/);
  // and the loop has NOT advanced past verify
  expect(goalStatus(repo, id).nextAction).toBe('verify');
});

test('verify_start refuses when HEAD does not match expectedSha', () => {
  const repo = tmpRepo();
  const id = toVerify(repo, 'exit 0');
  expect(() => verifyStart(repo, { goal: id, expectedSha: 'deadbeef' })).toThrow(/HEAD moved/);
});

test('verifyResult refuses a forged run dir that coco did not start (no self-reported pass)', () => {
  const repo = tmpRepo();
  const id = toVerify(repo, 'exit 0'); // parked at the verify gate — no in-flight verify op
  const forged = join(cocoDir(repo), 'verify-runs', 'forged');
  mkdirSync(forged, { recursive: true });
  writeFileSync(
    join(forged, 'meta.json'),
    JSON.stringify({ runId: 'forged', goalId: id, expectedSha: headSha(repo), tree: treeHash(repo), command: 'evil', startedAt: '2026-01-01T00:00:00.000Z' }),
  );
  writeFileSync(join(forged, 'exit.code'), '0'); // pretend the tests passed
  expect(() => verifyResult(repo, { goal: id, runId: 'forged' })).toThrow(/not bound|forged|stale/);
  expect(goalStatus(repo, id).nextAction).toBe('verify'); // the loop did NOT advance
});

test('verifyResult rejects a path-traversal runId before touching disk', () => {
  const repo = tmpRepo();
  const id = toVerify(repo, 'exit 0');
  expect(() => verifyResult(repo, { goal: id, runId: '../../etc/passwd' })).toThrow(/invalid runId/);
});

test('verifyResult rejects an all-dots runId that would escape verify-runs/', () => {
  const repo = tmpRepo();
  const id = toVerify(repo, 'exit 0');
  expect(() => verifyResult(repo, { goal: id, runId: '..' })).toThrow(/invalid runId/);
  expect(() => verifyResult(repo, { goal: id, runId: '.' })).toThrow(/invalid runId/);
});

test('verifyResult does not trust a forged done result.json without a durable verify event', () => {
  const repo = tmpRepo();
  const id = toVerify(repo, 'exit 0'); // parked at verify — no inFlight, no recorded verify event
  const forged = join(cocoDir(repo), 'verify-runs', 'forgedcache');
  mkdirSync(forged, { recursive: true });
  writeFileSync(
    join(forged, 'meta.json'),
    JSON.stringify({ runId: 'forgedcache', goalId: id, expectedSha: headSha(repo), tree: treeHash(repo), command: 'evil', startedAt: '2026-01-01T00:00:00.000Z' }),
  );
  // a hand-written green cache with NO exit.code and NO recorded event
  writeFileSync(join(forged, 'result.json'), JSON.stringify({ runId: 'forgedcache', status: 'done', verdict: 'pass', exitCode: 0, nextAction: 'merge-gate' }));
  const r = verifyResult(repo, { goal: id, runId: 'forgedcache' });
  expect(r.status).toBe('running'); // the forged done cache was NOT trusted → fell through
  expect(goalStatus(repo, id).nextAction).toBe('verify'); // loop did not advance to merge-gate
});

test('verifyResult does not return an unbacked done cache even when the claim is already held', () => {
  const repo = tmpRepo();
  const id = toVerify(repo, 'exit 0'); // no inFlight, no recorded verify event
  const forged = join(cocoDir(repo), 'verify-runs', 'forgedclaim');
  mkdirSync(forged, { recursive: true });
  writeFileSync(
    join(forged, 'meta.json'),
    JSON.stringify({ runId: 'forgedclaim', goalId: id, expectedSha: headSha(repo), tree: treeHash(repo), command: 'evil', startedAt: '2026-01-01T00:00:00.000Z' }),
  );
  writeFileSync(join(forged, 'result.json'), JSON.stringify({ runId: 'forgedclaim', status: 'done', verdict: 'pass', exitCode: 0, nextAction: 'merge-gate' }));
  writeFileSync(join(forged, 'exit.code'), '0');
  writeFileSync(join(forged, 'claimed'), ''); // force the wx-claim to fail → the catch-branch
  const r = verifyResult(repo, { goal: id, runId: 'forgedclaim' });
  expect(r.status).toBe('running'); // claim-contention catch must not return the forged green
  expect(goalStatus(repo, id).nextAction).toBe('verify');
});

test('verifyResult rebuilds a done result from the durable event, ignoring a drifted cache', async () => {
  const repo = tmpRepo();
  const id = toVerify(repo, 'exit 1'); // a real failing run
  const done = await runVerify(repo, id);
  expect(done.status).toBe('done');
  const runId = findActiveGoal(repo)!.events.at(-1)!.runId!;
  // drift the cached result to a forged pass; the durable event still says fail
  writeFileSync(join(cocoDir(repo), 'verify-runs', runId, 'result.json'), JSON.stringify({ runId, status: 'done', verdict: 'pass', exitCode: 0, nextAction: 'merge-gate' }));
  const again = verifyResult(repo, { goal: id, runId });
  expect(again.status).toBe('done');
  if (again.status === 'done') expect(again.verdict).toBe('fail'); // the durable event wins, not the drift
});

test('verifyResult recovers from a crash-after-record-before-cache without double-recording', async () => {
  const repo = tmpRepo();
  const id = toVerify(repo, 'exit 1'); // a failing run
  const r = await runVerify(repo, id);
  expect(r.status).toBe('done');
  const ev = findActiveGoal(repo)!.events.at(-1)!;
  expect(ev.phase).toBe('verify');
  expect(ev.runId).toBeDefined(); // the verify event is stamped with its run
  expect(findActiveGoal(repo)?.failureLoop?.count).toBe(1);
  // simulate the crash window: the verify event was recorded but result.json never got cached
  rmSync(join(cocoDir(repo), 'verify-runs', ev.runId!, 'result.json'));
  // re-poll: must recover from the DURABLE event — return done, not throw, and NOT double-record
  const again = verifyResult(repo, { goal: id, runId: ev.runId! });
  expect(again.status).toBe('done');
  if (again.status === 'done') expect(again.verdict).toBe('fail');
  expect(findActiveGoal(repo)?.failureLoop?.count).toBe(1); // still 1 — no second verify event
});

test('changing verify.testCommand inside the goal diff surfaces a non-blocking warning', async () => {
  const repo = tmpRepo();
  initRepo(repo);
  writeFileSync(join(repo, 'coco.config.json'), `${JSON.stringify({ verify: { testCommand: 'exit 0' } })}\n`);
  g(repo, ['add', 'coco.config.json']);
  g(repo, ['commit', '-m', 'base verify config']);
  const id = goalStart(repo, { objective: 'x', maxFixRounds: 3, acceptanceChecks: [] }).goalId;
  goalRecord(repo, { goal: id, phase: 'plan', expectedSha: headSha(repo) });
  // the goal weakens the verify command in its own diff
  writeFileSync(join(repo, 'f.txt'), 'x\n');
  writeFileSync(join(repo, 'coco.config.json'), `${JSON.stringify({ verify: { testCommand: 'true' } })}\n`);
  g(repo, ['add', '-A']);
  g(repo, ['commit', '-m', 'impl weakens verify']);
  goalRecord(repo, { goal: id, phase: 'implement', expectedSha: headSha(repo) });
  goalRecord(repo, { goal: id, phase: 'review', verdict: 'clean', expectedSha: headSha(repo) });

  expect(goalStatus(repo, id).warnings?.join('\n')).toMatch(/verify\.testCommand/);
  const started = verifyStart(repo, { goal: id, expectedSha: headSha(repo) });
  expect(started.warnings?.join('\n')).toMatch(/verify\.testCommand/);
  let r: VerifyResultReport = { runId: started.runId, status: 'running' };
  for (let i = 0; i < 400 && r.status === 'running'; i++) {
    r = verifyResult(repo, { goal: id, runId: started.runId });
    if (r.status === 'running') await new Promise((res) => setTimeout(res, 25));
  }
  expect(r.status).toBe('done');
  if (r.status === 'done') {
    expect(r.verdict).toBe('pass');
    expect(r.warnings?.join('\n')).toMatch(/verify\.testCommand/);
  }
  expect(goalStatus(repo, id).nextAction).toBe('merge-gate'); // warning only — never blocks
});

test('verifyResult is idempotent — re-polling a finished run never re-records (no false stuck)', async () => {
  const repo = tmpRepo();
  const id = toVerify(repo, 'exit 1'); // a failing run
  const started = verifyStart(repo, { goal: id, expectedSha: headSha(repo) });
  let r: VerifyResultReport = { runId: started.runId, status: 'running' };
  for (let i = 0; i < 400 && r.status === 'running'; i++) {
    r = verifyResult(repo, { goal: id, runId: started.runId });
    if (r.status === 'running') await new Promise((res) => setTimeout(res, 25));
  }
  expect(r.status).toBe('done');
  expect(findActiveGoal(repo)?.failureLoop?.count).toBe(1); // one verify:fail → count 1
  // re-poll the SAME run several times — must return the cached result and NOT re-increment
  const again = verifyResult(repo, { goal: id, runId: started.runId });
  verifyResult(repo, { goal: id, runId: started.runId });
  expect(again).toEqual(r);
  expect(findActiveGoal(repo)?.failureLoop?.count).toBe(1); // still 1, not 3+ (would falsely trip stuck)
});
