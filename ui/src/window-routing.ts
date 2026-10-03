import type { LiveComputerApplicationIdentity, LiveComputerSessionTarget, LiveComputerSurfaceRole, LiveComputerTarget, WorkSurfaceIntent, WorkSurfaceResolution } from '../../src/types.js'
import { currentSelectedWorkWindow } from '../../src/selected-work-window.js'
import { liveComputerRouteRequirementIds, type LiveComputerRouteStartEntry } from '../../src/desktop-contract.js'
import { validateRouteAgainstIntent, freshSurfaceSuggestion, freshSurfaceSuggestions, freshSurfaceSuggestionsForIntent, requiredSurfaceApplications, resolveSurfaceApplication, surfaceApplicationReferenceRole, workSurfaceSharingAllowed, type FreshSurfaceSuggestion } from '../../src/fresh-surface.js'

export type LiveWindowSelection = LiveComputerSessionTarget & { role: LiveComputerSurfaceRole; purpose: string }

export type LiveWindowRouteStep = { requirementId?: string; requirementIds?: string[] } & (
  | (LiveWindowSelection & { kind: 'existing'; source: 'existing' })
  | {
      kind: 'fresh'
      source: 'fresh'
      application: string
      bundleIdentifier: string
      url: string | null
      reason: string
      authority: 'observe' | 'input'
      role: LiveComputerSurfaceRole
      purpose: string
    }
)

function explicitlyNamesApplication(goal: string, target: LiveComputerTarget): boolean {
  return requiredSurfaceApplications(goal, [{ application: target.application, bundleIdentifier: target.bundleIdentifier }])
    .some((record) => record.bundleIdentifier === target.bundleIdentifier)
}

const recommendationStopwords = new Set([
  'and', 'are', 'for', 'from', 'have', 'into', 'open', 'that', 'the', 'then', 'this', 'use', 'will', 'window', 'with',
])

export function goalMatchScore(goal: string, candidate: string): number {
  const tokens = (value: string) => new Set(value.toLowerCase().split(/[^a-z0-9]+/u).filter((item) => item.length > 2 && !recommendationStopwords.has(item)))
  const goalTokens = tokens(goal)
  const candidateTokens = tokens(candidate)
  if (goalTokens.size === 0 || candidateTokens.size === 0) return 0
  return [...candidateTokens].filter((token) => goalTokens.has(token)).length / candidateTokens.size
}

export function windowRecommendationScore(goal: string, target: LiveComputerTarget): number {
  const namedApplications = requiredSurfaceApplications(goal)
  const targetRecord = resolveSurfaceApplication(target.application, [{ application: target.application, bundleIdentifier: target.bundleIdentifier }])
  const namedSameKind = targetRecord ? namedApplications.filter((record) => record.kind === targetRecord.kind) : namedApplications
  if (namedSameKind.length > 0 && !namedSameKind.some((record) => record.bundleIdentifier === target.bundleIdentifier)) return 0
  const referenceRole = targetRecord ? surfaceApplicationReferenceRole(goal, targetRecord) : null
  const applicationScore = explicitlyNamesApplication(goal, target) ? 1 : referenceRole === 'preferred' ? 0.8 : 0
  // When the app name is the thing being discussed, score the visible
  // document/tab title rather than rewarding the app chrome for sharing that
  // name. A Chrome tab titled "Arc browser" may still be relevant; the Arc
  // application's bare identity is not.
  const nameScore = goalMatchScore(goal, referenceRole === 'subject' ? target.title : `${target.application} ${target.title}`)
  const goalLower = goal.toLowerCase()
  const appLower = target.application.toLowerCase()
  const intents: Array<{ goal: RegExp; app: RegExp }> = [
    { goal: /\b(browser|internet|web|online|search|look up|google|website|url|http|research)\b/i, app: /chrome|safari|firefox|edge|arc/i },
    { goal: /\b(email|mail|inbox|reply)\b/i, app: /mail|outlook/i },
    { goal: /\b(chat|slack|team|message)\b/i, app: /slack|teams|discord|messages/i },
    { goal: /\b(write|draft|document|note|text)\b/i, app: /textedit|word|pages|notes|notion|obsidian|bear/i },
    { goal: /\b(code|program|develop|script|debug)\b/i, app: /xcode|vscode|cursor|vim|nova|zed/i },
    { goal: /\b(terminal|shell|bash|command)\b/i, app: /terminal|iterm|warp/i },
    { goal: /\b(spreadsheet|excel|numbers|table|chart|graph)\b/i, app: /excel|numbers|sheets/i },
    { goal: /\b(present|slide|keynote|powerpoint)\b/i, app: /keynote|powerpoint/i },
    { goal: /\b(zoom|video call|meeting|conference)\b/i, app: /zoom|meet|teams|facetime/i },
    { goal: /\b(calendar|schedule|appointment)\b/i, app: /calendar|fantastical/i },
    { goal: /\b(file|folder|finder)\b/i, app: /finder/i },
    { goal: /\b(design|figma|sketch|wireframe)\b/i, app: /figma|sketch/i },
  ]
  const intentScore = intents.some((intent) => intent.goal.test(goalLower) && intent.app.test(appLower)) ? 0.7 : 0
  return Math.max(applicationScore, nameScore, intentScore)
}

