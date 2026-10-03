/** Target-scoped intended-effect check (a search-engine product query in one run:
 * the same query was filled four times and never submitted, then two result
 * links were clicked seven times with no navigation). Every repetition detector
 * judged the whole window, and the window always changed: suggestions, a news
 * carousel, focus moving between links, the Find field's ref churning. None
 * asked whether the action did what it was for. This module asks exactly that,
 * on the action's own target:
 *  - value: a text fill reads back the typed text in its field;
 *  - navigate: a link (or a directional navigation button) click changes the
 *    document (address or title), opens a dialog, toggles the target, or
 *    materially changes the visible content (an in-page anchor, an SPA route);
 *  - submit: Enter in a lookup field changes the document or its results.
 * Pure: the provider supplies frames and delivery receipts. */
import type { LiveComputerCapturedFrame } from '../live-computer.js'
import type { LiveComputerElement } from '../types.js'
import type { ComputerActionProposal } from '../providers/types.js'
import type { SelectedWindowInputLedgerEntry } from './selected-window-backend.js'
import { liveComputerElementSupportsTextEntry } from '../live-computer-action-contract.js'
import { isBrowserFindField, isBrowserLocationField, isEditable, isLookupField } from './effects.js'
import { isNavigationControl } from './navigation-control.js'
import { detectPageBoundary } from './site-boundaries.js'
import { sourceDocumentKey, sourceDocumentOf, sourceElementText, sourceElementVisible } from './source-observations.js'

/** `STEWARD_ACTION_INTENT_CHECK=off` removes the effect findings, the third-try refusal and the ineffective-action stop. */
export const actionIntentCheckEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.STEWARD_ACTION_INTENT_CHECK?.trim().toLowerCase() !== 'off'

/** What the window looked like when the program was decided. */
export interface EffectSnapshot { sourceKey: string; url: string | null; title: string | null; lines: string[]; dialogs: string[]; readable: boolean }

interface EffectBase { signature: string; label: string; before: EffectSnapshot }
export type IntendedEffect =
  | EffectBase & { kind: 'value'; field: { role: string; name: string; fingerprint: string | null }; text: string; lookup: boolean; submitted: boolean }
  | EffectBase & { kind: 'navigate'; target: { role: string; name: string; fingerprint: string | null; expanded: boolean | null }; disclosure?: boolean; controls?: number
    /** Where a popup anchored to the control would render, and what was there before the click. */
    anchor?: { region: { x: number; y: number; width: number; height: number }; before: string[] } }
  | EffectBase & { kind: 'submit'; field: { role: string; name: string } }

export type EffectStatus = 'met' | 'unmet' | 'unknown'

