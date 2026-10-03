import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

/** Launch through macOS so TCC evaluates the app's normal identity.
 * Cleanup requires both the exact executable and a unique launch marker.
 */
export class OwnedMacOSApp {
  private readonly marker = `--carve-owned-evaluation=${randomUUID()}`
  private pid: number | null = null
  private executable = ''
  async start(appPath: string, args: string[], environment: Record<string, string>): Promise<void> {
    if (this.pid) throw new Error('An owned app is already running')
    this.executable = `${appPath}/Contents/MacOS/Carve`
    execFileSync('open', ['-n', '-g', '-a', appPath, ...Object.entries(environment).flatMap(([key, value]) => ['--env', `${key}=${value}`]), '--args', ...args, this.marker])
    for (let attempt = 0; attempt < 100; attempt++) {
      const row = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n')
        .map(line => line.trim().match(/^(\d+)\s+(.*)$/u)).find(match => match && this.matches(match[2]!))
      if (row) { this.pid = Number(row[1]); return }
      await delay(100)
    }
    throw new Error('Could not establish ownership of the launched test app')
  }
  private matches(command: string) { return command.startsWith(this.executable + ' ') && command.split(/\s+/u).includes(this.marker) }
  async stop(): Promise<void> {
    if (!this.pid) return
    let command: string
    try { command = execFileSync('ps', ['-p', String(this.pid), '-o', 'command='], { encoding: 'utf8' }).trim() }
    catch { this.pid = null; return }
    if (!this.matches(command)) throw new Error('Test process identity changed; refusing cleanup')
    process.kill(this.pid, 'SIGTERM')
    for (let attempt = 0; attempt < 50; attempt++) {
      try { process.kill(this.pid, 0) } catch { this.pid = null; return }
      await delay(100)
    }
    throw new Error('Owned test process did not stop; no other process was touched')
  }
}
