import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonStore } from '../lib/store.mjs'

test('连续原子写入不丢数据并生成 .bak 与每日快照', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-global-memory-'))
  const store = new JsonStore(dir)
  store.write('store.json', { n: 1 })
  store.write('store.json', { n: 2 })
  store.write('store.json', { n: 3 })
  assert.deepEqual(store.read('store.json', {}), { n: 3 })
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'store.json.bak'), 'utf8')), { n: 2 })
  const day = new Date().toISOString().slice(0, 10)
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'backups', `${day}-store.json`), 'utf8')), { n: 1 })
})

test('主文件损坏时恢复 .bak，不静默返回空库', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-global-memory-'))
  const store = new JsonStore(dir)
  store.write('store.json', { memories: [{ id: 'kept' }] })
  store.write('store.json', { memories: [{ id: 'newer' }] })
  writeFileSync(join(dir, 'store.json'), '{broken', 'utf8')
  const recovered = store.read('store.json', { memories: [] })
  assert.equal(recovered.memories[0].id, 'kept')
  assert.equal(JSON.parse(readFileSync(join(dir, 'store.json'), 'utf8')).memories[0].id, 'kept')
})
