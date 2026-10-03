import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { parseVoicePreference, type VoicePreference } from './voice-settings.js'
export function readVoicePreference(path: string): VoicePreference {
  try {
    const stored = JSON.parse(readFileSync(path, 'utf8'))
    const preference = parseVoicePreference(stored)
    return { ...preference, enabled: stored?.sharingVersion === 1 && preference.enabled }
  }
  catch { return parseVoicePreference(null) }
}
export function writeVoicePreference(path: string, preference: VoicePreference): void {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify({ ...preference, sharingVersion: 1 }), { mode: 0o600, flag: 'wx' })
    renameSync(temporary, path)
  } finally { try { unlinkSync(temporary) } catch { /* Already renamed or never created. */ } }
}
