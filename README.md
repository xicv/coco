<p align="center">
  <img src="assets/coco-icon.png" alt="coco" width="180" />
</p>

# coco

**A loop-engineering referee for AI coding agents** (Codex / Claude Code).

coco drives one development goal through **plan → implement → review → fix → verify → human-merge**, gated at every step by a git-**tree-hash**-bound, **epoch-scoped** state machine (an append-only event log; all gates derived; `coco merge` is the only merge path and is human-terminal by design). **ChatGPT-Pro ("Oracle")** is the review brain; the coding agent is the hands; **you** own the merge.

Three layers, each with a `$`/`/` skill trigger:

| Layer | Skill | Role |
|---|---|---|
| **CEO** | `$coco-goal` | turn a weak intent into a strong, achievable, archivable **GoalSpec** (Outcome · Verification surface · Constraints · Boundaries · Iteration · Blocked-stop) + loop-sized steps |
| **PM** | `$coco-store` / `coco-store` | organise / track / visualise the knowledge base — ResourceCards, roadmap, backlog progress, links, context `pack`, mermaid project graph |
| **CTO** | `$coco-loop` | drive the gated build loop with Oracle review + coco-owned verify |

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
coco init                              # bootstrap .coco/ on a clean main
# ... the loop is normally driven by the $coco-loop skill, not by hand ...
coco-store progress                    # backlog by status, grouped by spec
coco-store viz                         # mermaid project graph
```

## Credits

- **Review + plan brain — [Oracle (`@steipete/oracle`)](https://github.com/steipete/oracle)** by [Peter Steinberger](https://github.com/steipete): the lane that drives **ChatGPT Pro (GPT‑5.x‑Pro)** for deep review, planning, and research. coco's "never false-green" gate is only as strong as this brain — coco leans on it at every plan and review step, and wouldn't exist without it. (Requires your own ChatGPT Pro subscription.)
- **Icon** generated with ChatGPT, via Oracle.

## License

MIT © nickcao
