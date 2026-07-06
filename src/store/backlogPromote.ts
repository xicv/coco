import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface BacklogTaskInput {
  id: string;
  title: string;
  body?: string;
  priority?: 'high' | 'medium' | 'low';
  dependsOn?: string[];
  specId?: string; // the GoalSpec (coco-store card id) this step was decomposed from — emitted as links.spec
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
    '```',
    ...(task.body?.trim() ? [task.body.trim()] : []),
  ].join('\n');

  const sep = existing.length === 0 ? '' : existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
  appendFileSync(p, `${sep}${node}\n`);
}
