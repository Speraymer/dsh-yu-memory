// A Pi extension the desktop shell loads into every run it starts
// (`pi -e <this file>`). One rule: the working directory is the boundary.
// A tool call that reaches outside it — a read, write or edit by path, a
// bash command naming a path elsewhere — asks the person first; in rpc
// mode that question travels to the canvas and comes back as an
// approval. Denied means the call is blocked with a reason the model
// sees. Paths the system owns (/usr, /bin, /dev, /tmp…) pass: a command
// that runs /usr/bin/env is not an excursion.
//
// The canvas tunes the rule through <cwd>/.memory-graph/guard.json, read on
// every call so a change takes effect mid-run:
//   { "mode": "ask" | "allow", "allow": ["/a/directory", …] }
// `allow` mode asks nothing; a path under an allowed directory passes.
import { resolve, sep, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync, statSync } from 'node:fs';

const SYSTEM_PREFIXES = ['/dev/', '/usr/', '/bin/', '/sbin/', '/opt/', '/etc/', '/tmp/', '/private/tmp/', '/private/var/', '/var/', '/System/', '/Library/', '/Applications/', '/proc/'];
/** the separator between the human message and the structured tail of a confirm */
const TAIL = '␟';

function expand(p, cwd) {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return resolve(homedir(), p.slice(2));
  return resolve(cwd, p);
}

const inside = (abs, root) => abs === root || abs.startsWith(root + sep);
const systemOwned = (abs) => SYSTEM_PREFIXES.some((pre) => abs.startsWith(pre));

/** Paths a bash command names: absolute ones, ~ ones, and cd targets. */
function pathsInCommand(command, cwd) {
  const out = new Set();
  const text = String(command ?? '');
  for (const m of text.matchAll(/(?:^|[\s=:'"(])((?:~|\/)[^\s'"`;|&)<>]*)/g)) out.add(expand(m[1], cwd));
  for (const m of text.matchAll(/(?:^|[;&|]\s*|\s)cd\s+([^\s;|&]+)/g)) out.add(expand(m[1].replace(/^['"]|['"]$/g, ''), cwd));
  return [...out];
}

function pathsOf(event, cwd) {
  const input = event.input ?? {};
  switch (event.toolName) {
    case 'bash': return pathsInCommand(input.command, cwd);
    case 'read': case 'write': case 'edit': case 'ls': case 'grep': case 'find':
      return typeof input.path === 'string' && input.path ? [expand(input.path, cwd)] : [];
    default: return [];
  }
}

function config(cwd) {
  try {
    const raw = JSON.parse(readFileSync(join(cwd, '.memory-graph', 'guard.json'), 'utf8'));
    return { mode: raw?.mode === 'allow' ? 'allow' : 'ask', allow: Array.isArray(raw?.allow) ? raw.allow.filter((x) => typeof x === 'string' && x.startsWith('/')).map((x) => resolve(x)) : [] };
  } catch { return { mode: 'ask', allow: [] }; }
}

/** The directory to offer as "allow this location": the path itself when
 *  it is a directory, else its parent; several paths → their common parent. */
function suggestion(paths) {
  const dirs = paths.map((p) => { try { return statSync(p).isDirectory() ? p : dirname(p); } catch { return dirname(p); } });
  let common = dirs[0].split(sep);
  for (const d of dirs.slice(1)) { const parts = d.split(sep); let i = 0; while (i < common.length && i < parts.length && common[i] === parts[i]) i++; common = common.slice(0, i); }
  const dir = common.join(sep) || sep;
  return dir === sep ? dirs[0] : dir;
}

export default function (pi) {
  pi.on('tool_call', async (event, ctx) => {
    const root = resolve(ctx.cwd);
    const cfg = config(root);
    if (cfg.mode === 'allow') return;
    const outside = pathsOf(event, root).filter((p) => !inside(p, root) && !systemOwned(p) && !cfg.allow.some((a) => inside(p, a)));
    if (outside.length === 0) return;
    const where = outside.slice(0, 3).join(', ') + (outside.length > 3 ? ` (+${outside.length - 3})` : '');
    if (!ctx.hasUI) return { block: true, reason: `outside the working directory (${where}); nobody to ask` };
    const detail = event.toolName === 'bash' ? String(event.input?.command ?? '') : where;
    const tail = TAIL + JSON.stringify({ paths: outside, suggest: suggestion(outside) });
    const ok = await ctx.ui.confirm(`${event.toolName} outside the working directory`, detail + tail);
    if (!ok) return { block: true, reason: `the person did not allow ${event.toolName} outside the working directory (${where})` };
  });
}
