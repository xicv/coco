---
name: coco-goal
description: Use when the user types $coco-goal or /coco-goal, or asks to turn a weak/vague intent ("help me do xyz") into a real, achievable, archivable goal before building. CEO layer of coco — read codebase, research, decompose into a strong-goal contract, grill only when underspecified, archive the GoalSpec, promote loop-sized steps to the backlog, then STOP. Never starts coco-loop itself.
---

# coco-goal

Turn a **weak intent** into a **strong, achievable, archivable GoalSpec**, then promote loop-sized BACKLOG steps linked back to that spec — and hand the next move to the human. You are the **CEO** (define *what* + *why* + *how it's proven*); **coco-loop** is the CTO that executes; **coco-store** is where the goal is archived and tracked; the **human** decides when to start building.

Invoke: `$coco-goal <intent>` (Codex) / `/coco-goal <intent>` (Claude Code).

## Golden rules (do not deviate)

1. **Skill-first.** Do the interactive work here (read/research/decompose/grill). Do NOT add coco runtime code for it.
2. **Ground before you plan.** Read the repo when one exists (reuse Explore / grep / glob / file reads — never build an index) and pull current external context via web research *before* decomposing.
3. **Produce the 6-element strong-goal contract** (from OpenAI Codex's `/goal` spec): **Outcome**, **Verification surface** (the test / benchmark / artifact / command that *proves* it's done), **Constraints** (what must not regress), **Boundaries** (files/tools/resources it may touch), **Iteration policy**, **Blocked-stop condition** — plus **loop-sized Steps**.
4. **Achievable, not aspirational.** Every step must have a plausible path AND a local verification surface. Flag or rewrite any step that doesn't; drop what can't be defended.
5. **Grill only when genuinely underspecified** (rule below). Over-asking hurts more than it helps — default to resolving ambiguity from repo evidence, research, or a conservative boundary.
6. **You never start coco-loop.** After archive + promote, STOP and hand the next decision to the human (like `/goal` lifecycle control — the human owns transitions).

## The loop

1. **Capture intent.** Use the text after `$coco-goal` / `/coco-goal`. If empty, ask for one goal and stop.
2. **Read the codebase** (if present) — Explore / grep / glob / file reads. No index. Understand the relevant subsystems, tests, and constraints that shape the goal.
3. **Research** the latest external context that affects achievability, boundaries, or verification (dependency/API behavior, platform limits, recent ecosystem changes, security/standards where relevant). Keep only findings that change the goal.
4. **Decompose** into one GoalSpec body with these exact sections: `Outcome`, `Verification surface`, `Constraints`, `Boundaries`, `Iteration policy`, `Blocked-stop`, `Steps`. **Scope-sense first — match decomposition depth to problem size:** a trivial/small goal is **one** step (don't manufacture ceremony — over-decomposing a 2-line change is a known failure mode); only a genuinely large goal fans into several. Each Step must be **loop-sized** and satisfy these granularity rules:
   - **One deliverable, not two** — split a step that bundles two *distinct* deliverables, but a change **and its own tests/verification is one outcome** (the tests are how it's proven, not a second thing) — never split verification off from what it verifies.
   - **A named proof, matched to the task type** — each step states how it's proven done, appropriate to its kind: *code* → a check that **fails before and passes after**; *docs* → the artifact exists / renders / links resolve; *refactor* → existing tests stay green and behaviour is unchanged; *migration* → it runs cleanly (and is reversible); *spike* → a written finding/decision. If you can't name a proof, the step isn't ready — resolve it (research/grill), don't ship a vague done-state.
   - **Blast-radius split trigger** — a step likely to touch **≥ ~4 files** or a large diff is a split candidate; prefer thin **vertical slices** (one outcome end-to-end) over finishing a whole horizontal layer at once (agent success drops sharply as a task's file blast-radius grows).
   - **Order by dependency; mark parallel-safe** — sequence steps whose inputs depend on an earlier step's output; steps touching **disjoint** files can run independently. Record this with `--depends-on` on promote.
   - **Don't over-split up front** — decompose only as far as the problem clearly warrants; if a promoted step proves too big once the loop reaches it (repeated blocking reviews / `stuck`), split it *then* (demand-driven re-decomposition) rather than guessing every leaf now.
5. **Feasibility / achievability pass.** Optionally ask Oracle (`$oracle` / the `consult` tool) to pressure-test it. Flag/rewrite any step lacking a path, a verification surface, bounded scope, or a stop condition.
6. **Grill gate (bounded).** Only if the GoalSpec is still genuinely underspecified after steps 2–5 — trigger a grill (grill-me / brainstorming style) when any of these is **missing or materially ambiguous** and can't be resolved from repo/research: the desired **Outcome**, the **Verification surface**, a hard **Boundary**, the **Blocked-stop**, or a **product/user choice that changes the implementation**. Keep it targeted; **cap at ~3 rounds**, then proceed with the best defensible reading. Scale depth to difficulty — a small, clear goal needs no grilling.
7. **Iterate** steps 2–6 only while material ambiguity remains. Stop as soon as the contract is settled.
8. **Archive the GoalSpec** as a coco-store `spec` card. Write the settled body to a file, then:

   ```sh
   coco-store add --type spec --title "<goal title>" --intent "<original intent>" --tags coco-goal,spec <path-to-goalspec.md>
   ```

   coco-store **rejects a spec missing `Outcome` / `Verification surface` / `Boundaries`** — that presence check is the guard that a weak goal can't be archived. Capture the returned JSON `id` as `SPEC_ID`.
9. **Promote each loop-sized step** to the backlog, linked to the spec:

   ```sh
   coco-store promote --id "<step-id>" --title "<step title>" --body "<what + its verification surface>" --priority medium --depends-on "<comma-separated deps>" --spec "$SPEC_ID"
   ```

   `--spec` stamps `links.spec: $SPEC_ID` on the task so it's traceable back to its GoalSpec.
10. **Stop and hand off.** Report:

    > GoalSpec archived as `<SPEC_ID>`; steps promoted to the backlog and linked to it.
    > Your call on the next move: start a coco-loop for the first ready step (`/coco-loop` — it will pick it up via `coco_next`), revise the GoalSpec, or stop here.

    Do NOT invoke coco-loop yourself.

## Progress card (self-reported phase)

coco-goal keeps **no runtime state** (rule 1/6 — it never writes `.coco/goals`), so there's no engine to compute progress from. Instead, echo this **canonical card** when you *enter* a new phase, so the human sees native-looking progress in the Codex macOS app in the **same `◈ coco` visual language** as coco-loop / coco-store. The 8 phases are: **Capture · Read · Research · Decompose · Feasibility · Grill · Archive · Promote**.

Echo it **verbatim** (fill in the values), as its own message, on each phase entry — mark done phases, the current one with `▸`, and any skipped phase (e.g. no grill needed) as `skipped`:

````
```text
◈ coco-goal  ·  <short intent>
  Phase        Decompose (4/8)
  Done         Capture · Read · Research
  Now          Decompose ▸
  Next         Feasibility · Grill · Archive · Promote

  source: coco-goal (self-reported) · non-authoritative
```
````

**This card is display only** — the self-reported phase position must **never** affect archiving, promoting, or any loop gating (those stay driven by the real artifacts). Don't re-echo the same phase; only on a change. At `Promote`, follow it with the coco-computed hand-off (spec id + promoted task count from the `coco-store` output), which is the authoritative record.

## Notes

- **Composes, doesn't duplicate.** Use the existing **Explore** capability for codebase reading, web search for research, and **grill-me** / **brainstorming** for the (bounded) interactive refinement — don't reimplement them here.
- **One GoalSpec → N loop goals.** A big goal becomes several independently verifiable backlog steps; coco-loop runs one at a time (one goal per repo). Keep each step small enough to pass its own review + verify.
- **Archive is durable.** The spec card lives in `.coco/store` (the PM layer), so the goal survives session drops and stays trackable/linkable — the CEO artifact, separate from the loop's runtime state.
- **coco-goal never merges, never starts the loop, never writes `.coco/goals`.** It only authors, archives (`coco-store add`), and promotes (`coco-store promote`). Every build/merge decision stays with the human via coco-loop.
