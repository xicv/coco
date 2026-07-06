import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseBacklog } from '../backlog.js';
import { appendBacklogTask, type BacklogTaskInput } from './backlogPromote.js';
import { rankedFind } from './find.js';
import { readCards, upsertCard } from './manifest.js';
import { buildBrief } from './pack.js';
import { STORE_GITIGNORE_LINES, briefsDir, pendingDir, roadmapPath, storeDir } from './paths.js';
import { contentHashOf, makeCardId, parseCard, type ResourceCard } from './schema.js';
import { assertGoalSpecHasRequiredSections } from './specValidate.js';

function ensureGitignore(repo: string): void {
  const p = join(repo, '.gitignore');
  const existing = existsSync(p) ? readFileSync(p, 'utf8') : '';
  const lines = existing.split('\n').map((l) => l.trim());
  const missing = STORE_GITIGNORE_LINES.filter((l) => !lines.includes(l));
  if (missing.length) appendFileSync(p, `${existing && !existing.endsWith('\n') ? '\n' : ''}# coco-store local data\n${missing.join('\n')}\n`);
}

/** Create .coco-store/ + a starter roadmap.md and ensure .gitignore hides local data. Idempotent.
 * Boundary note: coco-store writes ONLY .coco-store/**, BACKLOG.md (promote), and the brief path;
 * .gitignore is the one extra setup write (idempotent — init seeds it, viz refreshes it before
 * writing its pending output), exactly as `coco init` does; never .coco/goals. */
export function storeInit(repo: string): { store: string } {
  mkdirSync(briefsDir(repo), { recursive: true });
  if (!existsSync(roadmapPath(repo))) writeFileSync(roadmapPath(repo), '# Roadmap\n\n(Set the project direction here — this is the CEO layer that feeds coco-loop.)\n');
  ensureGitignore(repo);
  return { store: storeDir(repo) };
}

export interface AddInput {
  title?: string;
  body?: string;
  file?: string;
  type?: string;
  category?: string;
  tags?: string[];
  intent?: string;
  kind?: ResourceCard['kind'];
  visibility?: 'local' | 'shared';
  ownsSymbols?: string[];
  ownsEndpoints?: string[];
  ownsConfig?: string[];
  now?: Date;
}

/** Add or replace a resource card. Body from --body or a file; title from --title or the filename. */
export function storeAdd(repo: string, a: AddInput): ResourceCard {
  const body = a.body ?? (a.file ? readFileSync(a.file, 'utf8') : undefined);
  if (body == null) throw new Error('coco-store add: need --body or a file path');
  const title = a.title ?? (a.file ? basename(a.file) : undefined);
  if (!title) throw new Error('coco-store add: need --title (or a file to take the title from)');
  const type = a.type ?? 'doc';
  if (type === 'spec') assertGoalSpecHasRequiredSections(body); // a weak GoalSpec must not be archivable
  const owns =
    a.ownsSymbols?.length || a.ownsEndpoints?.length || a.ownsConfig?.length
      ? {
          ...(a.ownsSymbols?.length ? { symbols: a.ownsSymbols } : {}),
          ...(a.ownsEndpoints?.length ? { endpoints: a.ownsEndpoints } : {}),
          ...(a.ownsConfig?.length ? { configKeys: a.ownsConfig } : {}),
        }
      : undefined;
  const card = parseCard({
    id: makeCardId(title, body),
    type,
    title,
    body,
    timestamp: (a.now ?? new Date()).toISOString(),
    contentHash: contentHashOf(body),
    ...(a.category ? { category: a.category } : {}),
    ...(a.tags?.length ? { tags: a.tags } : {}),
    ...(a.intent ? { intent: a.intent } : {}),
    ...(a.kind ? { kind: a.kind } : {}),
    ...(owns ? { owns } : {}),
    ...(a.visibility ? { visibility: a.visibility } : {}),
    ...(a.file ? { sourcePaths: [a.file] } : {}),
  });
  const cards = upsertCard(repo, card);
  return cards.find((c) => c.id === card.id) ?? card; // the PERSISTED card (merged links), not the pre-merge input
}

export interface ListItem {
  id: string;
  title: string;
  type: string;
  timestamp: string;
  category?: string;
  kind?: string;
  tags?: string[];
}
export interface ListGroup {
  group: string;
  items: ListItem[];
}
export type GroupBy = 'category' | 'type' | 'kind' | 'tag';

