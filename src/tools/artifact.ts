import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, relative, resolve } from 'node:path'
import type { ActionSpec, VerificationSpec } from '../types.js'
import { sha256 } from '../util.js'
import type { ToolAdapter, ToolContext, ToolExecutionResult } from './contracts.js'

export class SandboxArtifactTool implements ToolAdapter {
  readonly definition = {
    name: 'artifact.write',
    family: 'filesystem' as const,
    description: 'Write a UTF-8 note beneath Carve’s dedicated artifacts directory.',
    location: 'local' as const,
    available: true,
    defaultRisk: 'reversible_write' as const,
  }

  constructor(private readonly root: string) {}

  async execute(action: ActionSpec, context: ToolContext): Promise<ToolExecutionResult> {
    if (context.signal.aborted) throw new Error('Execution cancelled')
    const rawPath = action.input.path
    const content = action.input.content
    if (typeof rawPath !== 'string' || typeof content !== 'string') throw new Error('artifact.write requires path and content strings')
    const target = this.resolveSafe(rawPath)
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    await writeFile(target, content, { encoding: 'utf8', mode: 0o600, signal: context.signal })
    return {
      ok: true,
      summary: `Created ${basename(target)} in the Carve sandbox`,
      output: { path: basename(target), bytes: Buffer.byteLength(content), sha256: sha256(content) },
      producedArtifact: target,
    }
  }

  async inspect(verification: VerificationSpec, _context: ToolContext): Promise<unknown> {
    try {
      const target = this.resolveSafe(verification.target)
      const info = await stat(target)
      if (!info.isFile()) return false
      if (verification.method === 'artifact_exists') return true
      return sha256(await readFile(target, 'utf8'))
    } catch {
      return false
    }
  }

  private resolveSafe(candidate: string): string {
    if (candidate !== basename(candidate) || candidate.length > 120 || !/^[a-zA-Z0-9._-]+$/u.test(candidate)) {
      throw new Error('Artifact path must be a simple filename containing only letters, numbers, dot, underscore, or dash')
    }
    const root = resolve(this.root)
    const target = resolve(root, candidate)
    const rel = relative(root, target)
    if (rel.startsWith('..') || rel === '') throw new Error('Artifact path escapes or aliases the sandbox root')
    return target
  }
}
