/** Experimental, provider-neutral execution of bounded programs over observed
 * capabilities. The adapter owns authorization, freshness, and effect receipts.
 * Model output is never executable JavaScript or completion evidence. */
export interface GroundedControl {
  ref: string
  name: string
  role: string
  value?: string
  capabilities: Array<'click' | 'fill' | 'paste_table'>
}
export interface GroundedObservation {
  id: string
  text: string
  controls: GroundedControl[]
  tables: Array<{ id: string; rows: string[][] }>
}
export interface GroundedCommand {
  kind: 'click' | 'fill' | 'paste_table'
  ref: string
  text: string | null
  tableId: string | null
}
export interface GroundedProgram {
  observationId: string
  commands: GroundedCommand[]
  answer: string | null
}
export interface GroundedProgramBackend {
  observe(): Promise<GroundedObservation>
  /** Must revalidate the actual target, capability and authority immediately
   * before dispatch. A failed/ambiguous mutation must never be blindly retried. */
  execute(command: GroundedCommand, control: GroundedControl, table?: string[][]): Promise<void>
}

/** Only complete, exact readback from an adapter-owned replacement range can
 * qualify for one idempotent repair. Truncation is never interpreted as empty. */
export function compareTableReadback(expected: string[][], observed: string[][]): 'exact' | 'missing_only' | 'conflict' {
  if (!expected.length || !expected[0]?.length || observed.length !== expected.length) return 'conflict'
  let missing = false
  for (let r = 0; r < expected.length; r++) {
    if (expected[r]!.length !== expected[0].length || observed[r]?.length !== expected[r]!.length) return 'conflict'
    for (let c = 0; c < expected[r]!.length; c++) {
      const wanted = expected[r]![c], actual = observed[r]![c]
      if (typeof wanted !== 'string' || typeof actual !== 'string') return 'conflict'
      if (actual === wanted) continue
      if (actual !== '') return 'conflict'
      missing = true
    }
  }
  return missing ? 'missing_only' : 'exact'
}

export const groundedProgramSchema = (maxCommands: number) => ({
  name: 'carve_grounded_program', strict: true as const,
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      observationId: { type: 'string' },
      commands: { type: 'array', maxItems: maxCommands, items: {
        type: 'object', additionalProperties: false,
        properties: { kind: { type: 'string', enum: ['click', 'fill', 'paste_table'] }, ref: { type: 'string' },
          text: { type: ['string', 'null'] }, tableId: { type: ['string', 'null'] } },
        required: ['kind', 'ref', 'text', 'tableId'],
      } },
      answer: { type: ['string', 'null'] },
    }, required: ['observationId', 'commands', 'answer'],
  },
})

export function parseGroundedProgram(text: string, maxCommands: number): GroundedProgram {
  const p = JSON.parse(text) as GroundedProgram
  if (!p || typeof p.observationId !== 'string' || !Array.isArray(p.commands) || p.commands.length > maxCommands
    || !(p.answer === null || typeof p.answer === 'string') || p.commands.length > 0 && p.answer !== null
    || p.commands.length === 0 && !p.answer?.trim()) throw new Error('Return either a bounded program or an answer')
  for (const c of p.commands) if (!c || !['click', 'fill', 'paste_table'].includes(c.kind) || typeof c.ref !== 'string'
    || !(c.text === null || typeof c.text === 'string') || !(c.tableId === null || typeof c.tableId === 'string')
    || c.kind === 'fill' && (c.text === null || c.text.length > 20_000)
    || c.kind !== 'fill' && c.text !== null || c.kind === 'paste_table' && !c.tableId
    || c.kind !== 'paste_table' && c.tableId !== null) throw new Error('Invalid grounded command')
  return p
}

/** Captures exact observed tables once. References never become proof that a
 * destination contains them; final readback is a separate obligation. */
export class GroundedProgramRuntime {
  private current: GroundedObservation | null = null
  private tables = new Map<string, string[][]>()
  private usedObservations = new Set<string>()
  constructor(private backend: GroundedProgramBackend, private maxCommands = 6) {}
  async observe(): Promise<GroundedObservation> {
    this.current = await this.backend.observe()
    for (const table of this.current.tables) {
      if (this.tables.has(table.id) && JSON.stringify(this.tables.get(table.id)) !== JSON.stringify(table.rows)) throw new Error('Table identity collision')
      this.tables.set(table.id, structuredClone(table.rows))
    }
    return structuredClone(this.current)
  }
  async execute(program: GroundedProgram, signal: AbortSignal): Promise<{ observations: GroundedObservation[]; executed: number; error: string | null }> {
    parseGroundedProgram(JSON.stringify(program), this.maxCommands)
    if (!this.current || program.observationId !== this.current.id || this.usedObservations.has(program.observationId)) throw new Error('Stale or consumed program observation')
    const controls = new Map(this.current.controls.map(c => [c.ref, c]))
    // Validate the whole program before any effect. Future/unseen targets are
    // not allowed; a new page/control requires another model decision.
    for (const c of program.commands) {
      const control = controls.get(c.ref)
      if (!control?.capabilities.includes(c.kind) || c.tableId && !this.tables.has(c.tableId)) throw new Error('Unobserved or unsupported capability')
    }
    this.usedObservations.add(program.observationId)
    const observations: GroundedObservation[] = []
    let executed = 0
    for (const c of program.commands) {
      signal.throwIfAborted()
      try {
        await this.backend.execute(c, structuredClone(controls.get(c.ref)!), c.tableId ? structuredClone(this.tables.get(c.tableId)!) : undefined)
        executed++
        observations.push(await this.observe())
      } catch (error) {
        // Capture before asking for a repair; do not execute a dependent tail
        // after unknown delivery. The consumed program cannot be replayed.
        observations.push(await this.observe())
        return { observations, executed, error: String(error).slice(0, 500) }
      }
    }
    return { observations, executed, error: null }
  }
}
