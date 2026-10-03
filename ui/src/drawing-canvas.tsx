import { useRef, useState } from 'react'
import { annotationPalette } from '../../src/annotation-style'
import type { AnnotationScene, DrawingEdit } from '../../src/annotation-scene'
import type { AnnotationPoint } from '../../src/guide-annotations'

export type DrawingTool = 'select' | 'pen' | 'region' | 'correct'
/** Local schematic view; the compact overlay provides the actual app background. */
export function DrawingCanvas({ scene, size, selected, select, disabled, edit }: {
  scene: AnnotationScene; size: { width: number; height: number }; selected: string; select: (id: string) => void; disabled: boolean; edit: (edit: DrawingEdit) => void
}) {
  const [tool, setTool] = useState<DrawingTool>('select')
  const [preview, setPreview] = useState<AnnotationPoint[]>([])
  const gesture = useRef<{ start: AnnotationPoint; points: AnnotationPoint[]; id?: string; resize: boolean; revision: number } | null>(null)
  const mark = scene.objects.find(m => m.id === selected)
  const point = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: Math.max(0, Math.min(size.width, (e.clientX - r.left) / r.width * size.width)), y: Math.max(0, Math.min(size.height, (e.clientY - r.top) / r.height * size.height)) }
  }
  const commit = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current; gesture.current = null; setPreview([])
    if (!g || disabled || scene.revision !== g.revision) return
    const p = point(e)
    const base = { sceneId: scene.id, revision: g.revision }
    if (tool === 'select' && g.id) {
      const object = scene.objects.find(m => m.id === g.id)
      if (!object || object.locked) return
      const dx = p.x - g.start.x, dy = p.y - g.start.y
      if (Math.abs(dx) + Math.abs(dy) < 1) return
      edit({ ...base, action: 'transform', objectId: g.id, scope: 'object', transform: { dx: g.resize ? 0 : dx, dy: g.resize ? 0 : dy, scaleX: g.resize ? Math.max(.05, (object.bounds.width + dx) / Math.max(1, object.bounds.width)) : 1, scaleY: g.resize ? Math.max(.05, (object.bounds.height + dy) / Math.max(1, object.bounds.height)) : 1 } })
    } else if (tool !== 'select' && g.points.length >= (tool === 'pen' ? 2 : 3)) {
      const points = g.points.filter((_, i) => i === 0 || i === g.points.length - 1 || i % Math.ceil(g.points.length / 62) === 0)
      edit({ ...base, action: 'draw', stroke: { shape: tool === 'pen' ? 'path' : 'region', points, label: tool === 'correct' ? mark?.label ?? 'Boundary' : `Selection ${Math.max(0, ...scene.objects.map(m => m.number ?? 0)) + 1}` }, ...(tool === 'correct' && mark ? { objectId: mark.id } : {}) })
    }
  }
  return <div className="drawing-canvas">
    <div role="group" aria-label="Drawing tools">{(['select', 'pen', 'region', 'correct'] as const).map(value => <button type="button" key={value} aria-pressed={tool === value} disabled={disabled || value === 'correct' && (!mark || mark.locked)} onClick={() => { setTool(value); gesture.current = null; setPreview([]) }}>{({ select: 'Move / resize', pen: 'Pen', region: 'Circle an area', correct: 'Replace boundary' })[value]}</button>)}</div>
    <p>Drawing layout preview · Use Compact view to draw over the app. Drag a mark to move it; drag its corner to resize. Escape cancels a gesture.</p>
    <svg role="img" aria-label="Editable drawing layout" tabIndex={0} viewBox={`0 0 ${size.width} ${size.height}`} style={{ aspectRatio: `${size.width}/${size.height}`, touchAction: 'none' }}
      onKeyDown={e => { if (e.key === 'Escape') { gesture.current = null; setPreview([]) } }}
      onPointerDown={e => {
        if (disabled || e.button !== 0) return
        const p = point(e), node = (e.target as Element).closest('[data-object]'), id = node?.getAttribute('data-object') ?? undefined
        if (id) select(id)
        if (tool === 'select' && (!id || scene.objects.find(m => m.id === id)?.locked)) return
        if (tool === 'correct' && (!mark || mark.locked)) return
        e.currentTarget.setPointerCapture(e.pointerId)
        gesture.current = { start: p, points: [p], ...(id ? { id } : {}), resize: (e.target as Element).getAttribute('data-resize') === 'true', revision: scene.revision }
        setPreview([p])
      }} onPointerMove={e => {
        const g = gesture.current; if (!g) return
        const p = point(e)
        if (g.points.length >= 512) g.points = g.points.filter((_, i) => i % 2 === 0)
        g.points.push(p); setPreview([...g.points])
      }} onPointerUp={commit} onPointerCancel={() => { gesture.current = null; setPreview([]) }} onLostPointerCapture={() => { gesture.current = null; setPreview([]) }}>
      {scene.objects.map(m => {
        const g = gesture.current, last = preview.at(-1), moving = tool === 'select' && g?.id === m.id && last
        const dx = moving && !g.resize ? last.x - g.start.x : 0, dy = moving && !g.resize ? last.y - g.start.y : 0
        const sx = moving && g.resize ? Math.max(.05, (m.bounds.width + last.x - g.start.x) / Math.max(1, m.bounds.width)) : 1
        const sy = moving && g.resize ? Math.max(.05, (m.bounds.height + last.y - g.start.y) / Math.max(1, m.bounds.height)) : 1
        const b = m.bounds, stroke = annotationPalette[m.renderStyle?.color ?? 'purple'].light
        const paths = m.shape === 'region' ? m.rings : m.shape === 'path' ? [m.points] : []
        return <g key={m.id} data-object={m.id} transform={`translate(${b.x + dx} ${b.y + dy}) scale(${sx} ${sy}) translate(${-b.x} ${-b.y})`} stroke={stroke} fill="none" strokeWidth={3}>
          {paths.length ? <path d={paths.map(r => r.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ') + (m.shape === 'region' ? ' Z' : '')).join(' ')} fill={m.shape === 'region' ? stroke : 'none'} fillOpacity={.12} fillRule="evenodd" /> : m.shape === 'circle' ? <ellipse cx={b.x + b.width / 2} cy={b.y + b.height / 2} rx={b.width / 2} ry={b.height / 2} /> : <rect {...b} />}
          <rect {...b} fill="transparent" strokeDasharray="5 5" strokeOpacity={selected === m.id ? 1 : 0} />
          <text x={b.x} y={Math.max(16, b.y - 8)} fill={stroke} stroke="none" fontSize={18}>{m.number}. {m.label}{m.locked ? ' · Locked' : ''}</text>
          {selected === m.id && !m.locked ? <rect data-resize="true" x={b.x + b.width - 7} y={b.y + b.height - 7} width={14} height={14} fill={stroke} /> : null}
        </g>
      })}
      {tool !== 'select' && preview.length ? <polyline points={preview.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#e79e47" strokeWidth={3} /> : null}
    </svg>
  </div>
}
