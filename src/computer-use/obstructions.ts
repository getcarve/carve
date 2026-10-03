import type { LiveComputerElement, LiveComputerFrame, LiveComputerObstruction } from '../types.js'

/**
 * Consent banners and modal overlays are the most common reason a correct
 * click misses on the web. This module names their controls from the
 * accessibility tree so the controller can clear the way without aiming at
 * pixels, and without ever accepting on the person's behalf.
 *
 * The vocabulary is derived from the control labels the open consent-rule
 * databases (duckduckgo/autoconsent, Consent-O-Matic) act on for OneTrust,
 * Cookiebot, Didomi, Sourcepoint, TrustArc, and Quantcast. It is a label
 * classifier, not a site list: no selector, domain, or page text is trusted.
 */
export type ObstructionControlKind = 'close' | 'reject' | 'accept' | 'settings' | 'other'

// Only unambiguous, complete labels qualify for automatic dismissal.
// A substring such as "close" in "accept and close" is not authorization.
const closePatterns = [
  /^(?:close|dismiss|x|×|✕|✖|no thanks|no, thanks|not now|maybe later|skip|keep shopping|continue shopping|continue to (?:the )?site|return to (?:the )?site|close (?:this )?(?:dialog|notice|banner|popup|pop-up|message|modal))$/iu,
]
const rejectPatterns = [
  /^(?:reject(?: all(?: cookies)?)?|(?:reject|decline|refuse|deny)(?: all)? (?:non-?essential|optional|additional|unnecessary)(?: cookies)?|decline(?: all(?: cookies)?)?|refuse all|deny all|do not accept|don['’]t accept|(?:necessary|essential|required) (?:cookies )?only|only (?:necessary|essential|required)(?: cookies)?|use (?:necessary|essential) cookies only|continue without accepting|opt out|do not sell(?: or share)?(?: my personal information)?)$/iu,
]
const acceptPatterns = [ /\b(?:accept|allow|agree|consent|understand|understood|okay|ok)\b|^got it$/iu ]
const settingsPatterns = [/\b(?:manage|customi[sz]e|settings|preferences|options|choices|more options|learn more|show purposes)\b/iu]

export function classifyObstructionControl(name: string): ObstructionControlKind {
  const label = name.normalize('NFKC').replace(/\s+/gu, ' ').trim()
  if (!label || label.length > 80) return 'other'
  // Order matters: "Continue without accepting" is a rejection, not an accept.
  if (rejectPatterns.some((pattern) => pattern.test(label))) return 'reject'
  if (closePatterns.some((pattern) => pattern.test(label))) return 'close'
  if (acceptPatterns.some((pattern) => pattern.test(label))) return 'accept'
  if (settingsPatterns.some((pattern) => pattern.test(label))) return 'settings'
  return 'other'
}

/** The most privacy-preserving answer to a consent prompt. Choosing it never
 * widens what Carve may do, so it is an ordinary step of any browsing task.
 * A bare "Decline" also names other things (a meeting invitation), so it
 * qualifies only inside a dialog; consent wording qualifies anywhere. */
export function privacyPreservingConsentChoice(element: Pick<LiveComputerElement, 'role' | 'name' | 'dialogId'> & { actions?: string[] | undefined }): boolean {
  const label = (element.name ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
  // A pressable element that is not a button or link by role (a styled <div>) makes the same choice
  // (`STEWARD_CONSENT_TIEBREAK=off` keeps buttons and links only).
  const pressable = controlRoles.has(element.role) || (consentTieBreakEnabled() && (element.actions ?? []).includes('AXPress'))
  if (!pressable || classifyObstructionControl(label) !== 'reject') return false
  return /\b(?:cookies?|necessary|essential|required|accepting|sell)\b/iu.test(label) || Boolean(element.dialogId)
}

/** `STEWARD_CONSENT_TIEBREAK=off`: a privacy-preserving consent choice tied at its point with another element stays ambiguous. */
export const consentTieBreakEnabled = (env: NodeJS.ProcessEnv = process.env) => env.STEWARD_CONSENT_TIEBREAK?.trim().toLowerCase() !== 'off'

/** Words that make a dialog or banner a consent notice: it asks about
 * cookies or the use of personal data. Read from the notice's own members
 * (its text, links and control labels), never from a site list. */
const consentNoticeWords = /\b(?:cookies?|tracking|trackers?|privacy (?:choices|settings|preferences|policy|options)|consent|personal (?:data|information)|sell or share|advertising partners)\b/iu

/** A dialog or banner that asks for consent to cookies or data use: its
 * members mention it, or it offers an accept beside a rejection. */
export function consentNotice(dialogId: number | null | undefined, elements: readonly LiveComputerElement[]): boolean {
  if (dialogId === null || dialogId === undefined) return false
  const members = elements.filter((element) => element.dialogId === dialogId)
  if (members.some((element) => consentNoticeWords.test([element.name, element.description, typeof element.value === 'string' ? element.value : null].filter((part) => typeof part === 'string').join(' ')))) return true
  const kinds = new Set(members.filter((element) => controlRoles.has(element.role)).map((element) => classifyObstructionControl(element.name ?? '')))
  return kinds.has('accept') && kinds.has('reject')
}

/** What a control inside a consent notice does to consent, or null outside
 * one. Decided from the accessibility tree alone, the same way every run:
 * a furniture retailer's cookie "Ok" was once an unclassified control when the
 * rule classifier judged it and legal acceptance when a model review did. */
export function consentNoticeChoice(element: Pick<LiveComputerElement, 'role' | 'name' | 'dialogId' | 'actions'>, elements: readonly LiveComputerElement[]): ObstructionControlKind | null {
  if (!(controlRoles.has(element.role) || (element.actions ?? []).includes('AXPress'))) return null
  if (!consentNotice(element.dialogId, elements)) return null
  const kind = classifyObstructionControl(element.name ?? '')
  return kind === 'other' ? null : kind
}

/** Whether a consent notice offers a way through other than accepting. When
 * it does, Carve never accepts on the person's behalf; when it does not, the
 * accept is the person's decision at a checkpoint. */
export function consentNoticeHasAlternative(dialogId: number | null | undefined, elements: readonly LiveComputerElement[]): boolean {
  if (dialogId === null || dialogId === undefined) return false
  return elements.some((element) => element.dialogId === dialogId && !element.sensitive && element.enabled !== false
    && (controlRoles.has(element.role) || (element.actions ?? []).includes('AXPress'))
    && consentAlternative(element.name ?? ''))
}

/** A way through a notice other than accepting: a close, a rejection, or the
 * notice's own privacy choices. An informational link that merely starts
 * "Learn more about how ticket prices are determined" is not one; counting it
 * hid a ticketing site's "Accept & Continue" terms button, so no approval could be
 * asked and the ticket list stayed covered. */
function consentAlternative(name: string): boolean {
  const kind = classifyObstructionControl(name)
  if (kind === 'reject' || kind === 'close') return true
  if (kind !== 'settings') return false
  const label = name.normalize('NFKC').replace(/\s+/gu, ' ').trim()
  return label.length <= 24 || /\b(?:cookies?|privacy|consent|preferences|settings|choices|purposes|partners|vendors)\b/iu.test(label)
}

export interface ObstructionControl {
  element: LiveComputerElement
  kind: ObstructionControlKind
}

const controlRoles = new Set(['AXButton', 'AXLink'])

/** Controls the obstruction offers, in the order the controller may try them:
 * dismissals first, then rejections. Accept is listed so it can be reported,
 * never pressed automatically. */
export function obstructionControls(elements: LiveComputerElement[], obstruction: LiveComputerObstruction): ObstructionControl[] {
  const controls = elements
    .filter((element) => element.dialogId === obstruction.id && !element.sensitive && element.enabled !== false
      && (controlRoles.has(element.role) || (element.actions ?? []).includes('AXPress')))
    .map((element) => ({ element, kind: classifyObstructionControl(element.name || '') }))
  const order: ObstructionControlKind[] = ['close', 'reject', 'settings', 'accept', 'other']
  return controls.sort((left, right) => order.indexOf(left.kind) - order.indexOf(right.kind))
}

/** The obstruction whose bounds contain the point, unless the intended
 * target itself belongs to that obstruction (clicking a dialog's own button
 * is not being covered by it). */
export function obstructionCovering(
  frame: Pick<LiveComputerFrame, 'obstructions'> | null | undefined,
  point: { x: number; y: number } | null,
  target: Pick<LiveComputerElement, 'dialogId' | 'bounds'> | null,
): LiveComputerObstruction | null {
  if (!frame?.obstructions?.length || !point) return null
  for (const obstruction of frame.obstructions) {
    if (target?.dialogId === obstruction.id) continue
    const inside = point.x >= obstruction.bounds.x && point.x <= obstruction.bounds.x + obstruction.bounds.width
      && point.y >= obstruction.bounds.y && point.y <= obstruction.bounds.y + obstruction.bounds.height
    if (inside) return obstruction
  }
  return null
}

