<p align="center">
  <img src="assets/coco-icon.png" alt="coco" width="180" />
</p>

# coco

**A minimal loop-engineering referee for AI coding agents** (Codex / Claude Code).

coco is one small loop: **plan → implement → review → fix → verify → human-merge**, gated at every step by a git-**tree-hash**-bound, **epoch-scoped** state machine (an append-only event log; all gates derived; `coco merge` is the only merge path and is human-terminal by design). **ChatGPT-Pro ("Oracle")** is the review brain; the coding agent is the hands; **you** own the merge. The referee is deliberately tiny — it never writes your code, it just refuses the unsafe next step.

Three layers, each with a `$`/`/` skill trigger:

| Layer | Skill | Role |
|---|---|---|
| **CEO** | `$coco-goal` | turn a weak intent into a strong, achievable, archivable **GoalSpec** (Outcome · Verification surface · Constraints · Boundaries · Iteration · Blocked-stop) + loop-sized steps |
| **PM** | `$coco-store` / `coco-store` | organise / track / visualise the knowledge base — ResourceCards, roadmap, backlog progress, links, context `pack`, mermaid project graph |
| **CTO** | `$coco-loop` | drive the gated build loop with Oracle review + coco-owned verify |

## coco is built with coco

coco builds itself. Every feature below was driven through `$coco-loop` on coco's own repo — Oracle plans it, the agent implements, Oracle reviews the real diff, coco runs coco's own tests to verify, and a human merges. That dogfooding is the toughest test of the loop, and it works: Oracle's review gate has caught a genuine correctness bug in **every** phase — from a monotonic-verdict bypass to a `coco init` that scaffolded its config file *before* checking for staged changes (a working-tree leak), each found by reviewing the committed diff, not by trusting the author. The loop converges, the human still owns the merge, and coco never self-merges.

As of **v0.4**, coco also **improves itself**: `coco-audit` records every meaningful loop action to a local trail, `coco-doctor` checks its own prerequisites and health, and `$coco-improve` reflects over that trail to draft ONE evidence-backed change — **archived, never applied**, for a human to run through the same plan → review → verify → merge gate. Crucially, the self-improvement loop is bound by the very referee it would improve: an improve-origin change can **never** merge an edit to coco's own gate, verdict parsing, verify, or metrics — enforced in code at both propose *and* merge time (via an `improveOrigin` flag frozen at goal start). coco can propose how to sharpen its own loop; it cannot quietly weaken the gate that keeps it honest.

## What's new

