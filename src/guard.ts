export interface GuardDecision {
  block: boolean;
  reason?: string;
  op?: string;
}

/**
 * Split a shell command into command segments on UNQUOTED separators
 * (`;` `\n` `&&` `||` `|`), honoring single/double quotes and backslash escapes so a
 * separator inside a quoted arg (e.g. a commit message) never creates a bogus segment.
 */
export function splitSegments(command: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === '\\' && q !== "'" && i + 1 < command.length) {
      cur += c + command[++i]; // keep escape verbatim for the tokenizer
      continue;
    }
    if (q) {
      cur += c;
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      cur += c;
      continue;
    }
    if (c === '\n' || c === ';') {
      out.push(cur);
      cur = '';
      continue;
    }
    if ((c === '&' && command[i + 1] === '&') || (c === '|' && command[i + 1] === '|')) {
      out.push(cur);
      cur = '';
      i++;
      continue;
    }
    if (c === '|') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

/** Shell-ish tokenizer: single/double quotes, backslash escapes, drop unquoted trailing comment. */
export function tokenize(segment: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let has = false;
  let q: '"' | "'" | null = null;
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (q) {
      if (c === q) {
        q = null;
        has = true;
      } else if (c === '\\' && q === '"' && i + 1 < segment.length) {
        cur += segment[++i];
        has = true;
      } else {
        cur += c;
        has = true;
      }
    } else if (c === '\\' && i + 1 < segment.length) {
      cur += segment[++i];
      has = true;
    } else if (c === '"' || c === "'") {
      q = c;
      has = true;
    } else if (c === '#') {
      break;
    } else if (/\s/.test(c)) {
      if (has) {
        tokens.push(cur);
        cur = '';
        has = false;
      }
    } else {
      cur += c;
      has = true;
    }
  }
  if (has) tokens.push(cur);
  return tokens;
}

const RESUME = new Set(['--abort', '--continue', '--quit']);
// git global options that consume the FOLLOWING token as a value.
const VALUE_OPTS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env']);

/** Destination of a push refspec resolves to `base`? Handles `+`, `src:dst`, `refs/heads/`, bare `HEAD`. */
function refLandsOnBase(ref: string, base: string, currentBranch: string | null): boolean {
  const r = ref.replace(/^\+/, '');
  let dst = r.includes(':') ? r.slice(r.indexOf(':') + 1) : r;
  dst = dst.replace(/^refs\/heads\//, '');
  if (dst === 'HEAD') dst = currentBranch ?? ''; // `git push origin HEAD` pushes the current branch
  return dst === base;
}

function classifyPush(rest: string[], base: string, currentBranch: string | null): string | null {
  // --mirror / --all push ALL branches (incl. base), regardless of current branch.
  if (rest.some((t) => t === '--mirror' || t === '--all')) return 'git push --mirror/--all';

  const positionals: string[] = [];
  let del = false;
  for (const t of rest) {
    if (t === '--delete' || t === '-d') {
      del = true;
      continue;
    }
    if (t.startsWith('-')) continue; // ignore --force / -f / --force-with-lease / -u / …
    positionals.push(t);
  }
  const refspecs = positionals.slice(1); // positionals[0] is the remote (any name)
  if (del) {
    return refspecs.some((r) => r.replace(/^refs\/heads\//, '') === base) ? `git push --delete ${base}` : null;
  }
  if (refspecs.length === 0) {
    // bare `git push` / `git push <remote>`: pushes the current branch to its upstream
    return currentBranch === base ? `git push (${base})` : null;
  }
  return refspecs.some((r) => refLandsOnBase(r, base, currentBranch)) ? `git push ${base}` : null;
}

/** Given ONE command's argv tokens, is it a raw op landing changes on `base`? Pure. */
export function classifyOp(tokens: string[], base: string, currentBranch: string | null): string | null {
  if (tokens.length === 0) return null;
  if (tokens[0] === 'gh' && tokens[1] === 'pr' && tokens[2] === 'merge') return 'gh pr merge';
  if (tokens[0] !== 'git') return null;

  let i = 1;
  while (i < tokens.length && tokens[i].startsWith('-')) {
    i += VALUE_OPTS.has(tokens[i]) ? 2 : 1;
  }
  const sub = tokens[i];
  const rest = tokens.slice(i + 1);

  if (sub === 'merge') return rest.some((t) => RESUME.has(t)) ? null : 'git merge';
  if (sub === 'pull') return currentBranch === base ? `git pull (onto ${base})` : null;
  if (sub === 'push') return classifyPush(rest, base, currentBranch);
  return null;
}
