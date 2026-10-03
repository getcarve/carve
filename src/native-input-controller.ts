import type { LiveComputerDispatchTimings, LiveComputerHitTest, LiveComputerHitTestExpectation, LiveComputerInputController, LiveComputerNativeDelivery, LiveComputerPageText } from './live-computer.js'
import { deliverBoundedInput, parseNativeDelivery } from './live-computer-delivery.js'
import type { LiveComputerAction, LiveComputerTarget } from './types.js'

export interface NativeInputBridge {
  windowLifecycle?(payload: string): string
  windowGroup?(payload: string): string
  isTrusted(): boolean
  requestTrust(): boolean
  focusWindow?(payload: string): unknown
  execute(payload: string): string | undefined
  hitTest?(payload: string): string
  surfaceIdentity?(payload: string): string
  pageText?(payload: string): string
}

/** The production Electron transport, also used by owned native fixtures.
 * Presentation hooks have no authority; the bridge resolves the exact target
 * again for each delivered chunk. */
export function createNativeInputController(bridge: NativeInputBridge, options: {
  isTrusted?: () => boolean
  requestTrust?: () => boolean
  beforeDispatch?: () => void
  present?: (bounds: LiveComputerTarget['bounds'], action: LiveComputerAction, target: Pick<LiveComputerTarget, 'windowId' | 'bundleIdentifier'>) => void
  aimHoldMs?: (action: LiveComputerAction) => number
  /** Last word before Carve raises its window: holds while the person is
   * using the keyboard or mouse or has chosen another window. Universal waits
   * for the turn before its pre-input capture, so this normally returns 0;
   * when it did wait, the step's observation predates the person's turn and
   * it is refused (nothing sent) so the engine looks again. */
  awaitPersonTurn?: (target: Pick<LiveComputerTarget, 'windowId' | 'bundleIdentifier'>, signal: AbortSignal) => Promise<number>
  afterDelivery?: (target: Pick<LiveComputerTarget, 'windowId' | 'bundleIdentifier'>) => void
} = {}): LiveComputerInputController {
  const none = () => ({ deliveryProgress: 'none' as const, pressedInputsReleased: true, eventCount: 0 })
  const dispatch = async (payload: string, signal?: AbortSignal) => {
    options.beforeDispatch?.()
    // Electron's focusability/click-through changes need a main-loop turn to
    // reach AppKit. Blocking immediately in the synchronous native bridge can
    // leave the old capsule receiving the click even after AX reports Chrome
    // focused. Yield before native focus/identity revalidation, never after it.
    if (options.present || options.beforeDispatch) await new Promise<void>(resolve => setTimeout(resolve, 0))
    if (signal?.aborted) return none()
    return parseNativeDelivery(bridge.execute(payload))
  }
  // Every phase between the engine's decision to send and the native post is
  // timed, so an unexplained gap before input (about 2.1 s on some 27
  // September runs) is attributed from the audit instead of guessed at. The
  // marks travel with the delivery receipt (receipt.timings.dispatch).
  const clock = () => {
    const timings: LiveComputerDispatchTimings = { presentMs: 0, aimMs: 0, personTurnMs: 0, focusWindowMs: 0, dispatchMs: 0 }
    let last = performance.now()
    const mark = (phase: keyof LiveComputerDispatchTimings) => { const now = performance.now(); timings[phase] += Math.round(now - last); last = now }
    const done = (delivery: LiveComputerNativeDelivery): LiveComputerNativeDelivery => ({ ...delivery, timings: { ...timings } })
    return { mark, done }
  }
  const aim = async (action: LiveComputerAction) => {
    const hold = options.aimHoldMs?.(action) ?? 0
    if (hold > 0) await new Promise<void>(resolve => setTimeout(resolve, hold))
  }
  const prepareFocus = async (bounds: LiveComputerTarget['bounds'], target: Pick<LiveComputerTarget, 'windowId' | 'bundleIdentifier'>, signal: AbortSignal | undefined, mark: (phase: keyof LiveComputerDispatchTimings) => void): Promise<LiveComputerNativeDelivery | null> => {
    if (options.awaitPersonTurn) {
      let waited = 0
      try { waited = await options.awaitPersonTurn(target, signal ?? new AbortController().signal) } catch { return none() }
      mark('personTurnMs')
      if (waited > 0) return { ...none(), contentDelivery: 'none', failure: { code: 'person_turn_waited', stage: 'focus', method: 'input', mutation: 'none' } }
    }
    if (!bridge.focusWindow) return null
    options.beforeDispatch?.()
    // Activation also completes asynchronously in AppKit. Separate that
    // handoff from the synchronous dispatch; execute still revalidates the
    // exact window and receiver immediately before posting any input.
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    if (signal?.aborted) return none()
    try { bridge.focusWindow(JSON.stringify({ bounds, target })) }
    catch (error) {
      mark('focusWindowMs')
      const detail = focusRefusalDetail(error)
      return { ...none(), contentDelivery: 'none', failure: { code: 'window_focus_unconfirmed', stage: 'focus', method: 'input', mutation: 'none', ...(detail ? { detail } : {}) } }
    }
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    mark('focusWindowMs')
    return signal?.aborted ? none() : null
  }
  const hitTest = bridge.hitTest ? (target: Pick<LiveComputerTarget, 'windowId' | 'bundleIdentifier'>, point: { x: number; y: number }, expected: LiveComputerHitTestExpectation | null): LiveComputerHitTest | null => {
    const parsed = JSON.parse(bridge.hitTest!(JSON.stringify({ target: { windowId: target.windowId, bundleIdentifier: target.bundleIdentifier }, point, expected }))) as Partial<LiveComputerHitTest> & { available?: unknown }
    if (parsed.available !== true) return null
    const relation = parsed.relation === 'target' || parsed.relation === 'descendant' || parsed.relation === 'other' || parsed.relation === 'none' ? parsed.relation : 'none'
    const element = (raw: unknown) => raw && typeof raw === 'object' ? { role: String((raw as { role?: unknown }).role ?? ''), subrole: typeof (raw as { subrole?: unknown }).subrole === 'string' ? (raw as { subrole: string }).subrole : null, name: String((raw as { name?: unknown }).name ?? '').slice(0, 120), bounds: validBounds((raw as { bounds?: unknown }).bounds) } : null
    const rawShared = (parsed as { shared?: unknown }).shared as { levelsAboveHit?: unknown; levelsAboveTarget?: unknown } | null | undefined
    const sharedBase = element(rawShared)
    const levels = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 3 ? value : null
    const shared = sharedBase && levels(rawShared?.levelsAboveHit) && levels(rawShared?.levelsAboveTarget)
      ? { ...sharedBase, levelsAboveHit: levels(rawShared!.levelsAboveHit)!, levelsAboveTarget: levels(rawShared!.levelsAboveTarget)! } : null
    return { available: true, relation, hit: element(parsed.hit), obstruction: element(parsed.obstruction), shared, stable: parsed.stable === true }
  } : undefined
  const surfaceOrigin = bridge.surfaceIdentity ? (target: Pick<LiveComputerTarget, 'windowId' | 'bundleIdentifier'>): string | null => {
    const parsed = JSON.parse(bridge.surfaceIdentity!(JSON.stringify({ target: { windowId: target.windowId, bundleIdentifier: target.bundleIdentifier } }))) as { available?: unknown; origin?: unknown }
    return parsed.available === true && typeof parsed.origin === 'string' && /^https?:\/\/[^/\s]+$/u.test(parsed.origin) ? parsed.origin : null
  } : undefined
  /** The local file the selected window's document is saved as, for the
   * controller's own readback of a write; null for anything but an absolute
   * path. Never sent to a model and never written to the audit. */
  const documentLocation = bridge.surfaceIdentity ? (target: Pick<LiveComputerTarget, 'windowId' | 'bundleIdentifier'>): string | null => {
    const parsed = JSON.parse(bridge.surfaceIdentity!(JSON.stringify({ target: { windowId: target.windowId, bundleIdentifier: target.bundleIdentifier } }))) as { available?: unknown; documentPath?: unknown }
    return parsed.available === true && typeof parsed.documentPath === 'string' && parsed.documentPath.startsWith('/') && parsed.documentPath.length <= 4000 ? parsed.documentPath : null
  } : undefined
  /** The selected window's whole document as text (read-only, one call). */
  const pageText = bridge.pageText ? (target: Pick<LiveComputerTarget, 'windowId' | 'bundleIdentifier'>, limit: number): LiveComputerPageText | null => {
    const parsed = JSON.parse(bridge.pageText!(JSON.stringify({ target: { windowId: target.windowId, bundleIdentifier: target.bundleIdentifier }, limit }))) as Record<string, unknown>
    if (parsed.available !== true || typeof parsed.text !== 'string') return null
    const method = parsed.method === 'text_marker' || parsed.method === 'walk_document' || parsed.method === 'walk_window' ? parsed.method : 'walk_window'
    return { text: readablePageText(parsed.text).slice(0, limit), method, truncated: parsed.truncated === true, url: typeof parsed.url === 'string' && /^https?:\/\//u.test(parsed.url) ? parsed.url.slice(0, 2048) : null,
      elapsedMs: typeof parsed.elapsedMs === 'number' && Number.isFinite(parsed.elapsedMs) ? parsed.elapsedMs : null }
  } : undefined
  const tableDestination = bridge.surfaceIdentity ? (target: Pick<LiveComputerTarget, 'windowId' | 'bundleIdentifier'>) => {
    const parsed = JSON.parse(bridge.surfaceIdentity!(JSON.stringify({ target }))) as { available?: boolean; tableFingerprint?: string; tableService?: string }
    return parsed.available && typeof parsed.tableFingerprint === 'string' && /^[a-f0-9]{64}$/u.test(parsed.tableFingerprint)
      && (parsed.tableService === 'google_sheets' || parsed.tableService === 'google_docs')
      ? { fingerprint: parsed.tableFingerprint, service: parsed.tableService as 'google_sheets' | 'google_docs' } : null
  } : undefined
  return {
    ...(bridge.windowLifecycle ? { windowLifecycle: (target: Pick<LiveComputerTarget, 'windowId' | 'bundleIdentifier'>, restore: boolean) => {
      const value = JSON.parse(bridge.windowLifecycle!(JSON.stringify({ target, restore }))) as { state?: unknown }
      return value.state === 'visible' || value.state === 'minimized' || value.state === 'restoring' || value.state === 'unavailable' ? value.state : 'unknown'
    } } : {}),
    ...(bridge.windowGroup ? { windowGroup: (target: Pick<LiveComputerTarget, 'windowId' | 'bundleIdentifier'>) => {
      const value = JSON.parse(bridge.windowGroup!(JSON.stringify({ target }))) as { windows?: Array<{ windowId: number; bounds: LiveComputerTarget['bounds'] }> }
      if (!Array.isArray(value.windows) || value.windows.length < 1 || value.windows.length > 65
        || value.windows[0]?.windowId !== target.windowId || new Set(value.windows.map(w => w.windowId)).size !== value.windows.length
        || value.windows.some(w => !Number.isInteger(w.windowId) || w.windowId <= 0 || w.windowId > 0xffffffff || !validBounds(w.bounds)))
        throw new Error('Invalid native window-group identity')
      return value.windows
    } } : {}),
    ...(tableDestination ? { tableDestination } : {}),
    isTrusted: options.isTrusted ?? (() => bridge.isTrusted()),
    requestTrust: options.requestTrust ?? (() => bridge.requestTrust()),
    ...(hitTest ? { hitTest } : {}),
    ...(surfaceOrigin ? { surfaceOrigin } : {}),
    ...(pageText ? { pageText } : {}),
    ...(documentLocation ? { documentLocation } : {}),
    focus: async (bounds, target, signal) => {
      if (signal?.aborted) return
      if (!bridge.focusWindow) throw new Error('The exact-window focus bridge is unavailable')
      bridge.focusWindow(JSON.stringify({ bounds, target }))
    },
    execute: async (bounds, action, target, signal) => {
      const { mark, done } = clock()
      options.present?.(bounds, action, target)
      mark('presentMs')
      await aim(action)
      mark('aimMs')
      if (signal?.aborted) return done(none())
      const blocked = await prepareFocus(bounds, target, signal, mark)
      if (blocked) return done(blocked)
      const send = (unit: LiveComputerAction) => dispatch(JSON.stringify({ bounds, action: unit, target }), signal)
      try { const delivery = action.kind === 'type' ? await deliverBoundedInput([action], send, signal) : await send(action); mark('dispatchMs'); return done(delivery) }
      finally { options.afterDelivery?.(target) }
    },
    executeTransaction: async (bounds, action, steps, target, signal) => {
      const { mark, done } = clock()
      options.present?.(bounds, action, target)
      mark('presentMs')
      await aim(steps[0] ?? action)
      mark('aimMs')
      if (signal?.aborted) return done(none())
      const blocked = await prepareFocus(bounds, target, signal, mark)
      if (blocked) return done(blocked)
      try { const delivery = await deliverBoundedInput(steps, unit => dispatch(JSON.stringify({ bounds, action: unit, target }), signal), signal); mark('dispatchMs'); return done(delivery) }
      finally { options.afterDelivery?.(target) }
    },
  }
}

