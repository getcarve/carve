import { useEffect, useRef } from 'react'
import { invoke } from './api.js'

// Renderer evidence is observational only; it never authorizes the plan.
export function PlanVisibility({ sessionId, planHash }: { sessionId: string; planHash: string }) {
  const marker = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const element = marker.current?.parentElement
    if (!element) return
    let intersecting = false
    let visible = false
    let delivery = Promise.resolve()
    const report = (next: boolean) => {
      if (next === visible) return
      visible = next
      delivery = delivery.then(async () => {
        await invoke({ kind: 'computer.session.plan.visibility', sessionId, planHash, visible: next })
      }).catch(() => { /* Telemetry must never block review or approval. */ })
    }
    const update = () => report(intersecting && document.visibilityState === 'visible')
    const observer = new IntersectionObserver(entries => {
      intersecting = entries.some(entry => entry.isIntersecting)
      update()
    })
    observer.observe(element)
    document.addEventListener('visibilitychange', update)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', update)
      report(false)
    }
  }, [sessionId, planHash])
  return <span ref={marker} hidden aria-hidden="true" />
}
