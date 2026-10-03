import { liveComputerRouteRequirementIds, type LiveComputerRouteStartEntry } from './desktop-contract.js'
import { neverOfferedSurface, resolveSurfaceApplication, surfaceRecordsForApplications, type SurfaceCapabilityRecord } from './fresh-surface.js'
import type {
  LiveComputerApplicationIdentity,
  SurfaceApplicationPreference,
  SurfaceContinuityEvidence,
  SurfaceDefaultApplication,
  SurfacePreferenceMode,
  SurfacePreferenceProfile,
  SurfaceResolutionSignal,
  WorkSurfaceCapability,
  WorkSurfaceIntent,
  WorkSurfaceRequirement,
  WorkSurfaceResolution,
} from './types.js'
import { sha256, stableJson } from './util.js'

export const surfacePreferenceSettingKey = 'computer.surface_preferences.v1'

const capabilities: readonly WorkSurfaceCapability[] = [
  'web_browser', 'text_document', 'spreadsheet', 'presentation', 'file_manager', 'calculator', 'document_viewer', 'general_application',
]
const preferenceModes: readonly SurfacePreferenceMode[] = ['automatic', 'specific_application', 'ask_each_time']
const emptyTimestamp = '1970-01-01T00:00:00.000Z'

export interface ResolveSurfaceApplicationsInput {
  intent: WorkSurfaceIntent
  applications: LiveComputerApplicationIdentity[]
  catalog?: SurfaceCapabilityRecord[]
  preferences: SurfacePreferenceProfile
  osDefaults: SurfaceDefaultApplication[]
  continuity?: SurfaceContinuityEvidence[]
  resolvedAt?: string
}

export function emptySurfacePreferenceProfile(): SurfacePreferenceProfile {
  return { version: 1, updatedAt: emptyTimestamp, entries: [] }
}

export function parseSurfacePreferenceProfile(raw: string | null): SurfacePreferenceProfile {
  if (!raw) return emptySurfacePreferenceProfile()
  try {
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return emptySurfacePreferenceProfile()
    const record = value as Record<string, unknown>
    if (record.version !== 1 || !validTimestamp(record.updatedAt) || !Array.isArray(record.entries) || record.entries.length > capabilities.length) return emptySurfacePreferenceProfile()
    const entries: SurfaceApplicationPreference[] = []
    const seen = new Set<WorkSurfaceCapability>()
    for (const item of record.entries) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return emptySurfacePreferenceProfile()
      const entry = item as Record<string, unknown>
      if (typeof entry.capability !== 'string' || !capabilities.includes(entry.capability as WorkSurfaceCapability)) return emptySurfacePreferenceProfile()
      const capability = entry.capability as WorkSurfaceCapability
      if (seen.has(capability) || typeof entry.mode !== 'string' || !preferenceModes.includes(entry.mode as SurfacePreferenceMode)) return emptySurfacePreferenceProfile()
      const mode = entry.mode as SurfacePreferenceMode
      const bundleIdentifier = entry.bundleIdentifier === null ? null : boundedBundleIdentifier(entry.bundleIdentifier)
      const application = entry.application === null ? null : boundedApplication(entry.application)
      if (!validTimestamp(entry.chosenAt) || !['settings', 'confirmed_override'].includes(String(entry.source))) return emptySurfacePreferenceProfile()
      if (mode === 'specific_application' ? !bundleIdentifier || !application : bundleIdentifier !== null || application !== null) return emptySurfacePreferenceProfile()
      seen.add(capability)
      entries.push({
        capability,
        mode,
        bundleIdentifier,
        application,
        source: entry.source as SurfaceApplicationPreference['source'],
        chosenAt: entry.chosenAt as string,
      })
    }
    return { version: 1, updatedAt: record.updatedAt as string, entries }
  } catch {
    return emptySurfacePreferenceProfile()
  }
}

