import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { packageRoot } from '../version.js';

export interface SetupCodexAction {
  action: string;
  target: string;
  status: 'present' | 'would-write' | 'written' | 'would-copy' | 'copied' | 'missing-source' | 'skipped';
  detail?: string;
}

export interface SetupCodexReport {
  applied: boolean;
  configPath: string;
  skillsDir: string;
  actions: SetupCodexAction[];
}

const COCO_MCP_BLOCK = `[mcp_servers.coco]\ncommand = "coco-mcp"\nargs = []\n`;
const ORACLE_HINT = `\n# Oracle is required for coco-loop plan/review gates. Configure your local Oracle MCP separately.\n# [mcp_servers.oracle]\n# command = "oracle"\n# args = ["mcp"]\n`;

function uncommentedHasBlock(raw: string, block: string): boolean {
  const uncommented = raw.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  return uncommented.includes(`[mcp_servers.${block}]`);
}

function skillsSource(): string | null {
  const root = packageRoot();
  if (!root) return null;
  const src = join(root, 'skills');
  return existsSync(src) ? src : null;
}

export function setupCodex(opts: { apply?: boolean; home?: string; configPath?: string; skillsDir?: string } = {}): SetupCodexReport {
  const home = opts.home ?? homedir();
  const apply = opts.apply === true;
  const configPath = resolve(opts.configPath ?? join(home, '.codex', 'config.toml'));
  const skillsDir = resolve(opts.skillsDir ?? join(home, '.agents', 'skills'));
  const actions: SetupCodexAction[] = [];

  const configExists = existsSync(configPath);
  const configRaw = configExists ? readFileSync(configPath, 'utf8') : '';
  if (uncommentedHasBlock(configRaw, 'coco')) {
    actions.push({ action: 'codex-mcp-config', target: configPath, status: 'present', detail: 'coco MCP block already configured' });
  } else {
    const next = `${configRaw}${configRaw && !configRaw.endsWith('\n') ? '\n' : ''}\n${COCO_MCP_BLOCK}${uncommentedHasBlock(configRaw, 'oracle') ? '' : ORACLE_HINT}`;
    if (apply) {
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, next);
      actions.push({ action: 'codex-mcp-config', target: configPath, status: 'written', detail: 'added coco MCP block' });
    } else {
      actions.push({ action: 'codex-mcp-config', target: configPath, status: 'would-write', detail: 'would add coco MCP block' });
    }
  }

  const src = skillsSource();
  if (!src) {
    actions.push({ action: 'skills', target: skillsDir, status: 'missing-source', detail: 'package skills directory not found' });
  } else {
    const names = readdirSync(src).filter((name) => {
      try {
        return statSync(join(src, name)).isDirectory();
      } catch {
        return false;
      }
    });
    if (!names.length) actions.push({ action: 'skills', target: skillsDir, status: 'missing-source', detail: 'no skill directories found' });
    for (const name of names) {
      const from = join(src, name);
      const to = join(skillsDir, name);
      if (apply) {
        mkdirSync(skillsDir, { recursive: true });
        cpSync(from, to, { recursive: true, force: true });
        actions.push({ action: 'skill-sync', target: to, status: 'copied', detail: `synced ${name}` });
      } else {
        actions.push({ action: 'skill-sync', target: to, status: existsSync(to) ? 'present' : 'would-copy', detail: `${name}${existsSync(to) ? ' already present' : ' would be copied'}` });
      }
    }
  }

  return { applied: apply, configPath, skillsDir, actions };
}
