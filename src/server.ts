import { productExperience } from './product-experience.js'
import { acceptLegal, acknowledgeDisclosures, firstRunStatus } from './legal-consent.js'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { CarveApp } from './app.js'
import { dispatchCarveCommand, parseSupervisionPolicy, parseWorkMemoryScope } from './desktop-dispatch.js'
import { loadLocalEnv } from './env.js'
import type { AiDraftCorrection, AutonomyLevel, CapturePolicy, ObservationReviewInput, WorkBudgetPreset } from './types.js'
import type { ProcedureCorrection } from './workflows.js'

loadLocalEnv()

const builtUiRoot = resolve(process.cwd(), 'dist/ui')
const publicRoot = resolve(process.env.STEWARD_UI_DIR ?? (existsSync(resolve(builtUiRoot, 'index.html')) ? builtUiRoot : resolve(process.cwd(), 'public')))
const maxBodyBytes = 1_000_000

interface JsonObject {
  [key: string]: unknown
}

function json(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self' http://127.0.0.1:*; frame-src http://127.0.0.1:*; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...headers,
  })
  response.end(JSON.stringify(body))
}

function cookieValue(request: IncomingMessage, name: string): string | null {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue
    return part.slice(separator + 1).trim()
  }
  return null
}

function bearerValue(request: IncomingMessage): string | null {
  const authorization = request.headers.authorization
  if (!authorization?.startsWith('Bearer ')) return null
  const token = authorization.slice('Bearer '.length).trim()
  return token || null
}

function loopbackOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    const hostname = url.hostname.replace(/^\[|\]$/gu, '')
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(hostname)) return null
    return url.origin
  } catch {
    return null
  }
}

function isStateChanging(method: string | undefined): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
}

async function body(request: IncomingMessage, limit = maxBodyBytes): Promise<JsonObject> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > limit) throw new Error(`Request body exceeds ${Math.round(limit / 1_000_000)} MB`)
    chunks.push(bytes)
  }
  if (chunks.length === 0) return {}
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON object body required')
  return parsed as JsonObject
}

function stringField(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`${name} must be a string`)
  return value
}

