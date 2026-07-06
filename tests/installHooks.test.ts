import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { GUARD_MARKER, defaultPaths, installHooks, uninstallHooks } from '../src/commands/installHooks.js';

interface HookEntry { matcher?: string; hooks?: { command?: string }[] }

function seed(home: string): void {
  mkdirSync(join(home, '.codex'), { recursive: true });
  mkdirSync(join(home, '.claude'), { recursive: true });
  const existing = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/x/rtk-rewrite.sh' }] }] } };
  writeFileSync(join(home, '.codex', 'hooks.json'), JSON.stringify(existing, null, 2));
  writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash'] }, ...existing }, null, 2));
}
function cmds(cfg: string): string[] {
  const obj = JSON.parse(readFileSync(cfg, 'utf8')) as { hooks: { PreToolUse: HookEntry[] } };
  return obj.hooks.PreToolUse.flatMap((e) => (e.hooks ?? []).map((h) => h.command ?? ''));
}

test('install adds the guard FIRST, preserves existing hooks, and is idempotent', () => {
  const home = mkdtempSync(join(tmpdir(), 'coco-home-'));
  seed(home);
  const p = defaultPaths(home, '/coco/dist/coco.js');
  installHooks(p);
  installHooks(p); // second run must not duplicate

  for (const cfg of [p.codexHooksJson, p.claudeSettings]) {
    const list = cmds(cfg);
    expect(list.filter((c) => c.includes(GUARD_MARKER))).toHaveLength(1);
    expect(list[0]).toContain(GUARD_MARKER); // runs before rewrite hooks
    expect(list).toContain('/x/rtk-rewrite.sh'); // existing preserved
  }
  // unrelated settings keys preserved
  expect(JSON.parse(readFileSync(p.claudeSettings, 'utf8')).permissions.allow).toContain('Bash');
  expect(existsSync(p.codexScript)).toBe(true);
  expect(readFileSync(p.codexScript, 'utf8')).toContain('guard-hook');
  expect(existsSync(`${p.codexHooksJson}.coco-bak`)).toBe(true); // backup made
});

test('uninstall removes only the coco guard, preserving other hooks', () => {
  const home = mkdtempSync(join(tmpdir(), 'coco-home-'));
  seed(home);
  const p = defaultPaths(home, '/coco/dist/coco.js');
  installHooks(p);
  uninstallHooks(p);
  for (const cfg of [p.codexHooksJson, p.claudeSettings]) {
    const list = cmds(cfg);
    expect(list.some((c) => c.includes(GUARD_MARKER))).toBe(false);
    expect(list).toContain('/x/rtk-rewrite.sh');
  }
});

test('install fails closed (throws, no partial write) when a config is invalid JSON', () => {
  const home = mkdtempSync(join(tmpdir(), 'coco-home-'));
  mkdirSync(join(home, '.codex'), { recursive: true });
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.codex', 'hooks.json'), '{}');
  writeFileSync(join(home, '.claude', 'settings.json'), '{ not valid json');
  const p = defaultPaths(home, '/coco/dist/coco.js');
  expect(() => installHooks(p)).toThrow(/unparseable/);
  expect(existsSync(p.codexScript)).toBe(false); // nothing written before the throw
});

test('install works when the config file does not exist yet', () => {
  const home = mkdtempSync(join(tmpdir(), 'coco-home2-'));
  const p = defaultPaths(home, '/coco/dist/coco.js');
  installHooks(p);
  const obj = JSON.parse(readFileSync(p.codexHooksJson, 'utf8')) as { hooks: { PreToolUse: HookEntry[] } };
  expect(obj.hooks.PreToolUse[0].hooks?.[0].command).toContain(GUARD_MARKER);
});
