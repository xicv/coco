const REQUIRED_GOAL_SPEC_SECTIONS = ['Outcome', 'Verification surface', 'Boundaries'] as const;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True if `body` names `section` as a REAL marker — a Markdown heading (`## Outcome`) or a label
 * line (`Outcome:`), case-insensitive, tolerating up to 3 leading spaces. A bare `Outcome` line (no
 * `#` and no `:`) is prose, not a section, and does NOT satisfy the gate. Presence only, not content. */
function hasSectionMarker(body: string, section: string): boolean {
  const s = escapeRegExp(section);
  return new RegExp(`^\\s{0,3}(?:#{1,6}\\s+${s}|${s}\\s*:)\\s*$`, 'im').test(body);
}

/** Presence-only gate for a GoalSpec (`type=spec`) card: it must at least name its Outcome, its
 * Verification surface (what PROVES it done), and its Boundaries — so a weak goal can't be archived.
 * Deep quality lives in the coco-goal skill / Oracle pass, deliberately NOT in this runtime check. */
export function assertGoalSpecHasRequiredSections(body: string): void {
  const missing = REQUIRED_GOAL_SPEC_SECTIONS.filter((s) => !hasSectionMarker(body, s));
  if (missing.length) {
    throw new Error(`coco-store add: spec missing required GoalSpec section(s): ${missing.join(', ')}`);
  }
}

// A coco-improve spec is a GoalSpec PLUS a predeclared-hypothesis contract, so a later human can judge
// whether the change actually helped — never auto-declared from low-N audit deltas. (See coco-improve.)
const REQUIRED_IMPROVE_SPEC_SECTIONS = [
  'Predeclared hypothesis',
  'Audit evidence window',
  'Expected mechanism',
  'Success criteria',
  'Failure criteria',
  'Confounders',
  'Rejected alternatives',
  'Anti-goals',
  'Research provenance', // cited external sources (resolvable URLs) — or "none - audit-only" if no external evidence applied
] as const;

/** Presence-only gate for a coco-improve spec (`type=spec` + tag `coco-improve`): it must satisfy the
 * base GoalSpec gate AND carry its predeclared-hypothesis contract. Deep quality lives in the
 * coco-improve skill / human review, not this runtime check. */
export function assertImproveSpecHasRequiredSections(body: string): void {
  assertGoalSpecHasRequiredSections(body);
  const missing = REQUIRED_IMPROVE_SPEC_SECTIONS.filter((s) => !hasSectionMarker(body, s));
  if (missing.length) {
    throw new Error(`coco-store add: coco-improve spec missing required section(s): ${missing.join(', ')}`);
  }
}
