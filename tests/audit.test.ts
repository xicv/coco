import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { appendAudit, appendAuditFeedback, auditPath, buildAuditRecord, readAudit, readAuditDetailed, type AuditRecord } from '../src/audit.js';
import { auditReport, auditValidate } from '../src/commands/audit.js';
import { goalOracleUnavailable } from '../src/commands/goalOracle.js';
import { goalRecord } from '../src/commands/goalRecord.js';
import { goalStart } from '../src/commands/goalStart.js';
import { initRepo } from '../src/commands/init.js';
import { goalPath, readGoal } from '../src/state.js';
import type { GoalState } from '../src/types.js';
import { g, tmpRepo } from './helpers.js';

const goal = (over: Partial<GoalState> = {}): GoalState =>
  ({ id: 'g1', state: 'active', events: [], updatedAt: '2026-07-07T00:00:00.000Z', ...over }) as unknown as GoalState;

const review = (verdict: 'clean' | 'blocking', tree: string): Partial<AuditRecord> => ({ phase: 'review', verdict, tree });
const verify = (verdict: 'pass' | 'fail'): Partial<AuditRecord> => ({ phase: 'verify', verdict });

test('buildAuditRecord: lean record for a non-event op, no phase/verdict', () => {
  const r = buildAuditRecord(goal(), 'goal-start');
  expect(r).toEqual({ v: 1, at: '2026-07-07T00:00:00.000Z', goalId: 'g1', action: 'goal-start', state: 'active', events: 0 });
});

test('buildAuditRecord: record:* attaches the just-appended event facts (never evidence text)', () => {
  const r = buildAuditRecord(
    goal({ events: [{ phase: 'review', at: 'x', commit: 'abc', tree: 'def', verdict: 'blocking', evidence: 'secret detail' } as GoalState['events'][number]] }),
    'record:review:blocking',
  );
  expect(r).toMatchObject({ action: 'record:review:blocking', phase: 'review', verdict: 'blocking', commit: 'abc', tree: 'def', events: 1 });
  expect(JSON.stringify(r)).not.toContain('secret detail'); // redaction: no evidence in the audit line
});

test('buildAuditRecord: carries the fingerprint fail counter when present', () => {
  const r = buildAuditRecord(goal({ failureLoop: { key: 'k', count: 3, history: [] } }), 'record:review:blocking');
  expect(r.failCount).toBe(3);
});

test('appendAudit + readAudit round-trip; readAudit skips torn lines while detailed read reports them', () => {
  const repo = mkdtempSync(join(tmpdir(), 'coco-audit-'));
  const rec: AuditRecord = { v: 1, at: '2026-07-07T00:00:00.000Z', goalId: 'g1', action: 'goal-start', state: 'active', events: 0 };
  appendAudit(repo, rec);
  writeFileSync(auditPath(repo), `${JSON.stringify(rec)}\n{ this is not json\n`, { flag: 'a' }); // append a torn line
  const back = readAudit(repo);
  expect(back).toHaveLength(2); // the good record twice, the malformed line skipped
  expect(back[0]).toEqual(rec);
  const detailed = readAuditDetailed(repo);
  expect(detailed.invalid).toHaveLength(1);
  expect(detailed.invalid[0].rawHash).toMatch(/^[0-9a-f]{16}$/);
});

test('appendAudit is best-effort — never throws even when the path cannot be a directory', () => {
  const notADir = join(tmpdir(), `coco-audit-file-${Math.floor(Number(process.hrtime.bigint() % 1000000n))}`);
  writeFileSync(notADir, 'x'); // a FILE where a repo dir is expected → mkdir(.coco) will fail
  expect(() => appendAudit(notADir, buildAuditRecord(goal(), 'goal-start'))).not.toThrow();
});

test('auditReport aggregates fix rounds, verify fails, oracle outages, human-merge latency, and validity', () => {
  const repo = mkdtempSync(join(tmpdir(), 'coco-audit-'));
  const put = (goalId: string, action: string, at: string, extra: Partial<AuditRecord> = {}) =>
    appendAudit(repo, { v: 1, at, goalId, action, state: extra.state ?? 'active', events: extra.events ?? 0, ...extra });

  // goal A: one blocking round, then clean → verify pass → merged 30s later
  put('gA', 'goal-start', '2026-07-07T09:59:00.000Z');
  put('gA', 'record:review:blocking', '2026-07-07T09:59:10.000Z', review('blocking', 't1'));
  put('gA', 'record:review:clean', '2026-07-07T09:59:50.000Z', review('clean', 't2'));
  put('gA', 'record:verify:pass', '2026-07-07T10:00:00.000Z', verify('pass'));
  put('gA', 'merge', '2026-07-07T10:00:30.000Z', { state: 'achieved' });
  // goal B: a verify fail and an Oracle outage, never merged
  put('gB', 'goal-start', '2026-07-07T11:00:00.000Z');
  put('gB', 'record:verify:fail', '2026-07-07T11:01:00.000Z', verify('fail'));
  put('gB', 'oracle-unavailable:review:oracle-timeout', '2026-07-07T11:02:00.000Z');

  const rep = auditReport(repo);
  expect(rep.totalRecords).toBe(8);
  expect(rep.totals).toEqual({ goals: 2, fixRounds: 1, verifyFails: 1, oracleOutages: 1, merges: 1 });
  expect(rep.validity.ok).toBe(true);

  const a = rep.goals.find((x) => x.goalId === 'gA')!;
  expect(a).toMatchObject({ fixRounds: 1, verifyFails: 0, oracleOutages: 0, reachedMerge: true, finalState: 'achieved', verifyToMergeSec: 30 });
  const b = rep.goals.find((x) => x.goalId === 'gB')!;
  expect(b).toMatchObject({ verifyFails: 1, oracleOutages: 1, reachedMerge: false });
});

