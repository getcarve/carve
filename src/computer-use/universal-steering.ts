import { resolvedAssistanceRequestMaxLength } from '../assistance-request.js'
import { randomUUID } from 'node:crypto'

export type UniversalComputerSteeringSource = 'text' | 'voice'

export type UniversalComputerResumeDirective =
  | { kind: 'resume'; id: string; source: 'text'; receivedAt: string }
  | { kind: 'steer'; id: string; source: UniversalComputerSteeringSource; text: string; receivedAt: string }

export interface UniversalComputerSteeringSnapshot {
  state: 'running' | 'pause_requested' | 'paused'
  source: UniversalComputerSteeringSource | null
  requestedAt: string | null
  directiveReady: boolean
}

/**
 * Process-local interruption gate for Universal computer use. The gate never
 * persists directive text and never forwards it through controller events.
 * A pause becomes effective at the coordinator's next action boundary; the
 * coordinator then waits here until the person steers or explicitly resumes.
 */
export class UniversalComputerSteeringGate {
  private state: UniversalComputerSteeringSnapshot['state'] = 'running'
  private source: UniversalComputerSteeringSource | null = null
  private requestedAt: string | null = null
  private pendingDirective: UniversalComputerResumeDirective | null = null
  private waiter: ((directive: UniversalComputerResumeDirective) => void) | null = null

  snapshot(): UniversalComputerSteeringSnapshot {
    return {
      state: this.state,
      source: this.source,
      requestedAt: this.requestedAt,
      directiveReady: this.pendingDirective !== null,
    }
  }

  requestPause(source: UniversalComputerSteeringSource): boolean {
    if (this.state !== 'running') return false
    this.state = 'pause_requested'
    this.source = source
    this.requestedAt = new Date().toISOString()
    return true
  }

  steer(text: string, source: UniversalComputerSteeringSource): Extract<UniversalComputerResumeDirective, { kind: 'steer' }> {
    const trimmed = text.trim()
    if (!trimmed) throw new Error('Course correction text is required')
    if (trimmed.length > resolvedAssistanceRequestMaxLength) throw new Error('Course correction is too long')
    this.requestPause(source)
    const directive: UniversalComputerResumeDirective = {
      kind: 'steer',
      id: randomUUID(),
      source,
      text: trimmed,
      receivedAt: new Date().toISOString(),
    }
    this.publish(directive)
    return directive
  }

  resume(): UniversalComputerResumeDirective {
    if (this.state === 'running') throw new Error('Universal computer use is not paused')
    const directive: UniversalComputerResumeDirective = {
      kind: 'resume',
      id: randomUUID(),
      source: 'text',
      receivedAt: new Date().toISOString(),
    }
    this.publish(directive)
    return directive
  }

  async waitForResume(signal: AbortSignal): Promise<UniversalComputerResumeDirective> {
    if (this.state === 'running') throw new Error('Universal computer use did not request a pause')
    this.state = 'paused'
    if (this.pendingDirective) return this.consumePending()
    if (signal.aborted) throw abortError()
    return await new Promise<UniversalComputerResumeDirective>((resolve, reject) => {
      const onAbort = () => {
        this.waiter = null
        reject(abortError())
      }
      signal.addEventListener('abort', onAbort, { once: true })
      this.waiter = (directive) => {
        signal.removeEventListener('abort', onAbort)
        this.state = 'running'
        this.source = null
        this.requestedAt = null
        resolve(directive)
      }
    })
  }

  private publish(directive: UniversalComputerResumeDirective): void {
    if (this.pendingDirective || this.waiter) {
      // The newest human correction wins before the model restarts. Text stays
      // process-local and the superseded draft becomes unreachable.
      this.pendingDirective = directive
      if (!this.waiter) return
    }
    if (this.waiter) {
      const waiter = this.waiter
      this.waiter = null
      this.pendingDirective = null
      waiter(directive)
      return
    }
    this.pendingDirective = directive
  }

  private consumePending(): UniversalComputerResumeDirective {
    const directive = this.pendingDirective
    if (!directive) throw new Error('No Universal computer-use directive is ready')
    this.pendingDirective = null
    this.state = 'running'
    this.source = null
    this.requestedAt = null
    return directive
  }
}

function abortError(): Error {
  const error = new Error('Universal computer use was cancelled while paused')
  error.name = 'AbortError'
  return error
}