export function updateSurfacePreferenceProfile(
  profile: SurfacePreferenceProfile,
  input: { capability: WorkSurfaceCapability; mode: SurfacePreferenceMode; application?: string | null; bundleIdentifier?: string | null; source?: SurfaceApplicationPreference['source']; at: string },
): SurfacePreferenceProfile {
  const bundleIdentifier = input.mode === 'specific_application' ? boundedBundleIdentifier(input.bundleIdentifier) : null
  const application = input.mode === 'specific_application' ? boundedApplication(input.application) : null
  if (!capabilities.includes(input.capability)) throw new Error('Application preference capability is invalid')
  if (!preferenceModes.includes(input.mode)) throw new Error('Application preference mode is invalid')
  if (!validTimestamp(input.at)) throw new Error('Application preference timestamp is invalid')
  if (input.mode === 'specific_application' && (!bundleIdentifier || !application)) throw new Error('Choose an installed application for this preference')
  const entry: SurfaceApplicationPreference = {
    capability: input.capability,
    mode: input.mode,
    bundleIdentifier,
    application,
    source: input.source ?? 'settings',
    chosenAt: input.at,
  }
  return {
    version: 1,
    updatedAt: input.at,
    entries: [...profile.entries.filter((candidate) => candidate.capability !== input.capability), entry]
      .sort((left, right) => capabilities.indexOf(left.capability) - capabilities.indexOf(right.capability)),
  }
}

export function clearSurfacePreferenceProfile(profile: SurfacePreferenceProfile, capability: WorkSurfaceCapability, at: string): SurfacePreferenceProfile {
  if (!capabilities.includes(capability) || !validTimestamp(at)) throw new Error('Application preference reset is invalid')
  return { version: 1, updatedAt: at, entries: profile.entries.filter((entry) => entry.capability !== capability) }
}

export function surfacePreferenceProfileHash(profile: SurfacePreferenceProfile): string {
  return sha256(stableJson({ version: profile.version, entries: profile.entries }))
}

export function surfaceDefaultApplicationsHash(defaults: SurfaceDefaultApplication[]): string {
  return sha256(stableJson([...defaults].sort((left, right) => left.capability.localeCompare(right.capability) || left.bundleIdentifier.localeCompare(right.bundleIdentifier))))
}

export function surfaceApplicationCatalogHash(applications: LiveComputerApplicationIdentity[]): string {
  return sha256(stableJson(surfaceRecordsForApplications(applications).map((record) => ({
    application: record.application,
    bundleIdentifier: record.bundleIdentifier,
    capability: record.capability,
    opening: record.opening,
    lifecycle: record.lifecycle,
    operations: record.operations,
  })).sort((left, right) => left.bundleIdentifier.localeCompare(right.bundleIdentifier))))
}

export function workSurfaceResolutionHash(resolution: WorkSurfaceResolution): string {
  return sha256(stableJson({
    version: resolution.version,
    installedCatalogHash: resolution.installedCatalogHash,
    preferenceProfileHash: resolution.preferenceProfileHash,
    osDefaultsHash: resolution.osDefaultsHash,
    requirements: resolution.requirements,
  }))
}

