---
name: coco-improve
description: Use when the user types $coco-improve or /coco-improve, or asks to analyse coco's own loop history and propose an improvement to the coco skills/CLI. The self-improvement layer — validate the audit substrate, reflect over audit + structured feedback (plus bounded, cited web research on the signal's topic), form ONE incremental eval-backed hypothesis, archive it as a LOCAL improve-spec card, promote ONE non-protected loop-sized task, then STOP. Propose-only: never builds, never merges, never starts coco-loop, never edits live skills, never touches the referee.
---

# coco-improve

Turn coco's own **valid audit history + structured human feedback** into ONE **incremental, eval-backed improvement proposal** for the coco skills/CLI — archived as a local spec card and promoted as ONE loop-sized backlog task for a human to review. You **reflect and propose** (a spec + one non-protected task); the **human** decides whether to run it; **coco-loop** builds it under the usual Oracle-review + coco-verify + human-merge gate. You never build, never merge, never edit live skills, and never touch the referee.

Invoke: `$coco-improve` (Codex) / `/coco-improve` (Claude Code).

## Golden rules (do not deviate)

1. **Propose-only.** Archive ONE local improve-spec card AND promote ONE loop-sized, non-protected task linked to it (via `coco improve promote`, which enforces the protected-path guard in code), then STOP. Do NOT start coco-loop, do NOT build or merge, do NOT edit any `skills/**` or source file directly. Building + merging stay with coco-loop + the human.
2. **Audit-validity gate.** Start with `coco audit validate`. If `ok:false`, STOP and tell the user the audit substrate is not trustworthy enough for self-improvement. Do not act on invalid/torn/impossible telemetry.
3. **Insufficient-data gate.** Then run `coco improve digest`. If `sufficient:false`, STOP and tell the user there isn't enough audit history yet — never manufacture a proposal from a thin window.
4. **Act only on a live, safe signal.** Pick ONE signal with `status:"signal"` **and** `safeToActOn:true` (e.g. `oracle-reliability`, `goal-quality-feedback`, `status-clarity-feedback`). If none qualifies, STOP — report diagnostics and hand back. `recurring-churn`, `implementation-quality-feedback`, `verify-failures`, `human-merge-latency`, and `audit-validity` are diagnostic/observational unless code marks them safe.
5. **No eval, no improvement.** Every proposal must name an existing `coco eval` fixture it improves/protects OR add a new deterministic test/eval in the task body. Do not promote a task that cannot be falsified.
6. **Protected-path gate (hard, not advisory).** Before proposing, run `coco improve check <target-paths>` on the exact files the change would touch. If it returns `ok:false` (referee / metrics / CLI-MCP surface / evaluator / improve-self / runtime), STOP — that needs a **human-authored referee-change goal OUTSIDE coco-improve**. Never route a referee change through here.
7. **Incremental deltas only.** Propose the smallest targeted change (e.g. add a retry/resume clause to the loop skill or improve a progress card) — NEVER a wholesale `SKILL.md` rewrite.
8. **Carry the anti-goals.** Copy the digest's `antiGoals` verbatim into the spec's `Anti-goals` section. The target is **signal quality** (fewer false-greens / stalls / Oracle outages / unclear statuses), never throughput. An oracle-reliability fix must **not** loosen retry-once or verdict strictness.
9. **Local + redacted.** Archive the spec `--visibility local` so audit/feedback-derived content never travels to Oracle. Keep rejected alternatives inside the spec (or as local cards) — never as backlog churn.

## The loop

