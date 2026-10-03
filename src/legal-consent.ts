import { LEGAL_CONTENT_SHA256, LEGAL_VERSION } from './legal-version.js'

type Settings = { getSetting(key: string): string | null; setSetting(key: string, value: string): void }
export interface LocalLegalReceipt { version: string; contentSha256: string; acceptedAt: string; method: 'explicit_checkbox' }
const key = `legal.acceptance.${LEGAL_VERSION}`

export function legalStatus(database: Settings): { version: string; receipt: LocalLegalReceipt | null } {
  try {
    const value = JSON.parse(database.getSetting(key) ?? 'null') as LocalLegalReceipt | null
    if (value?.version === LEGAL_VERSION && value.contentSha256 === LEGAL_CONTENT_SHA256 && value.method === 'explicit_checkbox' && typeof value.acceptedAt === 'string' && Number.isFinite(Date.parse(value.acceptedAt))) return { version: LEGAL_VERSION, receipt: value }
  } catch { /* Missing or invalid receipts never imply acceptance. */ }
  return { version: LEGAL_VERSION, receipt: null }
}

export function acceptLegal(database: Settings, version: string): LocalLegalReceipt {
  if (version !== LEGAL_VERSION) throw new Error('Review the current Terms of Use before accepting.')
  const prior = legalStatus(database).receipt
  if (prior) return prior
  const receipt: LocalLegalReceipt = { version, contentSha256: LEGAL_CONTENT_SHA256, acceptedAt: new Date().toISOString(), method: 'explicit_checkbox' }
  database.setSetting(key, JSON.stringify(receipt))
  return receipt
}

export interface DisclosureAcknowledgment { version: string; acknowledgedAt: string; method: 'explicit_button' }
const acknowledgmentKey = `legal.disclosure_acknowledgment.${LEGAL_VERSION}`

/** A person running Carve on their own model key has no agreement with the hosted service to accept: the code is
 * theirs under its open-source license. They are shown the same two disclosures (real actions in their apps; what
 * is shared with the model provider), and this records that they continued past them. It is not acceptance of the
 * Terms of Use, and signing in to the hosted plan still requires that. */
export function disclosureAcknowledgment(database: Settings): DisclosureAcknowledgment | null {
  try {
    const value = JSON.parse(database.getSetting(acknowledgmentKey) ?? 'null') as DisclosureAcknowledgment | null
    if (value?.version === LEGAL_VERSION && value.method === 'explicit_button' && typeof value.acknowledgedAt === 'string' && Number.isFinite(Date.parse(value.acknowledgedAt))) return value
  } catch { /* A missing or invalid record never implies acknowledgment. */ }
  return null
}

export function acknowledgeDisclosures(database: Settings, version: string): DisclosureAcknowledgment {
  if (version !== LEGAL_VERSION) throw new Error('Review the current disclosures before continuing.')
  const prior = disclosureAcknowledgment(database)
  if (prior) return prior
  const acknowledgment: DisclosureAcknowledgment = { version, acknowledgedAt: new Date().toISOString(), method: 'explicit_button' }
  database.setSetting(acknowledgmentKey, JSON.stringify(acknowledgment))
  return acknowledgment
}

/** Whether new work may start. With the hosted service configured (`termsRequired`), only accepted Terms of Use
 * clear the first run. Without it, acknowledged disclosures do as well. */
export function firstRunCleared(database: Settings, termsRequired: boolean): boolean {
  return legalStatus(database).receipt !== null || (!termsRequired && disclosureAcknowledgment(database) !== null)
}

export function firstRunStatus(database: Settings, termsRequired: boolean): { version: string; receipt: LocalLegalReceipt | null; termsRequired: boolean; acknowledgment: DisclosureAcknowledgment | null } {
  return { ...legalStatus(database), termsRequired, acknowledgment: disclosureAcknowledgment(database) }
}

/** New terms must never prevent stopping work or accessing/deleting existing data. */
export function mayUseBeforeLegalAcceptance(kind: string): boolean {
  return ['legal.status', 'legal.accept', 'legal.acknowledge', 'state.get', 'desktop.status', 'cloud.status', 'cloud.signout', 'cloud.signout_all', 'cloud.portal', 'cloud.delete_account', 'cloud.signin.start', 'cloud.signin.status', 'cloud.browser.cancel', 'cloud.signin.verify', 'data.export', 'data.purge', 'system.global_stop', 'computer.status', 'native.capture.status', 'computer.surface_preferences.get'].includes(kind)
    || kind.endsWith('.pause') || kind.endsWith('.stop')
}
