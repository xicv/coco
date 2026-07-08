import { expect, test } from 'vitest';
import type { StatusReport } from '../src/commands/goalStatus.js';
import type { NextAction } from '../src/gate.js';
import type { SpecProgress } from '../src/store/commands.js';
import { loopView } from '../src/progress/loop.js';
import { storeView } from '../src/progress/store.js';
import { PROGRESS_FORMAT, progressField, renderView } from '../src/progress/view.js';

const ALL_ACTIONS: NextAction[] = [
  'wrong-branch',
  'commit-or-revert',
  'rebase-needed',
  'plan',
  'implement',
  'review',
  'fix',
  'escalate-human',
  'verify',
  'merge-gate',
  'none',
];

function report(over: Partial<StatusReport> = {}): StatusReport {
  return {
    goalId: 'goal-20260707-0949-add-retry',
    state: 'active',
    base: 'main',
    branch: 'coco/goal-20260707-0949-add-retry',
    currentBranch: 'coco/goal-20260707-0949-add-retry',
    nextAction: 'plan',
    headSha: 'a1b2c3d4e5f6',
    maxFixRounds: 5,
    live: { tHead: 't0', treeClean: true, onBranch: true, baseMerged: true },
    facts: { implementAtEpoch: false, latestReview: 'none', latestVerify: 'none', fixRounds: 0 },
    warningLevel: 'none',
    progressKey: 'k',
    ...over,
  };
}

test('renderView emits a fenced text block with aligned rows and provenance footer', () => {
  const md = renderView({
    skill: 'coco-loop',
    subject: 'goal-x',
    rows: [
      { label: 'Checkpoint', value: 'planning' },
      { label: 'Next', value: 'plan — consult Oracle' },
    ],
    provenance: 'goal-x · a1b2c3d · next=plan',
  });
  expect(md.startsWith('```text\n')).toBe(true);
  expect(md.endsWith('\n```')).toBe(true);
  expect(md).toContain('◈ coco-loop  ·  goal-x');
  // labels padded to a common width (Checkpoint is longest) so the values align
  expect(md).toContain('  Checkpoint   planning');
  expect(md).toContain('  Next         plan — consult Oracle');
  expect(md).toContain('  goal-x · a1b2c3d · next=plan');
});

test('progressField carries the version tag', () => {
  const f = progressField('x');
  expect(f).toEqual({ format: 'coco-progress-v1', markdown: 'x' });
  expect(PROGRESS_FORMAT).toBe('coco-progress-v1');
});

test('loopView renders every nextAction without throwing and stamps provenance', () => {
  for (const na of ALL_ACTIONS) {
    const v = loopView(report({ nextAction: na }));
    expect(v.skill).toBe('coco-loop');
    expect(v.rows.length).toBeGreaterThanOrEqual(7);
    expect(v.provenance).toContain(`next=${na}`);
    // the whole thing renders to a fenced block cleanly
    expect(renderView(v)).toContain('◈ coco-loop');
  }
});

test('loopView fix card shows the round and the blocking review, glyph + words', () => {
  const v = loopView(
    report({ nextAction: 'fix', facts: { implementAtEpoch: true, latestReview: 'blocking', latestVerify: 'none', fixRounds: 2 } }),
  );
  const byLabel = Object.fromEntries(v.rows.map((r) => [r.label, r.value]));
  expect(byLabel.Checkpoint).toBe('fixing (round 2/5)');
  expect(byLabel.Verified).toContain('plan ✓');
  expect(byLabel.Verified).toContain('implement ✓');
  expect(byLabel.Verified).toContain('review ✗ blocking'); // word-form alongside the glyph
  expect(byLabel.Remaining).toBe('fix → review → verify → merge');
  expect(byLabel.Next).toContain('fix');
});

test('loopView verify-pass at merge-gate reads clean + pass and keeps command in recovery only', () => {
  const v = loopView(
    report({
      nextAction: 'merge-gate',
      facts: { implementAtEpoch: true, latestReview: 'clean', latestVerify: 'pass', fixRounds: 0 },
      edge: { kind: 'merge-ready', detail: 'ready', command: 'coco merge --goal goal-20260707-0949-add-retry' },
    }),
  );
  const byLabel = Object.fromEntries(v.rows.map((r) => [r.label, r.value]));
  expect(byLabel.Verified).toContain('review ✓ clean');
  expect(byLabel.Verified).toContain('verify ✓ pass');
  expect(byLabel.Next).toContain('awaiting human approval');
  expect(byLabel.Recovery).toContain('coco merge');
});

test('loopView edge card shows wrong branch recovery command', () => {
  const v = loopView(
    report({
      nextAction: 'wrong-branch',
      currentBranch: 'main',
      edge: { kind: 'wrong-branch', detail: 'currently on main', command: 'git checkout coco/goal-20260707-0949-add-retry' },
      warningLevel: 'warn',
    }),
  );
  const byLabel = Object.fromEntries(v.rows.map((r) => [r.label, r.value]));
  expect(byLabel.Checkpoint).toContain('wrong branch');
  expect(byLabel.Branch).toContain('main → main');
  expect(byLabel.Recovery).toBe('git checkout coco/goal-20260707-0949-add-retry');
  expect(v.provenance).toContain('level=warn');
});

test('storeView aggregates backlog counts, spec completion, and the latest roadmap line', () => {
  const specs: SpecProgress[] = [
    { spec: 'spec-a', total: 3, done: 3, byStatus: { done: 3 }, tasks: [] },
    { spec: 'spec-b', total: 4, done: 1, byStatus: { done: 1, ready: 2, blocked: 1 }, tasks: [] },
    { spec: 'unlinked', total: 1, done: 0, byStatus: { ready: 1 }, tasks: [] },
  ];
  const v = storeView(specs, '# Roadmap\n\n- Layer 2 auto-merge\n- Layer 3: multi-repo goals\n');
  const byLabel = Object.fromEntries(v.rows.map((r) => [r.label, r.value]));
  expect(v.skill).toBe('coco-store');
  // 8 tasks total, statuses in preferred order (ready, blocked, done), unknown appended
  expect(byLabel.Backlog).toBe('8 tasks  ·  ready 3 · blocked 1 · done 4');
  // two real specs: spec-a complete, spec-b in progress; unlinked surfaced separately
  expect(byLabel.Specs).toBe('2  ·  1 complete · 1 in progress  ·  1 unlinked');
  expect(byLabel.Roadmap).toBe('▸ "Layer 3: multi-repo goals"');
});

test('storeView with an empty store degrades gracefully', () => {
  const v = storeView([], '# Roadmap\n\n(nothing yet)\n');
  const byLabel = Object.fromEntries(v.rows.map((r) => [r.label, r.value]));
  expect(byLabel.Backlog).toBe('no tasks yet');
  expect(byLabel.Specs).toBe('none');
  expect(byLabel.Roadmap).toBe('(empty)');
});