export function resolveSurfaceApplications(input: ResolveSurfaceApplicationsInput): WorkSurfaceResolution {
  const catalog = input.catalog ?? surfaceRecordsForApplications(input.applications)
  const installed = new Set(input.applications.map((entry) => entry.bundleIdentifier))
  const preferences = new Map(input.preferences.entries.map((entry) => [entry.capability, entry]))
  const osDefaults = new Map(input.osDefaults.map((entry) => [entry.capability, entry]))
  const continuity = input.continuity ?? []

  const requirements = input.intent.requirements.map((requirement, requirementIndex) => {
    const capability = capabilityForRequirement(requirement, input.applications)
    if (!capability) return {
      requirementIndex,
      capability: 'general_application' as const,
      selectedApplication: null,
      signal: 'unresolved' as const,
      reasonCode: 'capability_unresolved',
      needsChoice: false,
      alternatives: [],
      candidates: [],
    }
    const candidateRecords = catalog
      .filter((record) => record.capability === capability)
      .sort((left, right) => left.productFallbackRank - right.productFallbackRank || left.bundleIdentifier.localeCompare(right.bundleIdentifier))
    const preference = preferences.get(capability)
    const defaultApplication = osDefaults.get(capability)
    const hardContinuity = continuity.find((entry) => entry.capability === capability && entry.strength === 'exact_artifact')
    const softContinuity = continuity.find((entry) => entry.capability === capability && entry.strength === 'same_task')
    const requiredOperations = (requirement.operationConstraints ?? []).filter((constraint) => constraint.required).map((constraint) => constraint.operation)
    const eligibility = new Map(candidateRecords.map((record) => {
      const rejectionCodes: string[] = []
      if (!installed.has(record.bundleIdentifier)) rejectionCodes.push('not_installed')
      if (neverOfferedSurface(record.bundleIdentifier)) rejectionCodes.push('application_denied')
      if (requirement.freshness === 'required' && (record.opening === 'none' || record.lifecycle !== 'fresh_window_provable')) rejectionCodes.push('fresh_surface_unavailable')
      for (const operation of requiredOperations) if (!record.operations.includes(operation)) rejectionCodes.push(`operation_unavailable:${operation}`)
      return [record.bundleIdentifier, rejectionCodes] as const
    }))
    const eligible = candidateRecords.filter((record) => eligibility.get(record.bundleIdentifier)?.length === 0)
    const binding = requirement.applicationBinding ?? (requirement.application.bundleIdentifier ? 'required' : 'interchangeable')
    const requestedBundle = requirement.application.bundleIdentifier
    const choose = (record: SurfaceCapabilityRecord, signal: SurfaceResolutionSignal, reasonCode: string, needsChoice = false) => decision(
      requirementIndex, capability, candidateRecords, eligibility, record, signal, reasonCode, needsChoice,
      signalCandidates(record, { requirement, preference, defaultApplication, hardContinuity, softContinuity }),
    )
    if (binding === 'required' && !requestedBundle) return decision(requirementIndex, capability, candidateRecords, eligibility, null, 'unresolved', 'explicit_application_unavailable', false)
    const exactBundle = binding === 'required' ? requestedBundle : hardContinuity?.bundleIdentifier ?? null
    if (exactBundle) {
      const exact = eligible.find((record) => record.bundleIdentifier === exactBundle)
      if (exact) return choose(exact, binding === 'required' ? 'explicit_required' : 'required_compatibility', binding === 'required' ? 'explicit_application_required' : 'exact_artifact_owner')
      return decision(requirementIndex, capability, candidateRecords, eligibility, null, 'unresolved', binding === 'required' ? 'explicit_application_unavailable' : 'artifact_owner_unavailable', false)
    }
    if (binding === 'preferred' && requestedBundle) {
      const preferred = eligible.find((record) => record.bundleIdentifier === requestedBundle)
      if (preferred) return choose(preferred, 'explicit_preferred', 'explicit_application_preferred')
    }
    if (preference?.mode === 'specific_application' && preference.bundleIdentifier) {
      const preferred = eligible.find((record) => record.bundleIdentifier === preference.bundleIdentifier)
      if (preferred) return choose(preferred, 'saved_preference', 'saved_capability_preference')
    }
    if (preference?.mode === 'ask_each_time') {
      return decision(requirementIndex, capability, candidateRecords, eligibility, null, 'ask_each_time', 'preference_requires_choice', true)
    }
    if (softContinuity) {
      const continuous = eligible.find((record) => record.bundleIdentifier === softContinuity.bundleIdentifier)
      if (continuous) return choose(continuous, 'task_continuity', 'same_task_application')
    }
    if (defaultApplication) {
      const osDefault = eligible.find((record) => record.bundleIdentifier === defaultApplication.bundleIdentifier)
      if (osDefault) return choose(osDefault, 'os_default', 'macos_default_application')
    }
    if (binding === 'recommended' && requestedBundle) {
      const recommended = eligible.find((record) => record.bundleIdentifier === requestedBundle)
      if (recommended) return choose(recommended, 'model_recommendation', 'model_task_fit')
    }
    const fallback = eligible[0]
    if (fallback) return choose(fallback, 'product_fallback', preference?.mode === 'specific_application' ? 'saved_preference_unavailable_fallback' : 'stable_capability_fallback')
    return decision(requirementIndex, capability, candidateRecords, eligibility, null, 'unresolved', candidateRecords.length === 0 ? 'no_registered_application' : 'no_eligible_application', false)
  })

  return {
    version: 1,
    resolvedAt: input.resolvedAt ?? new Date().toISOString(),
    installedCatalogHash: surfaceApplicationCatalogHash(input.applications),
    preferenceProfileHash: surfacePreferenceProfileHash(input.preferences),
    osDefaultsHash: surfaceDefaultApplicationsHash(input.osDefaults),
    requirements,
  }
}

