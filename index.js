/**
 * dsh-thinking-levels — Host half.
 *
 * WHAT IT DOES
 * ------------
 * 1. AUTO-DETECTS every model configured on the profile's custom-provider row
 *    (`llm-pi-ai` by default): `providers[<provider>].models[<model>]`.
 * 2. Serves that catalog to the browser half over a loopback RPC channel, one
 *    entry per model, each carrying its OWN current thinking-level mapping.
 * 3. Writes back exactly one model's `reasoningEfforts` through the Host
 *    `configEditor` service, which validates against the plugin's schemastery
 *    `Config`, persists the single row, and reconciles the running Loader. No
 *    restart, no file watcher, no whole-layer rewrite, and this plugin never
 *    parses or rewrites the profile YAML itself.
 *
 * WHY A SEPARATE RPC CHANNEL
 * --------------------------
 * The browser half is a plain-JS Client plugin; it cannot import Host Services.
 * A loopback `webServer` prefix route plus `connection.requestRejection` gives
 * it the same reachability and the same auth fence as the shared `/api`
 * transport, using only documented Host services.
 *
 * NON-GOALS: it does not select the active thinking level for a request (the
 * composer's model control owns that), it does not touch built-in catalog
 * models, and it never writes a provider/model it did not read first.
 *
 * @module dsh-thinking-levels
 */

/** Cordis plugin name. */
export const name = 'thinking-levels'

/**
 * Hard dependencies. The row stays dormant in compositions that provide none of
 * them instead of throwing at boot.
 */
export const inject = ['webServer']

/** The canonical DSH thinking-level universe, easiest to strongest. */
const DEFAULT_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** Largest request body this channel accepts, in bytes. */
const MAX_REQUEST_BYTES = 64 * 1024

/** Loader fiber state for `active`. */
const FIBER_ACTIVE = 2

/** Endpoint paths under the channel. */
const ENDPOINTS = new Set(['state', 'save'])

// ── small helpers ────────────────────────────────────────────────────────────

/** True for a plain `{}` object; arrays, null and YAML expression nodes are not. */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** True for the `!!js` expression marker the Loader uses. */
function isExpression(value) {
  return isRecord(value) && typeof value.__jsExpr === 'string' && Object.keys(value).length === 1
}

/** Defensive non-negative integer coercion. */
function int(value, fallback, min = 0) {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback
}

/** One `ok` result envelope body. */
function okResult(value) {
  return { ok: true, value }
}

/** One `fail` result envelope body; `details` must be an object for the transport. */
function failResult(code, message) {
  return { ok: false, error: { code, message, details: {} } }
}

/** The row's config merged with defaults, ignoring malformed values. */
function normalizeConfig(raw) {
  const cfg = {
    enabled: true,
    targetRowId: 'llm-pi-ai',
    targetModule: '@deepseek-ai/dsh-llm-pi-ai',
    channel: '/dsh-thinking-levels',
    levels: DEFAULT_LEVELS.slice(),
    minEntriesBeforeWrite: 8,
    dryRun: false,
  }
  if (!isRecord(raw)) return cfg
  if (raw.enabled === false) cfg.enabled = false
  for (const key of ['targetRowId', 'targetModule']) {
    if (typeof raw[key] === 'string' && raw[key].trim() !== '') cfg[key] = raw[key].trim()
  }
  if (typeof raw.channel === 'string' && /^\/[A-Za-z0-9_$./-]+$/u.test(raw.channel)) {
    cfg.channel = raw.channel.length > 1 ? raw.channel.replace(/\/+$/u, '') : raw.channel
  }
  if (Array.isArray(raw.levels)) {
    const levels = raw.levels
      .filter((level) => typeof level === 'string' && /^[a-z][a-z0-9_-]*$/u.test(level))
      .map((level) => level.trim())
    if (levels.length > 0) cfg.levels = [...new Set(levels)]
  }
  cfg.minEntriesBeforeWrite = int(raw.minEntriesBeforeWrite, cfg.minEntriesBeforeWrite, 0)
  if (raw.dryRun === true) cfg.dryRun = true
  return cfg
}