/** `STEWARD_FOCUS_REFUSAL_REASON=off` drops the reason below from the receipt. */
export function focusRefusalReasonEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STEWARD_FOCUS_REFUSAL_REASON?.trim().toLowerCase() !== 'off'
}

/**
 * Why the native focus check refused, kept from its exception instead of being
 * discarded. In testing, CMD+A and a click inside TextEdit's Save sheet
 * failed "window_focus_unconfirmed" with no reason anywhere in the audit, so
 * the cause could only be guessed. The bridge's message carries a reason code
 * and identity-only evidence (process ids, window ids, booleans, AX error
 * numbers; never titles or content); only those scalar fields are kept.
 */
export function focusRefusalDetail(error: unknown, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!focusRefusalReasonEnabled(env)) return null
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const reason = /\(reason: ([a-z_]{1,64})\)/u.exec(message)?.[1] ?? null
  let evidence = ''
  const json = /focus evidence: (\{[^\n]{0,2000}\})/u.exec(message)?.[1]
  if (json) {
    try {
      const parsed = JSON.parse(json) as Record<string, unknown>
      evidence = Object.entries(parsed).filter(([key, value]) => /^[A-Za-z]{1,40}$/u.test(key) && (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))))
        .map(([key, value]) => `${key}=${value}`).join(' ')
    } catch { /* A malformed suffix adds nothing. */ }
  }
  const detail = [reason, evidence].filter(Boolean).join('; ')
  return detail ? detail.slice(0, 400) : null
}

function validBounds(raw: unknown): { x: number; y: number; width: number; height: number } | null {
  if (!raw || typeof raw !== 'object') return null
  const { x, y, width, height } = raw as Record<string, unknown>
  return [x, y, width, height].every(value => typeof value === 'number' && Number.isFinite(value)) && (width as number) > 0 && (height as number) > 0
    ? { x: x as number, y: y as number, width: width as number, height: height as number } : null
}

/** Chrome's whole-document string marks each embedded element (an image, a
 * link card, a control) with U+FFFC and puts no line breaks between blocks, so
 * a listing reads as one line ("…Item Name Black￼￼$65.00￼￼…"). Element
 * boundaries become line breaks; nothing else is interpreted or removed. */
export function readablePageText(text: string): string {
  return text.replace(/[\uFFFC\u200B]+/gu, '\n').split('\n').map(line => line.replace(/[ \t\u00A0]+/gu, ' ').trim()).filter(Boolean).join('\n')
}
