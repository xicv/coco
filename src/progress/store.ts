// coco-store progress adapter: storeProgress() output + roadmap → ProgressView. Presentation only —
// it consumes the authoritative SpecProgress[] (never re-parses BACKLOG) and the roadmap text.

import type { SpecProgress } from '../store/commands.js';
import type { ProgressView } from './view.js';

// Preferred display order for known backlog statuses; unknown ones append, name-sorted.
const STATUS_ORDER = ['ready', 'in-progress', 'blocked', 'done'];

function aggregate(specs: SpecProgress[]): { total: number; byStatus: Record<string, number> } {
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const s of specs) {
    total += s.total;
    for (const [k, n] of Object.entries(s.byStatus)) byStatus[k] = (byStatus[k] ?? 0) + n;
  }
  return { total, byStatus };
}

function backlogLine(specs: SpecProgress[]): string {
  const { total, byStatus } = aggregate(specs);
  if (!total) return 'no tasks yet';
  const known = STATUS_ORDER.filter((k) => k in byStatus);
  const extra = Object.keys(byStatus).filter((k) => !STATUS_ORDER.includes(k)).sort();
  const parts = [...known, ...extra].map((k) => `${k} ${byStatus[k]}`);
  return `${total} task${total === 1 ? '' : 's'}  ·  ${parts.join(' · ')}`;
}

function specsLine(specs: SpecProgress[]): string {
  const real = specs.filter((s) => s.spec !== 'unlinked');
  if (!real.length) return 'none';
  const complete = real.filter((s) => s.total > 0 && s.done === s.total).length;
  const inProgress = real.length - complete;
  const unlinked = specs.find((s) => s.spec === 'unlinked');
  const tail = unlinked ? `  ·  ${unlinked.total} unlinked` : '';
  return `${real.length}  ·  ${complete} complete · ${inProgress} in progress${tail}`;
}

/** Current direction = the last non-empty roadmap bullet, clipped. */
function roadmapLine(roadmap: string): string {
  const bullets = roadmap
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim())
    .filter(Boolean);
  if (!bullets.length) return '(empty)';
  const last = bullets[bullets.length - 1];
  return `▸ "${last.length > 60 ? `${last.slice(0, 57)}…` : last}"`;
}

export function storeView(specs: SpecProgress[], roadmap: string): ProgressView {
  const rows = [
    { label: 'Backlog', value: backlogLine(specs) },
    { label: 'Specs', value: specsLine(specs) },
    { label: 'Roadmap', value: roadmapLine(roadmap) },
  ];
  const provenance = `source: coco-store progress · ${specs.length} spec group${specs.length === 1 ? '' : 's'}`;
  return { skill: 'coco-store', subject: 'project pulse', rows, provenance };
}
