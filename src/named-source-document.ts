import { surfaceCapabilityRegistry } from './fresh-surface.js'
import type { LiveComputerTarget } from './types.js'

/** `STEWARD_NAMED_SOURCE_DOCUMENT=off`: "my note" never resolves to an open document outside the attached window. */
export const namedSourceDocumentEnabled = () => process.env.STEWARD_NAMED_SOURCE_DOCUMENT?.trim().toLowerCase() !== 'off'

const reference = /\b(?:my|the|that|this|our)\s+(?:open\s+|text\s+|textedit\s+|own\s+)?(notes?|document|doc|memo|write-?up|text\s+file|list)\b/iu

/** The noun an explicit reference to a document the person has ("my note", "the document") uses, or null. */
export function namedSourceReference(request: string): string | null {
  return reference.exec(request)?.[1]?.toLocaleLowerCase('en-US') ?? null
}

const documentBundles = () => new Set(surfaceCapabilityRegistry.filter(record => record.capability === 'text_document').map(record => record.bundleIdentifier))
const words = (text: string) => new Set(text.toLocaleLowerCase('en-US').normalize('NFKD').split(/[^\p{L}\p{N}]+/u).filter(word => word.length >= 4))
const untitled = (title: string) => /^untitled(?:\s+\d+)?(?:\s*[—–-]\s*edited)?$/iu.test(title.trim())

/**
 * The one open document an explicit "my note" / "the document" plausibly means, when it is outside the attached window.
 * On 30 September (A-L2) the capsule was attached to a task app in Chrome, "Action items.txt" was open in TextEdit, and
 * "Add the three action items from my note as tasks in the task app" was answered "Which note should I use? I can only
 * work in the selected task app window": no window outside the attached one was ever a candidate source.
 *
 * Candidates are windows of text-document applications (TextEdit, Notes, Pages, Word) other than the attached window,
 * without blank "Untitled" documents. One candidate is the source. Several are narrowed to the ones whose title shares a
 * word of four letters or more with the request ("Action items.txt" for "the three action items"); still several, or
 * none, is no source, and the person is asked as before. Titles stay local: they are never sent to a model. The route
 * reads the document with observe authority only, and the hand-off review shows it before anything runs.
 */
export function namedSourceDocument(request: string, attached: Pick<LiveComputerTarget, 'windowId' | 'bundleIdentifier'> | null, targets: LiveComputerTarget[]): LiveComputerTarget | null {
  if (!namedSourceDocumentEnabled() || !namedSourceReference(request)) return null
  const bundles = documentBundles()
  const candidates = targets.filter(target => bundles.has(target.bundleIdentifier) && !untitled(target.title)
    && !(attached && target.windowId === attached.windowId && target.bundleIdentifier === attached.bundleIdentifier))
  if (attached && bundles.has(attached.bundleIdentifier)) return null
  if (candidates.length === 1) return candidates[0]!
  if (candidates.length === 0) return null
  const asked = words(request)
  const titled = candidates.filter(target => [...words(target.title.replace(/\.[a-z0-9]{1,5}$/iu, ''))].some(word => asked.has(word)))
  return titled.length === 1 ? titled[0]! : null
}
