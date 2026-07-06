import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const GUARD_MARKER = 'coco-merge-guard';

interface HookCmd {
  type?: string;
  command?: string;
}
interface HookEntry {
  matcher?: string;
  hooks?: HookCmd[];
}
type Config = { hooks?: { PreToolUse?: HookEntry[] } & Record<string, unknown> } & Record<string, unknown>;

function scriptContent(cocoBin: string): string {
  return `#!/usr/bin/env bash
# coco P1b merge guard — deny a raw git merge/push to base while a coco goal is active.
exec node ${JSON.stringify(cocoBin)} guard-hook
`;
}

function readJson(path: string): Config {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf8');
  if (raw.trim() === '') return {};
  try {
    return JSON.parse(raw) as Config;
  } catch {
    // Fail CLOSED — never clobber a config we can't parse (JSONC, hand-edit in progress, …).
    throw new Error(`coco: refusing to modify unparseable JSON config: ${path} (fix or remove it first)`);
  }
}
function writeJson(path: string, obj: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`);
}
function backup(path: string): void {
  if (existsSync(path)) copyFileSync(path, `${path}.coco-bak`);
}

/** Idempotently add the guard as the FIRST PreToolUse "Bash" hook (runs before rewrite hooks). */
export function mergeHookInto(configPath: string, scriptPath: string): void {
  const obj = readJson(configPath);
  const hooks = (obj.hooks ??= {});
  const pre: HookEntry[] = Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse : [];
  hooks.PreToolUse = pre;

  let bash = pre.find((e) => e.matcher === 'Bash');
  if (!bash) {
    bash = { matcher: 'Bash', hooks: [] };
    pre.unshift(bash);
  }
  bash.hooks = Array.isArray(bash.hooks) ? bash.hooks : [];
  const present = bash.hooks.some((h) => typeof h.command === 'string' && h.command.includes(GUARD_MARKER));
  if (!present) bash.hooks.unshift({ type: 'command', command: scriptPath });

  backup(configPath);
  writeJson(configPath, obj);
}

/** Remove ONLY the coco guard hook entries; preserve everything else. */
export function removeHookFrom(configPath: string): void {
  const obj = readJson(configPath);
  const pre = obj.hooks?.PreToolUse;
  if (!Array.isArray(pre)) return;
  for (const e of pre) {
    if (Array.isArray(e.hooks)) {
      e.hooks = e.hooks.filter((h) => !(typeof h.command === 'string' && h.command.includes(GUARD_MARKER)));
    }
  }
  // Leave entries in place (even if now empty) — don't touch unrelated pre-existing entries.
  backup(configPath);
  writeJson(configPath, obj);
}

export interface HookInstallPaths {
  cocoBin: string;
  codexHooksJson: string;
  claudeSettings: string;
  codexScript: string;
  claudeScript: string;
}

export function defaultPaths(home: string, cocoBin: string): HookInstallPaths {
  return {
    cocoBin,
    codexHooksJson: join(home, '.codex', 'hooks.json'),
    claudeSettings: join(home, '.claude', 'settings.json'),
    codexScript: join(home, '.codex', 'hooks', 'coco-merge-guard.sh'),
    claudeScript: join(home, '.claude', 'hooks', 'coco-merge-guard.sh'),
  };
}

export function installHooks(p: HookInstallPaths): void {
  // Pre-validate BOTH configs before writing anything — fail closed & atomic-ish
  // (don't write one script/config then throw on the other).
  readJson(p.codexHooksJson);
  readJson(p.claudeSettings);

  for (const s of [p.codexScript, p.claudeScript]) {
    mkdirSync(dirname(s), { recursive: true });
    writeFileSync(s, scriptContent(p.cocoBin));
    chmodSync(s, 0o755);
  }
  mergeHookInto(p.codexHooksJson, p.codexScript);
  mergeHookInto(p.claudeSettings, p.claudeScript);
}

export function uninstallHooks(p: HookInstallPaths): void {
  removeHookFrom(p.codexHooksJson);
  removeHookFrom(p.claudeSettings);
}
