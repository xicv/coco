import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from 'vitest';
import { appendAudit, type AuditRecord } from '../src/audit.js';
import { parseBacklog } from '../src/backlog.js';
import { goalRecord } from '../src/commands/goalRecord.js';
import { goalStart } from '../src/commands/goalStart.js';
import { initRepo } from '../src/commands/init.js';
import { autoMergeGoal, mergeGoal } from '../src/commands/merge.js';
import { headSha } from '../src/git.js';
import { improveDigest } from '../src/improve/digest.js';
import { improvePromote } from '../src/improve/promote.js';
import { canonicalize, improveCheck, improveCheckDiff, isProtected } from '../src/improve/protected.js';
import { goalPath, readGoal } from '../src/state.js';
import { storeAdd, storeInit, storePromote } from '../src/store/commands.js';
import { assertGoalSpecHasRequiredSections, assertImproveSpecHasRequiredSections } from '../src/store/specValidate.js';
import { g, tmpRepo } from './helpers.js';

const REPO = '/repo'; // canonicalisation is pure (resolve against this root) — no real fs needed

test('canonicalize resolves dot-segments/absolute/whitespace to a repo-relative posix path', () => {
  expect(canonicalize(REPO, ' src/gate.ts ')).toBe('src/gate.ts');
  expect(canonicalize(REPO, 'src//gate.ts')).toBe('src/gate.ts');
  expect(canonicalize(REPO, 'src/../src/gate.ts')).toBe('src/gate.ts');
  expect(canonicalize(REPO, '/repo/src/gate.ts')).toBe('src/gate.ts');
  expect(canonicalize(REPO, 'SRC/gate.ts')).toBe('src/gate.ts'); // case-folded
  expect(canonicalize(REPO, 'src\\gate.ts')).toBe('src/gate.ts'); // backslash → /
  // escapes / unresolvable → null (fail-closed)
  expect(canonicalize(REPO, '../../etc/passwd')).toBeNull();
  expect(canonicalize(REPO, '/etc/passwd')).toBeNull();
  expect(canonicalize(REPO, '   ')).toBeNull();
});

// Every one of these targets src/gate.ts and MUST be caught (the pre-hardening norm() let them slip).
const EVASIONS = [' src/gate.ts', 'src/gate.ts ', 'src//gate.ts', 'src/../src/gate.ts', './a/../src/gate.ts', '/repo/src/gate.ts', 'SRC/gate.ts', 'src\\gate.ts'];
for (const p of EVASIONS) {
  test(`isProtected catches evasion ${JSON.stringify(p)}`, () => expect(isProtected(REPO, p)).toBe(true));
}

test('isProtected fail-closes on outside-repo / unresolvable paths', () => {
  expect(isProtected(REPO, '../../etc/passwd')).toBe(true);
  expect(isProtected(REPO, '/etc/passwd')).toBe(true);
  expect(isProtected(REPO, '   ')).toBe(true);
});

test('denylist covers the referee, its surfaces, and the metrics; allows skills/docs', () => {
  for (const p of [
    'src/gate.ts', 'src/oracleVerdict.ts', 'src/git.ts', 'src/state.ts', 'src/lock.ts',
    'src/commands/merge.ts', 'src/commands/verify.ts', 'src/commands/goalStart.ts', 'src/commands/goalOp.ts',
    'src/autoMergeRisk.ts', 'src/cocoConfig.ts', 'src/backlog.ts', 'coco.config.json',
    'src/cli.ts', 'src/mcp/tools.ts', 'src/mcp/server.ts',
    'src/audit.ts', 'src/commands/audit.ts', 'src/commands/doctor.ts',
    'src/improve/digest.ts', '.coco/goals/x.json',
  ]) {
    expect(isProtected(REPO, p)).toBe(true);
  }
  for (const p of ['skills/coco-loop/SKILL.md', 'skills/coco-goal/SKILL.md', 'README.md', 'src/commands/notify.ts']) {
    expect(isProtected(REPO, p)).toBe(false);
  }
});

test('improveCheck refuses any protected path, dedupes, reports the original strings', () => {
  const bad = improveCheck(REPO, ['skills/coco-loop/SKILL.md', 'src/gate.ts', 'src/gate.ts']);
  expect(bad.ok).toBe(false);
  expect(bad.checked).toBe(3);
  expect(bad.protected).toEqual(['src/gate.ts']);
  expect(improveCheck(REPO, ['skills/coco-loop/SKILL.md', 'README.md'])).toEqual({ ok: true, checked: 2, protected: [] });
});

