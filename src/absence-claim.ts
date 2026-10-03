/** Local checks on an Explain (visible-window) answer before it is presented as final.
 *
 * The Explain route reads one screenshot plus at most ~200 accessibility elements: in practice the visible part of the
 * page. doc-0929 web sets: "This page doesn't show a specific latest Scala version" (the page lists "Current 3.9.x
 * release: 3.9.0" further down), "The page does not show the current stable version" (MariaDB, the release list sits
 * below the cookie banner), "I can't confirm the current stable version ... because the cookie banner covers the
 * release details". A statement that the page lacks something is only as good as the part of the page that was read,
 * so in Do mode such an answer goes to the window route, which reads the whole page.
 *
 * The detector is structural rather than a list of whole phrases: a negation next to a reporting verb ("doesn't show",
 * "is not listed", "isn't clearly mentioned", "not specified"), a first-person inability to find or confirm ("I can't
 * confirm", "I couldn't find"), "no X is shown/marked", and "there is no X on this page". Quoted spans (page text) and
 * conditional clauses ("If the icon doesn't appear, ...") are ignored. Verbs that also state facts about the product
 * ("doesn't include", "has no") count only when their subject is the page or part of it.
 *
 * `STEWARD_ABSENCE_CLAIM_WINDOW=off` removes the absence check; `STEWARD_SCHEDULED_NOT_LATEST=off` removes the
 * scheduled-called-latest check. */

export function absenceClaimWindowEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STEWARD_ABSENCE_CLAIM_WINDOW?.trim().toLowerCase() !== 'off'
}
export function scheduledNotLatestEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STEWARD_SCHEDULED_NOT_LATEST?.trim().toLowerCase() !== 'off'
}

const negation = String.raw`(?:\bnot\b|n't\b|\bcannot\b|\bnever\b|\bno longer\b|\bnowhere\b)`
const filler = String.raw`(?:\s+(?!only\b|but\b|and\b|or\b)[\p{L}-]+){0,3}?`
const discourse = String.raw`(?:show|shows|shown|showing|list|lists|listed|listing|mention|mentions|mentioned|state|states|stated|say|says|said|specify|specifies|specified|display|displays|displayed|indicate|indicates|indicated|appear|appears|visible|marked|label(?:l)?ed|named|given|confirmed|determined|verified|found|identified)`
const pageSubject = String.raw`\b(?:page|site|window|screen|view|article|section|table|list|document|tab|selector|menu|banner|notice|sidebar|header|footer|release notes|changelog)\b`
const objectVerb = String.raw`(?:include|includes|included|contain|contains|contained|have|has|give|gives|provide|provides|provided|offer|offers|cover|covers|feature|features)`

const patterns: RegExp[] = [
  // "doesn't show", "is not listed", "isn't clearly mentioned", "not specified", "can't be confirmed"
  new RegExp(String.raw`${negation}${filler}\s+${discourse}\b`, 'iu'),
  // "I can't confirm", "I couldn't find", "we don't see", "I'm unable to determine"
  new RegExp(String.raw`\b(?:i|we)(?:'m| am|'re| are| was| were)?\s+(?:don't|didn't|couldn't|can't|wasn't|weren't|haven't|do not|did not|could not|cannot|can not|have not|unable to|not able to)${filler}\s+(?:see|find|confirm|tell|determine|verify|locate|spot|read|identify|make out)\b`, 'iu'),
  // "the page doesn't include", "the table has no" (object verbs only with a page-like subject)
  new RegExp(String.raw`${pageSubject}[^,;:]{0,40}?${negation}${filler}\s+${objectVerb}\b`, 'iu'),
  new RegExp(String.raw`${pageSubject}[^,;:]{0,40}?\b(?:has|have|had|contains|gives|lists|shows)\s+no\b`, 'iu'),
  // "no specific version number is visible", "none of the releases is marked LTS", "no LTS label"
  new RegExp(String.raw`\b(?:no|none of)\b(?:\s+[\p{L}\p{N}-]+){0,6}?\s+(?:(?:is|are|was|were|appears?|seems?|gets?)\s+)?(?:shown|listed|mentioned|given|stated|specified|displayed|visible|marked|label(?:l)?ed|included|provided|indicated|named)\b`, 'iu'),
  // "there is no stable version on this page", "nothing in the visible page", "no mention of"
  new RegExp(String.raw`\bthere(?:'s| is| are| was| were)\s+no\b[^,;:]{0,80}?\b(?:on|in|from)\s+(?:this|the)\s+(?:visible\s+)?(?:page|window|screen|view|site|section|part)\b`, 'iu'),
  new RegExp(String.raw`\bnothing\b[^,;:]{0,40}?\b(?:on|in)\s+(?:this|the)\s+(?:visible\s+)?(?:page|window|screen|view|site|section|part)\b`, 'iu'),
  /\bno (?:mention|reference|sign|indication) of\b/iu,
]

