import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { g } from './helpers.js';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsxBin = join(projectRoot, 'node_modules', '.bin', 'tsx');
const entry = join(projectRoot, 'src', 'bin', 'coco-mcp.ts');

test('MCP stdio server exposes coco tools including coco_merge (Layer 2); init+start work', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'coco-mcp-'));
  g(repo, ['init', '-b', 'main']);
  g(repo, ['commit', '--allow-empty', '-m', 'seed']);

  const client = new Client({ name: 'test', version: '0' });
  const transport = new StdioClientTransport({ command: tsxBin, args: [entry] });
  await client.connect(transport);
  try {
    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).toContain('coco_goal_status');
    expect(tools).toContain('coco_goal_record');
    expect(tools).toContain('coco_health');
    expect(tools).toContain('coco_next');
    expect(tools).toContain('coco_done');
    expect(tools).toContain('coco_merge'); // Layer 2: auto-merge, gated server-side by consent + risk-tier

    const init = await client.callTool({ name: 'coco_init', arguments: { repoDir: repo } });
    expect(init.isError).toBeFalsy();

    const start = await client.callTool({ name: 'coco_goal_start', arguments: { repoDir: repo, objective: 'stdio smoke' } });
    const sc = start.structuredContent as { goalId: string; status: { nextAction: string } };
    expect(sc.goalId).toMatch(/^goal-/);
    expect(sc.status.nextAction).toBe('plan');

    // A bad call returns isError and the server process SURVIVES (next call still works).
    const bad = await client.callTool({ name: 'coco_goal_status', arguments: { repoDir: 'not/absolute' } });
    expect(bad.isError).toBe(true);
    const stillAlive = await client.callTool({ name: 'coco_health', arguments: { repoDir: repo } });
    expect(stillAlive.isError).toBeFalsy();
  } finally {
    await client.close();
  }
}, 30000);