// ── row discovery ────────────────────────────────────────────────────────────

/** Addressable profile rows, or `null` when the editor cannot answer yet. */
function safeEntries(editor) {
  try {
    const entries = editor.entries()
    return Array.isArray(entries) ? entries : null
  } catch {
    return null
  }
}

/** Find this deployment's custom-provider row: module name first, patch id second. */
function findTarget(entries, cfg) {
  const byName = entries.find((entry) => entry?.options?.name === cfg.targetModule)
  if (byName !== undefined) return byName
  return entries.find((entry) => entry?.options?.id === cfg.targetRowId) ?? null
}

/** True when the row's fiber is mounted and active. */
function isActive(entry) {
  return entry?.fiber !== undefined && entry.fiber.state === FIBER_ACTIVE
}

// ── catalog projection ───────────────────────────────────────────────────────

/**
 * Current declared levels of one model, keeping only the safe entries.
 * A missing or malformed map is reported as "nothing declared", which is the
 * configuration a model without thinking-level support has. A `null` wire value
 * is kept as `null`: it is the adapter's "supported, send nothing" spelling, and
 * only `off` may use it.
 */
function declaredEfforts(model) {
  const raw = model?.reasoningEfforts
  if (!isRecord(raw)) return {}
  const out = {}
  for (const [level, wire] of Object.entries(raw)) {
    if (typeof wire === 'string') out[level] = wire
    else if (wire === null) out[level] = null
  }
  return out
}

/** One serializable model record for the browser half. */
function modelRecord(providerId, provider, model) {
  const efforts = declaredEfforts(model)
  return {
    provider: providerId,
    providerName: typeof provider?.displayName === 'string' && provider.displayName !== ''
      ? provider.displayName
      : providerId,
    id: typeof model?.id === 'string' ? model.id : '',
    name: typeof model?.name === 'string' && model.name !== '' ? model.name : String(model?.id ?? ''),
    api: typeof provider?.api === 'string' ? provider.api : null,
    baseURL: typeof provider?.baseURL === 'string' ? provider.baseURL : null,
    contextWindow: typeof model?.contextWindow === 'number' ? model.contextWindow : null,
    maxTokens: typeof model?.maxTokens === 'number' ? model.maxTokens : null,
    /** The model's own mapping, `{}` when it declares none. */
    reasoningEfforts: efforts,
    /**
     * Raw declaration state: `null` when the field is omitted (the built-in
     * catalog decides), `false` when the model is pinned as non-reasoning, and
     * `true` when the model carries its own level map.
     */
    declared: model?.reasoningEfforts === undefined ? null : model.reasoningEfforts === false ? false : true,
  }
}

