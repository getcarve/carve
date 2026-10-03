import type { LiveComputerRouteStartEntry } from './desktop-contract.js'
import { freshSurfaceSuggestionsForIntent, resolveSurfaceApplication, validateRouteAgainstIntent, workSurfaceSharingAllowed } from './fresh-surface.js'
import type { LiveComputerApplicationIdentity, LiveComputerTarget, WorkSurfaceIntent, WorkSurfaceResolution } from './types.js'

/** Materialize only the selected source and resolved fresh destinations.
 * Never guess which of the user's other existing documents should be edited.
 * `namedSource` is the one open document an explicit "my note" means (named-source-document.ts): it is read, never
 * edited, and always runs first, so the attached window becomes the destination of a source → destination hand-off. */
export function assistanceRoute(
  target: LiveComputerTarget,
  intent: WorkSurfaceIntent,
  applications: LiveComputerApplicationIdentity[],
  resolution?: WorkSurfaceResolution,
  namedSource?: LiveComputerTarget | null,
): LiveComputerRouteStartEntry[] {
  const source = namedSource && !intent.existingWindowsProhibited ? namedSource : null
  const sourceEntry = (requirementId?: string): LiveComputerRouteStartEntry => ({ ...(requirementId ? { requirementId } : {}), source: 'existing', target: source!,
    authority: 'observe', role: 'reference', purpose: 'Read the document the request names' })
  const sourceCapability = source ? resolveSurfaceApplication(source.application)?.capability ?? null : null
  let sourceBound = false
  if (!intent.requirements.length) return [{ source: 'existing', target, authority: 'input', role: 'workspace', purpose: 'Work on the requested outcome in the selected window' }]
  const suggestions = freshSurfaceSuggestionsForIntent(intent, applications.map(app => app.bundleIdentifier), applications, resolution)
  const compatibleSelectedIndexes = intent.requirements.flatMap((requirement, index) => {
    const existing: LiveComputerRouteStartEntry = { ...(requirement.id ? { requirementId: requirement.id } : {}), source: 'existing', target,
      authority: requirement.role === 'reference' ? 'observe' : 'input', role: requirement.role,
      purpose: 'Work on the requested outcome in the selected window' }
    const selected = resolution?.requirements.find(item => item.requirementIndex === index)?.selectedApplication
    const matchesSource = (!selected || selected.bundleIdentifier === target.bundleIdentifier)
      && validateRouteAgainstIntent({ ...intent, requirements: [requirement] }, [existing]).ok
    return matchesSource && requirement.freshness !== 'required' ? [index] : []
  })
  const selectedRequirementIndexes = new Set(workSurfaceSharingAllowed(intent) ? compatibleSelectedIndexes : compatibleSelectedIndexes.slice(0, 1))
  const selectedRequirements = intent.requirements.filter((_requirement, index) => selectedRequirementIndexes.has(index))
  const selectedIds = selectedRequirements.flatMap(requirement => requirement.id ? [requirement.id] : [])
  const selectedRoles = new Set(selectedRequirements.map(requirement => requirement.role))
  const selectedEntry: LiveComputerRouteStartEntry | null = selectedRequirements.length ? {
    ...(selectedIds.length > 1 ? { requirementIds: selectedIds } : selectedIds.length === 1 ? { requirementId: selectedIds[0]! } : {}),
    source: 'existing', target,
    authority: selectedRequirements.every(requirement => requirement.role === 'reference') ? 'observe' : 'input',
    role: selectedRoles.size === 1 ? selectedRequirements[0]!.role : 'workspace',
    purpose: selectedRequirements.length === 1 ? 'Work on the requested outcome in the selected window' : 'Complete the requested work in the selected window',
  } : null
  let selectedInserted = false
  const route = intent.requirements.flatMap((requirement, index): LiveComputerRouteStartEntry[] => {
    if (selectedRequirementIndexes.has(index)) {
      if (selectedInserted || !selectedEntry) return []
      selectedInserted = true
      return [selectedEntry]
    }
    const identity = requirement.id ? { requirementId: requirement.id } : {}
    // The document the request names is this reading surface: read it where it is instead of opening a blank one.
    if (source && !sourceBound && requirement.role !== 'destination' && requirement.freshness !== 'required'
      && (requirement.application.bundleIdentifier === source.bundleIdentifier || requirement.capability === sourceCapability)) {
      sourceBound = true
      return [sourceEntry(requirement.id)]
    }
    const selected = resolution?.requirements.find(item => item.requirementIndex === index)?.selectedApplication
    const fresh = suggestions.find(item => intent.version === 3 ? item.requirementId === requirement.id
      : item.bundleIdentifier === (selected?.bundleIdentifier ?? requirement.application.bundleIdentifier))
    if (!fresh) throw new Error(`Choose the ${requirement.application.requestedName} window for this task.`)
    return [{ ...identity, source: 'fresh', application: fresh.application, bundleIdentifier: fresh.bundleIdentifier,
      url: fresh.url, authority: 'input', role: requirement.role, purpose: 'Create the requested result' }]
  })
  // Keep the explicitly selected page available as read-only source context.
  if (!selectedEntry && !intent.existingWindowsProhibited) route.unshift({ source: 'existing', target, authority: 'observe', role: 'reference', purpose: 'Read the source selected during guidance' })
  if (source) {
    // The router may leave "my note" unbound; the named document is still the source. It is read before anything else.
    const index = route.findIndex(entry => entry.source === 'existing' && entry.target.windowId === source.windowId && entry.target.bundleIdentifier === source.bundleIdentifier)
    const entry = index >= 0 ? route.splice(index, 1)[0]! : sourceEntry()
    route.unshift(entry)
  }
  const validation = validateRouteAgainstIntent(intent, route)
  if (!validation.ok) throw new Error(validation.explanation)
  return route
}
