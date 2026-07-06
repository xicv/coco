import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { manifestPath, storeDir } from './paths.js';
import { parseCard, type ResourceCard } from './schema.js';

/** Read every card from the NDJSON manifest. A corrupt line is skipped, not fatal. */
export function readCards(repo: string): ResourceCard[] {
  const p = manifestPath(repo);
  if (!existsSync(p)) return [];
  const out: ResourceCard[] = [];
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(parseCard(JSON.parse(t)));
    } catch {
      /* skip a corrupt/partial line rather than crash the whole store */
    }
  }
  return out;
}

/** Atomic write of the full manifest (temp file + rename). */
export function writeCards(repo: string, cards: ResourceCard[]): void {
  mkdirSync(storeDir(repo), { recursive: true });
  const p = manifestPath(repo);
  const tmp = `${p}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(tmp, cards.map((c) => JSON.stringify(c)).join('\n') + (cards.length ? '\n' : ''));
  renameSync(tmp, p);
}

/** Union the prior card's links into the incoming card, deduped by (rel, to) with prior order first.
 * Key is JSON.stringify([rel, to]) — an injective, control-char-free encoding of the pair. */
function mergeLinks(prior: ResourceCard, incoming: ResourceCard): ResourceCard {
  const all = [...(prior.links ?? []), ...(incoming.links ?? [])];
  if (all.length === 0) return incoming;
  const seen = new Set<string>();
  const links = all.filter((l) => {
    const k = JSON.stringify([l.rel, l.to]);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { ...incoming, links };
}

/** Insert or replace a card by id (idempotent add). A content-addressed re-add (id = slug+bodyHash)
 * MERGES the prior card's `links` so links added via `coco-store link` are never silently dropped. */
export function upsertCard(repo: string, card: ResourceCard): ResourceCard[] {
  const existing = readCards(repo);
  const prior = existing.find((c) => c.id === card.id);
  const merged = prior ? mergeLinks(prior, card) : card;
  const cards = existing.filter((c) => c.id !== card.id);
  cards.push(merged);
  writeCards(repo, cards);
  return cards;
}

/** Remove a card by id. Returns true if it existed. */
export function removeCard(repo: string, id: string): boolean {
  const cards = readCards(repo);
  const next = cards.filter((c) => c.id !== id);
  if (next.length === cards.length) return false;
  writeCards(repo, next);
  return true;
}
