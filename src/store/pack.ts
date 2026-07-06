import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rankedFind } from './find.js';
import { readCards } from './manifest.js';
import { briefPath, briefsDir, roadmapPath } from './paths.js';
import type { ResourceCard } from './schema.js';

const DEFAULT_BUDGET = 12000;

function cardBlock(c: ResourceCard): string {
  const meta = [c.type, c.category, (c.tags ?? []).join(',')].filter(Boolean).join(' · ');
  return `### ${c.title}${meta ? ` (${meta})` : ''}\n${(c.excerpt ?? c.body).trim()}`;
}

/** Budget-bounded context brief for a coco-loop run: the roadmap position + the most relevant
 * resource cards (ranked by `query`, else most-recent), capped at `budgetBytes`. Written to
 * .coco-store/briefs/<goalId>.md (git-ignored) and returned. This is what a loop starts from. */
export function buildBrief(
  repo: string,
  opts: { goalId: string; query?: string; budgetBytes?: number },
): { brief: string; path: string; included: number } {
  const budget = Number.isFinite(opts.budgetBytes) && (opts.budgetBytes as number) > 0 ? (opts.budgetBytes as number) : DEFAULT_BUDGET;
  const path = briefPath(repo, opts.goalId); // validates goalId BEFORE any write
  const fits = (candidate: string) => Buffer.byteLength(candidate, 'utf8') <= budget;

  // Assemble incrementally against the REAL utf8 byte length of the whole brief so we never exceed
  // the budget (headers + separators included), and an oversize roadmap alone is simply dropped.
  let brief = '';
  const roadmap = existsSync(roadmapPath(repo)) ? readFileSync(roadmapPath(repo), 'utf8').trim() : '';
  if (roadmap) {
    const s = `## Roadmap\n${roadmap}`;
    if (fits(s)) brief = s;
  }

  const cards = readCards(repo);
  const ranked = opts.query ? rankedFind(cards, opts.query).map((r) => r.card) : [...cards].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  let included = 0;
  for (const c of ranked) {
    const header = included === 0 ? `${brief ? '\n\n' : ''}## Relevant resources\n\n` : '\n\n';
    const addition = header + cardBlock(c);
    if (!fits(brief + addition)) break;
    brief += addition;
    included++;
  }

  if (!brief) brief = '(empty — add a roadmap or resources first)';
  mkdirSync(briefsDir(repo), { recursive: true });
  writeFileSync(path, `${brief}\n`);
  return { brief, path, included };
}