test('improve check --diff binds to the ACTUAL changed files, not caller-declared paths', () => {
  const repo = tmpRepo();
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'gate.ts'), 'export const x = 1;\n');
  writeFileSync(join(repo, 'safe.md'), 'ok\n');
  g(repo, ['add', '-A']);
  g(repo, ['commit', '-m', 'seed files']);

  expect(improveCheckDiff(repo).ok).toBe(true); // clean tree → nothing changed
  writeFileSync(join(repo, 'src', 'gate.ts'), 'export const x = 2;\n'); // touch a protected file
  const r = improveCheckDiff(repo);
  expect(r.ok).toBe(false);
  expect(r.protected).toContain('src/gate.ts');
});

function seedGoals(repo: string, n: number, extra: AuditRecord[] = []): void {
  for (let i = 0; i < n; i++) {
    appendAudit(repo, { v: 1, at: `2026-07-08T00:00:0${i}.000Z`, goalId: `g${i}`, action: 'goal-start', state: 'active', events: 0 });
  }
  for (const r of extra) appendAudit(repo, r);
}

test('improveDigest gates on sample size: too few goals → insufficient-data, with anti-goals', () => {
  const repo = mkdtempSync(join(tmpdir(), 'coco-improve-'));
  seedGoals(repo, 2);
  const d = improveDigest(repo);
  expect(d.sufficient).toBe(false);
  expect(d.signals.every((s) => s.status === 'insufficient-data' && s.safeToActOn === false)).toBe(true);
  expect(d.antiGoals.length).toBeGreaterThan(0);
});

test('improveDigest: oracle-reliability is safeToActOn only when it actually fires', () => {
  const outage = (gid: string, at: string): AuditRecord => ({ v: 1, at, goalId: gid, action: 'oracle-unavailable:review:oracle-timeout', state: 'active', events: 0 });

  // enough data, enough outages → fires, safe to act on
  const hot = mkdtempSync(join(tmpdir(), 'coco-improve-'));
  seedGoals(hot, 5, [outage('g0', '2026-07-08T01:00:00.000Z'), outage('g1', '2026-07-08T01:01:00.000Z'), outage('g2', '2026-07-08T01:02:00.000Z')]);
  const oracleHot = improveDigest(hot).signals.find((s) => s.key === 'oracle-reliability')!;
  expect(oracleHot.status).toBe('signal');
  expect(oracleHot.safeToActOn).toBe(true);

  // enough data, no outages → 'clear' → NOT safe to act on (the WARNING-5 footgun)
  const cool = mkdtempSync(join(tmpdir(), 'coco-improve-'));
  seedGoals(cool, 5);
  const oracleCool = improveDigest(cool).signals.find((s) => s.key === 'oracle-reliability')!;
  expect(oracleCool.status).toBe('clear');
  expect(oracleCool.safeToActOn).toBe(false);

  // observational signals are never safe optimisation targets
  expect(improveDigest(hot).signals.find((s) => s.key === 'human-merge-latency')!.safeToActOn).toBe(false);
});

test('slice-2 denylist: the whole store layer + improve skill are protected; the loop skill stays a legit target', () => {
  for (const p of [
    'src/store/specValidate.ts', 'src/store/commands.ts', 'src/store/cli.ts', 'src/store/schema.ts', 'src/store/pack.ts',
    'skills/coco-improve/SKILL.md', 'skills/coco-improve/agents/openai.yaml',
  ]) {
    expect(isProtected(REPO, p)).toBe(true);
  }
  expect(isProtected(REPO, 'skills/coco-loop/SKILL.md')).toBe(false);
});

const IMPROVE_SECTIONS = [
  'Outcome', 'Verification surface', 'Boundaries', 'Predeclared hypothesis', 'Audit evidence window',
  'Expected mechanism', 'Success criteria', 'Failure criteria', 'Confounders', 'Rejected alternatives', 'Anti-goals',
];
const improveSpecBody = (omit?: string): string => IMPROVE_SECTIONS.filter((s) => s !== omit).map((s) => `## ${s}\nx\n`).join('\n');

test('improve-spec gate requires the full hypothesis contract (base GoalSpec sections included)', () => {
  expect(() => assertImproveSpecHasRequiredSections(improveSpecBody())).not.toThrow();
  expect(() => assertImproveSpecHasRequiredSections(improveSpecBody('Predeclared hypothesis'))).toThrow(/Predeclared hypothesis/);
  expect(() => assertImproveSpecHasRequiredSections(improveSpecBody('Boundaries'))).toThrow(/Boundaries/); // base gate still applies
});

test('storeAdd routes a coco-improve-tagged spec through the stricter gate; plain specs are unaffected', () => {
  const repo = tmpRepo();
  storeInit(repo);
  // an improve-tagged spec missing a contract section is rejected
  expect(() => storeAdd(repo, { title: 'improve x', body: improveSpecBody('Success criteria'), type: 'spec', tags: ['coco-improve'] })).toThrow(/Success criteria/);
  // a complete improve spec is accepted (local visibility → never travels to Oracle)
  expect(storeAdd(repo, { title: 'improve x', body: improveSpecBody(), type: 'spec', tags: ['coco-improve'], visibility: 'local' }).type).toBe('spec');
  // a NON-improve spec only needs the base GoalSpec sections
  expect(() => storeAdd(repo, { title: 'plain', body: '## Outcome\nx\n## Verification surface\nx\n## Boundaries\nx\n', type: 'spec' })).not.toThrow();
});

