import { chdir, cwd } from 'node:process';
import { expect, test } from 'vitest';
import { main } from '../src/cli.js';
import { initRepo } from '../src/commands/init.js';
import { findActiveGoal } from '../src/state.js';
import { tmpRepo } from './helpers.js';

/** Run the CLI with stdout suppressed (commands print JSON we don't need here). */
function runSilent(args: string[]): number {
  const orig = process.stdout.write.bind(process.stdout);
  (process.stdout as unknown as { write: () => boolean }).write = () => true;
  try {
    return main(args);
  } finally {
    (process.stdout as unknown as { write: typeof orig }).write = orig;
  }
}

test('coco goal start --auto-merge sets autoMergeAllowed; absent without the flag', () => {
  const prev = cwd();
  try {
    const withFlag = tmpRepo();
    initRepo(withFlag);
    chdir(withFlag);
    expect(runSilent(['goal', 'start', '--objective', 'auto on', '--auto-merge'])).toBe(0);
    expect(findActiveGoal(withFlag)?.autoMergeAllowed).toBe(true);

    const noFlag = tmpRepo();
    initRepo(noFlag);
    chdir(noFlag);
    expect(runSilent(['goal', 'start', '--objective', 'auto off'])).toBe(0);
    expect(findActiveGoal(noFlag)?.autoMergeAllowed).toBeUndefined();
  } finally {
    chdir(prev);
  }
});
