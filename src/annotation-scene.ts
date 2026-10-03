import { randomUUID } from 'node:crypto'
import { annotationStyle, annotationStyleSchema, styleAnnotations, type AnnotationStyle } from './annotation-style.js'
import { resolveGuideAnnotations, type GuideAnnotation, type AnnotationPoint } from './guide-annotations.js'

export interface AnnotationScene {
  version: 2
  id: string
  revision: number
  frameSha256: string
  objects: GuideAnnotation[]
  canUndo: boolean
  canRedo?: boolean
  checkpoints?: { id: string; name: string }[]
}
export interface DrawingEdit {
  sceneId: string
  revision: number
  action: 'style' | 'undo' | 'redo' | 'lock' | 'remove' | 'transform' | 'draw' | 'checkpoint' | 'restore'
  objectId?: string
  scope?: 'object' | 'group'
  style?: AnnotationStyle
  locked?: boolean
  transform?: { dx: number; dy: number; scaleX: number; scaleY: number }
  stroke?: { shape: 'path' | 'region'; points: AnnotationPoint[]; label: string }
  checkpointId?: string
  name?: string
}
export function parseDrawingEdit(value: unknown): DrawingEdit | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.sceneId !== 'string' || !v.sceneId || v.sceneId.length > 100 || !Number.isSafeInteger(v.revision) || Number(v.revision) < 0) return null
  const base = { sceneId: v.sceneId, revision: Number(v.revision) }
  if (v.action === 'undo' || v.action === 'redo') return { ...base, action: v.action }
  if (v.action === 'checkpoint' && typeof v.name === 'string' && v.name.trim().length > 0 && v.name.length <= 40 && ![...v.name].some(c => c.charCodeAt(0) < 32)) return { ...base, action: 'checkpoint', name: v.name.trim() }
  if (v.action === 'restore' && typeof v.checkpointId === 'string' && v.checkpointId.length > 0 && v.checkpointId.length <= 100) return { ...base, action: 'restore', checkpointId: v.checkpointId }
  if (v.action === 'draw') {
    const stroke = v.stroke as DrawingEdit['stroke']
    if (!stroke || !['path', 'region'].includes(stroke.shape) || typeof stroke.label !== 'string' || !stroke.label.trim() || stroke.label.length > 64 || !Array.isArray(stroke.points) || stroke.points.length < (stroke.shape === 'region' ? 3 : 2) || stroke.points.length > 64 || !stroke.points.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.y >= 0)) return null
    if (v.objectId !== undefined && (typeof v.objectId !== 'string' || !v.objectId || v.objectId.length > 100)) return null
    return { ...base, action: 'draw', stroke: { shape: stroke.shape, label: stroke.label.trim(), points: stroke.points.map(p => ({ x: p.x, y: p.y })) }, ...(typeof v.objectId === 'string' ? { objectId: v.objectId } : {}) }
  }
  if (typeof v.objectId !== 'string' || !v.objectId || v.objectId.length > 100 || !['object', 'group'].includes(String(v.scope))) return null
  const selected = { ...base, objectId: v.objectId, scope: v.scope as 'object' | 'group' }
  if (v.action === 'lock' && typeof v.locked === 'boolean') return { ...selected, action: 'lock', locked: v.locked }
  if (v.action === 'remove') return { ...selected, action: 'remove' }
  if (v.action === 'transform') {
    const t = v.transform as DrawingEdit['transform']
    if (!t || ![t.dx, t.dy, t.scaleX, t.scaleY].every(Number.isFinite) || t.scaleX < .05 || t.scaleY < .05 || t.scaleX > 20 || t.scaleY > 20) return null
    return { ...selected, action: 'transform', transform: { dx: t.dx, dy: t.dy, scaleX: t.scaleX, scaleY: t.scaleY } }
  }
  if (v.action !== 'style' || !v.style) return null
  const style = annotationStyle(v.style)
  if (JSON.stringify(style) !== JSON.stringify(Object.fromEntries(Object.keys(style).map(k => [k, (v.style as Record<string, unknown>)[k]])))) return null
  return { ...selected, action: 'style', style }

}
export const drawingSchema = {
  type: ['object', 'null'], additionalProperties: false,
  required: ['action', 'sceneId', 'baseRevision', 'removeIds', 'styles'],
  properties: {
    action: { type: 'string', enum: ['replace', 'patch', 'keep', 'undo', 'redo'] },
    sceneId: { type: ['string', 'null'] }, baseRevision: { type: ['integer', 'null'] },
    removeIds: { type: 'array', maxItems: 8, items: { type: 'string' } },
    styles: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['objectId', 'scope', 'style'], properties: { objectId: { type: 'string' }, scope: { type: 'string', enum: ['object', 'group'] }, style: annotationStyleSchema } } },
  },
} as const

