/**
 * Observation policy: what pixels a computer-use turn actually sends.
 *
 * Image tokens are pure pixel area on the current OpenAI models
 * (ceil(w/32) × ceil(h/32) × 1.2), so the frame Carve sends is the largest
 * per-turn cost once the prompt prefix is cached. This module decides, per
 * turn, between the full frame, a downscaled frame, a thumbnail when the
 * screen did not change, and a foveated pair (small overview plus one
 * full-resolution crop of the region that matters). Everything here is
 * controller-owned: the local frame, its accessibility elements and its
 * coordinates stay at 1× logical points; only the outgoing image changes,
 * and provider coordinates are mapped back before any input.
 *
 * See docs/screenshot-cost-plan-2026-09-12.md for the measurements.
 */
import { PNG } from 'pngjs'

export interface ObservationPolicy {
  /** Widest frame sent as the actionable screenshot; null sends the frame as captured. */
  sendWidth: number | null
  /** When the coarse comparison saw no change, send an overview plus a full-resolution
   * crop around the last input instead of another full frame. A menu, a dialog or a
   * typed cell is a localized change the coarse sample misses; the crop shows it. */
  unchangedCrop: boolean
  /** Send a small overview plus one full-resolution crop instead of one large frame.
   * Off by default: on September 12 the 800-wide overview made the model misclick dense
   * toolbars and re-enter text it could not verify (Sheets 0/2, the user's own runs), while
   * the plain 1280 downscale kept the baseline's behaviour turn for turn. */
  foveate: boolean
  /** Width of the overview when foveating. */
  overviewWidth: number
  /** Size of the full-resolution crop, in frame points. */
  crop: { width: number; height: number }
  /** Reading tasks keep the frame as captured. Off by default: at 1280 wide, exact quotes
   * from Python docs, MDN and Wikipedia survived the September 12 measurement, so reading
   * tasks take the downscale but never the foveated overview, whose 800-wide body text is too small to read. */
  fullResolutionForReading: boolean
  /** Start a fresh provider chain after this many turns so cached history stays bounded; null never re-anchors. */
  reAnchorEveryTurns: number | null
}

export const defaultObservationPolicy: ObservationPolicy = {
  sendWidth: 1280,
  unchangedCrop: true,
  foveate: false,
  overviewWidth: 800,
  crop: { width: 640, height: 400 },
  fullResolutionForReading: false,
  // A count-only execution receipt cannot replace the visual history. A native
  // save run lost its verified destination after the tenth turn and falsely
  // reported partial completion. Keep history until evidence-preserving
  // compaction exists; the approved token/turn envelope still bounds the run.
  reAnchorEveryTurns: null,
}

/** Reads overrides from the environment so a local build can switch strategies without a rebuild. */
export function observationPolicyFromEnvironment(env: NodeJS.ProcessEnv = process.env, base: ObservationPolicy = defaultObservationPolicy): ObservationPolicy {
  const flag = (value: string | undefined, fallback: boolean) => value === undefined || value === '' ? fallback : value === '1' || value === 'true'
  const int = (value: string | undefined, fallback: number | null) => {
    if (value === undefined || value === '') return fallback
    if (value === 'off' || value === '0') return null
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }
  return {
    sendWidth: int(env.STEWARD_OBSERVATION_SEND_WIDTH, base.sendWidth),
    unchangedCrop: flag(env.STEWARD_OBSERVATION_UNCHANGED_CROP ?? env.STEWARD_OBSERVATION_UNCHANGED_THUMBNAIL, base.unchangedCrop),
    foveate: flag(env.STEWARD_OBSERVATION_FOVEATE, base.foveate),
    overviewWidth: int(env.STEWARD_OBSERVATION_OVERVIEW_WIDTH, base.overviewWidth) ?? base.overviewWidth,
    crop: base.crop,
    fullResolutionForReading: flag(env.STEWARD_OBSERVATION_FULL_RES_READING, base.fullResolutionForReading),
    reAnchorEveryTurns: int(env.STEWARD_OBSERVATION_REANCHOR_TURNS, base.reAnchorEveryTurns),
  }
}

/** OpenAI's documented accounting for GPT-5.2+ and GPT-6 images; measured exact on gpt-5.6-sol. */
export function estimateImageTokens(width: number, height: number): number {
  return Math.ceil(Math.ceil(width / 32) * Math.ceil(height / 32) * 1.2)
}