export function surfaceResolutionExplanation(requirement: WorkSurfaceResolution['requirements'][number]): string {
  const application = requirement.selectedApplication?.application ?? 'No application'
  switch (requirement.reasonCode) {
    case 'explicit_application_required': return `${application} was requested in this task`
    case 'exact_artifact_owner': return `${application} owns the selected artifact`
    case 'explicit_application_preferred': return `${application} was preferred in this task`
    case 'saved_capability_preference': return `${application} is your saved preference`
    case 'same_task_application': return `${application} keeps this task in the same app`
    case 'macos_default_application': return `${application} is your macOS default`
    case 'model_task_fit': return `${application} was selected for this task`
    case 'saved_preference_unavailable_fallback': return `${application} is a compatible fallback because your saved app is unavailable`
    case 'stable_capability_fallback': return `${application} is the available compatible app`
    case 'preference_requires_choice': return 'Your preference asks Carve to let you choose every time'
    case 'explicit_application_unavailable': return `${application} is required but unavailable`
    case 'artifact_owner_unavailable': return 'The application that owns this artifact is unavailable'
    case 'no_registered_application': return 'No registered application can satisfy this work surface'
    case 'no_eligible_application': return 'No installed application supports every required operation'
    default: return 'Carve could not resolve this work surface'
  }
}

export type SurfaceResolutionValidation =
  | { ok: true }
  | { ok: false; requirementIndex: number | null; code: string; explanation: string }

/** A reviewed resolution chooses the default route, but the person may make a
 * one-off same-capability replacement. This validator protects capability and
 * operation constraints without turning a saved preference into authority. */
export function validateRouteAgainstResolution(
  intent: WorkSurfaceIntent,
  resolution: WorkSurfaceResolution,
  route: LiveComputerRouteStartEntry[],
  applications: LiveComputerApplicationIdentity[],
): SurfaceResolutionValidation {
  if (resolution.requirements.length !== intent.requirements.length) return { ok: false, requirementIndex: null, code: 'resolution_shape_changed', explanation: 'Application selection no longer matches this plan. Review the route again.' }
  const catalog = surfaceRecordsForApplications(applications)
  for (const resolved of resolution.requirements) {
    const requirement = intent.requirements[resolved.requirementIndex]
    if (!requirement) return { ok: false, requirementIndex: resolved.requirementIndex, code: 'resolution_requirement_missing', explanation: 'Application selection no longer matches this plan. Review the route again.' }
    if (!resolved.selectedApplication && !resolved.needsChoice) return {
      ok: false,
      requirementIndex: resolved.requirementIndex,
      code: 'application_unresolved',
      explanation: surfaceResolutionExplanation(resolved),
    }
    const matches = route.filter((entry) => {
      const identity = entryIdentity(entry)
      const record = catalog.find((candidate) => candidate.bundleIdentifier === identity.bundleIdentifier)
      const requirementIds = liveComputerRouteRequirementIds(entry)
      return record?.capability === resolved.capability && (intent.version === 3 ? !requirementIds.length || Boolean(requirement.id && requirementIds.includes(requirement.id)) : identity.role === requirement.role)
    })
    if (matches.length === 0 || (intent.version !== 3 && matches.length !== 1)) return { ok: false, requirementIndex: resolved.requirementIndex, code: matches.length ? 'resolved_application_duplicated' : 'resolved_application_missing', explanation: `Use exactly one ${capabilityLabel(resolved.capability)} as the ${requirement.role} surface.` }
    const identity = entryIdentity(matches[0]!)
    const record = catalog.find((candidate) => candidate.bundleIdentifier === identity.bundleIdentifier)
    if (!record || neverOfferedSurface(record.bundleIdentifier)) return { ok: false, requirementIndex: resolved.requirementIndex, code: 'resolved_application_unavailable', explanation: `${identity.application} is no longer available for this route.` }
    const unavailable = (requirement.operationConstraints ?? []).filter((constraint) => constraint.required && !record.operations.includes(constraint.operation))
    if (unavailable.length) return { ok: false, requirementIndex: resolved.requirementIndex, code: 'resolved_operation_unavailable', explanation: `${identity.application} cannot perform the required ${unavailable[0]!.operation.replaceAll('_', ' ')} operation.` }
  }
  return { ok: true }
}

export function surfaceRouteOverrides(intent: WorkSurfaceIntent, resolution: WorkSurfaceResolution, route: LiveComputerRouteStartEntry[], applications: LiveComputerApplicationIdentity[]): Array<{ capability: WorkSurfaceCapability; fromBundleIdentifier: string; toBundleIdentifier: string }> {
  const catalog = surfaceRecordsForApplications(applications)
  return resolution.requirements.flatMap((resolved) => {
    if (!resolved.selectedApplication) return []
    const requirement = intent.requirements[resolved.requirementIndex]
    const match = route.find((entry) => {
      const identity = entryIdentity(entry)
      const requirementIds = liveComputerRouteRequirementIds(entry)
      return catalog.find((record) => record.bundleIdentifier === identity.bundleIdentifier)?.capability === resolved.capability
        && (!requirementIds.length || Boolean(requirement?.id && requirementIds.includes(requirement.id)))
    })
    if (!match) return []
    const bundleIdentifier = entryIdentity(match).bundleIdentifier
    return bundleIdentifier === resolved.selectedApplication.bundleIdentifier ? [] : [{
      capability: resolved.capability,
      fromBundleIdentifier: resolved.selectedApplication.bundleIdentifier,
      toBundleIdentifier: bundleIdentifier,
    }]
  })
}

