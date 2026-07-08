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

## What's new

- **`coco-improve` — self-improving loop (propose-only)** — `$coco-improve` reflects over the `coco audit` corpus (with an **insufficient-data gate** so a thin history can't manufacture findings), forms ONE incremental, evidence-backed hypothesis, and archives it as a **local** improve-spec + one loop-sized backlog task for a human to run through `$coco-loop`. It never builds, merges, or edits live skills. A **code-owned guard** (`coco improve check`) refuses any change targeting the referee / metrics / store — enforced at BOTH propose time and, via an `improveOrigin` flag **frozen at goal start**, at **merge** time (even if a task under-declares what it touches). A self-improvement can never quietly weaken coco's own gate.
- **`coco-audit` — automatic trajectory capture** — every meaningful loop/goal action (reviews, fixes, verify results, Oracle outages, merges) is recorded to a local, gitignored `.coco/audit.ndjson` at the domain chokepoint. Deterministic, **best-effort** (a logging failure never breaks the referee), and **redacted** (structural facts only — no evidence text). `coco audit report` aggregates it: fix-rounds (by distinct blocking tree, matching the epoch model), verify failures, Oracle outages, and verify→merge latency — the signal for evolving the loop.
- **`coco doctor` — one-shot health check** — a read-only, **no-LLM** diagnostic that aggregates environment (node/git/version), repo setup (init, `verify.testCommand`), wiring (merge-guard hooks, coco + Oracle MCP, watchdog), active-goal health, and data hygiene. `coco doctor clean` reclaims stale verify-run cache — **dry-run by default**, `--apply` to delete, and only terminal/orphaned runs (never a live goal's runs, the goal ledger, or the audit log).
- **Native `◈ coco` progress cards** — every layer surfaces a consistent, fenced **checkpoint card** so you can watch progress natively in the Codex app (assistant markdown is the only progress surface it renders — there's no live goal HUD there yet). `$coco-loop` echoes a loop checkpoint (*checkpoint · verified · remaining · next*, stamped with `goalId · sha · nextAction`) from `coco_goal_status`'s additive, versioned `progress` field — on each state transition, not every poll. `coco-store status` renders a **project-pulse** card (*backlog by status · spec completion · roadmap*); `$coco-goal` shows its self-reported pipeline phase. One shared visual language across all three; the human merge command stays **outside** the card as a clear, separate approval step.
- **`coco init` scaffolds a starter `coco.config.json`** and goal status **warns early** when `verify.testCommand` is unset — so a fresh repo learns about the coco-owned verify gate up front, instead of stalling at it after plan/implement/review work is already sunk. init force-tracks its own config even past repo ignore rules, and never overwrites a config you already have.
- **`coco-store` PM surface** — `list --group-by`, `progress` (backlog by status, grouped by spec), `link` (with a content-addressed links-merge), and `viz` (a structural mermaid project graph).
- **`$coco-goal` (CEO layer)** — turns a weak intent into an archivable GoalSpec and promotes loop-sized steps to the backlog, then stops for you.
- **Context `pack`** wires the store → loop: the loop reads a bounded coco-store brief before it plans.

## Prerequisites

- **Node.js ≥ 18.**
- **An MCP-aware coding agent** — [OpenAI Codex](https://developers.openai.com/codex) or [Claude Code](https://claude.ai/code) — with the `coco` (and `oracle`) MCP servers registered and the `coco-goal` / `coco-store` / `coco-loop` skills installed under the agent's skills dir.
- **A ChatGPT Pro subscription + Oracle — required for the review brain.** coco's plan/review gate runs **GPT‑5.x‑Pro** through the [`@steipete/oracle`](https://github.com/steipete/oracle) lane, which drives a logged-in **ChatGPT Pro** browser session (the `consult` MCP tool). Without an active **ChatGPT Pro** subscription and Oracle configured, the CLIs still run, but the Oracle-gated plan/review steps can't — by design coco then **fails to the human, never a false green**.

> coco is opinionated and not turnkey: it assumes the wiring above. The `coco` / `coco-store` CLIs and the `coco-mcp` stdio server work standalone, but the full loop needs the agent + skills + Oracle in place.

## Install

```sh
npm install -g @nickcao/coco
```

Provides `coco` (the referee), `coco-store` (the PM layer), and the `coco-mcp` stdio server for MCP-aware agents.

## Quick taste (CLI, no agent)

```sh
cd your-repo
coco init                              # bootstrap .coco/ + a starter coco.config.json on a clean main
# ... the loop is normally driven by the $coco-loop skill, not by hand ...
coco-store progress                    # backlog by status, grouped by spec
coco-store status                      # native ◈ project-pulse card (backlog · specs · roadmap)
coco-store viz                         # mermaid project graph
coco audit report                      # loop trajectory: fix-rounds, verify fails, oracle outages, merge latency
coco doctor                            # health + prereqs (`coco doctor clean` reclaims stale verify-run cache)
coco improve digest                    # audit-derived pain signals (insufficient-data-gated)
coco improve check <paths>             # refuse edits to the referee/metrics/store (exit 3)
```

## Credits

- **Review + plan brain — [Oracle (`@steipete/oracle`)](https://github.com/steipete/oracle)** by [Peter Steinberger](https://github.com/steipete): the lane that drives **ChatGPT Pro (GPT‑5.x‑Pro)** for deep review, planning, and research. coco's "never false-green" gate is only as strong as this brain — coco leans on it at every plan and review step, and wouldn't exist without it. (Requires your own ChatGPT Pro subscription.)
- **Icon** generated with ChatGPT, via Oracle.

## License

MIT © nickcao
