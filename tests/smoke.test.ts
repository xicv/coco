import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { tmpRepo } from './helpers.js';

test('tmpRepo creates a git repo on main', () => {
  const repo = tmpRepo();
  expect(existsSync(join(repo, '.git'))).toBe(true);
});
