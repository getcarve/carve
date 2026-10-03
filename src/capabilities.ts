import type { PlannedAction, WorkContextSummary } from './types.js'
import { id, tokenize } from './util.js'

export interface CapabilityRuntimeState {
  [key: string]: string | number | boolean | undefined
}

export interface CapabilityPlanDraft {
  id: string
  rationale: string
  expectedOutputs: string[]
  actions: PlannedAction[]
}

interface CapabilityMatch {
  score: number
  values: Record<string, string | boolean>
}

export interface CapabilityDescriptor {
  id: string
  name: string
  tools: string[]
  match(goal: string, context: WorkContextSummary, runtimeState: CapabilityRuntimeState): CapabilityMatch | null
  plan(goal: string, context: WorkContextSummary, runtimeState: CapabilityRuntimeState, match: CapabilityMatch): CapabilityPlanDraft
}

export interface CapabilityResolution {
  plan: CapabilityPlanDraft | null
  matchedCapabilityIds: string[]
  missingTools: string[]
}

/**
 * Capabilities extend the planner by registration. The planner never learns a
 * domain verb, selector, URL shape, or action template when a workflow is added.
 */
export class CapabilityCatalog {
  private readonly descriptors: CapabilityDescriptor[]

  constructor(private readonly available: (tool: string) => boolean, descriptors: CapabilityDescriptor[] = defaultCapabilityDescriptors()) {
    this.descriptors = descriptors
  }

  list(): Array<{ id: string; name: string; tools: string[]; available: boolean }> {
    return this.descriptors.map((descriptor) => ({
      id: descriptor.id,
      name: descriptor.name,
      tools: descriptor.tools,
      available: descriptor.tools.every((tool) => this.available(tool)),
    }))
  }

  resolve(goal: string, context: WorkContextSummary, runtimeState: CapabilityRuntimeState): CapabilityResolution {
    const matches = this.descriptors
      .map((descriptor) => ({ descriptor, match: descriptor.match(goal, context, runtimeState) }))
      .filter((entry): entry is { descriptor: CapabilityDescriptor; match: CapabilityMatch } => entry.match !== null && entry.match.score >= 0.55)
      .sort((left, right) => right.match.score - left.match.score)
    const ready = matches.find(({ descriptor }) => descriptor.tools.every((tool) => this.available(tool)))
    if (ready) return {
      plan: ready.descriptor.plan(goal, context, runtimeState, ready.match),
      matchedCapabilityIds: matches.map(({ descriptor }) => descriptor.id),
      missingTools: [],
    }
    return {
      plan: null,
      matchedCapabilityIds: matches.map(({ descriptor }) => descriptor.id),
      missingTools: [...new Set(matches.flatMap(({ descriptor }) => descriptor.tools.filter((tool) => !this.available(tool))))],
    }
  }
}

export function defaultCapabilityDescriptors(): CapabilityDescriptor[] {
  return [requestTriageCapability(), reopenWebResourcesCapability(), reopenWithDesktopComputerCapability()]
}

function requestTriageCapability(): CapabilityDescriptor {
  return {
    id: 'capability.browser_request_triage',
    name: 'Triage a request in the supervised browser',
    tools: ['browser.click', 'artifact.write'],
    match(goal, _context, runtimeState) {
      const words = new Set(tokenize(goal))
      const action = intersects(words, ['triage', 'review', 'route'])
      const object = intersects(words, ['request', 'intake', 'case'])
      const priority = words.has('urgent') ? 'urgent' : words.has('standard') ? 'standard'
        : runtimeState.priority === 'urgent' || runtimeState.priority === 'standard' ? runtimeState.priority : null
      if (!action || !object || !priority) return null
      return { score: 0.9, values: { priority, createsNote: intersects(words, ['note', 'memo', 'document']) } }
    },
    plan(_goal, _context, runtimeState, match) {
      const priority = String(match.values.priority)
      const createsNote = match.values.createsNote === true
      const actions: PlannedAction[] = []
      if (runtimeState.view !== 'detail') {
        actions.push(capabilityAction({
          source: 'capability.browser_request_triage', tool: 'browser.click', input: { target: 'open-request' },
          preview: 'Open the current request in the isolated browser', expectedStateChange: 'The current request detail is visible',
          verification: { method: 'state_equals', target: 'view', expected: 'detail' },
        }))
      }
      actions.push(capabilityAction({
        source: 'capability.browser_request_triage', tool: 'browser.click', input: { target: `${priority}-review` },
        preview: `Route the current request to ${priority} review`, expectedStateChange: `The request is recorded as ${priority} reviewed`,
        verification: { method: 'state_equals', target: 'outcome', expected: `${priority}_reviewed` },
      }))
      if (createsNote) {
        const filename = `${priority}-review-result.txt`
        actions.push(capabilityAction({
          source: 'capability.browser_request_triage', tool: 'artifact.write',
          input: { path: filename, content: `${priority === 'urgent' ? 'Urgent' : 'Standard'} review\n- Request routed through Carve\n- Outcome verified before note creation\n` },
          preview: `Create ${filename} inside the Carve sandbox`, expectedStateChange: `${filename} exists as the verified review note`,
          verification: { method: 'artifact_exists', target: filename, expected: true },
        }))
      }
      return {
        id: 'capability.browser_request_triage',
        rationale: `The capability catalog matched a request-triage outcome and bound a fresh ${priority} path from registered typed tools.`,
        expectedOutputs: [`Current request recorded as ${priority} reviewed`, ...(createsNote ? [`Verified ${priority} review note in the Carve sandbox`] : [])],
        actions,
      }
    },
  }
}

