import type { LiveComputerElement } from '../types.js'
import { sha256, stableJson } from '../util.js'

/** Preserve meaning, geometry, values and actionability. Capture-local IDs and
 * traversal order are not identity; pointer hover/focus and popup membership
 * do not change a keyboard receiver. Occlusion is checked separately per input. */
export function receiverStateDigest(element: LiveComputerElement, pointer: boolean): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Omit capture-only metadata from receiver identity.
  const { id: _id, depth: _depth, pointerObstructions: _occlusion, focused, containsFocus, ...state } = element
  return sha256(stableJson({ ...state, ...(!pointer ? { focused, containsFocus } : {}),
    actions: element.actions?.toSorted(), settableAttributes: element.settableAttributes?.toSorted() }))
}

/** The part of a receiver that says which control it is, without the state an
 * edit changes. Value, caret/selection, placeholder, focus and geometry are left
 * out: typing changes the first four, and a code editor's hidden input moves
 * with its caret. The capture fingerprint is left out too, because it hashes
 * sibling indices: an advertisement inserted above a form renumbered every
 * field's ancestor chain between hold and dispatch (convertcase and JSONLint,
 * 27 September: the same text area, same label, discarded as a changed
 * binding). Tree depth stands in for the path's shape, and the number of
 * controls sharing this identity is included, so a duplicate appearing is a
 * change. Null when the control has no label or identifier to be known by. */
export function receiverIdentityDigest(element: LiveComputerElement, elements: readonly LiveComputerElement[]): string | null {
  const key = (candidate: LiveComputerElement) => stableJson({ role: candidate.role, subrole: candidate.subrole ?? null, name: candidate.name ?? '',
    description: candidate.description ?? null, help: candidate.help ?? null, identifier: candidate.identifier ?? null })
  if (element.sensitive || !(element.name?.trim() || element.identifier?.trim() || element.description?.trim())) return null
  const own = key(element)
  const sharing = elements.filter(candidate => !candidate.sensitive && key(candidate) === own).length
  return sha256(stableJson({ identity: own, sharing, depth: element.axPath?.length ?? element.depth ?? null, axRoot: element.axRoot ?? null,
    editable: element.editable ?? null, enabled: element.enabled ?? null, actions: element.actions?.toSorted() ?? null, settableAttributes: element.settableAttributes?.toSorted() ?? null }))
}
