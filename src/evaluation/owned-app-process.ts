import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'

/** An evaluation may stop only the process it created, never an application
 * selected by bundle id, name, or the user's current foreground window. */
export class OwnedAppProcess {
  private child: ChildProcess | null = null
  private applicationShutdown: (() => Promise<void>) | null = null

  constructor(private readonly launch: (file: string, args: string[], options: SpawnOptions) => ChildProcess = spawn) {}

  async start(file: string, args: string[], options: SpawnOptions): Promise<void> {
    if (this.child) throw new Error('The previous evaluation process has not been stopped')
    const child = this.launch(file, args, options)
    this.child = child
    try { await once(child, 'spawn') } catch (error) {
      this.child = null
      throw error
    }
  }

  /** LaunchServices can outlive its launcher. Bind shutdown only after the
   * caller has verified the exact application instance it created. */
  ownApplication(shutdown: () => Promise<void>): void {
    if (!this.child || this.applicationShutdown) throw new Error('Application ownership must belong to one active launch')
    this.applicationShutdown = shutdown
  }

  async stop(): Promise<void> {
    const child = this.child
    if (!child) return
    // An exited launcher is not evidence that its application exited.
    // Retain ownership if shutdown cannot be established; do not launch again.
    await this.applicationShutdown?.()
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit', { signal: AbortSignal.timeout(5_000) })
      child.kill('SIGTERM')
      // On timeout retain ownership and refuse another launch. Never widen
      // cleanup to a global application quit or force-kill another process.
      await exited
    }
    this.child = null
    this.applicationShutdown = null
  }
}

export function ownedProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 1) throw new Error('Invalid owned process identity')
  try { process.kill(pid, 0); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}

/** Observation only: never signal an application discovered by name. */
export async function waitForOwnedProcessExit(pid: number, options: { timeoutMs?: number; alive?: (pid: number) => boolean } = {}): Promise<void> {
  const deadline = Date.now() + (options.timeoutMs ?? 5_000)
  const alive = options.alive ?? ownedProcessAlive
  while (alive(pid)) {
    if (Date.now() >= deadline) throw new Error(`Owned evaluation application ${pid} did not exit`)
    await delay(25)
  }
}
