// coco-loop progress adapter: StatusReport → ProgressView. Presentation only — it reads the report's
// nextAction + facts + live as authoritative and never recomputes the state machine.

import type { StatusReport } from '../commands/goalStatus.js';
import type { NextAction } from '../gate.js';
import type { ProgressView } from './view.js';

// Where we are, in human words, for each deterministic nextAction.
const CHECKPOINT: Record<NextAction, string> = {
  plan: 'planning',
  implement: 'implementing',
  review: 'awaiting review',
  fix: 'fixing',
  verify: 'verifying',
  'merge-gate': 'ready — merge gate',
  'escalate-human': 'blocked — needs human',
  'wrong-branch': 'recover — wrong branch',
  'commit-or-revert': 'recover — dirty tree',
  'rebase-needed': 'recover — rebase needed',
  none: 'inactive',
};

// What to do next. Note: the human merge COMMAND is deliberately kept OUT of the card (the skill
// surfaces it as a clear, separate approval step) so approval never hides inside decorative chrome.
const NEXT: Record<NextAction, string> = {
  plan: 'plan — consult Oracle for a plan',
  implement: 'implement — edit, run local tests, commit',
  review: 'review — dispatch an Oracle review',
  fix: 'fix — address the blocking review',
  verify: 'verify — coco runs the suite',
  'merge-gate': 'merge-gate — awaiting human approval',
  'escalate-human': 'escalate — surface the blocker to the human',
  'wrong-branch': 'checkout the goal branch',
  'commit-or-revert': 'commit or discard the working tree',
  'rebase-needed': 'rebase onto the goal base',
  none: 'no active goal',
};

// The forward trail from here to a merge (the "remaining" line).
const REMAINING: Record<NextAction, string[]> = {
  plan: ['plan', 'implement', 'review', 'verify', 'merge'],
  implement: ['implement', 'review', 'verify', 'merge'],
  review: ['review', 'verify', 'merge'],
  fix: ['fix', 'review', 'verify', 'merge'],
  verify: ['verify', 'merge'],
  'merge-gate': ['merge'],
  'escalate-human': ['human decision'],
  'wrong-branch': ['recover', '…'],
  'commit-or-revert': ['recover', '…'],
  'rebase-needed': ['rebase', 'review', 'verify', 'merge'],
  none: [],
};

function stage(done: boolean, name: string, pending: boolean): string {
  return done ? `${name} ✓` : pending ? `${name} — pending` : `${name} —`;
}

function verifiedLine(r: StatusReport): string {
  const na = r.nextAction;
  const planDone = r.facts.implementAtEpoch || ['review', 'fix', 'verify', 'merge-gate'].includes(na);
  const plan = stage(planDone, 'plan', na === 'plan');
  const impl = stage(r.facts.implementAtEpoch, 'implement', na === 'implement');
  const review =
    r.edge?.kind === 'oracle-unavailable'
      ? 'review ? unavailable'
      : r.facts.latestReview === 'clean'
        ? 'review ✓ clean'
        : r.facts.latestReview === 'blocking'
          ? 'review ✗ blocking'
          : 'review — pending';
  const verify =
    r.facts.latestVerify === 'pass' ? 'verify ✓ pass' : r.facts.latestVerify === 'fail' ? 'verify ✗ fail' : 'verify — pending';
  return `${plan}   ${impl}   ${review}   ${verify}`;
}

function checkpointLine(r: StatusReport): string {
  const base = CHECKPOINT[r.nextAction] ?? String(r.nextAction);
  if (r.nextAction === 'fix') {
    const max = r.maxFixRounds ? `/${r.maxFixRounds}` : '';
    return `${base} (round ${r.facts.fixRounds}${max})`;
  }
  return base;
}

function riskLine(r: StatusReport): string {
  const warnings = r.warnings ?? [];
  if (warnings.some((w) => w.includes('verify.testCommand differs'))) return 'verify policy changed — human acknowledgement required';
  if (warnings.length) return warnings.join(' · ');
  return '—';
}

function recoveryLine(r: StatusReport): string {
  if (r.edge?.command) return r.edge.command;
  if (r.edge?.detail) return r.edge.detail;
  return '—';
}

export function loopView(r: StatusReport): ProgressView {
  const rows = [
    { label: 'Checkpoint', value: checkpointLine(r) },
    { label: 'Branch', value: `${r.currentBranch} → ${r.base}${r.currentBranch === r.branch ? ' (on goal)' : ` · goal ${r.branch}`}` },
    { label: 'Verified', value: verifiedLine(r) },
    { label: 'Remaining', value: (REMAINING[r.nextAction] ?? []).join(' → ') || '—' },
    { label: 'Risk', value: riskLine(r) },
    { label: 'Recovery', value: recoveryLine(r) },
    { label: 'Next', value: NEXT[r.nextAction] ?? String(r.nextAction) },
  ];
  const provenance = `${r.goalId} · ${r.headSha.slice(0, 7)} · state=${r.state} · next=${r.nextAction} · level=${r.warningLevel} · key=${r.progressKey}`;
  return { skill: 'coco-loop', subject: r.goalId, rows, provenance };
}