1. **Validate.** Run `coco audit validate`. `ok:false` → STOP (rule 2). Surface the failure codes, not raw audit lines.
2. **Digest.** Run `coco improve digest`. Read `sufficient`, `signals`, `antiGoals`, and feedback/audit counts. `sufficient:false` → STOP (rule 3).
3. **Pick a target signal.** The first signal with `status:"signal"` and `safeToActOn:true`. None → STOP (rule 4), reporting diagnostics.
4. **Reflect + bounded research.**
   a. **Read the repo** (reuse **Explore** / grep — never build an index) to locate the *smallest* incremental change that addresses the signal's cause.
   b. **Research the topic — privacy-critical.** A fired safe signal carries a code-defined `researchTopic`. Search **exactly that string** (≤2 searches, ≤3 sources; WebSearch / deep-research / context7 / ferris-search). **NEVER** put coco's state into a query — no repo name, file paths, ids, counts, timestamps, or audit `detail` — and **never send the digest, a spec, audit records, feedback, or local filenames to Oracle or any external model during research**. No `researchTopic` → skip research.
   c. **Form ONE hypothesis, with typed evidence.** An external claim needs a **cited resolvable URL**; a local claim needs **repo/audit/feedback evidence**; your own reasoning may appear only as a **labeled hypothesis** tied to one of those. A cited best-practice is **evidence to test, never a mandate**.
5. **Guard.** Run `coco improve check <the files X touches>`. `ok:false` → STOP (rule 6). A proposal may only touch **non-protected** files (skills/docs/non-referee code).
6. **Predeclare eval/non-regression.** Identify the exact existing `coco eval` case or test to protect the hypothesis, or state the new eval/test the task must add. This must be in the spec and task body.
7. **Author the improve-spec.** Write a spec body with **all** of these sections (coco-store REJECTS an improve spec missing any): `Outcome`, `Verification surface`, `Boundaries`, `Predeclared hypothesis`, `Audit evidence window`, `Expected mechanism`, `Success criteria`, `Failure criteria`, `Confounders`, `Rejected alternatives`, `Anti-goals`, `Research provenance`. Ground `Audit evidence window` in digest numbers (`window.goals`, `window.feedback`, `window.invalidAudit`, the signal's `sample` + `detail`) — never in a subjective read. `Verification surface` must name the eval/test.
8. **Archive (local).**
   ```sh
   coco-store add --type spec --title "improve: <short>" --tags coco-improve --visibility local <path-to-improve-spec.md>
   ```
   Capture the returned `id` as `SPEC_ID`.
9. **Promote ONE task (code-guarded).** Promote the single loop-sized change linked to the spec. `coco improve promote` runs the protected-path check on `--paths` **in code** and REFUSES (exit 3) if any target is protected:
   ```sh
   coco improve promote --spec "$SPEC_ID" --id "improve-<slug>" --title "improve: <short>" \
     --paths "<comma-separated target files>" --body "<what to change + how it is verified/evaled>" --priority medium
   ```
10. **Stop and hand off.**
   > Improve-spec `<SPEC_ID>` archived (local) and task `improve-<slug>` promoted to the backlog, evidenced by `<audit window + signal>`. Your call — review it, and if you agree, run `$coco-loop` to build it under the usual Oracle-review + coco-verify + human-merge gate. coco-improve does not build or merge.

## Notes

- **Research is bounded, cited, and private.** External research is the signal's `researchTopic` only — capped (≤2 searches / ≤3 sources), and **nothing about coco leaves the machine in a query** (no state in the query, no digest/spec/audit/feedback sent to Oracle or any external model).
- **One proposal per run.** A single well-evidenced, incremental change a human can judge — not a batch.
- **The referee is sacred.** `coco improve check` is the code-owned boundary; rule 6 is not negotiable. If you find yourself wanting to touch `src/gate.ts`, verdict parsing, verify, merge/risk, the metrics, the MCP/CLI surface, the spec evaluator, or coco-improve's own files — STOP and tell the human it needs a referee-change goal outside coco-improve.
- **Low-N honesty.** The digest's sample gates and `safeToActOn` flag exist because loop outcomes are high-variance; treat a proposal as *evidence to test*, not proof. The spec's Success/Failure criteria are how a later human judges it — do not pre-declare victory.
