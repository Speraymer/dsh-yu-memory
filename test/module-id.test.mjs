import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

// 2026-10-23 加：包名改了、前端注册名没改，会让 DSH 卡在 Loading plugins（重复注册）。
// 以后改包名，这里必须同时绿。⚠️ 只认真正的调用，不认注释里的示例。
const 根 = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(根, 'package.json'), 'utf8'))
const 候选 = ['client.js', 'lib/client.js'].map((f) => join(根, f)).filter(existsSync)
const 真调用 = /^window\.__ModuleLoader__\.load\(\{\s*\r?\n\s*id:\s*'([^']+)'/gm

test('前端注册 id 必须等于包名', () => {
  assert.ok(候选.length, '找不到 client.js')
  let 找到 = 0
  for (const f of 候选) {
    const t = readFileSync(f, 'utf8')
    for (const m of t.matchAll(真调用)) {
      找到 += 1
      assert.equal(m[1], pkg.name, f + ' 的 load.id=' + m[1] + ' 与包名 ' + pkg.name + ' 不一致')
    }
  }
  assert.ok(找到 > 0, '没有找到真正的 __ModuleLoader__.load({ id: ... }) 注册点')
})

test('记忆图整层删除后，前端只挂「鱼的记忆」设置页', () => {
  const source = readFileSync(join(根, 'client.js'), 'utf8')
  let definition
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load(value) { definition = value } } },
  })
  const plugin = definition.factory((id) => id === 'react' ? {} : undefined)
  assert.deepEqual([...plugin.inject], ['slots'])
  assert.match(source, /settings\.section/)
  // 2026-10-27：主动那层（记忆图）已整层删除，前端不该再留任何挂载点或死代码。
  assert.doesNotMatch(source, /applyMemoryGraph|memory-graph/)
})
