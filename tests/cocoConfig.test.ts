import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  DEFAULT_AUTO_MERGE_CONFIG,
  readAutoMergePolicyAtRef,
  resolveBaseBranch,
  VERIFY_NOT_CONFIGURED_WARNING,
  verifyConfigWarnings,
} from '../src/cocoConfig.js';
import { initRepo } from '../src/commands/init.js';
import { g, tmpRepo } from './helpers.js';

test('verifyConfigWarnings flags a missing/empty verify.testCommand (early preflight)', () => {
  const repo = tmpRepo();
  initRepo(repo); // scaffolds coco.config.json with an empty (placeholder) testCommand
  // base === head so the "testCommand changed" warning cannot fire — this isolates the not-configured one
  expect(verifyConfigWarnings(repo, 'HEAD', 'HEAD')).toContain(VERIFY_NOT_CONFIGURED_WARNING);
});

test('verifyConfigWarnings stays silent once verify.testCommand is set', () => {
  const repo = tmpRepo();
  initRepo(repo);
  writeFileSync(join(repo, 'coco.config.json'), `${JSON.stringify({ verify: { testCommand: 'pnpm test' } }, null, 2)}\n`);
  g(repo, ['add', 'coco.config.json']);
  g(repo, ['commit', '-m', 'configure verify']);
  expect(verifyConfigWarnings(repo, 'HEAD', 'HEAD')).not.toContain(VERIFY_NOT_CONFIGURED_WARNING);
});

function commitConfig(repo: string, body: unknown): void {
  writeFileSync(join(repo, 'coco.config.json'), JSON.stringify(body));
  g(repo, ['add', 'coco.config.json']);
  g(repo, ['commit', '-m', 'config']);
}

test('resolveBaseBranch honours workflow.baseBranch', () => {
  const repo = tmpRepo();
  commitConfig(repo, { workflow: { baseBranch: 'develop' } });
  expect(resolveBaseBranch(repo)).toBe('develop');
});

test('readAutoMergePolicyAtRef returns defaults when config is missing', () => {
  const repo = tmpRepo(); // no coco.config.json
  expect(readAutoMergePolicyAtRef(repo, 'HEAD')).toEqual(DEFAULT_AUTO_MERGE_CONFIG);
});

test('readAutoMergePolicyAtRef merges a partial autoMerge block over defaults', () => {
  const repo = tmpRepo();
  commitConfig(repo, { autoMerge: { maxChangedLines: 42 } }); // only override the cap
  const p = readAutoMergePolicyAtRef(repo, 'HEAD');
  expect(p.maxChangedLines).toBe(42);
  expect(p.sensitiveGlobs).toEqual(DEFAULT_AUTO_MERGE_CONFIG.sensitiveGlobs); // untouched
  expect(p.testGlobs).toEqual(DEFAULT_AUTO_MERGE_CONFIG.testGlobs);
});

test('user autoMerge globs are additive by default', () => {
  const repo = tmpRepo();
  commitConfig(repo, { autoMerge: { sensitiveGlobs: ['infra/**'], testGlobs: ['checks/**'] } });
  const p = readAutoMergePolicyAtRef(repo, 'HEAD');
  expect(p.sensitiveGlobs).toEqual([...DEFAULT_AUTO_MERGE_CONFIG.sensitiveGlobs, 'infra/**']);
  expect(p.testGlobs).toEqual([...DEFAULT_AUTO_MERGE_CONFIG.testGlobs, 'checks/**']);
});

test('autoMerge globs can explicitly replace defaults', () => {
  const repo = tmpRepo();
  commitConfig(repo, { autoMerge: { replaceDefaultSensitiveGlobs: true, sensitiveGlobs: ['infra/**'], replaceDefaultTestGlobs: true, testGlobs: ['checks/**'] } });
  const p = readAutoMergePolicyAtRef(repo, 'HEAD');
  expect(p.sensitiveGlobs).toEqual(['infra/**']);
  expect(p.testGlobs).toEqual(['checks/**']);
});

test('readAutoMergePolicyAtRef falls back to defaults on malformed JSON or bad types', () => {
  const bad = tmpRepo();
  writeFileSync(join(bad, 'coco.config.json'), '{ not json');
  g(bad, ['add', 'coco.config.json']);
  g(bad, ['commit', '-m', 'broken']);
  expect(readAutoMergePolicyAtRef(bad, 'HEAD')).toEqual(DEFAULT_AUTO_MERGE_CONFIG);

  const wrong = tmpRepo();
  commitConfig(wrong, { autoMerge: { maxChangedLines: -5, sensitiveGlobs: 'nope' } });
  const p = readAutoMergePolicyAtRef(wrong, 'HEAD');
  expect(p.maxChangedLines).toBe(DEFAULT_AUTO_MERGE_CONFIG.maxChangedLines); // negative rejected
  expect(p.sensitiveGlobs).toEqual(DEFAULT_AUTO_MERGE_CONFIG.sensitiveGlobs); // non-array rejected
});
