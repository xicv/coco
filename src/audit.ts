import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z, ZodError } from 'zod';
import { cocoDir } from './paths.js';
import type { GoalState } from './types.js';

// coco-audit: a curated, append-only trajectory of MEANINGFUL loop/goal actions, so we can later
// analyse where the loop stalls/churns and (via coco-improve) evolve the skills/CLI. It is:
//   - raw + LOCAL: lives in .coco/ (already gitignored) — never promoted to Oracle briefs as-is;
//   - deterministic: no LLM, captured at the domain-command chokepoint (touchAndWrite + goalStart);
//   - best-effort: a logging failure must NEVER break the referee (all writes swallow errors);
//   - lean + redacted: structural facts only — no evidence text, no objective prose.

export const AUDIT_SCHEMA_VERSION = 1;

export const AUDIT_FEEDBACK_KINDS = [
  'goal-quality',
  'implementation-quality',
  'loop-friction',
  'review-quality',
  'verification-quality',
  'status-clarity',
] as const;
export type AuditFeedbackKind = (typeof AUDIT_FEEDBACK_KINDS)[number];

export interface AuditRecord {
  v: number; // schema version (AUDIT_SCHEMA_VERSION) — lets readers evolve the shape safely
  at: string; // ISO timestamp of the action
  goalId: string;
  action: string; // e.g. 'goal-start' | 'record:review:blocking' | 'merge' | 'feedback:goal-quality'
  state: string; // goal lifecycle at write time (active | achieved | …) — captures the merge→achieved transition
  events: number; // event-ledger length — a cheap monotonic progress signal
  phase?: string; // record:* only — the phase of the just-appended event
  verdict?: string; // record:* only — clean | blocking | pass | fail
  commit?: string; // record:* only — HEAD sha of the event
  tree?: string; // record:* only — git tree hash of the event
  failCount?: number; // fingerprint stuck-detection counter, when present
  kind?: AuditFeedbackKind; // feedback:* only — structured human feedback kind
  rating?: number; // feedback:* only — 1..5, higher is better
  tags?: string[]; // feedback:* only — normalized short tags, no prose
  noteHash?: string; // feedback:* only — hash of local note, never the note itself
  noteLength?: number; // feedback:* only — lets us distinguish empty vs substantive feedback without storing prose
}

