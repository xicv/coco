import { initRepo } from '../commands/init.js';
import { goalStart } from '../commands/goalStart.js';
import { goalRecord } from '../commands/goalRecord.js';
import { goalStatus, type StatusReport } from '../commands/goalStatus.js';
import { goalClear } from '../commands/goalClear.js';
import { autoMergeGoal, type AutoMergeResult } from '../commands/merge.js';
import { goalOpStart, goalOpClear } from '../commands/goalOp.js';
import { goalOracleUnavailable } from '../commands/goalOracle.js';
import { verifyStart, verifyResult, type VerifyResultReport, type VerifyStartResult } from '../commands/verify.js';
import { goalHealth } from '../commands/health.js';
import { cocoDone, cocoNext } from '../commands/backlog.js';
import { parseOracleVerdict } from '../oracleVerdict.js';
import { resolveRepo, resolveRepoForInit } from './repo.js';
import type { GoalEvent, InFlight, Phase, ReviewUnavailable, Verdict } from '../types.js';

const EVIDENCE_MAX = 4000;

export function cocoInit(a: { repoDir: string }): { ok: true; repoDir: string } {
  const repo = resolveRepoForInit(a.repoDir);
  initRepo(repo);
  return { ok: true, repoDir: repo };
}

export function cocoGoalStart(a: {
  repoDir: string;
  objective: string;
  acceptanceChecks?: string[];
  maxFixRounds?: number;
  backlogTaskId?: string;
  autoMergeAllowed?: boolean;
  budget?: { maxWallClockMin?: number };
}): { goalId: string; status: StatusReport } {
  const repo = resolveRepo(a.repoDir);
  const { goalId } = goalStart(repo, {
    objective: a.objective,
    acceptanceChecks: a.acceptanceChecks ?? [],
    maxFixRounds: a.maxFixRounds ?? 5,
    backlogTaskId: a.backlogTaskId,
    autoMergeAllowed: a.autoMergeAllowed,
    budget: a.budget,
  });
  return { goalId, status: goalStatus(repo, goalId) };
}

/** Layer 2 auto-merge (opt-in per goal). Gated server-side by consent + every mergeDecision gate +
 * risk-tier; a refusal returns next:'human-merge'|'continue-loop' — it can never merge a
 * non-consented, non-green, or risky goal. The human `coco merge` CLI is the manual path. */
export function cocoMerge(a: { repoDir: string; goalId: string; expectedSha: string }): AutoMergeResult {
  return autoMergeGoal(resolveRepo(a.repoDir), a.goalId, { expectedSha: a.expectedSha });
}

export function cocoGoalStatus(a: { repoDir: string; goalId?: string }): StatusReport {
  return goalStatus(resolveRepo(a.repoDir), a.goalId);
}

export interface RecordArgs {
  repoDir: string;
  goalId: string;
  phase: Phase;
  expectedSha: string;
  evidence: string;
  verdict?: 'pass' | 'fail';
  reviewOutput?: string;
}

