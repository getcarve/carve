import { randomUUID } from 'node:crypto'
import type { ConversationInteraction } from './conversation-interaction.js'
import type { LiveComputerTarget } from './types.js'

/**
 * A surface is the thing a Carve conversation is about: one window, and, when
 * the application exposes one, the document that window currently shows. Two
 * browser tabs in one window are two surfaces. The document identity is a
 * fingerprint computed inside the native layer; the raw URL or file path never
 * crosses into the registry, the audit trail, or persistence.
 */
export interface SurfaceDocument {
  kind: 'web' | 'file' | 'titled'
  /** SHA-256 hex of the normalized identity. Empty for `titled`. */
  fingerprint: string
  /** Presentation only, capped at 120 characters. */
  displayTitle: string
  /** Position of the selected tab in a browser's tab strip, when the browser
   * exposes one. Navigation inside a tab keeps its index; switching tabs
   * changes it. This is what separates "the page changed" from "a different
   * tab is showing". */
  tab?: { index: number; count: number } | null
}

export interface SurfaceKey {
  bundleIdentifier: string
  windowId: number
  document: SurfaceDocument | null
}

/**
 * `focused`: the surface has native focus and shows its document.
 * `background`: the window is on screen or minimized but not focused.
 * `waiting`: the window is focused or visible but shows a different document
 * (the person switched tabs); the attachment wants its own tab back.
 * `lost`: the window is gone; kept briefly so a restored tab re-attaches.
 */
export type AttachmentPresence = 'focused' | 'background' | 'waiting' | 'lost'

export interface AttachmentCapsule {
  intent: 'guide' | 'work'
  collapsed: boolean
}

export interface Attachment {
  id: string
  key: SurfaceKey
  /** Last known window identity and bounds, refreshed every tick. */
  target: LiveComputerTarget
  conversation: ConversationInteraction
  /** The execution session this attachment owns, live or parked. */
  sessionId: string | null
  presence: AttachmentPresence
  capsule: AttachmentCapsule
  createdAt: number
  lastSeen: number
  lastUsed: number
  lostAt: number | null
}

/** Text-free projection for the desktop status and the main UI. */
export interface AttachmentSummary {
  id: string
  application: string
  bundleIdentifier: string
  windowId: number
  title: string
  document: SurfaceDocument | null
  presence: AttachmentPresence
  current: boolean
  sessionId: string | null
  lastUsed: string
}

export interface SurfaceObservation {
  bundleIdentifier: string
  windowId: number
  /** False when Window Server no longer lists the window at all. */
  present: boolean
  focused: boolean
  bounds: LiveComputerTarget['bounds'] | null
  title: string | null
  /** The document the window shows now; undefined when not probed this tick. */
  document?: SurfaceDocument | null
}

export interface AttachmentRegistryDependencies {
  createConversation(attachment: () => Attachment | null): ConversationInteraction
  now?: () => number
  onChange?(): void
}

export const attachmentLostRetentionMs = 10 * 60_000
export const attachmentIdleRetentionMs = 30 * 60_000
export const attachmentLimit = 12

export function sameWindow(left: Pick<SurfaceKey, 'bundleIdentifier' | 'windowId'>, right: Pick<SurfaceKey, 'bundleIdentifier' | 'windowId'>): boolean {
  return left.bundleIdentifier === right.bundleIdentifier && left.windowId === right.windowId
}

/** The same document is the same tab (by strip position) or the same
 * identity fingerprint; a titled window has one document. */
export function sameDocument(left: SurfaceDocument | null, right: SurfaceDocument | null): boolean {
  if (!left || !right) return !left && !right
  if (left.kind === 'titled' || right.kind === 'titled') return left.kind === right.kind
  if (left.tab && right.tab && left.tab.index === right.tab.index) return true
  return left.fingerprint !== '' && left.fingerprint === right.fingerprint
}

/** A window-only key (no document known) matches any attachment on that
 * window; a documented key matches only the attachment on that document. */
