// Shared visual language for coco progress "checkpoint cards" — the ONE place the ◈ coco chrome
// lives, so coco-loop / coco-store / coco-goal all render identically. Presentation only: no state,
// no logic. Adapters (loopView, storeView) build a ProgressView from authoritative data; renderView
// turns it into a fenced `text` block that renders cleanly in the Codex macOS app (monospace
// preserves the grid; glyphs are decoration — every value also carries words).

/** Versioned wire shape for a rendered block the agent echoes verbatim. Optional + versioned so
 * existing consumers that only read `nextAction` keep working. */
export const PROGRESS_FORMAT = 'coco-progress-v1' as const;

export interface ProgressField {
  format: typeof PROGRESS_FORMAT;
  markdown: string;
}

export function progressField(markdown: string): ProgressField {
  return { format: PROGRESS_FORMAT, markdown };
}

export interface ProgressRow {
  label: string;
  value: string;
}

/** A presentation-only snapshot. `provenance` is a footer (ids + source) so a copied or stale
 * block stays interpretable — a checkpoint card, not a live HUD. */
export interface ProgressView {
  skill: string; // 'coco-loop' | 'coco-store' | 'coco-goal'
  subject: string; // goalId / intent / 'project pulse'
  rows: ProgressRow[];
  provenance?: string;
}

/** Render a ProgressView as a fenced `text` block. Pure. Labels are space-padded (never tabs) to a
 * common width; glyphs like ◈ ▸ ✓ ✗ are decoration only. */
export function renderView(view: ProgressView): string {
  const width = view.rows.reduce((w, r) => Math.max(w, r.label.length), 0);
  const lines = [`◈ ${view.skill}  ·  ${view.subject}`];
  for (const r of view.rows) lines.push(`  ${r.label.padEnd(width)}   ${r.value}`);
  if (view.provenance) lines.push('', `  ${view.provenance}`);
  return ['```text', ...lines, '```'].join('\n');
}
