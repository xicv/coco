import { createHash } from 'node:crypto';
import { z } from 'zod';

/** A resource/memory card in the coco-store knowledge base (the CEO/PM layer). Modeled on gproj.
 * Required: id, type, title, body, timestamp. Everything else is optional discovery/ownership
 * metadata. `visibility` defaults to "local" — local cards never leave the machine (§5.4). */
export const resourceCardSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1), // e.g. spec | doc | sop | api | decision
  title: z.string().min(1),
  body: z.string(),
  timestamp: z.string(), // ISO
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  owns: z
    .object({
      symbols: z.array(z.string()).optional(),
      endpoints: z.array(z.string()).optional(),
      configKeys: z.array(z.string()).optional(),
    })
    .optional(),
  intent: z.string().optional(),
  links: z.array(z.object({ rel: z.enum(['defines', 'references', 'relates-to', 'depends-on']), to: z.string() })).optional(),
  excerpt: z.string().optional(),
  sourcePaths: z.array(z.string()).optional(),
  contentHash: z.string().optional(),
  kind: z.enum(['debug', 'research', 'feature', 'reference']).optional(),
  visibility: z.enum(['local', 'shared']).default('local'),
});

export type ResourceCard = z.infer<typeof resourceCardSchema>;

/** Parse + normalize an untrusted card (from disk or input); throws on invalid shape. */
export function parseCard(raw: unknown): ResourceCard {
  return resourceCardSchema.parse(raw);
}

/** sha256 of the body — dedupe + change detection. */
export function contentHashOf(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

/** A URL/file-safe slug of the title. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'card';
}

/** Stable id = slug(title) + short body hash — same title+body → same id (idempotent add). */
export function makeCardId(title: string, body: string): string {
  return `${slugify(title)}-${contentHashOf(body).slice(0, 8)}`;
}
