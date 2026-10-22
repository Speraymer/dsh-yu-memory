import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

const SELF_MODULES = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '@deepseek-ai')

function roots() {
  const out = []
  const add = (p) => { if (p && !out.includes(p)) out.push(p) }
  add(process.env.DSH_HOST_MODULES)
  const appdata = process.env.APPDATA
  if (appdata) {
    const npm = join(appdata, 'npm', 'node_modules')
    add(join(npm, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'))
    add(join(npm, '@deepseek-ai'))
    try { for (const n of readdirSync(join(npm, '@deepseek-ai'))) add(join(npm, '@deepseek-ai', n, 'node_modules', '@deepseek-ai')) } catch {}
  }
  try {
    const home = process.env.DSH_HOME || join(homedir(), '.dsh')
    for (const p of readdirSync(join(home, 'profiles'))) add(join(home, 'profiles', p, 'node_modules', '@deepseek-ai'))
  } catch {}
  add(SELF_MODULES)
  return out
}

function entry(root, name) {
  try {
    const dir = join(root, name)
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    const dot = pkg.exports?.['.']
    const rel = typeof dot === 'string' ? dot : dot?.import || dot?.default || pkg.module || pkg.main
    const file = rel && join(dir, String(rel).replace(/^\.\//, ''))
    return file && existsSync(file) ? pathToFileURL(file).href : null
  } catch { return null }
}

async function find(name, notes) {
  for (const root of roots()) {
    const url = entry(root, name)
    if (!url) continue
    try { return await import(url) } catch (error) { notes.push(`${name}:${error?.code || 'ERR'}`) }
  }
  try { return await import(`@deepseek-ai/${name}`) } catch { return null }
}

export async function loadHostDeps() {
  const notes = []
  const tools = await find('dsh-tools', notes)
  const llm = await find('dsh-llm', notes)
  const defineTool = tools?.defineTool || ((x) => x)
  const createUserMessage = llm?.createUserMessage || ((p = {}) => ({
    id: randomUUID(), role: 'user', source: p.source, content: Array.isArray(p.content) ? p.content : [],
  }))
  return { defineTool, createUserMessage, notes }
}
