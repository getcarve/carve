import { liveComputerRouteRequirementIds, type LiveComputerRouteStartEntry } from './desktop-contract.js'
import { liveComputerGoalClauses } from './live-computer-planning.js'
import { requestedBrowserDestinations } from './browser-destinations.js'
import type { LiveComputerApplicationIdentity, WorkSurfaceCapability, WorkSurfaceIntent, WorkSurfaceOperation, WorkSurfaceOperationConstraint, WorkSurfaceRequirement, WorkSurfaceResolution } from './types.js'
import { sha256, stableJson } from './util.js'

/**
 * Reads a goal for the window it implies, so the picker can propose a fresh
 * window at the right starting point instead of a list of everything open.
 * Deterministic and local: the goal's own words name a site or an app, or
 * they do not. Nothing here creates authority; the person still starts.
 */

export interface FreshSurfaceSuggestion {
  requirementId?: string
  role?: WorkSurfaceRequirement['role']
  purpose?: string

  /** Application to open the fresh window in. */
  bundleIdentifier: string
  application: string
  /** For browsers, the https address the window opens at. */
  url: string | null
  /** Person-facing reason, for the picker row. */
  reason: string
}

export type SurfaceOpeningCapability = 'new_window' | 'new_document' | 'https_window' | 'none'
export type SurfaceControllerCapability = 'pointer' | 'element_action' | 'set_text' | 'safe_command' | 'save_document'

/** One controller-owned source of truth for surface identity and executable
 * capability. Routing, runtime window requests, and prompts all consume it. */
export interface SurfaceCapabilityRecord {
  application: string
  aliases: string[]
  bundleIdentifier: string
  kind: 'browser' | 'document' | 'utility'
  /** The user-level job this app can satisfy. This is deliberately narrower
   * than `kind`, which describes controller mechanics rather than semantics. */
  capability: WorkSurfaceCapability
  opening: SurfaceOpeningCapability
  observation: ReadonlyArray<'selected_window_pixels' | 'window_accessibility'>
  control: ReadonlyArray<SurfaceControllerCapability>
  lifecycle: 'fresh_window_provable' | 'existing_only'
  /** Operations proven by Carve's current controller for this application. */
  operations: ReadonlyArray<WorkSurfaceOperation>
  /** Stable tie-break used only after every personal and system signal. */
  productFallbackRank: number
}

const knownSites: Array<{ pattern: RegExp; url: string; label: string }> = [
  { pattern: /\bwikipedia\b/iu, url: 'https://www.wikipedia.org', label: 'wikipedia.org' },
  { pattern: /\bgoogle docs?\b/iu, url: 'https://docs.google.com', label: 'docs.google.com' },
  { pattern: /\bgoogle sheets?\b/iu, url: 'https://sheets.google.com', label: 'sheets.google.com' },
  { pattern: /\bgoogle\b/iu, url: 'https://www.google.com', label: 'google.com' },
  { pattern: /\bgithub\b/iu, url: 'https://github.com', label: 'github.com' },
  { pattern: /\byoutube\b/iu, url: 'https://www.youtube.com', label: 'youtube.com' },
  { pattern: /\bamazon\b/iu, url: 'https://www.amazon.com', label: 'amazon.com' },
  { pattern: /\breddit\b/iu, url: 'https://www.reddit.com', label: 'reddit.com' },
  { pattern: /\blinkedin\b/iu, url: 'https://www.linkedin.com', label: 'linkedin.com' },
  { pattern: /\bhacker news\b/iu, url: 'https://news.ycombinator.com', label: 'news.ycombinator.com' },
  { pattern: /\bstack ?overflow\b/iu, url: 'https://stackoverflow.com', label: 'stackoverflow.com' },
  { pattern: /\bnotion\b/iu, url: 'https://www.notion.so', label: 'notion.so' },
]

/** Known browsers, preferred in this order when the goal names a site. */
export const browserBundles: Array<{ bundleIdentifier: string; application: string }> = [
  { bundleIdentifier: 'com.google.Chrome', application: 'Google Chrome' },
  { bundleIdentifier: 'company.thebrowser.Browser', application: 'Arc' },
  { bundleIdentifier: 'com.brave.Browser', application: 'Brave' },
  { bundleIdentifier: 'com.microsoft.edgemac', application: 'Microsoft Edge' },
  { bundleIdentifier: 'org.mozilla.firefox', application: 'Firefox' },
  { bundleIdentifier: 'com.apple.Safari', application: 'Safari' },
]

const browserRecords: SurfaceCapabilityRecord[] = browserBundles.map((entry) => ({
  ...entry,
  aliases: entry.bundleIdentifier === 'com.google.Chrome' ? ['Chrome', 'Google Chrome']
    : entry.bundleIdentifier === 'com.microsoft.edgemac' ? ['Edge', 'Microsoft Edge']
      : [entry.application],
  kind: 'browser',
  capability: 'web_browser',
  opening: 'https_window',
  observation: ['selected_window_pixels', 'window_accessibility'],
  control: ['pointer', 'element_action', 'set_text'],
  lifecycle: 'fresh_window_provable',
  operations: ['open_https'],
  productFallbackRank: browserBundles.findIndex((candidate) => candidate.bundleIdentifier === entry.bundleIdentifier),
}))

