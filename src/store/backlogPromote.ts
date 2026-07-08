import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { looksLikeBacklogHeading } from '../backlog.js';

export interface BacklogTaskInput {
  id: string;
  title: string;
  body?: string;
  priority?: 'high' | 'medium' | 'low';
  dependsOn?: string[];
  specId?: string; // the GoalSpec (coco-store card id) this step was decomposed from — emitted as links.spec
  paths?: string[]; // declared target files (coco-improve traceability) — emitted INSIDE the yaml (JSON-quoted) so path/heading text can't corrupt the backlog node structure
}

function backlogPath(repo: string): string {
  return join(repo, 'BACKLOG.md');
}

/** coco-store's ONLY write into coco-loop territory: append a `ready` task node to BACKLOG.md in the
 * format coco-loop's parser reads. It never touches `.coco/goals/*` or any loop state, and refuses
 * to duplicate an existing task id. This is the entire store→loop contract (brief + BACKLOG task). */
const SAFE_ID = /^[A-Za-z0-9._-]+$/; // keeps the emitted YAML unambiguous (no `:`, `#`, `[`, spaces…)

export function appendBacklogTask(repo: string, task: BacklogTaskInput): void {
  if (!task.id.trim() || !task.title.trim()) throw new Error('coco-store: promote needs a task id and title');
  if (!SAFE_ID.test(task.id)) throw new Error(`coco-store: task id must match ${SAFE_ID} (got '${task.id}')`);
  for (const d of task.dependsOn ?? []) {
    if (!SAFE_ID.test(d)) throw new Error(`coco-store: dependsOn id must match ${SAFE_ID} (got '${d}')`);
  }
  // Present-but-empty (`--spec ""`) must ERROR, not silently drop the link — distinguish absent (undefined) from present.
  if (task.specId !== undefined && !SAFE_ID.test(task.specId)) throw new Error(`coco-store: spec id must match ${SAFE_ID} (got '${task.specId}')`);
  const priority = task.priority ?? 'medium';
  if (!['high', 'medium', 'low'].includes(priority)) throw new Error(`coco-store: priority must be high|medium|low`);
  const title = task.title.replace(/\s+/g, ' ').trim(); // single-line heading

  // The body is appended raw after the yaml fence — guard it so it can't corrupt the backlog: reject
  // a line that would parse as a node heading (`### id — title`), or unbalanced code fences that would
  // desync the parser's fence tracking. (Applies to every promote caller, incl. coco-goal.)
  if (task.body) {
    const lines = task.body.split('\n');
    const heading = lines.find((l) => looksLikeBacklogHeading(l));
    if (heading) throw new Error(`coco-store: task body must not contain a backlog node heading ('### id — title') — it would corrupt the backlog. Offending line: ${heading.trim()}`);
    if (lines.filter((l) => /^\s*(```|~~~)/.test(l)).length % 2 !== 0) throw new Error('coco-store: task body has an unbalanced code fence (```/~~~), which would corrupt backlog parsing');
  }

  const p = backlogPath(repo);
  const existing = existsSync(p) ? readFileSync(p, 'utf8') : '';
  const dup = existing.split('\n').some((l) => l.trim() === `id: ${task.id}`);
  if (dup) throw new Error(`coco-store: BACKLOG.md already has a task with id '${task.id}'`);

  const node = [
    `### ${task.id} — ${title}`,
    '```yaml',
    `id: ${task.id}`,
    'status: ready',
    `priority: ${priority}`,
    ...(task.dependsOn?.length ? [`dependsOn: [${task.dependsOn.join(', ')}]`] : []),
    // Quote the id so a SAFE_ID that looks like a YAML core scalar ('123'/'true'/'null') round-trips
    // as a STRING — the backlog parser keeps links values uncoerced (unlike id/dependsOn).
    ...(task.specId ? ['links:', `  spec: ${JSON.stringify(task.specId)}`] : []),
    // JSON-quoted flow sequence (valid YAML) — keeps arbitrary path text on one line, no heading injection.
    ...(task.paths?.length ? [`paths: ${JSON.stringify(task.paths)}`] : []),
    '```',
    ...(task.body?.trim() ? [task.body.trim()] : []), // validated above — no node heading / unbalanced fence
  ].join('\n');

  const sep = existing.length === 0 ? '' : existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
  appendFileSync(p, `${sep}${node}\n`);
}
