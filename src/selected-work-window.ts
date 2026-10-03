import { resolveSurfaceApplication } from './fresh-surface.js'
import { editSavedDocumentEnabled, titleShowsSavedFile, type GovernedSaveRecord } from './computer-use/governed-save.js'
import type { LiveComputerTarget } from './types.js'

/** A document window a governed save of this conversation wrote to disk and read back (governed-save.ts). */
export interface SavedDocumentWindow extends GovernedSaveRecord {
  windowId: number
  bundleIdentifier: string
  application: string
  /** The conversation whose turn saved it; a later conversation never inherits it. */
  conversationId: string | null
  savedAt: string
}

/** Refresh a selection for a new task, before its plan is prepared. Browser
 * titles describe the active tab, not the identity of the selected window.
 * Document selections retain their title check, with one exception: the same
 * window, whose title now shows the file a save receipt of this conversation
 * wrote from it ("Untitled 91" became a saved text file's name).
 * This never chooses a sibling window or changes an existing plan's
 * authorized target. */
export function currentSelectedWorkWindow(selected: LiveComputerTarget, targets: LiveComputerTarget[], saved: readonly SavedDocumentWindow[] = []): LiveComputerTarget | null {
  const app = resolveSurfaceApplication(selected.application)
  const browser = app?.kind === 'browser' && app.bundleIdentifier === selected.bundleIdentifier
  const sameWindow = (target: LiveComputerTarget) => target.windowId === selected.windowId
    && target.bundleIdentifier === selected.bundleIdentifier
    && target.application === selected.application
  const matches = targets.filter(target => sameWindow(target) && (browser || target.title === selected.title))
  if (matches.length === 1) return matches[0]!
  if (matches.length > 1 || browser) return null
  return savedDocumentRename(selected, targets, saved)
}

/** The selected document window, retitled by a save receipt of this conversation, or null. */
export function savedDocumentRename(selected: LiveComputerTarget, targets: LiveComputerTarget[], saved: readonly SavedDocumentWindow[]): LiveComputerTarget | null {
  if (!editSavedDocumentEnabled()) return null
  const receipts = saved.filter(record => record.windowId === selected.windowId && record.bundleIdentifier === selected.bundleIdentifier)
  if (!receipts.length) return null
  const renamed = targets.filter(target => target.windowId === selected.windowId && target.bundleIdentifier === selected.bundleIdentifier
    && target.application === selected.application && receipts.some(record => titleShowsSavedFile(target.title, record.filePath)))
  return renamed.length === 1 ? renamed[0]! : null
}

/** Receipts a new session in `target` inherits: this window's, from this conversation, newest last, one per file. */
export function savedDocumentsFor(ledger: readonly SavedDocumentWindow[], target: Pick<LiveComputerTarget, 'windowId' | 'bundleIdentifier'>, conversationId: string | null): SavedDocumentWindow[] {
  if (!editSavedDocumentEnabled() || !conversationId) return []
  const own = ledger.filter(record => record.windowId === target.windowId && record.bundleIdentifier === target.bundleIdentifier && record.conversationId === conversationId)
  return own.filter((record, index) => !own.slice(index + 1).some(later => later.filePath === record.filePath))
}
