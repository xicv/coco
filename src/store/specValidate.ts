const REQUIRED_GOAL_SPEC_SECTIONS = ['Outcome', 'Verification surface', 'Boundaries'] as const;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True if `body` names `section` — either a Markdown heading (`## Outcome`) or a label line
 * (`Outcome:`), case-insensitive, tolerating up to 3 leading spaces. Presence only, not content. */
function hasSectionMarker(body: string, section: string): boolean {
  return new RegExp(`^\\s{0,3}(?:#{1,6}\\s+)?${escapeRegExp(section)}\\s*:?\\s*$`, 'im').test(body);
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
