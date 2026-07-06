import type { ResourceCard } from './schema.js';

export interface RankedCard {
  card: ResourceCard;
  rank: number; // 1 (best) … 5 (weakest); lower is better
  reason: string; // which field matched
}

const RANKS: { reason: string; test: (c: ResourceCard, q: string) => boolean }[] = [
  { reason: 'owns', test: (c, q) => [...(c.owns?.symbols ?? []), ...(c.owns?.endpoints ?? []), ...(c.owns?.configKeys ?? [])].some((s) => s.toLowerCase().includes(q)) },
  { reason: 'intent', test: (c, q) => (c.intent ?? '').toLowerCase().includes(q) },
  { reason: 'title', test: (c, q) => c.title.toLowerCase().includes(q) },
  { reason: 'tags', test: (c, q) => (c.tags ?? []).some((t) => t.toLowerCase().includes(q)) },
  { reason: 'body', test: (c, q) => c.body.toLowerCase().includes(q) },
];

/** Priority-ranked search: owns-match → intent → title → tags → body (gproj's ranking). A card is
 * scored by its BEST-matching field; ties break by recency (newest first). Non-matches are dropped. */
export function rankedFind(cards: ResourceCard[], query: string): RankedCard[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: RankedCard[] = [];
  for (const card of cards) {
    for (let i = 0; i < RANKS.length; i++) {
      if (RANKS[i].test(card, q)) {
        hits.push({ card, rank: i + 1, reason: RANKS[i].reason });
        break; // best field only
      }
    }
  }
  return hits.sort((a, b) => a.rank - b.rank || b.card.timestamp.localeCompare(a.card.timestamp));
}
