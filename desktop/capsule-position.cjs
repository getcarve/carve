/* Moves only Carve's capsule. Native receives two position messages per drag;
 * pointer motion stays in the renderer and never enters the work input path. */
;(function (root) {
  function create({ document: doc, command }) {
    const win = doc.defaultView, badge = doc.getElementById('badge')
    const row = badge.querySelector('.row')
    const handle = doc.createElement('button')
    handle.id = 'capsule-drag'; handle.type = 'button'; handle.textContent = '⠿'
    handle.setAttribute('aria-label', 'Move copilot')
    handle.title = 'Drag to move · Arrow keys to adjust · Home to reset'
    row.prepend(handle)
    let state = null, drag = null, paint = null, suppressClick = false, overGrip = false
    const origin = () => state?.layout.window || { x: 0, y: 0 }
    const location = () => { const b = badge.getBoundingClientRect(), o = origin(); return { x: o.x + b.x, y: o.y + b.y } }
    const send = (phase, point, session = state?.presentation.sessionId) => { if (session) command({ kind: 'capsule_position', phase, sessionId: session, ...point }) }
    const render = () => {
      if (!drag?.started) return
      const o = origin()
      const x = Math.max(8, Math.min(drag.point.x - o.x, doc.documentElement.clientWidth - badge.offsetWidth - 8))
      const y = Math.max(8, Math.min(drag.point.y - o.y, doc.documentElement.clientHeight - badge.offsetHeight - 8))
      badge.style.left = `${x}px`; badge.style.right = 'auto'; badge.style.top = `${y}px`
    }
    const finish = (cancel = false) => {
      if (!drag) return
      const previous = drag
      if (previous.started) {
        render()
        send(cancel ? 'cancel' : 'end', location(), previous.session)
        suppressClick = true
        setTimeout(() => { suppressClick = false }, 0)
      }
      drag = null; delete badge.dataset.dragging
      if (!previous.started && previous.target === handle) handle.focus({ preventScroll: true })
      if (paint !== null) { win.cancelAnimationFrame(paint); paint = null }
      if (previous.target.hasPointerCapture?.(previous.pointerId)) previous.target.releasePointerCapture(previous.pointerId)
      command({ kind: 'pointer', engaged: badge.matches(':hover'), control: false })
    }
    const isHandle = target => target === handle || (row.contains(target) && !target.closest('button,input,select,textarea,a')) || target.id === 'restore-carve'
    badge.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !state || state.presentation.away || doc.body.dataset.drawing === 'true' || !isHandle(event.target)) return
      event.preventDefault()
      const point = location()
      drag = { session: state.presentation.sessionId, pointerId: event.pointerId, target: event.target, start: { x: event.screenX, y: event.screenY }, initial: point, point, started: false }
      event.target.setPointerCapture(event.pointerId)
      command({ kind: 'pointer', engaged: true, control: true })
    })
    badge.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.pointerId) return
      const dx = event.screenX - drag.start.x, dy = event.screenY - drag.start.y
      if (!drag.started && Math.hypot(dx, dy) < 4) return
      if (!drag.started) { drag.started = true; badge.dataset.dragging = 'true'; send('start', drag.initial) }
      drag.point = { x: drag.initial.x + dx, y: drag.initial.y + dy }
      if (paint === null) paint = win.requestAnimationFrame(() => { paint = null; render() })
    })
    badge.addEventListener('pointerup', () => finish())
    badge.addEventListener('pointercancel', () => finish(true))
    badge.addEventListener('lostpointercapture', () => finish(true))
    badge.addEventListener('click', event => { if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation() } }, true)
    win.addEventListener('blur', () => finish(true))
    doc.addEventListener('keydown', event => { if (drag && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); finish(true) } }, true)
    handle.addEventListener('keydown', event => {
      if (!state || state.presentation.away) return
      if (event.key === 'Home') { event.preventDefault(); send('reset', location()); return }
      const vector = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key]
      if (!vector) return
      event.preventDefault()
      const point = location(), step = event.shiftKey ? 80 : 20
      send('end', { x: point.x + vector[0] * step, y: point.y + vector[1] * step })
    })
    // The grip and bare title strip advertise dragging without changing the
    // behavior or hit targets of Stop, Pause, or approval buttons.
    row.addEventListener('pointermove', event => {
      const next = event.target === handle
      if (next !== overGrip) { overGrip = next; command({ kind: 'pointer', engaged: true, control: next || Boolean(drag) }) }
    })
    row.addEventListener('pointerleave', () => { overGrip = false })
    const reset = doc.createElement('button'); reset.type = 'button'; reset.id = 'capsule-position-reset'; reset.textContent = 'Reset copilot position'
    reset.addEventListener('click', () => send('reset', location()))
    doc.getElementById('capsule-options').append(reset)
    return { render, update(next) {
      if (drag && (next.presentation.sessionId !== drag.session || next.presentation.away)) finish(true)
      state = next
      handle.disabled = Boolean(next.presentation.away)
      reset.hidden = next.layout.badge.dock !== 'manual'
      render()
    } }
  }
  root.carveCapsulePosition = { create }
})(typeof globalThis === 'object' ? globalThis : this)
