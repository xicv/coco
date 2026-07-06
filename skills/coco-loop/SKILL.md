---
name: coco-loop
description: Use when the user types $coco-loop or /coco-loop, or says "start a coco loop", "run the coco loop", or "drive this goal with coco". Loop-engineering driver — ChatGPT-Pro (Oracle) plans/reviews, you implement/test/commit, the coco referee gates every step, and the human approves the merge. Works in Codex and Claude Code.
---

# coco-loop

Drive one development goal through **plan → implement → review → fix → verify → (human merge)**. You are the **hands**; **Oracle** (`consult`, GPT-5.5-Pro) is the **brain**; the **coco** MCP tools are the **referee** that tells you the next step and refuses unsafe ones. The **human** owns the merge — either per-merge, or as forward consent for auto-merge via `--auto`.

Invoke: `$coco-loop <objective>` (Codex) / `/coco-loop <objective>` (Claude Code). Add `--auto` (`$coco-loop --auto <objective>`) to grant forward consent for auto-merge on THIS goal — an opt-in that still merges only if the change comes back clean + verified + rebased + within the risk policy (Layer 2).

## Golden rules (do not deviate)

1. **`repoDir` is the current project directory, as an absolute path.** Pass it to every coco tool.
2. **Start every cycle with `coco_goal_status`.** Act on its `nextAction`. Never infer the phase from memory.
3. **Chain `expectedSha`** for `coco_goal_record` from the `headSha` in the most recent `coco_goal_status` (or the status returned by the previous record).
4. **Commit before review/verify.** The referee refuses review/verify on a dirty tree.
5. **Oracle verdict is strict.** Your review consult MUST end with a line exactly `VERDICT: clean` or `VERDICT: blocking`. Pass Oracle's raw output as `reviewOutput` — coco parses it. If Oracle is unreachable, errors, times out, or the verdict is missing/ambiguous: **retry ONCE; if it still fails, call `coco_goal_oracle_unavailable({ goalId, phase:"plan"|"review", reason, attempts })`, then STOP and tell the user.** Never invent a verdict. coco marks the goal `review-unavailable` → `escalate-human` and refuses merge, so the loop pauses durably (never false-green). After the user resolves Oracle (re-login / restart), `coco_goal_op_clear({ goalId })` to resume.
6. **You never merge without consent.** At `merge-gate`, if the goal opted in (`autoMergeAllowed`, from `$coco-loop --auto`) call `coco_merge` — it merges ONLY when green + rebased + within risk policy, else it returns you to the human path. Otherwise (or on a `human-merge` fallback) present the merge card and **propose** the exact `coco merge --goal <goalId>` command as an executable step so the harness's approval prompt gates it. Never bundle a merge silently, never request an always-allow, and never proceed past a declined or unexecuted merge.
7. **Wrap long Oracle ops.** Right before a long Oracle consult (plan/review), call `coco_goal_op_start({ repoDir, goalId, phase, kind:"oracle" })` so `coco_health` reads `operation-in-progress` instead of misreading the pause as `stalled`. The matching `coco_goal_record` clears it (or `coco_goal_op_clear` if you abort). (**verify is coco-owned** — `coco_goal_verify_start` handles its own in-flight marker; don't op-start it.) An op still in flight after 1h → `in-flight-timeout`.
8. **Run Oracle review consults in a subagent.** A browser `consult` returns a large payload (minutes of `[browser] Waiting…` polling breadcrumbs + the full transcript) that rots the driver context. Dispatch the review consult to a general-purpose subagent whose whole job is: run the `consult`, then return ONLY `{ verdict, findings[], verdictBlock }` — `verdictBlock` is the answer text through the final `VERDICT:` line (pass it verbatim as `reviewOutput` so coco parses server-side), `findings[]` is one line each. The polling noise and the ~80 KB transcript stay in the subagent; coco persists verdict+findings as event evidence, so the driver keeps everything that matters and none of the noise. (The raw transcript stays at `~/.oracle/sessions/<slug>/artifacts/transcript.md` — never `Read` it into the driver.)

## The loop

1. `coco_init({ repoDir })`.
2. **Objective:** if the user gave one, use it. If not, call `coco_next({ repoDir })` — if it returns a task, use its `title` + `body` as the objective and remember its `id` (the backlog task); if it returns `null`, tell the user the backlog has nothing ready and stop.
3. `coco_goal_start({ repoDir, objective, acceptanceChecks?, maxFixRounds?, backlogTaskId?, autoMergeAllowed? })` → `goalId`. If step 2 came from the backlog, pass its `id` as `backlogTaskId` so it's stored on the goal (durable across session drops). Pass `autoMergeAllowed: true` ONLY if the user invoked with `--auto` (forward consent for Layer 2 auto-merge).
4. **Pack the context brief + ground with background (best-effort).** Right after `goalId`, assemble the brief the `plan` consult will read:
   - **Background — default is the current context.** Unless the user gave a file, distill the **current conversation/session** — the intent, decisions, constraints, and relevant file paths you just established with the user — into a short structured block (**Goal / Approach / Constraints / Relevant files**) and pipe it through the **same bounder** so it's capped, not pasted unbounded: `printf '%s' "<block>" | coco-store pack --goal <goalId> --query "<objective>" --background-stdin`. This grounds the loop in what was just discussed instead of planning blind. Keep it to what you actually established with the user; don't paste raw file dumps or secrets.
   - **Background — from a file.** If the user pointed you at a doc, pass it through the deterministic bounder: `coco-store pack --goal <goalId> --query "<objective>" --background <file>`. pack requires the file to resolve **inside the repo** (it refuses outside/symlinked/secret-looking/binary files — the brief is sent to Oracle), head-bounds it (~150 lines / 6 KB), labels its freshness (`untracked` / `uncommitted local edits` / `[STALE?]`), and places it **first** in the brief.
   - **Store brief.** `coco-store pack --goal <goalId> --query "<objective>"` (with or without `--background`) appends the roadmap + most relevant resource/spec cards and returns a `path`. **Read that file** and carry it into the `plan` consult. Only `visibility:shared` cards travel into the brief — a `local` card never leaves the machine, so it isn't sent to Oracle.
   - **Keep it bounded — more context is not better.** Oversized background *degrades* planning (context rot; irrelevant text distracts the model), so never paste a whole large file — the `--background` bounder and the byte budget keep the brief small on purpose, and background belongs **first** (primacy) with the task goal last. If `.coco-store` is empty the store part is just `(empty …)` — proceed anyway; background is best-effort context, **never a gate**. (`pack` is the store→loop READ path, mirroring `coco-store promote` as the store→loop WRITE path.)
5. Repeat: `coco_goal_status({ repoDir, goalId })` → act on `nextAction`:

   - **`plan`** → `coco_goal_op_start({ phase:"plan", kind:"oracle" })`, then `consult` (Oracle, deep/plan mode, `engine:"browser"`) with the relevant files **and the coco-store brief from step 4 (if any)** → capture the plan. `coco_goal_record({ repoDir, goalId, phase:"plan", expectedSha:<status.headSha>, evidence:"<oracle session / plan summary>" })`.
   - **`implement`** / **`fix`** → make the edits, run the local tests, **commit**. `coco_goal_record({ phase:"implement", expectedSha:<new HEAD>, evidence:"<test output summary>" })`.
   - **`review`** → `coco_goal_op_start({ phase:"review", kind:"oracle" })`, then run the review **via a subagent** (rule 8): `consult` (Oracle, review mode, `engine:"browser"`) on the committed diff. **Ask for the whole failure surface in ONE pass, not one bug per round:** for state-machine / filesystem / parser / git-touching code, instruct Oracle to *enumerate every branch of the changed function(s) and give a concrete failing scenario per branch* (e.g. unborn repo, existing repo, ignored file, staged/removed file, idempotent re-run), then finish with a single `VERDICT: clean` or `VERDICT: blocking`. This turns serial N-round bug discovery into 1–2 rounds — fewer consults, less chance of tripping ChatGPT's rate limit. `coco_goal_record({ phase:"review", expectedSha:<HEAD>, evidence:"<1–2 sentence blocking reason>", reviewOutput:"<Oracle's verdict block>" })`. If unavailable/ambiguous → STOP (rule 5).
   - **`verify`** → **coco runs the tests, not you.** `coco_goal_verify_start({ goalId, expectedSha:<status.headSha> })` → then poll `coco_goal_verify_result({ goalId, runId })` until `status:"done"` (coco recorded `verdict` pass|fail from the exit code and advanced — read `nextAction`) or `status:"aborted"` (HEAD moved / tree dirtied during the run — re-`coco_goal_status` and start over). You do NOT report a verdict. Needs a committed `coco.config.json` with `verify.testCommand`; if it's missing, `verify_start` errors — tell the user to add it (no agent fallback).
   - **`wrong-branch`** → you are not on the goal branch (e.g. still on `main`). **Do NOT edit or test here.** `git checkout coco/<goalId>` first, then re-status.
   - **`commit-or-revert`** → commit the work or discard it, then re-status.
   - **`rebase-needed`** → rebase the branch onto `main`, then re-status (expect fresh review/verify — content changed).
   - **`escalate-human`** / **`stuck`** (via `coco_health`) → STOP, summarize the blocker for the user.
   - **`merge-gate`** → STOP the loop. First read `status.autoMergeAllowed`:

     **If `autoMergeAllowed` (the goal opted in via `--auto`):** try the auto-merge — `coco_merge({ repoDir, goalId, expectedSha:<status.headSha> })`:
       - `{ merged:true, mergedSha }` → **announce the merged SHA**, then go to step 6.
       - `{ merged:false, next:"continue-loop", reason }` → a transient gate (rebase / re-review / re-verify): re-`coco_goal_status` and resolve — do NOT hand to a human.
       - `{ merged:false, next:"human-merge", reason }` → consent/risk sent it back to a human (e.g. sensitive paths, oversized diff, no tests). Fall through to the human path and surface `reason`.

     **Human path (default, or after a `human-merge` fallback):** present the **merge card** — `goalId`, `repoDir`, target branch (`<base>`), HEAD SHA, `review: clean`, `verify: pass` (plus any auto-merge `reason`) — then **propose the exact command as an executable step** (this is the consent checkpoint):

     `coco merge --goal <goalId>`  *(runs in `<repoDir>`)*

     - The human approving that command **is** the merge consent — you run the CLI *only* under that approval. Keep `--goal <goalId>` in the command so approval is per-goal, never blanket.
     - `coco merge` prints JSON and **always exits 0 — read the payload, not the exit code**: `{"merged":true}` → step 6; `{"merged":false,"reason":"…"}` → surface + STOP, re-`coco_goal_status` and resolve (don't retry blindly); non-zero / thrown (e.g. `no active goal`) → STOP and surface.
     - **Auto-approve caveat:** in a no-prompt / bypass harness this runs with no human pause — i.e. it becomes auto-merge *without* the `--auto` opt-in. If you know the session auto-approves, tell the human before proposing.

6. After the merge, `coco_goal_status` reports the goal `achieved`. If its `backlogTaskId` is set, call `coco_done({ repoDir, taskId: <status.backlogTaskId> })` to mark the backlog task done. Then optionally `coco_next` to surface the next task — but **stop** and let the human decide whether to start it (they hold the context advantage on what's next).

## Health & recovery

Call `coco_health({ repoDir, goalId })` any time to get a verdict (`healthy / stuck / conflict / operation-in-progress / in-flight-timeout / stalled / review-unavailable / wrong-branch / missing-branch / missing-base / invalid-state / needs-human / budget-exceeded`). `operation-in-progress` (your own op running) is fine — keep going. On `in-flight-timeout` (op hung >1h), `stalled` (loop went quiet), `review-unavailable` (Oracle down — resume with `coco_goal_op_clear` after the user fixes it), `conflict`, or `invalid-state`, STOP and surface it — never force git. **If `coco_goal_status` ever returns an error, call `coco_health` and STOP — do not act.** `coco_goal_clear` is **only** for an explicit user cancellation, never part of the normal loop.

## Notes

- coco tools reach the referee via `[mcp_servers.coco]` in `~/.codex/config.toml`; Oracle via `[mcp_servers.oracle]` (`consult`). Tool names may appear server-prefixed (e.g. `coco__coco_goal_status`).
- One goal per repo at a time. `maxFixRounds` (default 5) bounds fix attempts before `escalate-human`.
- **Context delivery to Oracle.** Attach `git diff main...HEAD`, not whole files. For a small review (sources/diff under ~150 lines) **paste them inline in the prompt** rather than uploading — browser attachment upload is slower and occasionally times out; inline is reliable and cheaper. Reserve `browserAttachments:"always"` for genuinely large diffs.
- **Stuck-detection.** coco escalates to `stuck` two ways: `maxFixRounds` blocking reviews, OR the **same failure repeating 3×** (it hashes your `evidence`). So on a `blocking` review or a `fail` verify, put the **concrete failure detail** in `evidence` — **one or two sentences**: the specific blocking reason or the failing test line, NOT a narrative recap. That's what coco fingerprints, and it keeps `.coco/goals/*.json` small (verbose evidence has bloated goal state past 200 KB). Distinct failures each round reset the counter; a `clean`/`pass` clears it.