test('an improve spec is identified by tag OR title-prefix, and is forced to local visibility', () => {
  const repo = tmpRepo();
  storeInit(repo);
  // title-prefix alone (no tag) still triggers the stricter gate
  expect(() => storeAdd(repo, { title: 'improve: x', body: improveSpecBody('Confounders'), type: 'spec' })).toThrow(/Confounders/);
  // even when the caller asks for shared, an improve spec is archived LOCAL (audit-derived privacy)
  const card = storeAdd(repo, { title: 'improve: x', body: improveSpecBody(), type: 'spec', tags: ['coco-improve'], visibility: 'shared' });
  expect(card.visibility).toBe('local');
});

test('section gate requires a real marker (heading or colon), not a bare line', () => {
  const spec = (mk: (s: string) => string) => ['Outcome', 'Verification surface', 'Boundaries'].map(mk).join('\n');
  expect(() => assertGoalSpecHasRequiredSections(spec((s) => `## ${s}\nx`))).not.toThrow(); // heading
  expect(() => assertGoalSpecHasRequiredSections(spec((s) => `${s}:\nx`))).not.toThrow(); // colon label
  expect(() => assertGoalSpecHasRequiredSections(spec((s) => `${s}\nx`))).toThrow(); // bare line → rejected
});

function seedImproveSpec(repo: string): string {
  storeInit(repo);
  return storeAdd(repo, { title: 'improve: x', body: improveSpecBody(), type: 'spec', tags: ['coco-improve'], visibility: 'local' }).id;
}

test('improvePromote refuses a protected target (no backlog write) and promotes a non-protected task linked to the spec', () => {
  const repo = tmpRepo();
  const spec = seedImproveSpec(repo);
  const backlog = join(repo, 'BACKLOG.md');

  // protected target → refused, backlog untouched
  const bad = improvePromote(repo, { spec, id: 'improve-x', title: 'improve: x', paths: ['src/gate.ts'] });
  expect(bad.ok).toBe(false);
  expect(bad.check.protected).toContain('src/gate.ts');
  expect(bad.promoted).toBeUndefined();
  expect(existsSync(backlog)).toBe(false); // nothing was written

  // non-protected skill target → promoted, linked to the improve-spec
  const good = improvePromote(repo, {
    spec, id: 'improve-oracle-retry', title: 'improve: oracle retry guidance',
    paths: ['skills/coco-loop/SKILL.md'], body: 'add a retry/resume clause', priority: 'medium',
  });
  expect(good.ok).toBe(true);
  expect(good.promoted).toBe('improve-oracle-retry');
  const task = parseBacklog(readFileSync(backlog, 'utf8')).find((n) => n.id === 'improve-oracle-retry')!;
  expect(task.links.spec).toBe(spec); // traceable back to its improve-spec
  // declared paths persisted INSIDE the yaml (not the markdown body → no heading injection)
  expect(readFileSync(backlog, 'utf8')).toMatch(/paths: \["skills\/coco-loop\/SKILL\.md"\]/);
});

test('improvePromote requires at least one --paths entry (the guard must bind to something)', () => {
  const repo = tmpRepo();
  seedImproveSpec(repo);
  expect(() => improvePromote(repo, { spec: 's', id: 'improve-x', title: 't', paths: [] })).toThrow(/paths/);
});

test('improvePromote refuses a --spec that is not an existing coco-improve card (no dead-link promotion)', () => {
  const repo = tmpRepo();
  storeInit(repo);
  expect(() => improvePromote(repo, { spec: 'nope', id: 'improve-x', title: 't', paths: ['skills/coco-loop/SKILL.md'] })).toThrow(/coco-improve spec card/);
  // a plain (non-improve) GoalSpec is also refused
  const plain = storeAdd(repo, { title: 'plain', body: '## Outcome\nx\n## Verification surface\nx\n## Boundaries\nx\n', type: 'spec' }).id;
  expect(() => improvePromote(repo, { spec: plain, id: 'improve-y', title: 't', paths: ['skills/coco-loop/SKILL.md'] })).toThrow(/coco-improve spec card/);
});