export function sameSurface(key: SurfaceKey, other: SurfaceKey): boolean {
  if (!sameWindow(key, other)) return false
  if (!key.document || !other.document) return !key.document && !other.document
  return sameDocument(key.document, other.document)
}

export function windowKey(target: Pick<SurfaceKey, 'bundleIdentifier' | 'windowId'>): string {
  return `${target.bundleIdentifier}:${target.windowId}`
}

/**
 * Every conversation Carve holds, keyed by surface. Exactly one is current:
 * the one the capsule and the hotkeys act on. Presence is observed, never
 * assumed; the shell feeds one observation per attached window per tick.
 * Nothing here is persisted.
 */
export class AttachmentRegistry {
  private readonly attachments = new Map<string, Attachment>()
  private currentId: string | null = null
  private readonly now: () => number

  constructor(private readonly dependencies: AttachmentRegistryDependencies) {
    this.now = dependencies.now ?? Date.now
  }

  list(): Attachment[] {
    return [...this.attachments.values()].sort((left, right) => right.lastUsed - left.lastUsed)
  }

  get(id: string): Attachment | null { return this.attachments.get(id) ?? null }

  current(): Attachment | null { return this.currentId ? this.attachments.get(this.currentId) ?? null : null }

  find(key: SurfaceKey): Attachment | null {
    const candidates = this.list().filter((attachment) => sameSurface(key, attachment.key))
    return candidates[0] ?? null
  }

  /** Attachments on one window, most recently used first. */
  forWindow(target: Pick<SurfaceKey, 'bundleIdentifier' | 'windowId'>): Attachment[] {
    return this.list().filter((attachment) => sameWindow(attachment.key, target))
  }

  forSession(sessionId: string): Attachment | null {
    return this.list().find((attachment) => attachment.sessionId === sessionId) ?? null
  }

  /**
   * Find or create the attachment for a surface and make it current. A lost
   * attachment whose document reappears is revived with its conversation. A
   * window-only key (document unknown) adopts the window's most recent
   * attachment rather than creating a duplicate.
   */
  attach(target: LiveComputerTarget, document: SurfaceDocument | null, intent: AttachmentCapsule['intent'] = 'work'): Attachment {
    const key: SurfaceKey = { bundleIdentifier: target.bundleIdentifier, windowId: target.windowId, document }
    let attachment = this.find(key) ?? (document ? null : this.forWindow(key)[0] ?? null)
    if (!attachment && document) {
      // A window attached before its document was known learns it now.
      const undocumented = this.forWindow(key).find((candidate) => !candidate.key.document)
      if (undocumented) { undocumented.key = { ...undocumented.key, document }; attachment = undocumented }
    }
    if (!attachment && document && document.kind !== 'titled') {
      // A closed tab or window that comes back (restore, reopen) is the same
      // conversation, matched by document identity rather than window id.
      const revived = this.list().find((candidate) => candidate.presence === 'lost' && candidate.key.document?.kind === document.kind && candidate.key.document.fingerprint === document.fingerprint)
      if (revived) { revived.key = { bundleIdentifier: target.bundleIdentifier, windowId: target.windowId, document }; attachment = revived }
    }
    if (!attachment) {
      const id = randomUUID()
      const created: Attachment = {
        id, key, target: plainTarget(target),
        conversation: this.dependencies.createConversation(() => this.attachments.get(id) ?? null),
        sessionId: null, presence: 'focused',
        capsule: { intent, collapsed: false },
        createdAt: this.now(), lastSeen: this.now(), lastUsed: this.now(), lostAt: null,
      }
      this.attachments.set(id, created)
      attachment = created
      this.enforceLimit()
    }
    attachment.target = { ...plainTarget(target), title: target.title || attachment.target.title }
    attachment.lostAt = null
    attachment.presence = 'focused'
    attachment.lastSeen = this.now()
    attachment.lastUsed = this.now()
    attachment.capsule.intent = intent
    this.setCurrent(attachment.id)
    return attachment
  }

