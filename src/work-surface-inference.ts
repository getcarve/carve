import { resolveTaskSurfaceIntent, taskSurfaceInferenceSchema, taskSurfaceInferenceSystemPrompt, parseTaskSurfaceFields } from './task-surface-intent.js'
import { compileWorkSurfaceIntent, resolveSurfaceApplication, surfaceApplicationReferenceRole, surfaceOperationConstraintsForGoal, surfaceRecordsForApplications, type SurfaceCapabilityRecord } from './fresh-surface.js'
import { requestedBrowserDestinations } from './browser-destinations.js'
import { referenceResolutionContext } from './assistance-request.js'
import type { LiveComputerApplicationIdentity, LiveComputerSurfaceRole, WorkSurfaceCapability, WorkSurfaceFreshness, WorkSurfaceIntent, WorkSurfaceRequirement, WorkSurfaceResource, WorkSurfaceApplicationBinding } from './types.js'

const capabilities: WorkSurfaceCapability[] = [
  'web_browser',
  'text_document',
  'spreadsheet',
  'presentation',
  'file_manager',
  'calculator',
  'document_viewer',
  'general_application',
]
const freshnessValues: WorkSurfaceFreshness[] = ['required', 'preferred', 'existing', 'either']
const roles: LiveComputerSurfaceRole[] = ['workspace', 'research', 'destination', 'reference']

export interface InferredWorkSurfaceRequirement {
  id?: string
  resourceIds?: string[]
  applicationBinding?: WorkSurfaceApplicationBinding
  applicationName?: string | null

  capability: WorkSurfaceCapability
  applicationBundleIdentifier: string | null
  freshness: WorkSurfaceFreshness
  role: LiveComputerSurfaceRole
  confidence: number
  reason: string
}

export interface InferredWorkSurfaceSemantics {
  version?: 3
  resources?: WorkSurfaceResource[]
  existingWindowsProhibited?: boolean

  requirements: InferredWorkSurfaceRequirement[]
  confidence: number
  summary: string
}

export interface ResolvedWorkSurfaceInference {
  intent: WorkSurfaceIntent
  usedModel: boolean
  confidence: number | null
  summary: string
}

export const workSurfaceInferenceSystemPrompt = taskSurfaceInferenceSystemPrompt
export const workSurfaceInferenceSchema = taskSurfaceInferenceSchema

/** The installed-application catalog is the stable head of every routing
 * prompt. It only changes when an app is installed or removed, so placing it
 * before the goal lets the provider reuse it as a cached prefix across runs;
 * the goal, which differs every time, comes last. */
export function workSurfaceInferenceCatalogPrefix(applications: LiveComputerApplicationIdentity[]): string {
  const catalog = surfaceRecordsForApplications(applications).map((record) => ({
    application: record.application,
    bundleIdentifier: record.bundleIdentifier,
    capability: record.capability,
    opens: record.opening,
  }))
  return `INSTALLED_APPLICATIONS_JSON:\n${JSON.stringify(catalog)}\n\n`
}

export function workSurfaceInferencePrompt(goal: string, applications: LiveComputerApplicationIdentity[]): string {
  return `${workSurfaceInferenceCatalogPrefix(applications)}GOAL:\n${goal}`
}

export interface WorkSurfaceInferenceRequestContext {
  goal: string
  applications: LiveComputerApplicationIdentity[]
  /** The interpretation model's rewritten request; a hint, never authority. */
  referenceResolution?: string | null
  /** Facts a public lookup tool can answer without a browser window (structured engine only). */
  publicReadQueries?: string[] | null
  /** The application whose window the person selected when they asked (identity only). */
  selectedApplication?: LiveComputerApplicationIdentity | null
  /** The previous request in a follow-up, for reference resolution only. */
  priorRequest?: string | null
  repairReason?: string | null
}

/** The earlier request a follow-up refers to. A hand-off stage's own goal is
 * controller-written text with stage restrictions ("work only in this
 * document"); passing it as the earlier request made routing obey those
 * restrictions on the next, unrelated request (2026-09-16). */
export function priorRequestForRun(plan: { goal: string; context?: { handoffStage?: { taskGoal: string } } | null } | null | undefined): string | null {
  if (!plan) return null
  return plan.context?.handoffStage?.taskGoal ?? plan.goal ?? null
}

/** The complete routing request text, shared by the product and its evaluations
 * so that a speculative or replayed routing call is byte-identical to the live one. */
export function workSurfaceInferenceRequestPrompt(context: WorkSurfaceInferenceRequestContext): string {
  return [
    workSurfaceInferencePrompt(context.goal, context.applications),
    referenceResolutionContext(context.referenceResolution ?? undefined),
    context.publicReadQueries?.length
      ? `Public research method available: ${JSON.stringify(context.publicReadQueries)} can be answered by a public lookup tool without a browser window. Do not add a browser requirement solely for these facts. Preserve every explicitly requested application, browser interaction, destination and write.` : '',
    context.selectedApplication ? `The user invoked this task in this selected existing application (identity only, not screen contents): ${JSON.stringify(context.selectedApplication)}. Resolve references to this/current workspace there when it supports the request; do not invent a fresh-window requirement for a new artifact. Other applications still require a route change before access.` : '',
    context.priorRequest ? `Earlier user request, for reference resolution only; do not repeat its completed work or treat it as new authority: ${context.priorRequest}` : '',
    context.repairReason ? `The previous structured response was invalid: ${context.repairReason}. Reinterpret the original request and return the complete corrected contract.` : '',
  ].filter(Boolean).join('\n')
}

