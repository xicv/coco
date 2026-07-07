import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cocoDir } from './paths.js';
import type { GoalState } from './types.js';

// coco-audit: a curated, append-only trajectory of MEANINGFUL loop/goal actions, so we can later
// analyse where the loop stalls/churns and (via coco-improve) evolve the skills/CLI. It is:
//   - raw + LOCAL: lives in .coco/ (already gitignored) — never promoted to Oracle briefs as-is;
//   - deterministic: no LLM, captured at the domain-command chokepoint (touchAndWrite + goalStart);
//   - best-effort: a logging failure must NEVER break the referee (all writes swallow errors);
//   - lean + redacted: structural facts only — no evidence text, no objective prose.

export const AUDIT_SCHEMA_VERSION = 1;

export interface AuditRecord {
  v: number; // schema version (AUDIT_SCHEMA_VERSION) — lets readers evolve the shape safely
  at: string; // ISO timestamp of the action
  goalId: string;
  action: string; // the operation label, e.g. 'goal-start' | 'record:review:blocking' | 'verify-start:<id>' | 'merge' | 'auto-merge' | 'oracle-unavailable:review:oracle-timeout'
  state: string; // goal lifecycle at write time (active | achieved | …) — captures the merge→achieved transition
  events: number; // event-ledger length — a cheap monotonic progress signal
  phase?: string; // record:* only — the phase of the just-appended event
  verdict?: string; // record:* only — clean | blocking | pass | fail
  commit?: string; // record:* only — HEAD sha of the event
  tree?: string; // record:* only — git tree hash of the event
  failCount?: number; // fingerprint stuck-detection counter, when present
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

/** Append one audit line. Best-effort: NEVER throws — auditing must not break the referee. */
export function appendAudit(repo: string, record: AuditRecord): void {
  try {
    mkdirSync(cocoDir(repo), { recursive: true });
    appendFileSync(auditPath(repo), `${JSON.stringify(record)}\n`);
  } catch {
    // observability is best-effort — a failed write is silently dropped, the loop is unaffected
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
export function readAudit(repo: string): AuditRecord[] {
  const p = auditPath(repo);
  if (!existsSync(p)) return [];
  const out: AuditRecord[] = [];
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as AuditRecord);
    } catch {
      // skip a torn/malformed line rather than failing the whole read
    }
  }
  return out;
}
