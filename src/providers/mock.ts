import { localEmbedding } from '../util.js'
import type { EmbeddingResponse, ModelProvider, ModelRequest, ModelResponse } from './types.js'
import { requireRequestCapabilities } from './types.js'

export class MockModelProvider implements ModelProvider {
  readonly summary = {
    id: 'mock',
    name: 'Deterministic mock',
    kind: 'mock' as const,
    model: 'steward-fixture-v1',
    embeddingModel: null,
    baseUrl: null,
    configured: true,
    capabilities: {
      text: true,
      vision: true,
      embeddings: true,
      structuredOutput: true,
      toolCalling: true,
    },
    privacyNote: 'Runs deterministic fixture logic in-process. Nothing leaves this machine.',
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    requireRequestCapabilities(this, request)
    const text = request.jsonSchema?.name === 'steward_ai_workflow_draft'
      ? mockWorkflowDraft(request.prompt)
      : request.requireJson
        ? JSON.stringify({ summary: 'Deterministic mock response', evidence: request.prompt.slice(0, 80) })
        : `Deterministic mock response: ${request.prompt.slice(0, 120)}`
    return {
      text,
      model: this.summary.model,
      providerId: this.summary.id,
      usage: { inputTokens: null, outputTokens: null },
      responseId: null,
    }
  }

  async embed(texts: string[]): Promise<EmbeddingResponse> {
    return { vectors: texts.map((text) => localEmbedding(text)), usage: { inputTokens: null } }
  }

  async health(): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: 'Deterministic provider ready' }
  }
}

interface MockEvidence {
  observationId: string
  annotationKind: 'state' | 'input' | 'decision' | 'outcome' | 'interruption' | 'irrelevant'
  label: string
  notes: string
}

function mockWorkflowDraft(prompt: string): string {
  const marker = 'APPROVED_EVIDENCE_JSON:'
  const start = prompt.indexOf(marker)
  const raw = start < 0 ? '[]' : prompt.slice(start + marker.length).trim()
  const evidence = JSON.parse(raw) as MockEvidence[]
  const steps = evidence.map((item, index) => ({
    id: `step-${index + 1}`,
    name: item.label || `Observed state ${index + 1}`,
    description: item.notes || `Reviewer-approved ${item.annotationKind} evidence.`,
    kind: item.annotationKind === 'interruption' ? 'exception' : item.annotationKind === 'irrelevant' ? 'state' : item.annotationKind,
    preconditions: index === 0 ? ['The reviewed workflow is ready to begin'] : [`${evidence[index - 1]?.label || 'The prior state'} has been observed`],
    postconditions: [item.label || `Observed state ${index + 1} is present`],
    confidence: 0.78,
    evidenceObservationIds: [item.observationId],
    factBasis: [item.label || `Reviewer approved observation ${item.observationId}`],
    interpretation: [`This evidence may represent a ${item.annotationKind} in the workflow`],
  }))
  return JSON.stringify({
    goal: evidence.at(-1)?.label ? `Reach: ${evidence.at(-1)?.label}` : 'Reproduce the reviewed workflow outcome',
    summary: `A non-executable draft induced from ${evidence.length} approved observation${evidence.length === 1 ? '' : 's'}.`,
    preconditions: ['The same application context is available'],
    requiredInputs: evidence.filter((item) => item.annotationKind === 'input').map((item) => item.label),
    expectedOutputs: evidence.filter((item) => item.annotationKind === 'outcome').map((item) => item.label),
    startStepId: steps[0]?.id ?? '',
    steps,
    edges: steps.slice(1).map((step, index) => ({ from: steps[index]?.id, to: step.id, condition: evidence[index]?.annotationKind === 'decision' ? 'Reviewer-labeled decision path' : null })),
  })
}
