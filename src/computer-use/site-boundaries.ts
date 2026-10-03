import type { LiveComputerElement } from '../types.js'

/**
 * Site boundaries: pages that stop the work for a reason no input by Carve
 * should resolve. One detector for the controller, the report guards and the
 * evaluation harness, so they agree on what a boundary is (in testing:
 * four separate patterns, and none matched a retailer's "Quick verification …
 * Press & hold" challenge).
 *
 * Page text is data. A match never grants anything; it only withholds input
 * or explains a stop.
 */
export type SiteBoundaryKind = 'human_verification' | 'verification_mentioned' | 'authentication' | 'access_denied' | 'rate_limited' | 'page_missing'

export interface SiteBoundary {
  kind: SiteBoundaryKind
  /** The phrase that matched, at most 80 characters, for audit and messages. */
  evidence: string
}

/**
 * A human-verification challenge asks whether a person is present. Carve never
 * answers it: a press-and-hold or checkbox is trivial for software, which is
 * exactly why this is a controller rule and not model judgement. Phrases are
 * the challenge's own instructions, not the topic: an article that mentions
 * CAPTCHAs does not match.
 */
const humanVerification: RegExp[] = [
  /press\s*(?:&|and)\s*hold to confirm you(?:'|’)?re a human/iu,
  /confirm (?:that )?you(?:'|’)?re (?:a )?human/iu,
  /confirm (?:that )?you are (?:a )?human/iu,
  /verify (?:that )?you are (?:a )?human/iu,
  /verify you(?:'|’)?re (?:a )?human/iu,
  /(?:^|\b)(?:i(?:'|’)?m|i am) not a robot\b/iu,
  /\bare you a robot\b/iu,
  /\bhuman or a bot\b/iu,
  /our systems have detected unusual traffic/iu,
  /enter the characters you see below/iu,
  /\bcomplete the security check\b/iu,
  /checking (?:if the site connection is secure|your browser before accessing)/iu,
  /\bperforming security verification\b/iu,
  /^(?:re|h)captcha$/iu,
]

const otherBoundaries: Array<{ kind: Exclude<SiteBoundaryKind, 'human_verification'>; pattern: RegExp }> = [
  // Named but not proven to be a live challenge: explains a stop, never withholds input.
  { kind: 'verification_mentioned', pattern: /\b(?:captcha|security verification)\b/iu },
  { kind: 'authentication', pattern: /\b(?:sign|log) in to (?:continue|view)\b/iu },
  { kind: 'access_denied', pattern: /\baccess denied\b|\bforbidden\b|\bnot available in your (?:country|region|location)\b/iu },
  { kind: 'rate_limited', pattern: /\btoo many requests\b|\brate limit(?:ed)?\b/iu },
  // Queue and overload pages (a clothing retailer: "Sit tight… currently overloaded"; Queue-it style waiting
  // rooms): the site is withholding the page, so a report that says so is a real limit, not a premature stop.
  { kind: 'rate_limited', pattern: /\bsit tight\b|\b(?:site|servers?) (?:is|are) (?:currently )?(?:overloaded|busy)\b|\bexperiencing (?:unusually )?high (?:traffic|demand)\b|\byou are (?:now )?in (?:the |a )?(?:queue|line|waiting room)\b|\bwaiting room\b/iu },
  { kind: 'page_missing', pattern: /\bpage not found\b|\b404\b/iu },
]

/** A challenge anywhere in the texts wins over any other boundary; otherwise the first other boundary found. */
export function detectSiteBoundary(texts: readonly string[]): SiteBoundary | null {
  for (const raw of texts) {
    const text = raw.replace(/\s+/gu, ' ').trim()
    if (!text) continue
    for (const pattern of humanVerification) {
      const match = pattern.exec(text)
      if (match) return { kind: 'human_verification', evidence: match[0].slice(0, 80) }
    }
  }
  for (const raw of texts) {
    const text = raw.replace(/\s+/gu, ' ').trim()
    for (const { kind, pattern } of otherBoundaries) {
      const match = pattern.exec(text)
      if (match) return { kind, evidence: match[0].slice(0, 80) }
    }
  }
  return null
}

/** A soft limit page is short and says so up front; a complete page that mentions a limit is not one. */
const SOFT_PAGE_MAX_CHARS = 1_500, SOFT_LEAD_LINES = 12, SOFT_LINE_MAX = 160
export interface BoundaryDocument { text: string; /** The top-level document; iframes are false. */ main: boolean }

/**
 * The page's boundary. A human-verification challenge counts anywhere
 * (challenges live in cross-origin frames and overlays on an intact page). A
 * soft boundary (rate limit, access denied, missing page, sign-in wall) counts
 * only in the title or the opening lines of a short main document. Campaign
 * 42: ad-sync iframes flagged complete JSONLint and Britannica pages as
 * rate_limited, and a seat map's section "404" read as a missing page.
 * `STEWARD_PAGE_BOUNDARY_DOMINANCE=off` returns to matching anywhere.
 */
export function detectPageBoundary(page: { title: string; documents: readonly BoundaryDocument[] }): SiteBoundary | null {
  const lines = (text: string) => text.split('\n').map(line => line.replace(/\s+/gu, ' ').trim()).filter(Boolean)
  const everywhere = detectSiteBoundary([page.title, ...page.documents.flatMap(document => lines(document.text))])
  if (process.env.STEWARD_PAGE_BOUNDARY_DOMINANCE?.trim().toLowerCase() === 'off' || everywhere?.kind === 'human_verification') return everywhere
  const main = page.documents.find(document => document.main)?.text ?? ''
  const short = main.replace(/\s+/gu, ' ').trim().length <= SOFT_PAGE_MAX_CHARS
  const lead = short ? lines(main).slice(0, SOFT_LEAD_LINES).filter(line => line.length <= SOFT_LINE_MAX) : []
  return detectSiteBoundary([page.title, ...lead])
}

/** The text a captured frame exposes: element names, help and values (never a sensitive field's value). */
export function frameBoundaryTexts(elements: readonly LiveComputerElement[]): string[] {
  return elements.flatMap(element => [element.name, element.sensitive ? null : element.value, element.help]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0))
}

/** A human-verification challenge in the captured frame, or null. */
export function humanVerificationInFrame(elements: readonly LiveComputerElement[]): SiteBoundary | null {
  const boundary = detectSiteBoundary(frameBoundaryTexts(elements))
  return boundary?.kind === 'human_verification' ? boundary : null
}

/** A human-verification challenge in a page's text, or null. */
export function humanVerificationInPageText(text: string): SiteBoundary | null {
  const boundary = detectSiteBoundary(text.split('\n').map(line => line.trim()).filter(Boolean).slice(0, 4_000))
  return boundary?.kind === 'human_verification' ? boundary : null
}

/**
 * A human-verification challenge is the person's step, like signing in: Carve
 * pauses, says which site is asking, keeps every input away from that page, and
 * continues on its own once a fresh capture no longer shows the challenge.
 * `STEWARD_HUMAN_VERIFICATION_HANDOFF=off` restores the earlier stop.
 */
export const humanVerificationHandoffEnabled = (env: NodeJS.ProcessEnv = process.env) => env.STEWARD_HUMAN_VERIFICATION_HANDOFF?.trim().toLowerCase() !== 'off'

/** The site a person would recognise: the page's host without a leading "www.". */
export function boundarySite(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const host = new URL(url).hostname.replace(/^www\./u, '')
    return host && host.includes('.') ? host : null
  } catch { return null }
}

/** What the person is asked while Carve waits. Names the site; never quotes the challenge. */
export function humanVerificationHandoffMessage(site: string | null): string {
  return `${site ?? 'This site'} wants you to confirm you’re human. Complete it in the window, then Carve will continue.`
}

/** The stop when nobody completes the check (declined, timed out, or no person present). */
export function humanVerificationLeftMessage(site: string | null): string {
  return `No input was sent to the human-verification check: ${humanVerificationHandoffMessage(site)} Carve never completes these checks, and this one was left for you, so the work that needed ${site ?? 'that site'} is unfinished.`
}

/**
 * Thrown by the controller instead of sending input to a window that shows a
 * human-verification challenge. With the hand-off on, the run pauses for the
 * person (see `humanVerificationHandoffEnabled`); otherwise it stops and
 * reports, and the person completes the check themselves.
 */
export class HumanVerificationBoundary extends Error {
  constructor(readonly boundary: SiteBoundary, readonly site: string | null = null) {
    super(humanVerificationHandoffEnabled()
      ? humanVerificationLeftMessage(site)
      : `No input was sent: the page is showing a human-verification check (“${boundary.evidence}”). Carve never completes these checks. The person can complete it in the window and then ask Carve to continue.`)
    this.name = 'HumanVerificationBoundary'
  }
}

/**
 * A sign-in page is the person's step, like a human-verification check: Carve
 * never types a password or answers a second factor, so the run pauses, names
 * the site, and continues on its own once the page is gone. Before this, the
 * actor was told to report `partial` at a sign-in and the run ended as "Work
 * stopped" with nothing to resume: Google's "Verify it's you" on the way to
 * docs.google.com ended a Google Doc request whose research was already done.
 * `STEWARD_SIGN_IN_HANDOFF=off` restores that stop.
 *
 * Evidence must be specific to a sign-in step. A page with a "Sign in" link in
 * its header (every search result and store page) never matches: that needs an
 * identity-provider host, a sign-in path with sign-in wording or a password
 * field, a password field with sign-in wording, or a re-verification phrase in
 * the opening lines of a short page.
 */
export const signInHandoffEnabled = (env: NodeJS.ProcessEnv = process.env) => env.STEWARD_SIGN_IN_HANDOFF?.trim().toLowerCase() !== 'off'

const identityProviderHosts = /^(?:accounts\.google\.com|login\.microsoftonline\.com|login\.microsoft\.com|login\.live\.com|appleid\.apple\.com|idmsa\.apple\.com|signin\.aws\.amazon\.com|login\.yahoo\.com|id\.atlassian\.com|auth\.openai\.com|[\w-]+\.okta\.com|[\w-]+\.auth0\.com)$/iu
const signInPath = /(?:^|\/)(?:log-?in|sign-?in|sign_in|signon|ap\/signin|i\/flow\/login|uas\/login|checkpoint\/lg)(?:[/?.;]|$)/iu
/** Wording a sign-in page uses about itself. Only read from the title, the opening lines of a short page, or beside a password field. */
const signInWording = /^(?:sign in|log in|sign-in|log-in|login)\b|\b(?:sign|log) in to (?:continue|view|your account)\b|\benter your password\b|\bforgot (?:your )?password\b/iu
/** Re-verification of an identity: the account is known, the person must prove it. */
const reverification: RegExp[] = [
  /\bverify it(?:'|’)?s you\b/iu,
  /\bplease sign in again\b/iu,
  /\b(?:2|two)-step verification\b/iu,
  /\btwo-factor authentication\b/iu,
  /\benter the (?:verification )?code (?:we|that we) (?:just )?sent\b/iu,
]

/** A page that withholds itself until the person signs in, in its own words at the top. Title or the opening lines of a
 * short page only, and never a page whose opening is ordinary content. */
const signInWall = /\b(?:sign|log) in to (?:continue|view|see|access|read)\b|\byou (?:must|need to|have to) (?:be )?(?:signed|logged) in\b|\b(?:sign|log) in (?:is )?required\b|\bmembers[- ]only\b|\bplease (?:sign|log) in\b(?! again)/iu

/** `STEWARD_SIGN_IN_WALL=off`: a login wall without a password field (an SSO button, "Sign in to continue") is not a sign-in page. */
export const signInWallEnabled = (env: NodeJS.ProcessEnv = process.env) => env.STEWARD_SIGN_IN_WALL?.trim().toLowerCase() !== 'off'

export interface SignInPage {
  url: string | null
  /** The web area's title (for example "Sign in - Google Accounts"). */
  title: string | null
  /** The page's own text, if read for this frame. */
  pageText?: string | null
  /** A password field is visible in the captured frame. */
  passwordField: boolean
  /** Names of the frame's controls and headings, for wording beside a password field. */
  controlTexts?: readonly string[]
}

export function detectSignInPage(page: SignInPage): SiteBoundary | null {
  let host = '', path = ''
  if (page.url) { try { const parsed = new URL(page.url); host = parsed.hostname.replace(/^www\./u, ''); path = parsed.pathname } catch { /* no address */ } }
  if (host && identityProviderHosts.test(host)) return { kind: 'authentication', evidence: host.slice(0, 80) }
  const title = (page.title ?? '').replace(/\s+/gu, ' ').trim()
  const text = (page.pageText ?? '').trim()
  const lead = text.replace(/\s+/gu, ' ').length <= SOFT_PAGE_MAX_CHARS
    ? text.split('\n').map(line => line.replace(/\s+/gu, ' ').trim()).filter(line => line && line.length <= SOFT_LINE_MAX).slice(0, SOFT_LEAD_LINES)
    : []
  const worded = [title, ...lead].find(line => signInWording.test(line))
  // Only the opening of a short page: an article titled "Turn on 2-Step Verification" is not the challenge.
  for (const line of lead) {
    for (const pattern of reverification) {
      const match = pattern.exec(line)
      if (match) return { kind: 'authentication', evidence: match[0].slice(0, 80) }
    }
  }
  const besidePassword = page.passwordField ? (page.controlTexts ?? []).map(value => value.replace(/\s+/gu, ' ').trim()).find(value => value.length <= SOFT_LINE_MAX && signInWording.test(value)) : undefined
  if (path && signInPath.test(path) && (page.passwordField || worded)) return { kind: 'authentication', evidence: `${host}${path}`.slice(0, 80) }
  if (page.passwordField && (worded || besidePassword)) return { kind: 'authentication', evidence: (worded ?? besidePassword)!.slice(0, 80) }
  // A login wall with no password field in view (a "Sign in to continue" page with a single sign-in button or a
  // single-sign-on choice): the page's title or its first lines say it is withheld. Its read text is required, so a
  // title alone on a page whose text was not read never pauses.
  if (signInWallEnabled() && lead.length) {
    const wall = [title, ...lead.slice(0, 6)].find(line => signInWall.test(line))
    if (wall) return { kind: 'authentication', evidence: wall.slice(0, 80) }
  }
  return null
}

/** A visible password field in a captured frame. Its value is never read. */
export function passwordFieldInFrame(elements: readonly LiveComputerElement[]): boolean {
  return elements.some(element => element.subrole === 'AXSecureTextField' || (element.sensitive && /text ?field/iu.test(element.role)))
}

const identityProviderNames: Array<[RegExp, string]> = [
  [/(?:^|\.)google\.com$/u, 'Google'], [/(?:^|\.)(?:microsoftonline|microsoft|live)\.com$/u, 'Microsoft'], [/(?:^|\.)apple\.com$/u, 'Apple'],
  [/(?:^|\.)aws\.amazon\.com$/u, 'AWS'], [/(?:^|\.)yahoo\.com$/u, 'Yahoo'], [/(?:^|\.)atlassian\.com$/u, 'Atlassian'], [/(?:^|\.)openai\.com$/u, 'OpenAI'],
]
/** The name a person knows a sign-in by: "Google" for accounts.google.com; any other site by its host. */
export function signInSiteName(site: string | null): string | null {
  if (!site) return null
  return identityProviderHosts.test(site) ? identityProviderNames.find(([pattern]) => pattern.test(site))?.[1] ?? site : site
}

/** What the person is asked while Carve waits at a sign-in. */
export function signInHandoffMessage(site: string | null): string {
  return `${signInSiteName(site) ?? 'This site'} wants you to sign in. Sign in in the window (Carve never types passwords), then Carve will continue.`
}

/** The stop when nobody signs in (declined, timed out, or no person present). */
export function signInLeftMessage(site: string | null): string {
  const name = signInSiteName(site)
  return `Carve paused at the ${name ?? 'site'} sign-in and nothing was typed there. Signing in is yours to do, so the work that needed ${name ?? 'that site'} is unfinished. Sign in, then continue and Carve will pick up from there.`
}
