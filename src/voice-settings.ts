export const voices = [
  { id: 'thalia', model: 'aura-2-thalia-en', name: 'Thalia', description: 'Clear and energetic' },
  { id: 'helena', model: 'aura-2-helena-en', name: 'Helena', description: 'Natural and friendly' },
  { id: 'apollo', model: 'aura-2-apollo-en', name: 'Apollo', description: 'Relaxed and conversational' },
  { id: 'arcas', model: 'aura-2-arcas-en', name: 'Arcas', description: 'Smooth and clear' },
  { id: 'aries', model: 'aura-2-aries-en', name: 'Aries', description: 'Warm and energetic' },
] as const
export type VoiceId = typeof voices[number]['id']
export interface VoicePreference { version: 1; enabled: boolean; voiceId: VoiceId }
export interface VoiceSettings extends VoicePreference { available: boolean; saveError?: string | undefined }
export function isVoiceId(value: unknown): value is VoiceId { return voices.some(voice => voice.id === value) }
export function parseVoicePreference(value: unknown): VoicePreference {
  const p = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return { version: 1, enabled: p.enabled === true, voiceId: isVoiceId(p.voiceId) ? p.voiceId : 'thalia' }
}
