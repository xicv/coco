# Audit-backed self-evolution

coco should improve because its **signals get better**, not because it edits itself more often. The self-evolution loop is deliberately conservative:

1. capture local, structured audit records;
2. validate the audit substrate;
3. add structured human feedback where the audit cannot infer quality;
4. digest signals deterministically;
5. propose one small, non-protected improvement;
6. attach or add an eval/non-regression check;
7. run the normal coco-loop review/verify/human-merge gate.

## Audit validity comes first

`coco audit validate` checks whether the local `.coco/audit.ndjson` stream is trustworthy enough to use as an improvement substrate. It reports torn/invalid lines and cross-record invariant failures such as merge records appearing before verify passes.

```sh
coco audit validate
```

`coco doctor` also surfaces audit validity as a data check. If audit validity fails, self-improvement should pause until a human fixes the audit substrate. A system that cannot trust its measurements must not rewrite its own workflow.

## Structured feedback

Some quality signals cannot be inferred from structural telemetry. Add lightweight human feedback after a loop:

```sh
coco audit feedback \
  --goal <goalId> \
  --kind goal-quality \
  --rating 2 \
  --tags vague-goal,weak-verification
```

Feedback kinds:

- `goal-quality` — the goal/spec was vague, too broad, missing proof, or well-scoped.
- `implementation-quality` — the implementation was incomplete, overbroad, clean, or robust.
- `loop-friction` — the workflow was annoying, slow, ambiguous, or smooth.
- `review-quality` — Oracle review found useful issues, missed issues, or generated noise.
- `verification-quality` — tests/verify were trustworthy or weak.
- `status-clarity` — Codex.app / Claude Code progress and recovery guidance was clear or confusing.

Feedback is redacted: tags and ratings are stored, and optional notes are hashed with length metadata. Raw note text is not written to the audit stream.

## Improve digest

`coco improve digest` reads the validated audit report and emits deterministic signals:

- Oracle reliability problems.
- Goal-quality feedback patterns.
- Status-clarity feedback patterns.
- Implementation-quality diagnostics.
- Audit-validity problems.
- Churn, verify failure, and merge-latency observations.

Only fired signals marked `safeToActOn:true` may become a `$coco-improve` proposal, and even then the proposal must pass protected-path checks and include an eval or explicit non-regression check.

## No eval, no improvement

A self-improvement proposal should answer:

- Which audit/feedback signal fired?
- What is the predeclared hypothesis?
- What mechanism should improve signal quality?
- What failure would disprove it?
- Which eval or regression test protects the behavior?

Use `coco eval` for deterministic safety fixtures and add new cases for recurring failure modes.

```sh
coco eval
```

A good self-improvement PR makes future loops safer or clearer while preserving all referee invariants. A bad one merely reduces friction by weakening scrutiny.

## What not to optimize

Never optimize these as primary success metrics:

- fewer review rounds;
- fewer fix rounds;
- faster time to merge;
- higher verify pass rate;
- more auto-merges.

These can indicate improvement only when paired with stronger signal quality and no increase in false-greens.

## Daily practice

After using coco for a real goal:

1. Run `coco audit report` to inspect the structural trace.
2. Add feedback if the goal or loop quality was materially good or bad.
3. Let `$coco-improve` act only after the sample gate passes.
4. Review the proposed spec/task as a hypothesis, not proof.
5. Run the task through `$coco-loop` like any other change.