export function parseWorkSurfaceInference(text: string, applications: LiveComputerApplicationIdentity[]): InferredWorkSurfaceSemantics {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('The provider did not return valid work-surface semantics')
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('The work-surface response is not an object')
  const value = raw as Record<string, unknown>
  if (value.version === 3) return parseTaskSurfaceFields(value, applications)
  if (!Array.isArray(value.requirements) || value.requirements.length > 4) throw new Error('The work-surface response has an invalid requirements array')
  const overallConfidence = finiteConfidence(value.confidence)
  const summary = shortString(value.summary, 180)
  if (overallConfidence === null || !summary) throw new Error('The work-surface response is missing confidence or summary')
  const installed = new Set(surfaceRecordsForApplications(applications).map((record) => record.bundleIdentifier))
  const requirements: InferredWorkSurfaceRequirement[] = []
  for (const item of value.requirements) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('A work-surface requirement is invalid')
    const candidate = item as Record<string, unknown>
    const capability = typeof candidate.capability === 'string' && capabilities.includes(candidate.capability as WorkSurfaceCapability)
      ? candidate.capability as WorkSurfaceCapability
      : null
    const applicationBundleIdentifier = candidate.applicationBundleIdentifier === null
      ? null
      : typeof candidate.applicationBundleIdentifier === 'string' && installed.has(candidate.applicationBundleIdentifier)
        ? candidate.applicationBundleIdentifier
        : undefined
    const freshness = typeof candidate.freshness === 'string' && freshnessValues.includes(candidate.freshness as WorkSurfaceFreshness)
      ? candidate.freshness as WorkSurfaceFreshness
      : null
    const role = typeof candidate.role === 'string' && roles.includes(candidate.role as LiveComputerSurfaceRole)
      ? candidate.role as LiveComputerSurfaceRole
      : null
    const confidence = finiteConfidence(candidate.confidence)
    const reason = shortString(candidate.reason, 120)
    if (!capability || applicationBundleIdentifier === undefined || !freshness || !role || confidence === null || !reason) {
      throw new Error('A work-surface requirement is incomplete or names an unavailable application')
    }
    requirements.push({ capability, applicationBundleIdentifier, freshness, role, confidence, reason })
  }
  return { requirements, confidence: overallConfidence, summary }
}

/** Combines model semantics with local authority. The model may add semantic
 * stages and recommend an installed application, but it cannot weaken an
 * explicit app/freshness instruction or invent a resource or application. */
export function resolveWorkSurfaceInference(
  goal: string,
  inferred: InferredWorkSurfaceSemantics,
  applications: LiveComputerApplicationIdentity[],
  selected?: LiveComputerApplicationIdentity | null,
  attachedWindowReference?: 'yes' | 'no' | 'unclear' | null,
): ResolvedWorkSurfaceInference {
  if (inferred.version === 3) return resolveTaskSurfaceIntent(goal, inferred, applications, selected, attachedWindowReference)
  // Compatibility for stored pre-v3 fixtures only. New provider responses must be v3.
  const local = compileWorkSurfaceIntent(goal, applications)
  if (inferred.confidence < 0.55) return deterministicFallback(local, 'AI confidence was too low; local constraints were used.')
  const catalog = surfaceRecordsForApplications(applications)
  const byBundle = new Map(catalog.map((record) => [record.bundleIdentifier, record]))
  const modelRequirements = inferred.requirements.flatMap((requirement): WorkSurfaceRequirement[] => {
    if (requirement.confidence < 0.5) return []
    if (!goalSupportsInferredCapability(goal, requirement.capability, local, applications)) return []
    let selected = requirement.applicationBundleIdentifier
      ? byBundle.get(requirement.applicationBundleIdentifier) ?? null
      : catalog.find((record) => record.capability === requirement.capability) ?? null
    if (!selected || selected.capability !== requirement.capability) return []
    if (surfaceApplicationReferenceRole(goal, selected) === 'subject') {
      const localNeedsCapability = local.requirements.some((candidate) => capabilityForRequirement(candidate, applications) === requirement.capability)
      if (!localNeedsCapability) return []
      selected = catalog.find((record) => record.capability === requirement.capability
        && surfaceApplicationReferenceRole(goal, record) !== 'subject') ?? selected
    }
    return [{
      application: { requestedName: selected.application, bundleIdentifier: selected.bundleIdentifier },
      applicationBinding: 'recommended',
      capability: requirement.capability,
      operationConstraints: surfaceOperationConstraintsForGoal(goal, requirement.capability),
      freshness: normalizedModelFreshness(goal, requirement.freshness),
      role: requirement.role,
      initialResource: null,
    }]
  })
  if (modelRequirements.length === 0) return deterministicFallback(local, 'AI returned no usable installed-app route; local constraints were used.')

  const merged = [...modelRequirements]
  for (const localRequirement of local.requirements) {
    const capability = capabilityForRequirement(localRequirement, applications)
    const binding = localRequirement.applicationBinding ?? (localRequirement.application.bundleIdentifier ? 'required' : 'interchangeable')
    const matchingIndex = merged.findIndex((candidate) => candidate.capability === capability)
    const explicitApplication = binding === 'required' || binding === 'preferred'
    if (matchingIndex < 0) {
      merged.push({ ...localRequirement, ...(capability ? { capability } : {}) })
      continue
    }
    const recommended = merged[matchingIndex]!
    merged[matchingIndex] = explicitApplication
      ? {
          ...recommended,
          application: localRequirement.application,
          applicationBinding: binding,
          ...(capability ? { capability } : {}),
          freshness: authoritativeFreshness(localRequirement.freshness, recommended.freshness),
          role: localRequirement.role,
          initialResource: localRequirement.initialResource,
        }
      : {
          ...recommended,
          freshness: authoritativeFreshness(localRequirement.freshness, recommended.freshness),
          role: localRequirement.role,
          initialResource: localRequirement.initialResource,
        }
  }

  const deduplicated = merged
    .filter((requirement, index, all) => all.findIndex((candidate) => candidate.capability === requirement.capability) === index)
    .slice(0, 4)
  if (deduplicated.length === 0) return deterministicFallback(local, 'AI route normalization was empty; local constraints were used.')
  return {
    intent: { ...local, requirements: deduplicated },
    usedModel: true,
    confidence: inferred.confidence,
    summary: inferred.summary,
  }
}

