---
name: coco-improve
description: Use when the user types $coco-improve or /coco-improve, or asks to analyse coco's own loop history and propose an improvement to the coco skills/CLI. The self-improvement layer — reflect over the audit corpus, form ONE incremental, evidence-backed hypothesis, archive it as a LOCAL improve-spec card, promote ONE non-protected loop-sized task, then STOP. Propose-only: never builds, never merges, never starts coco-loop, never edits live skills, never touches the referee.
---

# coco-improve

Turn coco's own **audit history** into ONE **incremental, evidence-backed improvement proposal** for the coco skills/CLI — archived as a local spec card and promoted as ONE loop-sized backlog task for a human to review. You **reflect and propose** (a spec + one non-protected task); the **human** decides whether to run it; **coco-loop** builds it under the usual Oracle-review + coco-verify + human-merge gate. You never build, never merge, never edit live skills, and never touch the referee.

Invoke: `$coco-improve` (Codex) / `/coco-improve` (Claude Code).

## Golden rules (do not deviate)

1. **Propose-only.** Archive ONE local improve-spec card AND promote ONE loop-sized, non-protected task linked to it (via `coco improve promote`, which enforces the protected-path guard in code), then STOP. Do NOT start coco-loop, do NOT build or merge, do NOT edit any `skills/**` or source file directly. Building + merging stay with coco-loop + the human.
2. **Insufficient-data gate.** Start with `coco improve digest`. If `sufficient:false`, STOP and tell the user there isn't enough audit history yet — never manufacture a proposal from a thin window.
3. **Act only on a live, safe signal.** Pick ONE signal with `status:"signal"` **and** `safeToActOn:true` (today only `oracle-reliability`). If none qualifies, STOP — report the digest's diagnostics and hand back. `recurring-churn`, `verify-failures`, and `human-merge-latency` are **diagnostic/observational only, NEVER optimisation targets** (optimising them rewards weaker scrutiny).
4. **Protected-path gate (hard, not advisory).** Before proposing, run `coco improve check <target-paths>` on the exact files the change would touch. If it returns `ok:false` (referee / metrics / CLI-MCP surface / evaluator / improve-self / runtime), STOP — that needs a **human-authored referee-change goal OUTSIDE coco-improve**. Never route a referee change through here.
5. **Incremental deltas only.** Propose the smallest targeted change (e.g. add a retry/resume clause to the loop skill) — NEVER a wholesale `SKILL.md` rewrite (that collapses hard-won context).
6. **Carry the anti-goals.** Copy the digest's `antiGoals` verbatim into the spec's `Anti-goals` section. The target is **signal quality** (fewer false-greens / stalls / Oracle outages), never throughput. An oracle-reliability fix must **not** loosen retry-once or verdict strictness.
7. **Local + redacted.** Archive the spec `--visibility local` so audit-derived content never travels to Oracle. Keep rejected alternatives inside the spec (or as local cards) — never as backlog churn.

## The loop

1. **Digest.** Run `coco improve digest`. Read `sufficient`, `signals`, `antiGoals`. `sufficient:false` → STOP (rule 2).
2. **Pick a target signal.** The first signal with `status:"signal"` and `safeToActOn:true`. None → STOP (rule 3), reporting the diagnostics.
3. **Reflect.** Read the relevant skill/CLI (reuse **Explore** / grep — never build an index) to locate the *smallest* incremental change that addresses the signal's cause. Form ONE hypothesis: *"changing X in `<file>` will reduce `<signal>` because `<mechanism>`."* Note 1–2 rejected alternatives and why.
4. **Guard.** Run `coco improve check <the files X touches>`. `ok:false` → STOP (rule 4). A proposal may only touch **non-protected** files (skills/docs/non-referee code).
5. **Author the improve-spec.** Write a spec body with **all** of these sections (coco-store REJECTS an improve spec missing any): `Outcome`, `Verification surface`, `Boundaries`, `Predeclared hypothesis`, `Audit evidence window`, `Expected mechanism`, `Success criteria`, `Failure criteria`, `Confounders`, `Rejected alternatives`, `Anti-goals`. Ground `Audit evidence window` in the digest numbers (`window.goals`, the signal's `sample` + `detail`) — never in a subjective read.
6. **Archive (local).**
   ```sh
   coco-store add --type spec --title "improve: <short>" --tags coco-improve --visibility local <path-to-improve-spec.md>
   ```
   Capture the returned `id` as `SPEC_ID`.
7. **Promote ONE task (code-guarded).** Promote the single loop-sized change linked to the spec. `coco improve promote` runs the protected-path check on `--paths` **in code** and REFUSES (exit 3) if any target is protected:
   ```sh
   coco improve promote --spec "$SPEC_ID" --id "improve-<slug>" --title "improve: <short>" \
     --paths "<comma-separated target files>" --body "<what to change + how it's verified>" --priority medium
   ```
   `--paths` are the exact files the change will touch (skills/docs/non-referee code). If it refuses, the target is protected → STOP (rule 4): that needs a human-authored referee-change goal outside coco-improve.
8. **Stop and hand off.**
   > Improve-spec `<SPEC_ID>` archived (local) and task `improve-<slug>` promoted to the backlog, evidenced by `<audit window>`. Your call — review it, and if you agree, run `$coco-loop` to build it under the usual Oracle-review + coco-verify + human-merge gate. coco-improve does not build or merge.

## Notes

- **No web research yet** (deferred to a later slice). Reflection is over the audit digest + the repo's own skills/CLI only.
- **One proposal per run.** A single well-evidenced, incremental change a human can judge — not a batch.
- **The referee is sacred.** `coco improve check` is the code-owned boundary; rule 4 is not negotiable. If you find yourself wanting to touch `src/gate.ts`, verdict parsing, verify, merge/risk, the metrics, the MCP/CLI surface, the spec evaluator, or coco-improve's own files — STOP and tell the human it needs a referee-change goal outside coco-improve. Even if a promoted task under-declares its `--paths`, an improve-origin goal whose **actual diff** touches a protected path is **refused at merge** (code-enforced) — a referee change simply cannot ride in through coco-improve.
- **Low-N honesty.** The digest's sample gate and `safeToActOn` flag exist because loop outcomes are high-variance; treat a proposal as *evidence to test*, not proof. The spec's Success/Failure criteria are how a later human judges it — do not pre-declare victory.
