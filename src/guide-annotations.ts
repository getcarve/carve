import { annotationStyle, annotationStyleSchema, type AnnotationStyle, type AnnotationRenderStyle } from './annotation-style.js'
import type { LiveComputerCapturedFrame } from './live-computer.js'
import { looksLikePromptInjection } from './privacy.js'

export interface AnnotationPoint { x: number; y: number }
export interface AnnotationBounds { x: number; y: number; width: number; height: number }
export type AnnotationShape = 'point' | 'outline' | 'circle' | 'arrow' | 'region' | 'path'
export interface GuideAnnotation {
  id: string
  locked?: boolean
  author?: 'user'
  number?: number
  referenceId?: string | undefined
  group?: string
  style?: AnnotationStyle | undefined
  renderStyle?: AnnotationRenderStyle
  shape: AnnotationShape
  label: string
  source: 'element' | 'visual'
  certainty: 'located' | 'approximate'
  purpose: 'identify' | 'propose'
  elementId: string | null
  bounds: AnnotationBounds
  /** Paths are open; regions contain one or more closed rings (even-odd fill). */
  points: AnnotationPoint[]
  rings: AnnotationPoint[][]
  tone: 'light' | 'dark' | 'mixed'
}

const pointSchema = { type: 'object', additionalProperties: false, required: ['x', 'y'], properties: { x: { type: 'number' }, y: { type: 'number' } } } as const
export const guideAnnotationsSchema = {
  type: 'array', maxItems: 8,
  items: {
    type: 'object', additionalProperties: false,
    required: ['shape', 'label', 'source', 'certainty', 'purpose', 'elementId', 'bounds', 'points', 'rings', 'referenceId', 'group', 'style'],
    properties: {
      referenceId: { type: ['string', 'null'] }, group: { type: ['string', 'null'] }, style: annotationStyleSchema,
      shape: { type: 'string', enum: ['point', 'outline', 'circle', 'arrow', 'region', 'path'] },
      label: { type: 'string' }, source: { type: 'string', enum: ['element', 'visual'] },
      certainty: { type: 'string', enum: ['located', 'approximate'] },
      purpose: { type: 'string', enum: ['identify', 'propose'] },
      elementId: { type: ['string', 'null'] },
      bounds: { type: ['object', 'null'], additionalProperties: false, required: ['x', 'y', 'width', 'height'], properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } } },
      points: { type: 'array', maxItems: 64, items: pointSchema },
      rings: { type: 'array', maxItems: 8, items: { type: 'array', maxItems: 64, items: pointSchema } },
    },
  },
} as const

type Frame = Pick<LiveComputerCapturedFrame, 'width' | 'height' | 'elements' | 'localizedVisualSample' | 'annotationColorSample'>
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v))
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
export function validAnnotationBounds(v: unknown, frame: Pick<Frame, 'width' | 'height'>): v is AnnotationBounds {
  return object(v) && finite(v.x) && finite(v.y) && finite(v.width) && finite(v.height) && v.x >= 0 && v.y >= 0 && v.width > 0 && v.height > 0 && v.x + v.width <= frame.width && v.y + v.height <= frame.height
}
function points(value: unknown, frame: Frame, min: number): AnnotationPoint[] | null {
  if (!Array.isArray(value) || value.length < min || value.length > 64) return null
  if (!value.every(p => object(p) && finite(p.x) && finite(p.y) && p.x >= 0 && p.y >= 0 && p.x <= frame.width && p.y <= frame.height)) return null
  const parsed = value.map(p => ({ x: p.x as number, y: p.y as number }))
  if (min === 3 && parsed.length > 3 && parsed[0]!.x === parsed.at(-1)!.x && parsed[0]!.y === parsed.at(-1)!.y) parsed.pop()
  return parsed
}
function boundsOf(p: AnnotationPoint[]): AnnotationBounds {
  const xs = p.map(p => p.x), ys = p.map(p => p.y)
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}
function validRing(ring: AnnotationPoint[]): boolean {
  const cross = (a: AnnotationPoint, b: AnnotationPoint, c: AnnotationPoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  const area = ring.reduce((sum, a, i) => { const b = ring[(i + 1) % ring.length]!; return sum + a.x * b.y - b.x * a.y }, 0)
  if (Math.abs(area) < 8) return false
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!
    if (a.x === b.x && a.y === b.y) return false
    for (let j = i + 2; j < ring.length; j++) {
      if (i === 0 && j === ring.length - 1) continue
      const c = ring[j]!, d = ring[(j + 1) % ring.length]!
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return false
    }
  }
  return true
}

/** Conservative local sampling improves palette selection; dual neutral edges
 * are retained because a coarse grayscale sample cannot prove pixel contrast. */
