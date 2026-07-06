import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { cocoDir } from './paths.js';

export function incidentsPath(repo: string): string {
  return join(cocoDir(repo), 'incidents.log');
}

/** Append one JSON line to the per-repo incident audit log. */
export function appendIncident(repo: string, kind: string, details: Record<string, unknown>): void {
  mkdirSync(cocoDir(repo), { recursive: true });
  appendFileSync(incidentsPath(repo), `${JSON.stringify({ at: new Date().toISOString(), kind, ...details })}\n`);
}
