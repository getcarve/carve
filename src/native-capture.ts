import { chmod, mkdir, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { basename, resolve } from 'node:path'
import type { AmbientSample, CapturePolicy, CapturedFacts, RegionExclusion } from './types.js'

export type NativePermissionStatus = 'granted' | 'denied' | 'restricted' | 'unknown' | 'not_applicable'

/** Set when capture() returns null so the caller can audit why nothing was stored. */
export type NativeCaptureSkipReason = 'duplicate' | 'self_observation' | null

export interface NativeChangeProbe {
  observedAtMs: number
  app: string
  bundleIdentifier: string
  windowTitle: string
  windowId: number
  width: number
  height: number
  excluded: boolean
  exclusionReason: string | null
  selfObservation: boolean
  waiting: boolean
  meanDifference: number
  changedAreaRatio: number
}

export interface NativeChangeProbeHandle {
  stop(): void
  done: Promise<void>
}

/**
 * Reads a stored capture straight from the capture root. Viewing evidence that
 * is already on disk is filesystem work, not screen-capture work, so it must
 * not depend on the helper being present or permitted. Path confinement lives
 * here so every caller inherits it.
 */
export async function readCaptureFile(dataDir: string, relativePath: string): Promise<string | null> {
  if (!relativePath.startsWith('native-captures/')) return null
  const root = resolve(dataDir, 'native-captures')
  const path = resolve(root, basename(relativePath))
  if (!path.startsWith(`${root}/`) || !existsSync(path)) return null
  const bytes = await readFile(path)
  if (bytes.length > 25_000_000) throw new Error('Capture preview exceeds the 25 MB safety limit')
  return `data:image/png;base64,${bytes.toString('base64')}`
}

/** Upper bound on stored OCR text per capture. */
export const maxScreenTextChars = 8_000

export interface NativeCaptureStatus {
  available: boolean
  platform: 'darwin' | 'unsupported'
  mode: 'observation_only'
  helperVersion: string | null
  screenRecording: NativePermissionStatus
  accessibility: NativePermissionStatus
  supportedSignals: {
    screenshots: boolean
    activeWindow: boolean
    accessibilityTree: boolean
    adaptiveObservation?: boolean
    inputEvents: false
    computerControl: false
  }
  reason: string | null
}

export interface NativeCaptureAdapter {
  summary(): NativeCaptureStatus
  refreshStatus(): Promise<NativeCaptureStatus>
  requestScreenPermission(): Promise<NativeCaptureStatus>
  capture(sessionId: string, sequence: number, policy: CapturePolicy): Promise<CapturedFacts | null>
  /** Starts a memory-only low-resolution change monitor. No probe is encoded, written, or OCR'd. */
  startChangeProbe?(policy: CapturePolicy, onProbe: (probe: NativeChangeProbe) => void, onError: (error: Error) => void): NativeChangeProbeHandle
  lastSkipReason?(): NativeCaptureSkipReason
  /** Frontmost application and window title only. Never writes or encodes pixels. */
  sampleWindow?(excludedApplications: string[], excludedWindows: string[], extractText?: boolean): Promise<AmbientSample | null>
  /** Reads text from a capture already on disk. Needs no Screen Recording permission. */
  recognizeStored?(relativePath: string): Promise<string>
  readScreenshot(relativePath: string): Promise<string | null>
  sanitizeScreenshot(relativePath: string, outputName: string, crop: RegionExclusion | null, masks: RegionExclusion[]): Promise<NativeSanitizedScreenshot>
  deleteScreenshot(relativePath: string): Promise<boolean>
  close(): void
}

export interface NativeSanitizedScreenshot {
  relativePath: string
  sha256: string
  width: number
  height: number
  redactedRegionCount: number
}

const unavailableStatus = (reason: string): NativeCaptureStatus => ({
  available: false,
  platform: process.platform === 'darwin' ? 'darwin' : 'unsupported',
  mode: 'observation_only',
  helperVersion: null,
  screenRecording: process.platform === 'darwin' ? 'unknown' : 'not_applicable',
  accessibility: process.platform === 'darwin' ? 'unknown' : 'not_applicable',
  supportedSignals: {
    screenshots: false,
    activeWindow: false,
    accessibilityTree: false,
    adaptiveObservation: false,
    inputEvents: false,
    computerControl: false,
  },
  reason,
})

export class UnavailableNativeCapture implements NativeCaptureAdapter {
  private readonly status: NativeCaptureStatus

  constructor(reason = 'Native capture is available only in the macOS desktop app') {
    this.status = unavailableStatus(reason)
  }

  summary(): NativeCaptureStatus { return this.status }
  async refreshStatus(): Promise<NativeCaptureStatus> { return this.status }
  async requestScreenPermission(): Promise<NativeCaptureStatus> { throw new Error(this.status.reason ?? 'Native capture is unavailable') }
  async capture(): Promise<null> { throw new Error(this.status.reason ?? 'Native capture is unavailable') }
  async sampleWindow(): Promise<null> { return null }
  async recognizeStored(): Promise<string> { return '' }
  async readScreenshot(): Promise<null> { return null }
  async sanitizeScreenshot(): Promise<never> { throw new Error(this.status.reason ?? 'Native capture is unavailable') }
  async deleteScreenshot(): Promise<boolean> { return false }
  close(): void {}
}

interface HelperStatusResponse {
  ok: true
  helperVersion: string
  screenRecording: boolean
  accessibility: boolean
  adaptiveObservation?: boolean
}

interface HelperCaptureResponse {
  ok: true
  app: string
  bundleIdentifier: string
  windowTitle: string
  windowId: number
  width: number
  height: number
  screenshotWritten: boolean
  screenshotSha256: string | null
  text: string | null
  textLineCount: number
  redactedRegionCount: number
  excluded: boolean
  exclusionReason: string | null
  accessibility?: Array<{
    role: string
    name: string
    identifier?: string
    value?: string
    bounds?: RegionExclusion
    sensitive: boolean
  }>
}

interface HelperSanitizeResponse {
  ok: true
  width: number
  height: number
  screenshotSha256: string
  redactedRegionCount: number
}

interface HelperSkipResponse {
  ok: true
  skipped: 'self_observation' | 'duplicate'
}

interface HelperProbeResponse extends NativeChangeProbe {
  ok: true
  kind: 'probe'
}

type HelperResponse = HelperStatusResponse | HelperCaptureResponse | HelperSanitizeResponse | HelperSkipResponse

export class MacOSCaptureClient implements NativeCaptureAdapter {
  private status: NativeCaptureStatus
  private readonly lastFingerprints = new Map<string, string>()
  private readonly lastScreenshotHashes = new Map<string, string>()
  private lastSkip: NativeCaptureSkipReason = null

  constructor(
    private readonly helperPath: string,
    private readonly dataDir: string,
    private readonly timeoutMs = 15_000,
  ) {
    this.status = existsSync(helperPath)
      ? { ...unavailableStatus('Permission status has not been checked'), available: true, platform: 'darwin', reason: 'Permission status has not been checked' }
      : unavailableStatus(`Native helper is missing at ${helperPath}`)
  }

  summary(): NativeCaptureStatus { return structuredClone(this.status) }

  async refreshStatus(): Promise<NativeCaptureStatus> {
    if (process.platform !== 'darwin') return this.status = unavailableStatus('Native capture requires macOS')
    if (!existsSync(this.helperPath)) return this.status = unavailableStatus(`Native helper is missing at ${this.helperPath}`)
    try {
      const result = await this.invoke({ action: 'status' }) as HelperStatusResponse
      this.status = this.fromHelperStatus(result)
    } catch (error) {
      this.status = unavailableStatus(`Native helper failed its status check: ${message(error)}`)
    }
    return this.summary()
  }

  async requestScreenPermission(): Promise<NativeCaptureStatus> {
    if (process.platform !== 'darwin' || !existsSync(this.helperPath)) throw new Error(this.status.reason ?? 'Native helper is unavailable')
    const result = await this.invoke({ action: 'requestScreenPermission' }) as HelperStatusResponse
    this.status = this.fromHelperStatus(result)
    return this.summary()
  }

  async capture(sessionId: string, sequence: number, policy: CapturePolicy): Promise<CapturedFacts | null> {
    if (!this.status.available) throw new Error(this.status.reason ?? 'Native capture is unavailable')
    if (this.status.screenRecording !== 'granted') throw new Error('Screen Recording permission is required for native observation')
    if (policy.accessibilityTree && !this.status.supportedSignals.accessibilityTree) throw new Error('Accessibility-tree capture is not supported by this native helper')
    if (policy.accessibilityTree && this.status.accessibility !== 'granted') throw new Error('Accessibility permission is required for structured native observation')
    if (policy.inputMetadata) throw new Error('Input-event capture is not available in observation-only mode')
    if (!policy.screenshots && !policy.activeWindow && !policy.accessibilityTree) throw new Error('Enable at least screenshots, active-window metadata, or Accessibility structure')
    if (!/^[a-z0-9_-]+$/iu.test(sessionId) || sequence < 1 || !Number.isInteger(sequence)) throw new Error('Invalid native capture identity')

    const captureRoot = resolve(this.dataDir, 'native-captures')
    await mkdir(captureRoot, { recursive: true, mode: 0o700 })
    const filename = `${sessionId}-${sequence}.png`
    const outputPath = resolve(captureRoot, filename)
    try {
      const result = await this.invoke({
        action: 'capture',
        outputPath,
        screenshots: policy.screenshots,
        activeWindow: policy.activeWindow,
        excludedApplications: policy.excludedApplications,
        excludedWindows: policy.excludedWindows,
        excludedRegions: policy.excludedRegions,
        extractText: policy.screenText,
        accessibilityTree: policy.accessibilityTree,
        observerProcessIdentifier: process.pid,
        previousScreenshotSha256: this.lastScreenshotHashes.get(sessionId),
      }) as HelperCaptureResponse | HelperSkipResponse
      // Carve was frontmost. Nothing was captured or written, and this is a
      // skip rather than a failure, so the session keeps running.
      if ('skipped' in result) {
        this.lastSkip = result.skipped
        return null
      }
      if (result.screenshotWritten) await chmod(outputPath, 0o600)
      const fingerprint = [result.app, result.windowTitle, result.screenshotSha256 ?? `${result.width}x${result.height}`].join('\u0000')
      if (!result.excluded && this.lastFingerprints.get(sessionId) === fingerprint) {
        if (result.screenshotWritten) await rm(outputPath, { force: true })
        this.lastSkip = 'duplicate'
        return null
      }
      if (!result.excluded) this.lastFingerprints.set(sessionId, fingerprint)
      if (!result.excluded && result.screenshotSha256) this.lastScreenshotHashes.set(sessionId, result.screenshotSha256)
      const screenshotRef = result.screenshotWritten ? `native-captures/${filename}` : undefined
      // Bounded so one dense screen cannot dominate storage or a later prompt.
      const screenText = policy.screenText && result.text ? result.text.slice(0, maxScreenTextChars) : ''
      return {
        app: result.app || '[Unknown application]',
        windowTitle: result.windowTitle || '[Untitled window]',
        ...(screenshotRef ? { screenshotRef } : {}),
        ...(policy.accessibilityTree && result.accessibility ? { accessibility: result.accessibility } : {}),
        text: result.excluded
          ? '[Content excluded before screenshot encoding]'
          : screenText
            ? screenText
            : `Observed frontmost macOS application ${result.app || '[unknown]'} and window ${result.windowTitle || '[untitled]'}. No window text, keystrokes, clipboard data, or control events were captured.`,
        state: {
          source: 'native_macos',
          bundleIdentifier: result.bundleIdentifier,
          windowId: result.windowId,
          captureWidth: result.width,
          captureHeight: result.height,
          screenshotCaptured: result.screenshotWritten,
          screenTextLines: policy.screenText ? result.textLineCount : 0,
          accessibilityElementCount: policy.accessibilityTree ? result.accessibility?.length ?? 0 : 0,
          preEncodingRegionMasks: result.redactedRegionCount,
          observationOnly: true,
        },
      }
    } catch (error) {
      await rm(outputPath, { force: true })
      throw error
    }
  }

  /** Why the most recent capture returned null, for an honest audit entry. */
  lastSkipReason(): NativeCaptureSkipReason {
    const reason = this.lastSkip
    this.lastSkip = null
    return reason
  }

  /**
   * Ambient discovery path. Asks the helper for window metadata with
   * screenshots disabled, so no image is encoded, written, or hashed. Returns
   * null rather than throwing: ambient sampling must never disturb capture.
   */
  async sampleWindow(excludedApplications: string[], excludedWindows: string[], extractText = false): Promise<AmbientSample | null> {
    if (!this.status.available || this.status.screenRecording !== 'granted') return null
    try {
      const result = await this.invoke({
        action: 'capture',
        screenshots: false,
        activeWindow: true,
        excludedApplications,
        excludedWindows,
        extractText,
        observerProcessIdentifier: process.pid,
      }) as HelperCaptureResponse | HelperSkipResponse
      if ('skipped' in result) return null
      return {
        app: result.app || '[Unknown application]',
        windowTitle: result.windowTitle || '[Untitled window]',
        bundleIdentifier: result.bundleIdentifier,
        excluded: result.excluded,
        // Screenshots stay disabled on this path: text is read from the frame
        // in memory and the image is never encoded or written.
        text: extractText && result.text ? result.text.slice(0, maxScreenTextChars) : '',
      }
    } catch {
      return null
    }
  }

  async readScreenshot(relativePath: string): Promise<string | null> {
    return readCaptureFile(this.dataDir, relativePath)
  }

  startChangeProbe(policy: CapturePolicy, onProbe: (probe: NativeChangeProbe) => void, onError: (error: Error) => void): NativeChangeProbeHandle {
    if (!this.status.available || this.status.screenRecording !== 'granted') throw new Error('Screen Recording permission is required for adaptive observation')
    if (!this.status.supportedSignals.adaptiveObservation) throw new Error('This native helper does not support adaptive observation')
    if (!policy.screenshots) throw new Error('Adaptive observation requires permission to inspect screenshot pixels')
    const child = spawn(this.helperPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: '/usr/bin:/bin', STEWARD_CAPTURE_ROOT: resolve(this.dataDir, 'native-captures') },
    })
    let stopped = false
    let buffer = ''
    let stderr = ''
    let resolveDone: () => void = () => {}
    const done = new Promise<void>((resolvePromise) => { resolveDone = resolvePromise })
    const fail = (error: Error): void => {
      if (stopped) return
      stopped = true
      child.kill('SIGKILL')
      onError(error)
      resolveDone()
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk
      if (buffer.length > 256_000) return fail(new Error('Adaptive helper output buffer exceeded 256 KB'))
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const parsed = JSON.parse(line) as HelperProbeResponse | { ok?: false; error?: string }
          if (!parsed.ok) return fail(new Error(parsed.error || 'Adaptive helper rejected the request'))
          if (!('kind' in parsed) || parsed.kind !== 'probe') return fail(new Error('Adaptive helper returned an unexpected event'))
          try { onProbe(parsed) } catch { /* an indicator/controller callback cannot corrupt the native stream */ }
        } catch (error) {
          return fail(new Error(`Adaptive helper returned invalid JSON: ${message(error)}`))
        }
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { if (stderr.length < 64_000) stderr += chunk })
    child.once('error', (error) => fail(error))
    child.once('close', (code) => {
      if (!stopped && code !== 0) {
        stopped = true
        onError(new Error(stderr.trim() || `Adaptive helper exited with ${code}`))
      }
      resolveDone()
    })
    child.stdin.end(`${JSON.stringify({
      action: 'observe',
      excludedApplications: policy.excludedApplications,
      excludedWindows: policy.excludedWindows,
      excludedRegions: policy.excludedRegions,
      observerProcessIdentifier: process.pid,
      probeIntervalMilliseconds: 500,
    })}\n`)
    return {
      done,
      stop: () => {
        if (stopped) return
        stopped = true
        child.kill('SIGTERM')
        resolveDone()
      },
    }
  }

  async recognizeStored(relativePath: string): Promise<string> {
    if (!relativePath.startsWith('native-captures/')) return ''
    const path = resolve(this.dataDir, 'native-captures', basename(relativePath))
    if (!existsSync(path)) return ''
    try {
      const result = await this.invoke({ action: 'recognize', sourcePath: path }) as { text?: string }
      return (result.text ?? '').slice(0, maxScreenTextChars)
    } catch {
      return ''
    }
  }

  async sanitizeScreenshot(relativePath: string, outputName: string, crop: RegionExclusion | null, masks: RegionExclusion[]): Promise<NativeSanitizedScreenshot> {
    if (!existsSync(this.helperPath)) throw new Error('Native capture helper is unavailable')
    if (!/^[a-z0-9._-]+\.png$/iu.test(outputName)) throw new Error('Invalid sanitized screenshot name')
    validateRegions(masks, 'review masks')
    if (crop) validateRegions([crop], 'review crop')
    const root = resolve(this.dataDir, 'native-captures')
    const sourcePath = this.resolveScreenshotPath(relativePath)
    if (!sourcePath || !existsSync(sourcePath)) throw new Error('The source screenshot is unavailable or has expired')
    await mkdir(root, { recursive: true, mode: 0o700 })
    const outputPath = resolve(root, basename(outputName))
    const result = await this.invoke({
      action: 'sanitize',
      sourcePath,
      outputPath,
      crop,
      excludedRegions: masks,
    }) as HelperSanitizeResponse
    await chmod(outputPath, 0o600)
    return {
      relativePath: `native-captures/${basename(outputName)}`,
      sha256: result.screenshotSha256,
      width: result.width,
      height: result.height,
      redactedRegionCount: result.redactedRegionCount,
    }
  }

  async deleteScreenshot(relativePath: string): Promise<boolean> {
    const path = this.resolveScreenshotPath(relativePath)
    if (!path || !existsSync(path)) return false
    await rm(path, { force: true })
    return true
  }

  close(): void { this.lastFingerprints.clear(); this.lastScreenshotHashes.clear() }

  private fromHelperStatus(result: HelperStatusResponse): NativeCaptureStatus {
    return {
      available: true,
      platform: 'darwin',
      mode: 'observation_only',
      helperVersion: result.helperVersion,
      screenRecording: result.screenRecording ? 'granted' : 'denied',
      accessibility: result.accessibility ? 'granted' : 'denied',
      supportedSignals: {
        screenshots: true,
        activeWindow: true,
        accessibilityTree: true,
        adaptiveObservation: result.adaptiveObservation === true,
        inputEvents: false,
        computerControl: false,
      },
      reason: result.screenRecording ? null : 'Screen Recording permission is not granted to the Carve capture helper',
    }
  }

  private resolveScreenshotPath(relativePath: string): string | null {
    if (!relativePath.startsWith('native-captures/')) return null
    const root = resolve(this.dataDir, 'native-captures')
    const path = resolve(root, basename(relativePath))
    return path.startsWith(`${root}/`) ? path : null
  }

  private invoke(command: Record<string, unknown>): Promise<HelperResponse> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(this.helperPath, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { PATH: '/usr/bin:/bin', STEWARD_CAPTURE_ROOT: resolve(this.dataDir, 'native-captures') },
      })
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      let outputBytes = 0
      let settled = false
      const finish = (error?: Error, value?: HelperResponse): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) reject(error)
        else if (value) resolvePromise(value)
        else reject(new Error('Native helper returned no response'))
      }
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        finish(new Error('Native helper timed out'))
      }, this.timeoutMs)
      child.stdout.on('data', (chunk: Buffer) => {
        outputBytes += chunk.length
        if (outputBytes > 1_000_000) {
          child.kill('SIGKILL')
          finish(new Error('Native helper output exceeded 1 MB'))
          return
        }
        stdout.push(chunk)
      })
      child.stderr.on('data', (chunk: Buffer) => { if (stderr.reduce((sum, item) => sum + item.length, 0) < 64_000) stderr.push(chunk) })
      child.once('error', (error) => finish(error))
      child.once('close', (code) => {
        if (settled) return
        const raw = Buffer.concat(stdout).toString('utf8').trim()
        if (code !== 0) return finish(new Error(Buffer.concat(stderr).toString('utf8').trim() || `Native helper exited with ${code}`))
        try {
          const parsed = JSON.parse(raw) as { ok?: boolean; error?: string }
          if (!parsed.ok) return finish(new Error(parsed.error || 'Native helper rejected the request'))
          finish(undefined, parsed as HelperResponse)
        } catch (error) {
          finish(new Error(`Native helper returned invalid JSON: ${message(error)}`))
        }
      })
      child.stdin.end(`${JSON.stringify(command)}\n`)
    })
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function validateRegions(regions: RegionExclusion[], label: string): void {
  if (regions.length > 32 || regions.some((region) => [region.x, region.y, region.width, region.height].some((value) => !Number.isFinite(value) || value < 0 || value > 100_000) || region.width === 0 || region.height === 0)) {
    throw new Error(`${label} must contain at most 32 finite positive regions within 100,000 pixels`)
  }
}