function toListItem(c: ResourceCard): ListItem {
  return {
    id: c.id,
    title: c.title,
    type: c.type,
    timestamp: c.timestamp,
    ...(c.category ? { category: c.category } : {}),
    ...(c.kind ? { kind: c.kind } : {}),
    ...(c.tags?.length ? { tags: [...c.tags] } : {}), // clone — never alias the card's array
  };
}

/** New (never in-place) sort by title or timestamp; no `sort` → manifest order preserved. */
function sortItems(items: ListItem[], sort?: 'title' | 'timestamp'): ListItem[] {
  if (!sort) return items;
  return [...items].sort((a, b) => (sort === 'title' ? a.title.localeCompare(b.title) : a.timestamp.localeCompare(b.timestamp)));
}

/** Flat card list in manifest order, optionally sorted by title or timestamp. */
export function storeList(repo: string, opts: { sort?: 'title' | 'timestamp' } = {}): ListItem[] {
  return sortItems(readCards(repo).map(toListItem), opts.sort);
}

/** Group the card list by a field. `tag` is multi-valued (a card appears under EACH of its tags);
 * a card missing the field buckets under "(none)". Groups are name-sorted; items sorted by `sort`. */
export function storeGroup(repo: string, opts: { by: GroupBy; sort?: 'title' | 'timestamp' }): ListGroup[] {
  const buckets = new Map<string, ListItem[]>();
  const add = (k: string, it: ListItem) => {
    const arr = buckets.get(k);
    if (arr) arr.push(it);
    else buckets.set(k, [it]);
  };
  for (const it of readCards(repo).map(toListItem)) {
    if (opts.by === 'tag') {
      // normalize: trim, drop empties, dedupe — a card lands in each distinct tag bucket exactly once
      const tags = [...new Set((it.tags ?? []).map((t) => t.trim()).filter(Boolean))];
      for (const t of tags.length ? tags : ['(none)']) add(t, it);
    } else {
      const v = (it[opts.by] ?? '').trim();
      add(v || '(none)', it);
    }
  }
  return [...buckets.keys()].sort((a, b) => a.localeCompare(b)).map((group) => ({ group, items: sortItems(buckets.get(group)!, opts.sort) }));
}

export function storeShow(repo: string, id: string): ResourceCard {
  const c = readCards(repo).find((x) => x.id === id);
  if (!c) throw new Error(`coco-store: no card '${id}'`);
  return c;
}

export const LINK_RELS = ['defines', 'references', 'relates-to', 'depends-on'] as const;
export type LinkRel = (typeof LINK_RELS)[number];

/** Add a typed link from one card to another (mutator; links surface via `show`). Dedupes an
 * identical rel+to (no-op). A forward reference to a not-yet-existing `to` is allowed. */
export function storeLink(repo: string, opts: { from: string; to: string; rel: LinkRel }): ResourceCard {
  if (!LINK_RELS.includes(opts.rel)) throw new Error(`coco-store link: --rel must be ${LINK_RELS.join('|')}`);
  if (!opts.to.trim()) throw new Error('coco-store link: --to must be a non-empty card id');
  const card = readCards(repo).find((c) => c.id === opts.from);
  if (!card) throw new Error(`coco-store link: no card '${opts.from}'`);
  const links = card.links ?? [];
  if (links.some((l) => l.rel === opts.rel && l.to === opts.to)) return card; // already linked → no-op
  const updated: ResourceCard = { ...card, links: [...links, { rel: opts.rel, to: opts.to }] };
  const cards = upsertCard(repo, updated);
  return cards.find((c) => c.id === updated.id) ?? updated; // the PERSISTED (merged) card
}

export function storeFind(repo: string, query: string, limit = 10): { id: string; title: string; rank: number; reason: string }[] {
  return rankedFind(readCards(repo), query)
    .slice(0, limit)
    .map((r) => ({ id: r.card.id, title: r.card.title, rank: r.rank, reason: r.reason }));
}

export function storePack(
  repo: string,
  opts: { goalId: string; query?: string; budgetBytes?: number; backgroundFile?: string; backgroundText?: string },
): ReturnType<typeof buildBrief> {
  return buildBrief(repo, opts);
}

export function storeRoadmap(repo: string, opts: { append?: string } = {}): { roadmap: string } {
  const p = roadmapPath(repo);
  if (opts.append) {
    mkdirSync(storeDir(repo), { recursive: true });
    const cur = existsSync(p) ? readFileSync(p, 'utf8') : '';
    appendFileSync(p, `${cur && !cur.endsWith('\n') ? '\n' : ''}- ${opts.append}\n`);
  }
  return { roadmap: existsSync(p) ? readFileSync(p, 'utf8') : '' };
}

