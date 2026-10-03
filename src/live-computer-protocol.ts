import { startEventLoopProbe } from './event-loop-probe.js'
import { spawn, spawnSync } from 'node:child_process'
import type { Readable } from 'node:stream'
import { createHash } from 'node:crypto'

// Decimal byte limits. Mirrored by the native helper and checked by native
// protocol fixtures: JSON is control data; images have independent pipes.
export const captureProtocolVersion = 2
export const helperResponseLimit = 4_000_000
export const snapshotResponseLimit = 1_000_000
export const accessibilityByteLimit = 750_000
export const captureImageLimit = 25_000_000
export const captureColorBytes = 192 * 128 * 4
export const helperStderrLimit = 32 * 1024
// Mirrors the helper's captureElementLimit; both sides must agree or every capture is rejected.
export const captureElementLimit = 200

export type CaptureFailureCode = 'output_limit' | 'invalid_json' | 'invalid_response' | 'protocol_mismatch' | 'timeout' | 'cancelled' | 'process_error' | 'permission_denied' | 'target_unavailable' | 'artifact_invalid' | 'capture_changed'
export interface HelperMetrics {
  requestId: string
  action: string
  protocolVersion: number
  stdoutBytes: number
  stderrBytes: number
  stderrTruncated: boolean
  imageBytes: number
  colorBytes: number
  elapsedMs: number
  exitCode: number | null
  exitSignal: string | null
  /** Diagnostics (26 September): ms from request start to spawn() returning, to the helper's first and last stdout
   * byte; and how busy this process's main thread was meanwhile. */
  spawnMs?: number
  firstByteMs?: number | null
  lastByteMs?: number | null
  eventLoopUtilization?: number
  maxEventLoopLagMs?: number
}
export class LiveComputerHelperError extends Error {
  constructor(public readonly code: CaptureFailureCode, message: string, public readonly details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'LiveComputerHelperError'
  }
}
export interface ElementCaptureCompleteness {
  visited: number
  eligible: number
  returned: number
  accepted: number
  encodedBytes: number
  reasons: string[]
}
export interface HelperTransportResult {
  response: Record<string, unknown>
  image: Buffer
  color: Buffer
  metrics: HelperMetrics
}

/** One process, one response. A rejection is delivered only after close, so
 * the caller can safely remove files without racing a still-running writer. */