function decision(
  requirementIndex: number,
  capability: WorkSurfaceCapability,
  records: SurfaceCapabilityRecord[],
  eligibility: Map<string, string[]>,
  selected: SurfaceCapabilityRecord | null,
  signal: SurfaceResolutionSignal,
  reasonCode: string,
  needsChoice: boolean,
  selectedSignals: SurfaceResolutionSignal[] = [],
): WorkSurfaceResolution['requirements'][number] {
  const eligible = records.filter((record) => eligibility.get(record.bundleIdentifier)?.length === 0)
  return {
    requirementIndex,
    capability,
    selectedApplication: selected ? { application: selected.application, bundleIdentifier: selected.bundleIdentifier } : null,
    signal,
    reasonCode,
    needsChoice,
    alternatives: eligible.filter((record) => record.bundleIdentifier !== selected?.bundleIdentifier).map((record) => ({ application: record.application, bundleIdentifier: record.bundleIdentifier })),
    candidates: records.map((record) => ({
      application: record.application,
      bundleIdentifier: record.bundleIdentifier,
      eligible: eligibility.get(record.bundleIdentifier)?.length === 0,
      rejectionCodes: eligibility.get(record.bundleIdentifier) ?? [],
      signals: record.bundleIdentifier === selected?.bundleIdentifier ? [...new Set([signal, ...selectedSignals])] : [],
    })),
  }
}

function signalCandidates(
  selected: SurfaceCapabilityRecord,
  input: {
    requirement: WorkSurfaceRequirement
    preference: SurfaceApplicationPreference | undefined
    defaultApplication: SurfaceDefaultApplication | undefined
    hardContinuity: SurfaceContinuityEvidence | undefined
    softContinuity: SurfaceContinuityEvidence | undefined
  },
): SurfaceResolutionSignal[] {
  const signals: SurfaceResolutionSignal[] = []
  if (input.requirement.application.bundleIdentifier === selected.bundleIdentifier) {
    if (input.requirement.applicationBinding === 'required') signals.push('explicit_required')
    if (input.requirement.applicationBinding === 'preferred') signals.push('explicit_preferred')
    if (input.requirement.applicationBinding === 'recommended') signals.push('model_recommendation')
  }
  if (input.preference?.bundleIdentifier === selected.bundleIdentifier) signals.push('saved_preference')
  if (input.defaultApplication?.bundleIdentifier === selected.bundleIdentifier) signals.push('os_default')
  if (input.hardContinuity?.bundleIdentifier === selected.bundleIdentifier || input.softContinuity?.bundleIdentifier === selected.bundleIdentifier) signals.push('task_continuity')
  return signals
}

function capabilityForRequirement(requirement: WorkSurfaceRequirement, applications: LiveComputerApplicationIdentity[]): WorkSurfaceCapability | null {
  if (requirement.capability) return requirement.capability
  if (requirement.application.requestedName === 'Web browser') return 'web_browser'
  return resolveSurfaceApplication(requirement.application.requestedName, applications)?.capability ?? null
}

function entryIdentity(entry: LiveComputerRouteStartEntry): { application: string; bundleIdentifier: string; role: LiveComputerRouteStartEntry['role'] } {
  return entry.source === 'fresh'
    ? { application: entry.application, bundleIdentifier: entry.bundleIdentifier, role: entry.role }
    : { application: entry.target.application, bundleIdentifier: entry.target.bundleIdentifier, role: entry.role }
}

function capabilityLabel(capability: WorkSurfaceCapability): string {
  return ({
    web_browser: 'web browser', text_document: 'document application', spreadsheet: 'spreadsheet application', presentation: 'presentation application', file_manager: 'file manager', calculator: 'calculator', document_viewer: 'document viewer', general_application: 'application',
  } satisfies Record<WorkSurfaceCapability, string>)[capability]
}

function boundedBundleIdentifier(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= 240 && /^[A-Za-z0-9][A-Za-z0-9.-]+$/u.test(trimmed) ? trimmed : null
}

function boundedApplication(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= 160 ? trimmed : null
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value))
}
