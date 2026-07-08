---
name: coco-improve
description: Use when the user types $coco-improve or /coco-improve, or asks to analyse coco's own loop history and propose an improvement to the coco skills/CLI. The self-improvement layer — reflect over the audit corpus, form ONE incremental, evidence-backed hypothesis, archive it as a LOCAL improve-spec card, then STOP. Propose-only: never promotes, never starts coco-loop, never edits live skills, never touches the referee.
---

# coco-improve

Turn coco's own **audit history** into ONE **incremental, evidence-backed improvement proposal** for the coco skills/CLI — archived as a local spec card for a human to review. You **reflect and propose**; the **human** decides whether to promote it; **coco-loop** (later) builds it under the usual Oracle-review + coco-verify + human-merge gate. You never build, never merge, never edit live skills, and never touch the referee.

Invoke: `$coco-improve` (Codex) / `/coco-improve` (Claude Code).

## Golden rules (do not deviate)

1. **Propose-only (slice-2 scope).** Produce ONE local improve-spec card and STOP. Do NOT promote it to the backlog, do NOT start coco-loop, do NOT edit any `skills/**` or source file directly. Promotion + building are the human's + coco-loop's job.
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
   Capture the returned `id`.
7. **Stop and hand off.**
   > Improve-spec archived as `<id>` (local): proposes `<one line>`, evidenced by `<audit window>`. Your call — review it, and if you agree, promote it to the backlog for `$coco-loop` to build under the usual Oracle-review + coco-verify + human-merge gate. coco-improve does not promote or build.

## Notes

- **No web research yet (slice 2).** Reflection is over the audit digest + the repo's own skills/CLI only. Web research is a later slice, gated on this being proven.
- **One proposal per run.** A single well-evidenced, incremental change a human can judge — not a batch.
- **The referee is sacred.** `coco improve check` is the code-owned boundary; rule 4 is not negotiable. If you find yourself wanting to touch `src/gate.ts`, verdict parsing, verify, merge/risk, the metrics, the MCP/CLI surface, the spec evaluator, or coco-improve's own files — STOP and tell the human it needs a referee-change goal outside coco-improve.
- **Low-N honesty.** The digest's sample gate and `safeToActOn` flag exist because loop outcomes are high-variance; treat a proposal as *evidence to test*, not proof. The spec's Success/Failure criteria are how a later human judges it — do not pre-declare victory.
