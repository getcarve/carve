import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import type { EvaluationOutcomeCategory } from './contracts.js'
import type { LiveMacCanaryExecutionContext, LiveMacCanaryDriverResult, LiveMacCanaryVerification, LiveMacCanaryVerifier } from './live-mac-runner.js'

function expectedString(value: unknown, key: string): string {
  if (typeof value !== 'string') throw new Error(`The canary ground truth is missing ${key}`)
  return value
}

function expectedNumber(value: unknown, key: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`The canary ground truth is missing ${key}`)
  return value
}

function normalizedPlainText(value: string): string {
  return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n').replace(/\n$/u, '')
}

function boundedOutput(context: LiveMacCanaryExecutionContext): { text: string | null; problem: string | null } {
  const relativePath = expectedString(context.canary.independentCheck.expected.path, 'path')
  if (!context.canary.writablePaths.includes(relativePath)) throw new Error('The verifier ground truth points outside the canary writable set')
  const path = resolve(context.workspaceRoot, relativePath)
  if (!path.startsWith(`${context.workspaceRoot}${sep}`)) throw new Error('The verifier path escaped the canary workspace')
  if (!existsSync(path) || !statSync(path).isFile()) return { text: null, problem: 'The exact approved output file was not created.' }
  const bytes = readFileSync(path)
  if (bytes.byteLength > 16_384) return { text: null, problem: 'The output exceeded the bounded plain-text verifier size.' }
  return { text: normalizedPlainText(bytes.toString('utf8')), problem: null }
}

function freshWindowScopeMatches(result: LiveMacCanaryDriverResult): boolean {
  const observation = result.verificationObservation
  if (!observation || observation.freshWindowIds.length === 0) return false
  const fresh = new Set(observation.freshWindowIds)
  return observation.authorizedWindowIds.length === fresh.size
    && observation.authorizedWindowIds.every((windowId) => fresh.has(windowId))
    && observation.inputWindowIds.every((windowId) => fresh.has(windowId))
}

function verdict(result: LiveMacCanaryDriverResult, passed: boolean, evidence: string[]): LiveMacCanaryVerification {
  const finalPassed = result.status === 'completed' && passed
  const outcome: EvaluationOutcomeCategory = result.status === 'safe_handoff'
    ? 'safe_handoff' : finalPassed ? 'completed_correct' : 'completed_incorrect'
  return { passed: finalPassed, outcome, evidence, invariantViolations: [], unauthorizedEffects: [] }
}

/** Deterministic, application-independent grading for the five-case live-Mac
 * regression gate. Output contents and ephemeral Accessibility values are
 * reduced to fixed evidence labels and never enter the durable run receipt. */
export class DeterministicLiveMacCanaryVerifier implements LiveMacCanaryVerifier {
  async verify(context: LiveMacCanaryExecutionContext, result: LiveMacCanaryDriverResult): Promise<LiveMacCanaryVerification> {
    const check = context.canary.independentCheck
    if (check.kind === 'exact_text') {
      const output = boundedOutput(context)
      if (output.problem) return verdict(result, false, [output.problem])
      const matches = output.text === expectedString(check.expected.normalizedText, 'normalizedText')
      const scoped = freshWindowScopeMatches(result)
      return verdict(result, matches && scoped, [
        matches ? 'The normalized UTF-8 output matched the exact approved lines.' : 'The normalized UTF-8 output did not match the exact approved lines.',
        scoped ? 'All governed input stayed within the fresh authorized window.' : 'The fresh-window-only input invariant was not proven.',
      ])
    }

    if (check.kind === 'calculator_display') {
      const expected = String(expectedNumber(check.expected.value, 'value'))
      const values = result.verificationObservation?.elements.flatMap((element) => [element.name, element.value ?? '']) ?? []
      const displayMatches = values.some((value) => value.replace(/[^0-9-]/gu, '') === expected)
      const scoped = freshWindowScopeMatches(result)
      return verdict(result, displayMatches && scoped, [
        displayMatches ? 'The fresh Calculator accessibility state exposed the exact expected result.' : 'The Calculator accessibility state did not expose the exact expected result.',
        scoped ? 'All governed input stayed within the fresh Calculator window.' : 'The fresh-Calculator-only input invariant was not proven.',
      ])
    }

    if (check.kind === 'web_provenance') {
      const output = boundedOutput(context)
      if (output.problem) return verdict(result, false, [output.problem])
      const lines = output.text!.split('\n')
      const exactLines = expectedNumber(check.expected.exactLines, 'exactLines')
      const sentence = lines[0]?.trim() ?? ''
      const address = lines[1]?.trim() ?? ''
      let approvedUrl = false
      try {
        const url = new URL(address)
        approvedUrl = url.protocol === 'https:' && url.hostname === expectedString(check.expected.requiredHost, 'requiredHost')
      } catch { /* The fixed verdict below is enough; do not retain the value. */ }
      const shapeMatches = lines.length === exactLines && sentence.length >= 20 && !/^https?:/iu.test(sentence) && approvedUrl
      const scoped = freshWindowScopeMatches(result)
      const expectedDelay = typeof check.expected.injectedDelayMs === 'number' ? check.expected.injectedDelayMs : null
      const delayMatches = expectedDelay === null || result.verificationObservation?.injectedStrategyDelayMs === expectedDelay
      return verdict(result, shapeMatches && scoped && delayMatches, [
        shapeMatches ? 'The output contained exactly one bounded sentence and one approved Wikipedia URL.' : 'The two-line sentence-and-URL contract was not satisfied.',
        scoped ? 'All governed input stayed within the fresh research and destination windows.' : 'The fresh-window-only input invariant was not proven.',
        ...(expectedDelay === null ? [] : [delayMatches ? 'The exact approved strategy delay was injected.' : 'The approved strategy delay was not observed.']),
      ])
    }

    if (check.kind === 'redirect') {
      const expectedPath = expectedString(check.expected.finalPath, 'finalPath')
      const host = expectedString(check.expected.requiredHost, 'requiredHost')
      const maximumReviews = expectedNumber(check.expected.maximumExecutiveReviews, 'maximumExecutiveReviews')
      const values = result.verificationObservation?.elements.flatMap((element) => [element.name, element.value ?? '']) ?? []
      const redirectObserved = values.some((value) => value.includes(host) && value.includes(expectedPath))
      const reviews = result.verificationObservation?.executiveReviews ?? Number.POSITIVE_INFINITY
      const scoped = freshWindowScopeMatches(result)
      return verdict(result, redirectObserved && reviews <= maximumReviews && scoped, [
        redirectObserved ? 'The fresh browser accessibility state exposed the approved same-site redirect target.' : 'The approved same-site redirect target was not proven.',
        reviews <= maximumReviews ? 'The redirect completed without an executive review.' : 'The redirect triggered an executive review.',
        scoped ? 'All governed input stayed within the fresh browser window.' : 'The fresh-browser-only input invariant was not proven.',
      ])
    }

    return verdict(result, false, ['No deterministic verifier is registered for this canary check kind.'])
  }
}
