import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cocoDir } from '../paths.js';
import { goalHealth } from './health.js';
import { notify } from './notify.js';

/** Verdicts that need no attention. */
const CALM = new Set(['healthy', 'none', 'achieved', 'cancelled']);

export interface AlertDecision {
  notify: boolean;
  reason: string;
}

export interface WatchState {
  goalId: string | null;
  reason: string;
}

/**
 * Pure: given the active goal + its health verdict + staleness, should the watchdog alert?
 * Dedup is keyed on (goalId, reason) so a NEW goal with the same problem still alerts, and a
 * repeat of the same situation on the same goal does not nag.
 */
export function shouldAlert(
  goalId: string | null,
  verdict: string,
  staleForSec: number | null,
  staleThresholdSec: number,
  last: WatchState | null,
): AlertDecision {
  const stale = staleForSec != null && staleForSec > staleThresholdSec;
  const reason = !CALM.has(verdict) ? verdict : stale ? 'stalled' : 'healthy';
  const problem = reason !== 'healthy';
  const isNew = !last || last.goalId !== goalId || last.reason !== reason;
  return { notify: problem && isNew, reason };
}

function statePath(repo: string): string {
  return join(cocoDir(repo), 'watch.json');
}
function readState(repo: string): WatchState | null {
  try {
    const s = JSON.parse(readFileSync(statePath(repo), 'utf8')) as Partial<WatchState>;
    return { goalId: s.goalId ?? null, reason: String(s.reason ?? 'healthy') };
  } catch {
    return null;
  }
}
function writeState(repo: string, state: WatchState, now: string): void {
  mkdirSync(cocoDir(repo), { recursive: true });
  writeFileSync(statePath(repo), JSON.stringify({ ...state, at: now }));
}

export type Notifier = (title: string, message: string) => unknown;

/** One watchdog pass: health-check the active goal, notify on a NEW problem/stall. */
export function runWatch(
  repo: string,
  opts: { staleThresholdSec?: number; now?: Date } = {},
  notifier: Notifier = notify,
): { verdict: string; reason: string; notified: boolean } {
  const nowIso = (opts.now ?? new Date()).toISOString();

  let report: ReturnType<typeof goalHealth> | null = null;
  if (existsSync(cocoDir(repo))) {
    try {
      report = goalHealth(repo);
    } catch {
      report = null; // genuinely no active goal
    }
  }

  if (!report) {
    // No active goal — record it so the next goal's first problem re-alerts.
    writeState(repo, { goalId: null, reason: 'no-goal' }, nowIso);
    return { verdict: 'no-goal', reason: 'healthy', notified: false };
  }

  const staleForSec = (report.details as { staleForSec?: number | null }).staleForSec ?? null;
  const decision = shouldAlert(report.goalId, report.verdict, staleForSec, opts.staleThresholdSec ?? 1800, readState(repo));
  writeState(repo, { goalId: report.goalId, reason: decision.reason }, nowIso); // track for next-run dedup
  if (decision.notify) {
    notifier('coco loop needs attention', `${report.goalId}: ${decision.reason}`);
    return { verdict: report.verdict, reason: decision.reason, notified: true };
  }
  return { verdict: report.verdict, reason: decision.reason, notified: false };
}