export interface EncodedImage { dataUrl: string; width: number; height: number }
export interface Region { x: number; y: number; width: number; height: number }

const pngPrefix = 'data:image/png;base64,'

function decodePng(dataUrl: string): PNG {
  if (!dataUrl.startsWith(pngPrefix)) throw new Error('Observation images must be PNG data URLs')
  return PNG.sync.read(Buffer.from(dataUrl.slice(pngPrefix.length), 'base64'))
}

function encodePng(png: PNG): EncodedImage {
  return { dataUrl: pngPrefix + PNG.sync.write(png).toString('base64'), width: png.width, height: png.height }
}

/** Box-filter downscale; every source pixel contributes, so thin lines and small text keep their weight. */
export function resizePng(dataUrl: string, targetWidth: number): EncodedImage {
  const source = decodePng(dataUrl)
  if (targetWidth >= source.width) return { dataUrl, width: source.width, height: source.height }
  const scale = targetWidth / source.width
  const targetHeight = Math.max(1, Math.round(source.height * scale))
  const out = new PNG({ width: targetWidth, height: targetHeight })
  const sw = source.width, sh = source.height, src = source.data, dst = out.data
  for (let ty = 0; ty < targetHeight; ty += 1) {
    const y0 = Math.floor(ty / scale), y1 = Math.min(sh, Math.max(y0 + 1, Math.floor((ty + 1) / scale)))
    for (let tx = 0; tx < targetWidth; tx += 1) {
      const x0 = Math.floor(tx / scale), x1 = Math.min(sw, Math.max(x0 + 1, Math.floor((tx + 1) / scale)))
      let r = 0, g = 0, b = 0, a = 0, n = 0
      for (let y = y0; y < y1; y += 1) {
        let index = (y * sw + x0) * 4
        for (let x = x0; x < x1; x += 1, index += 4) { r += src[index]!; g += src[index + 1]!; b += src[index + 2]!; a += src[index + 3]!; n += 1 }
      }
      const o = (ty * targetWidth + tx) * 4
      dst[o] = Math.round(r / n); dst[o + 1] = Math.round(g / n); dst[o + 2] = Math.round(b / n); dst[o + 3] = Math.round(a / n)
    }
  }
  return encodePng(out)
}

/** Full-resolution crop; the region is clamped to the frame. */
export function cropPng(dataUrl: string, region: Region): EncodedImage & { region: Region } {
  const source = decodePng(dataUrl)
  const clamped = clampRegion(region, source)
  const out = new PNG({ width: clamped.width, height: clamped.height })
  for (let y = 0; y < clamped.height; y += 1) {
    const from = ((clamped.y + y) * source.width + clamped.x) * 4
    source.data.copy(out.data, y * clamped.width * 4, from, from + clamped.width * 4)
  }
  return { ...encodePng(out), region: clamped }
}

/** One image, two parts: the overview on top, a divider, then the full-resolution
 * crop left-aligned beneath it. The provider's computer tool accepts exactly one
 * image per continuation, so the crop rides inside the screenshot; only the top
 * part is a coordinate space. */
export function compositePng(overview: EncodedImage, crop: EncodedImage, divider = 6): EncodedImage & { actionable: { width: number; height: number } } {
  const top = decodePng(overview.dataUrl)
  const bottom = decodePng(crop.dataUrl)
  const width = Math.max(top.width, bottom.width)
  const height = top.height + divider + bottom.height
  const out = new PNG({ width, height })
  out.data.fill(128)
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255
  for (let y = 0; y < top.height; y += 1) top.data.copy(out.data, y * width * 4, y * top.width * 4, (y + 1) * top.width * 4)
  for (let y = 0; y < divider; y += 1) { const row = (top.height + y) * width * 4; for (let x = 0; x < width; x += 1) { out.data[row + x * 4] = 40; out.data[row + x * 4 + 1] = 40; out.data[row + x * 4 + 2] = 40 } }
  for (let y = 0; y < bottom.height; y += 1) bottom.data.copy(out.data, (top.height + divider + y) * width * 4, y * bottom.width * 4, (y + 1) * bottom.width * 4)
  return { ...encodePng(out), actionable: { width: top.width, height: top.height } }
}

export function clampRegion(region: Region, frame: { width: number; height: number }): Region {
  const width = Math.max(1, Math.min(Math.round(region.width), frame.width))
  const height = Math.max(1, Math.min(Math.round(region.height), frame.height))
  const x = Math.max(0, Math.min(Math.round(region.x), frame.width - width))
  const y = Math.max(0, Math.min(Math.round(region.y), frame.height - height))
  return { x, y, width, height }
}