export function annotationTone(frame: Frame, bounds: AnnotationBounds, contours: AnnotationPoint[][] = []): GuideAnnotation['tone'] {
  const rgb = Buffer.from(frame.annotationColorSample ?? '', 'base64')
  const useColor = rgb.length === 192 * 128 * 4
  const bytes = Buffer.from(frame.localizedVisualSample ?? '', 'base64')
  if (!useColor && bytes.length !== 96 * 64) return 'mixed'
  const sw = useColor ? 192 : 96, sh = useColor ? 128 : 64
  const linear = (v: number) => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4 }
  const values: number[] = []
  const edges = contours.length ? contours : [[
    { x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height }, { x: bounds.x, y: bounds.y + bounds.height },
  ]]
  for (const contour of edges) for (let edge = 0; edge < contour.length; edge++) {
    const a = contour[edge]!, b = contour[(edge + 1) % contour.length]!
    const steps = Math.max(8, Math.ceil(Math.hypot((b.x - a.x) / frame.width * sw, (b.y - a.y) / frame.height * sh)))
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t
      const ix = Math.max(0, Math.min(sw - 1, Math.floor(x / frame.width * sw)))
      const iy = Math.max(0, Math.min(sh - 1, Math.floor(y / frame.height * sh)))
      if (useColor) {
        const offset = (iy * sw + ix) * 4
        values.push((.2126 * linear(rgb[offset]!) + .7152 * linear(rgb[offset + 1]!) + .0722 * linear(rgb[offset + 2]!)) * 255)
      } else values.push(bytes[iy * 96 + ix]!)
    }
  }
  values.sort((a, b) => a - b)
  if (values[Math.floor(values.length * .1)]! > (useColor ? 140 : 170)) return 'light'
  if (values[Math.floor(values.length * .9)]! < (useColor ? 36 : 100)) return 'dark'
  return 'mixed'
}

/** Accept geometry, never executable drawing code or model-selected CSS. An
 * accessible element remains the only source of exact control bounds. */
export function resolveGuideAnnotations(value: unknown, frame: Frame): GuideAnnotation[] {
  if (!Array.isArray(value) || value.length > 8) return []
  const result: GuideAnnotation[] = []
  let vertices = 0
  for (const candidate of value) {
    if (!object(candidate) || typeof candidate.label !== 'string' || looksLikePromptInjection(candidate.label)) continue
    const shape = candidate.shape as AnnotationShape
    if (!['point', 'outline', 'circle', 'arrow', 'region', 'path'].includes(shape)) continue
    if (!['element', 'visual'].includes(String(candidate.source)) || !['located', 'approximate'].includes(String(candidate.certainty)) || !['identify', 'propose'].includes(String(candidate.purpose))) continue
    let bounds: AnnotationBounds | null = null
    let path: AnnotationPoint[] = [], rings: AnnotationPoint[][] = []
    let elementId: string | null = null
    // eslint-disable-next-line no-control-regex
    let label = candidate.label.replace(/[\u0000-\u001f\u007f]/gu, '').replace(/\s+/gu, ' ').trim().slice(0, 64)
    if (candidate.source === 'element') {
      const element = frame.elements.find(e => e.id === candidate.elementId)
      if (!element || !validAnnotationBounds(element.bounds, frame) || ['region', 'path'].includes(shape)) continue
      bounds = { ...element.bounds }; elementId = element.id
      if (element.sensitive) label = 'Control'
      else label ||= element.name.slice(0, 64)
    } else if (shape === 'path' || shape === 'region') {
      if (shape === 'path') {
        const parsed = points(candidate.points, frame, 2)
        if (!parsed) continue
        path = parsed
      } else {
        if (!Array.isArray(candidate.rings) || !candidate.rings.length || candidate.rings.length > 8) continue
        const parsed = candidate.rings.map(r => points(r, frame, 3))
        if (parsed.some(r => !r || !validRing(r))) continue
        rings = parsed as AnnotationPoint[][]
      }
      const all = shape === 'path' ? path : rings.flat()
      vertices += all.length
      if (vertices > 256) break
      bounds = boundsOf(all)
      if (bounds.width < 1 && bounds.height < 1) continue
    } else if (validAnnotationBounds(candidate.bounds, frame)) bounds = { ...candidate.bounds }
    if (!bounds) continue
    result.push({ id: `annotation-${result.length + 1}`, referenceId: typeof candidate.referenceId === 'string' ? candidate.referenceId.slice(0, 100) : undefined, group: typeof candidate.group === 'string' && !looksLikePromptInjection(candidate.group) ? candidate.group.replace(/\s+/gu, ' ').trim().slice(0, 64) : '', ...(candidate.style ? { style: annotationStyle(candidate.style) } : {}), shape, label: label || (shape === 'region' ? 'Region' : 'Here'), source: candidate.source as GuideAnnotation['source'], certainty: candidate.certainty as GuideAnnotation['certainty'], purpose: candidate.purpose as GuideAnnotation['purpose'], elementId, bounds, points: path, rings, tone: annotationTone(frame, bounds, rings.length ? rings : path.length ? [path] : []) })
  }
  return result
}

/** Compare only annotated neighborhoods; unrelated clocks/cursors do not
 * retire a region. Samples stay private to GuideService and never reach UI. */
export function annotationSceneChanged(before: LiveComputerCapturedFrame, after: LiveComputerCapturedFrame, annotations: GuideAnnotation[]): boolean {
  if (before.width !== after.width || before.height !== after.height) return true
  if (before.sha256 === after.sha256) return false
  const a = Buffer.from(before.localizedVisualSample ?? '', 'base64'), b = Buffer.from(after.localizedVisualSample ?? '', 'base64')
  if (a.length !== 6144 || b.length !== 6144) return true
  return annotations.some(annotation => {
    const r = annotation.bounds
    const x0 = Math.max(0, Math.floor(r.x / before.width * 96) - 2), x1 = Math.min(95, Math.ceil((r.x + r.width) / before.width * 96) + 2)
    const y0 = Math.max(0, Math.floor(r.y / before.height * 64) - 2), y1 = Math.min(63, Math.ceil((r.y + r.height) / before.height * 64) + 2)
    let changed = 0, count = 0
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { count++; if (Math.abs(a[y * 96 + x]! - b[y * 96 + x]!) > 20) changed++ }
    return changed / count > .06
  })
}