test('auditReport fixRounds counts distinct blocking trees, not blocking-review records', () => {
  const repo = mkdtempSync(join(tmpdir(), 'coco-audit-'));
  const put = (action: string, at: string, tree?: string) =>
    appendAudit(repo, { v: 1, at, goalId: 'g', action, state: 'active', events: 0, ...(tree ? review('blocking', tree) : {}) });
  put('goal-start', '2026-07-07T00:00:00.000Z');
  put('record:review:blocking', '2026-07-07T00:01:00.000Z', 'tA');
  put('record:review:blocking', '2026-07-07T00:02:00.000Z', 'tA'); // same tree — a re-review, NOT a new fix round
  put('record:review:blocking', '2026-07-07T00:03:00.000Z', 'tB'); // a new tree after a fix
  expect(auditReport(repo).goals[0].fixRounds).toBe(2); // tA, tB — not 3
});

test('auditValidate catches invalid lines and impossible merge ordering', () => {
  const repo = mkdtempSync(join(tmpdir(), 'coco-audit-'));
  appendAudit(repo, { v: 1, at: '2026-07-07T00:00:00.000Z', goalId: 'g', action: 'goal-start', state: 'active', events: 0 });
  appendAudit(repo, { v: 1, at: '2026-07-07T00:01:00.000Z', goalId: 'g', action: 'merge', state: 'achieved', events: 0 });
  writeFileSync(auditPath(repo), '{ bad json\n', { flag: 'a' });
  const v = auditValidate(repo);
  expect(v.ok).toBe(false);
  expect(v.invalidRecords).toBe(1);
  expect(v.failures.map((f) => f.code)).toContain('merge-before-verify-pass');
});

test('structured feedback is redacted and summarized', () => {
  const repo = mkdtempSync(join(tmpdir(), 'coco-audit-'));
  appendAuditFeedback(repo, { goalId: 'g1', kind: 'goal-quality', rating: 2, tags: ['Vague Goal', 'vague goal'], note: 'This raw note must not be stored.' });
  appendAuditFeedback(repo, { goalId: 'g2', kind: 'goal-quality', rating: 4, tags: ['clear'] });
  const rec = readAudit(repo).find((r) => r.action === 'feedback:goal-quality')!;
  expect(JSON.stringify(rec)).not.toContain('raw note');
  expect(rec.noteHash).toMatch(/^[0-9a-f]{16}$/);
  const feedback = auditReport(repo).feedback;
  expect(feedback.total).toBe(2);
  expect(feedback.byKind['goal-quality'].avgRating).toBe(3);
  expect(feedback.topTags[0]).toEqual(['vague goal', 1]);
});

test('goalOracleUnavailable is captured AND its evidence is centrally capped', () => {
  const repo = tmpRepo();
  initRepo(repo);
  g(repo, ['add', '-A']);
  g(repo, ['commit', '--allow-empty', '-m', 'coco init']);

  const { goalId } = goalStart(repo, { objective: 'oracle outage capture', maxFixRounds: 5, acceptanceChecks: [] });
  goalOracleUnavailable(repo, { goal: goalId, phase: 'review', reason: 'oracle-timeout', evidence: 'y'.repeat(5000) });

  const marker = readGoal(goalPath(repo, goalId)).reviewUnavailable!;
  expect(marker.evidence!.length).toBe(4000); // capped in the domain function, not just the MCP boundary
  expect(readAudit(repo).some((r) => r.action.startsWith('oracle-unavailable'))).toBe(true); // captured
});

test('capture is wired at the domain chokepoints: goalStart + goalRecord land in audit.ndjson', () => {
  const repo = tmpRepo();
  initRepo(repo);
  g(repo, ['add', '-A']);
  g(repo, ['commit', '--allow-empty', '-m', 'coco init']);

  const { goalId } = goalStart(repo, { objective: 'audit wiring test', maxFixRounds: 5, acceptanceChecks: [] });
  const head = g(repo, ['rev-parse', 'HEAD']);
  goalRecord(repo, { goal: goalId, phase: 'plan', expectedSha: head, evidence: 'planned it' });

  const actions = readAudit(repo).map((r) => r.action);
  expect(actions).toContain('goal-start'); // goalStart hook (direct writeGoal path)
  expect(actions).toContain('record:plan'); // touchAndWrite hook
  const startRec = readAudit(repo).find((r) => r.action === 'goal-start')!;
  expect(startRec.goalId).toBe(goalId);
  expect(startRec.state).toBe('active');
});

test('evidence is centrally capped on the domain path (covers the CLI record path too)', () => {
  const repo = tmpRepo();
  initRepo(repo);
  g(repo, ['add', '-A']);
  g(repo, ['commit', '--allow-empty', '-m', 'coco init']);

  const { goalId } = goalStart(repo, { objective: 'evidence cap', maxFixRounds: 5, acceptanceChecks: [] });
  const head = g(repo, ['rev-parse', 'HEAD']);
  goalRecord(repo, { goal: goalId, phase: 'plan', expectedSha: head, evidence: 'x'.repeat(5000) });

  const stored = readGoal(goalPath(repo, goalId)).events.at(-1)!.evidence!;
  expect(stored.length).toBe(4000); // capped by goalRecord itself, not just the MCP boundary
});
