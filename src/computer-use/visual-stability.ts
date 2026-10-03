export type VisibleStateChange = 'changed' | 'unchanged' | 'unknown'

export interface VisibleStateFingerprint {
  sha256?: string | null
  visualSample?: string | null
}

export interface VisibleStateCompareOptions {
  /**
   * `coarse` (default) answers "has the screen stopped moving": it ignores
   * caret blinks, hover highlights and small animations so settling can finish.
   * `fine` answers "did the batch do anything": a compact, strongly changed
   * region — a revealed panel, a switched tab, one new line of text — counts
   * as progress even though it moves few samples. Telling the model such a
   * batch made no progress invites a repeat, which undoes toggles.
   */
  sensitivity?: 'coarse' | 'fine'
}

/** Strong per-sample delta and the fraction of samples that must show it
 * before a localized change counts as progress. At a 96×64 sample of a
 * 1280×900 frame, 0.4% is about 25 samples: a short text line, not a caret. */
const FINE_STRONG_DELTA = 24
const FINE_STRONG_FRACTION = 0.004

/**
 * Compares two controller-owned frames without interpreting their UI. Coarse
 * grayscale samples ignore tiny animation/caret noise; an exact content hash
 * is the conservative fallback when a sample is unavailable.
 */
/** Two point-neighbourhood samples describe the same control state when they differ only by a caret blink,
 * a hover highlight or antialiasing; an overlay, a navigation or a moved control reads as changed. Strings that
 * are not samples of equal length fall back to exact equality. */
export function visualStateEquivalent(before: string | null | undefined, after: string | null | undefined): boolean {
  if (!before || !after) return before === after
  if (before === after) return true
  const a = Buffer.from(before, 'base64'), b = Buffer.from(after, 'base64')
  if (a.length < 64 || a.length !== b.length || a.toString('base64') !== before || b.toString('base64') !== after) return false
  return compareVisibleState(null, before, { visualSample: after, sha256: null }, { sensitivity: 'fine' }) === 'unchanged'
}

export function compareVisibleState(
  previousSha: string | null | undefined,
  previousSample: string | null | undefined,
  next: VisibleStateFingerprint,
  options: VisibleStateCompareOptions = {},
): VisibleStateChange {
  if (previousSample && next.visualSample) {
    const before = Buffer.from(previousSample, 'base64')
    const after = Buffer.from(next.visualSample, 'base64')
    if (before.length === after.length && before.length > 0) {
      let difference = 0
      let changed = 0
      let strong = 0
      for (let index = 0; index < before.length; index += 1) {
        const delta = Math.abs(before[index]! - after[index]!)
        difference += delta
        if (delta >= 6) changed += 1
        if (delta >= FINE_STRONG_DELTA) strong += 1
      }
      if (difference / before.length >= 2 || changed / before.length >= 0.08) return 'changed'
      if (options.sensitivity === 'fine' && strong / before.length >= FINE_STRONG_FRACTION) return 'changed'
      return 'unchanged'
    }
  }
  if (!previousSha || !next.sha256) return 'unknown'
  return previousSha === next.sha256 ? 'unchanged' : 'changed'
}

/**
 * Did a batch make progress? The control digest is authoritative when both
 * observations carry one: it sees a switched tab or one changed line that a
 * coarse pixel sample misses, and ignores hover highlights the sample might
 * count. Otherwise fall back to the fine pixel comparison.
 */
export function observationProgress(
  before: VisibleStateFingerprint & { elementDigest?: string | null },
  after: VisibleStateFingerprint & { elementDigest?: string | null },
): VisibleStateChange {
  if (before.elementDigest && after.elementDigest) {
    if (before.elementDigest !== after.elementDigest) return 'changed'
    // Same controls: a pure visual change (a chart, an image) still counts.
    return compareVisibleState(before.sha256, before.visualSample, after, { sensitivity: 'fine' })
  }
  return compareVisibleState(before.sha256, before.visualSample, after, { sensitivity: 'fine' })
}

export function visiblyChanged(
  previousSha: string | null | undefined,
  previousSample: string | null | undefined,
  next: VisibleStateFingerprint,
): boolean {
  return compareVisibleState(previousSha, previousSample, next) === 'changed'
}

export interface SampleRegion { x: number; y: number; width: number; height: number }

/**
 * Change inside one neighborhood of a grayscale sample, judged the way a
 * locator library judges stability: on the target, not the page. `region`
 * and `masks` are in frame coordinates; the sample is `sampleWidth` by
 * `sampleHeight` bytes for a frame of `frameWidth` by `frameHeight`. Masked
 * areas (video, canvas) never count as change.
 */
export function regionChange(
  previousSample: string | null | undefined,
  nextSample: string | null | undefined,
  sample: { width: number; height: number },
  frame: { width: number; height: number },
  region: SampleRegion,
  masks: SampleRegion[] = [],
): { comparable: boolean; changed: boolean; ratio: number; pixels: number } {
  if (!previousSample || !nextSample) return { comparable: false, changed: false, ratio: 0, pixels: 0 }
  const before = Buffer.from(previousSample, 'base64')
  const after = Buffer.from(nextSample, 'base64')
  if (before.length !== after.length || before.length !== sample.width * sample.height || frame.width <= 0 || frame.height <= 0) {
    return { comparable: false, changed: false, ratio: 0, pixels: 0 }
  }
  const scaleX = sample.width / frame.width
  const scaleY = sample.height / frame.height
  const left = Math.max(0, Math.floor(region.x * scaleX))
  const top = Math.max(0, Math.floor(region.y * scaleY))
  const right = Math.min(sample.width, Math.ceil((region.x + region.width) * scaleX))
  const bottom = Math.min(sample.height, Math.ceil((region.y + region.height) * scaleY))
  const masked = masks.map(mask => ({
    left: Math.floor(mask.x * scaleX), top: Math.floor(mask.y * scaleY),
    right: Math.ceil((mask.x + mask.width) * scaleX), bottom: Math.ceil((mask.y + mask.height) * scaleY),
  }))
  let pixels = 0
  let changed = 0
  let difference = 0
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      if (masked.some(mask => x >= mask.left && x < mask.right && y >= mask.top && y < mask.bottom)) continue
      const index = y * sample.width + x
      const delta = Math.abs(before[index]! - after[index]!)
      pixels += 1
      difference += delta
      if (delta >= 6) changed += 1
    }
  }
  if (pixels === 0) return { comparable: false, changed: false, ratio: 0, pixels: 0 }
  const ratio = changed / pixels
  return { comparable: true, changed: difference / pixels >= 2 || ratio >= 0.08, ratio, pixels }
}

/** A square neighborhood around a point, padded so a small control's
 * surroundings count too, clamped to the frame. */
export function pointRegion(point: { x: number; y: number }, frame: { width: number; height: number }, radius = 40): SampleRegion {
  const x = Math.max(0, point.x - radius)
  const y = Math.max(0, point.y - radius)
  return { x, y, width: Math.min(frame.width, point.x + radius) - x, height: Math.min(frame.height, point.y + radius) - y }
}
