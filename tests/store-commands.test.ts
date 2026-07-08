import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { storeAdd, storeFind, storeGroup, storeInit, storeLink, storeList, storePack, storeProgress, storePromote, storeRoadmap, storeShow, storeViz, type LinkRel } from '../src/store/commands.js';
import { main as storeCli } from '../src/store/cli.js';
import { migrateLegacyStore } from '../src/store/migrate.js';
import { setStatus } from '../src/backlog.js';
import { cocoNext } from '../src/commands/backlog.js';
import { initRepo } from '../src/commands/init.js';
import { commit, tmpRepo } from './helpers.js';

const md = (...lines: string[]) => lines.join('\n');

test('promote rejects a task body that would corrupt the backlog (node heading / unbalanced fence)', () => {
  const repo = tmpRepo();
  storeInit(repo);
  expect(() => storePromote(repo, { id: 'task-x', title: 'x', body: 'ok\n### evil — phantom\nmore' })).toThrow(/node heading/);
  expect(() => storePromote(repo, { id: 'task-y', title: 'y', body: 'text\n```\nunclosed' })).toThrow(/unbalanced/);
  // a normal body — a plain `### Steps` (no — separator) and a BALANCED code fence — is fine
  expect(() => storePromote(repo, { id: 'task-z', title: 'z', body: '### Steps\ndo it\n```\ncode\n```' })).not.toThrow();
});