export function storePromote(repo: string, task: BacklogTaskInput): { promoted: string } {
  appendBacklogTask(repo, task);
  return { promoted: task.id };
}

const vizLabel = (s: string): string => s.replace(/"/g, "'").replace(/\s+/g, ' ').trim().slice(0, 60);

/** Emit a STRUCTURAL mermaid project graph — roadmap → spec cards → their backlog tasks (linked via
 * `links.spec`) → card→card typed links — to the git-ignored `.coco-store/pending/` dir (no status
 * labels, so it stays a pure structure view and never churns a tracked file). */
export function storeViz(repo: string): { path: string; mermaid: string } {
  const cards = readCards(repo);
  const byId = new Map(cards.map((c) => [c.id, c]));
  const specs = cards.filter((c) => c.type === 'spec');
  const backlog = join(repo, 'BACKLOG.md');
  const tasks = parseBacklog(existsSync(backlog) ? readFileSync(backlog, 'utf8') : '');

  // Provably-injective node ids: each distinct (kind, raw id) → a unique short id `${kind}${n}`.
  // Same id → same node (edges connect); collisions are impossible (labels carry the real title).
  const nodeIds = new Map<string, string>();
  const nodeId = (kind: 'n' | 't', id: string): string => {
    const key = `${kind}:${id}`;
    let n = nodeIds.get(key);
    if (!n) {
      n = `${kind}${nodeIds.size}`;
      nodeIds.set(key, n);
    }
    return n;
  };

  const decl = new Map<string, string>([['roadmap', '  roadmap["Roadmap"]']]);
  const edges: string[] = [];
  const cardNode = (id: string): string => {
    const n = nodeId('n', id);
    if (!decl.has(n)) decl.set(n, `  ${n}["${vizLabel(byId.get(id)?.title ?? id)}"]`);
    return n;
  };
  for (const s of specs) edges.push(`  roadmap --> ${cardNode(s.id)}`);
  for (const t of tasks) {
    const tn = nodeId('t', t.id);
    decl.set(tn, `  ${tn}(["${vizLabel(t.title)}"])`);
    const spec = typeof t.links.spec === 'string' ? t.links.spec : undefined;
    if (spec && byId.get(spec)?.type === 'spec') edges.push(`  ${cardNode(spec)} --> ${tn}`);
  }
  for (const c of cards) for (const l of c.links ?? []) edges.push(`  ${cardNode(c.id)} -. ${vizLabel(l.rel)} .-> ${cardNode(l.to)}`);

  const mermaid = ['graph TD', ...decl.values(), ...edges].join('\n');
  ensureGitignore(repo); // guarantee .coco-store/pending/ is ignored even if `coco-store init` was never run
  mkdirSync(pendingDir(repo), { recursive: true });
  const path = join(pendingDir(repo), 'project-graph.md');
  writeFileSync(path, `# Project graph\n\n\`\`\`mermaid\n${mermaid}\n\`\`\`\n`);
  return { path, mermaid };
}

export interface SpecProgress {
  spec: string; // originating spec id, or 'unlinked'
  total: number;
  done: number;
  byStatus: Record<string, number>;
  tasks: { id: string; title: string; status: string }[];
}

/** Progress over BACKLOG.md, grouped by originating spec (`links.spec`). Read-only, parser-only —
 * never reads `.coco/goals` or loop state. A missing/non-string `links.spec` buckets under 'unlinked'. */
export function storeProgress(repo: string): SpecProgress[] {
  const p = join(repo, 'BACKLOG.md');
  const nodes = parseBacklog(existsSync(p) ? readFileSync(p, 'utf8') : '');
  const groups = new Map<string, { id: string; title: string; status: string }[]>();
  for (const n of nodes) {
    const spec = typeof n.links.spec === 'string' ? n.links.spec : 'unlinked';
    const task = { id: n.id, title: n.title, status: n.status };
    const arr = groups.get(spec);
    if (arr) arr.push(task);
    else groups.set(spec, [task]);
  }
  return [...groups.keys()].sort((a, b) => a.localeCompare(b)).map((spec) => {
    const tasks = groups.get(spec)!;
    const byStatus: Record<string, number> = {};
    for (const t of tasks) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    return { spec, total: tasks.length, done: byStatus.done ?? 0, byStatus, tasks };
  });
}
