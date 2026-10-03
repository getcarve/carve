import type { CapturePolicy, CapturedFacts } from './types.js'

const SECRET_PATTERNS: Array<{ label: string; expression: RegExp }> = [
  { label: 'password assignment', expression: /\b(password|passwd|pwd)\s*[:=]\s*\S+/giu },
  { label: 'API key', expression: /\b(sk-[a-z0-9_-]{12,}|api[_-]?key\s*[:=]\s*\S+)/giu },
  { label: 'bearer token', expression: /\bbearer\s+[a-z0-9._~+/-]+=*/giu },
  { label: 'credit card candidate', expression: /\b(?:\d[ -]*?){13,19}\b/gu },
  { label: 'private key', expression: /-----BEGIN [A-Z ]*PRIVATE KEY-----/gu },
]

const INJECTION_PATTERNS: Array<{ label: string; expression: RegExp }> = [
  { label: 'instruction override', expression: /ignore\s+(all\s+)?(previous|prior)\s+instructions?/iu },
  { label: 'secret exfiltration request', expression: /(reveal|send|upload|exfiltrate).{0,40}(secret|token|credential|password)/iu },
  { label: 'role impersonation', expression: /you\s+are\s+now\s+(the\s+)?(system|developer|administrator)/iu },
]

/** Replace secret-looking substrings. Used for captured facts and for any held typed text shown to the person. */
export function redactSecretPatterns(value: string): { value: string; redactions: string[] } {
  const redactions: string[] = []
  let next = value
  for (const pattern of SECRET_PATTERNS) {
    next = next.replace(pattern.expression, () => {
      redactions.push(pattern.label)
      return `[REDACTED:${pattern.label}]`
    })
  }
  return { value: next, redactions }
}

export interface PrivacyResult {
  facts: CapturedFacts
  redactions: string[]
  excluded: boolean
  exclusionReason: string | null
  injectionSignals: string[]
}

function matches(value: string, patterns: string[]): string | null {
  const normalized = value.toLowerCase()
  return patterns.find((pattern) => normalized.includes(pattern.trim().toLowerCase())) ?? null
}

export function applyPrivacyPipeline(facts: CapturedFacts, policy: CapturePolicy): PrivacyResult {
  const application = matches(facts.app, policy.excludedApplications)
  if (application) return excludedResult(facts, `application:${application}`)

  const window = matches(facts.windowTitle, policy.excludedWindows)
  if (window) return excludedResult(facts, `window:${window}`)

  if (facts.url) {
    try {
      const hostname = new URL(facts.url).hostname
      const domain = policy.excludedDomains.find((candidate) => hostname === candidate || hostname.endsWith(`.${candidate}`))
      if (domain) return excludedResult(facts, `domain:${domain}`)
    } catch {
      return excludedResult(facts, 'invalid-url')
    }
  }

  const redactions: string[] = []
  const redact = (value: string): string => {
    const result = redactSecretPatterns(value)
    redactions.push(...result.redactions)
    return result.value
  }

  const accessibility = facts.accessibility?.map((element) => {
    const next = { ...element }
    if (element.sensitive) next.value = '[REDACTED:sensitive UI value]'
    else if (element.value !== undefined) next.value = redact(element.value)
    return next
  })
  const sanitized: CapturedFacts = {
    ...facts,
    text: redact(facts.text),
    ...(accessibility ? { accessibility } : {}),
  }

  if (facts.accessibility?.some((element) => element.sensitive)) redactions.push('sensitive UI value')
  const injectionSignals = INJECTION_PATTERNS
    .filter((pattern) => pattern.expression.test(sanitized.text))
    .map((pattern) => pattern.label)

  return {
    facts: sanitized,
    redactions: [...new Set(redactions)],
    excluded: false,
    exclusionReason: null,
    injectionSignals,
  }
}

function excludedResult(facts: CapturedFacts, reason: string): PrivacyResult {
  return {
    facts: {
      app: facts.app,
      windowTitle: '[EXCLUDED]',
      text: '[Content excluded before persistence]',
      state: {},
    },
    redactions: ['entire observation'],
    excluded: true,
    exclusionReason: reason,
    injectionSignals: [],
  }
}

export const defaultCapturePolicy: CapturePolicy = {
  screenshots: false,
  activeWindow: true,
  accessibilityTree: true,
  inputMetadata: false,
  screenText: false,
  captureTiming: { mode: 'manual' },
  captureIntervalSeconds: 0,
  excludedApplications: ['1Password', 'Keychain Access'],
  excludedWindows: ['Private Browsing', 'Incognito'],
  excludedDomains: [],
  excludedRegions: [],
  retentionDays: 7,
}

/**
 * Text that reads as an instruction aimed at a model rather than as content.
 *
 * Shared by every path that forwards captured text to a provider: screen text
 * is whatever happened to be on a page, so a page can address the model
 * directly. Callers refuse such content rather than sanitising it, because a
 * rewrite that preserves meaning also preserves the instruction.
 */
export function looksLikePromptInjection(value: string): boolean {
  return /ignore\s+(all\s+)?(previous|prior)\s+instructions?|you\s+are\s+now\s+(the\s+)?(system|developer|administrator)|(?:reveal|send|upload|exfiltrate).{0,40}(?:secret|token|credential|password)/iu.test(value)
}
