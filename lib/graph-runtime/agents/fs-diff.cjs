// What changed on disk during a turn, for any runtime: a snapshot of the
// working directory before the prompt and after the turn; the difference is
// what the turn changed, whatever tool did it. Bounded; bulk directories
// are skipped.
'use strict';
const path = require('node:path');
const fsp = require('node:fs/promises');

const SKIP_DIRS = new Set(['.git', 'node_modules', '.memory-graph', 'dist', 'build', 'target', '.venv', 'venv', '__pycache__', '.cache', '.next', '.turbo', 'out', 'coverage']);
const SNAPSHOT_MAX_FILES = 20000;
const SNAPSHOT_MAX_DEPTH = 12;

async function snapshotDir(root) {
  const files = new Map();
  let truncated = false;
  const walk = async (dir, depth) => {
    if (truncated || depth > SNAPSHOT_MAX_DEPTH) return;
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (truncated) return;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) await walk(p, depth + 1); continue; }
      if (!e.isFile()) continue;
      try { const st = await fsp.stat(p); files.set(p, `${st.mtimeMs}:${st.size}`); } catch { /* vanished */ }
      if (files.size >= SNAPSHOT_MAX_FILES) truncated = true;
    }
  };
  await walk(root, 0);
  return { files, truncated };
}

function diffSnapshots(before, after) {
  const changed = []; const added = []; const removed = [];
  for (const [p, sig] of after.files) {
    const prev = before.files.get(p);
    if (prev === undefined) added.push(p); else if (prev !== sig) changed.push(p);
  }
  for (const p of before.files.keys()) if (!after.files.has(p)) removed.push(p);
  return { changed, added, removed, truncated: before.truncated || after.truncated };
}


module.exports = { snapshotDir, diffSnapshots };
