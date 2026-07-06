import { expect, test } from 'vitest';
import { assertUniqueIds, parseBacklog, pickNext, setStatus } from '../src/backlog.js';

const md = (...lines: string[]) => lines.join('\n');

test('a ### heading inside a fenced code block is NOT a task', () => {
  const t = md('### real — Real task', '```yaml', 'id: real', 'status: ready', 'priority: high', '```', 'Example:', '```md', '### fake — Not a task', '```', '');
  const n = parseBacklog(t);
  expect(n.map((x) => x.id)).toEqual(['real']);
  expect(pickNext(n)?.id).toBe('real');
});

test('sections without a yaml block, or with invalid yaml, are not actionable', () => {
  const t = md('### note — Just a note', 'Some prose.', '', '### broken — Broken', '```yaml', 'status: [', '```', '');
  expect(parseBacklog(t)).toEqual([]);
});

test('missing status defaults to blocked (never ready)', () => {
  const t = md('### x — X', '```yaml', 'id: x', 'priority: high', '```');
  expect(parseBacklog(t)[0].status).toBe('blocked');
  expect(pickNext(parseBacklog(t))).toBeNull();
});

test('scalar dependsOn is accepted as a single-element list', () => {
  const t = md('### a — A', '```yaml', 'id: a', 'status: in-progress', '```', '### b — B', '```yaml', 'id: b', 'status: ready', 'dependsOn: a', '```');
  const n = parseBacklog(t);
  expect(n.find((x) => x.id === 'b')?.dependsOn).toEqual(['a']);
  expect(pickNext(n)).toBeNull(); // dep a not done
});

test('duplicate ids are rejected', () => {
  const t = md('### dup — One', '```yaml', 'id: dup', 'status: ready', '```', '### dup — Two', '```yaml', 'id: dup', 'status: ready', '```');
  expect(() => assertUniqueIds(parseBacklog(t))).toThrow(/duplicate/);
  expect(() => setStatus(t, 'dup', 'done')).toThrow(/duplicate/);
});

test('CRLF backlog parses status correctly', () => {
  const t = ['### x — X', '```yaml', 'id: x', 'priority: high', 'status: ready', '```', ''].join('\r\n');
  expect(pickNext(parseBacklog(t))?.id).toBe('x');
});

const SAMPLE = [
  '# Backlog',
  '',
  '### task-1 — First task',
  '```yaml',
  'id: task-1',
  'status: done',
  'priority: high',
  '```',
  'Do the first thing.',
  '',
  '### task-2 — Second task',
  '```yaml',
  'id: task-2',
  'status: ready',
  'priority: low',
  'dependsOn: [task-1]',
  '```',
  'Second body.',
  '',
  '### task-3 — Third (blocked by unfinished dep)',
  '```yaml',
  'id: task-3',
  'status: ready',
  'priority: high',
  'dependsOn: [task-4]',
  '```',
  '',
  '### task-4 — Fourth (not done)',
  '```yaml',
  'id: task-4',
  'status: in-progress',
  'priority: high',
  '```',
  '',
].join('\n');

test('parseBacklog extracts nodes with metadata + body', () => {
  const n = parseBacklog(SAMPLE);
  expect(n.map((x) => x.id)).toEqual(['task-1', 'task-2', 'task-3', 'task-4']);
  expect(n[1]).toMatchObject({ status: 'ready', priority: 'low', dependsOn: ['task-1'] });
  expect(n[1].body).toContain('Second body');
});

test('pickNext picks the highest-priority ready node with satisfied deps', () => {
  // task-2 ready (dep task-1 done); task-3 ready but dep task-4 not done → blocked.
  expect(pickNext(parseBacklog(SAMPLE))?.id).toBe('task-2');
});

test('pickNext returns null when nothing is ready + unblocked', () => {
  const t = setStatus(setStatus(SAMPLE, 'task-2', 'done'), 'task-3', 'blocked');
  expect(pickNext(parseBacklog(t))).toBeNull();
});

test('priority ordering: a high-priority ready node beats a low one', () => {
  const t = ['### a — A', '```yaml', 'id: a', 'status: ready', 'priority: low', '```', '### b — B', '```yaml', 'id: b', 'status: ready', 'priority: high', '```'].join('\n');
  expect(pickNext(parseBacklog(t))?.id).toBe('b');
});

test('setStatus updates only the target node, preserving body + siblings', () => {
  const out = setStatus(SAMPLE, 'task-2', 'done');
  const n = parseBacklog(out);
  expect(n.find((x) => x.id === 'task-2')?.status).toBe('done');
  expect(n.find((x) => x.id === 'task-1')?.status).toBe('done'); // unchanged
  expect(n.find((x) => x.id === 'task-4')?.status).toBe('in-progress'); // unchanged
  expect(out).toContain('Second body.'); // prose preserved
});

test('setStatus throws for an unknown task', () => {
  expect(() => setStatus(SAMPLE, 'nope', 'done')).toThrow(/no backlog task/);
});