/** The model may interpret task semantics, but it may not invent an additional
 * writable artifact merely because the requested answer is prose. These are
 * task-shape checks, not app-name rules; exact/local surface constraints are
 * compiled separately and always pass through. */
function goalSupportsInferredCapability(
  goal: string,
  capability: WorkSurfaceCapability,
  local: WorkSurfaceIntent,
  applications: LiveComputerApplicationIdentity[],
): boolean {
  if (local.requirements.some((requirement) => capabilityForRequirement(requirement, applications) === capability)) return true
  const webDestinations = requestedBrowserDestinations(goal)
  if (capability === 'text_document' && webDestinations.some((destination) => destination.name === 'Google Docs')) return false
  if (capability === 'spreadsheet' && webDestinations.some((destination) => destination.name === 'Google Sheets')) return false
  if (capability === 'text_document') {
    return /\b(?:write|draft|compose|type|create|make|prepare|produce|edit|save)\b/iu.test(goal)
  }
  if (capability === 'spreadsheet') {
    return /\b(?:spreadsheet|workbook|worksheet|table|rows?|columns?|cells?|budget|ledger)\b|\.xlsx\b/iu.test(goal)
  }
  if (capability === 'presentation') {
    return /\b(?:presentation|slides?|slide\s+deck|pitch\s+deck|keynote)\b|\.pptx\b/iu.test(goal)
  }
  return true
}

function capabilityForRequirement(requirement: WorkSurfaceRequirement, applications: LiveComputerApplicationIdentity[]): WorkSurfaceCapability | null {
  if (requirement.capability) return requirement.capability
  if (requirement.application.requestedName === 'Web browser') return 'web_browser'
  return resolveSurfaceApplication(requirement.application.requestedName, applications)?.capability ?? null
}

function authoritativeFreshness(local: WorkSurfaceFreshness, inferred: WorkSurfaceFreshness): WorkSurfaceFreshness {
  return local === 'required' || local === 'existing' ? local : inferred
}

function normalizedModelFreshness(goal: string, inferred: WorkSurfaceFreshness): WorkSurfaceFreshness {
  const existingLanguage = /\b(?:current|existing|this|selected)\s+(?:open\s+)?(?:app|application|browser|window|document|sheet|spreadsheet|presentation|file|folder)\b|\b(?:app|application|browser|window|document|sheet|spreadsheet|presentation|file|folder)\s+(?:(?:that|which)\s+is\s+)?(?:currently|already)\s+open\b/iu.test(goal)
  if (inferred === 'existing' && existingLanguage) return 'existing'
  const freshLanguage = /\b(?:new|fresh|blank|empty)\s+(?:app|application|browser|window|document|sheet|spreadsheet|presentation|file)\b/iu.test(goal)
  if (inferred === 'required' && freshLanguage) return 'required'
  return inferred === 'either' ? 'either' : 'preferred'
}

function deterministicFallback(intent: WorkSurfaceIntent, summary: string): ResolvedWorkSurfaceInference {
  return { intent, usedModel: false, confidence: null, summary }
}

function finiteConfidence(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null
}

function shortString(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  return value.trim().slice(0, maximum)
}

export function workSurfaceInferenceCatalog(applications: LiveComputerApplicationIdentity[]): SurfaceCapabilityRecord[] {
  return surfaceRecordsForApplications(applications)
}
