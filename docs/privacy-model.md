# Privacy model

coco is local-first, but the full loop can send selected context to Oracle for plan/review. Treat every boundary explicitly.

## Local-only data

These artifacts are local runtime/project data and should not be pasted into Oracle or external services as raw dumps:

- `.coco/**`, including goal ledgers, verify-run cache, incidents, and audit logs.
- `.coco/audit.ndjson` and `.coco/incidents.ndjson`.
- `.coco/store/**` cards with `visibility: "local"`.
- Improve specs and audit-derived self-improvement notes.
- Secrets, credentials, private keys, env files, tokens, browser profiles, and local config with account data.

## Shared data

These may be sent to Oracle only when the user/skill intentionally includes them:

- The current task objective.
- The bounded `coco-store pack` brief.
- `.coco/store` cards marked `visibility: "shared"`.
- A bounded background excerpt supplied through `coco-store pack --background` or `--background-stdin`.
- A committed diff such as `git diff <base>...HEAD` for review.

## Built-in guards

`coco-store pack` protects the most common accidents:

- Background files must resolve inside the repo.
- Symlink escapes are refused.
- Secret-looking path segments are refused.
- Binary files are refused.
- Background is head-bounded by line and byte caps.
- Local cards are excluded from Oracle briefs.

These guards are necessary but not sufficient. Inline text from the current conversation and roadmap content can still contain sensitive data. The agent and human should keep those concise and scrubbed.

## Oracle prompt rules

When asking Oracle to plan/review:

1. Prefer the diff and small, relevant excerpts over whole files.
2. Do not paste `.coco/**` raw state.
3. Do not paste local improve specs or audit details into external research prompts.
4. Do not include secrets even when they are in tracked files.
5. Mark uncertain privacy decisions as blockers for the human rather than guessing.

## Self-improvement research

`$coco-improve` may use external web research only through the static, code-defined `researchTopic` attached to a fired safe signal. It must not include repo names, paths, goal IDs, audit details, timestamps, or local file names in the search query.

## Review checklist

Before merging changes that affect privacy boundaries, confirm:

- New pack/context paths preserve the `visibility: "local"` boundary.
- Any new external call has a documented input surface.
- Secret-looking paths still fail closed.
- Tests cover path traversal, symlink escape, local-card exclusion, and bounded background behavior.