  /** The attachment for a window, created if missing, without making it
   * current. Used to adopt a session that started from the full app. */
  ensure(target: LiveComputerTarget, document: SurfaceDocument | null = null): Attachment {
    const key: SurfaceKey = { bundleIdentifier: target.bundleIdentifier, windowId: target.windowId, document }
    const existing = this.find(key) ?? (document ? null : this.forWindow(key)[0] ?? null)
    if (existing) return existing
    const id = randomUUID()
    const created: Attachment = {
      id, key, target: plainTarget(target),
      conversation: this.dependencies.createConversation(() => this.attachments.get(id) ?? null),
      sessionId: null, presence: 'background',
      capsule: { intent: 'work', collapsed: false },
      createdAt: this.now(), lastSeen: this.now(), lastUsed: this.now(), lostAt: null,
    }
    this.attachments.set(id, created)
    if (!this.currentId) this.currentId = id
    this.enforceLimit()
    this.dependencies.onChange?.()
    return created
  }

  setCurrent(id: string | null): Attachment | null {
    if (id && !this.attachments.has(id)) return null
    const changed = this.currentId !== id
    this.currentId = id
    const current = this.current()
    if (current) current.lastUsed = this.now()
    if (changed) this.dependencies.onChange?.()
    return current
  }

  bindSession(id: string, sessionId: string | null): void {
    const attachment = this.attachments.get(id)
    if (!attachment) return
    // A session belongs to one attachment.
    if (sessionId) for (const other of this.attachments.values()) if (other.sessionId === sessionId && other.id !== id) other.sessionId = null
    attachment.sessionId = sessionId
    attachment.lastUsed = this.now()
  }

  touch(id: string): void {
    const attachment = this.attachments.get(id)
    if (attachment) attachment.lastUsed = this.now()
  }

  /**
   * One observation per attached window per tick. Focus follows the surface:
   * the attachment whose window is focused and whose document is showing
   * becomes current. Presence is derived purely from what was observed.
   */
  observe(observations: SurfaceObservation[]): { currentChanged: boolean } {
    const before = this.currentId
    const byWindow = new Map(observations.map((entry) => [windowKey(entry), entry] as const))
    let focusedCandidate: Attachment | null = null
    for (const attachment of this.attachments.values()) {
      const observation = byWindow.get(windowKey(attachment.key))
      if (!observation) continue
      if (!observation.present) {
        if (attachment.presence !== 'lost') { attachment.presence = 'lost'; attachment.lostAt = this.now() }
        continue
      }
      attachment.lostAt = null
      attachment.lastSeen = this.now()
      if (observation.bounds) attachment.target = { ...attachment.target, bounds: { ...observation.bounds } }
      if (observation.title && observation.document === undefined && !attachment.key.document) attachment.target.title = observation.title.slice(0, 240)
      const documentKnown = observation.document !== undefined
      const showingItsDocument = !documentKnown || !attachment.key.document || sameDocument(attachment.key.document, observation.document ?? null)
      if (documentKnown && observation.document && attachment.key.document && sameDocument(attachment.key.document, observation.document)) {
        // The attachment follows its tab: a navigation inside it updates the
        // fingerprint and title rather than reading as a different surface.
        attachment.key = { ...attachment.key, document: { ...observation.document } }
        attachment.target.title = observation.document.displayTitle || attachment.target.title
      }
      if (!showingItsDocument) attachment.presence = 'waiting'
      else if (observation.focused) {
        attachment.presence = 'focused'
        if (!focusedCandidate || attachment.lastUsed > focusedCandidate.lastUsed) focusedCandidate = attachment
      } else attachment.presence = 'background'
    }
    if (focusedCandidate && focusedCandidate.id !== this.currentId) {
      // A conversation about a document that is not showing is never made
      // current by focus alone; the person reaches it with the hotkey.
      this.setCurrent(focusedCandidate.id)
    }
    this.sweep()
    return { currentChanged: before !== this.currentId }
  }

