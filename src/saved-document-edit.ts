import type { LiveComputerRouteStartEntry } from './desktop-contract.js'
import type { LiveComputerTarget, WorkSurfaceIntent, WorkSurfaceRequirement } from './types.js'
import { isBrowserBundleIdentifier } from './computer-use/effects.js'
import { isCarveOwnBundle } from './fresh-surface.js'

/** `STEWARD_SAVED_DOCUMENT_FOLLOW_UP=off`: "add … to the same document" after a save is interpreted as before. */
export const savedDocumentFollowUpEnabled = () => process.env.STEWARD_SAVED_DOCUMENT_FOLLOW_UP?.trim().toLowerCase() !== 'off'
/** `STEWARD_SAVED_DOCUMENT_SOURCES=off`: an edit of a saved document never revisits the conversation's source pages first. */
export const savedDocumentSourcesEnabled = () => process.env.STEWARD_SAVED_DOCUMENT_SOURCES?.trim().toLowerCase() !== 'off'

const editVerb = /\b(?:add|append|include|insert|put|write|update|extend|fill in|correct|fix|change)\b/iu
const documentReference = /\b(?:(?:the\s+)?same\s+(?:document|doc|file|note|text\s+file)|(?:to|in|into|on)\s+(?:the|that|this|my|our)\s+(?:(?:saved|text)\s+)?(?:document|doc|file|note|text\s+file)|(?:to|in|into)\s+it\b)/iu

/** A request to add to, update or correct the document ("Also add the rates to the same document"). */
export function savedDocumentEditRequest(request: string): boolean {
  return savedDocumentFollowUpEnabled() && editVerb.test(request) && documentReference.test(request)
}

/**
 * Right after this conversation saved a document, "add … to the same document" is work on that document, whatever the
 * interpretation called it. In testing it was read as `capabilities_here` with fulfillment blocked
 * and answered with a list of what Carve can do; nothing was added. Deterministic: the conversation has a verified
 * save (the receipt ledger), and the request both asks for an edit and points at the document.
 */
export function savedDocumentFollowUpIntent<T extends { intent: string; relationship: string }>(decision: T, request: string, conversationSavedDocument: boolean): T | null {
  if (!conversationSavedDocument || !savedDocumentEditRequest(request)) return null
  if (decision.intent === 'execute' || decision.intent === 'resume' || decision.intent === 'close' || decision.intent === 'guide') return null
  return { ...decision, intent: 'execute', relationship: 'same_goal' }
}

const isSource = (entry: LiveComputerRouteStartEntry) => entry.role === 'research' || entry.role === 'reference' || entry.authority === 'observe'
const sameWindow = (left: Pick<LiveComputerTarget, 'windowId' | 'bundleIdentifier'>, right: Pick<LiveComputerTarget, 'windowId' | 'bundleIdentifier'>) =>
  left.windowId === right.windowId && left.bundleIdentifier === right.bundleIdentifier

/**
 * The route for an edit of a document this conversation saved. The router asks for the facts it needs from "the pages
 * of the current task", but offered a fresh, empty browser window, after the destination (in testing:
 * the document stage ran first, said the rates were "not established" in the task's sources and stalled; the source
 * pages were never opened). When the conversation's earlier hand-off read those pages in a window that is still open:
 * - a fresh browser surface that only reads or researches becomes that window (research: it may follow the pages'
 *   links, and it is shown in the hand-off review before anything runs);
 * - every reading stage runs before the document stage.
 * Nothing changes when the selected window is not a saved document of this conversation.
 */