/** A crop-sized region centred on a point, kept inside the frame. */
export function regionAround(center: { x: number; y: number }, size: { width: number; height: number }, frame: { width: number; height: number }): Region {
  return clampRegion({ x: center.x - size.width / 2, y: center.y - size.height / 2, width: size.width, height: size.height }, frame)
}

/**
 * Bounding box, in frame points, of the cells whose grayscale sample changed
 * between two observations. Null when nothing changed or the samples cannot
 * be compared. The samples are the controller's coarse 96×64 fingerprints.
 */
export function changedRegion(
  previousSample: string | null | undefined,
  nextSample: string | null | undefined,
  sample: { width: number; height: number },
  frame: { width: number; height: number },
  threshold = 12,
): Region | null {
  if (!previousSample || !nextSample) return null
  const before = Buffer.from(previousSample, 'base64')
  const after = Buffer.from(nextSample, 'base64')
  if (before.length !== after.length || before.length !== sample.width * sample.height) return null
  let left = sample.width, top = sample.height, right = -1, bottom = -1, changed = 0
  for (let y = 0; y < sample.height; y += 1) {
    for (let x = 0; x < sample.width; x += 1) {
      const index = y * sample.width + x
      if (Math.abs(before[index]! - after[index]!) < threshold) continue
      changed += 1
      if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y
    }
  }
  if (right < 0 || changed < 2) return null
  const cellW = frame.width / sample.width, cellH = frame.height / sample.height
  return clampRegion({ x: left * cellW, y: top * cellH, width: (right - left + 1) * cellW, height: (bottom - top + 1) * cellH }, frame)
}

export interface CropChoiceInput {
  frame: { width: number; height: number }
  previousSample?: string | null
  currentSample?: string | null
  sampleSize?: { width: number; height: number }
  focusedBounds?: Region | null
  lastActionPoint?: { x: number; y: number } | null
  cropSize: { width: number; height: number }
  /** Look around the last input before the focused control: a menu or dialog opens where the click landed. */
  preferLastAction?: boolean
}

/**
 * Where to spend full resolution: on what just changed, else on the focused
 * control, else around the last input. A change larger than the crop is
 * centred; a change smaller than it is padded to the crop size so the model
 * sees the surroundings too.
 */
export function chooseCropRegion(input: CropChoiceInput): { region: Region; basis: 'change' | 'focus' | 'last_action' } | null {
  const changed = changedRegion(input.previousSample, input.currentSample, input.sampleSize ?? { width: 96, height: 64 }, input.frame)
  if (changed) {
    const center = { x: changed.x + changed.width / 2, y: changed.y + changed.height / 2 }
    const size = { width: Math.max(input.cropSize.width, changed.width), height: Math.max(input.cropSize.height, changed.height) }
    return { region: regionAround(center, size, input.frame), basis: 'change' }
  }
  const focus = () => input.focusedBounds && input.focusedBounds.width > 0 && input.focusedBounds.height > 0
    ? { region: regionAround({ x: input.focusedBounds.x + input.focusedBounds.width / 2, y: input.focusedBounds.y + input.focusedBounds.height / 2 }, input.cropSize, input.frame), basis: 'focus' as const }
    : null
  const last = () => input.lastActionPoint ? { region: regionAround(input.lastActionPoint, input.cropSize, input.frame), basis: 'last_action' as const } : null
  return (input.preferLastAction ? last() ?? focus() : focus() ?? last()) ?? null
}

export interface PreparedObservation {
  /** The screenshot the provider sees. */
  image: EncodedImage
  /** The part of the image that is a coordinate space: all of it, or the overview above a composited crop. */
  actionable: { width: number; height: number }
  /** Multiply provider coordinates by these to reach frame points. */
  scale: { x: number; y: number }
  /** Optional full-resolution crop sent beside the screenshot, never a coordinate space. */
  crop: (EncodedImage & { region: Region; basis: string }) | null
  /** One line for the runtime note explaining what was sent. */
  note: string | null
  mode: 'full' | 'downscaled' | 'foveated' | 'verify'
  imageTokens: number
}

export interface PrepareObservationInput {
  dataUrl: string
  width: number
  height: number
  policy: ObservationPolicy
  /** The screen is visually unchanged since the previous observation. */
  unchanged: boolean
  /** The active objective is reading or quoting, not acting. */
  reading: boolean
  /** True for the first observation of a chain, when the model has no earlier frame to rely on. */
  first: boolean
  cropChoice?: Omit<CropChoiceInput, 'frame' | 'cropSize'>
}

