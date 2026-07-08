export type Phase = 'plan' | 'implement' | 'review' | 'verify';
export type Verdict = 'clean' | 'blocking' | 'pass' | 'fail';

export interface GoalEvent {
  phase: Phase;
  at: string; // ISO timestamp
  commit: string; // HEAD sha at record time
  tree: string; // git tree hash at record time
  verdict?: Verdict;
  evidence?: string;
  runId?: string; // verify only: the coco-owned run that produced this event (dedups crash-recovery re-records)
}

export type GoalLifecycle = 'active' | 'achieved' | 'blocked' | 'failed' | 'cancelled';

/** A long-running op (Oracle consult / test run) currently in flight. Set when it starts,
 * cleared when it completes/aborts. Lets health tell a legit long op from a stalled loop. */
export interface InFlight {
  phase: Phase;
  kind: 'oracle' | 'test';
  startedAt: string; // ISO timestamp when the op began
  runId?: string; // for a coco-owned verify run: the run this in-flight op belongs to (binds verifyResult → verifyStart)
}

export interface GoalState {
  schemaVersion?: number; // persisted goal-ledger schema. Missing on old goals; readGoal migrates to the current version.
  id: string;
  objective: string;
  branch: string;
  base: string; // e.g. "main" or a configured base branch
  baseTree?: string; // git tree hash of the base at goal start — an implement must differ from it (no no-op work)
  state: GoalLifecycle;
  maxFixRounds: number;
  acceptanceChecks: string[];
  events: GoalEvent[];
  createdAt?: string;
  updatedAt?: string;
  lastActivityAt?: string;
  lastOperation?: string;
  backlogTaskId?: string; // the BACKLOG.md task this goal implements (for coco_done after merge)
  autoMergeAllowed?: boolean; // per-goal forward consent: may auto-merge (Layer 2) if green + rebased + risk-tier passes. Set at goal start; never a session/global default.
  improveOrigin?: boolean; // FROZEN at goal start: this goal builds a coco-improve task, so its diff may never merge a protected path (referee/metrics/store/PM). Derived ONCE from the backlog task's coco-improve spec link — never re-read at merge, so a branch editing its own BACKLOG.md (or a later store change) cannot retro-flip it.
  budget?: GoalBudget;
  inFlight?: InFlight; // a long Oracle/test op currently running (undefined when idle)
  failureLoop?: FailureLoop; // consecutive-same-failure tracker (fingerprint stuck-detection)
  reviewUnavailable?: ReviewUnavailable; // Oracle down/ambiguous → loop paused (undefined when ok)
}

export interface GoalBudget {
  maxWallClockMin?: number; // wall-clock cap since createdAt; over → health `budget-exceeded`
}

/** Durable "Oracle is down / gave no usable verdict" marker. Set by the agent (after its own
 * retry-once) or auto-set when an ambiguous verdict is submitted. While present, the loop pauses
 * (nextAction → escalate-human) and merge is refused — never a false-green. Cleared by op-clear
 * (resume after the human fixes Oracle) or any successful record. */
export interface ReviewUnavailable {
  at: string;
  phase: 'plan' | 'review';
  commit: string;
  tree: string;
  reason: 'preflight-failed' | 'oracle-timeout' | 'oracle-error' | 'ambiguous-verdict';
  attempts: number;
  evidence?: string;
}

/** Consecutive-same-failure tracker (fingerprint stuck-detection). `key` is the current failure
 * signature; `count` is how many times in a row it has repeated; `history` is a bounded audit. */
export interface FailureLoop {
  key: string;
  count: number;
  history: { key: string; at: string; commit: string; tree: string }[];
}
