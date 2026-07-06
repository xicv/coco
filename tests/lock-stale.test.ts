import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { expect, test } from 'vitest';
import { withLock } from '../src/lock.js';
import { cocoDir, lockPath } from '../src/paths.js';
import { incidentsPath } from '../src/incidents.js';
import { tmpRepo } from './helpers.js';

function staleLockFile(repo: string): void {
  writeFileSync(
    lockPath(repo),
    JSON.stringify({
      host: hostname(),
      pid: 999999,
      pidStart: 'bogus-start',
      startedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      token: 'forged',
    }),
  );
}

test('re-entrant acquisition by the same live process throws immediately', () => {
  const repo = tmpRepo();
  mkdirSync(cocoDir(repo), { recursive: true });
  expect(() => withLock(repo, () => withLock(repo, () => 1))).toThrow(/lock/i);
});

test('a stale lock (holder dead + old) is broken, and the break is logged', () => {
  const repo = tmpRepo();
  mkdirSync(cocoDir(repo), { recursive: true });
  const stale = {
    host: hostname(),
    pid: 999999, // not a live process
    pidStart: 'bogus-start',
    startedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    token: 'forged',
  };
  writeFileSync(lockPath(repo), JSON.stringify(stale));
  const result = withLock(repo, () => 42);
  expect(result).toBe(42);
  expect(existsSync(lockPath(repo))).toBe(false);
  expect(readFileSync(incidentsPath(repo), 'utf8')).toMatch(/stale-lock-break/);
});

test('withLock releases only its own lock and returns the value', () => {
  const repo = tmpRepo();
  mkdirSync(cocoDir(repo), { recursive: true });
  expect(withLock(repo, () => 7)).toBe(7);
  expect(existsSync(lockPath(repo))).toBe(false);
});

test('withLock creates .coco/ if it does not exist yet (no prior init)', () => {
  const repo = tmpRepo(); // no .coco dir created
  expect(withLock(repo, () => 11)).toBe(11);
});

test('an orphaned break-lock does not deadlock stale recovery', () => {
  const repo = tmpRepo();
  mkdirSync(cocoDir(repo), { recursive: true });
  staleLockFile(repo);
  // a break-lock left behind by a crashed breaker, backdated beyond BREAK_STALE_MS
  const bp = `${lockPath(repo)}.break`;
  writeFileSync(bp, '');
  const old = new Date(Date.now() - 60 * 1000);
  utimesSync(bp, old, old);
  expect(withLock(repo, () => 5)).toBe(5);
  expect(existsSync(lockPath(repo))).toBe(false);
});