- **Daily Codex hardening** — root `AGENTS.md` captures durable repo/agent guidance, `.codex/config.toml.example` shows local MCP wiring, `coco setup codex` dry-runs/applies MCP + skill setup, and `docs/codex-daily-workflow.md` gives the Mac Codex.app daily path.
- **Referee state hardening** — persisted `.coco/goals/*.json` is schema-validated and stamped with a goal schema version instead of being blindly cast from JSON.
- **Configurable base branch + collision-safe goal ids** — new goals use `workflow.baseBranch` / repo default branch, with explicit `--base` override; repeated same-minute objectives get a safe numeric suffix instead of colliding with existing goal files/branches.
- **Verification-policy acknowledgement** — a goal that changes `verify.testCommand` can still be reviewed/verified, but human merge now requires explicit `--ack-verify-policy-change`; auto-merge falls back to that human path.
- **Additive auto-merge policy globs** — user `autoMerge.sensitiveGlobs` / `testGlobs` add to conservative defaults unless `replaceDefault*Globs` is explicitly set.
- **Command registry + deterministic evals** — `coco commands` exposes command metadata and `coco eval` runs lightweight deterministic safety-regression fixtures; `pnpm ci` includes the eval gate.
- **`coco-mcp` package bin** — the npm package exposes `coco-mcp` alongside `coco` and `coco-store`, matching the documented MCP setup path; the MCP server reports the package version.
- **CI-ready verification** — `pnpm typecheck`, `pnpm test`, `pnpm eval`, `pnpm build`, and `pnpm ci` are wired into a GitHub Actions matrix on Linux and macOS.
- **Privacy and platform docs** — `docs/privacy-model.md` documents what may leave the machine; `docs/platform-support.md` documents the current macOS/Linux support contract.
- **`coco-improve` — self-improving loop (propose-only)** — `$coco-improve` reflects over the `coco audit` corpus (with an **insufficient-data gate** so a thin history can't manufacture findings), forms ONE incremental, evidence-backed hypothesis, and archives it as a **local** improve-spec + one loop-sized backlog task for a human to run through `$coco-loop`. It never builds, merges, or edits live skills.
- **`coco-audit` — automatic trajectory capture** — every meaningful loop/goal action (reviews, fixes, verify results, Oracle outages, merges) is recorded to a local, gitignored `.coco/audit.ndjson` at the domain chokepoint.
- **`coco doctor` — one-shot health check** — a read-only, **no-LLM** diagnostic that aggregates environment (node/git/version), repo setup (init, `verify.testCommand`), wiring (merge-guard hooks, coco + Oracle MCP, watchdog), active-goal health, and data hygiene. `coco doctor clean` reclaims stale verify-run cache — **dry-run by default**, `--apply` to delete, and only terminal/orphaned runs.
- **Native `◈ coco` progress cards** — every layer surfaces a consistent, fenced **checkpoint card** so you can watch progress natively in the Codex app.
- **`coco-store` PM surface** — `list --group-by`, `progress` (backlog by status, grouped by spec), `link` (with a content-addressed links-merge), and `viz` (a structural mermaid project graph).
- **Context `pack`** wires the store → loop: the loop reads a bounded coco-store brief before it plans.

## Prerequisites

- **Node.js ≥ 20.**
- **macOS or Linux.** Windows native support is not guaranteed yet; use WSL. See `docs/platform-support.md`.
- **An MCP-aware coding agent** — [OpenAI Codex](https://developers.openai.com/codex) or [Claude Code](https://claude.ai/code) — with the `coco` (and `oracle`) MCP servers registered and the `coco-goal` / `coco-store` / `coco-loop` skills installed under the agent's skills dir.
- **A ChatGPT Pro subscription + Oracle — required for the review brain.** coco's plan/review gate runs **GPT‑5.x‑Pro** through the [`@steipete/oracle`](https://github.com/steipete/oracle) lane, which drives a logged-in **ChatGPT Pro** browser session (the `consult` MCP tool). Without an active **ChatGPT Pro** subscription and Oracle configured, the CLIs still run, but the Oracle-gated plan/review steps can't — by design coco then **fails to the human, never a false green**.

> coco is opinionated and not turnkey: it assumes the wiring above. The `coco` / `coco-store` CLIs and the `coco-mcp` stdio server work standalone, but the full loop needs the agent + skills + Oracle in place.

## Install

```sh
npm install -g @nickcao/coco
```

Provides `coco` (the referee), `coco-store` (the PM layer), and `coco-mcp` (the MCP stdio server for MCP-aware agents).

## Daily Codex.app setup

For Codex.app, start from the durable guidance and examples in this repo:

```sh
cat AGENTS.md
cat .codex/config.toml.example
cat docs/codex-daily-workflow.md
```

Then dry-run/apply setup and check health:

```sh
coco setup codex
coco setup codex --apply
coco doctor
```

The daily path is:

1. `$coco-goal <intent>` for vague or multi-step work.
2. `$coco-loop` for one ready backlog task, or `$coco-loop <objective>` for a specific task.
3. `coco-store status` / `coco-store progress` for PM state.
4. `$coco-improve` only to propose one evidence-backed improvement; it never edits or merges the proposal itself.

## Quick taste (CLI, no agent)

```sh
cd your-repo
coco init                              # bootstrap .coco/ + a starter coco.config.json on a clean main
coco setup codex                       # dry-run local Codex MCP + skill setup
coco commands                          # command registry / effects overview
coco eval                              # deterministic safety-regression fixtures
# ... the loop is normally driven by the $coco-loop skill, not by hand ...
coco-store progress                    # backlog by status, grouped by spec
coco-store status                      # native ◈ project-pulse card (backlog · specs · roadmap)
coco-store viz                         # mermaid project graph
coco audit report                      # loop trajectory: fix-rounds, verify fails, oracle outages, merge latency
coco doctor                            # health + prereqs (`coco doctor clean` reclaims stale verify-run cache)
coco improve digest                    # audit-derived pain signals (insufficient-data-gated)
coco improve check <paths>             # refuse edits to the referee/metrics/store (exit 3)
```

## Development verification

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm eval
pnpm build
pnpm ci
```

`pnpm ci` is the pre-PR gate: typecheck, test, deterministic evals, then build. GitHub Actions runs the same gate on Linux and macOS.

## Privacy and platform

- Read `docs/privacy-model.md` before adding new context/Oracle surfaces.
- Read `docs/platform-support.md` before claiming support beyond macOS/Linux.

## Credits

- **Review + plan brain — [Oracle (`@steipete/oracle`)](https://github.com/steipete/oracle)** by [Peter Steinberger](https://github.com/steipete): the lane that drives **ChatGPT Pro (GPT‑5.x‑Pro)** for deep review, planning, and research. coco's "never false-green" gate is only as strong as this brain — coco leans on it at every plan and review step, and wouldn't exist without it. (Requires your own ChatGPT Pro subscription.)
- **Icon** generated with ChatGPT, via Oracle.

## License

MIT © nickcao
