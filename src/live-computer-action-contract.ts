import type { LiveComputerAction, LiveComputerElement, LiveComputerFrame, LiveComputerObjective } from './types.js'

/**
 * One controller-owned vocabulary shared by provider compilation and the
 * selected-window preflight. Keeping these predicates in one place prevents a
 * compiler from minting an action that the next deterministic layer rejects.
 */
const elementBoundActionKinds = new Set<LiveComputerAction['kind']>([
  'move',
  'click',
  'drag',
  'element_action',
  'type_into',
  'enter_sequence',
  'apply_artifact',
])

const safeKeypresses = new Set([
  'TAB',
  'SHIFT+TAB',
  'RETURN',
  'ENTER',
  'ESC',
  'ESCAPE',
  'SPACE',
  'UP',
  'DOWN',
  'LEFT',
  'RIGHT',
])

const submitCapableObjectiveKinds = new Set<LiveComputerObjective['kind']>([
  'establish_route',
  'enter_query',
  'open_matching_resource',
  'open_related_content',
  // Acquiring evidence may require a search inside a broad research objective.
  // Field focus, payload provenance and effect checks still gate submission.
  'extract_information',
  'choose_resource',
])

export type LiveComputerPointRegion =
  | 'outside_frame'
  | 'observed_content'
  | 'observed_chrome'
  | 'definite_chrome'
  | 'ambiguous_top'
  | 'likely_content'

export type ProviderNavigationAction =
  | { kind: 'keypress'; key: string }
  | {
      kind: 'scroll'
      scrollY: number
      scrollIntent: NonNullable<LiveComputerAction['scrollIntent']>
      summary: string
    }

export class LiveComputerActionContractError extends Error {
  constructor(readonly stage: 'policy' | 'unsupported', message: string) {
    super(message)
    this.name = 'LiveComputerActionContractError'
  }
}

export function liveComputerActionMayBindElement(kind: LiveComputerAction['kind']): boolean {
  return elementBoundActionKinds.has(kind)
}

/** One text-entry predicate is shared by provider compilation and execution
 * preflight. AXValue alone is not enough: generic groups often expose it for
 * readable state while remaining incapable of accepting typed input. */
export function liveComputerElementSupportsTextEntry(element: LiveComputerElement): boolean {
  if (element.editable === true) return true
  if (element.editable === false) return false
  return /(?:text\s*field|text\s*area|search\s*field|combo\s*box|editable)/iu.test(element.role)
}

export function liveComputerKeypressIsSafe(key: string | null | undefined): boolean {
  return safeKeypresses.has(key?.trim().toUpperCase() ?? '')
}

export function liveComputerObjectiveSupportsFieldSubmit(kind: LiveComputerObjective['kind']): boolean {
  return submitCapableObjectiveKinds.has(kind)
}

/** Classify a provider point using the strongest selected-window evidence.
 * Platform-observed content bounds are authoritative. Without them, only the
 * top 72 points are definite browser chrome; the remainder of the historic
 * chrome band stays explicitly ambiguous instead of being mislabeled. */
export function liveComputerPointRegion(
  frame: Pick<LiveComputerFrame, 'width' | 'height' | 'contentBounds'>,
  point: { x: number; y: number },
): LiveComputerPointRegion {
  if (point.x < 0 || point.y < 0 || point.x >= frame.width || point.y >= frame.height) return 'outside_frame'
  const content = frame.contentBounds
  if (content) {
    return point.x >= content.x && point.y >= content.y
      && point.x < content.x + content.width && point.y < content.y + content.height
      ? 'observed_content'
      : 'observed_chrome'
  }
  const definiteChromeBand = 72
  if (point.y <= definiteChromeBand) return 'definite_chrome'
  const conservativeChromeBand = Math.max(72, Math.min(150, Math.round(frame.height * 0.16)))
  return point.y <= conservativeChromeBand ? 'ambiguous_top' : 'likely_content'
}

function canonicalProviderKey(value: string): string {
  const compact = value.trim().toUpperCase().replace(/[\s_-]+/gu, '')
  if (compact === 'ESCAPE') return 'ESC'
  if (compact === 'RETURN') return 'ENTER'
  if (compact.startsWith('ARROW')) return compact.slice('ARROW'.length)
  return compact
}

/**
 * Convert provider key vocabulary into Carve actions. Document-boundary
 * keys become controller-owned scroll intents rather than raw keyboard input;
 * this keeps their receiver and bounded execution semantics inspectable.
 */
export function translateProviderNavigationKeys(
  keys: string[],
  objectiveKind: LiveComputerObjective['kind'],
  viewportHeight: number,
): ProviderNavigationAction {
  const normalized = keys
    .flatMap((key) => key.split('+'))
    .map(canonicalProviderKey)
    .filter(Boolean)
  const joined = normalized.join('+')
  if (joined === 'SHIFT+TAB') return { kind: 'keypress', key: joined }
  if (normalized.length !== 1) {
    throw new LiveComputerActionContractError('unsupported', 'Multi-key shortcuts are outside the experimental computer-action compiler')
  }

  const key = normalized[0]!
  if (key === 'HOME') {
    return { kind: 'scroll', scrollY: -2_000, scrollIntent: 'top', summary: 'Scroll to the top of the approved page' }
  }
  if (key === 'END') {
    return { kind: 'scroll', scrollY: 2_000, scrollIntent: 'bottom', summary: 'Scroll to the bottom of the approved page' }
  }
  const viewportScroll = Math.max(320, Math.min(2_000, Math.round(viewportHeight * 0.8)))
  if (key === 'PAGEUP') {
    return { kind: 'scroll', scrollY: -viewportScroll, scrollIntent: 'viewport', summary: 'Scroll upward within the approved page' }
  }
  if (key === 'PAGEDOWN') {
    return { kind: 'scroll', scrollY: viewportScroll, scrollIntent: 'viewport', summary: 'Scroll downward within the approved page' }
  }
  if (!liveComputerKeypressIsSafe(key)) {
    throw new LiveComputerActionContractError('unsupported', `Key ${joined || '(empty)'} is outside Carve’s safe navigation vocabulary`)
  }
  if (key === 'ENTER' && !liveComputerObjectiveSupportsFieldSubmit(objectiveKind)) {
    throw new LiveComputerActionContractError('policy', 'Enter is allowed only for a read-only navigation or lookup objective')
  }
  return { kind: 'keypress', key }
}
