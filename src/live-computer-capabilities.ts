import type { LiveComputerRouteStartEntry } from './desktop-contract.js'
import type { LiveComputerActionEngine } from './types.js'

/**
 * One declarative table of what each live action engine can drive. Every
 * check that used to live in a different layer — the browser-only pilot in
 * the action engine, the one-window rule in Universal mode, the fresh-window
 * kinds a runner can open — reads from here, and the route planner consults
 * it BEFORE a window opens. Once a browser-only engine accepted a
 * TextEdit stage, opened the research window, and then terminated the run as
 * a "safety block" on its first proposal; the person learned the limit after
 * Start instead of at review.
 */
export type LiveComputerSurfaceKind = 'browser' | 'native'

export interface LiveComputerEngineCapability {
  engine: LiveComputerActionEngine
  label: string
  surfaces: readonly LiveComputerSurfaceKind[]
  /** Windows one session may hold at once. */
  maxWindows: number
  /** Supports serial stages managed by the application-handoff coordinator. */
  applicationHandoff: boolean
  /** Fresh windows the engine's runner can open: a browser at an https
   * address, a new document in a document application, or both. */
  freshWindows: readonly ('url' | 'document')[]
}

export const liveComputerEngineCapabilities: Readonly<Record<LiveComputerActionEngine, LiveComputerEngineCapability>> = {
  compact_v1: {
    applicationHandoff: true,
    engine: 'compact_v1', label: 'Compact · Preview',
    surfaces: ['browser', 'native'], maxWindows: 1, freshWindows: ['url', 'document'],
  },
  router_v1: {
    applicationHandoff: true,
    engine: 'router_v1', label: 'Router · Compact on the web, Thin elsewhere',
    surfaces: ['browser', 'native'], maxWindows: 1, freshWindows: ['url', 'document'],
  },
  structured_v1: {
    applicationHandoff: false,
    engine: 'structured_v1', label: 'Assured · Carve structured controller',
    surfaces: ['browser', 'native'], maxWindows: 4, freshWindows: ['url', 'document'],
  },
  openai_computer_v1: {
    applicationHandoff: false,
    engine: 'openai_computer_v1', label: 'Assured · OpenAI actions inside Carve',
    surfaces: ['browser'], maxWindows: 1, freshWindows: ['url'],
  },
  openai_universal_v1: {
    applicationHandoff: true,
    engine: 'openai_universal_v1', label: 'Universal · OpenAI runs continuously',
    surfaces: ['browser', 'native'], maxWindows: 1, freshWindows: ['url', 'document'],
  },
  openai_thin_v1: {
    applicationHandoff: true,
    engine: 'openai_thin_v1', label: 'Thin · OpenAI computer use',
    surfaces: ['browser', 'native'], maxWindows: 1, freshWindows: ['url', 'document'],
  },
}

export const browserSurfacePattern = /\b(?:browser|chrome|chromium|safari|firefox|edge|arc|brave|opera|vivaldi)\b/iu

export function liveComputerSurfaceKind(window: { application: string; bundleIdentifier: string }): LiveComputerSurfaceKind {
  return browserSurfacePattern.test(`${window.application} ${window.bundleIdentifier}`) ? 'browser' : 'native'
}

export interface LiveComputerRouteFeasibility {
  ok: boolean
  /** Person-facing reason the route cannot run on this engine. */
  reason: string | null
  /** 1-based route stage the reason refers to, when one stage is at fault. */
  stage: number | null
  /** Engines that could run this exact route, most governed first. */
  alternatives: LiveComputerActionEngine[]
}

function routeIssue(capability: LiveComputerEngineCapability, route: LiveComputerRouteStartEntry[]): { reason: string; stage: number | null } | null {
  if (route.length === 0) return { reason: 'The work-surface route is empty.', stage: null }
  if (route.length > capability.maxWindows) {
    return {
      reason: capability.maxWindows === 1
        ? `${capability.label} works in one window at a time; this route has ${route.length}.`
        : `${capability.label} works in at most ${capability.maxWindows} windows; this route has ${route.length}.`,
      stage: capability.maxWindows + 1,
    }
  }
  for (const [index, entry] of route.entries()) {
    const window = entry.source === 'fresh'
      ? { application: entry.application, bundleIdentifier: entry.bundleIdentifier }
      : { application: entry.target.application, bundleIdentifier: entry.target.bundleIdentifier }
    const surface = liveComputerSurfaceKind(window)
    if (!capability.surfaces.includes(surface)) {
      return { reason: `${capability.label} cannot work in ${window.application}; it drives ${capability.surfaces.join(' and ')} windows only.`, stage: index + 1 }
    }
    if (entry.source === 'fresh') {
      const kind = entry.url ? 'url' : 'document'
      if (!capability.freshWindows.includes(kind)) {
        return {
          reason: kind === 'url'
            ? `${capability.label} cannot open a fresh browser window at an address.`
            : `${capability.label} cannot open a new ${window.application} document.`,
          stage: index + 1,
        }
      }
    }
  }
  return null
}

/** Whether `engine` can run `route` at all, decided from the table alone —
 * no window is opened or inspected. */
export function liveComputerRouteFeasibility(engine: LiveComputerActionEngine, route: LiveComputerRouteStartEntry[]): LiveComputerRouteFeasibility {
  const issue = routeIssue(liveComputerEngineCapabilities[engine], route)
  const alternatives = (Object.keys(liveComputerEngineCapabilities) as LiveComputerActionEngine[])
    .filter((candidate) => candidate !== engine && routeIssue(liveComputerEngineCapabilities[candidate], route) === null)
  return issue
    ? { ok: false, reason: issue.reason, stage: issue.stage, alternatives }
    : { ok: true, reason: null, stage: null, alternatives }
}
