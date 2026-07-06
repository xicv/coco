import { execFileSync } from 'node:child_process';
import { platform } from 'node:os';

/**
 * Build the AppleScript for a notification. Pure + testable. Escapes backslashes and quotes
 * and flattens newlines so title/message can't break out of the quoted string. (execFileSync
 * runs osascript with no shell, so `$()`/backticks are inert already.)
 */
export function appleScript(title: string, message: string): string {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ');
  return `display notification "${esc(message)}" with title "${esc(title)}"`;
}

/** Post a macOS notification (osascript). No-op with a reason on non-macOS. */
export function notify(title: string, message: string): { ok: boolean; reason?: string } {
  if (platform() !== 'darwin') return { ok: false, reason: 'notify is only supported on macOS' };
  try {
    execFileSync('osascript', ['-e', appleScript(title, message)], { stdio: 'ignore' });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}
