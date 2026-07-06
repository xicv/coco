import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { storeAdd, storeFind, storeGroup, storeInit, storeLink, storeList, storePack, storeProgress, storePromote, storeRoadmap, storeShow, storeViz, type GroupBy, type LinkRel } from './commands.js';
import type { ResourceCard } from './schema.js';

function repoRoot(cwd = process.cwd()): string {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim() || cwd;
  } catch {
    return cwd;
  }
}
function out(o: unknown): void {
  process.stdout.write(`${JSON.stringify(o, null, 2)}\n`);
}
function csv(v?: string): string[] | undefined {
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const repo = repoRoot();
  const [cmd, ...rest] = argv;
  try {
    if (cmd === 'init') {
      out(storeInit(repo));
      return 0;
    }
    if (cmd === 'add') {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          title: { type: 'string' }, body: { type: 'string' }, type: { type: 'string' }, category: { type: 'string' },
          tags: { type: 'string' }, intent: { type: 'string' }, kind: { type: 'string' }, visibility: { type: 'string' },
          'owns-symbol': { type: 'string', multiple: true }, 'owns-endpoint': { type: 'string', multiple: true }, 'owns-config': { type: 'string', multiple: true },
        },
      });
      out(storeAdd(repo, {
        title: values.title, body: values.body, file: positionals[0], type: values.type, category: values.category,
        tags: csv(values.tags), intent: values.intent, kind: values.kind as ResourceCard['kind'],
        visibility: values.visibility as 'local' | 'shared' | undefined,
        ownsSymbols: values['owns-symbol'], ownsEndpoints: values['owns-endpoint'], ownsConfig: values['owns-config'],
      }));
      return 0;
    }
    if (cmd === 'list') {
      const { values } = parseArgs({ args: rest, options: { 'group-by': { type: 'string' }, sort: { type: 'string' } } });
      // presence via !== undefined so an empty value (`--sort=` / `--group-by=`) is REJECTED, not silently ignored
      if (values.sort !== undefined && values.sort !== 'title' && values.sort !== 'timestamp') throw new Error('coco-store list: --sort must be title|timestamp');
      const sort = values.sort as 'title' | 'timestamp' | undefined;
      if (values['group-by'] !== undefined) {
        if (!['category', 'type', 'kind', 'tag'].includes(values['group-by'])) throw new Error('coco-store list: --group-by must be category|type|kind|tag');
        out(storeGroup(repo, { by: values['group-by'] as GroupBy, sort }));
      } else {
        out(storeList(repo, { sort }));
      }
      return 0;
    }
    if (cmd === 'show') {
      const { positionals } = parseArgs({ args: rest, allowPositionals: true });
      if (!positionals[0]) throw new Error('usage: coco-store show <id>');
      out(storeShow(repo, positionals[0]));
      return 0;
    }
    if (cmd === 'find') {
      const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { limit: { type: 'string' } } });
      if (!positionals.length) throw new Error('usage: coco-store find <query>');
      out(storeFind(repo, positionals.join(' '), values.limit ? Number(values.limit) : undefined));
      return 0;
    }
    if (cmd === 'pack') {
      const { values } = parseArgs({ args: rest, options: { goal: { type: 'string' }, query: { type: 'string' }, budget: { type: 'string' } } });
      if (!values.goal) throw new Error('usage: coco-store pack --goal <id> [--query <q>] [--budget <bytes>]');
      out(storePack(repo, { goalId: values.goal, query: values.query, budgetBytes: values.budget ? Number(values.budget) : undefined }));
      return 0;
    }
    if (cmd === 'link') {
      const { values } = parseArgs({ args: rest, options: { from: { type: 'string' }, to: { type: 'string' }, rel: { type: 'string' } } });
      if (!values.from || !values.to || !values.rel) throw new Error('usage: coco-store link --from <id> --to <id> --rel defines|references|relates-to|depends-on');
      out(storeLink(repo, { from: values.from, to: values.to, rel: values.rel as LinkRel }));
      return 0;
    }
    if (cmd === 'progress') {
      out(storeProgress(repo));
      return 0;
    }
    if (cmd === 'viz') {
      out(storeViz(repo));
      return 0;
    }
    if (cmd === 'roadmap') {
      const { values } = parseArgs({ args: rest, options: { append: { type: 'string' } } });
      out(storeRoadmap(repo, { append: values.append }));
      return 0;
    }
    if (cmd === 'promote') {
      const { values } = parseArgs({ args: rest, options: { id: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, priority: { type: 'string' }, 'depends-on': { type: 'string' }, spec: { type: 'string' } } });
      if (!values.id || !values.title) throw new Error('usage: coco-store promote --id <id> --title <title> [--body <b>] [--priority high|medium|low] [--depends-on a,b] [--spec <spec-id>]');
      out(storePromote(repo, { id: values.id, title: values.title, body: values.body, priority: values.priority as 'high' | 'medium' | 'low' | undefined, dependsOn: csv(values['depends-on']), specId: values.spec }));
      return 0;
    }
    process.stderr.write(`coco-store: unknown command '${cmd ?? ''}'\n`);
    return 2;
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return 1;
  }
}
