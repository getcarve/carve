import type { LiveComputerActionEngine } from './types.js'

// Shared by native dispatch, the controller and the browser UI. Keeping these
// identities together prevents a new engine from entering the legacy path at
// a different entry point.
export const liveComputerActionEngines = ['structured_v1', 'openai_computer_v1', 'openai_universal_v1', 'openai_thin_v1', 'compact_v1', 'router_v1'] as const satisfies readonly LiveComputerActionEngine[]
export const universalLiveComputerEngines = ['openai_universal_v1', 'openai_thin_v1', 'compact_v1', 'router_v1'] as const

export function isUniversalLiveComputerEngine(engine: string): engine is typeof universalLiveComputerEngines[number] {
  return universalLiveComputerEngines.some(candidate => candidate === engine)
}
