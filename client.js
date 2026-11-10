/**
 * dsh-thinking-levels — browser half.
 *
 * Renders ONE Settings page (the `settings.section` slot, plus its navigation
 * icon in `settings.section.icon`) that lists every custom model the Host
 * auto-detected on the profile's `llm-pi-ai` row. Each model owns its own
 * thinking-level set: clicking a level enables it for that model only, and the
 * adjacent box is the exact value the endpoint expects for that level.
 *
 * Data crosses to the Host through the plugin's loopback RPC channel
 * (`connection.rpc.call`); the Host half validates the write with the loader's
 * own config editor. Nothing here writes files or reads another plugin's DOM.
 *
 * @module dsh-thinking-levels/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-thinking-levels',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useMemo, useRef, useState, useSyncExternalStore } = React

    const NS = 'dsh-thinking-levels'
    const CHANNEL = '/dsh-thinking-levels'
    const SECTION = 'settings.section'
    const SECTION_ICON = 'settings.section.icon'
    const SECTION_ID = 'thinking-levels'
    const SECTION_ORDER = 12

    const inject = ['slots', 'locale', 'connection']

    // ── locale ───────────────────────────────────────────────────────────────

    const zh = {
      'nav.label': '思考等級',
      'page.title': '思考等級',
      'page.description':
        '自動識別配置在 llm-pi-ai 路由上的每個自訂模型，為每個模型單獨設置它支持的思考等級。寫入的內容就是該檔位在端點上的寫法（reasoningEfforts 的值）。',
      'page.refresh': '重新識別',
      'page.loading': '正在識別已配置的模型…',
      'page.modelCount': '偵測到 {count} 個模型 · {providers} 個路由',
      'page.empty': '沒有偵測到任何自訂模型。先在「模型」頁添加路由與模型，再回來設置思考等級。',
      'page.target': '寫入位置：[id: {row}].config.providers.<路由>.models[].reasoningEfforts',
      'page.inactive': '目標行目前未啟用，只能查看，不能寫入。',
      'page.incomplete': '目前只掛載了 {count} 個設定列（少於 {min}），為安全起見暫停寫入。',
      'page.dryRun': '插件設定了 dryRun: true，所有寫入都會被拒絕。',
      'page.noEditor': '這個組合裡沒有 configEditor 服務，無法寫入設定。',
      'page.noRow': '在目前的 profile 裡找不到 llm-pi-ai 這個設定列。',
      'page.expression': 'providers 是一個 !!js 運算式，這裡無法安全地讀寫。',
      'page.rpcDown': '無法連上主行程的寫入通道，設定目前只能檢視。',
      'level.hint': '點擊檔位＝為這個模型開啟該檔位；右邊填的是端點自己的寫法。',
      'level.enabled': '已開啟',
      'level.disabled': '未支援',
      'level.wirePlaceholder': '端點寫法',
      'level.wireLabel': '{level} 在端點上的寫法',
      'level.omitted': '不傳值',
      'level.omit': '不傳',
      'level.omittedHint': 'off 可以不傳值：該檔位仍算支援，但請求裡不帶 reasoning 參數',
      'level.custom': '自訂',
      'model.nonReasoning': '已標記為不推理',
      'model.none': '未開啟任何檔位：這個模型在選單裡不會出現思考等級。',
      'model.preset': '預設',
      'model.dirty': '已修改，尚未儲存',
      'model.save': '儲存',
      'model.saving': '儲存中…',
      'model.saved': '已儲存並驗證',
      'model.failed': '儲存失敗',
      'model.clear': '清除這個模型的思考等級',
      'model.clearTitle': '清除思考等級',
      'model.clearBody': '移除 {name} 的 reasoningEfforts？這個模型之後就沒有思考等級可選。',
      'model.clearConfirm': '清除',
      'model.cancel': '取消',
      'status.verified': '寫入成功，已重新讀取確認。',
      'status.unverified': '寫入完成，但重新讀取後內容不符，請重新整理確認。',
      'status.failedTitle': '沒有寫入',
      'context.window': '上下文',
      'provider.models': '{count} 個模型',
      'meta.title': '思考等級',
      'meta.description': '自動識別已配置的自訂模型，為每個模型單獨設置思考等級。',
      'error.validation': '設定未寫入：{message}',
      'error.onlyOff': '至少要開啟一個 off 以外的檔位，或清除這個模型的檔位',
    }

    const en = {
      'nav.label': 'Thinking levels',
      'page.title': 'Thinking levels',
      'page.description':
        'Every custom model configured on the llm-pi-ai route, detected automatically. Each model owns its own thinking levels; the saved text is exactly how that level is spelled at the endpoint (the reasoningEfforts value).',
      'page.refresh': 'Detect again',
      'page.loading': 'Detecting configured models…',
      'page.modelCount': '{count} models · {providers} routes',
      'page.empty': 'No custom model was detected. Add a route and its models on the Models page, then come back.',
      'page.target': 'Writes to [id: {row}].config.providers.<route>.models[].reasoningEfforts',
      'page.inactive': 'The target row is not active, so this page is read-only.',
      'page.incomplete': 'Only {count} profile rows are mounted (fewer than {min}); writes are paused for safety.',
      'page.dryRun': 'This plugin runs with dryRun: true, so every write is refused.',
      'page.noEditor': 'This composition has no configEditor service, so configuration cannot be written.',
      'page.noRow': 'No llm-pi-ai row exists in the current profile.',
      'page.expression': 'providers is a !!js expression, which cannot be read or written safely here.',
      'page.rpcDown': 'The Host write channel is unreachable; this page is read-only.',
      'level.hint': 'Click a level to enable it for this model; the box holds the endpoint spelling.',
      'level.enabled': 'Enabled',
      'level.disabled': 'Unsupported',
      'level.wirePlaceholder': 'endpoint value',
      'level.wireLabel': 'How {level} is spelled at the endpoint',
      'level.omitted': 'send nothing',
      'level.omit': 'omit',
      'level.omittedHint': 'off may send no value: the level stays supported but the request carries no reasoning field',
      'level.custom': 'custom',
      'model.nonReasoning': 'marked as non-reasoning',
      'model.none': 'No level enabled: this model offers no thinking level in the model picker.',
      'model.preset': 'preset',
      'model.dirty': 'Edited, not saved',
      'model.save': 'Save',
      'model.saving': 'Saving…',
      'model.saved': 'Saved and verified',
      'model.failed': 'Save failed',
      'model.clear': 'Clear this model’s thinking levels',
      'model.clearTitle': 'Clear thinking levels',
      'model.clearBody': 'Remove reasoningEfforts from {name}? The model will then offer no thinking level at all.',
      'model.clearConfirm': 'Clear',
      'model.cancel': 'Cancel',
      'status.verified': 'Written and re-read successfully.',
      'status.unverified': 'The write completed, but the re-read does not match. Reload and check the file.',
      'status.failedTitle': 'Nothing was written',
      'context.window': 'context',
      'provider.models': '{count} models',
      'meta.title': 'Thinking levels',
      'meta.description': 'Detects every configured custom model and lets each one pick its own thinking levels.',
      'error.validation': 'Nothing was written: {message}',
      'error.onlyOff': 'enable at least one level besides off, or clear this model’s levels',
    }

    /** Fill `{name}` placeholders; a missing key is returned verbatim. */
    function interpolate(text, params) {
      if (params === undefined) return text
      return String(text).replace(/\{([A-Za-z0-9_]+)\}/gu, (match, name) => (
        Object.hasOwn(params, name) ? String(params[name]) : match
      ))
    }

    // ── transport ────────────────────────────────────────────────────────────

    let rpcId = 0

    /** POST one envelope to the plugin's channel and unwrap the result. */
    async function post(endpoint, payload) {
      rpcId += 1
      const id = `thinking-levels-${Date.now().toString(36)}-${rpcId}`
      const response = await fetch(`${CHANNEL}/${endpoint}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: id, method: endpoint, payload }),
      })
      if (!response.ok) throw new Error(`channel answered ${response.status}`)
      const body = await response.json()
      if (body === null || typeof body !== 'object' || body.type !== 'server-response') {
        throw new Error('channel answered an unexpected envelope')
      }
      const result = body.result
      if (result === null || typeof result !== 'object') throw new Error('channel answered no result')
      if (result.ok === true) return result.value
      const failure = result.error ?? {}
      const error = new Error(typeof failure.message === 'string' ? failure.message : 'request failed')
      error.code = typeof failure.code === 'string' ? failure.code : 'unknown'
      throw error
    }

    // ── store ────────────────────────────────────────────────────────────────

    const INITIAL = {
      loaded: false,
      loading: false,
      error: null,
      state: null,
      rpcDown: false,
    }

    /**
     * One small external store: the Host snapshot plus every per-model draft the
     * user is editing. Draft keys are `provider::model`.
     */
    function createStore() {
      let snapshot = INITIAL
      const listeners = new Set()
      const publish = (patch) => {
        snapshot = { ...snapshot, ...patch }
        for (const listener of listeners) listener()
      }
      const keyOf = (provider, model) => `${provider}::${model}`

      const store = {
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        getSnapshot() {
          return snapshot
        },
        async load(force) {
          if (!force && (snapshot.loading || (snapshot.loaded && snapshot.state !== null))) return
          publish({ loading: true, error: null })
          try {
            const state = await call('state')
            publish({ loaded: true, loading: false, state, rpcDown: false, drafts: {}, results: {} })
          } catch (error) {
            publish({
              loaded: true,
              loading: false,
              error: String(error?.message ?? error),
              rpcDown: snapshot.state === null,
            })
          }
        },
        /** The user's unsaved level map for one model, or `null` when untouched. */
        draftOf(record) {
          const drafts = snapshot.drafts ?? {}
          const key = keyOf(record.provider, record.id)
          return Object.hasOwn(drafts, key) ? drafts[key] : null
        },
        /** The last saved level map for one model, or `null`. */
        overrideOf(record) {
          const overrides = snapshot.overrides ?? {}
          const key = keyOf(record.provider, record.id)
          return Object.hasOwn(overrides, key) ? overrides[key] : null
        },
        /** The last per-model write outcome, or `null`. */
        resultOf(record) {
          const results = snapshot.results ?? {}
          const key = keyOf(record.provider, record.id)
          return Object.hasOwn(results, key) ? results[key] : null
        },
        setDraft(record, next) {
          const key = keyOf(record.provider, record.id)
          const drafts = { ...(snapshot.drafts ?? {}) }
          drafts[key] = next
          const results = { ...(snapshot.results ?? {}) }
          delete results[key]
          publish({ drafts, results })
        },
        clearDraft(record) {
          const key = keyOf(record.provider, record.id)
          const drafts = { ...(snapshot.drafts ?? {}) }
          delete drafts[key]
          publish({ drafts })
        },
        async save(record, efforts) {
          const key = keyOf(record.provider, record.id)
          setResult(key, { status: 'saving' })
          try {
            const value = await call('save', { provider: record.provider, model: record.id, efforts })
            const drafts = { ...(snapshot.drafts ?? {}) }
            delete drafts[key]
            const overrides = { ...(snapshot.overrides ?? {}) }
            if (value?.reasoningEfforts !== undefined && value.reasoningEfforts !== null) {
              overrides[key] = value.reasoningEfforts
            } else {
              delete overrides[key]
            }
            publish({
              drafts,
              overrides,
              results: {
                ...(snapshot.results ?? {}),
                [key]: { status: 'saved', verified: value?.verified === true },
              },
            })
          } catch (error) {
            publish({
              results: {
                ...(snapshot.results ?? {}),
                [key]: { status: 'failed', message: String(error?.message ?? error), code: error?.code },
              },
            })
          }
        },
      }

      /** Merge one per-model outcome into the published snapshot. */
      function setResult(key, result) {
        publish({ results: { ...(snapshot.results ?? {}), [key]: result } })
      }

      /** One channel call over whichever transport this composition provides. */
      async function call(endpoint, payload) {
        const rpc = getRpc()
        return rpc === null ? post(endpoint, payload) : rpc(endpoint, payload)
      }

      return store
    }

    /** The `connection.rpc.call` face, when this composition provides it. */
    let rpcService
    function getRpc() {
      if (rpcService === undefined) return null
      const rpc = rpcService
      return async (endpoint, payload) => {
        const result = await rpc.call(CHANNEL, endpoint, payload)
        if (result?.ok === true) return result.value
        const failure = result?.error ?? {}
        const error = new Error(typeof failure.message === 'string' ? failure.message : 'request failed')
        error.code = typeof failure.code === 'string' ? failure.code : 'unknown'
        throw error
      }
    }

    // ── view helpers ─────────────────────────────────────────────────────────

    /** Merge the app level universe with levels the config already declares. */
    function levelsOf(record, universe) {
      const seen = new Set()
      const out = []
      for (const level of universe ?? []) {
        if (seen.has(level)) continue
        seen.add(level)
        out.push({ level, primary: true })
      }
      for (const level of Object.keys(record.reasoningEfforts ?? {})) {
        if (seen.has(level)) continue
        seen.add(level)
        out.push({ level, primary: false })
      }
      return out
    }

    /**
     * The model's saved level map as the edit baseline. A `null` wire value is
     * kept: it is the adapter's "supported, send nothing" spelling and only `off`
     * may use it.
     */
    function baselineOf(record) {
      const out = {}
      for (const [level, wire] of Object.entries(record.reasoningEfforts ?? {})) {
        if (typeof wire === 'string' && wire !== '') out[level] = wire
        else if (wire === null) out[level] = null
      }
      return out
    }

    /** Stable comparison of two level maps, `null` values included. */
    function sameEfforts(a, b) {
      const left = a ?? {}
      const right = b ?? {}
      const aKeys = Object.keys(left).sort()
      const bKeys = Object.keys(right).sort()
      if (aKeys.length !== bKeys.length) return false
      for (let index = 0; index < aKeys.length; index += 1) {
        if (aKeys[index] !== bKeys[index]) return false
        if (left[aKeys[index]] !== right[bKeys[index]]) return false
      }
      return true
    }

    /** Human formatting for a context window. */
    function formatWindow(size) {
      if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return null
      if (size >= 1_000_000) return `${Math.round((size / 1_000_000) * 10) / 10}M`
      if (size >= 1000) return `${Math.round(size / 1000)}K`
      return String(size)
    }

    /** Standard-level helper text: what DSH means by this level name. */
    const LEVEL_NOTES = {
      off: 'thinking off',
      minimal: 'barely any thinking',
      low: 'brief thinking',
      medium: 'balanced',
      high: 'deep thinking',
      xhigh: 'very deep',
      max: 'largest budget',
    }

    // ── components ───────────────────────────────────────────────────────────

    /** One thinking-level cell: click to enable, edit the endpoint spelling. */
    function LevelCell({ level, primary, enabled, wire, note, onToggle, onWire, t }) {
      const inputRef = useRef(null)
      const onKeyDown = (event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          event.currentTarget.blur()
        }
      }
      return h('div', { className: `tl-level${enabled ? ' is-on' : ''}` }, [
        h('button', {
          key: 'toggle',
          type: 'button',
          role: 'switch',
          'aria-checked': enabled,
          'aria-label': `${level} — ${enabled ? t('level.enabled') : t('level.disabled')}`,
          className: 'tl-level-toggle',
          onClick: () => onToggle(!enabled),
        }, [
          h('span', { key: 'dot', className: 'tl-level-dot', 'aria-hidden': 'true' }),
          h('span', { key: 'name', className: 'tl-level-name' }, level),
          primary ? null : h('span', { key: 'badge', className: 'tl-level-badge' }, t('level.custom')),
        ]),
        enabled
          ? h('div', { key: 'wire-wrap', className: 'tl-level-wire-wrap' }, [
            h('input', {
              key: 'wire',
              ref: inputRef,
              type: 'text',
              className: 'tl-input tl-input-code',
              value: wire === null ? '' : wire ?? '',
              spellCheck: false,
              autoComplete: 'off',
              placeholder: wire === null ? t('level.omitted') : t('level.wirePlaceholder'),
              'aria-label': t('level.wireLabel', { level }),
              onChange: (event) => onWire(event.target.value === '' ? null : event.target.value),
              onKeyDown,
            }),
            level === 'off'
              ? h('button', {
                key: 'omit',
                type: 'button',
                className: `tl-level-omit${wire === null ? ' is-active' : ''}`,
                title: t('level.omittedHint'),
                'aria-label': t('level.omittedHint'),
                'aria-pressed': wire === null,
                onClick: () => onWire(wire === null ? 'off' : null),
              }, t('level.omit'))
              : null,
          ])
          : h('div', { key: 'note', className: 'tl-level-note' }, note ?? ''),
      ])
    }

    /** One model card: identity on the left, its own level editor on the right. */
    function ModelCard({ record, universe, store, t, canWrite }) {
      const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
      const current = store.draftOf(record)
      const override = store.overrideOf(record)
      const base = useMemo(
        () => baselineOf(override === null ? record : { ...record, reasoningEfforts: override }),
        [record, override],
      )
      // A draft is an object (`{}` = "clear every level"), so `null` means "no draft".
      const editing = current === null ? base : current
      const dirty = !sameEfforts(editing, base)
      const result = store.resultOf(record)
      const [confirmClear, setConfirmClear] = useState(false)
      const [localError, setLocalError] = useState(null)
      const levels = useMemo(() => levelsOf(record, universe), [record, universe])
      const windowLabel = formatWindow(record.contextWindow)

      const toggle = (level, on) => {
        const next = { ...editing }
        if (on) {
          next[level] = Object.hasOwn(next, level) ? next[level] : (level === 'off' ? 'off' : level)
        } else {
          delete next[level]
        }
        store.setDraft(record, next)
      }
      const setWire = (level, wire) => {
        store.setDraft(record, { ...editing, [level]: wire })
      }
      const commit = () => {
        const payload = {}
        for (const [level, wire] of Object.entries(editing)) {
          if (wire === null) {
            // Only `off` may leave the wire value empty; keep that spelling.
            if (level === 'off') payload[level] = null
            continue
          }
          const trimmed = String(wire ?? '').trim()
          if (trimmed !== '') payload[level] = trimmed
        }
        const levels = Object.keys(payload)
        // Mirror the adapter's own rule, so the refusal reads as guidance here
        // instead of as a raw config-editor error from the Host.
        if (levels.length > 0 && !levels.some((level) => level !== 'off')) {
          setLocalError(t('error.validation', { message: t('error.onlyOff') }))
          return
        }
        setLocalError(null)
        store.save(record, levels.length === 0 ? null : payload)
      }
      const reset = () => {
        setLocalError(null)
        store.clearDraft(record)
      }

      return h('section', { className: 'tl-model' }, [
        h('div', { key: 'head', className: 'tl-model-head' }, [
          h('div', { key: 'id', className: 'tl-model-id' }, [
            h('span', { key: 'name', className: 'tl-model-name', title: record.id }, record.name),
            h('code', { key: 'code', className: 'tl-model-code' }, record.id),
            windowLabel === null
              ? null
              : h('span', { key: 'win', className: 'tl-badge' }, `${windowLabel} ${t('context.window')}`),
            record.declared === false
              ? h('span', { key: 'pinned', className: 'tl-badge tl-badge-warn' }, t('model.nonReasoning'))
              : null,
            record.declared === true
              ? h('span', { key: 'preset', className: 'tl-badge tl-badge-quiet' }, t('model.preset'))
              : null,
          ]),
          h('div', { key: 'actions', className: 'tl-model-actions' }, [
            result?.status === 'saving'
              ? h('span', { key: 'saving', className: 'tl-result' }, t('model.saving'))
              : null,
            result?.status === 'saved'
              ? h('span', {
                key: 'saved',
                className: `tl-result ${result.verified ? 'is-ok' : 'is-warn'}`,
                title: result.verified ? t('status.verified') : t('status.unverified'),
              }, result.verified ? t('model.saved') : t('status.unverified'))
              : null,
            result?.status === 'failed'
              ? h('span', {
                key: 'failed',
                className: 'tl-result is-error',
                title: result.message ?? '',
                role: 'status',
              }, `${t('model.failed')}: ${result.message ?? ''}`)
              : null,
            localError === null
              ? null
              : h('span', { key: 'local-error', className: 'tl-result is-error', role: 'status' }, localError),
            dirty && canWrite
              ? h('button', {
                key: 'reset',
                type: 'button',
                className: 'tl-secondary',
                onClick: reset,
              }, t('model.cancel'))
              : null,
            h('button', {
              key: 'clear',
              type: 'button',
              className: 'tl-secondary',
              title: t('model.clear'),
              'aria-label': t('model.clear'),
              disabled: !canWrite,
              onClick: () => setConfirmClear(true),
            }, '⨯'),
            h('button', {
              key: 'save',
              type: 'button',
              className: 'tl-primary',
              disabled: !dirty || !canWrite || result?.status === 'saving',
              onClick: commit,
            }, dirty ? t('model.save') : t('model.saved')),
          ]),
        ]),
        h('div', { key: 'body', className: 'tl-model-body' }, [
          h('div', { key: 'hint', className: 'tl-hint' }, t('level.hint')),
          h('div', { key: 'levels', className: 'tl-levels' }, levels.map(({ level, primary }) => (
            h(LevelCell, {
              key: level,
              level,
              primary,
              enabled: Object.hasOwn(editing, level),
              wire: editing[level] ?? '',
              note: LEVEL_NOTES[level],
              onToggle: (on) => toggle(level, on),
              onWire: (wire) => setWire(level, wire),
              t,
            })
          ))),
          Object.keys(editing).length === 0
            ? h('div', { key: 'none', className: 'tl-note' }, t('model.none'))
            : null,
        ]),
        confirmClear
          ? h('div', { key: 'dialog', className: 'tl-dialog-scrim', role: 'presentation' }, [
            h('div', { key: 'card', className: 'tl-dialog', role: 'dialog', 'aria-modal': 'true' }, [
              h('h3', { key: 'title', className: 'tl-dialog-title' }, t('model.clearTitle')),
              h('p', { key: 'body', className: 'tl-dialog-body' }, t('model.clearBody', { name: record.id })),
              h('div', { key: 'actions', className: 'tl-dialog-actions' }, [
                h('button', {
                  key: 'cancel',
                  type: 'button',
                  className: 'tl-secondary',
                  onClick: () => setConfirmClear(false),
                }, t('model.cancel')),
                h('button', {
                  key: 'ok',
                  type: 'button',
                  className: 'tl-danger',
                  onClick: () => {
                    setConfirmClear(false)
                    store.clearDraft(record)
                    store.save(record, null)
                  },
                }, t('model.clearConfirm')),
              ]),
            ]),
          ])
          : null,
      ])
    }

    /** The Settings page itself. */
    function ThinkingLevelsPage(_props) {
      const store = useStoreRef()
      const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
      const t = useTranslator()
      useEffect(() => { void store.load(false) }, [store])

      const state = snapshot.state
      const target = state?.target

      const notice = (() => {
        if (snapshot.rpcDown) return t('page.rpcDown')
        if (snapshot.loading && state === null) return t('page.loading')
        if (snapshot.error !== null && state === null) return snapshot.error
        if (state === null) return t('page.loading')
        if (state.status === 'no-editor') return t('page.noEditor')
        if (state.status === 'row-missing') return t('page.noRow')
        if (state.status === 'providers-expression') return t('page.expression')
        if (target?.dryRun === true) return t('page.dryRun')
        if (target?.active === false) return t('page.inactive')
        if (target?.editable === false && typeof target?.entryCount === 'number') {
          return t('page.incomplete', { count: target.entryCount, min: target.minEntriesBeforeWrite })
        }
        return null
      })()

      const providers = state?.providers ?? []
      const modelCount = state?.modelCount ?? 0
      // Writing needs a writable target; an unreadable one still renders the
      // detected catalog, just without controls.
      const writable = state?.status === 'ok'
        && target?.active !== false
        && target?.editable !== false
        && target?.dryRun !== true

      return h('div', { className: 'tl-page' }, [
        h('header', { key: 'head', className: 'tl-head' }, [
          h('div', { key: 'copy', className: 'tl-head-copy' }, [
            h('h2', { key: 'title', className: 'tl-title' }, t('page.title')),
            h('p', { key: 'desc', className: 'tl-subtitle' }, t('page.description')),
            state !== null && state.status === 'ok'
              ? h('p', { key: 'count', className: 'tl-meta' }, t('page.modelCount', {
                count: modelCount,
                providers: providers.length,
              }))
              : null,
            state !== null && state.status === 'ok' && target !== undefined
              ? h('p', { key: 'target', className: 'tl-meta tl-mono' }, t('page.target', { row: target.rowId }))
              : null,
          ]),
          h('div', { key: 'actions', className: 'tl-head-actions' }, [
            h('button', {
              key: 'refresh',
              type: 'button',
              className: 'tl-secondary',
              disabled: snapshot.loading,
              onClick: () => { void store.load(true) },
            }, snapshot.loading ? t('page.loading') : t('page.refresh')),
          ]),
        ]),
        notice === null
          ? null
          : h('div', { key: 'notice', className: 'tl-notice', role: 'status' }, notice),
        providers.length === 0
          ? h('div', { key: 'empty', className: 'tl-empty' }, t('page.empty'))
          : providers.map((provider) => h('div', { key: `p-${provider.id}`, className: 'tl-provider' }, [
            h('div', { key: 'head', className: 'tl-provider-head' }, [
              h('span', { key: 'name', className: 'tl-provider-name' }, provider.displayName),
              h('code', { key: 'id', className: 'tl-provider-id' }, provider.id),
              provider.api === null ? null : h('span', { key: 'api', className: 'tl-badge' }, provider.api),
              h('span', { key: 'count', className: 'tl-provider-count' }, t('provider.models', {
                count: provider.models.length,
              })),
            ]),
            h('div', { key: 'models', className: 'tl-models' }, provider.models.map((record) => (
              writable
                ? h(ModelCard, {
                  key: `${record.provider}:${record.id}`,
                  record,
                  universe: state.levels,
                  store,
                  t,
                  canWrite: true,
                })
                : h(ReadOnlyModel, { key: `${record.provider}:${record.id}`, record, universe: state.levels, t })
            ))),
          ])),
      ])
    }

    /** Read-only rendering for a page that must not write. */
    function ReadOnlyModel({ record, universe, t }) {
      const levels = levelsOf(record, universe)
      const on = Object.keys(record.reasoningEfforts ?? {})
      const windowLabel = formatWindow(record.contextWindow)
      return h('section', { className: 'tl-model is-readonly' }, [
        h('div', { key: 'head', className: 'tl-model-head' }, [
          h('div', { key: 'id', className: 'tl-model-id' }, [
            h('span', { key: 'name', className: 'tl-model-name' }, record.name),
            h('code', { key: 'code', className: 'tl-model-code' }, record.id),
            windowLabel === null
              ? null
              : h('span', { key: 'win', className: 'tl-badge' }, `${windowLabel} ${t('context.window')}`),
          ]),
          h('span', { key: 'on', className: 'tl-result' }, on.length === 0 ? t('model.none') : on.join(' · ')),
        ]),
        h('div', { key: 'levels', className: 'tl-levels' }, levels.map(({ level, primary }) => h('div', {
          key: level,
          className: `tl-level is-static${Object.hasOwn(record.reasoningEfforts ?? {}, level) ? ' is-on' : ''}`,
        }, [
          h('span', { key: 'name', className: 'tl-level-name' }, level),
          primary ? null : h('span', { key: 'badge', className: 'tl-level-badge' }, t('level.custom')),
          Object.hasOwn(record.reasoningEfforts ?? {}, level)
            ? h('code', { key: 'wire', className: 'tl-level-wire-static' }, record.reasoningEfforts[level])
            : null,
        ]))),
      ])
    }

    // ── locale binding ───────────────────────────────────────────────────────

    let localeService
    let translate = (key) => key
    let translateParams = (key, params) => interpolate(key, params)
    /** Bumped on every locale change so pages re-render with fresh text. */
    let localeRevision = 0
    const localeListeners = new Set()

    /** The active language id, or `zh` when the service cannot answer. */
    function activeLocaleId() {
      try {
        const active = localeService?.getLocale?.().active
        return typeof active === 'string' && active !== '' ? active : 'zh'
      } catch {
        return 'zh'
      }
    }

    /**
     * Bind the locale service, keeping a local dictionary as the fallback so a
     * missing or uninspectable namespace can never render raw keys.
     */
    function bindLocale() {
      if (localeService === undefined) return
      const bound = localeService.bind(NS)
      const fallback = () => (activeLocaleId().startsWith('zh') ? zh : en)
      translate = (key) => {
        const text = bound(key)
        if (typeof text === 'string' && text !== '' && text !== key) return text
        const dictionary = fallback()
        return Object.hasOwn(dictionary, key) ? dictionary[key] : key
      }
      translateParams = (key, params) => interpolate(translate(key), params)
    }

    function useTranslator() {
      useSyncExternalStore(
        (listener) => {
          localeListeners.add(listener)
          return () => localeListeners.delete(listener)
        },
        () => localeRevision,
      )
      return translateParams
    }

    // ── page store ownership ─────────────────────────────────────────────────

    let pageStore
    function useStoreRef() {
      if (pageStore === undefined) pageStore = createStore()
      return pageStore
    }

    // ── style ────────────────────────────────────────────────────────────────

    const CSS = `
/* Every value below is copied from a shipped settings page of this build; only
   the class names are this plugin's own. Only verified --dsw-alias-* tokens are
   referenced, so the page follows light, dark and every host theme. */
.tl-page { box-sizing: border-box; max-width: 720px; display: flex; flex-direction: column; gap: 12px; color: var(--dsw-alias-label-primary); }
.tl-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.tl-head-copy { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.tl-head-actions { display: inline-flex; align-items: center; gap: 8px; flex: none; }
.tl-title { margin: 0; font-size: 16px; font-weight: 500; line-height: 24px; }
.tl-subtitle { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 14px; line-height: 22px; }
.tl-meta { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.tl-mono { font-family: var(--ds-font-family-code); word-break: break-all; }
.tl-notice { margin: 0; padding: 8px 12px; border: .5px solid var(--dsw-alias-state-warn-tertiary); border-radius: var(--dsw-radius-md); color: var(--dsw-alias-state-warn-label); font-size: 12px; line-height: 18px; }
.tl-empty { padding: 24px 16px; text-align: center; color: var(--dsw-alias-label-tertiary); font-size: 14px; line-height: 22px; }
.tl-provider { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
.tl-provider-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tl-provider-name { color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 500; line-height: 22px; }
.tl-provider-id { font-family: var(--ds-font-family-code); font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.tl-provider-count { margin-left: auto; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.tl-models { display: flex; flex-direction: column; gap: 8px; }
.tl-model { display: flex; flex-direction: column; gap: 12px; padding: 12px 14px; border: .5px solid var(--dsw-alias-settings-card-stroke); background: var(--dsw-alias-settings-card-fill); border-radius: var(--dsw-radius-xl); }
.tl-model-head { display: flex; align-items: center; gap: 10px; }
.tl-model-id { display: inline-flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; }
.tl-model-name { color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 500; line-height: 22px; }
.tl-model-code { font-family: var(--ds-font-family-code); font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); word-break: break-all; }
.tl-model-actions { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; flex: none; flex-wrap: wrap; justify-content: flex-end; }
.tl-badge { flex: none; padding: 1px 6px; border: .5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-xs); color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; white-space: nowrap; }
.tl-badge-quiet { color: var(--dsw-alias-label-tertiary); }
.tl-badge-warn { border-color: var(--dsw-alias-state-warn-tertiary); color: var(--dsw-alias-state-warn-label); }
.tl-model-body { display: flex; flex-direction: column; gap: 12px; padding: 14px 16px; background: var(--dsw-alias-bg-module-platform); border-radius: var(--dsw-radius-lg); }
.tl-hint { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.tl-levels { display: flex; flex-wrap: wrap; gap: 8px; }
.tl-level { display: flex; flex-direction: column; gap: 6px; min-width: 108px; padding: 8px 10px; border: .5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); }
.tl-level.is-on { border-color: var(--dsw-alias-state-business-primary); }
.tl-level.is-static { flex-direction: row; align-items: center; gap: 8px; }
.tl-level-toggle { display: inline-flex; align-items: center; gap: 6px; padding: 0; border: none; background: 0 0; color: inherit; font: inherit; cursor: pointer; text-align: left; }
.tl-level-toggle:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); border-radius: var(--dsw-radius-xs); }
.tl-level-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; border: 1px solid var(--dsw-alias-border-l4); background: 0 0; }
.tl-level.is-on .tl-level-dot { border-color: transparent; background: var(--dsw-alias-state-business-primary); }
.tl-level-name { color: var(--dsw-alias-label-primary); font-size: 12px; font-weight: 500; line-height: 18px; }
.tl-level-badge { padding: 0 4px; border-radius: var(--dsw-radius-xs); border: .5px solid var(--dsw-alias-border-l3); color: var(--dsw-alias-label-tertiary); font-size: 10px; line-height: 14px; }
.tl-level-note { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
.tl-level-wire-wrap { display: flex; align-items: center; gap: 4px; }
.tl-input { box-sizing: border-box; width: 100%; height: 32px; padding: 0 10px; border: .5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; line-height: 22px; }
.tl-input:focus { border-color: var(--dsw-alias-state-business-primary); outline: none; }
.tl-input::placeholder { color: var(--dsw-alias-label-dimmed); }
.tl-input:disabled { opacity: .6; cursor: default; }
.tl-input-code { font-family: var(--ds-font-family-code); font-size: 13px; }
.tl-level-wire-static { font-family: var(--ds-font-family-code); font-size: 12px; color: var(--dsw-alias-label-secondary); }
.tl-level-omit { flex: none; box-sizing: border-box; height: 24px; padding: 0 6px; border: .5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-sm); background: 0 0; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 11px; line-height: 16px; cursor: pointer; }
.tl-level-omit.is-active { border-color: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-label-primary); }
@media (hover:hover) { .tl-level-omit:hover { background: var(--dsw-alias-interactive-bg-hover-solid); } }
.tl-note { margin: 0; color: var(--dsw-alias-state-warn-label); font-size: 12px; line-height: 18px; }
.tl-result { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; max-width: 42ch; }
.tl-result.is-ok { color: var(--dsw-alias-state-success-primary); }
.tl-result.is-warn { color: var(--dsw-alias-state-warn-label); }
.tl-result.is-error { color: var(--dsw-alias-state-error-primary); }
.tl-primary, .tl-secondary, .tl-danger { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 36px; padding: 0 14px; border: none; border-radius: var(--dsw-radius-md); font: inherit; font-size: 14px; line-height: 22px; cursor: pointer; }
.tl-primary { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }
.tl-secondary { border: .5px solid var(--dsw-alias-border-l3); background: 0 0; color: var(--dsw-alias-label-primary); }
.tl-danger { background: 0 0; color: var(--dsw-alias-state-error-primary); }
@media (hover:hover) {
  .tl-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
  .tl-secondary:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-solid); }
  .tl-danger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger); }
}
.tl-primary:disabled, .tl-secondary:disabled, .tl-danger:disabled { opacity: .4; cursor: default; }
.tl-primary:focus-visible, .tl-secondary:focus-visible, .tl-danger:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); }
.tl-model-actions .tl-secondary, .tl-model-actions .tl-danger { height: 28px; padding: 0 10px; font-size: 12px; line-height: 18px; border-radius: var(--dsw-radius-sm); }
.tl-dialog-scrim { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 24px; background: var(--dsw-alias-bg-mask-2); }
.tl-dialog { box-sizing: border-box; width: min(420px, 100%); display: flex; flex-direction: column; gap: 12px; padding: 16px 18px; border-radius: var(--dsw-radius-panel); background: var(--dsw-alias-bg-layer-2); box-shadow: var(--dsw-elevation-prominent); }
.tl-dialog-title { margin: 0; color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 500; line-height: 22px; }
.tl-dialog-body { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 14px; line-height: 22px; }
.tl-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; }
@media (max-width: 720px) {
  .tl-head { flex-direction: column; }
  .tl-model-head { flex-direction: column; align-items: flex-start; }
  .tl-model-actions { margin-left: 0; justify-content: flex-start; }
}
`

    const ICON_SVG = 'M12 3a4 4 0 0 0-4 4v1H7a3 3 0 0 0-3 3v3a3 3 0 0 0 3 3h1v1a4 4 0 0 0 8 0v-1h1a3 3 0 0 0 3-3v-3a3 3 0 0 0-3-3h-1V7a4 4 0 0 0-4-4Zm0 5v8m-2-6h4m-4 4h4'

    /** Navigation glyph beside the page label. */
    function ThinkingIcon() {
      return h('svg', {
        viewBox: '0 0 24 24',
        width: 16,
        height: 16,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        focusable: 'false',
      }, h('path', { d: ICON_SVG }))
    }

    // ── activation ───────────────────────────────────────────────────────────

    function apply(ctx) {
      localeService = ctx.get('locale')
      const connectionService = ctx.get('connection')
      rpcService = connectionService !== undefined && typeof connectionService.rpc?.call === 'function'
        ? connectionService.rpc
        : null

      if (localeService !== undefined) {
        ctx.effect(() => localeService.register(NS, { zh, en }), 'thinking-levels: dictionaries')
        bindLocale()
        // The slot `label` is a thunk the shell re-reads on every projection, so a
        // locale change only needs to re-render the pages this plugin owns.
        ctx.effect(() => localeService.subscribe(() => {
          bindLocale()
          localeRevision += 1
          for (const listener of localeListeners) listener()
        }), 'thinking-levels: locale changes')
      }

      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.plugin = 'dsh-thinking-levels'
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'thinking-levels: styles')

      if (connectionService !== undefined) {
        ctx.effect(() => ctx.on('connection/reset', () => {
          if (pageStore !== undefined) pageStore.load(true)
        }), 'thinking-levels: connection reset')
      }

      // The page row: the Settings shell owns navigation, so this is one list entry.
      ctx.slots.inject(SECTION, () => ctx.slots.register(
        {
          name: SECTION,
          id: SECTION_ID,
          order: SECTION_ORDER,
          label: () => translate('nav.label'),
        },
        ThinkingLevelsPage,
      ))

      // The navigation glyph, addressed by the matching section id.
      ctx.slots.inject(SECTION_ICON, () => ctx.slots.register(
        { name: SECTION_ICON, id: SECTION_ID, order: SECTION_ORDER },
        ThinkingIcon,
      ))
    }

    return {
      name: 'dsh-thinking-levels',
      inject,
      apply,
    }
  },
})
