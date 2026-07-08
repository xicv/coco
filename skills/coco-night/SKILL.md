---
name: coco-night
description: Use when the user types $coco-night or /coco-night, or says “work while I sleep”, “pick the next task and implement it”, “run coco overnight”, or “take one queued task”. Safe overnight workflow — pick exactly one ready backlog task, or optionally create one via goal planning, then run one bounded coco-loop. Stops at merge-gate unless the user explicitly opted into --auto.
---

# coco-night

Run **one bounded overnight coco attempt**: choose exactly one ready task, implement it through `$coco-loop`, and stop safely. This is syntax sugar for:

1. `$coco-queue next` / `coco_next` — pick one ready task;
2. `$coco-loop` — implement that task under coco’s normal Oracle-review + coco-owned verify + merge gate.

It is not a daemon and not a scheduler. If the user later wants it on a timer, configure Codex app Automations to run this skill after the workflow is proven reliable.

Invoke:

```text
$coco-night
$coco-night --auto
$coco-night --plan-next
$coco-night <specific objective>
```

## What “night” means

- **One task only.** No batch processing, no “keep going until morning.”
- **No silent merge.** Default stops at `merge-gate` for the human. `--auto` grants forward consent only for this one goal and still uses coco’s risk gate.
- **No broad exploration.** If the queue is empty, stop unless the user passed `--plan-next` or an explicit objective.
- **Wake-up summary.** End with what happened, where it stopped, and the exact next command for the human.

## Golden rules

1. **Preflight first.** Run `coco doctor` and `coco audit validate` when available. If doctor has a blocking failure, audit is invalid, verify config is missing, Oracle is missing, the tree is dirty, or a goal is already active, stop with recovery steps.
2. **One coherent work unit.** Pick one `ready` task from `coco_next`; if the user gave a concrete objective, use that instead. Never start a second task after the first finishes.
3. **Queue before invention.** If no objective is provided, call `coco_next` first. If no ready task exists, stop unless `--plan-next` was passed.
4. **Plan-next is bounded.** With `--plan-next`, create a small task using `$coco-goal "pick the next safest loop-sized task for this project"`, then implement the first promoted ready task only. Prefer docs/tests/refactors/diagnostics over risky feature work when the project has no explicit queue.
5. **Use `$coco-loop` exactly.** Once a task/objective is selected, follow the normal `$coco-loop` rules. Do not copy/paste or fork the loop protocol here.
6. **Do not bypass consent.** Default human path stops at merge-gate. `--auto` may call `coco_merge` only because the user explicitly granted per-goal consent and only if risk policy allows it.
7. **Respect stop conditions.** Stop on `review-unavailable`, `stuck`, `budget-exceeded`, repeated verify aborts, rebase conflicts, missing test command, or any human-choice ambiguity.
8. **Leave a crisp report.** The user should wake up to a useful summary, not a transcript dump.

## Workflow

1. **Parse flags.**
   - `--auto`: pass `autoMergeAllowed:true` to goal start via `$coco-loop --auto`.
   - `--plan-next`: allowed to create one next task if queue is empty.
   - Any remaining text is a specific objective.
2. **Preflight.**
   - `coco doctor`
   - `coco audit validate` if the command exists
   - `git status --porcelain`
   - `coco health` if an active goal may exist
3. **Select work.**
   - If objective text exists: use it as the loop objective.
   - Else call `coco_next({ repoDir })` / `coco next`.
   - If a task exists: use its title/body and remember its id.
   - If none exists and `--plan-next` is false: stop with `$coco-goal` / `$coco-queue` suggestions.
   - If none exists and `--plan-next` is true: run the `$coco-goal` workflow to archive/promote one small next task, then re-run `coco_next`.
4. **Run one loop.**
   - Invoke/follow `$coco-loop` for exactly the selected task/objective.
   - If a backlog task was selected, pass its id as `backlogTaskId` through the normal loop path.
   - If `--auto` was passed, use the normal loop auto-merge path; do not create any new merge path here.
5. **Stop.**
   - On `merge-gate`: present human merge command and stop.
   - On auto-merge success: mark backlog task done through the normal loop path and stop.
   - On blocker: summarize blocker and recovery command; stop.

## Wake-up report

Use this shape at the end:

```text
◈ coco-night  ·  one-task overnight run
  Picked      <task id/title or objective>
  Result      <merged | merge-gate | blocked | no-ready-task>
  Proof       <verify pass/fail or why not reached>
  Stopped at  <nextAction / blocker>
  Next        <exact human command or next skill>

  source: coco-night · one task only · no silent merge
```

## Recommended automation

Only after `$coco-night` has worked manually, schedule it in Codex app Automations with a prompt like:

```text
$coco-night
```

or, for opt-in low-risk auto-merge:

```text
$coco-night --auto
```

Prefer a dedicated git worktree for scheduled runs so an overnight session cannot collide with your daytime working tree.
