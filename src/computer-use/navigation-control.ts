import type { LiveComputerElement } from '../types.js'

const directions = new Map([['older', 'newer'], ['newer', 'older'], ['next', 'previous'], ['previous', 'next'], ['prev', 'next']])
const resources = '(?:pages?|messages?|emails?|conversations?|threads?|results?|items?|records?|slides?|images?|photos?|months?|years?)'
const navigationLabel = new RegExp(`^(?:go to |show |view )?(older|newer|next|previous|prev)(?: ${resources})?$`, 'iu')
// Navigation evidence must not override a conflicting effect in platform
// metadata. Message/email nouns are allowed; sending verbs are not.
const consequential = /\b(delete|remove|erase|trash|archive|destroy|clear|send|compose|reply|forward|publish|share|buy|pay|purchase|checkout|order|donate|transfer|sign|log in|password|authenticate|install|administrator|grant|allow|accept|agree|consent|submit|confirm|finish|apply|save|update|mark|move|select)\b/iu

function label(element: LiveComputerElement): string {
  return (element.name?.trim() || element.description?.trim() || '').replace(/\s+/gu, ' ')
}

export function hasDirectionalNavigationLabel(element: LiveComputerElement): boolean {
  return /^(?:go to |show |view )?(?:older|newer|next|previous|prev)\b/iu.test(label(element))
}

function navigation(element: LiveComputerElement): { direction: string; explicitResource: boolean } | null {
  if (element.sensitive || element.obstructed || element.editable || !/^(?:AX)?(?:Button|Link)$/iu.test(element.role)) return null
  const text = label(element)
  const match = navigationLabel.exec(text)
  if (!match) return null
  const metadata = [element.name, element.description, element.help, element.placeholder, element.subrole].filter(Boolean).join(' ')
  if (consequential.test(metadata) || /\b(?:email|message|post) (?:this|the|selected|all|these|a|an)\b/iu.test(metadata)) return null
  return { direction: match[1]!.toLowerCase(), explicitResource: new RegExp(` ${resources}$`, 'iu').test(text) }
}

/** Platform-owned navigation evidence, independent of website and model
 * suggestions. A full directional label names what will be browsed. A bare
 * direction needs a nearby complementary control in the same UI context.
 * Disabled peers still identify a pager at its first or last item. */
export function isNavigationControl(element: LiveComputerElement, elements: readonly LiveComputerElement[]): boolean {
  if (element.enabled === false) return false
  const intent = navigation(element)
  if (!intent) return false
  if (intent.explicitResource) return true
  const bounds = element.bounds
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return false
  return elements.some(peer => {
    if (peer === element || peer.id === element.id || peer.role !== element.role
      || (peer.dialogId ?? null) !== (element.dialogId ?? null)
      || peer.depth !== element.depth) return false
    const other = navigation(peer)
    if (!other || (directions.get(intent.direction) !== other.direction && directions.get(other.direction) !== intent.direction)) return false
    const b = peer.bounds
    if (!b || b.width <= 0 || b.height <= 0) return false
    const dx = Math.abs(bounds.x + bounds.width / 2 - b.x - b.width / 2)
    const dy = Math.abs(bounds.y + bounds.height / 2 - b.y - b.height / 2)
    const horizontal = dy <= Math.min(bounds.height, b.height) / 2 && dx <= Math.min(320, 8 * Math.max(bounds.width, b.width))
    const vertical = dx <= Math.min(bounds.width, b.width) / 2 && dy <= Math.min(320, 8 * Math.max(bounds.height, b.height))
    return horizontal || vertical
  })
}
