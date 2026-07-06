import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { installWatchdog, listWatchdogs, renderPlist, uninstallWatchdog, watchdogLabel } from '../src/commands/watchdog.js';
import { main } from '../src/cli.js';
import { tmpRepo } from './helpers.js';

const home = () => mkdtempSync(join(tmpdir(), 'coco-home-'));

test('watchdogLabel is stable per repo and unique across repos', () => {
  const a = tmpRepo();
  const b = tmpRepo();
  expect(watchdogLabel(a)).toBe(watchdogLabel(a));
  expect(watchdogLabel(a)).not.toBe(watchdogLabel(b));
  expect(watchdogLabel(a)).toMatch(/^com\.coco\.watch\.[0-9a-f]{16}$/);
});

test('renderPlist embeds the watch invocation + interval', () => {
  const p = renderPlist({ label: 'com.coco.watch.abc', repo: '/r', intervalMin: 15, staleMin: 30, nodeBin: '/n', cocoBin: '/c/coco.js', logDir: '/l' });
  expect(p).toContain('<key>StartInterval</key><integer>900</integer>');
  expect(p).toContain('<string>--repo</string>');
  expect(p).toContain('<string>/r</string>');
  expect(p).toContain('<string>watch</string>');
  expect(p).toContain('RunAtLoad');
});

test('install writes a plist and bootstraps via launchctl, idempotently', () => {
  const h = home();
  const repo = tmpRepo();
  const calls: string[][] = [];
  const run = (a: string[]) => calls.push(a);

  const r = installWatchdog({ repo, home: h, cocoBin: '/c/coco.js', intervalMin: 10, runLaunchctl: run });
  expect(existsSync(r.plist)).toBe(true);
  expect(calls.some((c) => c[0] === 'bootstrap')).toBe(true);

  installWatchdog({ repo, home: h, cocoBin: '/c/coco.js', runLaunchctl: run }); // second run
  expect(calls.filter((c) => c[0] === 'bootout').length).toBeGreaterThanOrEqual(1); // unloads prior first
});

test('list reflects installed watchdogs; uninstall removes only that one', () => {
  const h = home();
  const repo = tmpRepo();
  const run = () => {};
  installWatchdog({ repo, home: h, cocoBin: '/c/coco.js', runLaunchctl: run });

  const list = listWatchdogs(h);
  expect(list).toHaveLength(1);
  expect(list[0].repo).toBe(realpathSync(repo));
  expect(list[0].intervalSec).toBe(30 * 60);

  const u = uninstallWatchdog({ repo, home: h, runLaunchctl: run });
  expect(u.removed).toBe(true);
  expect(listWatchdogs(h)).toHaveLength(0);
});

test('install refuses a non-git directory', () => {
  const h = home();
  const notRepo = mkdtempSync(join(tmpdir(), 'coco-nonrepo-'));
  expect(() => installWatchdog({ repo: notRepo, home: h, cocoBin: '/c/coco.js', runLaunchctl: () => {} })).toThrow(/git/);
});

test('listWatchdogs XML-decodes repo paths', () => {
  const h = home();
  const laDir = join(h, 'Library', 'LaunchAgents');
  mkdirSync(laDir, { recursive: true });
  const label = 'com.coco.watch.deadbeef00000000';
  writeFileSync(join(laDir, `${label}.plist`), renderPlist({ label, repo: '/r/a & b < c > d', intervalMin: 5, staleMin: 30, nodeBin: '/n', cocoBin: '/c', logDir: '/l' }));
  expect(listWatchdogs(h)[0].repo).toBe('/r/a & b < c > d');
});

test('uninstall by --label removes even if the repo path is gone', () => {
  const h = home();
  const repo = tmpRepo();
  const r = installWatchdog({ repo, home: h, cocoBin: '/c', runLaunchctl: () => {} });
  const u = uninstallWatchdog({ label: r.label, home: h, runLaunchctl: () => {} });
  expect(u.removed).toBe(true);
  expect(listWatchdogs(h)).toHaveLength(0);
});

test('install-watchdog rejects a non-numeric/zero interval (before any launchctl)', () => {
  // error path only — never reaches installWatchdog/launchctl
  expect(main(['install-watchdog', '--interval-min', 'abc'])).toBe(1);
  expect(main(['install-watchdog', '--interval-min', '0'])).toBe(1);
  expect(main(['install-watchdog', '--stale-min', '-5'])).toBe(1);
});
