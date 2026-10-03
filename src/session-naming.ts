import type { ObservationRecord } from './types.js'

export const untitledSessionName = 'Untitled observation'

const legacyAutomaticNames = new Set([
  untitledSessionName.toLowerCase(),
  'observe a macos workflow',
  'automatic observation',
])

const genericWindowTitles = new Set([
  'desktop',
  'google chrome',
  'home',
  'new tab',
  'search',
  'steward',
  'untitled',
  'untitled window',
])

const genericApps = new Set(['electron', 'finder', 'steward'])

/** Names Carve owns may be replaced; anything a person typed is preserved. */
export function sessionNeedsAutomaticName(name: string): boolean {
  return legacyAutomaticNames.has(name.trim().toLowerCase())
}

function compact(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function cleanWindowTitle(raw: string, app: string): string | null {
  let title = compact(raw.replace(/^\[|\]$/gu, ''))
  if (!title) return null
  const parts = title.split(/\s+(?:[-—–|·])\s+/u).map(compact).filter(Boolean)
  const removableSuffixes = new Set([
    compact(app).toLowerCase(),
    'google chrome',
    'google search',
    'microsoft edge',
    'mozilla firefox',
    'safari',
  ])
  while (parts.length > 1 && removableSuffixes.has(parts.at(-1)?.toLowerCase() ?? '')) parts.pop()
  title = compact(parts.join(' — '))
  if (!title || genericWindowTitles.has(title.toLowerCase()) || /^https?:\/\//iu.test(title)) return null
  return title.slice(0, 72).replace(/[,:;.!?\s]+$/gu, '')
}

function cleanTextLead(raw: string): string | null {
  const line = raw.split(/[\n\r]+/u)
    .map(compact)
    .find((candidate) => candidate.length >= 8 && candidate.length <= 72 && /[A-Za-z]{3}/u.test(candidate))
  if (!line || /^(no readable text|no window text)/iu.test(line)) return null
  return line.replace(/[,:;.!?\s]+$/gu, '')
}

/** A private, deterministic fallback when no suitable local model is running. */
export function evidenceDerivedSessionName(observations: ObservationRecord[]): string {
  const scores = new Map<string, { title: string; score: number }>()
  observations.forEach((observation, index) => {
    if (observation.excluded) return
    const title = cleanWindowTitle(observation.facts.windowTitle, observation.facts.app)
      ?? cleanTextLead(observation.facts.text)
    if (!title) return
    const key = title.toLowerCase()
    const current = scores.get(key)
    scores.set(key, { title, score: (current?.score ?? 0) + 4 + index / Math.max(1, observations.length) })
  })
  const best = [...scores.values()].sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))[0]?.title
  if (best) return normalizeGeneratedSessionName(best) ?? untitledSessionName

  const apps = observations
    .filter((observation) => !observation.excluded)
    .map((observation) => compact(observation.facts.app))
    .filter((app) => app && !genericApps.has(app.toLowerCase()))
  const app = [...new Set(apps)][0]
  return app ? `${app} workflow`.slice(0, 72) : untitledSessionName
}

export function sessionNamingEvidence(observations: ObservationRecord[]): Array<{ app: string; windowTitle: string; text: string }> {
  const eligible = observations.filter((observation) => !observation.excluded)
  const stride = Math.max(1, Math.ceil(eligible.length / 12))
  return eligible.filter((_observation, index) => index % stride === 0).slice(0, 12).map((observation) => ({
    app: compact(observation.facts.app).slice(0, 80),
    windowTitle: compact(observation.facts.windowTitle).slice(0, 160),
    text: compact(observation.facts.text).slice(0, 280),
  }))
}

export function normalizeGeneratedSessionName(raw: string): string | null {
  let candidate = raw.trim()
  try {
    const parsed = JSON.parse(candidate) as { title?: unknown }
    if (typeof parsed.title === 'string') candidate = parsed.title
  } catch {
    // Plain-text output is also accepted from local text-only models.
  }
  candidate = compact(candidate.replace(/^['"`]+|['"`]+$/gu, ''))
    .replace(/^(?:title|session name)\s*:\s*/iu, '')
    .replace(/[.!?\s]+$/gu, '')
    .slice(0, 72)
  if (candidate.length < 3 || candidate.includes('\n') || sessionNeedsAutomaticName(candidate)) return null
  return candidate
}

export const sessionTitleSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { title: { type: 'string', minLength: 3, maxLength: 72 } },
  required: ['title'],
} as const

