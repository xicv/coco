---
name: coco-store
description: Use when the user types $coco-store or /coco-store, or asks to organise / track / visualise the coco project's knowledge base — add/find/show resource cards, group or sort the list, see backlog progress, link resources, pack a context brief, view/append the roadmap, promote a backlog task, or render the project graph. The PM layer of coco; drives the `coco-store` CLI. Read-only by default — mutations only on explicit intent.
---

# coco-store

Drive the coco **PM layer** conversationally — the `coco-store` knowledge base (ResourceCards + roadmap + BACKLOG + context briefs). You translate the user's intent into the right `coco-store` shell command, run it, and summarise the result. This is the **PM** in the triad: **CEO (`$coco-goal`) → PM (`$coco-store`) → CTO (`$coco-loop`) → human merge**.

Invoke: `$coco-store <intent>` (Codex) / `/coco-store <intent>` (Claude Code).

## Golden rules

1. **It's a shell CLI on PATH.** Run `coco-store <cmd>` via the shell tool; it prints JSON — parse it and report the useful bits (ids, counts, paths), don't dump raw JSON unless asked.
2. **Read-only by default.** `list` / `show` / `find` / `progress` / `viz` / `pack` / `roadmap` (no `--append`) never change anything — run them freely. Only **mutate** (`add`, `promote`, `link`, `roadmap --append`, `init`) when the user clearly wants to change something; confirm if ambiguous.
3. **Respect the one-way boundary.** coco-store writes ONLY `.coco-store/**`, `BACKLOG.md`, and brief paths — never `.coco/goals` or a merge. Never ask it to.
4. **Never start coco-loop or merge.** coco-store only organises / tracks / visualises. Building + merging is the CTO (`$coco-loop`) + the human.

## Intent → command

| The user wants… | Run |
|---|---|
| see all resources (optionally grouped/sorted) | `coco-store list [--group-by category\|type\|kind\|tag] [--sort title\|timestamp]` |
| find a resource | `coco-store find <query>` |
| show one card in full | `coco-store show <id>` |
| add a doc / decision / note | `coco-store add --type <type> --title "<title>" [--tags a,b] [--category c] <file>` (or `--body "…"`) |
| see project / backlog progress | `coco-store progress` (grouped by originating spec) |
| show a native project-pulse card | `coco-store status` → echo its `markdown` verbatim (backlog + specs + roadmap) |
| **visualise** the project | `coco-store viz` → then show the mermaid at `.coco-store/pending/project-graph.md` |
| link two resources | `coco-store link --from <id> --to <id> --rel defines\|references\|relates-to\|depends-on` |
| build a context brief for a goal | `coco-store pack --goal <id> [--query <q>]` |
| view or append the roadmap | `coco-store roadmap [--append "<line>"]` |
| promote a backlog task | `coco-store promote --id <id> --title "<title>" [--spec <specId>] [--depends-on a,b] [--priority high\|medium\|low]` |
| set up the store in a repo | `coco-store init` |

## Notes

- A **GoalSpec** (`add --type spec`) must contain `Outcome` / `Verification surface` / `Boundaries` sections — the store rejects a weak spec. Specs are normally authored by **`$coco-goal`**, not hand-added here.
- `progress` groups BACKLOG by `links.spec`; `viz` renders roadmap → spec cards → their backlog tasks → card links (structural, written to the git-ignored pending dir).
- After any mutation, echo the returned `id` / result so the user has a handle to reference.
- **Progress card.** `coco-store status` returns `{ format:"coco-progress-v1", markdown, specs }` — a fenced `◈ coco-store` project-pulse card in the shared coco visual language. Echo `markdown` **verbatim** on an explicit `$coco-store` / status / progress request and after a mutation (`add` / `promote` / `link` / `roadmap --append`); don't emit it after every read-only lookup. It renders natively in the Codex macOS app (the only progress surface there).