const conditional = /^(?:if|when|whenever|unless|until|in case|once|make sure|ensure|otherwise)\b/iu

function clauses(text: string): string[] {
  const plain = text.replace(/[‘’]/gu, "'")
    // Quoted spans are the page's own words ("Do not show again"), not the answer's claim.
    .replace(/“[^”]{0,300}”|"[^"]{0,300}"|`[^`]{0,300}`/gu, ' "" ')
  return plain.split(/[.;:!?]+(?:\s|$)|,\s+|\s+(?:but|while|although|though|whereas)\s+/iu).map(clause => clause.trim()).filter(Boolean)
}

/** The answer asserts that the page or window does not show, list, contain or mention something. */
export function claimsAbsence(text: string | null | undefined): boolean {
  if (!text) return false
  return clauses(text).some(clause => !conditional.test(clause) && patterns.some(pattern => pattern.test(clause)))
}

const latestClaim = /\b(?:latest|newest|current|most recent)(?:\s+(?:stable|final|official|full|major|minor|point))?\s+(?:release|version)\b/iu
const versionToken = /\b\d+(?:\.\d+){1,3}\b/gu
const future = /\b(?:schedul(?:ed|es|ing)|will (?:be (?:released|published|available|out)|appear|ship|arrive|come out|land)|upcoming|planned|pre-?releases?|release candidates?|expected (?:on|in|to|by)|due (?:on|in|out|by)|coming soon|not (?:yet|been) released|set to (?:appear|be released|ship|arrive))\b/iu
const released = /\b(?:was|were|has been|have been|got) released\b|\breleased (?:on|in)\b/iu

/** The answer calls a version the latest or current release while its own words say that version is scheduled,
 * upcoming or a prerelease (doc-0929 i-r-latest r1: "The latest release listed is R 4.6.2 ..., with prerelease
 * versions starting October 19, 2026; the page schedules the final release for October 29, 2026", while the page's
 * news also says "R version 4.6.1 ... has been released on 2026-06-24"). The words about the named version run from it
 * to the next version number; an answer that names the released version as latest and the scheduled one after it
 * ("The latest release is 4.6.1, released June 24; 4.6.2 is scheduled for October 29") is not flagged. */
export function scheduledCalledLatest(text: string | null | undefined): boolean {
  if (!text) return false
  const plain = text.replace(/[‘’]/gu, "'")
  const claim = latestClaim.exec(plain)
  if (!claim) return false
  const after = plain.slice(claim.index + claim[0].length)
  const versions = [...after.matchAll(versionToken)]
  const first = versions[0]
  if (!first || first.index === undefined) return false
  // The claim must name the version within its own sentence.
  if (/[.!?](?:\s|$)/u.test(after.slice(0, first.index).replace(/\b\d+\.\d+/gu, ''))) return false
  const start = first.index + first[0].length
  const next = versions.find(match => match.index !== undefined && match.index >= start && match[0] !== first[0])
  const about = after.slice(start, next?.index ?? after.length)
  return future.test(about) && !released.test(about)
}
