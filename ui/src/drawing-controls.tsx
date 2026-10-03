import { DrawingCanvas } from './drawing-canvas'
import { ChevronDown, SlidersHorizontal, Undo2, Redo2 } from 'lucide-react'
import { useState } from 'react'
import { annotationColors, annotationFills, annotationLines, type AnnotationStyle } from '../../src/annotation-style'
import type { AnnotationScene, DrawingEdit } from '../../src/annotation-scene'

export function DrawingControls({ scene, visible, disabled, edit, frameSize }: { scene: AnnotationScene; visible: boolean; disabled: boolean; edit: (edit: DrawingEdit) => void; frameSize?: { width: number; height: number } | undefined }) {
  const [selected, setSelected] = useState('')
  const [name, setName] = useState('')
  const [scope, setScope] = useState<'group' | 'object'>('group')
  const mark = scene.objects.find(m => m.id === selected) ?? scene.objects[0]
  const style = mark?.style ?? { color: 'auto', line: 'auto', fill: 'auto', curve: 'angular' }
  const change = (key: 'color' | 'line' | 'fill', value: string) => {
    if (mark) edit({ sceneId: scene.id, revision: scene.revision, action: 'style', objectId: mark.id, scope, style: { ...style, [key]: value } as AnnotationStyle })
  }
  const locked = Boolean(mark && scene.objects.some(m => m.locked && (m.id === mark.id || scope === 'group' && mark.group && m.group === mark.group)))
  const action = (action: DrawingEdit['action'], extra: Partial<DrawingEdit> = {}) => edit({ sceneId: scene.id, revision: scene.revision, action, ...(mark ? { objectId: mark.id, scope } : {}), ...extra })
  return <details className="drawing-controls" open={scene.objects.length === 0 ? true : undefined}><summary><SlidersHorizontal size={16} /><span>Drawing<span className="drawing-controls__count">{scene.objects.length ? `${scene.objects.length} ${scene.objects.length === 1 ? 'mark' : 'marks'}` : 'Mark an area'}</span></span><ChevronDown className="drawing-controls__chevron" size={16} /></summary><div className="drawing-controls__content">
    <div className="drawing-controls__objects" role="group" aria-label="Drawing objects">{scene.objects.map((object, i) => <button type="button" key={object.id} aria-pressed={mark?.id === object.id} onClick={() => setSelected(object.id)}>
      <i style={{ background: object.renderStyle?.accent }} aria-hidden="true" />{object.number ?? i + 1}. {object.label}{object.purpose === 'propose' ? ' · Suggested' : ''}{object.certainty === 'approximate' ? ' · Approximate' : ''}{object.locked ? ' · Locked' : ''}{object.author === 'user' ? ' · Yours' : ''}
    </button>)}</div>
    <div className="drawing-controls__scope"><label>Apply changes to <select value={scope} disabled={disabled || !visible} onChange={e => setScope(e.target.value as typeof scope)}><option value="group">Group</option><option value="object">This mark</option></select></label><div className="drawing-controls__history"><button type="button" title="Undo" aria-label="Undo" disabled={disabled || !scene.canUndo} onClick={() => action('undo')}><Undo2 size={15} /></button><button type="button" title="Redo" aria-label="Redo" disabled={disabled || !scene.canRedo} onClick={() => action('redo')}><Redo2 size={15} /></button></div></div>
    <div className="drawing-controls__styles drawing-controls__appearance">{([['color', annotationColors], ['line', annotationLines], ['fill', annotationFills]] as const).map(([key, options]) => <label key={key}>{key[0]!.toUpperCase() + key.slice(1)} <select aria-label={`Drawing ${key}`} value={style[key]} disabled={disabled || !visible || !mark || locked} onChange={e => change(key, e.target.value)}>{options.map(value => <option key={value} value={value}>{value === 'auto' ? 'Automatic' : value[0]!.toUpperCase() + value.slice(1)}</option>)}</select></label>)}
    </div>
    <details className="drawing-controls__advanced"><summary>Arrange & protect</summary><div className="drawing-controls__styles">
      <button type="button" disabled={disabled || !visible || !mark} onClick={() => action('lock', { locked: !locked })}>{locked ? 'Unlock' : 'Lock'}</button>
      <button type="button" disabled={disabled || !visible || !mark || locked} onClick={() => action('remove')}>Remove</button>
      {([['←', -10, 0], ['↑', 0, -10], ['↓', 0, 10], ['→', 10, 0]] as const).map(([label, dx, dy]) => <button key={label} type="button" aria-label={`Move ${label}`} disabled={disabled || !visible || !mark || locked} onClick={() => action('transform', { transform: { dx, dy, scaleX: 1, scaleY: 1 } })}>{label}</button>)}
    </div>
    </details>
    <details className="drawing-controls__advanced"><summary>Saved versions</summary><div className="drawing-controls__styles"><input aria-label="Alternative name" maxLength={40} placeholder="Name this alternative" value={name} onChange={e => setName(e.target.value)} disabled={disabled} /><button type="button" disabled={disabled || !visible || !name.trim() || (scene.checkpoints?.length ?? 0) >= 3} onClick={() => action('checkpoint', { name: name.trim() })}>Save alternative</button>
      {scene.checkpoints?.map(c => <button type="button" key={c.id} disabled={disabled} onClick={() => action('restore', { checkpointId: c.id })}>Show {c.name}</button>)}
    </div>
    </details>
    {frameSize ? <DrawingCanvas scene={scene} size={frameSize} selected={mark?.id ?? ''} select={setSelected} disabled={disabled || !visible && scene.objects.length > 0} edit={edit} /> : null}
  </div></details>
}