export function cocoGoalRecord(a: RecordArgs): { event: GoalEvent; status: StatusReport } {
  const repo = resolveRepo(a.repoDir);
  if (!a.evidence || !a.evidence.trim()) throw new Error('coco: evidence is required for every record');

  // verify is coco-owned (coco runs the tests) — the agent may NOT self-report a verify verdict.
  if (a.phase === 'verify') {
    throw new Error('coco: verify is coco-owned — run coco_goal_verify_start / coco_goal_verify_result, not coco_goal_record');
  }
  // No phase accepts a verdict via record now (verify moved to the verifier).
  if (a.verdict !== undefined) {
    throw new Error('coco: verdict is not accepted by coco_goal_record (verify is coco-owned)');
  }
  if (a.phase !== 'review' && a.reviewOutput !== undefined) {
    throw new Error(`coco: ${a.phase} takes no reviewOutput (reviewOutput is review-only)`);
  }

  let verdict: Verdict | undefined;
  if (a.phase === 'review') {
    const v = parseOracleVerdict(a.reviewOutput ?? '');
    if (!v) {
      // Oracle returned text but no usable verdict. Set the DURABLE review-unavailable marker so the
      // loop pauses (nextAction → escalate-human) and merge is refused — a plain throw would leave
      // health `healthy` and risk a false-green. (goalOracleUnavailable also clears inFlight.)
      try {
        goalOracleUnavailable(repo, { goal: a.goalId, phase: 'review', reason: 'ambiguous-verdict', attempts: 1, evidence: (a.reviewOutput ?? '').slice(0, EVIDENCE_MAX) });
      } catch {
        // no active goal / not on branch — fall through to the throw
      }
      throw new Error(
        'coco: Oracle review verdict missing/ambiguous — expected a line "VERDICT: clean" or "VERDICT: blocking". Recorded review-unavailable; the loop is paused for the human.',
      );
    }
    verdict = v;
  }

  const event = goalRecord(repo, {
    goal: a.goalId,
    phase: a.phase,
    expectedSha: a.expectedSha,
    verdict,
    evidence: a.evidence.slice(0, EVIDENCE_MAX),
  });
  return { event, status: goalStatus(repo, a.goalId) };
}

export function cocoGoalOpStart(a: { repoDir: string; goalId: string; phase: Phase; kind: InFlight['kind'] }): { inFlight: InFlight; status: StatusReport } {
  const repo = resolveRepo(a.repoDir);
  const inFlight = goalOpStart(repo, { goal: a.goalId, phase: a.phase, kind: a.kind });
  return { inFlight, status: goalStatus(repo, a.goalId) };
}

export function cocoGoalOpClear(a: { repoDir: string; goalId: string }): { ok: true; status: StatusReport } {
  const repo = resolveRepo(a.repoDir);
  goalOpClear(repo, { goal: a.goalId });
  return { ok: true, status: goalStatus(repo, a.goalId) };
}

export function cocoGoalOracleUnavailable(a: {
  repoDir: string;
  goalId: string;
  phase: ReviewUnavailable['phase'];
  reason: ReviewUnavailable['reason'];
  attempts?: number;
  evidence?: string;
}): { reviewUnavailable: ReviewUnavailable; status: StatusReport } {
  const repo = resolveRepo(a.repoDir);
  const marker = goalOracleUnavailable(repo, { goal: a.goalId, phase: a.phase, reason: a.reason, attempts: a.attempts, evidence: a.evidence });
  return { reviewUnavailable: marker, status: goalStatus(repo, a.goalId) };
}

export function cocoGoalVerifyStart(a: { repoDir: string; goalId: string; expectedSha: string }): VerifyStartResult {
  return verifyStart(resolveRepo(a.repoDir), { goal: a.goalId, expectedSha: a.expectedSha });
}

export function cocoGoalVerifyResult(a: { repoDir: string; goalId: string; runId: string }): VerifyResultReport {
  return verifyResult(resolveRepo(a.repoDir), { goal: a.goalId, runId: a.runId });
}

export function cocoHealth(a: { repoDir: string; goalId?: string }): ReturnType<typeof goalHealth> {
  return goalHealth(resolveRepo(a.repoDir), a.goalId);
}

export function cocoGoalClear(a: { repoDir: string; goalId: string }): { ok: true; cleared: string } {
  const repo = resolveRepo(a.repoDir);
  goalClear(repo, a.goalId);
  return { ok: true, cleared: a.goalId };
}

export function cocoNextTool(a: { repoDir: string }): ReturnType<typeof cocoNext> {
  return cocoNext(resolveRepo(a.repoDir));
}

export function cocoDoneTool(a: { repoDir: string; taskId: string }): ReturnType<typeof cocoDone> {
  return cocoDone(resolveRepo(a.repoDir), a.taskId);
}
