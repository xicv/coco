import { parse as parseYaml } from 'yaml';

export type BacklogStatus = 'ready' | 'in-progress' | 'blocked' | 'done';

export interface BacklogNode {
  id: string;
  title: string;
  status: string;
  priority: string;
  dependsOn: string[];
  links: Record<string, unknown>;
  body: string;
  raw: string; // exact source chunk
  start: number; // char offset in the source
  end: number;
}

/** Public shape returned over CLI/MCP — no internal offsets/raw, body capped. */
export interface PublicBacklogNode {
  id: string;
  title: string;
  status: string;
  priority: string;
  dependsOn: string[];
  links: Record<string, unknown>;
  body: string;
}

const HEADING_LINE = /^###\s+(\S+)\s+[—-]\s+(.+?)\s*$/;
const YAML_FENCE = /```ya?ml[^\n]*\n([\s\S]*?)\n```/;
const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
const BODY_MAX = 4000;

interface RawNode {
  start: number;
  end: number;
  headingId: string;
  title: string;
  text: string;
}

/** Split into `### id — title` sections, tracking code fences so a heading inside a fenced body is NOT a node boundary. */
function scanNodes(text: string): RawNode[] {
  const lines = text.split('\n');
  const lineStart: number[] = [];
  let o = 0;
  for (const l of lines) {
    lineStart.push(o);
    o += l.length + 1;
  }

  const nodes: RawNode[] = [];
  let inFence = false;
  let cur: { start: number; headingId: string; title: string } | null = null;
  const push = (endOffset: number) => {
    if (cur) nodes.push({ start: cur.start, end: endOffset, headingId: cur.headingId, title: cur.title, text: text.slice(cur.start, endOffset) });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence; // toggle on any fence line (balanced fences → correct)
      continue;
    }
    if (inFence) continue;
    const h = line.match(HEADING_LINE);
    if (h) {
      push(lineStart[i]);
      cur = { start: lineStart[i], headingId: h[1], title: h[2] };
    }
  }
  push(text.length);
  return nodes;
}

/**
 * Parse BACKLOG.md into task nodes. A section is a TASK only if it has a parseable ```yaml
 * block; sections without one (or with invalid YAML) are ignored, never defaulted to actionable.
 * A missing `status` defaults to `blocked` (non-actionable), never `ready`.
 */
export function parseBacklog(text: string): BacklogNode[] {
  const out: BacklogNode[] = [];
  for (const rn of scanNodes(text)) {
    const y = rn.text.match(YAML_FENCE);
    if (!y) continue; // not a task
    let meta: Record<string, unknown>;
    try {
      const parsed = parseYaml(y[1].replace(/\r/g, ''));
      if (!parsed || typeof parsed !== 'object') continue;
      meta = parsed as Record<string, unknown>;
    } catch {
      continue; // invalid YAML → not an actionable task
    }
    const dep = (meta as { dependsOn?: unknown }).dependsOn;
    out.push({
      id: String(meta.id ?? rn.headingId),
      title: rn.title,
      status: meta.status != null ? String(meta.status) : 'blocked',
      priority: meta.priority != null ? String(meta.priority) : 'medium',
      dependsOn: Array.isArray(dep) ? dep.map(String) : dep != null ? [String(dep)] : [],
      links: meta.links && typeof meta.links === 'object' ? (meta.links as Record<string, unknown>) : {},
      body: rn.text.slice(rn.text.indexOf(y[0]) + y[0].length).trim(),
      raw: rn.text,
      start: rn.start,
      end: rn.end,
    });
  }
  return out;
}

/** Throw if two nodes share an id (ambiguous selection/update). */
export function assertUniqueIds(nodes: BacklogNode[]): void {
  const seen = new Set<string>();
  for (const n of nodes) {
    if (seen.has(n.id)) throw new Error(`coco: duplicate backlog task id '${n.id}' — ids must be unique`);
    seen.add(n.id);
  }
}

/** Highest-priority `ready` node whose deps are all `done`, in document order for ties. */
export function pickNext(nodes: BacklogNode[]): BacklogNode | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ready = nodes.filter(
    (n) => n.status === 'ready' && n.dependsOn.every((d) => byId.get(d)?.status === 'done'),
  );
  if (ready.length === 0) return null;
  ready.sort(
    (a, b) => (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1) || nodes.indexOf(a) - nodes.indexOf(b),
  );
  return ready[0];
}

export function toPublic(n: BacklogNode): PublicBacklogNode {
  return {
    id: n.id,
    title: n.title,
    status: n.status,
    priority: n.priority,
    dependsOn: n.dependsOn,
    links: n.links,
    body: n.body.length > BODY_MAX ? `${n.body.slice(0, BODY_MAX)}…` : n.body,
  };
}

/** New backlog text with node `id`'s status set to `status`, rewriting the EXACT node via offsets. */
export function setStatus(text: string, id: string, status: BacklogStatus): string {
  const nodes = parseBacklog(text);
  const matches = nodes.filter((n) => n.id === id);
  if (matches.length === 0) throw new Error(`coco: no backlog task '${id}'`);
  if (matches.length > 1) throw new Error(`coco: duplicate backlog task id '${id}' — ids must be unique`);
  const node = matches[0];

  const y = node.raw.match(/(```ya?ml[^\n]*\n)([\s\S]*?)(\n```)/);
  if (!y) throw new Error(`coco: backlog task '${id}' has no yaml block`);
  const yamlBody = /^\s*status:/m.test(y[2])
    ? y[2].replace(/^(\s*status:\s*).*$/m, `$1${status}`)
    : `${y[2]}\nstatus: ${status}`;
  const newRaw = node.raw.replace(y[0], `${y[1]}${yamlBody}${y[3]}`);
  return text.slice(0, node.start) + newRaw + text.slice(node.end);
}
