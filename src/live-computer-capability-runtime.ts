import type {
  LiveComputerExecutionMode,
  LiveComputerObjective,
  LiveComputerSession,
} from './types.js'

export const defaultLiveComputerExecutionMode: LiveComputerExecutionMode = 'legacy'

export function parseLiveComputerExecutionMode(value: string | null | undefined): LiveComputerExecutionMode {
  return value === 'capability_vm_v1' ? 'capability_vm_v1' : defaultLiveComputerExecutionMode
}

export interface LiveComputerVisualFieldCapability {
  allowed: boolean
  reason: string
}


function visualQueryObjectivesShareEntityRoute(
  session: Pick<LiveComputerSession, 'ledger'>,
  route: Pick<LiveComputerObjective, 'entityRefs'>,
  query: Pick<LiveComputerObjective, 'entityRefs'>,
): boolean {
  const queryEntities = new Set(query.entityRefs)
  if (route.entityRefs.some((entityId) => queryEntities.has(entityId))) return true
  if (route.entityRefs.length === 0 || query.entityRefs.length === 0) return false

  // `relatedTo` is directional in the plan, but route membership is not: a
  // resource may point to its site while the route objective points to the
  // site. Traverse the bounded entity graph in both directions so the policy
  // recognizes that pair without accepting two unrelated plan entities.
  const neighbors = new Map<string, Set<string>>()
  const connect = (left: string, right: string): void => {
    const current = neighbors.get(left) ?? new Set<string>()
    current.add(right)
    neighbors.set(left, current)
  }
  for (const entity of session.ledger.entities) {
    if (!entity.relatedTo) continue
    connect(entity.id, entity.relatedTo)
    connect(entity.relatedTo, entity.id)
  }
  const visited = new Set(route.entityRefs)
  const queue = [...route.entityRefs]
  while (queue.length > 0) {
    const entityId = queue.shift()!
    if (queryEntities.has(entityId)) return true
    for (const neighbor of neighbors.get(entityId) ?? []) {
      if (visited.has(neighbor)) continue
      visited.add(neighbor)
      queue.push(neighbor)
    }
  }
  return false
}

function visualQueryObjectivesAreAdjacentAcquisitionClauses(
  session: Pick<LiveComputerSession, 'ledger'>,
  route: Pick<LiveComputerObjective, 'clauseIds'>,
  query: Pick<LiveComputerObjective, 'clauseIds'>,
): boolean {
  const clauseIndex = new Map(session.ledger.clauses.map((clause, index) => [clause.id, index]))
  return route.clauseIds.some((routeClauseId) => {
    const routeIndex = clauseIndex.get(routeClauseId)
    const routeClause = routeIndex === undefined ? null : session.ledger.clauses[routeIndex]
    if (routeIndex === undefined || routeClause?.kind !== 'navigate') return false
    return query.clauseIds.some((queryClauseId) => {
      const queryIndex = clauseIndex.get(queryClauseId)
      const queryClause = queryIndex === undefined ? null : session.ledger.clauses[queryIndex]
      return queryIndex === routeIndex + 1 && queryClause?.kind === 'lookup'
    })
  })
}

/** The schema, prompt, preflight, binder, and executor all consult this same
 * objective-level rule. A route objective may borrow the visual query
 * transaction only when the validated graph says its immediate, dependent
 * next step is query entry in the same approved acquisition segment. */
export function liveComputerVisualQueryObjectiveCapability(
  session: Pick<LiveComputerSession, 'executionMode' | 'ledger'>,
  objective: Pick<LiveComputerObjective, 'id' | 'kind' | 'clauseIds' | 'entityRefs'> | null | undefined,
): LiveComputerVisualFieldCapability {
  if (session.executionMode !== 'capability_vm_v1') {
    return { allowed: false, reason: 'The legacy executor requires semantic focus proof.' }
  }
  if (!objective) return { allowed: false, reason: 'No active query objective is available.' }
  if (objective.kind === 'enter_query') {
    return { allowed: true, reason: 'The active objective is approved query entry.' }
  }
  if (session.ledger.planningArchitecture === 'adaptive_v1'
    && ['extract_information', 'choose_resource'].includes(objective.kind)
    && objective.clauseIds.some(id => session.ledger.clauses.some(clause => clause.id === id))
    && objective.entityRefs.length > 0) {
    return { allowed: true, reason: 'The approved research objective may acquire evidence through a provenance-bound read-only query.' }
  }
  if (objective.kind !== 'establish_route') {
    return { allowed: false, reason: 'The visual query capability is limited to query entry and its directly related route setup.' }
  }
  const objectiveIndex = session.ledger.objectives.findIndex((candidate) => candidate.id === objective.id)
  const query = objectiveIndex >= 0 ? session.ledger.objectives[objectiveIndex + 1] : null
  if (query?.kind !== 'enter_query' || !query.dependsOn.includes(objective.id)) {
    return { allowed: false, reason: 'Route setup has no immediate dependent query objective.' }
  }
  const sharesApprovedClause = query.clauseIds.some((clauseId) => objective.clauseIds.includes(clauseId))
  const sharesEntityRoute = visualQueryObjectivesShareEntityRoute(session, objective, query)
  const adjacentAcquisitionClauses = visualQueryObjectivesAreAdjacentAcquisitionClauses(session, objective, query)
  if (!sharesApprovedClause && !sharesEntityRoute && !adjacentAcquisitionClauses) {
    return { allowed: false, reason: 'The dependent query is not linked to the route by a shared clause, plan entity, or adjacent navigation-to-lookup segment.' }
  }
  return { allowed: true, reason: 'The route objective is immediately followed by its dependent query in the same approved acquisition segment.' }
}