  retire(id: string): boolean {
    const attachment = this.attachments.get(id)
    if (!attachment) return false
    this.attachments.delete(id)
    if (this.currentId === id) {
      const next = this.list().find((candidate) => candidate.presence !== 'lost') ?? this.list()[0] ?? null
      this.setCurrent(next?.id ?? null)
    } else this.dependencies.onChange?.()
    return true
  }

  /** Retention: lost windows leave after ten minutes; idle background
   * conversations without a session after thirty. The current attachment and
   * anything owning a session are never swept. */
  sweep(): string[] {
    const removed: string[] = []
    for (const attachment of this.list()) {
      if (attachment.id === this.currentId || attachment.sessionId) continue
      const idle = this.now() - attachment.lastUsed
      if (attachment.presence === 'lost' && attachment.lostAt !== null && this.now() - attachment.lostAt > attachmentLostRetentionMs) removed.push(attachment.id)
      else if (attachment.presence !== 'lost' && idle > attachmentIdleRetentionMs) removed.push(attachment.id)
    }
    for (const id of removed) this.attachments.delete(id)
    if (removed.length) this.dependencies.onChange?.()
    return removed
  }

  summaries(): AttachmentSummary[] {
    return this.list().map((attachment) => ({
      id: attachment.id,
      application: attachment.target.application,
      bundleIdentifier: attachment.key.bundleIdentifier,
      windowId: attachment.key.windowId,
      title: attachment.target.title.slice(0, 120),
      document: attachment.key.document ? { ...attachment.key.document } : null,
      presence: attachment.presence,
      current: attachment.id === this.currentId,
      sessionId: attachment.sessionId,
      lastUsed: new Date(attachment.lastUsed).toISOString(),
    }))
  }

  private enforceLimit(): void {
    const extra = this.list().filter((attachment) => attachment.id !== this.currentId && !attachment.sessionId).slice(attachmentLimit - 1)
    for (const attachment of extra) this.attachments.delete(attachment.id)
  }
}

function plainTarget(target: LiveComputerTarget): LiveComputerTarget {
  return { windowId: target.windowId, application: target.application, bundleIdentifier: target.bundleIdentifier, title: target.title, bounds: { ...target.bounds } }
}

export interface Rect { x: number; y: number; width: number; height: number }

/** The parts of `rect` not covered by any of `covers`, as disjoint rectangles.
 * Bounded so a pathological stack of windows cannot produce an unbounded
 * clip path. Used only for presence clipping; never for input geometry. */
export function subtractRects(rect: Rect, covers: Rect[], limit = 24): Rect[] {
  let pieces: Rect[] = [rect]
  for (const cover of covers) {
    const next: Rect[] = []
    for (const piece of pieces) {
      const left = Math.max(piece.x, cover.x)
      const top = Math.max(piece.y, cover.y)
      const right = Math.min(piece.x + piece.width, cover.x + cover.width)
      const bottom = Math.min(piece.y + piece.height, cover.y + cover.height)
      if (right <= left || bottom <= top) { next.push(piece); continue }
      if (top > piece.y) next.push({ x: piece.x, y: piece.y, width: piece.width, height: top - piece.y })
      if (bottom < piece.y + piece.height) next.push({ x: piece.x, y: bottom, width: piece.width, height: piece.y + piece.height - bottom })
      if (left > piece.x) next.push({ x: piece.x, y: top, width: left - piece.x, height: bottom - top })
      if (right < piece.x + piece.width) next.push({ x: right, y: top, width: piece.x + piece.width - right, height: bottom - top })
    }
    pieces = next.filter((piece) => piece.width >= 1 && piece.height >= 1)
    if (pieces.length > limit) return pieces.slice(0, limit)
    if (pieces.length === 0) return []
  }
  return pieces
}

export function rectsArea(rects: Rect[]): number {
  return rects.reduce((sum, rect) => sum + rect.width * rect.height, 0)
}