const auditFeedbackKindSchema = z.enum(AUDIT_FEEDBACK_KINDS);
const auditRecordSchema = z
  .object({
    v: z.number().int().positive(),
    at: z.string().min(1),
    goalId: z.string().min(1),
    action: z.string().min(1),
    state: z.string().min(1),
    events: z.number().int().nonnegative(),
    phase: z.string().optional(),
    verdict: z.string().optional(),
    commit: z.string().optional(),
    tree: z.string().optional(),
    failCount: z.number().int().nonnegative().optional(),
    kind: auditFeedbackKindSchema.optional(),
    rating: z.number().int().min(1).max(5).optional(),
    tags: z.array(z.string()).optional(),
    noteHash: z.string().optional(),
    noteLength: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export interface AuditInvalidLine {
  line: number;
  reason: string;
  rawHash: string;
}
export interface ReadAuditDetailed {
  records: AuditRecord[];
  invalid: AuditInvalidLine[];
  totalLines: number;
}

function hashText(raw: string): string {
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

function explainZod(e: ZodError): string {
  return e.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; ');
}

export function parseAuditRecord(raw: unknown): AuditRecord {
  try {
    return auditRecordSchema.parse(raw) as AuditRecord;
  } catch (e) {
    if (e instanceof ZodError) throw new Error(`audit schema invalid (${explainZod(e)})`);
    throw e;
  }
}

export function auditPath(repo: string): string {
  return join(cocoDir(repo), 'audit.ndjson');
}

/** Build a lean, redacted audit record from goal state + the operation label. Pure. */
export function buildAuditRecord(goal: GoalState, operation: string): AuditRecord {
  const rec: AuditRecord = {
    v: AUDIT_SCHEMA_VERSION,
    at: goal.updatedAt ?? new Date().toISOString(),
    goalId: goal.id,
    action: operation,
    state: goal.state,
    events: goal.events.length,
  };
  // Only a record:* op just appended an event; attach its structural facts (never its evidence text).
  if (operation.startsWith('record:')) {
    const last = goal.events[goal.events.length - 1];
    if (last) {
      rec.phase = last.phase;
      if (last.verdict) rec.verdict = last.verdict;
      rec.commit = last.commit;
      rec.tree = last.tree;
    }
  }
  if (goal.failureLoop?.count) rec.failCount = goal.failureLoop.count;
  return rec;
}

function normalizeTags(tags?: string[]): string[] | undefined {
  const out = [...new Set((tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean).map((t) => t.slice(0, 40)))];
  return out.length ? out : undefined;
}

export function buildFeedbackRecord(input: {
  goalId: string;
  kind: AuditFeedbackKind;
  rating: number;
  tags?: string[];
  note?: string;
  at?: Date;
}): AuditRecord {
  if (!input.goalId.trim()) throw new Error('coco audit feedback: --goal is required');
  if (!AUDIT_FEEDBACK_KINDS.includes(input.kind)) throw new Error(`coco audit feedback: --kind must be ${AUDIT_FEEDBACK_KINDS.join('|')}`);
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw new Error('coco audit feedback: --rating must be an integer 1..5');
  const note = input.note?.trim();
  return parseAuditRecord({
    v: AUDIT_SCHEMA_VERSION,
    at: (input.at ?? new Date()).toISOString(),
    goalId: input.goalId.trim(),
    action: `feedback:${input.kind}`,
    state: 'feedback',
    events: 0,
    kind: input.kind,
    rating: input.rating,
    ...(normalizeTags(input.tags) ? { tags: normalizeTags(input.tags) } : {}),
    ...(note ? { noteHash: hashText(note), noteLength: note.length } : {}),
  });
}

export function appendAuditFeedback(repo: string, input: Parameters<typeof buildFeedbackRecord>[0]): AuditRecord {
  const rec = buildFeedbackRecord(input);
  appendAudit(repo, rec);
  return rec;
}

/** Append one audit line. Best-effort: NEVER throws — auditing must not break the referee. */
export function appendAudit(repo: string, record: AuditRecord): void {
  try {
    const normalized = parseAuditRecord(record); // cheap fail-closed guard: only valid audit shapes are written
    mkdirSync(cocoDir(repo), { recursive: true });
    appendFileSync(auditPath(repo), `${JSON.stringify(normalized)}\n`);
  } catch {
    // observability is best-effort — a failed/invalid write is silently dropped, the loop is unaffected
  }
}

/** Capture a goal-state mutation as an audit event. Best-effort end-to-end (build + append). */
export function auditGoalWrite(repo: string, goal: GoalState, operation: string): void {
  try {
    appendAudit(repo, buildAuditRecord(goal, operation));
  } catch {
    // never let a logging failure surface into the referee path
  }
}

/** Read the audit stream, tolerant of malformed/partial lines (append-only files can tear on crash). */
export function readAuditDetailed(repo: string): ReadAuditDetailed {
  const p = auditPath(repo);
  if (!existsSync(p)) return { records: [], invalid: [], totalLines: 0 };
  const records: AuditRecord[] = [];
  const invalid: AuditInvalidLine[] = [];
  const lines = readFileSync(p, 'utf8').split('\n');
  let totalLines = 0;
  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    totalLines++;
    try {
      records.push(parseAuditRecord(JSON.parse(t) as unknown));
    } catch (e) {
      invalid.push({ line: i + 1, reason: (e as Error).message, rawHash: hashText(t) });
    }
  });
  return { records, invalid, totalLines };
}

export function readAudit(repo: string): AuditRecord[] {
  return readAuditDetailed(repo).records;
}
