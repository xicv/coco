import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, tryGit } from '../git.js';
import { cocoDir, goalsDir } from '../paths.js';

/** Starter `coco.config.json` scaffolded on init. The `testCommand` is an intentional fill-me-in
 * placeholder (empty → parses to no verify config → goal status surfaces a non-blocking warning
 * until set), so the verify gate is discoverable at init time rather than after plan/implement/review.
 * The `//` key is an inline doc note (JSON has no comments); the config parser ignores unknown keys. */
const STARTER_COCO_CONFIG = {
  '//': "coco runs verify.testCommand itself at the verify gate (no agent-reported fallback). Set it to your project's test command, e.g. \"pnpm test\" or \"npm test\".",
  verify: {
    testCommand: '',
    timeoutSec: 600,
    outputLimitBytes: 65536,
  },
};

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

  // Scaffold a starter coco.config.json when absent so the coco-owned verify gate is configurable
  // from day one. Never overwrite an existing config (idempotent, and the repo's own policy wins).
  const cfgPath = join(repo, 'coco.config.json');
  const needsConfig = !existsSync(cfgPath);
  if (needsConfig) {
    writeFileSync(cfgPath, `${JSON.stringify(STARTER_COCO_CONFIG, null, 2)}\n`);
  }

  // Commit when we just wrote .gitignore / coco.config.json, or to seed an unborn repo — so init
  // never leaves the working tree dirty (a dirty tree would make goalStart return `commit-or-revert`).
  const hasHead = tryGit(repo, ['rev-parse', 'HEAD']).ok;
  if (needsIgnore || needsConfig || !hasHead) {
    // Refuse to sweep pre-existing staged changes into coco's init commit — they'd land unreviewed
    // under our message. `git diff --cached --name-only` lists the index (vs HEAD, or the empty tree
    // in an unborn repo); the user must commit/unstage those first.
    const staged = tryGit(repo, ['diff', '--cached', '--name-only']);
    const stagedFiles = staged.ok ? staged.out.split('\n').map((l) => l.trim()).filter(Boolean) : [];
    if (stagedFiles.length) {
      throw new Error(`coco init: refusing — you have staged changes (${stagedFiles.join(', ')}). Commit or unstage them first, then re-run coco init.`);
    }
    // Pathspec commit: commit ONLY coco's own files, so nothing else can ride along even if
    // concurrently staged. .gitignore is always seeded on an unborn repo (to create HEAD).
    const pathspec = [needsIgnore || !hasHead ? '.gitignore' : null, needsConfig ? 'coco.config.json' : null].filter(
      (p): p is string => p !== null,
    );
    git(repo, ['add', ...pathspec]);
    git(repo, ['-c', 'user.email=coco@local', '-c', 'user.name=coco', 'commit', '-m', 'chore: coco init', '--', ...pathspec]);
  }
}

export { cocoDir };
