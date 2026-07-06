import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertUniqueIds, parseBacklog, pickNext, setStatus, toPublic, type PublicBacklogNode } from '../backlog.js';

export function backlogPath(repo: string): string {
  return join(repo, 'BACKLOG.md');
}

function read(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n'); // normalize line endings
}

/** The next actionable task from BACKLOG.md (highest-priority ready + deps done), or null. */
export function cocoNext(repo: string): { task: PublicBacklogNode | null } {
  const p = backlogPath(repo);
  if (!existsSync(p)) return { task: null };
  const nodes = parseBacklog(read(p));
  assertUniqueIds(nodes);
  const next = pickNext(nodes);
  return { task: next ? toPublic(next) : null };
}

/** Mark a backlog task done (after its goal merges). */
export function cocoDone(repo: string, id: string): { ok: true; id: string } {
  const p = backlogPath(repo);
  if (!existsSync(p)) throw new Error('coco: no BACKLOG.md in this repo');
  writeFileSync(p, setStatus(read(p), id, 'done'));
  return { ok: true, id };
}
