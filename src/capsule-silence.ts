/** Measures what the person saw, not what the engine did: how long the
 * capsule went without a visible change while Carve was working, and when
 * the first task-specific feedback appeared. The Sep 19 cancellation audit
 * found silence — not start time — separates cancelled runs from finished
 * ones, and the latency report cannot see silence on its own.
 *
 * Only visible content counts as a change: status copy, checklist rows, an
 * input cue, a read beat. The ticking clock does not. Time spent waiting on
 * the person is not Carve's silence and is excluded. */

export interface CapsuleVisibleState {
  /** Stable text of everything the person can read or see move. */
  signature: string
  /** Carve is doing the work (not waiting on the person, not finished). */
  working: boolean
  /** The capsule names this task (its request, window or an input), not a generic status. */
  specific: boolean
  /** The run ended: a result, a failure, or a stop. */
  terminal: boolean
  runId: string | null
  sessionId: string
}

export interface CapsuleSilenceSummary {
  runId: string | null
  sessionId: string
  startedAt: string
  firstSpecificAt: string | null
  endedAt: string
  maxSilenceMs: number
  /** Silent stretches longer than the 2 s budget in the plan. */
  silencesOver2s: number
  visibleChanges: number
  workingMs: number
}

export class CapsuleSilenceTracker {
  private current: {
    runId: string | null
    sessionId: string
    startedAt: number
    firstSpecificAt: number | null
    lastSignature: string
    lastChangeAt: number
    lastObservedAt: number
    wasWorking: boolean
    maxSilenceMs: number
    silencesOver2s: number
    inLongSilence: boolean
    visibleChanges: number
    workingMs: number
  } | null = null

  /** Returns a summary when this observation ends a run. */
  observe(state: CapsuleVisibleState, now = Date.now()): CapsuleSilenceSummary | null {
    const run = this.current
    if (!run) {
      if (!state.working) return null
      this.current = {
        runId: state.runId, sessionId: state.sessionId, startedAt: now, firstSpecificAt: state.specific ? now : null,
        lastSignature: state.signature, lastChangeAt: now, lastObservedAt: now, wasWorking: true,
        maxSilenceMs: 0, silencesOver2s: 0, inLongSilence: false, visibleChanges: 1, workingMs: 0,
      }
      return null
    }
    if (state.runId) run.runId = state.runId
    run.sessionId = state.sessionId
    if (run.wasWorking) run.workingMs += Math.max(0, now - run.lastObservedAt)
    run.lastObservedAt = now
    if (state.signature !== run.lastSignature) {
      run.lastSignature = state.signature
      run.lastChangeAt = now
      run.visibleChanges += 1
      run.inLongSilence = false
    } else if (state.working && run.wasWorking) {
      const silence = now - run.lastChangeAt
      run.maxSilenceMs = Math.max(run.maxSilenceMs, silence)
      if (silence > 2_000 && !run.inLongSilence) { run.silencesOver2s += 1; run.inLongSilence = true }
    }
    // Waiting on the person restarts the silence clock when work resumes.
    if (state.working && !run.wasWorking) { run.lastChangeAt = now; run.inLongSilence = false }
    run.wasWorking = state.working
    if (state.specific && run.firstSpecificAt === null) run.firstSpecificAt = now
    if (!state.terminal) return null
    this.current = null
    return {
      runId: run.runId, sessionId: run.sessionId,
      startedAt: new Date(run.startedAt).toISOString(),
      firstSpecificAt: run.firstSpecificAt === null ? null : new Date(run.firstSpecificAt).toISOString(),
      endedAt: new Date(now).toISOString(),
      maxSilenceMs: Math.round(run.maxSilenceMs), silencesOver2s: run.silencesOver2s,
      visibleChanges: run.visibleChanges, workingMs: Math.round(run.workingMs),
    }
  }

  /** The capsule went away mid-run (dismissed, stopped outside it). */
  abandon(now = Date.now()): CapsuleSilenceSummary | null {
    if (!this.current) return null
    const signature = this.current.lastSignature
    return this.observe({ signature, working: false, specific: false, terminal: true, runId: this.current.runId, sessionId: this.current.sessionId }, now)
  }
}

/** The parts of a capsule presentation the silence measure reads. Structural,
 * so the desktop shell and the evaluation harness (which renders no capsule
 * but builds the same presentation from the session) measure the same thing. */
export interface CapsulePresentationShape {
  label: string
  detail: string
  cueLabel?: string | null
  cueSequence?: number | null
  aimSequence?: number | null
  readKey?: string | null
  checklist?: Array<{ label: string; detail?: string | null; state: string }> | null
  theme?: string
  phase: string
  mode: string
  endedAt?: string | null
  failure?: unknown
  guide?: { state?: string } | null
  sessionId: string
  voiceContextId?: string | null
}

/** What the person can see change, for the silence measure. The clock is
 * excluded on purpose: a ticking timer is not news about the task. */
export function capsuleVisibleState(shape: CapsulePresentationShape): CapsuleVisibleState {
  const terminal = shape.theme === 'complete' || Boolean(shape.endedAt) || Boolean(shape.failure) || shape.mode === 'result' || shape.mode === 'failure'
  const working = !terminal && ['preparing', 'observing', 'deciding', 'acting', 'verifying', 'recovering', 'settling'].includes(shape.phase)
    && shape.theme !== 'paused' && shape.theme !== 'attention' && (shape.mode !== 'guide' || shape.guide?.state === 'thinking' || shape.guide?.state === 'reading')
  return {
    signature: JSON.stringify([shape.label, shape.detail, shape.cueLabel, shape.cueSequence, shape.aimSequence, shape.readKey,
      (shape.checklist ?? []).map(item => [item.label, item.detail, item.state])]),
    working,
    specific: Boolean(shape.checklist?.length || shape.cueLabel),
    terminal,
    runId: /^(?:ask|guide|launch):/u.test(shape.sessionId) ? null : shape.voiceContextId ?? null,
    sessionId: shape.sessionId,
  }
}
