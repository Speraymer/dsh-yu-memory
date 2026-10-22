import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export class CorruptStoreError extends Error {}

export class JsonStore {
  constructor(root) {
    this.root = root
    this.backups = join(root, 'backups')
    mkdirSync(this.backups, { recursive: true })
  }
  path(name) { return join(this.root, name) }
  read(name, fallback) {
    const file = this.path(name)
    if (!existsSync(file)) return structuredClone(fallback)
    try { return JSON.parse(readFileSync(file, 'utf8')) }
    catch (first) {
      const bak = file + '.bak'
      if (existsSync(bak)) {
        try {
          const recovered = JSON.parse(readFileSync(bak, 'utf8'))
          this.write(name, recovered, Date.now(), false)
          return recovered
        } catch {}
      }
      throw new CorruptStoreError(`${name} 已损坏且 .bak 无法恢复：${first.message}`)
    }
  }
  write(name, value, now = Date.now(), backupCurrent = true) {
    const file = this.path(name)
    mkdirSync(this.root, { recursive: true })
    if (backupCurrent && existsSync(file)) {
      copyFileSync(file, file + '.bak')
      const day = new Date(now).toISOString().slice(0, 10)
      const daily = join(this.backups, `${day}-${basename(name)}`)
      if (!existsSync(daily)) copyFileSync(file, daily)
    }
    const temp = join(this.root, `.${basename(name)}.${process.pid}.${randomUUID()}.tmp`)
    writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8')
    try { renameSync(temp, file) }
    catch {
      copyFileSync(temp, file)
      renameSync(temp, join(this.backups, `recovered-write-${Date.now()}-${basename(name)}`))
    }
  }
}