/** The whole detected catalog, grouped by provider, plus write preconditions. */
function readCatalog(ctx, cfg) {
  const editor = ctx.get('configEditor')
  if (editor === undefined || typeof editor.edit !== 'function') {
    return { status: 'no-editor' }
  }
  const entries = safeEntries(editor)
  if (entries === null) return { status: 'no-editor' }

  const entry = findTarget(entries, cfg)
  if (entry === null) {
    return { status: 'row-missing', entryCount: entries.length, targetRowId: cfg.targetRowId }
  }
  const active = isActive(entry)
  const rawConfig = entry?.options?.config
  const rowConfig = isRecord(rawConfig) ? rawConfig : {}
  if (isExpression(rowConfig.providers)) {
    return { status: 'providers-expression', targetRowId: cfg.targetRowId }
  }
  const providers = isRecord(rowConfig.providers) ? rowConfig.providers : {}

  const providersOut = []
  for (const [providerId, providerRaw] of Object.entries(providers)) {
    if (!isRecord(providerRaw)) continue
    const models = Array.isArray(providerRaw.models) ? providerRaw.models : []
    const records = []
    for (const modelRaw of models) {
      if (!isRecord(modelRaw)) continue
      const record = modelRecord(providerId, providerRaw, modelRaw)
      if (record.id === '') continue
      records.push(record)
    }
    providersOut.push({
      id: providerId,
      displayName: typeof providerRaw.displayName === 'string' && providerRaw.displayName !== ''
        ? providerRaw.displayName
        : providerId,
      api: typeof providerRaw.api === 'string' ? providerRaw.api : null,
      baseURL: typeof providerRaw.baseURL === 'string' ? providerRaw.baseURL : null,
      models: records,
    })
  }

  return {
    status: 'ok',
    levels: cfg.levels,
    target: {
      rowId: String(entry?.options?.id ?? cfg.targetRowId),
      module: String(entry?.options?.name ?? cfg.targetModule),
      active,
      editable: active && !cfg.dryRun && entries.length >= cfg.minEntriesBeforeWrite,
      entryCount: entries.length,
      minEntriesBeforeWrite: cfg.minEntriesBeforeWrite,
      dryRun: cfg.dryRun,
    },
    providers: providersOut,
    modelCount: providersOut.reduce((total, provider) => total + provider.models.length, 0),
  }
}

// ── writing ──────────────────────────────────────────────────────────────────

/**
 * Validate one requested `efforts` map against the levels `llm-pi-ai` accepts
 * (its schema restricts the keys to exactly {@link DEFAULT_LEVELS}).
 *
 * The adapter's own rules, mirrored here so a bad payload is refused before the
 * config editor throws on it:
 * - `null` / `false` as the whole value has a meaning of its own (`false` pins a
 *   non-reasoning model, `null` removes the field);
 * - no `null` wire value except on `off`, and never `""`;
 * - at least one level other than `off` must be declared.
 */
function normalizeEfforts(value, allowedLevels) {
  if (value === null) return { mode: 'unset' }
  if (value === false) return { mode: 'false' }
  if (!isRecord(value)) return { error: 'efforts must be an object, null, or false' }
  const allowed = new Set(allowedLevels)
  const out = {}
  for (const [level, wire] of Object.entries(value)) {
    if (!allowed.has(level)) {
      return { error: `unknown level ${JSON.stringify(level)} (allowed: ${allowedLevels.join(', ')})` }
    }
    if (wire === null) {
      if (level !== 'off') return { error: `only "off" may map to null; ${level} needs a wire value` }
      out[level] = null
      continue
    }
    if (typeof wire !== 'string') return { error: `level ${JSON.stringify(level)} must map to a string` }
    const trimmed = wire.trim()
    if (trimmed === '') return { error: `level ${JSON.stringify(level)} maps to an empty string` }
    out[level] = trimmed
  }
  const meaningful = Object.keys(out).filter((level) => level !== 'off')
  if (meaningful.length === 0) {
    return { error: 'declare at least one level besides "off", or clear the field entirely' }
  }
  return { mode: 'set', efforts: out }
}

/**
 * Write one model's `reasoningEfforts` through the Host config editor.
 * @param provider - provider id on the custom-provider row.
 * @param model - model id inside that provider.
 * @param efforts - complete `{ level: wireValue }` map for that model.
 */
