import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

/** This gate qualifies local components only. It cannot confer live-app or
 * release qualification, even when every component check passes. */
export const launchQualificationStages = [
  { id: 'conversation', evidence: 'scripted-controller', files: ['tests/conversation-interaction.test.ts', 'tests/conversation-follow-ups.test.ts', 'tests/assistance-route.test.ts', 'tests/interaction-audit.test.ts'] },
  { id: 'effects', evidence: 'scripted-controller', files: ['tests/adaptive-effect-execution.test.ts', 'tests/live-computer-assessment.test.ts', 'tests/live-computer-reliability.test.ts'] },
  { id: 'production-orchestration', evidence: 'production-controller-with-test-backends', files: ['tests/live-computer.test.ts'] },
  { id: 'capture', evidence: 'protocol-fixtures', files: ['tests/live-computer-protocol.test.ts', 'tests/live-computer-response-budget.test.ts'] },
  { id: 'evaluation-integrity', evidence: 'evaluation-regression', files: ['tests/evaluation-foundry.test.ts', 'tests/model-campaign-safety.test.ts', 'tests/launch-qualification.test.ts'] },
  { id: 'editors', evidence: 'headless-dom', files: ['tests/live-computer-editor-integration.test.ts', 'tests/launch-fixtures.test.ts'] },
] as const

export interface QualificationCounts {
  tests: number
  pass: number
  fail: number
  cancelled: number
  skipped: number
  todo: number
}

export function parseQualificationTap(output: string): QualificationCounts | null {
  const counts: Partial<QualificationCounts> = {}
  for (const key of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'] as const) {
    const matches = [...output.matchAll(new RegExp(`^# ${key} (\\d+)$`, 'gm'))]
    if (matches.length !== 1) return null
    counts[key] = Number(matches[0]![1])
  }
  const result = counts as QualificationCounts
  if (result.tests === 0 || result.tests !== result.pass + result.fail + result.cancelled + result.skipped + result.todo) return null
  return result
}

export function qualificationStageStatus(exitCode: number | null, timedOut: boolean, counts: QualificationCounts | null, output = ''): 'passed' | 'failed' | 'incomplete' | 'infrastructure_error' {
  if (timedOut || !counts || counts.cancelled > 0) return 'incomplete'
  if (counts.pass === 0 && counts.fail > 0 && /browserType\.launch:/.test(output)) return 'infrastructure_error'
  if (exitCode !== 0 || counts.fail > 0) return 'failed'
  if (counts.skipped > 0 || counts.todo > 0) return 'incomplete'
  return 'passed'
}

/** Include untracked source and fixtures, not just HEAD or git diff. Never read
 * credentials, personal data, generated reports, installed apps or .git. */
export function qualificationSourceHash(root: string): string {
  const paths: string[] = []
  function walk(path: string): void {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error(`Source symlink is not supported: ${relative(root, join(path, entry.name))}`)
      if (['node_modules', 'dist', '.git'].includes(entry.name)) continue
      const child = join(path, entry.name)
      if (entry.isDirectory()) walk(child)
      else if (entry.isFile()) paths.push(child)
    }
  }
  for (const directory of ['src', 'tests', 'scripts', 'desktop', 'native', 'ui']) walk(join(root, directory))
  for (const file of ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.ui.json', 'eslint.config.js', 'vite.config.ts']) paths.push(join(root, file))
  const hash = createHash('sha256')
  for (const path of paths.sort()) {
    const contents = readFileSync(path)
    hash.update(`${relative(root, path)}\0${contents.length}\0`).update(contents)
  }
  return hash.digest('hex')
}
