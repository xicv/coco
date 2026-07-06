### loop-pack — wire coco-store pack into coco-loop skill
```yaml
id: loop-pack
status: done
priority: high
links:
  spec: "coco-store-pm-enhancements-loop-brief-wiring-cro-85d4da01"
```
Pure SKILL.md edit — `buildBrief` + `coco-store pack` CLI already exist. After `coco_goal_start` yields goalId, run `coco-store pack --goal <goalId> --query <objective>`, read the returned brief path, and feed it to Oracle for planning (today the brief is produced but never consumed). No code unless a shell-less Codex.app needs an MCP `coco_store_pack` tool. Verify: SKILL.md diff shows the pack+read step.

### store-group — coco-store list --group-by / --sort
```yaml
id: store-group
status: done
priority: high
links:
  spec: "coco-store-pm-enhancements-loop-brief-wiring-cro-85d4da01"
```
`coco-store list --group-by category|type|kind|tag [--sort title|timestamp]` — read-only, no mutation. A card appears under EACH of its tag buckets (multi-tag). Sort by title/timestamp needs the full cards, not the current id/title/type/category projection. Verify: unit tests (grouping incl. multi-tag + sort) + CLI smoke.

### store-progress — coco-store progress (spec-linked)
```yaml
id: store-progress
status: done
priority: high
links:
  spec: "coco-store-pm-enhancements-loop-brief-wiring-cro-85d4da01"
```
`coco-store progress` — summarise BACKLOG by status (ready/in-progress/blocked/done), grouped by originating spec via `links.spec`, with per-spec completion counts. Implement DIRECTLY over `parseBacklog` — never `coco_next` / `.coco/goals` (one-way boundary). Type-guard `links.spec` (it's `Record<string,unknown>`): bucket missing/non-string as `unlinked`, never throw. Verify: unit tests over a sample BACKLOG + CLI smoke.

### store-link — coco-store link --from --to --rel (mutator)
```yaml
id: store-link
status: done
priority: high
links:
  spec: "coco-store-pm-enhancements-loop-brief-wiring-cro-85d4da01"
```
`coco-store link --from <id> --to <id> --rel defines|references|relates-to|depends-on` — mutator only (add/list). CRITICAL (Codex): `upsertCard` must MERGE the prior card's `links` on idempotent re-add — `add` is content-addressed (id = slug+bodyHash) and currently overwrites the card, silently DROPPING links; add a regression test `add → link → re-add same content → links preserved`. Dedupe + stable link order. Links already surface in `show` (JSON); link-aware `find`/traversal is a FOLLOW-UP loop, not this step. Verify: unit tests (link add + merge-on-readd + dedupe) + CLI smoke.

### store-viz — coco-store viz (mermaid-in-markdown)
```yaml
id: store-viz
status: done
priority: medium
dependsOn: [store-link]
links:
  spec: "coco-store-pm-enhancements-loop-brief-wiring-cro-85d4da01"
```
`coco-store viz` — emit a Markdown `mermaid` graph to `.coco-store/pending/` (GITIGNORED — not committed, avoids churn/git-log noise). STRUCTURAL only (no status labels/counts → no store-progress dep): Roadmap → spec-type cards → backlog tasks where `task.links.spec === spec.id` → card→card `links`. Verify: test asserts the ```mermaid``` block + expected nodes/edges, the output path is gitignored, + CLI smoke.

### xagent-e2e — HUMAN: cross-agent E2E from Codex.app
```yaml
id: xagent-e2e
status: blocked
priority: low
dependsOn: [store-viz, loop-pack]
links:
  spec: "coco-store-pm-enhancements-loop-brief-wiring-cro-85d4da01"
```
HUMAN validation — run `$coco-goal` + `$coco-loop` from Codex.app and land a merged goal, proving the cross-agent path. `status: blocked` on purpose (a human unblocks when ready) so `coco_next` never auto-picks this non-code task. NOT a coco-loop code goal; blocked-stop = needs Codex.app + human.
