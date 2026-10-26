import test from 'node:test'
import assert from 'node:assert/strict'
import { isGraphInjected, sourceKindOf } from '../lib/source.mjs'

// 2026-10-27：记忆图那层已经删掉了，但 index.js 里还留着"画布注入要走旁路"的判定代码
// （现在永远不会触发）。这条测试守着这个判定本身别被改坏 —— 万一哪天把画布装回来，
// 注入消息必须还带自己的来源标记，不能冒充真人消息。
test('记忆图注入的判定认来源标记，不认正文', () => {
  const direct = { source: { kind: 'plugin:dsh-yu-memory-graph' } }
  const wrapped = { message: direct }
  assert.equal(sourceKindOf(wrapped), 'plugin:dsh-yu-memory-graph')
  assert.equal(isGraphInjected(wrapped), true)
  assert.equal(isGraphInjected({ source: { kind: 'user' } }), false)
})
