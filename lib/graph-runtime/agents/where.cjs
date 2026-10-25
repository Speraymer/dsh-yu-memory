// Where a CLI lives when the process that launched us had no PATH to speak of.
//
// An app opened from the Finder, the Dock or a Start menu inherits a bare PATH
// (/usr/bin:/bin on macOS), while the person's CLIs sit wherever their Node
// version manager put them (nvm, fnm, volta, pnpm, asdf, mise …). A lookup
// therefore walks three lists in order: the process PATH, the PATH a login
// shell would give a terminal (asked once, with a timeout), and the usual
// homes, version managers included. Every lookup returns what it searched,
// so the picker can say where it looked when a runtime is missing.
'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const fsp = fs.promises;
const home = os.homedir();
const isWin = process.platform === 'win32';
const LOGIN_SHELL_MS = 4000;

/** The login shell's PATH (zsh, bash and fish read their rc files there). Asked once; empty on Windows or when the shell is silent. */
let loginPathPromise = null;
function loginPath() {
  if (loginPathPromise) return loginPathPromise;
  loginPathPromise = new Promise((resolve) => {
    if (isWin) return resolve([]);
    const shell = process.env.SHELL || '/bin/zsh';
    const args = /fish$/.test(shell) ? ['-l', '-c', 'string join : $PATH'] : ['-ilc', 'printf "%s" "$PATH"'];
    execFile(shell, args, { timeout: LOGIN_SHELL_MS, env: { ...process.env, TERM: 'dumb' }, maxBuffer: 1 << 16 }, (err, stdout) => {
      if (err) return resolve([]);
      // rc files may print greetings; PATH itself has no newline, so the last line is ours
      const line = String(stdout || '').split('\n').map((s) => s.trim()).filter(Boolean).pop() || '';
      resolve(line.split(path.delimiter).map((d) => d.trim()).filter(Boolean));
    });
  });
  return loginPathPromise;
}

const numeric = (v) => String(v).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
const newestFirst = (a, b) => { const x = numeric(a), y = numeric(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (y[i] || 0) - (x[i] || 0); return 0; };
const versionsUnder = (dir, ...sub) => { try { return fs.readdirSync(dir).sort(newestFirst).map((v) => path.join(dir, v, ...sub)); } catch { return []; } };

/** Where package managers and Node version managers put global binaries. Newest Node first, so a lookup lands on the version the person uses. */
function managerDirs() {
  const dirs = [];
  dirs.push(...versionsUnder(path.join(process.env.NVM_DIR || path.join(home, '.nvm'), 'versions', 'node'), 'bin'));
  for (const base of [process.env.FNM_DIR, path.join(home, '.fnm'), path.join(home, '.local', 'share', 'fnm'), path.join(home, 'Library', 'Application Support', 'fnm')].filter(Boolean)) {
    dirs.push(path.join(base, 'aliases', 'default', 'bin'));
    dirs.push(...versionsUnder(path.join(base, 'node-versions'), 'installation', 'bin'));
  }
  dirs.push(
    path.join(home, '.volta', 'bin'), path.join(process.env.N_PREFIX || path.join(home, 'n'), 'bin'), path.join(home, '.nodenv', 'shims'),
    path.join(home, '.asdf', 'shims'), path.join(home, '.local', 'share', 'mise', 'shims'), path.join(home, '.proto', 'shims'),
    path.join(home, 'Library', 'pnpm'), path.join(home, '.local', 'share', 'pnpm'), path.join(home, '.yarn', 'bin'), path.join(home, '.config', 'yarn', 'global', 'node_modules', '.bin'),
    path.join(home, '.deno', 'bin'), path.join(home, '.cargo', 'bin'), path.join(home, 'bin'),
  );
  if (isWin) {
    const { APPDATA, LOCALAPPDATA, ProgramFiles } = process.env;
    if (APPDATA) dirs.push(path.join(APPDATA, 'npm'));
    if (LOCALAPPDATA) dirs.push(path.join(LOCALAPPDATA, 'pnpm'), path.join(LOCALAPPDATA, 'Volta', 'bin'), path.join(LOCALAPPDATA, 'Programs', 'nvm'));
    if (ProgramFiles) dirs.push(path.join(ProgramFiles, 'nodejs'));
  }
  return dirs;
}

const COMMON_HOMES = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', path.join(home, '.bun', 'bin'), path.join(home, '.npm-global', 'bin'), path.join(home, '.local', 'bin')];

/** Every directory a lookup walks, in order and without repeats. Sync when the login shell has not answered yet. */
function dirsSync(extraHomes, login) {
  const seen = new Set(); const out = [];
  const add = (d) => { if (d && !seen.has(d)) { seen.add(d); out.push(d); } };
  (process.env.PATH || '').split(path.delimiter).forEach(add);
  login.forEach(add);
  [...COMMON_HOMES, ...extraHomes, ...managerDirs()].forEach(add);
  return out;
}
let loginSeen = [];
async function searchDirs(extraHomes = []) {
  loginSeen = await loginPath();
  return dirsSync(extraHomes, loginSeen);
}

async function executable(p) { try { await fsp.access(p, fs.constants.X_OK); return true; } catch { return false; } }

/** The first executable called `name` (Windows tries .cmd and .exe too): `{ path, searched }`, path null when nowhere. */
async function locate(name, extraHomes = []) {
  const names = isWin ? [`${name}.cmd`, `${name}.exe`, name] : [name];
  const searched = await searchDirs(extraHomes);
  for (const d of searched) for (const n of names) { const p = path.join(d, n); if (await executable(p)) return { path: p, searched }; }
  return { path: null, searched };
}

/** The process environment with PATH widened the same way, so a CLI's own tools (git, node, bash) resolve under a Finder launch too. */
function childEnv(extraHomes = []) {
  return { ...process.env, PATH: dirsSync(extraHomes, loginSeen).join(path.delimiter) };
}

module.exports = { locate, childEnv, searchDirs, loginPath };