export function requestComputerHelper(helperPath: string, frameRoot: string, payload: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<HelperTransportResult> {
  if (signal?.aborted) return Promise.reject(new LiveComputerHelperError('cancelled', 'Live computer action was stopped'))
  const v2 = payload.protocolVersion === captureProtocolVersion && payload.action === 'snapshot'
  const stdoutLimit = payload.action === 'probe' ? 16_384 : v2 ? snapshotResponseLimit : helperResponseLimit
  const started = Date.now()
  const metrics: HelperMetrics = { requestId: String(payload.requestId ?? ''), action: String(payload.action), protocolVersion: v2 ? 2 : 1, stdoutBytes: 0, stderrBytes: 0, stderrTruncated: false, imageBytes: 0, colorBytes: 0, elapsedMs: 0, exitCode: null, exitSignal: null }
  return new Promise((resolve, reject) => {
    // Only named, non-secret switches cross into the helper's environment.
    const prefetch = process.env.STEWARD_AX_PREFETCH?.trim() === 'off' ? { STEWARD_AX_PREFETCH: 'off' } : {}
    const probe = startEventLoopProbe()
    const child = spawn(helperPath, [], { stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin', STEWARD_LIVE_CAPTURE_ROOT: frameRoot, ...prefetch } })
    metrics.spawnMs = Date.now() - started
    metrics.firstByteMs = null; metrics.lastByteMs = null
    child.stdout!.on('data', () => { const at = Date.now() - started; if (metrics.firstByteMs === null) metrics.firstByteMs = at; metrics.lastByteMs = at })
    const stdout: Buffer[] = [], stderr: Buffer[] = [], image: Buffer[] = [], color: Buffer[] = []
    let failure: LiveComputerHelperError | null = null
    let settled = false
    let retainedStderr = 0
    const fail = (code: CaptureFailureCode, message: string, details: Record<string, unknown> = {}) => {
      if (failure || settled) return
      failure = new LiveComputerHelperError(code, message, details)
      child.kill('SIGKILL')
    }
    const collect = (chunks: Buffer[], field: 'stdoutBytes' | 'imageBytes' | 'colorBytes', limit: number) => (chunk: Buffer) => {
      if (settled || failure) return
      metrics[field] += chunk.length
      if (metrics[field] > limit) { fail('output_limit', field === 'stdoutBytes' ? (payload.action === 'probe' ? 'Visual probe response exceeded 16 KiB' : `Live computer helper response exceeded ${v2 ? '1' : '4'} MB`) : 'Live computer image channel exceeded its limit', { stream: field, limit, observedBytes: metrics[field] }); return }
      chunks.push(chunk)
    }
    child.stdout!.on('data', collect(stdout, 'stdoutBytes', stdoutLimit))
    child.stderr!.on('data', (chunk: Buffer) => {
      metrics.stderrBytes += chunk.length
      if (retainedStderr < helperStderrLimit) {
        const kept = chunk.subarray(0, helperStderrLimit - retainedStderr)
        stderr.push(kept); retainedStderr += kept.length
      }
      metrics.stderrTruncated = metrics.stderrBytes > helperStderrLimit
    })
    ;(child.stdio[3] as Readable).on('data', collect(image, 'imageBytes', v2 ? captureImageLimit : 0))
    ;(child.stdio[4] as Readable).on('data', collect(color, 'colorBytes', v2 ? captureColorBytes : 0))
    for (const stream of child.stdio) stream?.on('error', () => fail('process_error', 'Live computer helper stream failed'))
    child.once('error', () => fail('process_error', 'Live computer helper could not be started'))
    const abort = () => fail('cancelled', 'Live computer action was stopped')
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => setImmediate(() => {
      if (settled) return
      // A hung helper leaves no trace of where it hung (doc-0929: fresh TextEdit document, standalone 2 s, in the app 50 s).
      // STEWARD_HELPER_TIMEOUT_SAMPLE=1 records its stderr and a two-second stack sample before it is stopped.
      if (process.env.STEWARD_HELPER_TIMEOUT_SAMPLE === '1' && child.pid) {
        try {
          console.error('[helper-timeout]', String(payload.action), Buffer.concat(stderr).toString('utf8').slice(-1500))
          spawnSync('/usr/bin/sample', [String(child.pid), '2', '-file', `/tmp/carve-helper-timeout-${String(payload.action)}-${Date.now()}.txt`], { timeout: 8_000 })
        } catch { /* diagnostic only */ }
      }
      fail('timeout', 'Live computer helper timed out')
    }), Math.max(1, timeoutMs))
    timer.unref()
    child.once('close', (code, exitSignal) => {
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      Object.assign(metrics, { elapsedMs: Date.now() - started, exitCode: code, exitSignal, ...probe() })
      if (failure) { Object.assign(failure.details, metrics); reject(failure); return }
      let response: Record<string, unknown>
      try {
        const raw: unknown = JSON.parse(Buffer.concat(stdout).toString('utf8'))
        if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof (raw as Record<string, unknown>).ok !== 'boolean') throw new LiveComputerHelperError('invalid_response', 'Live computer helper returned invalid response fields')
        response = raw as Record<string, unknown>
      } catch (error) {
        reject(error instanceof LiveComputerHelperError ? error : new LiveComputerHelperError('invalid_json', 'Live computer helper returned invalid JSON', { ...metrics })); return
      }
      if (code !== 0 || response.ok !== true) {
        const codes: CaptureFailureCode[] = ['output_limit', 'invalid_response', 'protocol_mismatch', 'permission_denied', 'target_unavailable', 'artifact_invalid', 'capture_changed']
        const errorCode = codes.includes(response.errorCode as CaptureFailureCode) ? response.errorCode as CaptureFailureCode : 'process_error'
        // Never put arbitrary diagnostics into the audit or capsule. Legacy
        // helper errors remain bounded for existing permission/focus handling.
        const message = typeof response.error === 'string' ? response.error.slice(0, 300) : 'Live computer helper failed'
        reject(new LiveComputerHelperError(errorCode, message, { ...metrics })); return
      }
      resolve({ response, image: Buffer.concat(image), color: Buffer.concat(color), metrics })
    })
    if (signal?.aborted) abort()
    const input = Buffer.from(JSON.stringify(payload))
    if (input.length > 256_000) fail('invalid_response', 'Live computer helper request exceeded 256 KB')
    else child.stdin!.end(input)
  })
}

export function validateBinaryChannel(raw: unknown, bytes: Buffer, expected: { kind: 'png' | 'rgba'; captureId: string; width: number; height: number }): void {
  if (!raw || typeof raw !== 'object') throw new LiveComputerHelperError('artifact_invalid', `Missing ${expected.kind} descriptor`)
  const d = raw as Record<string, unknown>
  if (d.kind !== expected.kind || d.captureId !== expected.captureId || d.width !== expected.width || d.height !== expected.height || d.byteLength !== bytes.length || bytes.length === 0 || d.sha256 !== createHash('sha256').update(bytes).digest('hex')) {
    throw new LiveComputerHelperError('artifact_invalid', `Invalid ${expected.kind} capture channel`)
  }
  if (expected.kind === 'png' && !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new LiveComputerHelperError('artifact_invalid', 'Invalid capture PNG signature')
  if (expected.kind === 'png' && (bytes.length < 24 || bytes.readUInt32BE(16) !== expected.width || bytes.readUInt32BE(20) !== expected.height)) throw new LiveComputerHelperError('artifact_invalid', 'Capture PNG dimensions do not match the manifest')
  if (expected.kind === 'rgba' && (bytes.length !== captureColorBytes || d.pixelFormat !== 'rgba8')) throw new LiveComputerHelperError('artifact_invalid', 'Invalid capture color format')
}

export function captureCompleteness(raw: unknown, returned: number, accepted: number): ElementCaptureCompleteness {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const count = (name: string) => typeof r[name] === 'number' && Number.isSafeInteger(r[name]) && r[name] >= 0 ? r[name] as number : 0
  const allowed = new Set(['time', 'depth', 'node', 'child', 'count', 'byte', 'validation', 'unavailable', 'not_requested', 'legacy_unknown', 'web_area_recovered'])
  const reasons = Array.isArray(r.reasons) ? r.reasons.filter((v): v is string => typeof v === 'string' && allowed.has(v)) : ['legacy_unknown']
  if (accepted < returned) reasons.push('validation')
  return { visited: count('visited'), eligible: count('eligible'), returned, accepted, encodedBytes: count('encodedBytes'), reasons: [...new Set(reasons)] }
}

export function validateCaptureCompleteness(raw: unknown, returned: number): void {
  if (!raw || typeof raw !== 'object') throw new LiveComputerHelperError('invalid_response', 'Missing accessibility completeness')
  const r = raw as Record<string, unknown>
  const counts = ['visited', 'eligible', 'returned', 'encodedBytes']
  const reasons = new Set(['time', 'depth', 'node', 'child', 'count', 'byte', 'validation', 'unavailable', 'not_requested', 'web_area_recovered'])
  if (counts.some(k => typeof r[k] !== 'number' || !Number.isSafeInteger(r[k]) || (r[k] as number) < 0)
    || r.returned !== returned || returned > captureElementLimit || (r.eligible as number) < returned
    || (r.encodedBytes as number) > accessibilityByteLimit || !Array.isArray(r.reasons)
    || r.reasons.some(v => typeof v !== 'string' || !reasons.has(v))) {
    throw new LiveComputerHelperError('invalid_response', 'Invalid accessibility completeness')
  }
}

/**
 * One long-lived `--serve` helper per (helper, frame root) for observation
 * requests (snapshot, probe). Per-process spawn plus ScreenCaptureKit start-up
 * cost ~170 ms of a ~485 ms capture on 23 September (docs/widgets-latency-2026-09-23.md);
 * a task takes 25–40 captures. Requests are strictly serialized. Any timeout,
 * abort, malformed frame or exit kills the process and fails that request; the
 * next request starts a fresh helper, so a wedged helper costs one capture.
 *
 * On by default since e2e-0928: every short-lived capture process left one IOSurface kernel client behind when it
 * exited. After a week of use plus one evening of packaged runs the system table was full (1,020 clients, 711 of them
 * "Carve Live Computer"); Carve's GPU process then could not start and the app quit ("GPU process isn't usable"), and
 * no other app could allocate a new surface until restart. One serving helper per session holds a fixed few.
 * `STEWARD_PERSISTENT_HELPER=off` restores one process per capture.
 */
export const persistentHelperEnabled = () => process.env.STEWARD_PERSISTENT_HELPER?.trim().toLowerCase() !== 'off'
const persistentHelpers = new Map<string, PersistentComputerHelper>()
export function persistentComputerHelper(helperPath: string, frameRoot: string): PersistentComputerHelper {
  const key = `${helperPath}\u0000${frameRoot}`
  let helper = persistentHelpers.get(key)
  if (!helper) persistentHelpers.set(key, helper = new PersistentComputerHelper(helperPath, frameRoot))
  return helper
}
export function stopPersistentComputerHelpers(): void {
  for (const helper of persistentHelpers.values()) helper.stop()
  persistentHelpers.clear()
}

export class PersistentComputerHelper {
  private child: ReturnType<typeof spawn> | null = null
  private stdout = Buffer.alloc(0)
  private image = Buffer.alloc(0)
  private color = Buffer.alloc(0)
  private wake: (() => void) | null = null
  private exited: string | null = null
  private queue: Promise<unknown> = Promise.resolve()
  /** Requests served by the current process; 0 means the next one starts it. */
  served = 0

  constructor(private readonly helperPath: string, private readonly frameRoot: string) {}

  request(payload: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<HelperTransportResult> {
    const run = this.queue.then(() => this.exchange(payload, timeoutMs, signal))
    this.queue = run.catch(() => undefined)
    return run
  }

  stop(): void {
    const child = this.child
    this.child = null; this.served = 0
    this.stdout = Buffer.alloc(0); this.image = Buffer.alloc(0); this.color = Buffer.alloc(0)
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    this.wake?.()
  }

  private start(): ReturnType<typeof spawn> {
    const prefetch = process.env.STEWARD_AX_PREFETCH?.trim() === 'off' ? { STEWARD_AX_PREFETCH: 'off' } : {}
    const child = spawn(this.helperPath, ['--serve'], { stdio: ['pipe', 'pipe', 'ignore', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin', STEWARD_LIVE_CAPTURE_ROOT: this.frameRoot, ...prefetch } })
    this.exited = null
    const poke = () => { const wake = this.wake; this.wake = null; wake?.() }
    child.stdout!.on('data', (chunk: Buffer) => { if (this.child === child) { this.stdout = Buffer.concat([this.stdout, chunk]); poke() } })
    ;(child.stdio[3] as Readable).on('data', (chunk: Buffer) => { if (this.child === child) { this.image = Buffer.concat([this.image, chunk]); poke() } })
    ;(child.stdio[4] as Readable).on('data', (chunk: Buffer) => { if (this.child === child) { this.color = Buffer.concat([this.color, chunk]); poke() } })
    for (const stream of child.stdio) stream?.on('error', () => undefined)
    child.once('error', () => { if (this.child === child) { this.exited = 'spawn_error'; poke() } })
    child.once('exit', (code, exitSignal) => { if (this.child === child) { this.exited = `exit ${code ?? exitSignal}`; poke() } })
    child.unref()
    return child
  }

  private async exchange(payload: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<HelperTransportResult> {
    if (payload.action !== 'snapshot' && payload.action !== 'probe') throw new LiveComputerHelperError('invalid_response', 'Only observation is served by a persistent helper')
    if (signal?.aborted) throw new LiveComputerHelperError('cancelled', 'Live computer action was stopped')
    const started = Date.now()
    const v2 = payload.protocolVersion === captureProtocolVersion && payload.action === 'snapshot'
    const stdoutLimit = payload.action === 'probe' ? 16_384 : v2 ? snapshotResponseLimit : helperResponseLimit
    const metrics: HelperMetrics = { requestId: String(payload.requestId ?? ''), action: String(payload.action), protocolVersion: v2 ? 2 : 1, stdoutBytes: 0, stderrBytes: 0, stderrTruncated: false, imageBytes: 0, colorBytes: 0, elapsedMs: 0, exitCode: null, exitSignal: null }
    const probe = startEventLoopProbe()
    const cold = !this.child
    const child = this.child ??= this.start()
    metrics.spawnMs = Date.now() - started
    let failure: LiveComputerHelperError | null = null
    const fail = (code: CaptureFailureCode, message: string) => { failure ??= new LiveComputerHelperError(code, message); this.wake?.() }
    const abort = () => fail('cancelled', 'Live computer action was stopped')
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => fail('timeout', 'Live computer helper timed out'), Math.max(1, timeoutMs))
    const until = async (ready: () => boolean) => {
      while (!ready()) {
        if (failure) throw failure
        if (this.exited) throw new LiveComputerHelperError('process_error', `Persistent helper ${this.exited}`)
        await new Promise<void>(resolve => { this.wake = resolve })
      }
      if (failure) throw failure
    }
    try {
      const line = Buffer.from(JSON.stringify(payload) + '\n')
      if (line.length > 256_000) throw new LiveComputerHelperError('invalid_response', 'Live computer helper request exceeded 256 KB')
      child.stdin!.write(line)
      await until(() => this.stdout.includes(10) || this.stdout.length > stdoutLimit)
      const newline = this.stdout.indexOf(10)
      if (newline < 0) throw new LiveComputerHelperError('output_limit', 'Live computer helper response exceeded its limit')
      metrics.firstByteMs = metrics.lastByteMs = Date.now() - started
      const text = this.stdout.subarray(0, newline).toString('utf8')
      this.stdout = this.stdout.subarray(newline + 1)
      metrics.stdoutBytes = newline
      let response: Record<string, unknown>
      try {
        const raw: unknown = JSON.parse(text)
        if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof (raw as Record<string, unknown>).ok !== 'boolean') throw new Error('shape')
        response = raw as Record<string, unknown>
      } catch { throw new LiveComputerHelperError('invalid_json', 'Live computer helper returned invalid JSON') }
      const length = (descriptor: unknown) => Number((descriptor as { byteLength?: unknown } | undefined)?.byteLength ?? 0)
      const imageBytes = length(response.imageChannel), colorBytes = length(response.colorChannel)
      if (!Number.isSafeInteger(imageBytes) || !Number.isSafeInteger(colorBytes) || imageBytes < 0 || colorBytes < 0 || imageBytes > captureImageLimit || colorBytes > captureColorBytes)
        throw new LiveComputerHelperError('output_limit', 'Live computer helper channel exceeded its limit')
      await until(() => this.image.length >= imageBytes && this.color.length >= colorBytes)
      const image = Buffer.from(this.image.subarray(0, imageBytes)), color = Buffer.from(this.color.subarray(0, colorBytes))
      this.image = this.image.subarray(imageBytes); this.color = this.color.subarray(colorBytes)
      metrics.imageBytes = imageBytes; metrics.colorBytes = colorBytes
      this.served += 1
      Object.assign(metrics, { elapsedMs: Date.now() - started, exitCode: 0, ...probe(), persistent: true, cold })
      if (response.ok !== true) {
        const codes: CaptureFailureCode[] = ['output_limit', 'invalid_response', 'protocol_mismatch', 'permission_denied', 'target_unavailable', 'artifact_invalid', 'capture_changed']
        const errorCode = codes.includes(response.errorCode as CaptureFailureCode) ? response.errorCode as CaptureFailureCode : 'process_error'
        throw new LiveComputerHelperError(errorCode, typeof response.error === 'string' ? response.error.slice(0, 300) : 'Live computer helper failed', { ...metrics })
      }
      return { response, image, color, metrics }
    } catch (error) {
      // A helper-reported error leaves the stream aligned; anything else may not.
      if (!(error instanceof LiveComputerHelperError && error.details.persistent === true)) this.stop()
      if (error instanceof LiveComputerHelperError) Object.assign(error.details, { ...metrics, elapsedMs: Date.now() - started, persistent: true })
      throw error
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }
}
