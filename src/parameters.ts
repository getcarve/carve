import type { ActionSpec, ProcedureParameter, VerificationSpec } from './types.js'

const parameterMarker = (id: string): string => `{{parameter:${id}}}`

export function safeOperationalText(value: string, maximum = 160): boolean {
  const clean = value.trim()
  return clean.length > 0
    && clean.length <= maximum
    && !/(?:password|passwd|secret|api[_ -]?key|access[_ -]?token|bearer\s+[a-z0-9._-]+)/iu.test(clean)
}

export function markerForParameter(id: string): string {
  return parameterMarker(id)
}

export function bindProcedureParameters(
  parameters: ProcedureParameter[],
  supplied: Record<string, string>,
  actions: ActionSpec[],
): { values: Record<string, string>; actions: ActionSpec[] } {
  const known = new Set(parameters.map((parameter) => parameter.id))
  const unknown = Object.keys(supplied).filter((key) => !known.has(key))
  if (unknown.length > 0) throw new Error(`Unknown workflow input: ${unknown.join(', ')}`)

  const values: Record<string, string> = {}
  for (const parameter of parameters) {
    const raw = supplied[parameter.id]
    if (raw === undefined || !raw.trim()) {
      if (parameter.required) throw new Error(`Required workflow input “${parameter.label}” is missing`)
      continue
    }
    if (parameter.type !== 'safe_text' || parameter.sensitive || !safeOperationalText(raw, parameter.constraints.maxLength) || raw.trim().length < parameter.constraints.minLength) {
      throw new Error(`Workflow input “${parameter.label}” is outside its non-sensitive text constraints`)
    }
    values[parameter.id] = raw.trim()
  }

  return { values, actions: actions.map((action) => bindAction(action, values)) }
}

function bindAction(action: ActionSpec, values: Record<string, string>): ActionSpec {
  const parameterId = typeof action.input.parameterId === 'string' ? action.input.parameterId : null
  if (!parameterId) return action
  const value = values[parameterId]
  if (value === undefined) throw new Error(`Action ${action.id} references unbound workflow input ${parameterId}`)
  const expected = action.verification.expected === parameterMarker(parameterId) ? value : action.verification.expected
  const verification: VerificationSpec = { ...action.verification, expected }
  return {
    ...action,
    input: { ...action.input, value },
    preview: `${action.preview}: “${value}”`,
    expectedStateChange: action.expectedStateChange.replace(parameterMarker(parameterId), value),
    verification,
  }
}
