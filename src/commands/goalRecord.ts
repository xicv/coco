import { deriveFacts } from '../epoch.js';
import { updateFailureLoop } from '../fingerprint.js';
import { currentBranch, headSha, isClean, treeHash } from '../git.js';
import { withLock } from '../lock.js';
import { findActiveGoal, touchAndWrite } from '../state.js';
import type { GoalEvent, Phase, Verdict } from '../types.js';

/** Max stored evidence length in characters (UTF-16 code units, via String.slice) — the SINGLE
 * source of the cap for every path (MCP + CLI). Capping in the domain function (not just at the MCP
 * boundary) stops a huge paste from bloating .coco/goals/*.json, which coco fingerprints and re-reads
 * every cycle. */
export const EVIDENCE_MAX = 4000;

export interface RecordOptions {
  goal: string;
  phase: Phase;
  expectedSha: string;
  verdict?: Verdict;
  evidence?: string;
  runId?: string; // verify only: stamps the coco-owned run onto the event so re-consumption can't double-record
  now?: Date;
}

const PHASES: Phase[] = ['plan', 'implement', 'review', 'verify'];
const REVIEW_VERDICTS: Verdict[] = ['clean', 'blocking'];
const VERIFY_VERDICTS: Verdict[] = ['pass', 'fail'];

export function goalRecord(repo: string, opts: RecordOptions): GoalEvent {
  return withLock(repo, () => {
    if (!PHASES.includes(opts.phase)) throw new Error(`coco: invalid phase '${opts.phase}'`);
    const goal = findActiveGoal(repo);
    if (!goal || goal.id !== opts.goal) throw new Error(`coco: no active goal '${opts.goal}'`);
    if (currentBranch(repo) !== goal.branch) throw new Error(`coco: not on goal branch ${goal.branch}`);

    const head = headSha(repo);
    if (head !== opts.expectedSha) throw new Error(`coco: HEAD moved (expected ${opts.expectedSha}, got ${head})`);

    // Verdict validation.
    if (opts.phase === 'review') {
      if (!opts.verdict || !REVIEW_VERDICTS.includes(opts.verdict)) throw new Error('coco: review verdict must be clean|blocking');
    } else if (opts.phase === 'verify') {
      if (!opts.verdict || !VERIFY_VERDICTS.includes(opts.verdict)) throw new Error('coco: verify verdict must be pass|fail');
    } else if (opts.verdict) {
      throw new Error(`coco: ${opts.phase} takes no verdict`);
    }
    if (opts.runId !== undefined) {
      if (opts.phase !== 'verify') throw new Error('coco: runId only applies to verify records');
      if (!/^[A-Za-z0-9._-]+$/.test(opts.runId) || /^\.+$/.test(opts.runId)) throw new Error(`coco: invalid runId '${opts.runId}'`);
    }

    const tree = treeHash(repo);

    // An implement must land real work: reject a tree identical to the branch base (a no-op implement
    // would otherwise satisfy the merge gate with zero code delta). Guarded on baseTree for back-compat
    // with goals created before this field existed.
    if (opts.phase === 'implement' && goal.baseTree && tree === goal.baseTree) {
      throw new Error('coco: implement must change code — the tree is identical to the branch base (no-op implement rejected). Commit a real change first.');
    }

    // Ordering + clean-tree rules for gate-critical phases.
    if (opts.phase === 'review' || opts.phase === 'verify') {
      if (!isClean(repo)) throw new Error('coco: review/verify require a clean tree (commit first)');
      const facts = deriveFacts(goal.events, tree);
      if (opts.phase === 'review') {
        if (!facts.implementAtEpoch) throw new Error('coco: cannot review before an implement in this epoch');
        // Monotonic: a WORSE verdict may override (safety), but a blocking review can only be
        // cleared by changing the code (new tree) — never upgraded in place.
        if (opts.verdict === 'clean' && facts.latestReview === 'blocking') {
          throw new Error('coco: cannot upgrade a blocking review to clean without new changes (commit a fix first)');
        }
      }
      if (opts.phase === 'verify') {
        if (facts.latestReview !== 'clean') throw new Error('coco: cannot verify before a clean review');
        if (opts.verdict === 'pass' && facts.latestVerify === 'fail') {
          throw new Error('coco: cannot upgrade a failing verify to pass without new changes (commit a fix first)');
        }
      }
    }

    const event: GoalEvent = {
      phase: opts.phase,
      at: (opts.now ?? new Date()).toISOString(),
      commit: head,
      tree,
      ...(opts.verdict ? { verdict: opts.verdict } : {}),
      ...(opts.evidence ? { evidence: opts.evidence.slice(0, EVIDENCE_MAX) } : {}),
      ...(opts.runId ? { runId: opts.runId } : {}),
    };
    goal.events.push(event);
    delete goal.inFlight; // recording a phase means the in-flight op (if any) has finished
    // Only an Oracle-driven phase (plan/review) coming back with a usable result clears the pause.
    // A non-Oracle record (implement/verify) must NOT silently un-pause the loop — the human resumes
    // via goalOpClear after fixing Oracle. (Prevents an implement record from walking past the pause.)
    if (opts.phase === 'plan' || opts.phase === 'review') delete goal.reviewUnavailable;
    goal.failureLoop = updateFailureLoop(goal.failureLoop, event); // fingerprint stuck-detection
    touchAndWrite(repo, goal, opts.verdict ? `record:${opts.phase}:${opts.verdict}` : `record:${opts.phase}`);
    return event;
  });
}