/** Return only a confident recommendation. A weak overlap or near-tie leaves
 * the choice empty instead of silently substituting another application. */
export function confidentWindowRecommendations(goal: string, targets: LiveComputerTarget[], maximum = 3): LiveComputerTarget[] {
  const ranked = targets
    .map((target) => ({ target, score: windowRecommendationScore(goal, target) }))
    .filter((entry) => entry.score >= 0.4)
    .sort((left, right) => right.score - left.score)
  if (ranked.length === 0) return []
  const exactNamed = requiredSurfaceApplications(goal).length > 0 && ranked[0]!.score === 1
  if (!exactNamed && ranked.length > 1 && ranked[0]!.score - ranked[1]!.score < 0.2) return []
  return ranked.slice(0, maximum).map((entry) => entry.target)
}

export function suggestedWindowRoute(goal: string, targets: LiveComputerTarget[], inferredFresh?: FreshSurfaceSuggestion | null): LiveWindowSelection[] {
  // A goal that points at a site or a browser gets the fresh-window offer as
  // its browser surface; one of the person's own browser windows is never
  // pre-selected for it. Only a window the goal actually names or implies is
  // pre-selected at all — otherwise the choice stays with the person.
  const fresh = inferredFresh === undefined ? freshSurfaceSuggestion(goal) : inferredFresh
  const browserPattern = /chrome|safari|firefox|edge|arc/iu
  const candidates = fresh?.url ? targets.filter((target) => !browserPattern.test(`${target.application} ${target.bundleIdentifier}`)) : targets
  const best = confidentWindowRecommendations(goal, candidates, 1)[0]
  const role: LiveComputerSurfaceRole = fresh?.url ? 'destination' : 'workspace'
  return best ? [{
    target: best,
    authority: 'input',
    role,
    purpose: role === 'destination' ? 'Build the requested result' : 'Complete the approved task',
  }] : []
}

/** Builds the route the person reviews, including fresh windows that do not
 * exist yet. It is intentionally pure: opening a picker or editing this draft
 * can never open an application or mutate the desktop. */
