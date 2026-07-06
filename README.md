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
coco-store viz                         # mermaid project graph
```

## Credits

- **Review + plan brain — [Oracle (`@steipete/oracle`)](https://github.com/steipete/oracle)** by [Peter Steinberger](https://github.com/steipete): the lane that drives **ChatGPT Pro (GPT‑5.x‑Pro)** for deep review, planning, and research. coco's "never false-green" gate is only as strong as this brain — coco leans on it at every plan and review step, and wouldn't exist without it. (Requires your own ChatGPT Pro subscription.)
- **Icon** generated with ChatGPT, via Oracle.

## License

MIT © nickcao