function booleanField(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean`)
  return value
}

function serveStatic(request: IncomingMessage, response: ServerResponse): boolean {
  if (request.method !== 'GET') return false
  const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
  const requestPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const file = resolve(publicRoot, requestPath)
  if (file !== publicRoot && !file.startsWith(`${publicRoot}${sep}`)) return false
  if (!existsSync(file) || !statSync(file).isFile()) return false
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
    '.map': 'application/json; charset=utf-8',
  }
  response.writeHead(200, {
    'content-type': types[extname(file)] ?? 'application/octet-stream',
    'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self' http://127.0.0.1:*; frame-src http://127.0.0.1:*; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
  })
  createReadStream(file).pipe(response)
  return true
}

export function startServer(options: { port?: number; app?: CarveApp; authToken?: string } = {}) {
  const app = options.app ?? new CarveApp({ experience: productExperience(process.env.CARVE_EXPERIENCE), researchBrowser: true })
  const authToken = options.authToken ?? randomBytes(32).toString('base64url')
  const tokenDigest = createHash('sha256').update(authToken).digest()
  // Cookie names are process-specific because cookies do not distinguish
  // loopback ports. Two development instances must not overwrite each other.
  const cookieName = `steward_session_${tokenDigest.toString('hex').slice(0, 12)}`
  const browserOrigins = new Set<string>()
  const matchesToken = (candidate: string | null): boolean => {
    if (!candidate) return false
    const candidateDigest = createHash('sha256').update(candidate).digest()
    return timingSafeEqual(tokenDigest, candidateDigest)
  }
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost')
      if (url.pathname === '/api/auth/session') {
        if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed' })
        // This custom header makes a cross-origin browser issue a CORS
        // preflight, which Carve never permits. Fetch Metadata and a
        // loopback referrer are independent checks for the same browser boot.
        if (request.headers['x-carve-bootstrap'] !== '1' || request.headers['sec-fetch-site'] !== 'same-origin') {
          return json(response, 403, { error: 'Carve session bootstrap requires its same-origin interface' })
        }
        const browserOrigin = loopbackOrigin(request.headers.referer ?? '')
        if (!browserOrigin) return json(response, 403, { error: 'Carve session bootstrap requires a loopback interface origin' })
        browserOrigins.add(browserOrigin)
        return json(response, 200, { authenticated: true, lifetime: 'process' }, {
          'set-cookie': `${cookieName}=${authToken}; Path=/api; HttpOnly; SameSite=Strict`,
        })
      }
      if (url.pathname.startsWith('/api/')) {
        const bearer = bearerValue(request)
        const cookie = cookieValue(request, cookieName)
        const authenticatedByBearer = matchesToken(bearer)
        const authenticatedByCookie = matchesToken(cookie)
        const authenticatedOnlyByCookie = !authenticatedByBearer && authenticatedByCookie
        if (!authenticatedByBearer && !authenticatedByCookie) {
          return json(response, 401, { error: 'Carve loopback authentication required' })
        }
        if (isStateChanging(request.method)) {
          const origin = typeof request.headers.origin === 'string' ? loopbackOrigin(request.headers.origin) : null
          // Programmatic clients holding the explicit bearer may be originless.
          // Browser-cookie requests must prove both their registered UI origin
          // and a non-simple CSRF header.
          if (request.headers.origin !== undefined && (!origin || !browserOrigins.has(origin))) {
            return json(response, 403, { error: 'Request origin is not authorized for this Carve process' })
          }
          if (authenticatedOnlyByCookie && (!origin || !browserOrigins.has(origin) || request.headers['x-carve-csrf'] !== '1')) {
            return json(response, 403, { error: 'Carve CSRF validation failed' })
          }
        }
      }
      if (request.method === 'GET' && url.pathname === '/api/legal/status') return json(response, 200, firstRunStatus(app.database, app.cloud.configured))
      if (request.method === 'POST' && url.pathname === '/api/legal/acknowledge') {
        const payload = await body(request)
        const acknowledgment = acknowledgeDisclosures(app.database, stringField(payload.version, 'version'))
        app.audit.append('legal.disclosures_acknowledged', 'user', null, { ...acknowledgment })
        return json(response, 200, acknowledgment)
      }
      if (request.method === 'POST' && url.pathname === '/api/legal/accept') {
        const payload = await body(request)
        const receipt = acceptLegal(app.database, stringField(payload.version, 'version'))
        app.audit.append('legal.accepted', 'user', null, { ...receipt })
        return json(response, 200, receipt)
      }
      if (request.method === 'GET' && url.pathname === '/api/state') return json(response, 200, app.state())
      if (request.method === 'POST' && url.pathname === '/api/export') {
        const payload = await body(request)
        return json(response, 200, await app.createEncryptedExport(stringField(payload.passphrase, 'passphrase')))
      }
      if (request.method === 'GET' && url.pathname === '/api/dictation/sharing') return json(response, 200, app.dictationSharing())
      if (request.method === 'POST' && url.pathname === '/api/dictation/sharing') {
        const payload = await body(request)
        if (typeof payload.enabled !== 'boolean' || (payload.remember !== undefined && typeof payload.remember !== 'boolean')) throw new Error('Invalid dictation sharing choice')
        return json(response, 200, app.setDictationSharing(payload.enabled, payload.remember === true))
      }
      if (request.method === 'POST' && url.pathname === '/api/dictation') {
        // Base64 audio clips are legitimately larger than the JSON default.
        const payload = await body(request, 12_000_000)
        return json(response, 200, await app.transcribeDictation(stringField(payload.audioBase64, 'audioBase64'), stringField(payload.mimeType, 'mimeType')))
      }
      if (request.method === 'POST' && url.pathname === '/api/dictation/stream') {
        const payload = await body(request, 2_000_000)
        const op = stringField(payload.op, 'op')
        if (op === 'begin') return json(response, 200, app.beginDictationStream(stringField(payload.mimeType, 'mimeType')))
        if (op === 'push') return json(response, 200, app.pushDictationStream(stringField(payload.sessionId, 'sessionId'), stringField(payload.audioBase64, 'audioBase64')))
        if (op === 'end') return json(response, 200, await app.endDictationStream(stringField(payload.sessionId, 'sessionId')))
        throw new Error('Unknown dictation stream operation')
      }
      if (request.method === 'GET' && url.pathname === '/api/recall/unread-count') return json(response, 200, { unread: app.recallUnreadCount() })
      if (request.method === 'GET' && url.pathname === '/api/recall/conversations') return json(response, 200, { conversations: app.listRecallConversations() })
      const recallConversationMatch = url.pathname.match(/^\/api\/recall\/conversations\/([^/]+)$/u)
      if (recallConversationMatch?.[1]) {
        const conversationId = decodeURIComponent(recallConversationMatch[1])
        if (request.method === 'GET') return json(response, 200, app.getRecallConversation(conversationId))
        if (request.method === 'PATCH') {
          const payload = await body(request)
          if (typeof payload.title !== 'string') return json(response, 400, { error: 'A conversation title is required' })
          return json(response, 200, app.renameRecallConversation(conversationId, payload.title))
        }
        if (request.method === 'DELETE') return json(response, 200, app.deleteRecallConversation(conversationId))
      }
      if (request.method === 'POST' && url.pathname === '/api/recall/enrich') {
        const payload = await body(request)
        const momentIds = Array.isArray(payload.momentIds) ? payload.momentIds.filter((id): id is string => typeof id === 'string') : undefined
        const scope = payload.scope && typeof payload.scope === 'object' ? payload.scope as { fromIso: string | null; toIso: string | null; label: string | null; sessionIds?: string[] } : undefined
        return json(response, 200, await app.enrichRecallText({
          ...(momentIds === undefined ? {} : { momentIds }),
          ...(scope === undefined ? {} : { scope }),
        }))
      }
      if (request.method === 'POST' && url.pathname === '/api/recall/unread-captures') {
        const payload = await body(request)
        const bound = (value: unknown): string | null => (typeof value === 'string' && value ? value : null)
        const sessionIds = Array.isArray(payload.sessionIds) ? payload.sessionIds.filter((id): id is string => typeof id === 'string') : []
        return json(response, 200, { captures: app.recallUnreadCaptures(bound(payload.fromIso), bound(payload.toIso), sessionIds) })
      }
      if (request.method === 'POST' && url.pathname === '/api/recall/skip-captures') {
        const payload = await body(request)
        if (!Array.isArray(payload.momentIds)) return json(response, 400, { error: 'momentIds must be an array' })
        return json(response, 200, app.skipRecallCaptures(payload.momentIds.filter((id): id is string => typeof id === 'string')))
      }
      if (request.method === 'POST' && url.pathname === '/api/recall/clear-skips') return json(response, 200, app.clearRecallSkips())
      if (request.method === 'GET' && url.pathname === '/api/receipts') return json(response, 200, { receipts: app.receipts() })
      const receiptMatch = url.pathname.match(/^\/api\/receipts\/([^/]+)$/u)
      if (request.method === 'GET' && receiptMatch?.[1]) return json(response, 200, app.receipt(decodeURIComponent(receiptMatch[1])))
      if (request.method === 'GET' && url.pathname === '/api/autonomy') return json(response, 200, { workflows: app.autonomyLedger() })
      if (request.method === 'POST' && url.pathname === '/api/autonomy/recommend') {
        const payload = await body(request)
        if (typeof payload.goal !== 'string') return json(response, 400, { error: 'goal is required' })
        return json(response, 200, app.recommendedSupervision(payload.goal))
      }
      if (request.method === 'POST' && url.pathname === '/api/autonomy/decide') {
        const payload = await body(request)
        if (typeof payload.workflowKey !== 'string' || (payload.decision !== 'accept' && payload.decision !== 'decline')) return json(response, 400, { error: 'workflowKey and decision are required' })
        return json(response, 200, { workflows: app.autonomyDecide(payload.workflowKey, payload.decision) })
      }
      if (request.method === 'GET' && url.pathname === '/api/cloud/status') return json(response, 200, app.cloudStatus())
      if (request.method === 'POST' && url.pathname === '/api/cloud/refresh') return json(response, 200, await app.cloudRefresh())
      if (request.method === 'POST' && ['/api/cloud/browser/start', '/api/cloud/browser/finish', '/api/cloud/browser/cancel'].includes(url.pathname)) {
        const payload = await body(request)
        return json(response, 200, await dispatchCarveCommand(app, { ...payload, kind: `cloud.browser.${url.pathname.split('/').at(-1)}` }))
      }
      if (request.method === 'POST' && url.pathname === '/api/cloud/signin/status') {
        const payload = await body(request)
        if (typeof payload.ticket !== 'string') return json(response, 400, { error: 'ticket is required' })
        return json(response, 200, await app.cloudSignInVerificationStatus(payload.ticket))
      }
      if (request.method === 'POST' && url.pathname === '/api/cloud/signin/start') {
        const payload = await body(request)
        if (typeof payload.email !== 'string') return json(response, 400, { error: 'email is required' })
        return json(response, 200, await app.cloudSignInStart(payload.email))
      }
      if (request.method === 'POST' && url.pathname === '/api/cloud/signin/verify') {
        const payload = await body(request)
        if (typeof payload.challengeId !== 'string' || typeof payload.code !== 'string') return json(response, 400, { error: 'challengeId and code are required' })
        return json(response, 200, await app.cloudSignInVerify(payload.challengeId, payload.code, typeof payload.termsVersion === 'string' ? payload.termsVersion : undefined))
      }
      if (request.method === 'POST' && url.pathname === '/api/cloud/signout-all') return json(response, 200, await app.cloudSignOutAll())
      if (request.method === 'POST' && url.pathname === '/api/cloud/signout') return json(response, 200, await app.cloudSignOut())
      if (request.method === 'POST' && url.pathname === '/api/cloud/checkout') {
        const payload = await body(request)
        const pick = <T extends string>(value: unknown, options: readonly T[]): T | undefined => (typeof value === 'string' && (options as readonly string[]).includes(value) ? value as T : undefined)
        const pack = pick(payload.pack, ['tasks_20', 'tasks_100'] as const)
        const plan = pick(payload.plan, ['pro', 'max', 'own_key'] as const)
        const interval = pick(payload.interval, ['month', 'year', 'lifetime'] as const)
        if (pack) return json(response, 200, { url: await app.cloudCheckoutUrl({ pack }) })
        if (!plan || !interval) return json(response, 400, { error: 'Choose a plan and interval, or a task pack' })
        return json(response, 200, { url: await app.cloudCheckoutUrl({ plan, interval }) })
      }
      if (request.method === 'POST' && url.pathname === '/api/cloud/portal') return json(response, 200, { url: await app.cloudPortalUrl() })
      if (request.method === 'POST' && url.pathname === '/api/cloud/delete-account') {
        const payload = await body(request)
        if (typeof payload.confirmation !== 'string') return json(response, 400, { error: 'confirmation is required' })
        return json(response, 200, await app.cloudDeleteAccount(payload.confirmation))
      }
      const modelsMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/models$/u)
      if (request.method === 'GET' && modelsMatch?.[1]) return json(response, 200, { models: await app.providers.listModels(decodeURIComponent(modelsMatch[1])) })
      const setModelMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/model$/u)
      if (request.method === 'POST' && setModelMatch?.[1]) {
        const payload = await body(request)
        if (typeof payload.model !== 'string') return json(response, 400, { error: 'model must be a string' })
        return json(response, 200, app.providers.setModel(decodeURIComponent(setModelMatch[1]), payload.model))
      }
      if (request.method === 'GET' && url.pathname === '/api/models/rate') {
        return json(response, 200, { rate: app.modelRate(url.searchParams.get('providerId') ?? '', url.searchParams.get('model') ?? '') })
      }
      if (request.method === 'POST' && url.pathname === '/api/models/rate') {
        const payload = await body(request)
        const input = payload.inputPerMillion
        const output = payload.outputPerMillion
        const rate = typeof input === 'number' && typeof output === 'number' ? { inputPerMillion: input, outputPerMillion: output } : null
        app.setModelRate(String(payload.providerId), String(payload.model), rate)
        return json(response, 200, { rate })
      }
      if (request.method === 'POST' && url.pathname === '/api/recall/image-consent') {
        const payload = await body(request)
        const providerId = payload.providerId
        if (providerId !== null && typeof providerId !== 'string') return json(response, 400, { error: 'providerId must be a string or null' })
        return json(response, 200, { providerId: app.setImageConsent(providerId) })
      }
      if (request.method === 'GET' && url.pathname === '/api/embedding/policy') return json(response, 200, app.embeddingPolicy())
      if (request.method === 'POST' && url.pathname === '/api/embedding/mode') {
        const payload = await body(request)
        const mode = payload.mode
        if (mode !== 'off' && mode !== 'local' && mode !== 'hosted') return json(response, 400, { error: 'mode must be off, local, or hosted' })
        app.setEmbeddingMode(mode)
        return json(response, 200, app.embeddingPolicy())
      }
      if (request.method === 'POST' && url.pathname === '/api/embedding/consent') {
        const payload = await body(request)
        const providerId = payload.providerId
        if (providerId !== null && typeof providerId !== 'string') return json(response, 400, { error: 'providerId must be a string or null' })
        app.setEmbeddingConsent(providerId)
        return json(response, 200, app.embeddingPolicy())
      }
      if (request.method === 'GET' && url.pathname === '/api/cost/debug') return json(response, 200, { enabled: app.costDebugEnabled() })
      if (request.method === 'POST' && url.pathname === '/api/cost/debug') {
        const payload = await body(request)
        return json(response, 200, { enabled: app.setCostDebug(payload.enabled === true) })
      }
      if (request.method === 'GET' && url.pathname === '/api/cost/observation') {
        return json(response, 200, app.observationCostEstimate(Number(url.searchParams.get('intervalSeconds') ?? 5), url.searchParams.get('readsText') === 'true'))
      }
      if (request.method === 'GET' && url.pathname === '/api/cost/induction') {
        return json(response, 200, app.aiInductionCostEstimate(url.searchParams.get('sessionId') ?? '', url.searchParams.get('providerId') ?? ''))
      }
      if (request.method === 'GET' && url.pathname === '/api/models/spend') return json(response, 200, app.modelSpend(url.searchParams.get('since')))
      if (request.method === 'GET' && url.pathname === '/api/recall/answer-policy') {
        const providerId = url.searchParams.get('providerId')
        return json(response, 200, await app.recallAnswerPolicy(providerId ?? undefined))
      }
      if (request.method === 'POST' && url.pathname === '/api/recall/scope-count') {
        const payload = await body(request)
        const bound = (value: unknown): string | null => (typeof value === 'string' && value ? value : null)
        const sessionIds = Array.isArray(payload.sessionIds) ? payload.sessionIds.filter((id): id is string => typeof id === 'string') : []
        return json(response, 200, app.recallScopeCount(bound(payload.fromIso), bound(payload.toIso), sessionIds))
      }
      if (request.method === 'POST' && url.pathname === '/api/recall/answer-consent') {
        const payload = await body(request)
        const providerId = payload.providerId
        if (providerId !== null && typeof providerId !== 'string') return json(response, 400, { error: 'providerId must be a string or null' })
        return json(response, 200, await app.setRecallAnswerConsent(providerId))
      }
      if (request.method === 'POST' && url.pathname === '/api/recall') {
        const payload = await body(request)
        if (typeof payload.question !== 'string') return json(response, 400, { error: 'A recall question is required' })
        const infer = payload.infer === true
          ? {
              required: true,
              ...(typeof payload.providerId === 'string' ? { providerId: payload.providerId } : {}),
              ...(payload.depth === 'brief' || payload.depth === 'normal' || payload.depth === 'thorough' ? { depth: payload.depth as 'brief' | 'normal' | 'thorough' } : {}),
              ...(payload.withImages === true ? { withImages: true } : {}),
            }
          : null
        const scope = payload.scope && typeof payload.scope === 'object'
          ? { scope: payload.scope as { fromIso: string | null; toIso: string | null; label: string | null; sessionIds?: string[] } }
          : {}
        return json(response, 200, await app.recall(payload.question, {
          ...scope,
          ...(infer ? { infer } : {}),
          ...(typeof payload.conversationId === 'string' ? { conversationId: payload.conversationId } : {}),
          ...(typeof payload.save === 'boolean' ? { save: payload.save } : {}),
          ...(typeof payload.replaceLast === 'boolean' ? { replaceLast: payload.replaceLast } : {}),
        }))
      }
      if (request.method === 'POST' && url.pathname === '/api/ambient/text') {
        const payload = await body(request)
        if (typeof payload.enabled !== 'boolean') return json(response, 400, { error: 'Ambient text must be a boolean' })
        return json(response, 200, app.setAmbientTextEnabled(payload.enabled))
      }
      if (request.method === 'POST' && url.pathname === '/api/ambient/enabled') {
        const payload = await body(request)
        if (typeof payload.enabled !== 'boolean') return json(response, 400, { error: 'Ambient enabled must be a boolean' })
        return json(response, 200, app.setAmbientEnabled(payload.enabled))
      }
      const dismissMatch = /^\/api\/ambient\/candidates\/([^/]+)\/dismiss$/u.exec(url.pathname)
      if (request.method === 'POST' && dismissMatch?.[1]) {
        app.dismissWorkflowCandidate(decodeURIComponent(dismissMatch[1]))
        return json(response, 200, { dismissed: true })
      }
      if (request.method === 'GET' && url.pathname === '/api/native-capture/status') return json(response, 200, await app.refreshNativeCaptureStatus())

      const screenshotAction = url.pathname.match(/^\/api\/observations\/([^/]+)\/screenshot$/u)
      if (request.method === 'GET' && screenshotAction?.[1]) return json(response, 200, await app.readObservationScreenshot(decodeURIComponent(screenshotAction[1])))

      const reviewAction = url.pathname.match(/^\/api\/observations\/([^/]+)\/reviews$/u)
      if (request.method === 'POST' && reviewAction?.[1]) return json(response, 200, await app.saveObservationReview(decodeURIComponent(reviewAction[1]), await body(request) as unknown as ObservationReviewInput))

      const observationAction = url.pathname.match(/^\/api\/observations\/([^/]+)$/u)
      if (request.method === 'DELETE' && observationAction?.[1]) {
        const input = await body(request)
        if (input.confirmation !== 'DELETE OBSERVATION') throw new Error('Exact observation deletion confirmation required')
        return json(response, 200, await app.deleteObservationPermanently(decodeURIComponent(observationAction[1])))
      }

      if (request.method === 'POST' && url.pathname === '/api/sessions') {
        const input = await body(request)
        const session = app.startSession(
          stringField(input.name, 'name'),
          stringField(input.fixtureId, 'fixtureId'),
          (input.capturePolicy ?? {}) as Partial<CapturePolicy>,
        )
        return json(response, 201, session)
      }

      const sessionAction = url.pathname.match(/^\/api\/sessions\/([^/]+)\/(capture|pause|resume|stop)$/u)
      if (request.method === 'POST' && sessionAction?.[1] && sessionAction[2]) {
        const sessionId = decodeURIComponent(sessionAction[1])
        const result = sessionAction[2] === 'capture'
          ? await app.captureNext(sessionId)
          : sessionAction[2] === 'pause'
            ? app.pauseSession(sessionId)
            : sessionAction[2] === 'resume'
              ? app.resumeSession(sessionId)
              : await app.stopSessionAndName(sessionId)
        return json(response, 200, result)
      }

      const procedureAction = url.pathname.match(/^\/api\/procedures\/([^/]+)\/corrections$/u)
      if (request.method === 'POST' && procedureAction?.[1]) {
        return json(response, 200, app.correctProcedure(decodeURIComponent(procedureAction[1]), await body(request) as unknown as ProcedureCorrection))
      }

      if (request.method === 'POST' && url.pathname === '/api/ai-induction/disclosure') {
        const input = await body(request)
        return json(response, 200, app.aiInductionDisclosure(stringField(input.sessionId, 'sessionId'), stringField(input.providerId, 'providerId')))
      }

      if (request.method === 'POST' && url.pathname === '/api/ai-induction/analyze') {
        const input = await body(request)
        return json(response, 201, await app.analyzeReviewedSession(
          stringField(input.sessionId, 'sessionId'),
          stringField(input.providerId, 'providerId'),
          stringField(input.manifestHash, 'manifestHash'),
          typeof input.confirmation === 'string' ? input.confirmation : undefined,
        ))
      }

      const aiDraftCorrection = url.pathname.match(/^\/api\/ai-drafts\/([^/]+)\/corrections$/u)
      if (request.method === 'POST' && aiDraftCorrection?.[1]) {
        return json(response, 201, app.correctAiDraft(decodeURIComponent(aiDraftCorrection[1]), await body(request) as unknown as AiDraftCorrection))
      }

      const aiDraftDecision = url.pathname.match(/^\/api\/ai-drafts\/([^/]+)\/(accept|reject)$/u)
      if (request.method === 'POST' && aiDraftDecision?.[1] && aiDraftDecision[2]) {
        return json(response, 200, app.decideAiDraft(decodeURIComponent(aiDraftDecision[1]), aiDraftDecision[2] as 'accept' | 'reject'))
      }

      if (request.method === 'POST' && url.pathname === '/api/work/prepare') {
        const input = await body(request)
        const providerId = typeof input.providerId === 'string' ? input.providerId : undefined
        const selection = input.selection && typeof input.selection === 'object' && !Array.isArray(input.selection)
          ? { interpretationId: stringField((input.selection as Record<string, unknown>).interpretationId, 'interpretationId') }
          : undefined
        const memory = input.memory === undefined ? undefined : parseWorkMemoryScope(input.memory)
        const followUpRunId = typeof input.followUpRunId === 'string' && input.followUpRunId.trim() ? input.followUpRunId : undefined
        const budget = input.budget === undefined ? undefined : stringField(input.budget, 'budget') as WorkBudgetPreset
        const freshSession = input.freshSession === undefined ? undefined : booleanField(input.freshSession, 'freshSession')
        const intent = input.intent === undefined ? undefined : stringField(input.intent, 'intent') as 'context_only' | 'plan_only' | 'execute'
        const supervision = input.supervision === undefined ? undefined : parseSupervisionPolicy(input.supervision)
        if ((intent === undefined) !== (supervision === undefined)) throw new Error('Work intent and supervision policy must be provided together')
        if (intent !== undefined && !['context_only', 'plan_only', 'execute'].includes(intent)) throw new Error('Work intent is unknown')
        if (budget !== undefined && !['quick', 'balanced', 'thorough'].includes(budget)) throw new Error('Work budget must be quick, balanced, or thorough')
        return json(response, 201, await app.prepareWork(
          stringField(input.goal, 'goal'),
          stringField(input.autonomy, 'autonomy') as AutonomyLevel,
          providerId,
          stringRecord(input.parameterValues, 'parameterValues'),
          selection,
          memory,
          followUpRunId,
          budget,
          freshSession,
          intent,
          supervision,
        ))
      }

      if (request.method === 'POST' && url.pathname === '/api/plans') {
        const input = await body(request)
        const providerId = typeof input.providerId === 'string' ? input.providerId : undefined
        const intent = input.intent === undefined ? undefined : stringField(input.intent, 'intent') as 'context_only' | 'plan_only' | 'execute'
        const supervision = input.supervision === undefined ? undefined : parseSupervisionPolicy(input.supervision)
        if ((intent === undefined) !== (supervision === undefined)) throw new Error('Work intent and supervision policy must be provided together')
        if (intent !== undefined && !['context_only', 'plan_only', 'execute'].includes(intent)) throw new Error('Work intent is unknown')
        return json(response, 201, app.createPlan(
          stringField(input.goal, 'goal'),
          stringField(input.autonomy, 'autonomy') as AutonomyLevel,
          providerId,
          stringRecord(input.parameterValues, 'parameterValues'),
          intent,
          supervision,
        ))
      }

      const runAction = url.pathname.match(/^\/api\/runs\/([^/]+)\/(start|stop)$/u)
      if (request.method === 'POST' && runAction?.[1] && runAction[2]) {
        const runId = decodeURIComponent(runAction[1])
        if (runAction[2] === 'start') {
          void app.executeRun(runId).catch((error: unknown) => app.audit.append('agent.run_crashed', 'system', runId, { error: String(error) }))
          return json(response, 202, { runId, started: true })
        }
        return json(response, 200, app.executor.stop(runId))
      }

      const recoveryAction = url.pathname.match(/^\/api\/runs\/([^/]+)\/recovery\/(create|dismiss)$/u)
      if (request.method === 'POST' && recoveryAction?.[1] && recoveryAction[2]) {
        const runId = decodeURIComponent(recoveryAction[1])
        const input = await body(request)
        const providerId = typeof input.providerId === 'string' ? input.providerId : undefined
        return json(response, recoveryAction[2] === 'create' ? 201 : 200, recoveryAction[2] === 'create' ? app.createRecoveryPlan(runId, providerId) : app.dismissRecovery(runId))
      }

      const approvalAction = url.pathname.match(/^\/api\/approvals\/([^/]+)\/(approve|cancel)$/u)
      if (request.method === 'POST' && approvalAction?.[1] && approvalAction[2]) {
        const approvalId = decodeURIComponent(approvalAction[1])
        return json(response, 200, approvalAction[2] === 'approve' ? app.executor.approve(approvalId) : app.executor.cancelApproval(approvalId))
      }

      const checkpointAction = url.pathname.match(/^\/api\/checkpoints\/([^/]+)\/(approve|decline)$/u)
      if (request.method === 'POST' && checkpointAction?.[1] && checkpointAction[2]) {
        const checkpointId = decodeURIComponent(checkpointAction[1])
        return json(response, 200, checkpointAction[2] === 'approve'
          ? app.executor.approveCheckpoint(checkpointId)
          : app.executor.declineCheckpoint(checkpointId))
      }

      const supervisionChange = url.pathname.match(/^\/api\/runs\/([^/]+)\/supervision$/u)
      if (request.method === 'POST' && supervisionChange?.[1]) {
        const input = await body(request)
        const preset = stringField(input.preset, 'preset')
        if (!['fast', 'smart_checkpoints', 'step_by_step', 'autopilot'].includes(preset)) throw new Error('Supervision preset is unknown')
        return json(response, 200, app.amendRunSupervision(decodeURIComponent(supervisionChange[1]), preset as 'fast' | 'smart_checkpoints' | 'step_by_step' | 'autopilot'))
      }

      const providerAction = url.pathname.match(/^\/api\/providers\/([^/]+)\/(select|health)$/u)
      if (request.method === 'POST' && providerAction?.[1] && providerAction[2]) {
        const providerId = decodeURIComponent(providerAction[1])
        if (providerAction[2] === 'select') {
          const selected = app.providers.select(providerId)
          app.audit.append('model.provider_selected', 'user', providerId, { kind: selected.kind, model: selected.model, privacyNote: selected.privacyNote })
          return json(response, 200, selected)
        }
        return json(response, 200, await app.providers.get(providerId).health())
      }

      if (request.method === 'POST' && url.pathname === '/api/global-stop') {
        app.globalStop()
        return json(response, 200, { stopped: true })
      }
      if (request.method === 'POST' && url.pathname === '/api/native-capture/request-permission') return json(response, 200, await app.requestNativeScreenPermission())
      if (request.method === 'POST' && url.pathname === '/api/browser-sandbox/reset') {
        const input = await body(request)
        const priority = stringField(input.priority, 'priority')
        if (priority !== 'urgent' && priority !== 'standard') throw new Error('priority must be urgent or standard')
        const application = input.application === undefined ? 'triage' : stringField(input.application, 'application')
        if (!['triage', 'handoff', 'document', 'insurance', 'research', 'data', 'hr', 'logistics', 'legal', 'inventory', 'quality'].includes(application)) throw new Error('application is not a supported sandbox scenario')
        const layout = input.layout === undefined ? 'baseline' : stringField(input.layout, 'layout')
        if (layout !== 'baseline' && layout !== 'changed' && layout !== 'ambiguous') throw new Error('layout must be baseline, changed, or ambiguous')
        return json(response, 200, await app.resetBrowserSandbox(priority, application as Parameters<typeof app.resetBrowserSandbox>[1], layout))
      }
      if (request.method === 'POST' && url.pathname === '/api/computer-lab/run') {
        const input = await body(request)
        const scenarioId = stringField(input.scenarioId, 'scenarioId')
        const architectureId = stringField(input.architectureId, 'architectureId')
        const variation = stringField(input.variation, 'variation')
        if (!['document_end', 'insurance_claim', 'web_research', 'data_reconciliation', 'hr_onboarding', 'logistics_exception', 'contract_intake', 'inventory_variance', 'quality_hold', 'support_triage', 'customer_handoff'].includes(scenarioId)) throw new Error('Unknown computer-use scenario')
        if (!['reactive_pixel', 'stateful_visual', 'hybrid_grounded', 'hierarchical_governed'].includes(architectureId)) throw new Error('Unknown computer-use architecture')
        if (!['baseline', 'changed', 'ambiguous'].includes(variation)) throw new Error('variation must be baseline, changed, or ambiguous')
        return json(response, 200, app.runComputerUseSimulation(
          scenarioId as Parameters<typeof app.runComputerUseSimulation>[0],
          architectureId as Parameters<typeof app.runComputerUseSimulation>[1],
          variation as Parameters<typeof app.runComputerUseSimulation>[2],
        ))
      }
      if (request.method === 'POST' && url.pathname === '/api/computer-lab/run-suite') {
        const input = await body(request)
        const architectureId = input.architectureId === undefined ? undefined : stringField(input.architectureId, 'architectureId')
        if (architectureId !== undefined && !['reactive_pixel', 'stateful_visual', 'hybrid_grounded', 'hierarchical_governed'].includes(architectureId)) throw new Error('Unknown computer-use architecture')
        return json(response, 200, app.runComputerUseSimulationSuite(architectureId as Parameters<typeof app.runComputerUseSimulationSuite>[0]))
      }
      if (request.method === 'DELETE' && url.pathname === '/api/computer-lab/results') {
        app.clearComputerUseSimulations()
        return json(response, 200, { cleared: true })
      }
      if (request.method === 'POST' && url.pathname === '/api/evaluations/preview') {
        const input = await body(request)
        const suite = stringField(input.suite, 'suite')
        if (suite !== 'dictation' && suite !== 'computer') throw new Error('suite must be dictation or computer')
        return json(response, 200, app.previewEvaluationCampaign(suite))
      }
      if (request.method === 'POST' && url.pathname === '/api/evaluations/run') {
        const input = await body(request)
        const suite = stringField(input.suite, 'suite')
        const manifestHash = stringField(input.manifestHash, 'manifestHash')
        if (suite !== 'dictation' && suite !== 'computer') throw new Error('suite must be dictation or computer')
        if (!/^[a-f0-9]{64}$/.test(manifestHash)) throw new Error('manifestHash must be a lowercase SHA-256 digest')
        return json(response, 200, await app.runEvaluationCampaign(suite, manifestHash))
      }
      if (request.method === 'POST' && url.pathname === '/api/purge') {
        const input = await body(request)
        if (input.confirm !== 'DELETE ALL STEWARD DATA') throw new Error('Exact deletion confirmation phrase required')
        await app.purgeData()
        return json(response, 200, { deleted: true })
      }

      if (serveStatic(request, response)) return
      json(response, 404, { error: 'Not found' })
    } catch (error) {
      json(response, 400, { error: error instanceof Error ? error.message : String(error) })
    }
  })

  const port = options.port ?? Number(process.env.STEWARD_PORT ?? 4377)
  server.listen(port, '127.0.0.1')
  server.on('listening', () => {
    const address = server.address()
    const actualPort = typeof address === 'object' && address ? address.port : port
    console.log(`Carve is running at http://127.0.0.1:${actualPort}`)
    console.log(`Local data: ${app.dataDir}`)
  })
  const shutdown = (): void => {
    server.close(() => app.close())
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  server.once('close', () => {
    process.off('SIGINT', shutdown)
    process.off('SIGTERM', shutdown)
  })
  return { server, app, authToken }
}

function stringRecord(value: unknown, name: string): Record<string, string> {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some((item) => typeof item !== 'string')) throw new Error(`${name} must contain only string values`)
  return value as Record<string, string>
}

if (process.env.NODE_ENV !== 'test') startServer()
