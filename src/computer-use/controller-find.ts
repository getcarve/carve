import type { LiveComputerCapturedFrame } from '../live-computer.js'
import type { LiveComputerElement } from '../types.js'
import { isBrowserFindField, isBrowserLocationField } from './effects.js'

/**
 * The actor's `find`, answered by the controller. The browser's Find bar cost
 * about 13.7 s per use (six inputs, about twelve captures, two model turns; 40
 * uses and 549 s over 65 retail runs), hid the page from accessibility while it
 * was open, and on a clothing retailer four "Brand" finds never reached the facet. The
 * controller already holds the captured accessibility tree and the whole page's
 * text, so it looks there first: a match already on screen costs no input; a
 * match elsewhere is brought into view with one native scroll (no script, no
 * Find bar); the next observation names what was found. Only when neither
 * source has the text does the old Find bar path run.
 * `STEWARD_CONTROLLER_FIND=off` restores the Find bar for every find.
 */
export const controllerFindEnabled = (env: NodeJS.ProcessEnv = process.env) => env.STEWARD_CONTROLLER_FIND?.trim().toLowerCase() !== 'off'

export interface ControllerFindResult {
  query: string
  /** on_screen: already visible, no input; accessibility: an element found off screen; page_text: only the page's text has it. */
  source: 'on_screen' | 'accessibility' | 'page_text'
  /** The matched element, when accessibility has one. */
  element: LiveComputerElement | null
  /** The match in its surrounding page text (bounded), or the element's own label. */
  context: string
  /** Pixels to scroll the page (positive is down), or null when no scroll is needed or none can be estimated. */
  scrollDeltaY: number | null
  /** How many times the page text contains the query. */
  occurrences: number
}

const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase()
const maximumScroll = 2_000
const contextCharacters = 160

export function controllerFind(query: string, frame: Pick<LiveComputerCapturedFrame, 'elements' | 'width' | 'height' | 'contentBounds'>, pageText: string | null): ControllerFindResult | null {
  const wanted = normalize(query)
  if (!wanted || wanted.length > 200) return null
  const content = frame.contentBounds ?? { x: 0, y: 0, width: frame.width, height: frame.height }
  const visible = (b: NonNullable<LiveComputerElement['bounds']>) => b.y + b.height / 2 >= content.y && b.y + b.height / 2 <= content.y + content.height
    && b.x + b.width / 2 >= content.x && b.x + b.width / 2 <= content.x + content.width
  // Browser chrome (the address bar, the Find bar, tabs) lies above the page area and is not the page.
  const chrome = (b: NonNullable<LiveComputerElement['bounds']>) => b.y >= 0 && b.y + b.height <= content.y
  const labelOf = (e: LiveComputerElement) => [e.name, e.sensitive ? null : e.value, e.description].filter((part): part is string => typeof part === 'string' && part.trim().length > 0).join(' ')
  const flat = pageText ? pageText.replace(/\s+/gu, ' ') : ''
  const flatLower = flat.toLocaleLowerCase()
  let occurrences = 0
  for (let at = flatLower.indexOf(wanted); at >= 0 && occurrences < 1000; at = flatLower.indexOf(wanted, at + wanted.length)) occurrences++
  const contextAt = (index: number) => flat.slice(Math.max(0, index - contextCharacters), index + wanted.length + contextCharacters).trim()

  const matches = frame.elements.flatMap((element, order) => {
    if (element.sensitive || !element.bounds || element.bounds.width <= 0 || element.bounds.height <= 0 || chrome(element.bounds)
      || isBrowserLocationField(element) || isBrowserFindField(element)) return []
    const label = normalize(labelOf(element))
    if (!label.includes(wanted)) return []
    const exact = label === wanted ? 3 : label.startsWith(wanted) ? 2 : 1
    const control = /(button|link|heading|tab|checkbox|radio|menuitem|disclosure|row|cell)/iu.test(element.role) ? 1 : 0
    return [{ element, order, score: exact * 10 + control * 3 - Math.min(2, label.length / 200), shown: visible(element.bounds) }]
  })
  // The best-matching label wins; among equals, one already on screen, then document order (as Find would go).
  matches.sort((a, b) => b.score - a.score || Number(b.shown) - Number(a.shown) || a.order - b.order)
  const best = matches[0]
  if (best) {
    const b = best.element.bounds!
    const index = flatLower.indexOf(wanted)
    const context = index >= 0 ? contextAt(index) : labelOf(best.element).replace(/\s+/gu, ' ').slice(0, 2 * contextCharacters)
    if (best.shown) return { query, source: 'on_screen', element: best.element, context, scrollDeltaY: null, occurrences }
    const target = content.y + content.height / 3
    return { query, source: 'accessibility', element: best.element, context, scrollDeltaY: clampScroll(b.y + b.height / 2 - target), occurrences }
  }
  if (!occurrences) return null
  // Only the page's text has it (content outside the captured tree). Estimate where it lies from the visible
  // elements whose text is also in the page text: document offset against screen position.
  const index = flatLower.indexOf(wanted)
  const anchors = frame.elements.flatMap(element => {
    if (element.sensitive || !element.bounds || !visible(element.bounds)) return []
    const label = normalize(element.name ?? '')
    if (label.length < 12) return []
    const at = flatLower.indexOf(label)
    return at >= 0 && flatLower.indexOf(label, at + 1) < 0 ? [{ at, y: element.bounds.y + element.bounds.height / 2 }] : []
  }).sort((a, b) => a.at - b.at)
  let scrollDeltaY: number | null = null
  const first = anchors[0], last = anchors.at(-1)
  if (first && last && last.at > first.at && last.y > first.y) {
    const pixelsPerCharacter = (last.y - first.y) / (last.at - first.at)
    const estimated = first.y + (index - first.at) * pixelsPerCharacter
    scrollDeltaY = visibleY(estimated, content) ? null : clampScroll(estimated - (content.y + content.height / 3))
  } else if (first && last) {
    scrollDeltaY = index > last.at ? clampScroll(content.height * 0.8) : index < first.at ? clampScroll(-content.height * 0.8) : null
  }
  return { query, source: 'page_text', element: null, context: contextAt(index), scrollDeltaY, occurrences }
}