/** Decides and encodes what one turn sends. Pure; the caller owns the frame. */
export function prepareObservation(input: PrepareObservationInput): PreparedObservation {
  try {
    return prepareObservationStrict(input)
  } catch {
    // A frame this module cannot decode (a non-PNG fixture, a corrupt capture)
    // is sent as it was captured; the loop never loses a turn to image work.
    return { image: { dataUrl: input.dataUrl, width: input.width, height: input.height }, actionable: { width: input.width, height: input.height }, scale: { x: 1, y: 1 }, crop: null, note: null, mode: 'full', imageTokens: estimateImageTokens(input.width, input.height) }
  }
}

function prepareObservationStrict(input: PrepareObservationInput): PreparedObservation {
  const frame = { width: input.width, height: input.height }
  const full = (): PreparedObservation => ({
    image: { dataUrl: input.dataUrl, width: input.width, height: input.height }, actionable: { width: input.width, height: input.height }, scale: { x: 1, y: 1 }, crop: null, note: null, mode: 'full',
    imageTokens: estimateImageTokens(input.width, input.height),
  })
  const scaled = (targetWidth: number) => {
    const image = resizePng(input.dataUrl, targetWidth)
    return { image, scale: { x: input.width / image.width, y: input.height / image.height } }
  }
  // The coarse comparison saw no change. Sending less would hide exactly what the
  // model needs: the menu, dialog or typed value near its last input. A cheap
  // overview plus a full-resolution crop there lets it verify before retrying.
  if (input.policy.unchangedCrop && input.unchanged && !input.first && input.width >= input.policy.overviewWidth * 1.5) {
    const choice = input.cropChoice ? chooseCropRegion({ ...input.cropChoice, frame, cropSize: input.policy.crop, preferLastAction: true }) : null
    if (choice) {
      const { image: overview, scale } = scaled(input.policy.overviewWidth)
      const crop = cropPng(input.dataUrl, choice.region)
      const image = compositePng(overview, crop)
      return {
        image, actionable: image.actionable, scale, crop: { ...crop, basis: choice.basis }, mode: 'verify',
        imageTokens: estimateImageTokens(image.width, image.height),
        note: `- Screenshot: Carve's coarse comparison saw little visible change since the previous screenshot, so this screenshot has two parts. The top ${overview.width}×${overview.height} part is an overview of the whole ${input.width}×${input.height} window (scale ${scale.x.toFixed(3)}). Below the dark divider is a full-resolution crop of the window region x=${crop.region.x}, y=${crop.region.y}, ${crop.region.width}×${crop.region.height} (${choice.basis === 'change' ? 'where something did change' : choice.basis === 'focus' ? 'the focused control' : 'around your last input'}); check it before deciding the last input had no effect. Give coordinates in the top overview part only: y must be below ${overview.height}. The crop is not a coordinate space.`,
      }
    }
  }
  if (input.policy.fullResolutionForReading && input.reading) return full()
  // Foveation pays only when the overview is a real reduction and the
  // composite is cheaper than the plain downscaled frame would be.
  const plainWidth = input.policy.sendWidth && input.policy.sendWidth < input.width ? input.policy.sendWidth : input.width
  const plainTokens = estimateImageTokens(plainWidth, Math.round(input.height * plainWidth / input.width))
  if (input.policy.foveate && !input.first && !input.reading && input.width >= input.policy.overviewWidth * 1.5) {
    const choice = input.cropChoice ? chooseCropRegion({ ...input.cropChoice, frame, cropSize: input.policy.crop }) : null
    const overviewHeight = Math.round(input.height * input.policy.overviewWidth / input.width)
    const compositeTokens = choice ? estimateImageTokens(input.policy.overviewWidth, overviewHeight + 6 + Math.min(choice.region.height, input.height)) : Number.POSITIVE_INFINITY
    if (choice && compositeTokens < plainTokens) {
      const { image: overview, scale } = scaled(input.policy.overviewWidth)
      const crop = cropPng(input.dataUrl, choice.region)
      const image = compositePng(overview, crop)
      return {
        image, actionable: image.actionable, scale, crop: { ...crop, basis: choice.basis }, mode: 'foveated',
        imageTokens: estimateImageTokens(image.width, image.height),
        note: `- Screenshot: the screenshot has two parts. The top ${overview.width}×${overview.height} part is an overview of the whole ${input.width}×${input.height} window (scale ${scale.x.toFixed(3)}). Below the dark divider is a full-resolution crop of the window region x=${crop.region.x}, y=${crop.region.y}, ${crop.region.width}×${crop.region.height} (${choice.basis === 'change' ? 'what changed after the last input' : choice.basis === 'focus' ? 'the focused control' : 'around the last input'}); use it to read small text. Give coordinates in the top overview part only: y must be below ${overview.height}. The crop is not a coordinate space.`,
      }
    }
  }
  if (input.policy.sendWidth && input.policy.sendWidth < input.width) {
    const { image, scale } = scaled(input.policy.sendWidth)
    return {
      image, actionable: { width: image.width, height: image.height }, scale, crop: null, mode: 'downscaled', imageTokens: estimateImageTokens(image.width, image.height),
      note: `- Screenshot: the screenshot is ${image.width}×${image.height}, a scaled copy of the ${input.width}×${input.height} window. Give coordinates in the ${image.width}×${image.height} screenshot; Carve maps them to the window.`,
    }
  }
  return full()
}

