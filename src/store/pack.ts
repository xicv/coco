import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';
import { rankedFind } from './find.js';
import { readCards } from './manifest.js';
import { briefPath, briefsDir, roadmapPath } from './paths.js';
import type { ResourceCard } from './schema.js';

const DEFAULT_BUDGET = 12000;
// Hard bound for background — research on context rot: oversized background degrades planning (a
// >500-line context file is treated as noise), so head-truncate aggressively regardless of budget.
const BACKGROUND_MAX_LINES = 150;
const BACKGROUND_MAX_BYTES = 6000;
// Bytes reserved for the store context (roadmap + cards) so a large background can never starve them.
const MIN_STORE_RESERVE = 2000;
// Segment-aware secret-name check — the brief is shipped to Oracle (an external service), so a
// secret-looking file must never ride along. Matches secret dot-segments/extensions (so `server.key.md`
// and `foo.pem.txt` are caught) and whole-word secret/credential tokens, WITHOUT flagging innocents
// like `secretary.md` or `monkey.md`. Callers inline only the needed excerpt instead.
const SECRET_SEGMENT = new Set(['env', 'pem', 'key', 'p12', 'pfx', 'keystore', 'jks', 'crt', 'cer', 'der', 'npmrc', 'netrc', 'kdbx']);
function looksSecret(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.split('.').some((seg) => SECRET_SEGMENT.has(seg))) return true;
  const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.some((t) => t === 'secret' || t === 'secrets' || t === 'credential' || t === 'credentials')) return true;
  return /^id_(rsa|dsa|ecdsa|ed25519)$/.test(lower);
}

function cardBlock(c: ResourceCard): string {
  const meta = [c.type, c.category, (c.tags ?? []).join(',')].filter(Boolean).join(' · ');
  return `### ${c.title}${meta ? ` (${meta})` : ''}\n${(c.excerpt ?? c.body).trim()}`;
}

/** Read only the first `maxBytes` of a file (never the whole thing — a bound must not load a huge file
 * into memory). */
function readHead(abs: string, maxBytes: number): Buffer {
  const n = Math.min(statSync(abs).size, maxBytes);
  const buf = Buffer.alloc(n);
  const fd = openSync(abs, 'r');
  try {
    let off = 0;
    while (off < n) {
      const r = readSync(fd, buf, off, n - off, off);
      if (r <= 0) break;
      off += r;
    }
    return buf.subarray(0, off);
  } finally {
    closeSync(fd);
  }
}

/** Largest valid UTF-8 prefix of `s` within `maxBytes` — backs off a split multibyte code point so a
 * truncated brief never ends in a `�` replacement char. */
function utf8Head(s: string, maxBytes: number): { text: string; truncated: boolean } {
  const buf = Buffer.from(s, 'utf8');
  if (buf.length <= maxBytes) return { text: s, truncated: false };
  let end = Math.max(0, maxBytes);
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--; // step back over UTF-8 continuation bytes (0b10xxxxxx)
  return { text: buf.subarray(0, end).toString('utf8'), truncated: true };
}

/** Head-bound raw text to BACKGROUND_MAX_LINES then `byteCap` bytes, UTF-8-safe. */
function boundText(raw: string, byteCap: number): { text: string; truncated: boolean } {
  let truncated = false;
  let s = raw;
  const lines = s.split('\n');
  if (lines.length > BACKGROUND_MAX_LINES) {
    s = lines.slice(0, BACKGROUND_MAX_LINES).join('\n');
    truncated = true;
  }
  const head = utf8Head(s, byteCap);
  return { text: head.text.trim(), truncated: truncated || head.truncated };
}

/** Honest freshness label for a repo-relative file: uncommitted edits / untracked / stale-by-ancestry
 * / fresh. Uses `git status --porcelain` for working-tree state, then commit ancestry (rev-list count,
 * not timestamps → deterministic even within one wall-clock second). Read-only git, boundary-safe. */
function fileFreshness(repo: string, relPath: string): string {
  const g = (args: string[]): string => {
    try {
      return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
    } catch {
      return '';
    }
  };
  const porcelain = g(['status', '--porcelain', '--', relPath]).replace(/\n+$/, '');
  if (porcelain) return /^\s*\?\?/.test(porcelain) ? ' [untracked — not committed]' : ' [uncommitted local edits]';
  const fileCommit = g(['log', '-1', '--format=%H', '--', relPath]).trim();
  if (!fileCommit) return ' [untracked — not committed]';
  const since = g(['rev-list', '--count', `${fileCommit}..HEAD`]).trim();
  if (since && Number(since) > 0) {
    const when = g(['log', '-1', '--format=%cs', '--', relPath]).trim();
    return ` [STALE? last committed ${when}; ${since} commit(s) since]`;
  }
  return '';
}

/** Assemble a `## Background` block whose TOTAL bytes (heading + source/note + body) fit `allowance` —
 * header space is reserved up front so the body cap accounts for it (the store reserve is real, not
 * body-only). Returns '' when even the header can't fit, so the caller emits an omission note. */