test('init creates .coco/store + roadmap and gitignores the whole store (fully local)', () => {
  const repo = tmpRepo();
  storeInit(repo);
  expect(existsSync(join(repo, '.coco', 'store', 'roadmap.md'))).toBe(true);
  const gi = readFileSync(join(repo, '.gitignore'), 'utf8');
  expect(gi).toMatch(/\.coco\/store\//); // the single wholesale line — covers roadmap.md too
  expect(gi).not.toMatch(/\.coco-store/); // legacy per-subpath rules are gone
});

test('migrateLegacyStore moves a pre-0.7 .coco-store/ into .coco/store/, preserving data', () => {
  const repo = tmpRepo();
  mkdirSync(join(repo, '.coco-store', 'briefs'), { recursive: true });
  writeFileSync(join(repo, '.coco-store', 'roadmap.md'), '# Roadmap\nlegacy content\n');

  const r = migrateLegacyStore(repo);
  expect(r.migrated).toBe(true);
  expect(existsSync(join(repo, '.coco-store'))).toBe(false); // legacy dir is gone
  expect(readFileSync(join(repo, '.coco', 'store', 'roadmap.md'), 'utf8')).toContain('legacy content');
  expect(existsSync(join(repo, '.coco', 'store', 'briefs'))).toBe(true); // subdirs carried over
  // fail-closed: the migrated store is git-ignored even without a prior `coco init`
  expect(readFileSync(join(repo, '.gitignore'), 'utf8')).toContain('.coco/store/');

  // idempotent: a second call is a no-op
  expect(migrateLegacyStore(repo).migrated).toBe(false);
});

test('migrateLegacyStore never clobbers an already-migrated store', () => {
  const repo = tmpRepo();
  storeInit(repo); // creates .coco/store/ with a fresh roadmap
  writeFileSync(join(repo, '.coco', 'store', 'roadmap.md'), '# Roadmap\ncurrent\n');
  mkdirSync(join(repo, '.coco-store'), { recursive: true }); // a stale legacy dir also present
  writeFileSync(join(repo, '.coco-store', 'roadmap.md'), '# Roadmap\nstale\n');

  expect(migrateLegacyStore(repo).migrated).toBe(false); // new store exists → refuse to overwrite
  expect(readFileSync(join(repo, '.coco', 'store', 'roadmap.md'), 'utf8')).toContain('current');
});

test('add is idempotent by content; list + show reflect it', () => {
  const repo = tmpRepo();
  const c1 = storeAdd(repo, { title: 'Auth flow', body: 'how auth works', type: 'doc' });
  storeAdd(repo, { title: 'Auth flow', body: 'how auth works' }); // same content → same id, no dup
  expect(storeList(repo)).toHaveLength(1);
  expect(storeShow(repo, c1.id).title).toBe('Auth flow');
  expect(() => storeShow(repo, 'missing')).toThrow();
});

test('find ranks an owns-match above a mere body match', () => {
  const repo = tmpRepo();
  storeAdd(repo, { title: 'Random doc', body: 'mentions LoginController in prose' }); // body match
  storeAdd(repo, { title: 'Owner', body: 'x', ownsSymbols: ['LoginController'] }); // owns match
  const hits = storeFind(repo, 'LoginController');
  expect(hits).toHaveLength(2);
  expect(hits[0].reason).toBe('owns');
  expect(hits[0].rank).toBeLessThan(hits[1].rank);
});

test('pack writes a budget-bounded brief with the roadmap + relevant cards', () => {
  const repo = tmpRepo();
  storeInit(repo);
  storeRoadmap(repo, { append: 'Ship the importer' });
  storeAdd(repo, { title: 'Importer notes', body: 'details about the importer', visibility: 'shared' });
  const r = storePack(repo, { goalId: 'g1', query: 'importer' });
  expect(r.included).toBe(1);
  expect(existsSync(r.path)).toBe(true);
  expect(r.brief).toMatch(/Roadmap/);
  expect(r.brief).toMatch(/Importer notes/);
});

test('pack sends only visibility:"shared" cards to the Oracle-bound brief — local cards stay private', () => {
  const repo = tmpRepo();
  storeInit(repo);
  storeAdd(repo, { title: 'Private note', body: 'confidential local thoughts', visibility: 'local' });
  storeAdd(repo, { title: 'Shareable doc', body: 'fine to send onward', visibility: 'shared' });
  const r = storePack(repo, { goalId: 'g1' });
  expect(r.brief).toContain('Shareable doc');
  expect(r.brief).not.toContain('Private note'); // local card never leaves the machine
  expect(r.included).toBe(1);
});

test('pack respects the byte budget (drops cards that do not fit)', () => {
  const repo = tmpRepo();
  storeAdd(repo, { title: 'Big', body: 'x'.repeat(500), visibility: 'shared' });
  storeAdd(repo, { title: 'Also big', body: 'y'.repeat(500), visibility: 'shared' });
  const r = storePack(repo, { goalId: 'g1', budgetBytes: 300 });
  expect(r.included).toBe(0); // neither 500-byte card fits a 300-byte budget
});

test('pack falls back to the default budget on a NaN budget (not unbounded)', () => {
  const repo = tmpRepo();
  storeAdd(repo, { title: 'Small', body: 'tiny', visibility: 'shared' });
  const r = storePack(repo, { goalId: 'g1', budgetBytes: Number.NaN });
  expect(r.included).toBe(1); // default budget applies; the card is included, not silently dropped or unbounded
});

test('pack --background injects the file FIRST (before roadmap), labelled, and not stale when untracked', () => {
  const repo = tmpRepo();
  storeInit(repo);
  storeRoadmap(repo, { append: 'Ship it' });
  writeFileSync(join(repo, 'bg.md'), 'BACKGROUND CONTENT HERE\nsecond line\n'); // untracked → fresh
  const r = storePack(repo, { goalId: 'g1', backgroundFile: 'bg.md' });
  expect(r.brief).toMatch(/## Background/);
  expect(r.brief).toContain('BACKGROUND CONTENT HERE');
  // primacy: background precedes the roadmap in the brief
  expect(r.brief.indexOf('## Background')).toBeLessThan(r.brief.indexOf('## Roadmap'));
  expect(r.brief).not.toMatch(/STALE/); // an untracked/just-written file is not flagged
});

test('pack --background head-truncates an oversized file', () => {
  const repo = tmpRepo();
  const many = Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n');
  writeFileSync(join(repo, 'big.md'), many);
  const r = storePack(repo, { goalId: 'g1', backgroundFile: 'big.md' });
  expect(r.brief).toContain('line 0');
  expect(r.brief).toMatch(/truncated/);
  expect(r.brief).not.toContain('line 200'); // beyond the 150-line head bound
});

test('pack --background throws on a missing file (fail loud, not silent)', () => {
  const repo = tmpRepo();
  expect(() => storePack(repo, { goalId: 'g1', backgroundFile: 'nope.md' })).toThrow(/not found/);
});

test('pack --background flags a background file the repo has advanced past as stale', () => {
  const repo = tmpRepo();
  commit(repo, 'bg.md', 'old background\n', 'add bg'); // background committed…
  commit(repo, 'other.txt', 'later work\n', 'advance HEAD'); // …then HEAD moves past it (ancestry, not timestamp)
  const r = storePack(repo, { goalId: 'g1', backgroundFile: 'bg.md' });
  expect(r.brief).toMatch(/## Background \[STALE\?/);
});

test('pack --background labels an uncommitted-but-edited file as dirty, NOT stale (no false positive)', () => {
  const repo = tmpRepo();
  commit(repo, 'bg.md', 'v1\n', 'add bg');
  commit(repo, 'other.txt', 'later\n', 'advance HEAD');
  writeFileSync(join(repo, 'bg.md'), 'v2 — fresh local edits\n'); // working copy now newer than any commit
  const r = storePack(repo, { goalId: 'g1', backgroundFile: 'bg.md' });
  expect(r.brief).toMatch(/uncommitted local edits/);
  expect(r.brief).not.toMatch(/STALE/); // dirty content is fresh, not stale
});

test('pack --background labels an untracked file honestly (not silently "fresh")', () => {
  const repo = tmpRepo();
  writeFileSync(join(repo, 'note.md'), 'a note\n'); // untracked
  const r = storePack(repo, { goalId: 'g1', backgroundFile: 'note.md' });
  expect(r.brief).toMatch(/untracked — not committed/);
});

test('pack --background refuses a path that resolves OUTSIDE the repo (no exfil to Oracle)', () => {
  const repo = tmpRepo();
  const outside = join(mkdtempSync(join(tmpdir(), 'coco-outside-')), 'secret.txt');
  writeFileSync(outside, 'TOP SECRET\n');
  expect(() => storePack(repo, { goalId: 'g1', backgroundFile: outside })).toThrow(/inside the repo/);
});

test('pack --background refuses a symlink that escapes the repo', () => {
  const repo = tmpRepo();
  const outside = join(mkdtempSync(join(tmpdir(), 'coco-outside-')), 'secret.txt');
  writeFileSync(outside, 'TOP SECRET\n');
  symlinkSync(outside, join(repo, 'link.md'));
  expect(() => storePack(repo, { goalId: 'g1', backgroundFile: 'link.md' })).toThrow(/inside the repo/);
});

test('pack --background refuses a secret-looking file (never ships .env to Oracle)', () => {
  const repo = tmpRepo();
  writeFileSync(join(repo, '.env'), 'API_KEY=sk-live-123\n');
  expect(() => storePack(repo, { goalId: 'g1', backgroundFile: '.env' })).toThrow(/secret/i);
});

test('pack --background refuses a binary file', () => {
  const repo = tmpRepo();
  writeFileSync(join(repo, 'blob.bin'), Buffer.from([0x89, 0x50, 0x00, 0x01, 0x02]));
  expect(() => storePack(repo, { goalId: 'g1', backgroundFile: 'blob.bin' })).toThrow(/binary/);
});

test('pack --background rejects a non-regular file (a directory) before opening it', () => {
  const repo = tmpRepo();
  mkdirSync(join(repo, 'adir'));
  expect(() => storePack(repo, { goalId: 'g1', backgroundFile: 'adir' })).toThrow(/regular file/);
});

test('pack --background-stdin (session text) is bounded and injected first, no freshness', () => {
  const repo = tmpRepo();
  const r = storePack(repo, { goalId: 'g1', backgroundText: 'Goal: do X\nApproach: Y' });
  expect(r.brief).toMatch(/## Background\n_source: inline session context/);
  expect(r.brief).toContain('Goal: do X');
  expect(r.brief).not.toMatch(/STALE|untracked/); // inline text has no tracked-file freshness
});

test('pack reserves budget for store context — background is truncated, never silently dropped, cards survive', () => {
  const repo = tmpRepo();
  storeAdd(repo, { title: 'Card', body: 'y'.repeat(700), visibility: 'shared' });
  const r = storePack(repo, { goalId: 'g1', backgroundText: 'z'.repeat(5000), budgetBytes: 3000 });
  expect(r.brief).toMatch(/## Background/); // present, not dropped
  expect(r.brief).toMatch(/truncated/); // bounded to its reserved share
  expect(r.included).toBe(1); // the store card still fit — background did not starve it
});

test('pack reserve is header-aware — a ~1.5 KB card survives a huge background at a tight budget', () => {
  const repo = tmpRepo();
  storeAdd(repo, { title: 'Card', body: 'y'.repeat(1500), visibility: 'shared' });
  const r = storePack(repo, { goalId: 'g1', backgroundText: 'z'.repeat(9000), budgetBytes: 4000 });
  // whole background block (heading + note + body) ≤ budget - MIN_STORE_RESERVE, so ≥ 2 KB is left for store
  expect(r.included).toBe(1);
  expect(Buffer.byteLength(r.brief, 'utf8')).toBeLessThanOrEqual(4000);
});

test('pack --background refuses a compound secret extension (server.key.md), not just *.key', () => {
  const repo = tmpRepo();
  writeFileSync(join(repo, 'server.key.md'), 'PRIVATE KEY\n');
  expect(() => storePack(repo, { goalId: 'g1', backgroundFile: 'server.key.md' })).toThrow(/secret/i);
});

test('pack --background refuses a file under a secret-looking directory (secrets/prod.md), not just by basename', () => {
  const repo = tmpRepo();
  mkdirSync(join(repo, 'secrets'));
  writeFileSync(join(repo, 'secrets', 'prod.md'), 'prod config\n');
  expect(() => storePack(repo, { goalId: 'g1', backgroundFile: 'secrets/prod.md' })).toThrow(/secret/i);
});

test('pack --background does NOT flag an innocent name that merely contains "secret" (secretary.md)', () => {
  const repo = tmpRepo();
  writeFileSync(join(repo, 'secretary.md'), 'notes about the secretary role\n');
  const r = storePack(repo, { goalId: 'g1', backgroundFile: 'secretary.md' });
  expect(r.brief).toContain('secretary role'); // included, not refused
});

test('pack --background truncation is UTF-8 safe — no replacement char at the byte cap', () => {
  const repo = tmpRepo();
  // 3-byte chars with a budget whose body cap is not a multiple of 3 → a naive byte cut would split one
  const r = storePack(repo, { goalId: 'g1', backgroundText: '你'.repeat(3000), budgetBytes: 8000 });
  expect(r.brief).toMatch(/truncated/);
  expect(r.brief).not.toContain('�'); // never emit a � from a mid-codepoint cut
});

test('pack degrades background to a labelled omission note when the budget is too small (never silent)', () => {
  const repo = tmpRepo();
  const r = storePack(repo, { goalId: 'g1', backgroundText: 'x'.repeat(200), budgetBytes: 500 });
  expect(r.brief).toMatch(/omitted: byte budget too small/);
});

test('promote rejects an unsafe task/dep id so BACKLOG.md YAML stays parseable', () => {
  const repo = tmpRepo();
  initRepo(repo);
  expect(() => storePromote(repo, { id: 'bad: id', title: 'x' })).toThrow(/task id must match/);
  expect(() => storePromote(repo, { id: 'ok', title: 'x', dependsOn: ['also bad'] })).toThrow(/dependsOn/);
});

test('list projection is additive (timestamp/kind/tags) — existing shape preserved', () => {
  const repo = tmpRepo();
  const c = storeAdd(repo, { title: 'T', body: 't', kind: 'feature', tags: ['a'] });
  const item = storeList(repo)[0];
  expect(item).toMatchObject({ id: c.id, title: 'T', type: 'doc', kind: 'feature', tags: ['a'] });
  expect(item.timestamp).toBe(c.timestamp);
});

test('list --sort orders by title or timestamp; plain list is unchanged', () => {
  const repo = tmpRepo();
  storeAdd(repo, { title: 'Zebra', body: 'z', now: new Date('2026-01-01T00:00:00Z') });
  storeAdd(repo, { title: 'Apple', body: 'a', now: new Date('2026-02-01T00:00:00Z') });
  expect(storeList(repo, { sort: 'title' }).map((i) => i.title)).toEqual(['Apple', 'Zebra']);
  expect(storeList(repo, { sort: 'timestamp' }).map((i) => i.title)).toEqual(['Zebra', 'Apple']); // Zebra is older
  expect(storeList(repo)).toHaveLength(2); // plain list unchanged (both cards, manifest order)
});

test('group-by tag puts a multi-tag card in EACH tag bucket; missing → (none)', () => {
  const repo = tmpRepo();
  storeAdd(repo, { title: 'A', body: 'a', tags: ['x', 'y'] });
  storeAdd(repo, { title: 'B', body: 'b', tags: ['y'] });
  storeAdd(repo, { title: 'C', body: 'c' }); // no tags → (none)
  const byName = Object.fromEntries(storeGroup(repo, { by: 'tag' }).map((g) => [g.group, g.items.map((i) => i.title)]));
  expect(byName['x']).toEqual(['A']);
  expect([...(byName['y'] ?? [])].sort()).toEqual(['A', 'B']);
  expect(byName['(none)']).toEqual(['C']);
});

test('group-by category/type/kind buckets by field with a (none) fallback', () => {
  const repo = tmpRepo();
  storeAdd(repo, { title: 'Doc', body: 'd', type: 'doc', category: 'auth', kind: 'reference' });
  storeAdd(repo, { title: 'Note', body: 'n', type: 'doc' }); // no category/kind → (none)
  expect(storeGroup(repo, { by: 'type' }).map((g) => g.group)).toEqual(['doc']);
  expect(storeGroup(repo, { by: 'category' }).map((g) => g.group)).toEqual(['(none)', 'auth']); // name-sorted
  expect(storeGroup(repo, { by: 'kind' }).map((g) => g.group)).toEqual(['(none)', 'reference']);
});

test('group-by tag normalizes tags: trim, dedupe, drop empties (no double-insert, no empty group)', () => {
  const repo = tmpRepo();
  storeAdd(repo, { title: 'D', body: 'd', tags: ['x', 'x', '', ' y '] });
  const g = storeGroup(repo, { by: 'tag' });
  expect(g.map((x) => x.group)).toEqual(['x', 'y']); // deduped + trimmed, no '' group
  expect(g.find((x) => x.group === 'x')!.items).toHaveLength(1); // 'x' appears once, not twice
});

test('CLI list rejects an empty or invalid --group-by / --sort (not silently ignored)', () => {
  expect(storeCli(['list', '--group-by', ''])).toBe(1);
  expect(storeCli(['list', '--sort', ''])).toBe(1);
  expect(storeCli(['list', '--group-by', 'nope'])).toBe(1);
});

test('progress groups BACKLOG by spec with per-spec status counts; missing spec → unlinked', () => {
  const repo = tmpRepo();
  initRepo(repo);
  storePromote(repo, { id: 't1', title: 'One', specId: 'spec-a' });
  storePromote(repo, { id: 't2', title: 'Two', specId: 'spec-a' });
  storePromote(repo, { id: 't3', title: 'Three', specId: 'spec-b' });
  storePromote(repo, { id: 't4', title: 'Four' }); // no spec → unlinked
  const p = join(repo, 'BACKLOG.md');
  writeFileSync(p, setStatus(readFileSync(p, 'utf8'), 't1', 'done')); // one done
  const bySpec = Object.fromEntries(storeProgress(repo).map((s) => [s.spec, s]));
  expect(bySpec['spec-a']).toMatchObject({ total: 2, done: 1, byStatus: { done: 1, ready: 1 } });
  expect(bySpec['spec-b'].total).toBe(1);
  expect(bySpec['unlinked'].tasks.map((t) => t.id)).toEqual(['t4']);
  expect(storeProgress(repo).map((s) => s.spec)).toEqual(['spec-a', 'spec-b', 'unlinked']); // name-sorted
});

test('progress type-guards a non-string links.spec → unlinked (never throws)', () => {
  const repo = tmpRepo();
  writeFileSync(join(repo, 'BACKLOG.md'), md('### t — T', '```yaml', 'id: t', 'status: ready', 'links:', '  spec: 123', '```'));
  expect(storeProgress(repo).map((s) => s.spec)).toEqual(['unlinked']); // numeric spec is not a string id
});

test('link adds a typed link to the from-card, surfaced via show; dedupes an identical rel+to', () => {
  const repo = tmpRepo();
  const a = storeAdd(repo, { title: 'A', body: 'a' });
  const b = storeAdd(repo, { title: 'B', body: 'b' });
  storeLink(repo, { from: a.id, to: b.id, rel: 'references' });
  storeLink(repo, { from: a.id, to: b.id, rel: 'references' }); // dedupe → still one
  expect(storeShow(repo, a.id).links).toEqual([{ rel: 'references', to: b.id }]);
});

test('re-adding a card PRESERVES links added via link, and RETURNS the merged card (Codex fix)', () => {
  const repo = tmpRepo();
  const a = storeAdd(repo, { title: 'A', body: 'a' });
  storeLink(repo, { from: a.id, to: 'x', rel: 'defines' });
  const readd = storeAdd(repo, { title: 'A', body: 'a' }); // same title+body → same id → idempotent re-add
  expect(storeShow(repo, a.id).links).toEqual([{ rel: 'defines', to: 'x' }]); // persisted: link NOT dropped
  expect(readd.links).toEqual([{ rel: 'defines', to: 'x' }]); // returned value reflects the merge, not the linkless input
});

test('link rejects an invalid --rel and a missing --from', () => {
  const repo = tmpRepo();
  const a = storeAdd(repo, { title: 'A', body: 'a' });
  expect(() => storeLink(repo, { from: a.id, to: 'x', rel: 'bogus' as LinkRel })).toThrow(/--rel must be/);
  expect(() => storeLink(repo, { from: 'nope', to: 'x', rel: 'defines' })).toThrow(/no card/);
});

test('viz emits a structural mermaid graph (roadmap → spec → tasks) to the gitignored pending dir', () => {
  const repo = tmpRepo();
  const spec = storeAdd(repo, { title: 'My Spec', type: 'spec', body: md('## Outcome', 'o', '## Verification surface', 'v', '## Boundaries', 'b') });
  storePromote(repo, { id: 'step1', title: 'Step One', specId: spec.id });
  const r = storeViz(repo);
  expect(r.mermaid).toContain('graph TD');
  expect(r.mermaid).toContain('My Spec'); // spec node labelled
  expect(r.mermaid).toMatch(/roadmap --> n\d/); // roadmap → spec node
  expect(r.mermaid).toContain('Step One'); // task node labelled
  expect(r.mermaid).toMatch(/n\d+ --> t\d/); // spec → its backlog task (via links.spec)
  expect(r.path).toContain(join('.coco', 'store', 'pending')); // gitignored dir — never a committed/churning file
  expect(existsSync(r.path)).toBe(true);
  expect(readFileSync(r.path, 'utf8')).toContain('```mermaid');
  // viz ensures its own gitignore even without a prior `coco-store init` (so the output is never tracked)
  expect(readFileSync(join(repo, '.gitignore'), 'utf8')).toContain('.coco/store/');
});

test('promote appends a coco-loop-readable ready task (the store→loop contract)', () => {
  const repo = tmpRepo();
  initRepo(repo);
  storePromote(repo, { id: 'imp-1', title: 'Build importer', priority: 'high' });
  expect(cocoNext(repo).task?.id).toBe('imp-1');
});

test('promote --spec links a step back to its GoalSpec (traceability), round-tripping through the parser', () => {
  const repo = tmpRepo();
  initRepo(repo);
  storePromote(repo, { id: 'imp-1', title: 'Build importer', priority: 'high', specId: 'importer-spec-abc123' });
  expect(cocoNext(repo).task?.links).toEqual({ spec: 'importer-spec-abc123' });
});

test('promote without --spec emits no links (unchanged contract)', () => {
  const repo = tmpRepo();
  initRepo(repo);
  storePromote(repo, { id: 'imp-1', title: 'Build importer' });
  expect(cocoNext(repo).task?.links).toEqual({});
});

test('promote rejects an unsafe spec id so BACKLOG.md YAML stays parseable', () => {
  const repo = tmpRepo();
  initRepo(repo);
  expect(() => storePromote(repo, { id: 'ok', title: 'x', specId: 'bad spec' })).toThrow(/spec id must match/);
});

test('promote rejects a present-but-empty spec id (never silently drops the link)', () => {
  const repo = tmpRepo();
  initRepo(repo);
  expect(() => storePromote(repo, { id: 'ok', title: 'x', specId: '' })).toThrow(/spec id must match/);
});

test('a YAML-scalar-looking spec id round-trips as a STRING (quoted emission)', () => {
  const repo = tmpRepo();
  initRepo(repo);
  storePromote(repo, { id: 'step-1', title: 'x', specId: '123' });
  expect(cocoNext(repo).task?.links).toEqual({ spec: '123' }); // string '123', not number 123
});

test('add rejects a GoalSpec (type=spec) missing required sections; nothing is archived', () => {
  const repo = tmpRepo();
  expect(() =>
    storeAdd(repo, { title: 'Weak goal', type: 'spec', body: md('## Outcome', 'do a thing') }),
  ).toThrow(/missing required GoalSpec section\(s\): Verification surface, Boundaries/);
  expect(storeList(repo)).toHaveLength(0);
});

test('add accepts a complete GoalSpec and skips the section check for non-spec cards', () => {
  const repo = tmpRepo();
  storeAdd(repo, {
    title: 'Strong goal',
    type: 'spec',
    body: md('## Outcome', 'x', '## Verification surface', '`pnpm test`', '## Boundaries', 'only src/'),
  });
  storeAdd(repo, { title: 'Plain doc', type: 'doc', body: 'no GoalSpec sections here' }); // non-spec → not validated
  expect(storeList(repo)).toHaveLength(2);
});
