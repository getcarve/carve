/* Shared by the sandboxed renderer and main process. No DOM or input access. */
(() => {
  const framePresence = (value) => {
    if (!value || value.frameVisible === false) return 'selected'
    if (value.decision || value.planApproval || value.guidance || value.budgetCheckpoint || value.failure || value.workConsent) return 'attention'
    if (value.phase === 'paused' || value.steeringPaused || value.theme === 'paused') return 'paused'
    if (value.theme === 'attention') return 'attention'
    // Guide and launch/planning are not execution authority. Their activity
    // belongs in the capsule, never in the animated window boundary.
    if (['guide', 'ask', 'launch'].includes(value.mode)) return 'selected'
    if (value.theme === 'complete') return 'complete'
    if (value.phase === 'waiting') return 'attention'
    if (value.health === 'stopped' || value.phase === 'ended') return 'selected'
    if (value.phase === 'acting') return 'working'
    if (['preparing', 'observing', 'deciding', 'verifying', 'recovering', 'settling'].includes(value.phase)) return 'thinking'
    return 'selected'
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { framePresence }
  else globalThis.carveWindowPresence = { framePresence }
})()