function assembleBackground(freshness: string, source: string, rawText: string, allowance: number): string {
  const header = (trunc: boolean) => `## Background${freshness}\n_source: ${source}${trunc ? ' (truncated)' : ''}_\n\n`;
  const headerBytes = Buffer.byteLength(header(true), 'utf8'); // worst case (note present)
  if (allowance < headerBytes) return '';
  const bodyCap = Math.min(BACKGROUND_MAX_BYTES, allowance - headerBytes);
  const { text, truncated } = boundText(rawText, bodyCap);
  return header(truncated) + text;
}

/** A guarded Background block from a user-supplied FILE. Guards (the brief is sent to Oracle): must
 * resolve INSIDE the repo (realpath — blocks `../` and symlink escapes), not a secret-looking name,
 * not binary. Head-read only. */
function fileBackground(repo: string, file: string, allowance: number): string {
  const repoReal = realpathSync(repo);
  const abs = resolve(repoReal, file);
  if (!existsSync(abs)) throw new Error(`coco-store pack: --background file not found: ${file}`);
  const real = realpathSync(abs); // resolves symlinks so an escape can't hide behind one
  if (real !== repoReal && !real.startsWith(repoReal + sep)) {
    throw new Error(`coco-store pack: --background must resolve inside the repo (refusing to send an outside/symlinked path to Oracle): ${file}`);
  }
  if (!statSync(real).isFile()) {
    throw new Error(`coco-store pack: --background must be a regular file (not a directory/FIFO/device): ${file}`);
  }
  const rel = relative(repoReal, real) || basename(real);
  // Check EVERY path segment, not just the basename — a file under a secret-looking DIRECTORY
  // (secrets/, .aws/credentials, …) is just as sensitive and the brief goes to Oracle.
  const secretSeg = rel.split(sep).find((seg) => seg && looksSecret(seg));
  if (secretSeg) {
    throw new Error(`coco-store pack: --background path segment "${secretSeg}" looks like a secret and will NOT be sent to Oracle — inline only the needed excerpt instead.`);
  }
  const buf = readHead(real, BACKGROUND_MAX_BYTES + 64);
  if (buf.includes(0)) throw new Error(`coco-store pack: --background appears to be a binary file: ${file}`);
  return assembleBackground(fileFreshness(repo, rel), rel, buf.toString('utf8'), allowance);
}

/** A Background block from inline text (the loop's distilled current-session context via
 * `--background-stdin`). Same bound as a file; no freshness (it isn't a tracked artifact). */
function textBackground(raw: string, allowance: number): string {
  return assembleBackground('', 'inline session context', raw, allowance);
}

/** The background block, bounded to its share of the budget so it can never starve store context, and
 * NEVER silently dropped — if the budget is too small it degrades to an omission note (or, if even
 * that won't fit, fails fast). File guards still run regardless of budget. */
function backgroundSection(repo: string, opts: { backgroundFile?: string; backgroundText?: string }, budget: number): string {
  const allowance = Math.max(0, budget - MIN_STORE_RESERVE);
  const block = opts.backgroundFile ? fileBackground(repo, opts.backgroundFile, allowance) : textBackground(opts.backgroundText ?? '', allowance);
  if (block) return block;
  const omit = '## Background\n_omitted: byte budget too small_';
  if (Buffer.byteLength(omit, 'utf8') <= budget) return omit;
  throw new Error(`coco-store pack: --budget ${budget} is too small to include any background`);
}

/** Budget-bounded context brief for a coco-loop run: the roadmap position + the most relevant
 * resource cards (ranked by `query`, else most-recent), capped at `budgetBytes`. Written to
 * .coco/store/briefs/<goalId>.md (git-ignored) and returned. This is what a loop starts from. */
export function buildBrief(
  repo: string,
  opts: { goalId: string; query?: string; budgetBytes?: number; backgroundFile?: string; backgroundText?: string },
): { brief: string; path: string; included: number } {
  const budget = Number.isFinite(opts.budgetBytes) && (opts.budgetBytes as number) > 0 ? (opts.budgetBytes as number) : DEFAULT_BUDGET;
  const path = briefPath(repo, opts.goalId); // validates goalId BEFORE any write
  const fits = (candidate: string) => Buffer.byteLength(candidate, 'utf8') <= budget;

  // Assemble incrementally against the REAL utf8 byte length of the whole brief so we never exceed
  // the budget (headers + separators included), and an oversize section alone is simply dropped.
  let brief = '';
  // Background FIRST — primacy attention: the plan consult reads the top of the brief first, and this
  // grounding is the most task-specific context. Bounded to its own share (MIN_STORE_RESERVE is kept
  // for store context so background can't starve the roadmap/cards) and never silently dropped.
  if (opts.backgroundFile || opts.backgroundText !== undefined) {
    brief = backgroundSection(repo, opts, budget);
  }
  const roadmap = existsSync(roadmapPath(repo)) ? readFileSync(roadmapPath(repo), 'utf8').trim() : '';
  if (roadmap) {
    const s = `${brief ? '\n\n' : ''}## Roadmap\n${roadmap}`;
    if (fits(brief + s)) brief += s;
  }

  // Only visibility:"shared" cards travel — this brief is sent to Oracle, and a local card "never
  // leaves the machine". Local cards stay private; the roadmap and user background still ride along.
  const cards = readCards(repo).filter((c) => c.visibility === 'shared');
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
