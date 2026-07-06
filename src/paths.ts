import { join } from 'node:path';

export function cocoDir(repo: string): string {
  return join(repo, '.coco');
}
export function goalsDir(repo: string): string {
  return join(cocoDir(repo), 'goals');
}
export function lockPath(repo: string): string {
  return join(cocoDir(repo), 'lock');
}
