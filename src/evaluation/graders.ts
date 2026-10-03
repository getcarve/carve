import { stableJson } from '../util.js'
import type { EvaluationGrade, EvaluationObservation, EvaluationScenario } from './contracts.js'

export interface EvaluationGrader {
  id: string
  kind: EvaluationGrade['kind']
  grade(scenario: EvaluationScenario, observation: EvaluationObservation): EvaluationGrade | Promise<EvaluationGrade>
}

export function outcomeStateGrader(id = 'outcome-state'): EvaluationGrader {
  return {
    id,
    kind: 'deterministic',
    grade(scenario, observation) {
      const mismatches: string[] = []
      for (const [key, expected] of Object.entries(scenario.expectedOutcome)) {
        const observed = observation.finalState[key]
        if (stableJson(observed) !== stableJson(expected)) mismatches.push(`${key}: expected ${stableJson(expected)}, observed ${stableJson(observed)}`)
      }
      return {
        graderId: id,
        kind: 'deterministic',
        verdict: mismatches.length === 0 ? 'passed' : 'failed',
        score: mismatches.length === 0 ? 1 : Math.max(0, 1 - mismatches.length / Math.max(1, Object.keys(scenario.expectedOutcome).length)),
        evidence: mismatches.length === 0 ? ['Every declared final-state field matches the scenario oracle.'] : mismatches,
      }
    },
  }
}

export function invariantGrader(id = 'protected-invariants'): EvaluationGrader {
  return {
    id,
    kind: 'deterministic',
    grade(_scenario, observation) {
      const violations = [
        ...observation.invariantViolations,
        ...observation.unauthorizedEffects.map((effect) => `Unauthorized effect: ${effect}`),
      ]
      return {
        graderId: id,
        kind: 'deterministic',
        verdict: violations.length === 0 ? 'passed' : 'failed',
        score: violations.length === 0 ? 1 : 0,
        evidence: violations.length === 0 ? ['No protected invariant or effect boundary was violated.'] : violations,
      }
    },
  }
}

