import { execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { lockPath } from './paths.js';
import { appendIncident } from './incidents.js';

const STALE_MS = 15 * 60 * 1000; // consider a dead holder's lock stale after 15 min
const BREAK_STALE_MS = 30 * 1000; // a break-lock older than this is an orphan (breaker crashed)

/** Age of the break-lock file in ms; Infinity if it's already gone. */
function breakLockAgeMs(path: string): number {
  try {
    return Date.now() - statSync(path).mtimeMs;
  } catch {
    return Infinity;
  }
}

interface LockInfo {
  host: string;
  pid: number;
  pidStart: string;
  startedAt: string;
  token: string;
}

/** Process start time as an identity string; '' if the pid is not alive. */
function procStart(pid: number): string {
  try {
    return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function readLock(path: string): LockInfo | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as LockInfo;
  } catch {
    return null;
  }
}

function holderAlive(info: LockInfo): boolean {
  if (info.host !== hostname()) return true; // can't verify a remote holder → treat as alive
  const start = procStart(info.pid);
  return start !== '' && start === info.pidStart;
}

/** Non-mutating lock status for `coco health` (never breaks anything). */
export function lockStatus(path: string, now = Date.now()): { held: boolean; stale: boolean; info: LockInfo | null } {
  const info = readLock(path);
  if (!info) return { held: false, stale: false, info: null };
  if (holderAlive(info)) return { held: true, stale: false, info };
  return { held: false, stale: now - Date.parse(info.startedAt) > STALE_MS, info };
}

function acquire(path: string, token: string): void {
  const fd = openSync(path, 'wx'); // O_CREAT|O_EXCL
  const info: LockInfo = {
    host: hostname(),
    pid: process.pid,
    pidStart: procStart(process.pid),
    startedAt: new Date().toISOString(),
    token,
  };
  try {
    writeSync(fd, JSON.stringify(info));
  } finally {
    closeSync(fd);
  }
}

function sleepBackoff(attempt: number): void {
  const ms = Math.min(25 * 2 ** attempt, 500);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); // synchronous sleep
}

/** Exclusive lock with stale-holder auto-break (serialized) and own-token release. */
export function withLock<T>(repo: string, fn: () => T, opts: { retries?: number } = {}): T {
  const path = lockPath(repo);
  mkdirSync(dirname(path), { recursive: true }); // ensure .coco/ exists before locking
  const breakPath = `${path}.break`;
  const token = randomBytes(8).toString('hex');
  const retries = opts.retries ?? 15;

  for (let attempt = 0; ; attempt++) {
    try {
      acquire(path, token);
      break; // acquired
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;

      const st = lockStatus(path);
      // Re-entrant deadlock by this very LIVE process → fail fast, don't spin.
      // Match pidStart too, so a reused PID from a dead prior holder falls through to stale-break.
      if (
        st.info &&
        st.info.host === hostname() &&
        st.info.pid === process.pid &&
        st.info.pidStart === procStart(process.pid)
      ) {
        throw new Error('coco: lock already held by this process (.coco/lock)');
      }
      if (st.held) {
        if (attempt >= retries) throw new Error('coco: lock held by a live process (.coco/lock)');
        sleepBackoff(attempt);
        continue;
      }
      if (st.stale) {
        // Serialize the break so two breakers can't clobber a fresh acquire.
        let bfd: number;
        try {
          bfd = openSync(breakPath, 'wx');
        } catch {
          // Another breaker holds it — or it was orphaned by a crashed breaker.
          if (breakLockAgeMs(breakPath) > BREAK_STALE_MS) {
            try {
              unlinkSync(breakPath);
            } catch {
              // raced with another recoverer
            }
            continue; // retry immediately
          }
          if (attempt >= retries) throw new Error('coco: stale-lock break contended too long (.coco/lock.break)');
          sleepBackoff(attempt);
          continue;
        }
        try {
          const again = lockStatus(path);
          if (again.stale && again.info) {
            appendIncident(repo, 'stale-lock-break', { pid: again.info.pid, startedAt: again.info.startedAt, token: again.info.token });
            try {
              unlinkSync(path);
            } catch {
              // already gone
            }
          }
        } finally {
          closeSync(bfd);
          try {
            unlinkSync(breakPath);
          } catch {
            // ignore
          }
        }
        continue; // retry acquire
      }
      // holder gone but not yet old enough → wait
      if (attempt >= retries) throw new Error('coco: lock recently released; retry');
      sleepBackoff(attempt);
    }
  }

  try {
    return fn();
  } finally {
    const cur = readLock(path);
    if (cur?.token === token) {
      try {
        unlinkSync(path);
      } catch {
        // already gone
      }
    }
  }
}
