import { expect, test } from 'vitest';
import { classifyOp, splitSegments, tokenize } from '../src/guard.js';

/** classify one command; default current branch is the goal branch (not base). */
const op = (cmd: string, base = 'main', cur: string | null = 'coco/x') => classifyOp(tokenize(cmd), base, cur);

test('blocks raw merge / gh pr merge (any variant)', () => {
  expect(op('git merge feature')).toBe('git merge');
  expect(op('git merge --no-ff feature')).toBe('git merge');
  expect(op('git   merge   feature')).toBe('git merge'); // extra whitespace
  expect(op('git -C /repo merge feature')).toBe('git merge');
  expect(op('gh pr merge 12 --squash')).toBe('gh pr merge');
});

test('blocks every push form that lands on base, any remote / options / refspec', () => {
  expect(op('git push origin main')).toBeTruthy();
  expect(op('git push origin refs/heads/main')).toBeTruthy();
  expect(op('git push origin --force main')).toBeTruthy();
  expect(op('git push origin -f main')).toBeTruthy();
  expect(op('git push origin --force-with-lease main')).toBeTruthy();
  expect(op('git push upstream main')).toBeTruthy(); // non-origin remote
  expect(op('git push origin HEAD:main')).toBeTruthy();
  expect(op('git push origin main:main')).toBeTruthy();
  expect(op('git push origin +main')).toBeTruthy();
  expect(op('git push origin --delete main')).toBeTruthy();
});

test('resolves HEAD / --mirror / --all push forms', () => {
  expect(op('git push origin HEAD', 'main', 'main')).toBeTruthy(); // HEAD → current (main)
  expect(op('git push origin HEAD', 'main', 'coco/x')).toBeNull(); // HEAD → goal branch, fine
  expect(op('git push --mirror origin', 'main', 'coco/x')).toBeTruthy();
  expect(op('git push --all origin', 'main', 'coco/x')).toBeTruthy();
});

test('a value-taking global option cannot hide the merge subcommand', () => {
  expect(op('git --config-env foo.bar=X merge feature')).toBe('git merge');
  expect(op('git -c user.name=x merge feature')).toBe('git merge');
  expect(op('git -C /repo -c a=b merge x')).toBe('git merge');
});

test('tokenize handles backslash-escaped spaces (repo path with spaces)', () => {
  expect(tokenize('git -C /tmp/a\\ b merge')).toEqual(['git', '-C', '/tmp/a b', 'merge']);
});

test('splitSegments does not split on separators inside quotes', () => {
  expect(splitSegments('git commit -m "a; b && c | d"')).toEqual(['git commit -m "a; b && c | d"']);
  expect(splitSegments('a && b ; c')).toEqual(['a ', ' b ', ' c']);
});

test('blocks pull/bare-push ONLY when the current branch is base', () => {
  expect(op('git pull . coco/x', 'main', 'main')).toBeTruthy(); // on main → merges into main
  expect(op('git pull . coco/x', 'main', 'coco/x')).toBeNull(); // on goal branch → fine
  expect(op('git push', 'main', 'main')).toBeTruthy(); // bare push on main
  expect(op('git push', 'main', 'coco/x')).toBeNull(); // bare push of goal branch
});

test('does NOT block legitimate ops', () => {
  expect(op('git merge-base main HEAD')).toBeNull();
  expect(op('git merge --abort')).toBeNull();
  expect(op('git merge --continue')).toBeNull();
  expect(op('coco merge --goal goal-123')).toBeNull(); // not git/gh
  expect(op('git commit -m "work"')).toBeNull();
  expect(op('git checkout coco/x')).toBeNull();
  expect(op('git rebase main')).toBeNull();
  expect(op('git push origin coco/x')).toBeNull(); // pushing the feature branch
  expect(op('git status')).toBeNull();
});

test('does NOT block quoted text, echo, or comments containing "git merge"', () => {
  expect(op('git commit -m "git merge feature"')).toBeNull();
  expect(op('echo "git merge feature"')).toBeNull();
  expect(op('# git merge feature')).toBeNull();
});

test('respects a non-default base', () => {
  expect(op('git push origin develop', 'develop')).toBeTruthy();
  expect(op('git push origin develop', 'main')).toBeNull();
});

test('tokenize drops comments and respects quotes', () => {
  expect(tokenize('git commit -m "a b" # note')).toEqual(['git', 'commit', '-m', 'a b']);
  expect(tokenize('   ')).toEqual([]);
});
