import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function packageRoot(start = dirname(fileURLToPath(import.meta.url))): string | null {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function cocoVersion(): string {
  try {
    const root = packageRoot();
    if (!root) return 'unknown';
    const v = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: string }).version;
    return v || 'unknown';
  } catch {
    return 'unknown';
  }
}