const applicationRecords: SurfaceCapabilityRecord[] = [
  { application: 'TextEdit', aliases: ['TextEdit', 'TextEdit.app'], bundleIdentifier: 'com.apple.TextEdit', kind: 'document', capability: 'text_document', opening: 'new_document', observation: ['selected_window_pixels', 'window_accessibility'], control: ['pointer', 'element_action', 'set_text', 'safe_command', 'save_document'], lifecycle: 'fresh_window_provable', operations: ['create_text_document', 'edit_plain_text'], productFallbackRank: 0 },
  { application: 'Notes', aliases: ['Notes', 'Notes.app', 'Apple Notes'], bundleIdentifier: 'com.apple.Notes', kind: 'document', capability: 'text_document', opening: 'new_document', observation: ['selected_window_pixels', 'window_accessibility'], control: ['pointer', 'element_action', 'set_text'], lifecycle: 'fresh_window_provable', operations: ['create_text_document'], productFallbackRank: 3 },
  { application: 'Pages', aliases: ['Pages', 'Pages.app'], bundleIdentifier: 'com.apple.iWork.Pages', kind: 'document', capability: 'text_document', opening: 'new_document', observation: ['selected_window_pixels', 'window_accessibility'], control: ['pointer', 'element_action', 'set_text'], lifecycle: 'fresh_window_provable', operations: ['create_text_document'], productFallbackRank: 1 },
  { application: 'Microsoft Word', aliases: ['Microsoft Word', 'Word', 'Word.app'], bundleIdentifier: 'com.microsoft.Word', kind: 'document', capability: 'text_document', opening: 'new_document', observation: ['selected_window_pixels', 'window_accessibility'], control: ['pointer', 'element_action', 'set_text'], lifecycle: 'fresh_window_provable', operations: ['create_text_document', 'create_docx', 'edit_docx'], productFallbackRank: 2 },
  { application: 'Numbers', aliases: ['Numbers', 'Numbers.app'], bundleIdentifier: 'com.apple.iWork.Numbers', kind: 'document', capability: 'spreadsheet', opening: 'new_document', observation: ['selected_window_pixels', 'window_accessibility'], control: ['pointer', 'element_action', 'set_text'], lifecycle: 'fresh_window_provable', operations: ['create_spreadsheet'], productFallbackRank: 0 },
  { application: 'Microsoft Excel', aliases: ['Microsoft Excel', 'Excel', 'Excel.app'], bundleIdentifier: 'com.microsoft.Excel', kind: 'document', capability: 'spreadsheet', opening: 'new_document', observation: ['selected_window_pixels', 'window_accessibility'], control: ['pointer', 'element_action', 'set_text'], lifecycle: 'fresh_window_provable', operations: ['create_spreadsheet', 'create_xlsx', 'edit_xlsx'], productFallbackRank: 1 },
  { application: 'Keynote', aliases: ['Keynote', 'Keynote.app'], bundleIdentifier: 'com.apple.iWork.Keynote', kind: 'document', capability: 'presentation', opening: 'new_document', observation: ['selected_window_pixels', 'window_accessibility'], control: ['pointer', 'element_action', 'set_text'], lifecycle: 'fresh_window_provable', operations: ['create_presentation'], productFallbackRank: 0 },
  { application: 'Microsoft PowerPoint', aliases: ['Microsoft PowerPoint', 'PowerPoint', 'PowerPoint.app'], bundleIdentifier: 'com.microsoft.Powerpoint', kind: 'document', capability: 'presentation', opening: 'new_document', observation: ['selected_window_pixels', 'window_accessibility'], control: ['pointer', 'element_action', 'set_text'], lifecycle: 'fresh_window_provable', operations: ['create_presentation', 'create_pptx', 'edit_pptx'], productFallbackRank: 1 },
  { application: 'Finder', aliases: ['Finder'], bundleIdentifier: 'com.apple.finder', kind: 'utility', capability: 'file_manager', opening: 'new_window', observation: ['selected_window_pixels', 'window_accessibility'], control: ['pointer', 'element_action'], lifecycle: 'fresh_window_provable', operations: ['manage_files'], productFallbackRank: 0 },
  { application: 'Calculator', aliases: ['Calculator', 'Calculator.app'], bundleIdentifier: 'com.apple.calculator', kind: 'utility', capability: 'calculator', opening: 'new_window', observation: ['selected_window_pixels', 'window_accessibility'], control: ['pointer', 'element_action'], lifecycle: 'fresh_window_provable', operations: ['calculate'], productFallbackRank: 0 },
  { application: 'Preview', aliases: ['Preview', 'Preview.app'], bundleIdentifier: 'com.apple.Preview', kind: 'document', capability: 'document_viewer', opening: 'new_window', observation: ['selected_window_pixels', 'window_accessibility'], control: ['pointer', 'element_action'], lifecycle: 'fresh_window_provable', operations: ['view_pdf'], productFallbackRank: 0 },
]

export const surfaceCapabilityRegistry: readonly SurfaceCapabilityRecord[] = [...browserRecords, ...applicationRecords]

function discoveredSurfaceRecords(applications: LiveComputerApplicationIdentity[]): SurfaceCapabilityRecord[] {
  return applications.flatMap((entry) => {
    if (neverOfferedSurface(entry.bundleIdentifier) || surfaceCapabilityRegistry.some((record) => record.bundleIdentifier === entry.bundleIdentifier)) return []
    return [{
      application: entry.application,
      aliases: [entry.application, `${entry.application}.app`],
      bundleIdentifier: entry.bundleIdentifier,
      kind: 'document' as const,
      capability: 'general_application' as const,
      opening: 'new_document' as const,
      observation: ['selected_window_pixels', 'window_accessibility'] as const,
      control: ['pointer', 'element_action', 'set_text'] as const,
      lifecycle: 'fresh_window_provable' as const,
      operations: [] as WorkSurfaceOperation[],
      productFallbackRank: 100,
    }]
  })
}

/** Safe metadata-only catalog for semantic routing. It contains no window
 * titles, paths, documents, or screen content. */
