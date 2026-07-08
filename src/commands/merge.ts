import { assessAutoMergeRisk, type RiskReport } from '../autoMergeRisk.js';
import { VERIFY_TEST_COMMAND_CHANGE_ACK, verifyTestCommandChange } from '../cocoConfig.js';
import { checkout, ffMerge, gatherLive, headSha } from '../git.js';
import { mergeDecision } from '../gate.js';
import { improveOriginProtectedHits } from '../improve/originGate.js';
import { withLock } from '../lock.js';
import { findActiveGoal, touchAndWrite } from '../state.js';

export interface MergeOptions {
  ackVerifyPolicyChange?: boolean;
}

function verifyPolicyMergeBlock(repo: string, base: string, ack?: boolean): string | undefined {
  const change = verifyTestCommandChange(repo, base);
  if (change === 'none' || ack) return undefined;
  return `${VERIFY_TEST_COMMAND_CHANGE_ACK} (change: ${change})`;
}

export function mergeGoal(repo: string, id: string, opts: MergeOptions = {}): { merged: boolean; reason?: string } {
  return withLock(repo, () => {
    const goal = findActiveGoal(repo);
    if (!goal || goal.id !== id) throw new Error(`coco: no active goal '${id}'`);

    const decision = mergeDecision(goal, gatherLive(repo, goal));
    if (!decision.allowed) return { merged: false, reason: decision.reason };

    // Fail-closed referee gate: an improve-origin goal may NEVER merge a diff that touches a protected
    // path (referee / metrics / store / improve-self) — that needs a human-authored referee-change
    // goal (a plain goal, not linked to a coco-improve spec). Binds to the ACTUAL diff, not declared.
    const blocked = improveOriginProtectedHits(repo, goal);
    if (blocked.length) {
      return { merged: false, reason: `improve-origin change touches protected path(s): ${blocked.join(', ')} — a referee/metric change needs a human-authored goal, not a coco-improve one` };
    }

    // Verification policy changes are allowed only with an explicit human acknowledgement. This keeps
    // the default human merge path from overlooking a goal that changed the very command coco trusted.
    const policyBlock = verifyPolicyMergeBlock(repo, goal.base, opts.ackVerifyPolicyChange);
    if (policyBlock) return { merged: false, reason: policyBlock };

    // FF-only merge. ffMerge checks out `base` first; if the FF fails (base moved
    // between validation and here), restore the goal branch so a retry is sane.
    const res = ffMerge(repo, goal.base, goal.branch);
    if (!res.ok) {
      checkout(repo, goal.branch);
      return { merged: false, reason: `rebase-needed: ${res.out}` };
    }

    goal.state = 'achieved';
    touchAndWrite(repo, goal, opts.ackVerifyPolicyChange ? 'merge:verify-policy-ack' : 'merge');
    return { merged: true };
  });
}

export interface AutoMergeResult {
  merged: boolean;
  goalId: string;
  reason?: string;
  mergedSha?: string;
  branch?: string;
  base?: string;
  risk?: RiskReport;
  // How the driver should react to a refusal: hand to a human (consent/risk), or keep looping
  // (a transient gate — rebase/re-review/re-verify) then retry.
  next?: 'human-merge' | 'continue-loop';
  humanCommand?: string;
}

/** Layer 2 auto-merge: the SAME engine as `mergeGoal`, fronted by (1) per-goal forward consent,
 * (2) a caller HEAD-binding (`expectedSha`), (3) every existing `mergeDecision` gate, and (4) the
 * risk-tier. Any refusal leaves goal state untouched and tells the driver whether to fall back to a
 * human merge or keep looping. It NEVER loosens `mergeGoal`; the human CLI path is unaffected. */
export function autoMergeGoal(repo: string, id: string, opts: { expectedSha: string }): AutoMergeResult {
  return withLock(repo, () => {
    const goal = findActiveGoal(repo);
    if (!goal || goal.id !== id) throw new Error(`coco: no active goal '${id}'`);

    const humanCommand = `coco merge --goal ${id}`;
    const toHuman = (reason: string, risk?: RiskReport): AutoMergeResult => ({
      merged: false, goalId: id, reason, next: 'human-merge', humanCommand, ...(risk ? { risk } : {}),
    });
    const keepLooping = (reason: string): AutoMergeResult => ({
      merged: false, goalId: id, reason, next: 'continue-loop', humanCommand,
    });

    // 1. Forward consent must be recorded on the goal (set at goal-start).
    if (!goal.autoMergeAllowed) return toHuman('auto-merge not enabled for this goal');

    // 2. Caller's view of HEAD must match now (guards a stale/racing driver).
    const head = headSha(repo);
    if (opts.expectedSha !== head) return keepLooping(`expectedSha mismatch (expected ${opts.expectedSha}, HEAD ${head})`);

    // 3. Every existing merge gate (review clean, verify pass, rebased, on-branch, clean tree, epoch).
    const decision = mergeDecision(goal, gatherLive(repo, goal));
    if (!decision.allowed) return keepLooping(decision.reason ?? 'merge gate not satisfied');

    // 3b. Same fail-closed referee gate as the human path — an improve-origin goal touching a
    // protected path can't merge here either; it needs a human-authored (non-improve) referee goal.
    const blocked = improveOriginProtectedHits(repo, goal);
    if (blocked.length) return toHuman(`improve-origin change touches protected path(s): ${blocked.join(', ')} — needs a human-authored referee-change goal, not a coco-improve one`);

    // 3c. Auto-merge never acknowledges verify policy changes. Those must fall back to an explicit
    // human merge command carrying --ack-verify-policy-change.
    const policyBlock = verifyPolicyMergeBlock(repo, goal.base, false);
    if (policyBlock) return { ...toHuman(policyBlock), humanCommand: `coco merge --goal ${id} --ack-verify-policy-change` };

    // 4. Layer 2 risk-tier — policy read at base (tamper-resistant). A block means "let a human do it".
    const risk = assessAutoMergeRisk(repo, goal.base, goal.branch);
    if (!risk.allowed) return toHuman(risk.reason ?? 'auto-merge blocked by risk policy', risk);

    // 5. FF-only merge — identical mechanics to the human path.
    const res = ffMerge(repo, goal.base, goal.branch);
    if (!res.ok) {
      checkout(repo, goal.branch);
      return keepLooping(`rebase-needed: ${res.out}`);
    }

    const mergedSha = headSha(repo);
    goal.state = 'achieved';
    touchAndWrite(repo, goal, 'auto-merge');
    return { merged: true, goalId: id, mergedSha, branch: goal.branch, base: goal.base, risk };
  });
}