export function suggestedWindowRouteDraft(
  goal: string,
  targets: LiveComputerTarget[],
  installedBrowsers?: string[],
  installedApplications: LiveComputerApplicationIdentity[] = [],
  intent?: WorkSurfaceIntent,
  resolution?: WorkSurfaceResolution,
  selectedSource?: LiveComputerTarget,
): LiveWindowRouteStep[] {
  const suggestions = intent
    ? freshSurfaceSuggestionsForIntent(intent, installedBrowsers, installedApplications, resolution)
    : freshSurfaceSuggestions(goal, installedBrowsers, installedApplications)
  if (intent?.version === 3) {
    const currentSource = selectedSource ? currentSelectedWorkWindow(selectedSource, targets) : null
    const compatibleSourceIndexes = selectedSource ? intent.requirements.flatMap((requirement, index) => {
      const authority = requirement.role === 'reference' ? 'observe' as const : 'input' as const
      const purpose = (intent.resources ?? []).filter(resource => requirement.resourceIds?.includes(resource.id)).map(resource => resource.outcome).join('; ').slice(0, 120)
      const applies = requirement.freshness !== 'required'
        && validateRouteAgainstIntent({ ...intent, requirements: [requirement] }, [{ source: 'existing', target: selectedSource, ...(requirement.id ? { requirementId: requirement.id } : {}), authority, role: requirement.role, purpose }]).ok
      return applies ? [index] : []
    }) : []
    const selectedIndexes = new Set(workSurfaceSharingAllowed(intent) ? compatibleSourceIndexes : compatibleSourceIndexes.slice(0, 1))
    const selectedRequirements = intent.requirements.filter((_requirement, index) => selectedIndexes.has(index))
    const selectedIds = selectedRequirements.flatMap(requirement => requirement.id ? [requirement.id] : [])
    const selectedRoles = new Set(selectedRequirements.map(requirement => requirement.role))
    const selectedPurpose = (intent.resources ?? []).filter(resource => selectedRequirements.some(requirement => requirement.resourceIds?.includes(resource.id))).map(resource => resource.outcome).join('; ').slice(0, 120)
    const selectedStep: LiveWindowRouteStep | null = currentSource && selectedRequirements.length ? {
      kind: 'existing', source: 'existing', ...(selectedIds.length > 1 ? { requirementIds: selectedIds } : selectedIds.length === 1 ? { requirementId: selectedIds[0]! } : {}),
      target: currentSource, authority: selectedRequirements.every(requirement => requirement.role === 'reference') ? 'observe' : 'input',
      role: selectedRoles.size === 1 ? selectedRequirements[0]!.role : 'workspace', purpose: selectedPurpose || 'Complete the requested work in the selected window',
    } : null
    let selectedInserted = false
    // Project resolved bindings. No title/keyword scoring can add another destination.
    return intent.requirements.flatMap((requirement, index): LiveWindowRouteStep[] => {
      if (selectedIndexes.has(index)) {
        if (selectedInserted || !selectedStep) return []
        selectedInserted = true
        return [selectedStep]
      }
      const resolved = resolution?.requirements.find(entry => entry.requirementIndex === intent.requirements.indexOf(requirement))
      const bundle = resolved?.selectedApplication?.bundleIdentifier ?? requirement.application.bundleIdentifier
      const purpose = (intent.resources ?? []).filter(resource => requirement.resourceIds?.includes(resource.id)).map(resource => resource.outcome).join('; ').slice(0, 120)
      const authority = requirement.role === 'reference' ? 'observe' as const : 'input' as const
      const fresh = suggestions.find(suggestion => suggestion.requirementId === requirement.id)
      if (fresh) return [{ kind: 'fresh', source: 'fresh', requirementId: requirement.id!, application: fresh.application,
        bundleIdentifier: fresh.bundleIdentifier, url: fresh.url, reason: fresh.reason, authority: 'input', role: requirement.role, purpose: (fresh.purpose ?? 'Complete the requested outcome').slice(0, 120) }]
      const candidates = targets.filter(target => target.bundleIdentifier === bundle)
      // Ambiguous existing resources require selection; never choose a personal document by title overlap.
      if (requirement.freshness === 'required' || candidates.length !== 1) return []
      return [{ kind: 'existing', source: 'existing', requirementId: requirement.id!, target: candidates[0]!, authority, role: requirement.role,
        purpose }]
    })
  }
  const freshBundles = new Set(suggestions.map((entry) => entry.bundleIdentifier))
  const resolvedBundles = resolution
    ? new Set(resolution.requirements.flatMap((entry) => entry.selectedApplication ? [entry.selectedApplication.bundleIdentifier] : []))
    : null
  // An application the goal wants opened fresh never has one of the person's
  // existing windows pre-selected for it (2026-09-03: "open a new TextEdit
  // document" routed into a personal note).
  const existing = suggestedWindowRoute(goal, targets.filter((target) => !freshBundles.has(target.bundleIdentifier)
    && (!resolvedBundles || resolvedBundles.has(target.bundleIdentifier))), suggestions[0] ?? null).map((entry): LiveWindowRouteStep => ({
    ...entry,
    kind: 'existing',
    source: 'existing',
  }))
  if (suggestions.length === 0) return existing
  const [first, ...rest] = suggestions
  const freshSteps: LiveWindowRouteStep[] = suggestions.map((fresh, index) => ({
    kind: 'fresh',
    source: 'fresh',
    application: fresh.application,
    bundleIdentifier: fresh.bundleIdentifier,
    url: fresh.url,
    reason: fresh.reason,
    authority: 'input',
    role: fresh.url ? 'research' : index > 0 && first!.url ? 'destination' : 'workspace',
    purpose: fresh.url ? 'Research and verify source information' : index > 0 && first!.url ? 'Build the requested result' : 'Complete the approved task',
  }))
  // A fresh research browser leads into the fresh document the goal asked
  // for, else into the best matching existing destination when one is clear.
  // A named document app alone is the workspace itself.
  if (first!.url) return rest.length > 0 ? freshSteps : [freshSteps[0]!, ...existing]
  return freshSteps
}