async function saveModel(ctx, cfg, provider, model, efforts) {
  const editor = ctx.get('configEditor')
  if (editor === undefined || typeof editor.edit !== 'function') {
    return failResult('no-editor', 'The Host config editor is not available in this composition.')
  }
  const entries = safeEntries(editor)
  if (entries === null) return failResult('no-editor', 'The Host config editor cannot list profile rows yet.')
  if (entries.length < cfg.minEntriesBeforeWrite) {
    return failResult(
      'profile-incomplete',
      `Refusing to write while only ${entries.length} profile rows are mounted (minimum ${cfg.minEntriesBeforeWrite}).`,
    )
  }
  const entry = findTarget(entries, cfg)
  if (entry === null) return failResult('row-missing', `No profile row matches ${cfg.targetRowId}.`)
  if (!isActive(entry)) return failResult('row-inactive', `The ${cfg.targetRowId} row is not active.`)
  if (cfg.dryRun) return failResult('dry-run', 'This plugin is configured with dryRun: true, so nothing was written.')

  const currentConfig = isRecord(entry?.options?.config) ? entry.options.config : {}
  const providers = isRecord(currentConfig.providers) ? currentConfig.providers : {}
  const providerRaw = providers[provider]
  if (!isRecord(providerRaw)) return failResult('provider-missing', `Provider ${provider} is not configured.`)
  const modelIndex = Array.isArray(providerRaw.models)
    ? providerRaw.models.findIndex((candidate) => isRecord(candidate) && candidate.id === model)
    : -1
  if (modelIndex < 0) return failResult('model-missing', `Model ${model} is not configured on provider ${provider}.`)

  const checked = normalizeEfforts(efforts, cfg.levels)
  if (checked.error !== undefined) return failResult('invalid-efforts', checked.error)

  const next = { ...currentConfig }
  const nextProviders = { ...providers }
  const nextModels = providerRaw.models.slice()
  const nextModel = { ...nextModels[modelIndex] }
  if (checked.mode === 'unset') delete nextModel.reasoningEfforts
  else if (checked.mode === 'false') nextModel.reasoningEfforts = false
  else nextModel.reasoningEfforts = checked.efforts
  nextModels[modelIndex] = nextModel
  nextProviders[provider] = { ...providerRaw, models: nextModels }
  next.providers = nextProviders

  try {
    await editor.edit(entry, () => next)
  } catch (error) {
    return failResult('write-failed', `The config editor rejected the write: ${String(error?.message ?? error)}`)
  }

  // Re-read the live tree: the reconciler may have replaced the entry object.
  const after = findTarget(safeEntries(editor) ?? [], cfg)
  const afterProviders = isRecord(after?.options?.config?.providers) ? after.options.config.providers : {}
  const afterModel = Array.isArray(afterProviders?.[provider]?.models)
    ? afterProviders[provider].models.find((candidate) => isRecord(candidate) && candidate.id === model)
    : undefined
  const written = declaredEfforts(afterModel)
  const raw = afterModel?.reasoningEfforts
  const applied = checked.mode === 'unset'
    ? raw === undefined
    : checked.mode === 'false'
      ? raw === false
      : JSON.stringify(written) === JSON.stringify(checked.efforts)
  return okResult({
    provider,
    model,
    reasoningEfforts: Object.keys(written).length === 0 ? null : written,
    declared: raw === undefined ? null : raw === false ? false : true,
    verified: applied,
  })
}

// ── HTTP channel ─────────────────────────────────────────────────────────────

/** Read one JSON request body, refusing anything past {@link MAX_REQUEST_BYTES}. */
function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    const decoder = new TextDecoder()
    let bytes = 0
    request.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes > MAX_REQUEST_BYTES) {
        reject(new Error('body too large'))
        return
      }
      chunks.push(decoder.decode(chunk, { stream: true }))
    })
    request.on('end', () => {
      try {
        chunks.push(decoder.decode())
        resolve(JSON.parse(chunks.join('')))
      } catch (error) {
        reject(error instanceof Error ? error : new Error('body is not JSON'))
      }
    })
    request.on('error', (error) => reject(error instanceof Error ? error : new Error('request stream failed')))
  })
}

/** Endpoint segment of the URL, e.g. `state`; undefined for anything else. */
function endpointOf(url, channel) {
  if (typeof url !== 'string') return undefined
  const pathname = url.split('?')[0] ?? ''
  const prefix = `${channel}/`
  if (!pathname.startsWith(prefix)) return undefined
  const endpoint = pathname.slice(prefix.length)
  return /^[A-Za-z0-9_$.-]+$/u.test(endpoint) ? endpoint : undefined
}

