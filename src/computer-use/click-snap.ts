/** Snap a click that lands just outside exactly one labelled control.
 *
 * The largest single cause of blocked live sessions is the controller
 * withholding a batch: 15 of 26 blocked sessions in the 14–17 September audit,
 * and `control_geometry_invalid` and `no_control_at_point` are the classes
 * where the actor named the right control and missed its box by a few pixels.
 * The actor works from pixels, the controller judges by the accessibility
 * tree, and nothing reconciles the two except another model turn.
 *
 * This is the deterministic half of hybrid grounding, and it costs no model
 * call. It is deliberately timid: it moves a point only when the point is
 * outside every control, exactly one labelled and actionable control lies
 * within the tolerance, and nothing else is a near miss. A point that is
 * ambiguous, or near a sensitive, disabled or covered control, is left exactly
 * where the actor put it and refused as before. Snapping never changes which
 * control is acted on — there is only ever one candidate — so it cannot turn a
 * refusal into a different action than the one the actor proposed.
 */
import type { LiveComputerElement } from '../types.js'
import { clickEffectResolvable, labeledInteractiveControl } from './effects.js'

export interface SnappedClick {
  /** The point to execute instead, inside the control's box. */
  readonly point: { x: number; y: number }
  readonly elementId: string
  readonly label: string
  /** How far the proposed point was from the control's box, in frame pixels. */
  readonly distance: number
}

type Bounds = NonNullable<LiveComputerElement['bounds']>

const contains = (bounds: Bounds, point: { x: number; y: number }): boolean =>
  point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height

/** Distance from a point to the nearest place inside the box; 0 when inside. */
function distanceToBounds(bounds: Bounds, point: { x: number; y: number }): number {
  const dx = Math.max(bounds.x - point.x, 0, point.x - (bounds.x + bounds.width))
  const dy = Math.max(bounds.y - point.y, 0, point.y - (bounds.y + bounds.height))
  return Math.hypot(dx, dy)
}

/** The point inside the box closest to where the actor aimed, nudged one pixel
 * clear of the edge. Aiming at the edge is evidence about which part of the
 * control the actor meant; the centre is not always the same thing (a long
 * row, a wide tab strip), so the aim is preserved on the other axis. */
function nearestInteriorPoint(bounds: Bounds, point: { x: number; y: number }): { x: number; y: number } {
  const inset = (low: number, size: number, value: number) => {
    const pad = Math.min(1, size / 4)
    return Math.min(Math.max(value, low + pad), low + size - pad)
  }
  return { x: inset(bounds.x, bounds.width, point.x), y: inset(bounds.y, bounds.height, point.y) }
}

export interface SnapOptions {
  /** Maximum miss, in frame pixels, that may be repaired. 0 disables snapping. */
  readonly tolerance: number
  /** Controls larger than this share of the frame are layout, not targets. */
  readonly maximumAreaShare?: number
  readonly frame?: { width: number; height: number }
}

/**
 * Returns the repaired point, or null when the proposal must stand as made.
 * Null is the answer whenever anything is unclear — that is the design.
 */
export function snapClickPoint(
  point: { x: number; y: number },
  elements: readonly LiveComputerElement[],
  options: SnapOptions,
): SnappedClick | null {
  if (!(options.tolerance > 0) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null
  // A point already inside any control is the actor's own binding. Never move it.
  if (elements.some(element => element.bounds && contains(element.bounds, point))) return null

  const frameArea = options.frame ? options.frame.width * options.frame.height : 0
  const maximumArea = frameArea > 0 ? frameArea * (options.maximumAreaShare ?? 0.25) : Infinity

  const near = elements
    .filter(element => element.bounds && element.bounds.width > 0 && element.bounds.height > 0)
    .map(element => ({ element, distance: distanceToBounds(element.bounds!, point) }))
    .filter(candidate => candidate.distance <= options.tolerance)

  // A near miss on anything we must not touch is a reason to refuse, not to
  // look for a different answer: the actor may well have been aiming at it.
  if (near.some(candidate => candidate.element.sensitive || candidate.element.obstructed || candidate.element.enabled === false)) return null

  const usable = near.filter(candidate =>
    labeledInteractiveControl(candidate.element)
    && clickEffectResolvable(candidate.element)
    && !candidate.element.pointerObstructions?.length
    && candidate.element.bounds!.width * candidate.element.bounds!.height <= maximumArea)
  if (usable.length !== 1) return null

  // One usable candidate is not enough on its own: another control of any kind
  // sitting just as close means the aim was ambiguous.
  const chosen = usable[0]!
  if (near.some(candidate => candidate.element.id !== chosen.element.id && candidate.distance <= chosen.distance)) return null

  const label = (chosen.element.name ?? chosen.element.description ?? '').trim()
  if (!label) return null
  return { point: nearestInteriorPoint(chosen.element.bounds!, point), elementId: chosen.element.id, label, distance: chosen.distance }
}
