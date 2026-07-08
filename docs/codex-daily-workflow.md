# Daily Codex.app workflow

This guide is the practical path for using coco every day from Codex.app.

## One-time setup

1. Install dependencies and build locally:

   ```sh
   pnpm install
   pnpm build
   ```

2. Configure the coco MCP server in Codex. Start from `.codex/config.toml.example` and copy the relevant blocks into `~/.codex/config.toml`.

3. Install the skills in your agent skills directory. Keep the installed skills in sync with this repository when developing coco itself.

4. Run:

   ```sh
   coco doctor
   ```

   Fix warnings that would block the full loop, especially missing `verify.testCommand`, missing MCP registration, or missing Oracle wiring.

## Start of session

Run:

```sh
coco doctor
coco-store status
```

Use the doctor output to catch broken local wiring before starting a long loop. Use the store status card to see backlog/spec state without reading the whole repository.

## Turning intent into work

For vague or multi-step work, start with:

```text
$coco-goal <intent>
```

The goal skill should read the repo, research current external constraints where relevant, produce a strong GoalSpec, archive it as a `coco-store` spec, promote loop-sized tasks to `BACKLOG.md`, and stop.

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

Auto-merge is still gated by clean review, coco-owned verify, base ancestry, risk policy, and per-goal consent. Risk fallback returns to the human merge path.

## Human merge checkpoint

The normal loop ends at `merge-gate`. The agent should present the exact command:

```sh
coco merge --goal <goalId>
```

Approving that exact command is the merge consent. Do not approve blanket or always-allow merge behavior.

## Self-improvement

Run:

```text
$coco-improve
```

only when there is enough audit history. The improve skill should propose exactly one local improve-spec and one non-protected backlog task, then stop. It must not edit live code, start a loop, or merge.

## Pre-PR verification

Before a branch is ready for review, run:

```sh
pnpm ci
```

For referee-critical changes, also run targeted tests for the exact invariant being changed or protected.

## Troubleshooting checklist

- `coco doctor` reports `oracle MCP` missing: configure Oracle before plan/review gates.
- `goal status` warns about `verify.testCommand`: set `verify.testCommand` in committed `coco.config.json`.
- `health` reports `review-unavailable`: fix Oracle login/wiring, then resume with `coco_goal_op_clear`.
- `health` reports `stalled`: inspect the current `nextAction`; do not guess the phase from chat memory.
- Verify is stuck running: use `coco doctor clean` for old terminal/orphaned verify runs; do not delete live goal state.