export function surfaceRecordsForApplications(applications: LiveComputerApplicationIdentity[]): SurfaceCapabilityRecord[] {
  const installed = new Set(applications.map((entry) => entry.bundleIdentifier))
  return [...surfaceCapabilityRegistry, ...discoveredSurfaceRecords(applications)]
    .filter((record, index, records) => installed.has(record.bundleIdentifier)
      && records.findIndex((candidate) => candidate.bundleIdentifier === record.bundleIdentifier) === index
      && !neverOfferedSurface(record.bundleIdentifier))
}

const aliasPattern = (record: SurfaceCapabilityRecord): RegExp => new RegExp(
  record.aliases
    .map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/\\\.app$/iu, '(?:\\.app)?').replace(/\s+/gu, '\\s+'))
    .sort((left, right) => right.length - left.length)
    .map((alias) => `(?:${alias})`)
    .join('|'),
  'iu',
)

const boundedAliasPattern = (record: SurfaceCapabilityRecord): RegExp => new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${aliasPattern(record).source})(?![\\p{L}\\p{N}])`,
  'iu',
)

const knownApps = applicationRecords.map((record) => ({ ...record, pattern: new RegExp(`\\b(?:${aliasPattern(record).source})\\b`, 'iu') }))

/** Applications Carve never works in, fresh or existing: the person's mail,
 * messages, credentials, money, and system settings. */
/** Carve's own app and its helpers. Carve never chooses itself as the application for a step of a task. */
export function isCarveOwnBundle(bundleIdentifier: string): boolean {
  return /^app\.carve\.desktop(?:$|\.)/iu.test(bundleIdentifier)
}

export function neverOfferedSurface(bundleIdentifier: string): boolean {
  if (isCarveOwnBundle(bundleIdentifier)) return true
  return /^(com\.apple\.mail|com\.apple\.MobileSMS|com\.apple\.systempreferences|com\.apple\.Passwords|com\.1password\.|com\.agilebits\.|com\.bitwarden\.|com\.lastpass\.|com\.apple\.keychainaccess)/iu.test(bundleIdentifier)
}

/** The bundle Carve would open for an application named in prose, when the
 * name is one Carve knows how to open fresh. Browsers and document apps only. */
export function bundleForApplicationName(application: string, discoveredApplications: LiveComputerApplicationIdentity[] = []): { bundleIdentifier: string; application: string } | null {
  const record = resolveSurfaceApplication(application, discoveredApplications)
  return record ? { bundleIdentifier: record.bundleIdentifier, application: record.application } : null
}

export function resolveSurfaceApplication(application: string, discoveredApplications: LiveComputerApplicationIdentity[] = []): SurfaceCapabilityRecord | null {
  const wanted = application.trim().toLocaleLowerCase('en-US').replace(/\.app$/u, '')
  if (!wanted) return null
  return [...surfaceCapabilityRegistry, ...discoveredSurfaceRecords(discoveredApplications)]
    .find((record) => record.aliases.some((alias) => alias.toLocaleLowerCase('en-US').replace(/\.app$/u, '') === wanted)) ?? null
}

export function namedSurfaceApplications(goal: string, discoveredApplications: LiveComputerApplicationIdentity[] = []): SurfaceCapabilityRecord[] {
  return [...surfaceCapabilityRegistry, ...discoveredSurfaceRecords(discoveredApplications)].filter((record) => boundedAliasPattern(record).test(goal))
}

export type SurfaceApplicationReferenceRole = 'required' | 'preferred' | 'subject'

/** An application catalog hit is only a lexical candidate. This classifier
 * establishes whether the person actually asked Carve to work in that app.
 * Keeping it generic over the registry avoids per-application prompt rules:
 * "What is Arc?", "edge computing", and "Brave New World" are subjects,
 * while "open Arc", "write it in Pages", and "use the current Numbers
 * window" are executable surface constraints. */
export function surfaceApplicationReferenceRole(goal: string, record: SurfaceCapabilityRecord): SurfaceApplicationReferenceRole | null {
  const name = boundedAliasPattern(record).source
  if (!new RegExp(`(?:${name})`, 'iu').test(goal)) return null
  // "The calculator on this page" names something inside the selected window, not the app
  // (in testing, a health-calculator page was routed to macOS Calculator).
  if (onSelectedSurface(name).test(goal) && !new RegExp(`(?:${name})\\s+(?:app|application)\\b`, 'iu').test(goal)) return 'subject'

  const preferencePatterns = [
    new RegExp(`\\bprefer(?:\\s+to)?(?:\\s+use|\\s+open|\\s+work\\s+in)?\\s+(?:the\\s+)?(?:${name})`, 'iu'),
    new RegExp(`\\b(?:ideally|preferably|if\\s+(?:possible|available))[,;:]?\\s*(?:use|open|work\\s+in|with|in)?\\s*(?:the\\s+)?(?:${name})`, 'iu'),
    new RegExp(`\\b(?:use|open|work\\s+in)\\s+(?:the\\s+)?(?:${name}).{0,30}\\bif\\s+(?:possible|available|installed)\\b`, 'iu'),
  ]
  if (preferencePatterns.some((pattern) => pattern.test(goal))) return 'preferred'

  // Instructional and definitional questions frequently contain verbs like
  // "use" or "open" as their subject. They do not request desktop control.
  const informationalFraming = /^\s*(?:(?:what|who|when|where|why)\b|how\s+(?:do|does|did|can|could|should|would)\b|(?:tell\s+me\s+about|explain|describe|define|compare)\b)/iu.test(goal)
  const explicitlyCurrentSurface = new RegExp(`\\b(?:current|existing|this|selected|open)\\s+(?:${name})(?:\\s+(?:app|application|browser|window|document|tab))?\\b|\\b(?:current|existing|this|selected|open)\\s+(?:app|application|browser|window|document|tab)\\s+(?:in|of)\\s+(?:${name})\\b`, 'iu').test(goal)
  if (informationalFraming && !explicitlyCurrentSurface) return 'subject'

  const directControl = new RegExp(`\\b(?:open|launch|start|run|use)\\s+(?:(?:a|an|the)\\s+)?(?:(?:new|fresh|blank|empty|current|existing)\\s+)?(?:${name})(?:\\s+(?:app|application|browser|window|document|tab))?\\b|\\bswitch\\s+to\\s+(?:the\\s+)?(?:${name})\\b`, 'iu')
  const locatedWork = new RegExp(`\\b(?:research|look\\s+up|find|browse|search|navigate|visit|write|draft|type|enter|paste|save|edit|create|make|add|take|read|review|inspect|check|copy|move|calculate|compute|summarize|work|continue|return)\\b.{0,100}?\\b(?:in|inside|within|using|through|via|from|into|to)\\s+(?:(?:a|an|the|this|that|current|existing|selected)\\s+)?(?:${name})(?:\\s+(?:app|application|browser|window|document|tab))?\\b`, 'iu')
  const leadingSurface = new RegExp(`(?:^|[.!?]\\s+)\\s*(?:in|inside|within|using|through|via)\\s+(?:the\\s+)?(?:${name})(?:\\s+(?:app|application|browser|window|document|tab))?\\s*[,;:]`, 'iu')
  const qualifiedSurface = new RegExp(`\\b(?:new|fresh|blank|empty|current|existing|selected|this|that)\\s+(?:${name})(?:\\s+(?:app|application|browser|window|document|tab))\\b|\\b(?:${name})\\s+(?:app|application|browser|window|document|tab)\\s+(?:only|for\\s+this\\s+task)\\b`, 'iu')
  // Imperative artifact phrases often use an application name attributively:
  // “create a TextEdit file”, “make a Numbers spreadsheet”, or “review the
  // Pages document”. They identify the execution surface just as strongly as
  // “create the file in TextEdit”. Informational framing returned above keeps
  // “How do I create a TextEdit file?” and similar questions non-authorizing.
  const namedApplicationArtifact = new RegExp(`\\b(?:write|draft|type|enter|paste|save|edit|create|make|add|read|review|inspect|open|prepare|produce)\\b.{0,120}?\\b(?:${name})(?:\\s+(?:app|application))?\\s+(?:file|document|note|report|memo|spreadsheet|workbook|worksheet|presentation|slides?|deck)\\b`, 'iu')
  if ([directControl, locatedWork, leadingSurface, qualifiedSurface, namedApplicationArtifact].some((pattern) => pattern.test(goal))) return 'required'
  return 'subject'
}

const onSelectedSurface = (name: string) => new RegExp(`(?:${name})\\s+(?:on|in|from)\\s+(?:this|the\\s+(?:current|open|selected))\\s+(?:web\\s*)?(?:page|site|website|tab|window)\\b`, 'iu')

/**
 * True when the request points at `bundleIdentifier`'s kind of thing as
 * something already in front of the person: a determiner qualifies the app's
 * own name ("this calculator", "the current BMI calculator") or places it on the
 * selected surface ("the calculator on this page"), and the person did not ask
 * for the app itself ("open Calculator", "use the Calculator app" stay the app).
 * A route to that app is then a lexical accident, and the work belongs in the
 * selected window. Only the named app is affected: in "add this event to my
 * calendar" the determiner qualifies "event", so Calendar is untouched.
 */
export function deicticallySelectedInstead(goal: string, bundleIdentifier: string, discoveredApplications: LiveComputerApplicationIdentity[] = []): boolean {
  const record = [...surfaceCapabilityRegistry, ...discoveredSurfaceRecords(discoveredApplications)].find(candidate => candidate.bundleIdentifier === bundleIdentifier)
  if (!record) return false
  const role = surfaceApplicationReferenceRole(goal, record)
  if (role === 'required' || role === 'preferred') return false
  const name = boundedAliasPattern(record).source
  const qualified = new RegExp(`\\b(?:this|current|the\\s+current|the\\s+selected|selected)\\s+(?:[\\p{L}\\p{N}-]+\\s+){0,2}?(?:${name})(?!\\s+(?:app|application)\\b)`, 'iu')
  return qualified.test(goal) || onSelectedSurface(name).test(goal)
}

export function requiredSurfaceApplications(goal: string, discoveredApplications: LiveComputerApplicationIdentity[] = []): SurfaceCapabilityRecord[] {
  return [...surfaceCapabilityRegistry, ...discoveredSurfaceRecords(discoveredApplications)]
    .filter((record) => surfaceApplicationReferenceRole(goal, record) === 'required')
}

function informationSeekingGoal(goal: string): boolean {
  return /^\s*(?:(?:what|who|when|where|why|which)\b|how\s+(?:do|does|did|is|are|was|were|can|could|should|would)\b|(?:tell\s+me\s+about|explain|describe|define|compare|summarize|research|look\s+up|find\s+out)\b)/iu.test(goal)
}

function genericBrowserFreshness(goal: string): WorkSurfaceRequirement['freshness'] {
  return /\b(?:new|fresh|blank|empty)\s+(?:(?:web\s+)?browser\s+)?window\b|\b(?:new|fresh|blank|empty)\s+(?:web\s+)?browser\b/iu.test(goal)
    ? 'required'
    : 'preferred'
}

function genericSurfaceFreshness(goal: string, noun: RegExp): WorkSurfaceRequirement['freshness'] {
  if (new RegExp(`\\b(?:current|existing|this|selected)\\s+(?:${noun.source})\\b`, 'iu').test(goal)) return 'existing'
  if (new RegExp(`\\b(?:new|fresh|blank|empty)\\s+(?:${noun.source})\\b`, 'iu').test(goal)) return 'required'
  return 'preferred'
}

/** Local artifact/operation constraints are authority. A model may infer the
 * semantic stage, but it may not make an app eligible for an operation the
 * controller has not declared. */
export function surfaceOperationConstraintsForGoal(goal: string, capability: WorkSurfaceCapability): WorkSurfaceOperationConstraint[] {
  const creating = /\b(?:create|make|draft|write|build|prepare|produce|start)\b/iu.test(goal)
  if (capability === 'web_browser') return [{ operation: 'open_https', required: true, artifactType: null }]
  if (capability === 'spreadsheet') {
    if (/\.xlsx\b|\bXLSX\b/u.test(goal)) return [{ operation: creating ? 'create_xlsx' : 'edit_xlsx', required: true, artifactType: 'org.openxmlformats.spreadsheetml.sheet' }]
    return [{ operation: 'create_spreadsheet', required: true, artifactType: null }]
  }
  if (capability === 'text_document') {
    if (/\.docx\b|\bDOCX\b/u.test(goal)) return [{ operation: creating ? 'create_docx' : 'edit_docx', required: true, artifactType: 'org.openxmlformats.wordprocessingml.document' }]
    if (/\b(?:plain[ -]?text|\.txt)\b/iu.test(goal) && !creating) return [{ operation: 'edit_plain_text', required: true, artifactType: 'public.plain-text' }]
    return [{ operation: 'create_text_document', required: true, artifactType: null }]
  }
  if (capability === 'presentation') {
    if (/\.pptx\b|\bPPTX\b/u.test(goal)) return [{ operation: creating ? 'create_pptx' : 'edit_pptx', required: true, artifactType: 'org.openxmlformats.presentationml.presentation' }]
    return [{ operation: 'create_presentation', required: true, artifactType: null }]
  }
  if (capability === 'document_viewer') return [{ operation: 'view_pdf', required: true, artifactType: 'com.adobe.pdf' }]
  if (capability === 'file_manager') return [{ operation: 'manage_files', required: true, artifactType: null }]
  if (capability === 'calculator') return [{ operation: 'calculate', required: true, artifactType: null }]
  return []
}

/** A bare domain in the goal ("open example.com") becomes its https home. */
const domainPattern = /\b((?:[a-z0-9-]+\.)+(?:com|org|net|io|ai|app|edu|gov|co|dev))(?:\/[^\s]*)?/iu

/** True when the goal asks for a NEW document in this application ("open a
 * new TextEdit document", "a fresh Numbers window", "blank Pages doc") rather
 * than one of the person's existing windows. */
export function goalAsksForFreshDocument(goal: string, application: string): boolean {
  const resolved = resolveSurfaceApplication(application)
  const app = resolved && resolved.kind !== 'browser' ? knownApps.find((entry) => entry.bundleIdentifier === resolved.bundleIdentifier) : null
  if (!app) return false
  const name = app.pattern.source
  return new RegExp(`\\b(?:new|fresh|blank|empty)\\b(?:\\s+\\w+){0,3}?\\s+(?:${name})|(?:${name})(?:\\s+\\w+){0,3}?\\s+\\b(?:new|fresh|blank|empty)\\b`, 'iu').test(goal)
}

function freshnessFor(goal: string, record: SurfaceCapabilityRecord): WorkSurfaceRequirement['freshness'] {
  const name = boundedAliasPattern(record).source
  const surfaceNoun = '(?:app|application|browser|window|document|tab|sheet|spreadsheet|presentation)'
  const existing = new RegExp(`\\b(?:existing|current|this|selected)\\s+(?:open\\s+)?(?:${name})(?:\\s+${surfaceNoun})?\\b|(?:${name})(?:\\s+${surfaceNoun})?\\s+(?:(?:that|which)\\s+is\\s+)?(?:already\\s+)?(?:open|existing|current|selected)\\b`, 'iu')
  if (existing.test(goal)) return 'existing'
  const fresh = new RegExp(`\\b(?:new|fresh|blank|empty)\\s+(?:${name})(?:\\s+${surfaceNoun})?\\b|(?:${name})(?:\\s+${surfaceNoun})?\\s+(?:(?:that|which)\\s+is\\s+)?(?:new|fresh|blank|empty)\\b`, 'iu')
  if (fresh.test(goal)) return 'required'
  return 'either'
}

function resourceForGoal(goal: string): { kind: 'https_url'; value: string } | null {
  for (const site of knownSites) if (site.pattern.test(goal)) return { kind: 'https_url', value: site.url }
  const domain = domainPattern.exec(goal)
  return domain?.[1] && !/\b(?:e\.g|i\.e|etc)\b/iu.test(domain[1])
    ? { kind: 'https_url', value: `https://${domain[1].toLowerCase()}` }
    : null
}

