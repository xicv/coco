import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, tryGit } from '../git.js';
import { cocoDir, goalsDir } from '../paths.js';

/** Idempotently bootstrap a target repo for coco. Leaves a CLEAN tree. */
export function initRepo(repo: string): void {
  if (!existsSync(join(repo, '.git'))) {
    git(repo, ['init', '-b', 'main']);
  }

  mkdirSync(goalsDir(repo), { recursive: true });

  const gi = join(repo, '.gitignore');
  const current = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
  const needsIgnore = !current.split('\n').includes('.coco/');
  if (needsIgnore) {
    const prefix = current && !current.endsWith('\n') ? `${current}\n` : current;
    writeFileSync(gi, `${prefix}.coco/\n`);
  }

  // Commit when we just created/updated .gitignore, or to seed an unborn repo —
  // so init never leaves the working tree dirty (a dirty tree would make
  // goalStart return `commit-or-revert`).
  const hasHead = tryGit(repo, ['rev-parse', 'HEAD']).ok;
  if (needsIgnore || !hasHead) {
    // Refuse to sweep pre-existing staged changes into coco's init commit — they'd land unreviewed
    // under our message. `git diff --cached --name-only` lists the index (vs HEAD, or the empty tree
    // in an unborn repo); the user must commit/unstage those first.
    const staged = tryGit(repo, ['diff', '--cached', '--name-only']);
    const stagedFiles = staged.ok ? staged.out.split('\n').map((l) => l.trim()).filter(Boolean) : [];
    if (stagedFiles.length) {
      throw new Error(`coco init: refusing — you have staged changes (${stagedFiles.join(', ')}). Commit or unstage them first, then re-run coco init.`);
    }
    git(repo, ['add', '.gitignore']);
    // Pathspec commit: commit ONLY .gitignore, so nothing else can ride along even if concurrently staged.
    git(repo, ['-c', 'user.email=coco@local', '-c', 'user.name=coco', 'commit', '-m', 'chore: coco init', '--', '.gitignore']);
  }
}

export { cocoDir };