type PointLike = { x: number; y: number }

/** Maps a provider proposal from screenshot space back to frame points. Identity scale returns the proposal unchanged. */
export function scaleProposal<T extends { kind: string }>(action: T, scale: { x: number; y: number }): T {
  if (scale.x === 1 && scale.y === 1) return action
  const map = (point: PointLike): PointLike => ({ x: Math.round(point.x * scale.x), y: Math.round(point.y * scale.y) })
  const anyAction = action as unknown as Record<string, unknown>
  const next: Record<string, unknown> = { ...anyAction }
  if (anyAction.point && typeof anyAction.point === 'object') next.point = map(anyAction.point as PointLike)
  if (Array.isArray(anyAction.path)) next.path = (anyAction.path as PointLike[]).map(map)
  if (typeof anyAction.deltaX === 'number') next.deltaX = Math.round((anyAction.deltaX as number) * scale.x)
  if (typeof anyAction.deltaY === 'number') next.deltaY = Math.round((anyAction.deltaY as number) * scale.y)
  return next as unknown as T
}

const readingCues = /\b(quote|read|report|summari[sz]e|compare|which|what|how (?:many|much)|find out|tell me|look up|list the|extract|describe|explain)\b/iu
const actingCues = /\b(type|enter|fill|add|create|click|open|set|change|save|write|paste|move|rename|delete|send|submit|sort|filter|upload|download|install|play|drag|select|toggle|turn (?:on|off)|apply|edit|insert|remove|check|uncheck)\b/iu

/**
 * Whether a request is about reading the window rather than changing it.
 * Reading keeps full resolution because quoting depends on legible text.
 * Interim heuristic until the compiled goal ledger's intent is threaded to
 * the loop; it errs toward acting, which is the cheaper mode.
 */
/** The request asks for something back (what, which, tell me, compare…), whether or not it also changes things. */
export function asksForInformation(goal: string): boolean {
  return readingCues.test(goal)
}

export function readingIntentFromGoal(goal: string): boolean {
  return readingCues.test(goal) && !actingCues.test(goal)
}

/** Every point a proposal carries, in the space it was given. */
export function proposalPoints(action: { kind: string }): PointLike[] {
  const anyAction = action as unknown as Record<string, unknown>
  const points: PointLike[] = []
  if (anyAction.point && typeof anyAction.point === 'object') points.push(anyAction.point as PointLike)
  if (Array.isArray(anyAction.path)) points.push(...(anyAction.path as PointLike[]))
  return points
}

/** Clamps a proposal's points into the frame so validation passes on a proposal the loop will fail deliberately. */
export function clampProposal<T extends { kind: string }>(action: T, frame: { width: number; height: number }): T {
  const clamp = (point: PointLike): PointLike => ({ x: Math.max(0, Math.min(frame.width - 1, point.x)), y: Math.max(0, Math.min(frame.height - 1, point.y)) })
  const anyAction = action as unknown as Record<string, unknown>
  const next: Record<string, unknown> = { ...anyAction }
  if (anyAction.point && typeof anyAction.point === 'object') next.point = clamp(anyAction.point as PointLike)
  if (Array.isArray(anyAction.path)) next.path = (anyAction.path as PointLike[]).map(clamp)
  return next as unknown as T
}