export function liveWindowRouteStepKey(entry: LiveWindowRouteStep): string {
  const requirements = liveComputerRouteRequirementIds(entry)
  return entry.kind === 'fresh'
    ? `fresh:${requirements.length ? `${requirements.join(',')}:` : ''}${entry.bundleIdentifier}:${entry.url ?? ''}`
    : `existing:${requirements.length ? `${requirements.join(',')}:` : ''}${entry.target.bundleIdentifier}:${entry.target.windowId}`
}

export function liveWindowRouteStartEntries(route: LiveWindowRouteStep[]): LiveComputerRouteStartEntry[] {
  return route.map((entry) => entry.kind === 'fresh' ? {
    ...(entry.requirementIds?.length ? { requirementIds: entry.requirementIds } : entry.requirementId ? { requirementId: entry.requirementId } : {}),
    source: 'fresh', application: entry.application, bundleIdentifier: entry.bundleIdentifier, url: entry.url,
    authority: entry.authority, role: entry.role, purpose: entry.purpose,
  } : {
    ...(entry.requirementIds?.length ? { requirementIds: entry.requirementIds } : entry.requirementId ? { requirementId: entry.requirementId } : {}),
    source: 'existing', target: entry.target, authority: entry.authority, role: entry.role, purpose: entry.purpose,
  })
}

/** Restore requirement metadata and ordering after a person fills a missing
 * slot. Ambiguous slots remain unbound for validation instead of guessing. */
export function bindWindowRouteDraft(route: LiveWindowRouteStep[], intent: WorkSurfaceIntent): LiveWindowRouteStep[] {
  if (intent.version !== 3) return route
  const used = new Set(route.flatMap(entry => liveComputerRouteRequirementIds(entry)))
  const bound = route.map(entry => {
    if (liveComputerRouteRequirementIds(entry).length) return entry
    const matches = intent.requirements.filter(requirement => !used.has(requirement.id!)
      && validateRouteAgainstIntent({ ...intent, requirements: [requirement] }, liveWindowRouteStartEntries([{ ...entry, role: requirement.role }])).ok)
    if (matches.length !== 1) return entry
    const requirement = matches[0]!
    used.add(requirement.id!)
    return { ...entry, requirementId: requirement.id!, role: requirement.role,
      authority: requirement.role === 'reference' ? 'observe' as const : entry.authority,
      purpose: (intent.resources ?? []).filter(resource => requirement.resourceIds?.includes(resource.id)).map(resource => resource.outcome).join('; ').slice(0, 120) }
  })
  const order = (entry: LiveWindowRouteStep) => {
    const ids = liveComputerRouteRequirementIds(entry)
    const index = intent.requirements.findIndex(r => Boolean(r.id && ids.includes(r.id)))
    return index < 0 ? intent.requirements.length : index
  }
  return bound.sort((a, b) => order(a) - order(b))
}
