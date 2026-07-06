import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { storeAdd, storeFind, storeGroup, storeInit, storeLink, storeList, storePack, storeProgress, storePromote, storeRoadmap, storeShow, storeViz, type LinkRel } from '../src/store/commands.js';
import { main as storeCli } from '../src/store/cli.js';
import { setStatus } from '../src/backlog.js';
import { cocoNext } from '../src/commands/backlog.js';
import { initRepo } from '../src/commands/init.js';
import { tmpRepo } from './helpers.js';

const md = (...lines: string[]) => lines.join('\n');

test('init creates .coco-store + roadmap and ignores local data (roadmap stays tracked)', () => {
  const repo = tmpRepo();
  storeInit(repo);
  expect(existsSync(join(repo, '.coco-store', 'roadmap.md'))).toBe(true);
  const gi = readFileSync(join(repo, '.gitignore'), 'utf8');
  expect(gi).toMatch(/\.coco-store\/resources\.ndjson/);
  expect(gi).not.toMatch(/\.coco-store\/roadmap\.md/); // roadmap is tracked
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
  storeAdd(repo, { title: 'Importer notes', body: 'details about the importer' });
  const r = storePack(repo, { goalId: 'g1', query: 'importer' });
  expect(r.included).toBe(1);
  expect(existsSync(r.path)).toBe(true);
  expect(r.brief).toMatch(/Roadmap/);
  expect(r.brief).toMatch(/Importer notes/);
});

test('pack respects the byte budget (drops cards that do not fit)', () => {
  const repo = tmpRepo();
  storeAdd(repo, { title: 'Big', body: 'x'.repeat(500) });
  storeAdd(repo, { title: 'Also big', body: 'y'.repeat(500) });
  const r = storePack(repo, { goalId: 'g1', budgetBytes: 300 });
  expect(r.included).toBe(0); // neither 500-byte card fits a 300-byte budget
});

test('pack falls back to the default budget on a NaN budget (not unbounded)', () => {
  const repo = tmpRepo();
  storeAdd(repo, { title: 'Small', body: 'tiny' });
  const r = storePack(repo, { goalId: 'g1', budgetBytes: Number.NaN });
  expect(r.included).toBe(1); // default budget applies; the card is included, not silently dropped or unbounded
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
  expect(r.path).toContain(join('.coco-store', 'pending')); // gitignored dir — never a committed/churning file
  expect(existsSync(r.path)).toBe(true);
  expect(readFileSync(r.path, 'utf8')).toContain('```mermaid');
  // viz ensures its own gitignore even without a prior `coco-store init` (so the output is never tracked)
  expect(readFileSync(join(repo, '.gitignore'), 'utf8')).toContain('.coco-store/pending/');
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
