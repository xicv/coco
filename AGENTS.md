# Agent instructions for coco

This repository builds `coco`, a small loop-engineering referee for AI coding agents. The core product boundary is intentionally strict: the agent may plan, implement, review, and verify through the referee, but merge authority stays explicit and goal-scoped.

## Project shape

- `src/commands/**` contains CLI/domain command entry points.
- `src/gate.ts`, `src/epoch.ts`, `src/state.ts`, `src/git.ts`, `src/lock.ts`, `src/oracleVerdict.ts`, `src/commands/goal*.ts`, `src/commands/verify.ts`, and `src/commands/merge.ts` are referee-critical.
- `src/mcp/**` exposes the same referee through MCP tools.
- `src/store/**` is the PM/knowledge layer. It must not import or mutate goal/referee state.
- `src/improve/**` implements propose-only self-improvement guards and audit-derived signals.
- `skills/**` contains the user-facing Codex/Claude skills.
- `.coco/**` is local runtime state and must not be committed.
- `.coco-store/**` is the local PM store. Treat audit-derived/self-improvement content as local unless code explicitly marks it shared.

## Commands

Use pnpm.

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm ci
```

`pnpm ci` is the expected pre-PR verification command. If a change touches a safety-critical gate, run the most specific affected tests as well as `pnpm ci`.

## Safety invariants

Do not weaken these without an explicit, human-authored referee-change goal and tests that prove the new behavior:

1. A review verdict must come from strict Oracle output parsing; never add a caller-asserted clean verdict path.
2. Verify is coco-owned. The agent must not self-report `pass`.
3. Review and verify are bound to the current HEAD/tree and require a clean working tree.
4. A tree that was blocking/failing must not be silently re-blessed without new code and fresh review/verify.
5. Merge requires active goal, correct branch, clean tree, implement in the current epoch, clean review, passing verify, and base ancestry.
6. Auto-merge is opt-in per goal and must never loosen the human merge path.
7. Improve-origin changes must not touch protected referee, metrics, store, or improve-self paths.
8. Store/pack must preserve the privacy boundary: local cards and secret-looking files must not be sent to Oracle.

## Coding style

- Keep domain rules deterministic and testable. Prefer pure derivation functions for state-machine facts.
- Keep LLM/Oracle assumptions in skills or explicit integration seams, not in the referee core.
- Fail closed at trust boundaries: malformed state, ambiguous verdicts, missing verify config, path traversal, stale/forged verify runs, and protected-path changes should stop the loop rather than infer success.
- Avoid broad rewrites of `skills/**`; make small, reviewable deltas because skill text is part of the safety surface.
- Add regression tests for every bug fix. For referee changes, include the concrete false-green or unsafe-transition scenario.

## Branch and merge expectations

- Work on a branch; do not commit directly to `main`.
- Do not merge from an agent session unless the user explicitly approves the exact merge action for that goal/branch.
- A ready PR should explain the safety impact, affected commands/tools, and verification run.

## Daily Codex workflow

For normal development in Codex.app:

1. Run `coco doctor` before a long session.
2. Use `$coco-goal` for vague or multi-step work.
3. Use `$coco-loop` for one loop-sized implementation task.
4. Use `$coco-store status` or `coco-store progress` for project state.
5. Use `$coco-improve` only to propose one evidence-backed improvement; it must not build, edit, or merge the proposal itself.