/** One decoded `client-request` envelope posted by the browser half. */
function parseEnvelope(value) {
  if (!isRecord(value) || value.type !== 'client-request') return undefined
  if (typeof value.rpcId !== 'string' || value.rpcId.length === 0) return undefined
  if (typeof value.method !== 'string' || value.method.length === 0) return undefined
  return { rpcId: value.rpcId, method: value.method, payload: value.payload }
}

/** One `server-response` envelope, the only body shape the browser half parses. */
function envelopeOf(rpcId, result) {
  return JSON.stringify({ type: 'server-response', rpcId, result })
}

/** Dispatch one validated endpoint. */
async function answer(ctx, cfg, endpoint, payload) {
  if (endpoint === 'state') {
    return okResult(readCatalog(ctx, cfg))
  }
  if (endpoint === 'save') {
    const request = isRecord(payload) ? payload : {}
    const provider = typeof request.provider === 'string' ? request.provider : ''
    const model = typeof request.model === 'string' ? request.model : ''
    if (provider === '' || model === '') return failResult('invalid-request', 'provider and model are required')
    if (!Object.hasOwn(request, 'efforts')) return failResult('invalid-request', 'efforts is required')
    return saveModel(ctx, cfg, provider, model, request.efforts)
  }
  return failResult('not-found', `unknown endpoint ${JSON.stringify(endpoint)}`)
}

/**
 * Mount the plugin: serve the catalog over the loopback channel.
 * @param ctx - the row's context.
 * @param config - row config from `cordis.patch.yml`.
 */
export function apply(ctx, config) {
  const cfg = normalizeConfig(config)
  if (cfg.enabled === false) return

  ctx.inject(['connection', 'webServer'], (routeCtx) => {
    const connection = routeCtx.get('connection')
    const webServer = routeCtx.get('webServer')
    if (webServer === undefined || typeof webServer.register !== 'function') return

    const respond = (response, status, body) => {
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
      response.end(body)
    }

    routeCtx.effect(() => webServer.register({
      kind: 'prefix',
      path: cfg.channel,
      async handler(request, response) {
        // Same auth fence as the shared transport: a browser from another origin
        // or without the connection cookie is rejected before any data is read.
        try {
          const rejection = typeof connection?.requestRejection === 'function'
            ? connection.requestRejection(request)
            : undefined
          if (rejection !== undefined && rejection !== null) {
            response.writeHead(rejection)
            response.end(rejection === 401 ? 'unauthorized' : 'forbidden')
            return
          }
        } catch {
          // A connection service without the fence must not make the channel
          // unreachable; the loopback listener is still the only reachable host.
        }

        const endpoint = endpointOf(request.url, cfg.channel)
        if (request.method !== 'POST' || endpoint === undefined || !ENDPOINTS.has(endpoint)) {
          response.writeHead(404)
          response.end('not found')
          return
        }
        const mediaType = String(request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase()
        if (mediaType !== 'application/json') {
          response.writeHead(415)
          response.end('content type must be application/json')
          return
        }
        let body
        try {
          body = await readJsonBody(request)
        } catch {
          response.writeHead(400)
          response.end('body is not JSON')
          return
        }
        const message = parseEnvelope(body)
        if (message === undefined || message.method !== endpoint) {
          response.writeHead(400)
          response.end('invalid client-request message')
          return
        }
        try {
          respond(response, 200, envelopeOf(message.rpcId, await answer(ctx, cfg, endpoint, message.payload)))
        } catch (error) {
          respond(response, 200, envelopeOf(
            message.rpcId,
            failResult('channel-failed', `channel failed: ${String(error?.message ?? error)}`),
          ))
        }
      },
    }), 'thinking-levels: rpc channel')
  })
}