import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { VERIFY_NOT_CONFIGURED_WARNING, verifyConfigWarnings } from '../src/cocoConfig.js';
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
