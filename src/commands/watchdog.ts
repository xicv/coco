import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const LABEL_PREFIX = 'com.coco.watch.';
const STABLE_NODE = '/opt/homebrew/opt/node@24/bin/node';
const AGENT_PATH = '/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';

function canonical(repo: string): string {
  try {
    return realpathSync(repo);
  } catch {
    return repo;
  }
}

/** Stable per-repo LaunchAgent label (hash of the canonical repo path). */
export function watchdogLabel(repo: string): string {
  return LABEL_PREFIX + createHash('sha256').update(canonical(repo)).digest('hex').slice(0, 16);
}

/** Prefer the stable Homebrew opt symlink over the version-pinned Cellar path. */
export function nodeBin(): string {
  return existsSync(STABLE_NODE) ? STABLE_NODE : process.execPath;
}

function xml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function unxml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&'); // decode &amp; LAST
}

export interface WatchdogSpec {
  label: string;
  repo: string;
  intervalMin: number;
  staleMin: number;
  nodeBin: string;
  cocoBin: string;
  logDir: string;
}

export function renderPlist(s: WatchdogSpec): string {
  const args = [s.nodeBin, s.cocoBin, 'watch', '--repo', s.repo, '--stale-min', String(s.staleMin)];
  const argXml = args.map((a) => `    <string>${xml(a)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xml(s.label)}</string>
  <key>ProgramArguments</key>
  <array>
${argXml}
  </array>
  <key>WorkingDirectory</key><string>${xml(s.repo)}</string>
  <key>StartInterval</key><integer>${s.intervalMin * 60}</integer>
  <key>RunAtLoad</key><true/>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
  <key>StandardOutPath</key><string>${xml(join(s.logDir, `${s.label}.out.log`))}</string>
  <key>StandardErrorPath</key><string>${xml(join(s.logDir, `${s.label}.err.log`))}</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${AGENT_PATH}</string></dict>
</dict>
</plist>
`;
}

export type LaunchctlRunner = (args: string[]) => void;
const defaultLaunchctl: LaunchctlRunner = (args) => {
  execFileSync('launchctl', args, { stdio: 'ignore' });
};

function uid(): string {
  return String(process.getuid?.() ?? 0);
}
function launchAgentsDir(home: string): string {
  return join(home, 'Library', 'LaunchAgents');
}

export interface InstallWatchdogOpts {
  repo: string;
  intervalMin?: number;
  staleMin?: number;
  home?: string;
  cocoBin: string;
  runLaunchctl?: LaunchctlRunner;
}

export function installWatchdog(o: InstallWatchdogOpts): { label: string; plist: string; intervalMin: number } {
  const home = o.home ?? homedir();
  let repo: string;
  try {
    repo = realpathSync(o.repo);
  } catch {
    throw new Error(`coco: repo does not exist: ${o.repo}`);
  }
  if (!existsSync(join(repo, '.git'))) throw new Error(`coco: not a git repository: ${repo}`);

  const label = watchdogLabel(repo);
  const laDir = launchAgentsDir(home);
  const logDir = join(home, '.coco-logs');
  mkdirSync(laDir, { recursive: true });
  mkdirSync(logDir, { recursive: true });
  const plist = join(laDir, `${label}.plist`);
  const intervalMin = o.intervalMin ?? 30;
  writeFileSync(
    plist,
    renderPlist({ label, repo, intervalMin, staleMin: o.staleMin ?? 30, nodeBin: nodeBin(), cocoBin: o.cocoBin, logDir }),
  );

  const run = o.runLaunchctl ?? defaultLaunchctl;
  try {
    run(['bootout', `gui/${uid()}/${label}`]); // idempotent: unload a prior instance
  } catch {
    // not currently loaded
  }
  try {
    run(['enable', `gui/${uid()}/${label}`]); // recover from a persisted `launchctl disable`
  } catch {
    // ignore
  }
  run(['bootstrap', `gui/${uid()}`, plist]);
  return { label, plist, intervalMin };
}

export function uninstallWatchdog(o: { repo?: string; label?: string; home?: string; runLaunchctl?: LaunchctlRunner }): { label: string; removed: boolean } {
  if (!o.repo && !o.label) throw new Error('coco: uninstall-watchdog needs --repo or --label');
  const home = o.home ?? homedir();
  const label = o.label ?? watchdogLabel(o.repo as string);
  const plist = join(launchAgentsDir(home), `${label}.plist`);
  const run = o.runLaunchctl ?? defaultLaunchctl;
  try {
    run(['bootout', `gui/${uid()}/${label}`]);
  } catch {
    // not loaded
  }
  const removed = existsSync(plist);
  if (removed) unlinkSync(plist);
  return { label, removed };
}

export interface WatchdogInfo {
  label: string;
  repo: string;
  nodeBin: string;
  nodeExists: boolean;
  intervalSec: number;
}

export function listWatchdogs(home = homedir()): WatchdogInfo[] {
  const laDir = launchAgentsDir(home);
  if (!existsSync(laDir)) return [];
  const out: WatchdogInfo[] = [];
  for (const f of readdirSync(laDir)) {
    if (!f.startsWith(LABEL_PREFIX) || !f.endsWith('.plist')) continue;
    const xmlText = readFileSync(join(laDir, f), 'utf8');
    const pa = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(xmlText)?.[1] ?? '';
    const args = [...pa.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => unxml(m[1]));
    const ri = args.indexOf('--repo');
    const nb = args[0] ?? '';
    const interval = /<key>StartInterval<\/key>\s*<integer>(\d+)<\/integer>/.exec(xmlText)?.[1];
    out.push({
      label: f.replace(/\.plist$/, ''),
      repo: ri >= 0 ? (args[ri + 1] ?? '') : '',
      nodeBin: nb,
      nodeExists: nb !== '' && existsSync(nb),
      intervalSec: interval ? Number(interval) : 0,
    });
  }
  return out;
}
