import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ShieldCheck } from 'lucide-react'
import { approvalOptions, approvalPreference, type ApprovalPreset } from '../../src/approval-preference'
import type { AssistanceState } from '../../src/conversation-interaction'
import { invoke } from './api'

export function ApprovalControl({ state, disabled = false, refresh, onError }: {
  state: AssistanceState; disabled?: boolean; refresh: () => Promise<void>; onError: (message: string) => void
}) {
  const ref = useRef<HTMLDetailsElement>(null)
  const [pending, setPending] = useState(false)
  const locked = disabled || pending || state.active || state.preparing || ['reading', 'thinking'].includes(state.guide.state)
  const selected = approvalOptions.find(option => option.value === approvalPreference(state.approvalPreset))!
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) ref.current?.removeAttribute('open') }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && ref.current?.open) { ref.current.open = false; ref.current.querySelector('summary')?.focus() } }
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  }, [])
  useEffect(() => { if (locked) ref.current?.removeAttribute('open') }, [locked])
  const choose = async (preset: ApprovalPreset) => {
    setPending(true)
    try { await invoke({ kind: 'computer.assistance.approvals', preset, conversationId: state.conversationId, revision: state.revision, commandId: crypto.randomUUID() }); ref.current?.removeAttribute('open') }
    catch (error) { onError(error instanceof Error ? error.message : String(error)) }
    finally { setPending(false); await refresh() }
  }
  return <div className="approval-setting"><details className="approval-control" ref={ref} onToggle={() => {
    const element = ref.current
    if (element?.open) element.dataset.side = element.getBoundingClientRect().top >= (element.querySelector('.approval-control__menu')?.getBoundingClientRect().height ?? 300) + 12 ? 'above' : 'below'
  }}>
    <summary aria-label={`Approvals: ${selected.label}`} aria-disabled={locked} onClick={event => { if (locked) event.preventDefault() }}><ShieldCheck size={14} /><span>{selected.label}</span><ChevronDown size={13} /></summary>
    <div className="approval-control__menu"><strong>When should Carve ask?</strong><div role="group" aria-label="Approval mode">{approvalOptions.map(option => <button type="button" key={option.value} aria-pressed={selected.value === option.value} disabled={locked} onClick={() => void choose(option.value)}><span><strong>{option.label}</strong><small>{option.description}</small></span>{selected.value === option.value ? <Check size={15} /> : null}</button>)}</div><p>Applies to your next task, in both views.</p></div>
  </details><span className="approval-setting__hint">{state.active || state.preparing ? 'Fixed for this task' : 'Approvals'}</span></div>
}
