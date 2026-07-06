import { appendFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { makeCardId, parseCard, type ResourceCard } from '../src/store/schema.js';
import { readCards, removeCard, upsertCard } from '../src/store/manifest.js';
import { manifestPath } from '../src/store/paths.js';
import { appendBacklogTask } from '../src/store/backlogPromote.js';
import { cocoNext } from '../src/commands/backlog.js';
import { initRepo } from '../src/commands/init.js';
import { tmpRepo } from './helpers.js';

function card(title: string, body: string, over: Partial<ResourceCard> = {}): ResourceCard {
  return parseCard({ id: makeCardId(title, body), type: 'doc', title, body, timestamp: '2026-01-01T00:00:00Z', ...over });
}

test('makeCardId is stable for the same title+body and changes when the body changes', () => {
  expect(makeCardId('Auth flow', 'x')).toBe(makeCardId('Auth flow', 'x'));
  expect(makeCardId('Auth flow', 'x')).not.toBe(makeCardId('Auth flow', 'y'));
});

test('parseCard defaults visibility to local and rejects a card missing a required field', () => {
  expect(card('T', 'b').visibility).toBe('local');
  expect(() => parseCard({ id: 'x', type: 'doc', body: 'b', timestamp: 't' })).toThrow(); // no title
});

test('manifest upsert is idempotent by id; read + remove behave', () => {
  const repo = tmpRepo();
  upsertCard(repo, card('One', 'a'));
  upsertCard(repo, card('Two', 'b'));
  upsertCard(repo, card('One', 'a')); // same id → replace, not duplicate
  expect(readCards(repo)).toHaveLength(2);
  expect(removeCard(repo, makeCardId('One', 'a'))).toBe(true);
  expect(readCards(repo)).toHaveLength(1);
  expect(removeCard(repo, 'no-such-id')).toBe(false);
});

test('a corrupt manifest line is skipped, not fatal', () => {
  const repo = tmpRepo();
  upsertCard(repo, card('Good', 'a'));
  appendFileSync(manifestPath(repo), 'not json at all\n');
  expect(readCards(repo)).toHaveLength(1); // good card survives; garbage skipped
});

test('appendBacklogTask writes a coco-loop-readable ready task and refuses a duplicate id', () => {
  const repo = tmpRepo();
  initRepo(repo);
  appendBacklogTask(repo, { id: 'task-1', title: 'Do the thing', body: 'details', priority: 'high' });
  expect(cocoNext(repo).task?.id).toBe('task-1'); // coco-loop's own parser reads it back
  expect(() => appendBacklogTask(repo, { id: 'task-1', title: 'dup' })).toThrow(/already/);
});
