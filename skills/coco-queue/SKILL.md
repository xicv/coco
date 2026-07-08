---
name: coco-queue
description: Use when the user types $coco-queue or /coco-queue, asks “what should coco do next?”, “next task”, “show queue”, “pick from backlog”, or wants the next ready project task before starting a loop. Queue triage skill for coco — reads BACKLOG/coco-store status, surfaces the next ready task, explains why it is next, and stops. Never implements or merges.
---

# coco-queue

Pick or explain the **next ready project task** without implementing it. This is the queue/PM handoff layer between `$coco-goal` and `$coco-loop`.

Invoke: `$coco-queue` / `/coco-queue`, optionally with `next`, `status`, `why`, or a filter like `docs`, `tests`, `low-risk`.

## Golden rules

1. **Read-only by default.** Do not edit files, start a goal, run `$coco-loop`, or merge.
2. **Use the code-owned queue first.** Call `coco_next({ repoDir })` / `coco next` before inventing work.
3. **Show project state.** Also use `coco-store progress` or `coco-store status` when available so the user can see backlog/spec context.
4. **Do not fabricate queue items.** If no ready task exists, say so and suggest `$coco-goal <intent>` or `$coco-night --plan-next` only if the user wants coco to create a task.
5. **Prefer small, verified work.** If several tasks appear eligible, prefer tasks with a linked spec, clear verification surface, no blocked dependencies, and low blast radius.
6. **Stop at the handoff.** Output the recommended next task and the exact next command; do not run it.

## Workflow

1. Resolve `repoDir` to the current repository root.
2. Run `coco_next({ repoDir })` / `coco next`.
3. Run `coco-store progress` or `coco-store status` if available.
4. If a task exists, present:
   - task id;
   - title;
   - linked spec, if present;
   - priority/dependencies, if visible;
   - why it is safe/ready;
   - verification surface from task body, if present;
   - next command.
5. If no task exists, present a short “queue empty” card and recommend one of:
   - `$coco-goal <intent>` to create a real GoalSpec + backlog tasks;
   - `$coco-night --plan-next` if the user wants coco to pick one safe task and then attempt it.

## Output shape

```text
◈ coco-queue  ·  next ready task
  Task        <id or none>
  Title       <title>
  Why         <ready because...>
  Proof       <verification surface or missing>
  Next        $coco-loop

  source: coco_next · coco-store progress
```

Keep it concise. The user wants a queue decision, not a full plan.