// Drive a green goal to merge-gate. `improveOrigin` freezes at goalStart from the backlog task's spec
// link. The task DECLARES only a safe path (so promote passes), but the implement commits `implFile`
// — simulating under-declaration that the merge gate must catch on the ACTUAL diff.
function readyImproveGoal(repo: string, implFile: string, autoMergeAllowed = false): string {
  initRepo(repo);
  const spec = seedImproveSpec(repo);
  improvePromote(repo, { spec, id: 'improve-x', title: 'improve: x', paths: ['skills/coco-loop/SKILL.md'] });
  g(repo, ['add', '-A']);
  g(repo, ['commit', '-m', 'store + backlog']); // clean tree before goalStart
  const id = goalStart(repo, { objective: 'improve x', maxFixRounds: 3, acceptanceChecks: [], backlogTaskId: 'improve-x', autoMergeAllowed }).goalId;
  goalRecord(repo, { goal: id, phase: 'plan', expectedSha: headSha(repo) });
  const abs = join(repo, implFile);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, 'export const x = 1;\n');
  g(repo, ['add', '-A']);
  g(repo, ['commit', '-m', 'work']);
  goalRecord(repo, { goal: id, phase: 'implement', expectedSha: headSha(repo) });
  goalRecord(repo, { goal: id, phase: 'review', verdict: 'clean', expectedSha: headSha(repo) });
  goalRecord(repo, { goal: id, phase: 'verify', verdict: 'pass', expectedSha: headSha(repo) });
  return id;
}

test('improve-origin is FROZEN on the goal at start (not re-derived at merge)', () => {
  const repo = tmpRepo();
  const id = readyImproveGoal(repo, 'docs/notes.md');
  expect(readGoal(goalPath(repo, id)).improveOrigin).toBe(true);
});

test('merge REFUSES an improve-origin goal whose ACTUAL diff touches a protected path (under-declared)', () => {
  const repo = tmpRepo();
  const id = readyImproveGoal(repo, 'src/gate.ts'); // implement touches the referee, though not declared
  const res = mergeGoal(repo, id);
  expect(res.merged).toBe(false);
  expect(res.reason).toMatch(/protected/);
  expect(readGoal(goalPath(repo, id)).state).toBe('active'); // untouched
});

test('merge ALLOWS an improve-origin goal whose diff touches only non-protected files', () => {
  const repo = tmpRepo();
  const id = readyImproveGoal(repo, 'docs/notes.md'); // non-protected
  expect(mergeGoal(repo, id).merged).toBe(true);
});

test('autoMergeGoal ALSO refuses an improve-origin goal whose diff touches a protected path', () => {
  const repo = tmpRepo();
  const id = readyImproveGoal(repo, 'src/gate.ts', true);
  const res = autoMergeGoal(repo, id, { expectedSha: headSha(repo) });
  expect(res.merged).toBe(false);
  expect(res.reason).toMatch(/protected/);
  expect(readGoal(goalPath(repo, id)).state).toBe('active');
});

test('merge ALLOWS a NON-improve backlog-linked goal touching a protected path (no false-positive)', () => {
  const repo = tmpRepo();
  initRepo(repo);
  storeInit(repo);
  const plain = storeAdd(repo, { title: 'plain', body: '## Outcome\nx\n## Verification surface\nx\n## Boundaries\nx\n', type: 'spec' }).id;
  storePromote(repo, { id: 'task-plain', title: 'plain task', specId: plain }); // coco-goal-style task
  g(repo, ['add', '-A']);
  g(repo, ['commit', '-m', 'store + backlog']);
  const id = goalStart(repo, { objective: 'plain', maxFixRounds: 3, acceptanceChecks: [], backlogTaskId: 'task-plain' }).goalId;
  expect(readGoal(goalPath(repo, id)).improveOrigin).toBeUndefined(); // NOT improve-origin
  goalRecord(repo, { goal: id, phase: 'plan', expectedSha: headSha(repo) });
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'gate.ts'), 'export const x = 1;\n'); // a legit human/coco-goal referee change
  g(repo, ['add', '-A']);
  g(repo, ['commit', '-m', 'work']);
  goalRecord(repo, { goal: id, phase: 'implement', expectedSha: headSha(repo) });
  goalRecord(repo, { goal: id, phase: 'review', verdict: 'clean', expectedSha: headSha(repo) });
  goalRecord(repo, { goal: id, phase: 'verify', verdict: 'pass', expectedSha: headSha(repo) });
  expect(mergeGoal(repo, id).merged).toBe(true); // the gate is specific to improve-origin
});

test('improveCheckDiff catches a protected file RENAMED away (--no-renames surfaces the source)', () => {
  const repo = tmpRepo();
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'gate.ts'), 'export const x = 1;\n');
  g(repo, ['add', '-A']);
  g(repo, ['commit', '-m', 'add gate']);
  g(repo, ['checkout', '-b', 'feature']);
  g(repo, ['mv', 'src/gate.ts', 'src/gate2.ts']);
  g(repo, ['commit', '-m', 'rename away']);
  expect(improveCheckDiff(repo, 'main').protected).toContain('src/gate.ts');
});
