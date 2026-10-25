// Opening a runner's session in the person's terminal, in plain Node: the
// command each runner resumes with, the terminals we know how to launch on
// each platform, and one call that picks the first available. The desktop
// shell adds its own preferences on top; a host without preferences takes
// the first terminal that exists.
'use strict';
const path = require('node:path');
const os = require('node:os');
const fsp = require('node:fs/promises');
const { spawn } = require('node:child_process');

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const fileExists = (p) => fsp.access(p).then(() => true, () => false);
const dirExists = async (p) => { try { return (await fsp.stat(p)).isDirectory(); } catch { return false; } };

/** The command that resumes a session in each runner's own CLI. */
const PROGRAMS = {
  'claude-code': (id) => `claude --resume ${shq(id)}`,
  codex: (id) => `codex resume ${shq(id)}`,
  pi: (id) => `pi --session ${shq(id)}`,
};

const run = (bin, args) => new Promise((resolve) => {
  const c = spawn(bin, args, { stdio: 'ignore', detached: process.platform === 'linux' });
  c.on('error', () => resolve(false));
  c.on('exit', (code) => resolve(code === 0));
  if (process.platform === 'linux') c.unref();
});

async function binOnPath(name) {
  for (const d of (process.env.PATH || '').split(path.delimiter)) {
    if (d && await fileExists(path.join(d, name))) return true;
  }
  return false;
}

// macOS: a .command file runs in the user's default shell (right PATH,
// zero automation permissions) inside any terminal app that accepts it.
async function launchCommandFile(appPath, cwd, program) {
  const file = path.join(os.tmpdir(), `memory-graph-resume-${Date.now()}.command`);
  try {
    await fsp.writeFile(file, `#!/bin/zsh\nrm -- ${shq(file)}\ncd ${shq(cwd)}\n${program}\n`, { mode: 0o755 });
  } catch { return false; }
  return run('open', ['-a', appPath, file]);
}
const launchOpenArgs = (appPath, argv) => run('open', ['-na', appPath, '--args', ...argv]);
const posix = (cwd, program) => ['-lc', `cd ${shq(cwd)} && ${program}`];

/** The terminals this platform can launch, in preference order. */
function buildTerminalRegistry(customTerminals = []) {
  if (process.platform === 'darwin') {
    const appEntry = (id, name, appPath, launch) => ({ id, name, probe: () => dirExists(appPath), launch });
    return [
      appEntry('terminal', 'Terminal', '/System/Applications/Utilities/Terminal.app', (cwd, p) => launchCommandFile('/System/Applications/Utilities/Terminal.app', cwd, p)),
      appEntry('iterm', 'iTerm2', '/Applications/iTerm.app', (cwd, p) => launchCommandFile('/Applications/iTerm.app', cwd, p)),
      appEntry('ghostty', 'Ghostty', '/Applications/Ghostty.app', (cwd, p) => launchOpenArgs('/Applications/Ghostty.app', ['-e', 'zsh', ...posix(cwd, p)])),
      appEntry('warp', 'Warp', '/Applications/Warp.app', (cwd, p) => launchCommandFile('/Applications/Warp.app', cwd, p)),
      appEntry('alacritty', 'Alacritty', '/Applications/Alacritty.app', (cwd, p) => launchOpenArgs('/Applications/Alacritty.app', ['-e', 'zsh', ...posix(cwd, p)])),
      appEntry('kitty', 'kitty', '/Applications/kitty.app', (cwd, p) => launchOpenArgs('/Applications/kitty.app', ['zsh', ...posix(cwd, p)])),
      appEntry('wezterm', 'WezTerm', '/Applications/WezTerm.app', (cwd, p) => launchOpenArgs('/Applications/WezTerm.app', ['start', '--', 'zsh', ...posix(cwd, p)])),
      // user-picked terminal apps ride the .command road — the one macOS
      // mechanism that needs nothing from the app but "opens shell scripts"
      ...customTerminals.map((c) => ({ id: c.id, name: c.name, custom: true, probe: () => dirExists(c.app), launch: (cwd, p) => launchCommandFile(c.app, cwd, p) })),
    ];
  }
  if (process.platform === 'win32') {
    const wtPath = path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WindowsApps', 'wt.exe');
    return [
      { id: 'wt', name: 'Windows Terminal', probe: async () => (await fileExists(wtPath)) || binOnPath('wt.exe'), launch: (cwd, p) => run('wt.exe', ['-d', cwd, 'cmd', '/k', p]) },
      { id: 'powershell', name: 'PowerShell', probe: async () => true, launch: (cwd, p) => run('cmd', ['/c', 'start', '', 'powershell', '-NoExit', '-Command', `Set-Location -LiteralPath '${cwd.replace(/'/g, "''")}'; ${p}`]) },
      { id: 'cmd', name: 'Command Prompt', probe: async () => true, launch: (cwd, p) => run('cmd', ['/c', 'start', '', 'cmd', '/k', `cd /d "${cwd}" && ${p}`]) },
    ];
  }
  // linux: binaries on PATH, each with its documented cwd/exec flags
  const bin = (id, name, argv) => ({ id, name, probe: () => binOnPath(id), launch: (cwd, p) => run(id, argv(cwd, p)) });
  return [
    bin('gnome-terminal', 'GNOME Terminal', (cwd, p) => ['--working-directory', cwd, '--', 'bash', ...posix(cwd, p)]),
    bin('konsole', 'Konsole', (cwd, p) => ['--workdir', cwd, '-e', 'bash', ...posix(cwd, p)]),
    bin('xfce4-terminal', 'Xfce Terminal', (cwd, p) => [`--working-directory=${cwd}`, '-x', 'bash', ...posix(cwd, p)]),
    bin('ghostty', 'Ghostty', (cwd, p) => ['-e', 'bash', ...posix(cwd, p)]),
    bin('alacritty', 'Alacritty', (cwd, p) => ['--working-directory', cwd, '-e', 'bash', ...posix(cwd, p)]),
    bin('kitty', 'kitty', (cwd, p) => ['--directory', cwd, 'bash', ...posix(cwd, p)]),
    bin('wezterm', 'WezTerm', (cwd, p) => ['start', '--cwd', cwd, '--', 'bash', ...posix(cwd, p)]),
    bin('x-terminal-emulator', 'System terminal', (cwd, p) => ['-e', `bash -lc ${shq(`cd ${shq(cwd)} && ${p}`)}`]),
  ];
}

/** Open a runner's session in a terminal: the preferred one, else the first
 *  that exists. Returns what the atlas expects. */
async function openInTerminal(runner, cwd, sessionId, { preferred = '', customTerminals = [] } = {}) {
  const buildProgram = PROGRAMS[runner];
  if (!buildProgram || !/^[\w.-]{4,}$/.test(String(sessionId))) return { opened: false, via: '', command: '' };
  const dir = typeof cwd === 'string' && path.isAbsolute(cwd) && await dirExists(cwd) ? cwd : os.homedir();
  const program = buildProgram(sessionId);
  const command = `cd ${shq(dir)} && ${program}`;
  const registry = buildTerminalRegistry(customTerminals);
  const ordered = [...registry.filter((t) => t.id === preferred), ...registry.filter((t) => t.id !== preferred)];
  for (const t of ordered) {
    if (!(await t.probe().catch(() => false))) continue;
    if (await t.launch(dir, program)) return { opened: true, via: 'terminal', command, terminal: t.id };
  }
  return { opened: false, via: '', command };
}

module.exports = { PROGRAMS, shq, run, binOnPath, launchCommandFile, launchOpenArgs, posix, buildTerminalRegistry, openInTerminal, dirExists, fileExists };