function visibleY(y: number, content: { y: number; height: number }): boolean {
  return y >= content.y && y <= content.y + content.height
}

function clampScroll(value: number): number | null {
  const rounded = Math.round(value)
  if (Math.abs(rounded) < 40) return null
  return Math.max(-maximumScroll, Math.min(maximumScroll, rounded))
}

/** What the next observation says about a controller find: where it is and the words around it. */
export function controllerFindReport(result: ControllerFindResult, ref: string | null): Record<string, unknown> {
  return {
    text: result.query,
    found: result.source === 'on_screen' ? 'already on screen; no input was sent'
      : result.source === 'accessibility' ? 'found on the page; Carve scrolled toward it'
        : result.scrollDeltaY === null ? 'found in the page text' : 'found in the page text; Carve scrolled toward its estimated position',
    ...(ref ? { ref } : {}),
    ...(result.element ? { label: (result.element.name || result.element.role).replace(/\s+/gu, ' ').slice(0, 120) } : {}),
    context: result.context,
    occurrencesInPageText: result.occurrences,
    // In testing (an eyewear retailer): "Bestsellers" was reported on screen twice and never clicked; Find locates, it does not act.
    note: result.source === 'on_screen' && ref
      ? 'The browser Find bar was not opened. Find only locates text; nothing was selected or opened. The match is on screen now: to open, select or read what it names, click its ref (a text ref binds to the control around it).'
      : 'The browser Find bar was not opened. Find only locates text; nothing was selected or opened. If the match is not yet in view after the scroll, scroll a little further or use its ref.',
  }
}

/** `STEWARD_FIND_BAR_FALLBACK=off`: text only the page text holds, with nowhere to scroll, is still answered locally. */
export const findBarFallbackEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.STEWARD_FIND_BAR_FALLBACK?.trim().toLowerCase() !== 'off'

/** Whether the controller can answer a find itself: an element to show, or a position to scroll toward. Text only the
 * page's text holds, with neither, goes to the browser's Find bar, which scrolls to it. */
export function findAnsweredLocally(found: ControllerFindResult | null, env: NodeJS.ProcessEnv = process.env): found is ControllerFindResult {
  if (!found) return false
  return !(found.source === 'page_text' && found.scrollDeltaY === null && !found.element && findBarFallbackEnabled(env))
}