/** Compile literal application/freshness language into frozen controller
 * authority. This never consults a model or the contents of open windows. */
export function compileWorkSurfaceIntent(goal: string, discoveredApplications: LiveComputerApplicationIdentity[] = []): WorkSurfaceIntent {
  const clauses = liveComputerGoalClauses(goal)
  const browserDestinations = requestedBrowserDestinations(goal)
  const references = [...surfaceCapabilityRegistry, ...discoveredSurfaceRecords(discoveredApplications)]
    .map((record) => ({ record, role: surfaceApplicationReferenceRole(goal, record) }))
    .filter((entry): entry is { record: SurfaceCapabilityRecord; role: SurfaceApplicationReferenceRole } => entry.role !== null)
  const resource = resourceForGoal(goal)
  const requiredBrowsers = references.filter((entry) => entry.record.kind === 'browser' && entry.role === 'required')
  const preferredBrowsers = references.filter((entry) => entry.record.kind === 'browser' && entry.role === 'preferred')
  const subjectApplications = references.filter((entry) => entry.role === 'subject')
  const requiredNonBrowsers = references.filter((entry) => entry.record.kind !== 'browser' && entry.role === 'required')
  const preferredNonBrowsers = references.filter((entry) => entry.record.kind !== 'browser' && entry.role === 'preferred')
  const needsBrowser = Boolean(resource)
    || /\b(?:research|look up|browse|website|online|web|internet|url|google)\b/iu.test(goal)
    || (subjectApplications.length > 0 && informationSeekingGoal(goal))
  const requirements: WorkSurfaceRequirement[] = []
  const browserReference = requiredBrowsers[0] ?? preferredBrowsers[0] ?? null
  if (browserReference || needsBrowser) requirements.push({
    application: browserReference
      ? { requestedName: browserReference.record.application, bundleIdentifier: browserReference.record.bundleIdentifier }
      : { requestedName: 'Web browser', bundleIdentifier: null },
    applicationBinding: browserReference ? browserReference.role === 'required' ? 'required' : 'preferred' : 'interchangeable',
    capability: 'web_browser',
    operationConstraints: surfaceOperationConstraintsForGoal(goal, 'web_browser'),
    freshness: browserReference ? freshnessFor(goal, browserReference.record) : genericBrowserFreshness(goal),
    role: 'research',
    initialResource: resource,
  })
  for (const reference of [...requiredNonBrowsers, ...preferredNonBrowsers]) requirements.push({
    application: { requestedName: reference.record.application, bundleIdentifier: reference.record.bundleIdentifier },
    applicationBinding: reference.role === 'required' ? 'required' : 'preferred',
    capability: reference.record.capability,
    operationConstraints: surfaceOperationConstraintsForGoal(goal, reference.record.capability),
    freshness: freshnessFor(goal, reference.record),
    role: requirements.some((requirement) => requirement.role === 'research') ? 'destination' : 'workspace',
    initialResource: null,
  })
  const addGeneric = (capability: WorkSurfaceCapability, requestedName: string, noun: RegExp) => {
    if (requirements.some((requirement) => requirement.capability === capability)) return
    requirements.push({
      application: { requestedName, bundleIdentifier: null },
      applicationBinding: 'interchangeable',
      capability,
      operationConstraints: surfaceOperationConstraintsForGoal(goal, capability),
      freshness: genericSurfaceFreshness(goal, noun),
      role: requirements.some((requirement) => requirement.role === 'research') ? 'destination' : 'workspace',
      initialResource: null,
    })
  }
  if (/\b(?:spreadsheet|workbook|worksheet|xlsx)\b|\.xlsx\b/iu.test(goal)) addGeneric('spreadsheet', 'Spreadsheet application', /(?:spreadsheet|workbook|worksheet|xlsx)/u)
  if (/\b(?:presentation|slide\s+deck|slides|pptx)\b|\.pptx\b/iu.test(goal)) addGeneric('presentation', 'Presentation application', /(?:presentation|slide\s+deck|slides|pptx)/u)
  if (/\b(?:pdf|portable document)\b/iu.test(goal) && /\b(?:open|read|review|inspect|view)\b/iu.test(goal)) addGeneric('document_viewer', 'PDF viewer', /(?:pdf|document)/u)
  if (/\b(?:calculate|compute)\b/iu.test(goal) || /\b\d+(?:\.\d+)?\s*(?:[×÷+−]|\*|\/)\s*\d+(?:\.\d+)?\b/u.test(goal)) addGeneric('calculator', 'Calculator', /(?:calculator|calculation)/u)
  // Artifact routing is checked against imperative clause structure rather
  // than an arbitrary model summary or a word anywhere in the request.
  // Thus “put the findings in a new document” creates a destination, while
  // “explain how to create a document” remains an informational question.
  // The same clause classifier protects the execution ledger, so route and
  // objective coverage cannot silently disagree about whether a write exists.
  const textArtifact = /\b(?:document|report|letter|memo|essay|docx)\b|\b(?:plain[ -]?text|text)\s+file\b|\.(?:docx|txt)\b/iu
  if (clauses.some((clause) => clause.kind === 'commit' && textArtifact.test(clause.text)
    && !requestedBrowserDestinations(clause.text).some((destination) => destination.name === 'Google Docs'))) {
    addGeneric('text_document', 'Document application', /(?:document|report|letter|memo|essay|docx)/u)
  }
  return {
    requirements,
    ...(browserDestinations.length > 0 ? { browserDestinations } : {}),
    existingWindowsProhibited: /\b(?:do not|don't|never)\s+(?:use|touch|open)\s+(?:an?\s+|my\s+|any\s+)?existing\b|\bfresh\s+(?:windows?\s+)?only\b/iu.test(goal),
  }
}

export function workSurfaceIntentHash(intent: WorkSurfaceIntent): string {
  return sha256(stableJson(intent))
}

export type RouteValidation =
  | { ok: true }
  | { ok: false; requirementIndex: number | null; code: string; explanation: string }

export function workSurfaceSharingAllowed(intent: WorkSurfaceIntent): boolean {
  return !/\b(?:separate|distinct|different|another|additional|second|new|two|three|four|\d+)\s+(?:\w+\s+){0,2}windows?\b/iu.test(intent.originalRequest ?? '')
}

const entryIdentity = (entry: LiveComputerRouteStartEntry) => entry.source === 'fresh'
  ? { application: entry.application, bundleIdentifier: entry.bundleIdentifier, role: entry.role }
  : { application: entry.target.application, bundleIdentifier: entry.target.bundleIdentifier, role: entry.role }

/** Main-process-safe semantic validation. The renderer uses the same pure
 * result for feedback, but only this check at Start is authoritative. */
export function validateRouteAgainstIntent(intent: WorkSurfaceIntent, route: LiveComputerRouteStartEntry[]): RouteValidation {
  if (route.length === 0) return { ok: false, requirementIndex: null, code: 'route_empty', explanation: 'Choose at least one work window.' }
  if (intent.existingWindowsProhibited && route.some((entry) => entry.source === 'existing')) {
    return { ok: false, requirementIndex: null, code: 'existing_prohibited', explanation: 'This request allows only fresh windows; remove every existing window from the route.' }
  }
  for (let index = 0; index < route.length; index += 1) {
    const entry = route[index]!
    if (entry.requirementId && entry.requirementIds?.length) return { ok: false, requirementIndex: null, code: 'route_requirement_identity_conflict', explanation: 'A work window has conflicting requirement identities.' }
    if (liveComputerRouteRequirementIds(entry).length > 1 && !workSurfaceSharingAllowed(intent)) return { ok: false, requirementIndex: null, code: 'distinct_windows_required', explanation: 'This request requires separate work windows.' }
    const identity = entryIdentity(entry)
    if (neverOfferedSurface(identity.bundleIdentifier)) return { ok: false, requirementIndex: null, code: 'application_denied', explanation: `Carve does not work in ${identity.application}.` }
    const record = resolveSurfaceApplication(identity.application)
    if (record && record.bundleIdentifier !== identity.bundleIdentifier) {
      return { ok: false, requirementIndex: null, code: 'application_identity_mismatch', explanation: `${identity.application} does not match bundle ${identity.bundleIdentifier}.` }
    }
  }
  if (intent.version === 3) {
    const known = new Set(intent.requirements.flatMap(requirement => requirement.id ? [requirement.id] : []))
    const bound = new Set<string>()
    for (const entry of route) {
      for (const id of liveComputerRouteRequirementIds(entry)) {
        if (!known.has(id)) return { ok: false, requirementIndex: null, code: 'route_requirement_unknown', explanation: 'A work window refers to an unknown task requirement.' }
        if (bound.has(id)) return { ok: false, requirementIndex: null, code: 'route_requirement_duplicated', explanation: 'A task requirement is assigned to more than one work window.' }
        bound.add(id)
      }
    }
  }
  const used = new Set<LiveComputerRouteStartEntry>()
  for (let index = 0; index < intent.requirements.length; index += 1) {
    const requirement = intent.requirements[index]!
    const binding = requirement.applicationBinding ?? (requirement.application.bundleIdentifier ? 'required' : 'interchangeable')
    const requestedRecord = resolveSurfaceApplication(requirement.application.requestedName)
    const matches = route.filter((entry) => {
      const requirementIds = liveComputerRouteRequirementIds(entry)
      if (intent.version === 3 && used.has(entry) && requirementIds.length === 0) return false
      if (intent.version === 3 && requirementIds.length && (!requirement.id || !requirementIds.includes(requirement.id))) return false
      const identity = entryIdentity(entry)
      if (binding === 'required' && requirement.application.bundleIdentifier) return identity.bundleIdentifier === requirement.application.bundleIdentifier
      const identityRecord = resolveSurfaceApplication(identity.application)
      if (requirement.capability) {
        return identity.bundleIdentifier === requirement.application.bundleIdentifier
          || identityRecord?.capability === requirement.capability
      }
      return requirement.application.requestedName === 'Web browser'
        ? surfaceCapabilityRegistry.some((record) => record.kind === 'browser' && record.bundleIdentifier === identity.bundleIdentifier)
        : requestedRecord && binding !== 'required'
          ? surfaceCapabilityRegistry.some((record) => record.kind === requestedRecord.kind && record.bundleIdentifier === identity.bundleIdentifier)
        : identity.application.toLocaleLowerCase('en-US') === requirement.application.requestedName.toLocaleLowerCase('en-US')
    })
    if (matches.length === 0) {
      const label = binding === 'required' ? requirement.application.requestedName : requestedRecord?.kind === 'browser' || requirement.application.requestedName === 'Web browser' ? 'a web browser' : `an application like ${requirement.application.requestedName}`
      return { ok: false, requirementIndex: index, code: 'required_application_missing', explanation: `Add ${label} to this route.` }
    }
    if (intent.version !== 3 && matches.length > 1) return { ok: false, requirementIndex: index, code: 'required_application_duplicated', explanation: `Use exactly one ${requirement.application.requestedName} window for this task.` }
    const match = intent.version === 3 ? matches.find(entry => (requirement.freshness !== 'required' || entry.source === 'fresh') && (requirement.freshness !== 'existing' || entry.source === 'existing')) ?? matches[0]! : matches[0]!
    if (requirement.freshness === 'required' && match.source !== 'fresh') return { ok: false, requirementIndex: index, code: 'fresh_window_required', explanation: `${requirement.application.requestedName} must be a fresh window for this request.` }
    if (requirement.freshness === 'existing' && match.source !== 'existing') return { ok: false, requirementIndex: index, code: 'existing_window_required', explanation: `${requirement.application.requestedName} must use the existing window named in this request.` }
    if (liveComputerRouteRequirementIds(match).length <= 1) used.add(match)
    if (intent.version !== 3 && match.role !== requirement.role) return { ok: false, requirementIndex: index, code: 'surface_role_mismatch', explanation: `${requirement.application.requestedName} must be the ${requirement.role} surface for this request.` }
  }
  return { ok: true }
}

/**
 * Every fresh window a goal implies, in goal order: at most one browser
 * window at the site the goal names, then each document application the
 * goal asks to open new. A two-application request therefore yields two
 * stages; previously only the first suggestion existed, so the second
 * application silently became one of the person's existing windows.
 */
export function freshSurfaceSuggestions(
  goal: string,
  installedBrowsers: string[] = browserBundles.map((entry) => entry.bundleIdentifier),
  installedApplications: LiveComputerApplicationIdentity[] = [],
): FreshSurfaceSuggestion[] {
  return freshSurfaceSuggestionsForIntent(compileWorkSurfaceIntent(goal, installedApplications), installedBrowsers, installedApplications)
}

/** Resolve a normalized local-or-inferred intent against what is actually
 * installed. The intent recommends semantics; this function owns the exact
 * executable application choice. */
export function freshSurfaceSuggestionsForIntent(
  intent: WorkSurfaceIntent,
  installedBrowsers: string[] = browserBundles.map((entry) => entry.bundleIdentifier),
  installedApplications: LiveComputerApplicationIdentity[] = [],
  resolution?: WorkSurfaceResolution,
): FreshSurfaceSuggestion[] {
  const installed = new Set([...installedBrowsers, ...installedApplications.map((entry) => entry.bundleIdentifier)])
  const hasBrowserRequirement = intent.requirements.some((requirement) => {
    const record = resolveSurfaceApplication(requirement.application.requestedName, installedApplications)
    return requirement.capability === 'web_browser' || requirement.application.requestedName === 'Web browser' || record?.kind === 'browser'
  })
  const suggestions: FreshSurfaceSuggestion[] = []
  for (let requirementIndex = 0; requirementIndex < intent.requirements.length; requirementIndex += 1) {
    const requirement = intent.requirements[requirementIndex]!
    if (requirement.freshness === 'existing') continue
    const binding = requirement.applicationBinding ?? (requirement.application.bundleIdentifier ? 'required' : 'interchangeable')
    const requested = resolveSurfaceApplication(requirement.application.requestedName, installedApplications)
    const resolvedApplication = resolution?.requirements.find((candidate) => candidate.requirementIndex === requirementIndex)?.selectedApplication ?? null
    const resolved = resolvedApplication ? resolveSurfaceApplication(resolvedApplication.application, installedApplications) : null
    if (resolution && !resolved) continue
    const wantsBrowser = requirement.capability === 'web_browser' || requirement.application.requestedName === 'Web browser' || requested?.kind === 'browser'
    if (wantsBrowser) {
      const exactRecord = resolved ?? requested
      const exact = exactRecord && exactRecord.kind === 'browser' ? browserBundles.find((entry) => entry.bundleIdentifier === exactRecord.bundleIdentifier) ?? null : null
      const fallback = browserBundles.find((entry) => installed.has(entry.bundleIdentifier)) ?? null
      const browser = resolution
        ? exact && installed.has(exact.bundleIdentifier) ? exact : null
        : binding === 'required'
        ? exact && installed.has(exact.bundleIdentifier) ? exact : null
        : exact && installed.has(exact.bundleIdentifier) ? exact : fallback
      if (!browser) continue
      const url = requirement.initialResource?.value ?? 'https://www.google.com'
      suggestions.push({
        ...(intent.version === 3 ? { requirementId: requirement.id!, role: requirement.role, purpose: (intent.resources ?? []).filter(resource => requirement.resourceIds?.includes(resource.id)).map(resource => `${resource.destination}: ${resource.outcome}`).join('; ') } : {}),
        bundleIdentifier: browser.bundleIdentifier,
        application: browser.application,
        url,
        reason: requirement.initialResource
          ? `Opens at ${new URL(url).hostname.replace(/^www\./u, '')} · your open tabs are not touched`
          : `A clean browser window for this task · your open tabs are not touched`,
      })
      continue
    }
    // In a browser → destination route, an unqualified destination name means
    // the person's matching existing document is acceptable. Only explicit
    // new/fresh language may silently create another document. For a lone
    // application workspace, a fresh surface remains the privacy-safe default.
    if (intent.version !== 3 && hasBrowserRequirement && requirement.freshness === 'either') continue
    const candidates = [...surfaceCapabilityRegistry, ...discoveredSurfaceRecords(installedApplications)]
      .filter((record) => record.kind !== 'browser'
        && record.opening !== 'none'
        && (!requirement.capability || record.capability === requirement.capability))
    const selected = resolution
      ? resolved
      : binding === 'required'
      ? requested
      : requested && installed.has(requested.bundleIdentifier)
        ? requested
        : candidates.find((record) => installedApplications.length === 0 || installed.has(record.bundleIdentifier)) ?? null
    if (!selected || (installedApplications.length > 0 && !installed.has(selected.bundleIdentifier))) continue
    if (intent.version !== 3 && suggestions.some((entry) => entry.bundleIdentifier === selected.bundleIdentifier)) continue
    suggestions.push({
      ...(intent.version === 3 ? { requirementId: requirement.id!, role: requirement.role, purpose: (intent.resources ?? []).filter(resource => requirement.resourceIds?.includes(resource.id)).map(resource => `${resource.destination}: ${resource.outcome}`).join('; ') } : {}),
      bundleIdentifier: selected.bundleIdentifier,
      application: selected.application,
      url: null,
      reason: selected.kind === 'document' ? `A new ${selected.application} document for this task` : `A new ${selected.application} window for this task`,
    })
  }
  return suggestions
}

/**
 * The fresh window a goal implies, if any. `installedBrowsers` narrows the
 * browser choice to what the Mac has; the first preferred one wins.
 */
export function freshSurfaceSuggestion(
  goal: string,
  installedBrowsers: string[] = browserBundles.map((entry) => entry.bundleIdentifier),
  installedApplications: LiveComputerApplicationIdentity[] = [],
): FreshSurfaceSuggestion | null {
  return freshSurfaceSuggestions(goal, installedBrowsers, installedApplications)[0] ?? null
}
