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

    function applyMemoryGraph(ctx) {
      const currentSession = () => {
        const snapshot = ctx.sessions.list.getSnapshot()
        const id = snapshot.current
        if (id === undefined) return null
        const session = snapshot.byId[id]
        return session === undefined ? null : { id, title: session.displayTitle ?? null, cwd: session.cwd ?? null }
      }

      const CSS_ID = 'dsh-yu-memory-graph/client.css'
      let style = document.head.querySelector(`style[data-plugin-css="${CSS_ID}"]`)
      if (!style) {
        style = document.createElement('style')
        style.setAttribute('data-plugin', 'dsh-yu-memory-graph')
        style.setAttribute('data-plugin-css', CSS_ID)
        document.head.append(style)
      }
      style.textContent = '.dsh-td-page{display:block;width:100%;height:100%;min-height:100%;box-sizing:border-box}html[data-platform="darwin"] .dsh-td-page{padding-top:var(--dsh-frame-top-clearance,0px)}.dsh-td-overlay{position:fixed;z-index:100;background:#faf9f7}.dsh-td-overlay[hidden]{display:none}.dsh-td-overlay iframe{display:block;width:100%;height:100%;border:0}.dsh-td-overlay.dsh-td-full{inset:var(--dsh-frame-top-clearance,0px) 0 0 0}.dsh-td-switch{position:fixed;z-index:120;top:12px;left:60%;display:flex;align-items:center;gap:2px;transform:translateX(-50%);-webkit-app-region:no-drag;border:1px solid #d1d5db;border-radius:999px;background:rgba(255,255,255,.96);padding:3px;backdrop-filter:blur(10px)}.dsh-td-switch button{height:28px;border:0;border-radius:999px;background:transparent;padding:0 11px;color:#6b7280;font:600 12px Inter,system-ui,sans-serif;cursor:pointer;white-space:nowrap}.dsh-td-switch button:hover{background:#f3f4f6;color:#111827}.dsh-td-switch button.active{background:#111827;color:#fff}.dsh-td-switch .dsh-td-mark{display:inline-block;width:8px;height:8px;border-radius:50%;background:#6d5dfc;box-shadow:0 -7px 0 #a99cff,0 7px 0 #f0a35a;margin:0 6px 0 8px;flex:none}.dsh-td-switch[hidden]{display:none}html[data-platform] .dsh-td-switch,html[data-windows-titlebar] .dsh-td-switch{top:max(2px,calc((var(--dsh-frame-top-clearance,40px) - 36px) / 2))}.dsh-td-bar{position:fixed;z-index:121;top:0;left:0;right:0;height:var(--dsh-frame-top-clearance,0px);display:flex;align-items:center;gap:14px;padding:0 16px;box-sizing:border-box;background:#faf9f7;border-bottom:1px solid #e7e2d9;font:500 12px Inter,system-ui,sans-serif;color:#6b7280;overflow:hidden;-webkit-app-region:drag;user-select:none}.dsh-td-bar[hidden]{display:none}html[data-platform="darwin"] .dsh-td-bar{padding-left:max(var(--dsh-frame-leading-clearance,0px),84px)}html[data-windows-titlebar] .dsh-td-bar{padding-right:calc(100% - env(titlebar-area-width,100%) + 16px)}.dsh-td-bar .dsh-td-brand{display:flex;align-items:center;gap:7px;color:#111827;font-weight:600;font-size:13px;white-space:nowrap}.dsh-td-bar .dsh-td-brand i{display:inline-block;width:8px;height:8px;border-radius:50%;background:#6d5dfc;box-shadow:0 -7px 0 #a99cff,0 7px 0 #f0a35a}.dsh-td-bar .dsh-td-switch{position:static;transform:none;-webkit-app-region:no-drag}.dsh-td-bar .dsh-td-title{min-width:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#6b7280}'

      let host = document.body.querySelector(':scope > [data-dsh-yu-memory-graph]')
      if (!host) {
        host = document.createElement('div')
        host.setAttribute('data-dsh-yu-memory-graph', '')
        document.body.append(host)
      }
      host.innerHTML = '<div class="dsh-td-switch" role="group" aria-label="view switch" hidden><i class="dsh-td-mark" title="记忆图"></i><button type="button" data-view="dialog" class="active" aria-pressed="true">对话</button><button type="button" data-view="map" aria-pressed="false">思维图</button></div><div class="dsh-td-bar" data-window-drag hidden><span class="dsh-td-brand"><i></i>记忆图</span><div class="dsh-td-switch" role="group" aria-label="view switch"><button type="button" data-view="dialog" aria-pressed="false">对话</button><button type="button" data-view="map" class="active" aria-pressed="true">思维图</button></div><span class="dsh-td-title"></span></div><section class="dsh-td-overlay" hidden><iframe title="记忆图" data-src="/memory-graph/"></iframe></section>'

      let pluginVersion = null
      fetch('/memory-graph/api/version').then(r => (r.ok ? r.json() : null)).then(j => { if (j && typeof j.version === 'string') pluginVersion = j.version }).catch(() => {})

      const switchEl = host.querySelector(':scope > .dsh-td-switch')
      const bar = host.querySelector('.dsh-td-bar')
      const barTitle = bar.querySelector('.dsh-td-title')
      const dialogBtn = host.querySelector('[data-view="dialog"]')
      const mapBtn = host.querySelector('[data-view="map"]')
      const overlay = host.querySelector('.dsh-td-overlay')
      const frame = host.querySelector('iframe')
      const desktop = () => document.documentElement.dataset.platform !== undefined || document.documentElement.hasAttribute('data-windows-titlebar')
      const strip = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dsh-frame-top-clearance')) || 0
      const send = (type, payload) => frame.contentWindow?.postMessage({ source: 'dsh-yu-memory-graph', type, ...payload }, location.origin)
      const syncCurrent = () => send('td:current-session', { session: currentSession() })
      const ensureSrc = () => { if (!frame.src) frame.src = frame.dataset.src + (pluginVersion ? (frame.dataset.src.includes('?') ? '&' : '?') + 'dv=' + encodeURIComponent(pluginVersion) : '') }

      const PANEL_ID = 'memory-graph'
      const NS = 'dsh-yu-memory-graph'
      let panelMode = false
      let pageEl = null
      let pageObserver = null
      const place = () => {
        if (!pageEl) return
        let box = pageEl
        for (let i = 0; i < 3 && box.getBoundingClientRect().height < 40 && box.parentElement; i++) box = box.parentElement
        const r = box.getBoundingClientRect()
        const pad = box === pageEl ? parseFloat(getComputedStyle(pageEl).paddingTop) || 0 : 0
        overlay.style.left = r.left + 'px'
        overlay.style.top = (r.top + pad) + 'px'
        overlay.style.width = r.width + 'px'
        overlay.style.height = Math.max(0, r.height - pad) + 'px'
      }
      const openPanel = el => {
        pageEl = el
        ensureSrc()
        overlay.classList.remove('dsh-td-full')
        overlay.hidden = false
        place()
        pageObserver = new ResizeObserver(place)
        pageObserver.observe(el)
        if (el.parentElement) pageObserver.observe(el.parentElement)
        syncCurrent()
        send('td:view', { shown: true, bar: false, desktop: desktop(), panel: true })
        window.setTimeout(() => { if (pageEl) { syncCurrent(); send('td:view', { shown: true, bar: false, desktop: desktop(), panel: true }) } }, 400)
      }
      const closePanel = () => {
        pageEl = null
        pageObserver?.disconnect()
        pageObserver = null
        overlay.hidden = true
        send('td:view', { shown: false, bar: false, desktop: desktop(), panel: true })
      }
      let registered = false
      if (React && ctx.slots && ctx.layout && ctx.locale && typeof ctx.effect === 'function') {
        try {
          const h = React.createElement
          const PanelIcon = ({ size }) => h('svg', { width: size ?? 16, height: size ?? 16, viewBox: '0 0 16 16', 'aria-hidden': 'true' },
            h('circle', { cx: 8, cy: 3, r: 2.2, fill: '#a99cff' }),
            h('circle', { cx: 8, cy: 8, r: 2.2, fill: '#6d5dfc' }),
            h('circle', { cx: 8, cy: 13, r: 2.2, fill: '#f0a35a' }))
          const PanelPage = () => {
            const ref = React.useRef(null)
            React.useEffect(() => {
              if (ref.current) openPanel(ref.current)
              return () => closePanel()
            }, [])
            return h('div', { ref, className: 'dsh-td-page', 'data-td-page': '' })
          }
          ctx.effect(() => ctx.locale.register(NS, { zh: { panel: '记忆图' }, en: { panel: '记忆图' } }), 'dsh-yu-memory-graph: dictionaries')
          const t = ctx.locale.bind(NS)
          ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS, inject: () => ({}) }, PanelPage))
          ctx.slots.inject('sidebar.panellist', () => { const dispose = ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 30, locale: NS, label: () => t('panel') }, PanelIcon); registered = true; return dispose })
          panelMode = true
        } catch (error) {
          console.warn('[dsh-yu-memory-graph] panel entry unavailable, using the floating switch:', error)
          panelMode = false
        }
      }

      let spaReady = false
      const barUp = () => !panelMode && document.documentElement.dataset.platform === 'darwin' && strip() > 0
      const setView = map => {
        dialogBtn.classList.toggle('active', !map)
        dialogBtn.setAttribute('aria-pressed', String(!map))
        mapBtn.classList.toggle('active', map)
        mapBtn.setAttribute('aria-pressed', String(map))
      }
      const closeFallback = () => { overlay.hidden = true; bar.hidden = true; switchEl.hidden = false; setView(false); send('td:view', { shown: false, bar: false, desktop: desktop() }) }
      const showBand = () => { bar.hidden = !barUp(); send('td:view', { shown: true, bar: !bar.hidden, desktop: desktop() }) }
      const openFallback = () => {
        overlay.classList.add('dsh-td-full')
        overlay.style.left = overlay.style.top = overlay.style.width = overlay.style.height = ''
        overlay.hidden = false
        setView(true)
        bar.hidden = !barUp()
        if (spaReady || !bar.hidden) switchEl.hidden = true
        ensureSrc()
        syncCurrent()
        showBand()
        window.setTimeout(() => { syncCurrent(); showBand() }, 400)
      }
      let fallbackOn = false
      const enableFallback = () => {
        if (fallbackOn) return
        fallbackOn = true
        panelMode = false
        switchEl.hidden = false
        window.addEventListener('resize', () => { if (!overlay.hidden) showBand() })
        bar.querySelector('[data-view="dialog"]').addEventListener('click', closeFallback)
        mapBtn.addEventListener('click', openFallback)
        dialogBtn.addEventListener('click', closeFallback)
      }
      if (!panelMode) enableFallback()
      else window.setTimeout(() => { if (!registered) { console.warn('[dsh-yu-memory-graph] no sidebar panel list on this host, using the floating switch'); enableFallback() } }, 2500)

      const close = () => { if (panelMode) { try { ctx.layout.selectPanel(null) } catch { closePanel() } } else closeFallback() }

      window.addEventListener('message', event => {
        if (event.origin !== location.origin || event.data?.source !== 'dsh-yu-memory-graph') return
        if (event.data.type === 'td:close') return close()
        if (event.data.type === 'td:pick-cwd') {
          const requestId = event.data.requestId
          const pick = ctx.uiWorkspace?.pickDirectory
          if (typeof pick !== 'function') return send('td:picked-cwd', { requestId, path: null, unsupported: true })
          Promise.resolve(pick.call(ctx.uiWorkspace))
            .then(path => send('td:picked-cwd', { requestId, path: typeof path === 'string' ? path : null }))
            .catch(() => send('td:picked-cwd', { requestId, path: null, unsupported: true }))
          return
        }
        if (event.data.type === 'td:request-current') {
          spaReady = true
          if (!panelMode && !overlay.hidden) { switchEl.hidden = true; showBand() }
          if (panelMode && pageEl) send('td:view', { shown: true, bar: false, desktop: desktop(), panel: true })
          return syncCurrent()
        }
        if (event.data.type === 'td:title') { barTitle.textContent = typeof event.data.name === 'string' ? event.data.name : ''; return }
        if (event.data.type === 'td:select-session' && typeof event.data.session === 'string') {
          const select = ctx.sessions.open ?? ctx.sessions.select
          select.call(ctx.sessions, event.data.session)
          if (event.data.close !== false) close()
          syncCurrent()
        }
      })
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
        h('div', { style: S.card },
          h('div', { style: { fontWeight: 600, marginBottom: 6 } }, '一起用（另外七个）'),
          h('div', { style: S.hint }, '八个插件各管一段：人格、记忆、三个内容源、心情、两个出口。装哪个都不影响别的，缺了会安静跳过。'),
          ...(status.siblings || []).map((x) => h('div', {
            key: x.pkg,
            style: { marginTop: 10, borderTop: '1px solid var(--dsw-border, #e5e7eb)', paddingTop: 8 },
          },
            h('div', { style: { fontSize: 13, fontWeight: 600 } }, x.name + '（' + x.pkg + '）'),
            h('div', { style: S.hint }, x.desc),
            h('div', { style: { ...S.hint, fontSize: 11, marginTop: 2, fontFamily: 'ui-monospace, monospace' } },
              'dsh plugin --profile desktop add github:Speraymer/' + x.pkg)))),
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
      inject: ['slots', 'sessions', 'uiWorkspace', 'locale', 'layout'],
      apply(ctx) {
        const slots = ctx.get('slots')
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'global-memory', order: 41, label: '鱼的记忆' },
          () => h(Panel),
        ))
        const graphCtx = Object.create(ctx)
        for (const key of ['sessions', 'uiWorkspace', 'slots', 'locale', 'layout']) graphCtx[key] = ctx.get(key)
        applyMemoryGraph(graphCtx)
      },
    }
  },
})