function reopenWebResourcesCapability(): CapabilityDescriptor {
  return {
    id: 'capability.browser_reopen_resources',
    name: 'Open grounded webpages in an isolated browser',
    tools: ['browser.navigate'],
    match(_goal, context) {
      if (context.resolution?.intent !== 'revisit_resources') return null
      const pages = (context.resources ?? []).filter((resource) => resource.type === 'web_page' && resource.canonicalUrl)
      // The isolated browser is the preferred, verifiable path only when it
      // can restore every recalled page exactly.  If a native observation
      // retained a title but not a URL, defer to the desktop-computer
      // fallback so the request never degrades into a connector upsell.
      if (pages.length === 0 || pages.length !== (context.resources ?? []).filter((resource) => resource.type === 'web_page').length) return null
      return { score: 0.95, values: { resourceCount: String(pages.length) } }
    },
    plan(_goal, context) {
      const pages = (context.resources ?? []).filter((resource) => resource.type === 'web_page' && resource.canonicalUrl)
      return {
        id: 'capability.browser_reopen_resources',
        rationale: 'The capability catalog selected grounded browser navigation. Every URL came from the approved context receipt.',
        expectedOutputs: pages.map((resource) => `${resource.title} opened and its final URL verified`),
        actions: pages.map((resource) => capabilityAction({
          source: 'capability.browser_reopen_resources',
          tool: 'browser.navigate',
          input: { url: resource.canonicalUrl!, allowedDomain: resource.domain ?? new URL(resource.canonicalUrl!).hostname },
          preview: `Open ${resource.title}`,
          expectedStateChange: `${resource.title} is open at its approved URL`,
          verification: { method: 'state_equals', target: 'url', expected: resource.canonicalUrl! },
        })),
      }
    },
  }
}

/**
 * Recall's native privacy boundary intentionally does not retain browser
 * addresses. When a person asks to return to those pages, open the known URL
 * when present and otherwise open a plainly disclosed title search. This is a
 * built-in desktop action—not a connector the person must go find—and is
 * still proposed, contract-bound, and approved like every other computer
 * action.
 */
function reopenWithDesktopComputerCapability(): CapabilityDescriptor {
  return {
    id: 'capability.computer_reopen_recalled_pages',
    name: 'Resume recalled webpages in the default browser',
    tools: ['computer.open_url'],
    match(_goal, context) {
      if (context.resolution?.intent !== 'revisit_resources') return null
      const pages = (context.resources ?? []).filter((resource) => resource.type === 'web_page')
      if (pages.length === 0) return null
      return { score: 0.9, values: { resourceCount: String(pages.length) } }
    },
    plan(_goal, context) {
      const pages = (context.resources ?? []).filter((resource) => resource.type === 'web_page').slice(0, 8)
      const searched = pages.filter((resource) => !resource.canonicalUrl).length
      return {
        id: 'capability.computer_reopen_recalled_pages',
        rationale: searched > 0
          ? `The desktop computer fallback will reopen ${pages.length} recalled webpage${pages.length === 1 ? '' : 's'}. ${searched} captured page${searched === 1 ? ' did' : 's did'} not retain an address, so its exact recorded title is shown as a web search instead of claiming a precise URL.`
          : `The desktop computer fallback will reopen ${pages.length} recalled webpage${pages.length === 1 ? '' : 's'} in the default browser using the exact remembered addresses.`,
        expectedOutputs: pages.map((resource) => resource.canonicalUrl
          ? `${resource.title} opened in the default browser`
          : `A web search for the recorded title “${resource.title}” opened in the default browser`),
        actions: pages.map((resource) => {
          const exact = resource.canonicalUrl !== null
          const url = exact ? resource.canonicalUrl! : recallSearchUrl(resource.title)
          return capabilityAction({
            source: 'capability.computer_reopen_recalled_pages',
            tool: 'computer.open_url',
            input: { url, mode: exact ? 'exact' : 'search', resourceId: resource.id, sourceTitle: resource.title },
            preview: exact
              ? `Open the recalled page “${resource.title}” in your default browser`
              : `Search the web for the recorded page “${resource.title}” in your default browser`,
            expectedStateChange: exact
              ? `${resource.title} is handed to your default browser`
              : `A search for the recorded title ${resource.title} is handed to your default browser`,
            verification: { method: 'state_equals', target: 'last_opened_url', expected: url },
          })
        }),
      }
    },
  }
}

function recallSearchUrl(title: string): string {
  const query = title.trim().replace(/\s+/gu, ' ').slice(0, 240)
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`
}

function intersects(words: Set<string>, candidates: string[]): boolean {
  return candidates.some((candidate) => words.has(candidate))
}

function capabilityAction(input: {
  source: string
  tool: string
  input: Record<string, unknown>
  preview: string
  expectedStateChange: string
  verification: PlannedAction['verification']
}): PlannedAction {
  return {
    id: id('planned_action'),
    sourceStepId: input.source,
    status: 'proposed',
    tool: input.tool,
    input: input.input,
    risk: 'reversible_write',
    sensitiveClass: null,
    stateChanging: true,
    preview: input.preview,
    expectedStateChange: input.expectedStateChange,
    verification: input.verification,
    group: input.source,
  }
}
