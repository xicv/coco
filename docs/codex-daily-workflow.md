# Daily Codex.app workflow

This guide is the practical path for using coco every day from Codex.app.

## One-time setup

1. Install dependencies and build locally:

   ```sh
   pnpm install
   pnpm build
   ```

2. Dry-run the Codex setup helper:

   ```sh
   coco setup codex
   ```

   It reports the `~/.codex/config.toml` MCP change and the skill directories it would sync into `~/.agents/skills`.

3. Apply the setup when the dry-run looks right:

   ```sh
   coco setup codex --apply
   ```

   You can override paths with `--config <path>` and `--skills-dir <path>`.

4. Configure Oracle MCP. `.codex/config.toml.example` intentionally leaves Oracle as a local placeholder because different machines install Oracle differently.

5. Run:

   ```sh
   coco doctor
   ```

   Fix warnings that would block the full loop, especially missing `verify.testCommand`, missing MCP registration, or missing Oracle wiring.

## Start of session

Run:

```sh
coco doctor
coco-store status
coco next
```

Use the doctor output to catch broken local wiring before starting a long loop. Use the store status card and next-task command to see backlog/spec state without reading the whole repository.

## Turning intent into work

For vague or multi-step work, start with:

```text
$coco-goal <intent>
```

The goal skill should read the repo, research current external constraints where relevant, produce a strong GoalSpec, archive it as a `coco-store` spec, promote loop-sized tasks to `BACKLOG.md`, and stop.

## Choosing from the queue

To inspect the next ready task without implementing it:

```text
$coco-queue
```

This is read-only. It calls the code-owned queue first (`coco next` / `coco_next`), summarizes why the task is ready, and stops with the next suggested command.

## Building one task

For one implementation task, use:

```text
$coco-loop <objective>
```

or, when the backlog has ready tasks:

```text
$coco-loop
```

Use `--auto` only when you intentionally grant forward consent for this one goal:

```text
$coco-loop --auto <objective>
```

Auto-merge is still gated by clean review, coco-owned verify, base ancestry, risk policy, unchanged verification policy, and per-goal consent. Risk or verify-policy fallback returns to the human merge path.

## Overnight one-task mode

For a bounded “work while I sleep” attempt:

```text
$coco-night
```

`$coco-night` is queue + loop, not a daemon. It picks exactly one ready task, runs one normal coco-loop attempt, and leaves a wake-up report. By default it stops at `merge-gate`.

Only use auto when you explicitly want per-goal forward consent:

```text
$coco-night --auto
```

If the queue is empty and you want coco to create one small next task first:

```text
$coco-night --plan-next
```

Use Codex app Automations only after `$coco-night` works manually; skills define the method, automations define the schedule.

## Base branch

New goals branch from `workflow.baseBranch` in `coco.config.json` when set. Otherwise coco resolves the repo default branch (`origin/HEAD`, then `main`/`master`/`trunk`/`develop`, then the current branch). Use an explicit base only for unusual work:

```sh
coco goal start --objective "..." --base release/1.2
```

## Human merge checkpoint

The normal loop ends at `merge-gate`. The agent should present the exact command:

```sh
coco merge --goal <goalId>
```

If the goal changed `verify.testCommand`, coco refuses the default merge and requires the human to approve the explicit policy acknowledgement:

```sh
coco merge --goal <goalId> --ack-verify-policy-change
```

Approving that exact command is the merge consent. Do not approve blanket or always-allow merge behavior.

## Self-improvement

Run:

```text
$coco-improve
```

only when there is enough valid audit history. The improve skill should propose exactly one local improve-spec and one non-protected backlog task, then stop. It must not edit live code, start a loop, or merge.

## Pre-PR verification

Before a branch is ready for review, run:

```sh
pnpm run ci
```

`pnpm run ci` runs typecheck, tests, the deterministic `coco eval` safety fixtures, and build. Use
`pnpm run ci`, not `pnpm ci` — pnpm >=11 ships a built-in `ci` (clean-install) command that shadows
the package script and would silently reinstall instead of verifying. For referee-critical changes,
also run targeted tests for the exact invariant being changed or protected.

## Privacy and platform notes

- Read `docs/privacy-model.md` before sending roadmap/background material to Oracle.
- Read `docs/platform-support.md` before relying on non-macOS/Linux behavior.

## Troubleshooting checklist

- `coco doctor` reports `oracle MCP` missing: configure Oracle before plan/review gates.
- `goal status` warns about `verify.testCommand`: set `verify.testCommand` in committed `coco.config.json`.
- `$coco-night` finds no ready task: run `$coco-goal <intent>` or `$coco-night --plan-next`.
- `merge` refuses with `ack-verify-policy-change`: verify policy changed in the goal diff; inspect it, then approve the explicit acknowledgement command only if intended.
- `health` reports `review-unavailable`: fix Oracle login/wiring, then resume with `coco_goal_op_clear`.
- `health` reports `stalled`: inspect the current `nextAction`; do not guess the phase from chat memory.
- Verify is stuck running: use `coco doctor clean` for old terminal/orphaned verify runs; do not delete live goal state.