const norm = (value: string | null | undefined) => (value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase()
const roleKey = (role: string) => role.trim().toLocaleLowerCase()
const label = (element: LiveComputerElement) => (element.name?.trim() || element.role).slice(0, 120)

/** Visible content lines (browser chrome excluded when the frame reports its content area). */
function contentLines(frame: LiveComputerCapturedFrame): string[] {
  return frame.elements.filter(e => sourceElementVisible(e, frame)).flatMap(sourceElementText).map(line => line.trim()).filter(line => line.length >= 3)
}

function dialogKeys(frame: LiveComputerCapturedFrame): string[] {
  return (frame.obstructions ?? []).filter(o => o.evidence !== 'banner').map(o => `${roleKey(o.role)}|${norm(o.name)}`)
}

export function effectSnapshot(frame: LiveComputerCapturedFrame): EffectSnapshot {
  const source = sourceDocumentOf(frame)
  return { sourceKey: sourceDocumentKey(source), url: source.url, title: source.title, lines: contentLines(frame), dialogs: dialogKeys(frame), readable: Boolean(frame.contentBounds) }
}

/** A site's own search or filter field: not the browser's Find bar or address bar. */
function siteLookupField(element: LiveComputerElement): boolean {
  return isEditable(element) && !element.sensitive && isLookupField(element) && !isBrowserFindField(element) && !isBrowserLocationField(element)
}

/** A menu or disclosure button that is collapsed: its click is for opening it (a dictionary site's "More",
 * in a capsule test: clicked 18 times over 3 minutes, never expanded, while a rotating "Top Lookups" list made every step
 * look like progress). */
function disclosureTarget(element: LiveComputerElement): boolean {
  if (element.sensitive || element.enabled === false) return false
  return /button|menu|disclosure/u.test(roleKey(element.role)) && (element.expanded === false || (element.actions ?? []).includes('AXShowMenu'))
}
/** `STEWARD_ANCHORED_DISCLOSURE=off` restores judging a disclosure only by expansion, dialogs and interactive-control count. */
export const anchoredDisclosureEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.STEWARD_ANCHORED_DISCLOSURE?.trim().toLowerCase() !== 'off'
/** The area a dropdown, listbox or menu opened by this control occupies: just below and beside it. */
function anchorRegion(bounds: { x: number; y: number; width: number; height: number }) {
  return { x: bounds.x - 40, y: bounds.y - 10, width: Math.max(bounds.width, 320) + 80, height: bounds.height + 430 }
}
function anchoredKeys(frame: LiveComputerCapturedFrame, region: { x: number; y: number; width: number; height: number }): string[] {
  // Option rows often carry their text as the value with an empty name (Chrome's AXStaticText for role=option).
  const text = (e: LiveComputerElement) => norm(e.name) || (typeof e.value === 'string' ? norm(e.value) : '')
  const keys = frame.elements.filter(e => e.bounds && e.bounds.width > 0 && e.bounds.height > 0 && !e.sensitive && text(e)
    && e.bounds.x < region.x + region.width && e.bounds.x + e.bounds.width > region.x && e.bounds.y < region.y + region.height && e.bounds.y + e.bounds.height > region.y)
    .map(e => `${roleKey(e.role)}|${text(e)}`)
  return [...new Set(keys)]
}
const interactiveCount = (frame: LiveComputerCapturedFrame) => frame.elements.filter(e => e.enabled !== false && /button|link|menuitem|checkbox|radio|textfield|textarea|combobox|popup/u.test(roleKey(e.role))).length

/** A click whose purpose is to go somewhere: a link, or a directional navigation button (Next, Older…). */
function navigatingTarget(element: LiveComputerElement, frame: LiveComputerCapturedFrame): boolean {
  if (element.sensitive || element.enabled === false) return false
  const role = roleKey(element.role)
  if (role === 'axlink' || role === 'link') return true
  return /button/u.test(role) && isNavigationControl(element, frame.elements)
}

/**
 * The effects a compiled program intends, judged later on their own targets.
 * Signatures are kind + role + normalized name (+ text): refs and fingerprints
 * churn between captures (the Find field went c9bc65b94 → c0ec94172), so a
 * repeat is recognized by what was acted on. A navigate or submit is only the
 * program's last input: anything after it would act on a page that changed.
 */
export function intendedEffects(actions: readonly ComputerActionProposal[], targets: ReadonlyArray<LiveComputerElement | null>, frame: LiveComputerCapturedFrame): IntendedEffect[] {
  const before = effectSnapshot(frame)
  const effects: IntendedEffect[] = []
  const last = actions.length - 1
  const lastAction = actions[last]
  // Enter as the program's last input, into the field it targets or the focused one.
  const enterField = lastAction?.kind === 'keypress' && lastAction.keys.length === 1 && lastAction.keys[0] === 'ENTER'
    ? (targets[last] ?? frame.elements.find(e => e.focused === true && isEditable(e)) ?? null) : null
  const submitField = enterField && siteLookupField(enterField) ? enterField : null
  actions.forEach((action, index) => {
    const target = targets[index]
    if (action.kind === 'type' && target && liveComputerElementSupportsTextEntry(target) && !target.sensitive && action.text.trim()) {
      const text = action.text.normalize('NFKC').replace(/\s+/gu, ' ').trim()
      effects.push({ kind: 'value', signature: `value|${roleKey(target.role)}|${norm(target.name)}|${norm(text)}`, label: label(target), before,
        field: { role: target.role, name: target.name ?? '', fingerprint: target.fingerprint ?? null }, text, lookup: siteLookupField(target),
        submitted: Boolean(submitField && submitField === target) })
    }
  })
  if (lastAction?.kind === 'click' && targets[last] && (navigatingTarget(targets[last]!, frame) || disclosureTarget(targets[last]!))) {
    const target = targets[last]!
    const disclosure = !navigatingTarget(target, frame)
    effects.push({ kind: 'navigate', signature: `navigate|${roleKey(target.role)}|${norm(target.name)}`, label: label(target), before,
      target: { role: target.role, name: target.name ?? '', fingerprint: target.fingerprint ?? null, expanded: target.expanded ?? null },
      ...(disclosure ? { disclosure: true, controls: interactiveCount(frame),
        ...(target.bounds && anchoredDisclosureEnabled() ? { anchor: { region: anchorRegion(target.bounds), before: anchoredKeys(frame, anchorRegion(target.bounds)) } } : {}) } : {}) })
  }
  if (submitField) effects.push({ kind: 'submit', signature: `submit|${roleKey(submitField.role)}|${norm(submitField.name)}`, label: label(submitField), before, field: { role: submitField.role, name: submitField.name ?? '' } })
  return effects
}

/** Whether the effect's own input is among the confirmed deliveries since the program's mark. A withheld or refused
 * input is owned by the rejection path and never judged here. */
export function effectInputDelivered(effect: IntendedEffect, delivered: readonly SelectedWindowInputLedgerEntry[]): boolean {
  const confirmed = delivered.filter(entry => entry.delivery !== 'uncertain')
  if (effect.kind === 'value') return confirmed.some(entry => entry.kind === 'type')
  if (effect.kind === 'submit') return confirmed.some(entry => entry.kind === 'keypress' && entry.chord === 'enter')
  return confirmed.some(entry => (entry.kind === 'click' || entry.kind === 'element_action') && entry.role === effect.target.role
    && norm(entry.label) === norm(effect.target.name))
}

/** Page content that changed materially: more than 30% of the visible lines are new, or at least five are. */
function contentChanged(before: EffectSnapshot, after: EffectSnapshot): boolean {
  const seen = new Set(before.lines)
  const fresh = after.lines.filter(line => !seen.has(line)).length
  return fresh >= 5 || (after.lines.length > 0 && fresh >= 2 && fresh / after.lines.length > 0.3)
}

function newDialog(before: EffectSnapshot, after: EffectSnapshot): boolean {
  const remaining = [...before.dialogs]
  for (const dialog of after.dialogs) {
    const at = remaining.indexOf(dialog)
    if (at < 0) return true
    remaining.splice(at, 1)
  }
  return false
}

const place = (snapshot: EffectSnapshot) => snapshot.url ? `same address ${snapshot.url}` : 'same page'

/**
 * The effect judged on the frame after the program. `unknown` (never counted)
 * when the page became a boundary (a human-verification or sign-in page is a
 * limit, not a no-op) or stopped being readable. A value effect is never
 * `unmet`: a field may legitimately reformat its input (phone numbers, dates),
 * and readback can lag one capture.
 */
export function checkEffect(effect: IntendedEffect, frame: LiveComputerCapturedFrame): { status: EffectStatus; finding: string | null } {
  const after = effectSnapshot(frame)
  if (effect.before.readable && !after.readable) return { status: 'unknown', finding: null }
  if (detectPageBoundary({ title: after.title ?? '', documents: [{ text: after.lines.join('\n'), main: true }] })) return { status: 'unknown', finding: null }
  const moved = after.sourceKey !== effect.before.sourceKey || (after.title ?? '') !== (effect.before.title ?? '')
  if (effect.kind === 'value') {
    const candidates = frame.elements.filter(e => !e.sensitive && e.role === effect.field.role && norm(e.name) === norm(effect.field.name))
    const field = (effect.field.fingerprint ? candidates.find(e => e.fingerprint === effect.field.fingerprint) : undefined) ?? (candidates.length === 1 ? candidates[0] : undefined)
    if (!field || field.valueComplete === false || typeof field.value !== 'string') return { status: 'unknown', finding: null }
    if (norm(field.value) !== norm(effect.text)) return { status: 'unknown', finding: null }
    const finding = effect.lookup && !effect.submitted && !moved
      ? `Controller readback: "${effect.label}" now holds "${effect.text.slice(0, 120)}". Nothing has been submitted (${place(after)}); if the results you need are not shown yet, run the search with {"navigation":{"kind":"keypress","key":"ENTER","deltaY":null,"text":null,"ref":null}}, or click a visible search button or suggestion. Do not fill it again.`
      : null
    return { status: 'met', finding }
  }
  if (effect.kind === 'navigate' && effect.disclosure) {
    // A menu opens: the button expands, a dialog or menu appears, the page moves, or new controls appear. Rotating
    // page content (a live "top lookups" list, an ad) is not an opened menu.
    const target = frame.elements.find(e => effect.target.fingerprint && e.fingerprint === effect.target.fingerprint)
      ?? frame.elements.find(e => e.role === effect.target.role && norm(e.name) === norm(effect.target.name))
    if (moved || newDialog(effect.before, after) || (target && (target.expanded ?? null) !== effect.target.expanded) || interactiveCount(frame) >= (effect.controls ?? Infinity) + 3) return { status: 'met', finding: null }
    // A custom dropdown or listbox opens right under its control without flipping `expanded` or adding many buttons
    // (in one run every Country/State/City click opened its list, yet four were judged "did nothing" and the run
    // stopped). New named elements where that popup renders are an opened menu; changes elsewhere on the page are not.
    if (effect.anchor && anchoredDisclosureEnabled()) {
      const seen = new Set(effect.anchor.before)
      if (anchoredKeys(frame, effect.anchor.region).filter(key => !seen.has(key)).length >= 2) return { status: 'met', finding: null }
    }
    return { status: 'unmet', finding: `Controller observation: clicking "${effect.label}" did not open anything (it is still collapsed, no menu or new controls appeared). It may open on hover or need a different control. Do not click it again: use another visible route to what you need (a link, the site's search), or report what is established and what stops you.` }
  }
  if (moved || newDialog(effect.before, after) || contentChanged(effect.before, after)) return { status: 'met', finding: null }
  if (effect.kind === 'navigate') {
    const target = frame.elements.find(e => effect.target.fingerprint && e.fingerprint === effect.target.fingerprint)
      ?? frame.elements.find(e => e.role === effect.target.role && norm(e.name) === norm(effect.target.name))
    if (target && (target.expanded ?? null) !== effect.target.expanded) return { status: 'met', finding: null }
    return { status: 'unmet', finding: `Controller observation: clicking "${effect.label}" did not change this window (${place(after)} and title, same content). It may open in another tab or window, or do nothing here. Do not click it again: open the destination with navigate when the page shows its address (for example a result's displayed URL), use a different control or route, or report what is established.` }
  }
  return { status: 'unmet', finding: `Controller observation: pressing Enter in "${effect.label}" did not run a search (${place(after)}, title and results unchanged). Do not press Enter there again: click a visible search button or suggestion, or use a different route.` }
}

/** Bookkeeping of unmet effects across a run: consecutive unmet tries per signature, and unmet navigate/submit effects
 * since the last met effect (the ineffective-action stop). */
export class EffectLedger {
  readonly unmetBySignature = new Map<string, number>()
  unmetSinceProgress = 0
  reset(): void { this.unmetBySignature.clear(); this.unmetSinceProgress = 0 }
  /** Records the judged effects and returns the finding to show the actor, if any (the last one wins). */
  record(results: ReadonlyArray<{ effect: IntendedEffect; status: EffectStatus; finding: string | null }>): string {
    let finding = ''
    for (const { effect, status, finding: text } of results) {
      if (status === 'met') { this.unmetBySignature.delete(effect.signature); this.unmetSinceProgress = 0 }
      if (status === 'unmet') { this.unmetBySignature.set(effect.signature, (this.unmetBySignature.get(effect.signature) ?? 0) + 1); this.unmetSinceProgress += 1 }
      if (text) finding = text
    }
    return finding
  }
  /** An effect this program intends that already failed twice: refused before a third try. */
  repeated(effects: readonly IntendedEffect[]): { effect: IntendedEffect; tries: number } | null {
    for (const effect of effects) {
      const tries = this.unmetBySignature.get(effect.signature) ?? 0
      if (tries >= 2) return { effect, tries }
    }
    return null
  }
}

export function repeatedEffectRefusal(repeat: { effect: IntendedEffect; tries: number }): string {
  const what = repeat.effect.kind === 'submit' ? `Enter in "${repeat.effect.label}"` : `"${repeat.effect.label}"`
  return `${what} was tried ${repeat.tries} times with no effect on this window. Do not repeat it: use a different control or route (a visible address with navigate, the site's own search), or report what is established and what is not.`
}