/** One ephemeral scene per selected-window conversation. Atomic, bounded revisions. */
export class AnnotationSceneStore {
  private value: AnnotationScene | null = null
  private history: GuideAnnotation[][] = []
  private future: GuideAnnotation[][] = []
  private checkpoints: { id: string; name: string; objects: GuideAnnotation[] }[] = []
  snapshot(): AnnotationScene | null { return this.value ? structuredClone(this.value) : null }
  clear(): void { this.value = null; this.history = []; this.future = []; this.checkpoints = [] }
  apply(marks: GuideAnnotation[], proposal: unknown, frameSha256: string, current: boolean): AnnotationScene {
    const p = (proposal && typeof proposal === 'object' ? proposal : {}) as Record<string, unknown>
    const action = p.action ?? 'replace'
    if (!['replace', 'patch', 'keep', 'undo', 'redo'].includes(String(action))) throw new Error('Unsupported drawing edit.')
    const before = this.value
    if (action !== 'replace' || p.sceneId != null) {
      if (!before || p.sceneId !== before.id || p.baseRevision !== before.revision) throw new Error('The drawing changed. Please try that edit again.')
    }
    if (action !== 'replace' && !current) throw new Error('The view changed. Ask Carve to redraw the marks before editing them.')
    if (action === 'undo' || action === 'redo') return this.edit({ sceneId: before!.id, revision: before!.revision, action }, frameSha256)
    const existing = before?.objects ?? []
    const ids = new Set<string>()
    let nextNumber = Math.max(0, ...existing.map(m => m.number ?? 0))
    const incoming: GuideAnnotation[] = marks.map(mark => {
      const reference = mark.referenceId
      if (reference && (!existing.some(m => m.id === reference) || ids.has(reference))) throw new Error('A drawing object could not be identified uniquely.')
      if (reference) ids.add(reference)
      const old = existing.find(m => m.id === reference)
      const style = mark.style ? { ...mark.style, color: mark.style.color === 'auto' ? old?.style?.color ?? 'auto' : mark.style.color, line: mark.style.line === 'auto' ? old?.style?.line ?? 'auto' : mark.style.line, fill: mark.style.fill === 'auto' ? old?.style?.fill ?? 'auto' : mark.style.fill } : old?.style
      return { ...mark, id: old?.id ?? randomUUID(), number: old?.number ?? ++nextNumber, referenceId: undefined,
        group: mark.group || old?.group || '', style, ...(old?.locked ? { locked: true } : {}), ...(old?.author ? { author: old.author } : {}) }
    })
    let objects: GuideAnnotation[] = action === 'replace' ? incoming : structuredClone(existing)
    const removeIds = Array.isArray(p.removeIds) ? p.removeIds : []
    if (removeIds.length > 8 || removeIds.some(id => typeof id !== 'string' || !existing.some(m => m.id === id) || ids.has(id))) throw new Error('Invalid drawing removal.')
    if (action === 'patch') {
      objects = objects.filter(m => !removeIds.includes(m.id))
      for (const mark of incoming) {
        const index = objects.findIndex(m => m.id === mark.id)
        if (index < 0) objects.push(mark)
        else objects[index] = mark
      }
    } else if (action === 'keep' && (incoming.length || removeIds.length)) throw new Error('A keep operation cannot change geometry.')
    const styles = Array.isArray(p.styles) ? p.styles : []
    if (styles.length > 8) throw new Error('Too many style edits.')
    for (const raw of styles) {
      const v = raw as Record<string, unknown>
      const edit = parseDrawingEdit({ sceneId: before?.id ?? 'new', revision: before?.revision ?? 0, action: 'style', ...v })
      if (!edit) throw new Error('Invalid drawing style.')
      objects = this.withStyle(objects, edit)
    }
    if (objects.length > 8 || objects.reduce((n, m) => n + m.points.length + m.rings.flat().length, 0) > 256) throw new Error('The drawing has too many points or objects. Simplify it first.')
    objects = styleAnnotations(objects, existing)
    if (current) this.assertLocks(existing, objects)
    const changed = JSON.stringify(objects) !== JSON.stringify(existing)
    if (!current) { this.history = []; this.future = []; this.checkpoints = [] }
    if (changed) this.future = []
    if (before && current && changed) this.history = [...this.history, structuredClone(existing)].slice(-10)
    this.value = { version: 2, id: before?.id ?? randomUUID(), revision: (before?.revision ?? 0) + 1, frameSha256, objects, canUndo: this.history.length > 0, canRedo: this.future.length > 0, checkpoints: this.checkpoints.map(({ id, name }) => ({ id, name })) }
    return this.snapshot()!
  }
  edit(input: DrawingEdit, frameSha256?: string, frame?: { width: number; height: number }): AnnotationScene {
    const edit = parseDrawingEdit(input)
    if (!edit) throw new Error('Invalid drawing edit.')
    const before = this.value
    if (!before || edit.sceneId !== before.id || edit.revision !== before.revision) throw new Error('The drawing changed. Use its current controls.')
    let objects = structuredClone(before.objects)
    // Work on copies: a rejected operation must not change history or saved alternatives.
    let history = [...this.history], future = [...this.future]
    const checkpoints = [...this.checkpoints]
    if (edit.action === 'undo' || edit.action === 'redo') {
      const source = edit.action === 'undo' ? history : future
      if (!source.length) throw new Error(`There is no drawing change to ${edit.action}.`)
      objects = structuredClone(source.at(-1)!)
      if (edit.action === 'undo') { history = history.slice(0, -1); future = [...future, before.objects].slice(-10) }
      else { future = future.slice(0, -1); history = [...history, before.objects].slice(-10) }
    } else if (edit.action === 'checkpoint') {
      if (checkpoints.length >= 3) throw new Error('Three alternatives are already saved. Start a new drawing to save more.')
      if (checkpoints.some(c => c.name === edit.name)) throw new Error('Choose a different name for this alternative.')
      checkpoints.push({ id: randomUUID(), name: edit.name!, objects: structuredClone(objects) })
    } else {
      if (edit.action === 'restore') {
        const saved = checkpoints.find(c => c.id === edit.checkpointId)
        if (!saved) throw new Error('That saved alternative is no longer available.')
        objects = structuredClone(saved.objects)
      } else if (edit.action === 'draw') {
        if (!frame || !edit.stroke) throw new Error('The drawing needs a current view.')
        const old = edit.objectId ? objects.find(m => m.id === edit.objectId) : undefined
        if (edit.objectId && !old) throw new Error('That drawing object is no longer available.')
        const stroke = edit.stroke
        const resolved = resolveGuideAnnotations([{ shape: stroke.shape, label: stroke.label, source: 'visual', certainty: 'approximate', purpose: old?.purpose ?? 'identify', elementId: null, bounds: null,
          points: stroke.shape === 'path' ? stroke.points : [], rings: stroke.shape === 'region' ? [stroke.points] : [], style: old?.style ?? annotationStyle({ color: 'orange', fill: 'none' }), group: old?.group ?? '' }], { ...frame, elements: [] })[0]
        if (!resolved) throw new Error('That stroke cannot form a valid mark. Draw a larger, non-crossing boundary or use the pen.')
        const mark: GuideAnnotation = { ...resolved, id: old?.id ?? randomUUID(), number: old?.number ?? Math.max(0, ...objects.map(m => m.number ?? 0)) + 1, author: 'user' }
        objects = old ? objects.map(m => m.id === old.id ? mark : m) : [...objects, mark]
      } else {
        const selected = objects.find(m => m.id === edit.objectId)
        if (!selected) throw new Error('That drawing object is no longer available.')
        const matches = (m: GuideAnnotation) => m.id === selected.id || Boolean(edit.scope === 'group' && selected.group && m.group === selected.group)
        if (edit.action === 'lock') objects = objects.map(m => matches(m) ? { ...m, locked: edit.locked! } : m)
        else if (edit.action === 'remove') objects = objects.filter(m => !matches(m))
        else if (edit.action === 'style') objects = this.withStyle(objects, edit)
        else if (edit.action === 'transform') {
          if (!frame || !edit.transform) throw new Error('The drawing needs a current view.')
          const t = edit.transform, members = objects.filter(matches)
          const x = Math.min(...members.map(m => m.bounds.x)), y = Math.min(...members.map(m => m.bounds.y))
          const transform = (p: AnnotationPoint) => ({ x: x + (p.x - x) * t.scaleX + t.dx, y: y + (p.y - y) * t.scaleY + t.dy })
          objects = objects.map(m => matches(m) ? { ...m, bounds: { ...transform(m.bounds), width: m.bounds.width * t.scaleX, height: m.bounds.height * t.scaleY },
            points: m.points.map(transform), rings: m.rings.map(r => r.map(transform)), source: 'visual', elementId: null, certainty: 'approximate', author: 'user' } : m)
        }
      }
      if (edit.action !== 'lock') this.assertLocks(before.objects, objects)
      if (frame) for (const m of objects) {
        const b = m.bounds
        if (![b.x, b.y, b.width, b.height].every(Number.isFinite) || b.x < 0 || b.y < 0 || b.width < 0 || b.height < 0 || b.x + b.width > frame.width || b.y + b.height > frame.height) throw new Error('Keep the drawing inside the selected window.')
      }
      if (objects.length > 8 || objects.reduce((n, m) => n + m.points.length + m.rings.flat().length, 0) > 256) throw new Error('The drawing has too many points or objects. Simplify it first.')
      objects = styleAnnotations(objects, before.objects)
      if (edit.action !== 'lock') this.assertLocks(before.objects, objects)
      history = [...history, structuredClone(before.objects)].slice(-10)
      future = []
    }
    this.history = history; this.future = future; this.checkpoints = checkpoints
    this.value = { ...before, revision: before.revision + 1, frameSha256: frameSha256 ?? before.frameSha256, objects,
      canUndo: history.length > 0, canRedo: future.length > 0, checkpoints: checkpoints.map(({ id, name }) => ({ id, name })) }
    return this.snapshot()!
  }
  private assertLocks(before: GuideAnnotation[], after: GuideAnnotation[]): void {
    for (const old of before.filter(m => m.locked)) {
      if (JSON.stringify(old) !== JSON.stringify(after.find(m => m.id === old.id))) throw new Error(`Unlock “${old.label}” before changing it.`)
    }
  }
  private withStyle(objects: GuideAnnotation[], edit: DrawingEdit): GuideAnnotation[] {
    const selected = objects.find(m => m.id === edit.objectId)
    if (!selected || !edit.style) throw new Error('That drawing object is no longer available.')
    return objects.map(m => m.id === selected.id || (edit.scope === 'group' && selected.group && m.group === selected.group) ? { ...m, style: { ...edit.style! } } : m)
  }
}
