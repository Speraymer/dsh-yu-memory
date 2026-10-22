window.__ModuleLoader__.load({
  id: 'dsh-yu-memory',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const API = '/api/dsh-global-memory'
    const json = async (res) => { const body = await res.json(); if (!res.ok) throw new Error(body.error || body.message || `HTTP ${res.status}`); return body }
    const get = (path) => fetch(API + path).then(json)
    const post = (path, body) => fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }).then(json)
    const S = {
      card: { border: '1px solid var(--dsw-border, #e5e7eb)', borderRadius: 10, padding: 14, marginBottom: 12 },
      row: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9, flexWrap: 'wrap' },
      input: { flex: 1, minWidth: 120, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--dsw-border, #d1d5db)', background: 'transparent' },
      btn: { padding: '6px 10px', borderRadius: 6, border: '1px solid var(--dsw-border, #d1d5db)', background: 'transparent', cursor: 'pointer' },
      hint: { fontSize: 12, opacity: 0.65 },
      mono: { fontFamily: 'ui-monospace, monospace', fontSize: 11, opacity: 0.7 },
    }

    function Panel() {
      const [status, setStatus] = React.useState(null)
      const [items, setItems] = React.useState({ memories: [], deleted: [] })
      const [traces, setTraces] = React.useState([])
      const [query, setQuery] = React.useState('')
      const [message, setMessage] = React.useState('')
      const [error, setError] = React.useState('')
      const load = async () => {
        try {
          setError('')
          const [s, m, t] = await Promise.all([get('/status'), get('/memories?q=' + encodeURIComponent(query)), get('/traces')])
          setStatus(s); setItems(m); setTraces(t.traces || [])
        } catch (e) { setError(e.message) }
      }
      React.useEffect(() => { load() }, [])
      if (!status) return h('div', { style: { padding: 12 } }, error ? '出错了：' + error : '加载中…')
      const cfg = status.config
      const updateCfg = (patch) => setStatus({ ...status, config: { ...cfg, ...patch } })
      const save = async () => { try { const r = await post('/config', cfg); setStatus({ ...status, config: r.config }); setMessage('设置已保存') } catch (e) { setError(e.message) } }
      const edit = async (m) => {
        const text = window.prompt('记忆正文', m.text)
        if (text == null) return
        const subject = window.prompt('主体：user / self / relationship / shared / world', m.subject || 'shared')
        if (subject == null) return
        const factKey = window.prompt('事实键（可留空）', m.factKey || '')
        if (factKey == null) return
        try { await post('/edit', { id: m.id, text, subject, factKey }); await load() } catch (e) { setError(e.message) }
      }
      const del = async (m) => {
        if (!window.confirm('软删除这条记忆？之后可恢复。')) return
        try { await post('/delete', { id: m.id }); await load() } catch (e) { setError(e.message) }
      }
      const revive = async (m) => { try { await post('/restore', { id: m.id }); await load() } catch (e) { setError(e.message) } }
      const enrich = async (id) => { try { const r = await post('/enrich', id ? { id } : {}); setMessage(`已开始补全 ${r.started} 条（失败不会自动重试）`); setTimeout(load, 1200) } catch (e) { setError(e.message) } }
      const setPolicy = (key) => (e) => updateCfg({ policy: { ...cfg.policy, [key]: Number(e.target.value) } })

      const memoryRow = (m, deleted) => h('div', { key: m.id, style: { ...S.card, marginBottom: 8, padding: 10, opacity: m.supersededBy ? 0.6 : 1 } },
        h('div', { style: { fontSize: 13, whiteSpace: 'pre-wrap' } }, m.text),
        h('div', { style: { ...S.hint, marginTop: 5 } }, `${m.subject || '待确认'} · ${m.kind} · 重要度 ${m.importance} · ${m.factKey || '无事实键'}${m.needsReview ? ' · 待检查主体' : ''}${m.supersededBy ? ' · 已取代' : ''} · 补全 ${m.enrichment?.status || '未知'}`),
        h('div', { style: { ...S.row, marginTop: 7, marginBottom: 0 } },
          deleted ? h('button', { style: S.btn, onClick: () => revive(m) }, '恢复') : [
            h('button', { key: 'e', style: S.btn, onClick: () => edit(m) }, '编辑'),
            h('button', { key: 'x', style: S.btn, onClick: () => del(m) }, '软删除'),
            h('button', { key: 'r', style: S.btn, onClick: () => enrich(m.id) }, '补检索词'),
          ]),
      )

      return h('div', { style: { padding: '4px 2px' } },
        error ? h('div', { style: { ...S.card, color: '#b91c1c' } }, error) : null,
        h('div', { style: S.card },
          h('div', { style: { fontWeight: 600, marginBottom: 6 } }, '鱼的记忆'),
          h('div', { style: S.hint }, '默认对普通新对话开启；子代理、headless、自动化后台任务和归档对话不会挂载。人格负责“我是谁”，这里负责“我经历过什么”。数据以明文 JSON 保存在本机 ~/.dsh/global-memory/。'),
          h('div', { style: { ...S.row, marginTop: 10 } },
            h('label', null, h('input', { type: 'checkbox', checked: !!cfg.enabled, onChange: (e) => updateCfg({ enabled: e.target.checked }) }), ' 总开关'),
            h('label', null, h('input', { type: 'checkbox', checked: !!cfg.autoEnrich, onChange: (e) => updateCfg({ autoEnrich: e.target.checked }) }), ' 保存后异步补检索词')),
          h('div', { style: S.row }, h('span', { style: S.hint }, '模型（可选 provider/model）'), h('input', { style: S.input, value: cfg.llmModel || '', placeholder: '留空跟随当前会话', onChange: (e) => updateCfg({ llmModel: e.target.value }) })),
          h('div', { style: S.row },
            h('span', { style: S.hint }, '每日新增'), h('input', { style: { ...S.input, maxWidth: 80 }, type: 'number', min: 1, value: cfg.policy.dailyQuota, onChange: setPolicy('dailyQuota') }),
            h('span', { style: S.hint }, '每轮条数'), h('input', { style: { ...S.input, maxWidth: 80 }, type: 'number', min: 1, value: cfg.policy.maxItems, onChange: setPolicy('maxItems') }),
            h('span', { style: S.hint }, '字数'), h('input', { style: { ...S.input, maxWidth: 90 }, type: 'number', min: 100, value: cfg.policy.maxChars, onChange: setPolicy('maxChars') })),
          h('div', { style: S.row },
            h('span', { style: S.hint }, '召回门槛'), h('input', { style: { ...S.input, maxWidth: 90 }, type: 'number', min: 0, step: 0.05, value: cfg.policy.threshold, onChange: setPolicy('threshold') }),
            h('span', { style: S.hint }, '事件半衰期/天'), h('input', { style: { ...S.input, maxWidth: 90 }, type: 'number', min: 1, value: cfg.policy.baseHalfLifeDays, onChange: setPolicy('baseHalfLifeDays') })),
          h('div', { style: S.row }, h('button', { style: S.btn, onClick: save }, '保存设置'), h('button', { style: S.btn, onClick: () => enrich() }, '重跑待补全'), message ? h('span', { style: S.hint }, message) : null)),
        h('div', { style: S.card },
          h('div', { style: { fontWeight: 600, marginBottom: 6 } }, `对话记忆（${status.chat?.count || 0} 条）`),
          h('div', { style: S.hint }, '每个会话自己记的短期上下文：每轮自动记一条，不调用模型；越久没被想起来越淡（不删，只是越来越难召回）。被反复想起的条目会提示提炼进上面的长期记忆。'),
          h('div', { style: S.row },
            h('label', null, h('input', { type: 'checkbox', checked: !!(cfg.chat && cfg.chat.enabled), onChange: (e) => updateCfg({ chat: { ...cfg.chat, enabled: e.target.checked } }) }), ' 打开'),
            h('span', { style: S.hint }, '半衰期/天'), h('input', { style: { ...S.input, maxWidth: 80 }, type: 'number', min: 1, value: cfg.chat?.halfLifeDays ?? 3, onChange: (e) => updateCfg({ chat: { ...cfg.chat, halfLifeDays: Number(e.target.value) } }) }),
            h('span', { style: S.hint }, '每轮带几条'), h('input', { style: { ...S.input, maxWidth: 80 }, type: 'number', min: 1, value: cfg.chat?.maxInject ?? 6, onChange: (e) => updateCfg({ chat: { ...cfg.chat, maxInject: Number(e.target.value) } }) })),
          h('div', { style: S.row }, h('button', { style: S.btn, onClick: save }, '保存设置'))),
        status.sessions.length ? h('div', { style: S.card },
          h('div', { style: { fontWeight: 600, marginBottom: 8 } }, '单会话排除'),
          ...status.sessions.map((s) => h('label', { key: s.id, style: { ...S.row, justifyContent: 'space-between' } },
            h('span', null, s.title, h('span', { style: S.hint }, ` · ${s.eligible ? '已挂载' : '未挂载'}`)),
            h('input', { type: 'checkbox', checked: !!s.excluded, onChange: async (e) => { try { await post('/session', { id: s.id, excluded: e.target.checked }); await load() } catch (x) { setError(x.message) } } })))) : null,
        h('div', { style: S.card },
          h('div', { style: S.row }, h('div', { style: { fontWeight: 600 } }, `记忆（${items.memories.length}）`), h('input', { style: S.input, value: query, placeholder: '搜索正文、主体、分类、标签或事实键', onChange: (e) => setQuery(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') load() } }), h('button', { style: S.btn, onClick: load }, '搜索')),
          ...items.memories.map((m) => memoryRow(m, false))),
        h('details', { style: S.card }, h('summary', null, `已删除（${items.deleted.length}，均可恢复）`), h('div', { style: { marginTop: 10 } }, ...items.deleted.map((m) => memoryRow(m, true)))),
        h('details', { style: S.card }, h('summary', null, `最近召回记录（${traces.length}）`),
          ...traces.map((t, i) => h('div', { key: i, style: { borderTop: '1px solid var(--dsw-border, #e5e7eb)', paddingTop: 8, marginTop: 8 } },
            h('div', { style: S.hint }, new Date(t.at).toLocaleString() + ` · 注入 ${t.picked?.length || 0} 条`),
            h('div', { style: S.mono }, `query=${t.query || ''}`),
            h('div', { style: S.mono }, (t.rows || []).map((r) => `${r.id.slice(0, 8)} C=${r.C} P=${r.P}${r.omission ? ' ' + r.omission : ''}`).join(' · '))))),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const slots = ctx.get('slots')
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'global-memory', order: 41, label: '鱼的记忆' },
          () => h(Panel),
        ))
      },
    }
  },
})
