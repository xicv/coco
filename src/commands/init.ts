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

  // The invariant coco needs is a COMMITTED coco.config.json (verify reads it via
  // `git show HEAD:coco.config.json`), which is distinct from a file merely existing on disk. Track
  // the two separately: write a starter only when no file exists (never overwrite), but commit
  // whenever HEAD lacks the config — this recovers an existing-but-untracked config (e.g. one the
  // repo ignores via `*.json`, or an artifact a prior interrupted init left behind).
  const cfgPath = join(repo, 'coco.config.json');
  const configExists = existsSync(cfgPath);
  const hasHead = tryGit(repo, ['rev-parse', 'HEAD']).ok;
  const headHasConfig = hasHead && tryGit(repo, ['cat-file', '-e', 'HEAD:coco.config.json']).ok;
  const needsConfigWrite = !configExists;
  const needsConfigCommit = !headHasConfig;

  const willCommit = needsIgnore || needsConfigCommit || !hasHead;

  // Refuse pre-existing staged changes BEFORE writing anything. Writing first would leave the
  // scaffolded .gitignore / coco.config.json untracked when we throw (a dirty tree that goalStart
  // rejects), and a re-run wouldn't recover it — the files would already exist, so nothing would
  // re-scaffold or commit them. `git diff --cached --name-only` lists the index (vs HEAD, or the
  // empty tree in an unborn repo); the user must commit/unstage those first.
  if (willCommit) {
    const staged = tryGit(repo, ['diff', '--cached', '--name-only']);
    const stagedFiles = staged.ok ? staged.out.split('\n').map((l) => l.trim()).filter(Boolean) : [];
    if (stagedFiles.length) {
      throw new Error(`coco init: refusing — you have staged changes (${stagedFiles.join(', ')}). Commit or unstage them first, then re-run coco init.`);
    }
  }

  // Safe to write now — the refusal has already fired, so a throw can't leak a scaffolded file.
  if (needsIgnore) {
    const prefix = current && !current.endsWith('\n') ? `${current}\n` : current;
    writeFileSync(gi, `${prefix}.coco/\n`);
  }
  // Scaffold a starter coco.config.json so the coco-owned verify gate is configurable from day one.
  if (needsConfigWrite) {
    writeFileSync(cfgPath, `${JSON.stringify(STARTER_COCO_CONFIG, null, 2)}\n`);
  }

  // Commit so init never leaves the working tree dirty (a dirty tree would make goalStart return
  // `commit-or-revert`). Pathspec commit: commit ONLY coco's own files, so nothing else can ride
  // along even if concurrently staged. .gitignore is always seeded on an unborn repo (to create HEAD).
  if (willCommit) {
    const pathspec = [needsIgnore || !hasHead ? '.gitignore' : null, needsConfigCommit ? 'coco.config.json' : null].filter(
      (p): p is string => p !== null,
    );
    // Force-add (`-f`) coco's own files past any repo ignore rules. A repo that ignores e.g. `*.json`
    // would otherwise make `git add coco.config.json` fail, throwing AFTER the write (a leak) — and
    // coco REQUIRES its config tracked (verify reads it via `git show HEAD:coco.config.json`). These
    // pathspecs are coco-owned, so overriding .gitignore for exactly them is correct.
    git(repo, ['add', '-f', '--', ...pathspec]);
    git(repo, ['-c', 'user.email=coco@local', '-c', 'user.name=coco', 'commit', '-m', 'chore: coco init', '--', ...pathspec]);
  }
}

export { cocoDir };
