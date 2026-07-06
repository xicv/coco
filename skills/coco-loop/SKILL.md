---
name: coco-loop
description: Use when the user types $coco-loop or /coco-loop, or says "start a coco loop", "run the coco loop", or "drive this goal with coco". Loop-engineering driver — ChatGPT-Pro (Oracle) plans/reviews, you implement/test/commit, the coco referee gates every step, and the human approves the merge. Works in Codex and Claude Code.
---

# coco-loop

Drive one development goal through **plan → implement → review → fix → verify → (human merge)**. You are the **hands**; **Oracle** (`consult`, GPT-5.5-Pro) is the **brain**; the **coco** MCP tools are the **referee** that tells you the next step and refuses unsafe ones. The **human** owns the merge.

Invoke: `$coco-loop <objective>` (Codex) / `/coco-loop <objective>` (Claude Code).

## Golden rules (do not deviate)

1. **`repoDir` is the current project directory, as an absolute path.** Pass it to every coco tool.
2. **Start every cycle with `coco_goal_status`.** Act on its `nextAction`. Never infer the phase from memory.
3. **Chain `expectedSha`** for `coco_goal_record` from the `headSha` in the most recent `coco_goal_status` (or the status returned by the previous record).
4. **Commit before review/verify.** The referee refuses review/verify on a dirty tree.
5. **Oracle verdict is strict.** Your review consult MUST end with a line exactly `VERDICT: clean` or `VERDICT: blocking`. Pass Oracle's raw output as `reviewOutput` — coco parses it. If Oracle is unreachable, errors, times out, or the verdict is missing/ambiguous: **retry ONCE; if it still fails, call `coco_goal_oracle_unavailable({ goalId, phase:"plan"|"review", reason, attempts })`, then STOP and tell the user.** Never invent a verdict. coco marks the goal `review-unavailable` → `escalate-human` and refuses merge, so the loop pauses durably (never false-green). After the user resolves Oracle (re-login / restart), `coco_goal_op_clear({ goalId })` to resume.
6. **You never merge.** At `merge-gate` you STOP and hand the human the exact command.
7. **Wrap long Oracle ops.** Right before a long Oracle consult (plan/review), call `coco_goal_op_start({ repoDir, goalId, phase, kind:"oracle" })` so `coco_health` reads `operation-in-progress` instead of misreading the pause as `stalled`. The matching `coco_goal_record` clears it (or `coco_goal_op_clear` if you abort). (**verify is coco-owned** — `coco_goal_verify_start` handles its own in-flight marker; don't op-start it.) An op still in flight after 1h → `in-flight-timeout`.
8. **Run Oracle review consults in a subagent.** A browser `consult` returns a large payload (minutes of `[browser] Waiting…` polling breadcrumbs + the full transcript) that rots the driver context. Dispatch the review consult to a general-purpose subagent whose whole job is: run the `consult`, then return ONLY `{ verdict, findings[], verdictBlock }` — `verdictBlock` is the answer text through the final `VERDICT:` line (pass it verbatim as `reviewOutput` so coco parses server-side), `findings[]` is one line each. The polling noise and the ~80 KB transcript stay in the subagent; coco persists verdict+findings as event evidence, so the driver keeps everything that matters and none of the noise. (The raw transcript stays at `~/.oracle/sessions/<slug>/artifacts/transcript.md` — never `Read` it into the driver.)

## The loop

1. `coco_init({ repoDir })`.
2. **Objective:** if the user gave one, use it. If not, call `coco_next({ repoDir })` — if it returns a task, use its `title` + `body` as the objective and remember its `id` (the backlog task); if it returns `null`, tell the user the backlog has nothing ready and stop.
3. `coco_goal_start({ repoDir, objective, acceptanceChecks?, maxFixRounds?, backlogTaskId? })` → `goalId`. If step 2 came from the backlog, pass its `id` as `backlogTaskId` so it's stored on the goal (durable across session drops).
4. **Pack the context brief (best-effort).** Right after `goalId`, run `coco-store pack --goal <goalId> --query "<objective>"` — it builds a coco-store context brief (roadmap + the most relevant resource/spec cards) and returns a `path`. **Read that file** and carry its contents into the `plan` consult below, so Oracle plans with the CEO/PM context instead of blind. If `.coco-store` is empty or absent the brief is just `(empty …)` — proceed anyway; this is best-effort context, **never a gate**. (`pack` is the store→loop READ path, mirroring `coco-store promote` as the store→loop WRITE path.)
5. Repeat: `coco_goal_status({ repoDir, goalId })` → act on `nextAction`:

   - **`plan`** → `coco_goal_op_start({ phase:"plan", kind:"oracle" })`, then `consult` (Oracle, deep/plan mode, `engine:"browser"`) with the relevant files **and the coco-store brief from step 4 (if any)** → capture the plan. `coco_goal_record({ repoDir, goalId, phase:"plan", expectedSha:<status.headSha>, evidence:"<oracle session / plan summary>" })`.
   - **`implement`** / **`fix`** → make the edits, run the local tests, **commit**. `coco_goal_record({ phase:"implement", expectedSha:<new HEAD>, evidence:"<test output summary>" })`.
   - **`review`** → `coco_goal_op_start({ phase:"review", kind:"oracle" })`, then run the review **via a subagent** (rule 8): `consult` (Oracle, review mode, `engine:"browser"`) on the committed diff. **Ask for the whole failure surface in ONE pass, not one bug per round:** for state-machine / filesystem / parser / git-touching code, instruct Oracle to *enumerate every branch of the changed function(s) and give a concrete failing scenario per branch* (e.g. unborn repo, existing repo, ignored file, staged/removed file, idempotent re-run), then finish with a single `VERDICT: clean` or `VERDICT: blocking`. This turns serial N-round bug discovery into 1–2 rounds — fewer consults, less chance of tripping ChatGPT's rate limit. `coco_goal_record({ phase:"review", expectedSha:<HEAD>, evidence:"<1–2 sentence blocking reason>", reviewOutput:"<Oracle's verdict block>" })`. If unavailable/ambiguous → STOP (rule 5).
   - **`verify`** → **coco runs the tests, not you.** `coco_goal_verify_start({ goalId, expectedSha:<status.headSha> })` → then poll `coco_goal_verify_result({ goalId, runId })` until `status:"done"` (coco recorded `verdict` pass|fail from the exit code and advanced — read `nextAction`) or `status:"aborted"` (HEAD moved / tree dirtied during the run — re-`coco_goal_status` and start over). You do NOT report a verdict. Needs a committed `coco.config.json` with `verify.testCommand`; if it's missing, `verify_start` errors — tell the user to add it (no agent fallback).
   - **`wrong-branch`** → you are not on the goal branch (e.g. still on `main`). **Do NOT edit or test here.** `git checkout coco/<goalId>` first, then re-status.
   - **`commit-or-revert`** → commit the work or discard it, then re-status.
   - **`rebase-needed`** → rebase the branch onto `main`, then re-status (expect fresh review/verify — content changed).
   - **`escalate-human`** / **`stuck`** (via `coco_health`) → STOP, summarize the blocker for the user.
   - **`merge-gate`** → STOP. Present a short summary of the change + Oracle's ready verdict, then tell the user:

     > Ready to merge. Run this in `<repoDir>` when you're happy: `coco merge --goal <goalId>`

     Do not attempt to merge yourself — there is no merge tool, and that is intentional (your consent is the checkpoint).

6. After the human merges, `coco_goal_status` reports the goal `achieved`. If its `backlogTaskId` is set, call `coco_done({ repoDir, taskId: <status.backlogTaskId> })` to mark the backlog task done. Then optionally `coco_next` to surface the next task — but **stop** and let the human decide whether to start it (they hold the context advantage on what's next).

## Health & recovery

Call `coco_health({ repoDir, goalId })` any time to get a verdict (`healthy / stuck / conflict / operation-in-progress / in-flight-timeout / stalled / review-unavailable / wrong-branch / missing-branch / missing-base / invalid-state / needs-human / budget-exceeded`). `operation-in-progress` (your own op running) is fine — keep going. On `in-flight-timeout` (op hung >1h), `stalled` (loop went quiet), `review-unavailable` (Oracle down — resume with `coco_goal_op_clear` after the user fixes it), `conflict`, or `invalid-state`, STOP and surface it — never force git. **If `coco_goal_status` ever returns an error, call `coco_health` and STOP — do not act.** `coco_goal_clear` is **only** for an explicit user cancellation, never part of the normal loop.

## Notes

- coco tools reach the referee via `[mcp_servers.coco]` in `~/.codex/config.toml`; Oracle via `[mcp_servers.oracle]` (`consult`). Tool names may appear server-prefixed (e.g. `coco__coco_goal_status`).
- One goal per repo at a time. `maxFixRounds` (default 5) bounds fix attempts before `escalate-human`.
- **Context delivery to Oracle.** Attach `git diff main...HEAD`, not whole files. For a small review (sources/diff under ~150 lines) **paste them inline in the prompt** rather than uploading — browser attachment upload is slower and occasionally times out; inline is reliable and cheaper. Reserve `browserAttachments:"always"` for genuinely large diffs.
- **Stuck-detection.** coco escalates to `stuck` two ways: `maxFixRounds` blocking reviews, OR the **same failure repeating 3×** (it hashes your `evidence`). So on a `blocking` review or a `fail` verify, put the **concrete failure detail** in `evidence` — **one or two sentences**: the specific blocking reason or the failing test line, NOT a narrative recap. That's what coco fingerprints, and it keeps `.coco/goals/*.json` small (verbose evidence has bloated goal state past 200 KB). Distinct failures each round reset the counter; a `clean`/`pass` clears it.