export function savedDocumentEditRoute(route: LiveComputerRouteStartEntry[], input: {
  savedDocumentSelected: boolean
  /** Targets of the earlier hand-off's reading stages (in order), already filtered to windows still open. */
  priorSources: LiveComputerTarget[]
}): LiveComputerRouteStartEntry[] {
  if (!savedDocumentSourcesEnabled() || !input.savedDocumentSelected) return route
  const used = new Set<number>()
  const available = (target: LiveComputerTarget, index: number) => !used.has(index) && !route.some(other => other.source === 'existing' && sameWindow(other.target, target))
  const rebind = (entry: Extract<LiveComputerRouteStartEntry, { source: 'fresh' }>, prior: LiveComputerTarget): LiveComputerRouteStartEntry => {
    used.add(input.priorSources.indexOf(prior))
    return { ...(entry.requirementId ? { requirementId: entry.requirementId } : {}), ...(entry.requirementIds ? { requirementIds: entry.requirementIds } : {}),
      source: 'existing', target: prior, authority: 'input', role: 'research',
      purpose: 'Read the pages this conversation used for facts the saved document does not have yet' }
  }
  const rebound = route.flatMap((entry): LiveComputerRouteStartEntry[] => {
    if (entry.source !== 'fresh' || !isSource(entry)) return [entry]
    const sameApplication = input.priorSources.find((target, index) => available(target, index) && target.bundleIdentifier === entry.bundleIdentifier)
    if (sameApplication) return [rebind(entry, sameApplication)]
    // A browser reading step can open the pages by address. Any other "fresh" reading step is the router guessing an
    // application for "the source it used before" (3 Oct, 0.1.8: it named an internal stage id, and the app picker chose
    // Carve itself, so the edit failed waiting for a Carve window). It becomes the conversation's next earlier reading
    // window, or is dropped: an edit of a saved document reads this conversation's pages and opens no other app.
    if (isBrowserBundleIdentifier(entry.bundleIdentifier) && !isCarveOwnBundle(entry.bundleIdentifier)) return [entry]
    const earlier = input.priorSources.find((target, index) => available(target, index))
    return earlier ? [rebind(entry, earlier)] : []
  })
  return [...rebound.filter(isSource), ...rebound.filter(entry => !isSource(entry))]
}

/**
 * The route intent for an edit of a document this conversation saved, before applications are resolved. The router
 * sometimes names an application for "the source it used before" that is not a browser (e2e D02/D03, 3 Oct: it asked
 * for Carve itself, as `@carve/desktop`). Rewriting only the route (savedDocumentEditRoute) is not enough: the reviewed
 * intent still required that application, so the start-time check rejected the route ("Add an application like
 * @carve/desktop") and nothing ran. Each such reading requirement becomes the conversation's next earlier reading
 * window, by its exact application, or is dropped when there is none: the same rule as the route, applied where the
 * plan's requirements are fixed. Browser reading requirements and requirements bound to an existing window are kept.
 */
export function savedDocumentEditIntent(intent: WorkSurfaceIntent, input: { savedDocumentSelected: boolean; priorSources: LiveComputerTarget[]; document?: Pick<LiveComputerTarget, 'bundleIdentifier'> }): WorkSurfaceIntent {
  if (!savedDocumentSourcesEnabled() || !input.savedDocumentSelected) return intent
  const used = new Set<number>()
  let changed = false
  // "Add … to the same document": the saved document is what is written; every other window only reads. The router
  // once inverted this (e2e D02, 3 Oct): the document became a read-only reference and a fresh Chrome window the
  // workspace, so the edit stage opened Google's homepage and could not reach the document.
  const isDocument = (requirement: WorkSurfaceRequirement) => requirement.freshness === 'existing'
    && Boolean(input.document && requirement.application.bundleIdentifier === input.document.bundleIdentifier)
  const roles = intent.requirements.map((requirement): WorkSurfaceRequirement => {
    const role = isDocument(requirement) ? 'destination' : requirement.role === 'workspace' || requirement.role === 'destination' ? 'research' : requirement.role
    if (role === requirement.role || !input.document || !intent.requirements.some(isDocument)) return requirement
    changed = true
    return { ...requirement, role }
  })
  const requirements = roles.flatMap((requirement): WorkSurfaceRequirement[] => {
    const reading = requirement.role === 'research' || requirement.role === 'reference'
    const bundle = requirement.application.bundleIdentifier
    if (!reading || requirement.freshness === 'existing') return [requirement]
    if (bundle && isBrowserBundleIdentifier(bundle) && !isCarveOwnBundle(bundle)) return [requirement]
    if (requirement.capability === 'web_browser' && !bundle) return [requirement]
    if (bundle && input.priorSources.some(target => target.bundleIdentifier === bundle)) return [requirement]
    changed = true
    const index = input.priorSources.findIndex((_target, candidate) => !used.has(candidate))
    if (index < 0) return []
    used.add(index)
    const prior = input.priorSources[index]!
    return [{ ...requirement,
      application: { requestedName: prior.application, bundleIdentifier: prior.bundleIdentifier },
      applicationBinding: 'required',
      ...(isBrowserBundleIdentifier(prior.bundleIdentifier) ? { capability: 'web_browser' as const } : {}),
      operationConstraints: [],
      freshness: requirement.freshness === 'required' ? 'preferred' : requirement.freshness,
      initialResource: null }]
  })
  return changed ? { ...intent, requirements } : intent
}
