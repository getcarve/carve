import { useEffect, useRef, useState } from 'react'
import { voices, type VoiceSettings, type VoiceId } from '../../src/voice-settings'
import { invoke } from './api'
import { Button, Card, Field, SectionHeading, Toggle } from './components'

export function VoiceSettingsCard() {
  const [settings, setSettings] = useState<VoiceSettings | null>(null)
  const [sharing, setSharing] = useState<{ allowed: boolean; remembered: boolean } | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const audio = useRef<HTMLAudioElement | null>(null)
  const url = useRef<string | null>(null)
  const generation = useRef(0)
  const mounted = useRef(false)
  const stopAudio = () => {
    if (audio.current) { audio.current.pause(); audio.current.removeAttribute('src'); audio.current.load(); audio.current = null }
    if (url.current) { URL.revokeObjectURL(url.current); url.current = null }
  }
  const stopPreview = () => {
    generation.current++
    stopAudio()
    setPreviewing(false)
    void invoke({ kind: 'voice.preview.stop' }).catch(() => {})
  }
  useEffect(() => {
    mounted.current = true
    void invoke<{ allowed: boolean; remembered: boolean }>({ kind: 'dictation.sharing.get' }).then(value => { if (mounted.current) setSharing(value) }).catch(() => {})
    const bridge = window.stewardDesktop
    if (!bridge) return () => { mounted.current = false }
    let changed = false
    const unsubscribeSettings = bridge.onVoiceSettings(value => { changed = true; setSettings(value) })
    void invoke<{ receipt: unknown }>({ kind: 'legal.status' }).then(legal => {
      if (!legal.receipt) { if (mounted.current) setError('Review the welcome screen in Home to set up spoken replies.'); return null }
      return invoke<VoiceSettings>({ kind: 'voice.settings.get' })
    }).then(value => {
      if (value && mounted.current && !changed) setSettings(value)
    }).catch(reason => { if (mounted.current) setError(String(reason)) })
    const unsubscribeAudio = bridge.onVoicePreview(packet => {
      stopAudio()
      if (packet.kind === 'error') { setError('This voice could not be previewed. Please try again.'); return }
      if (packet.kind !== 'audio') return
      const data = Uint8Array.from(atob(packet.audioBase64), character => character.charCodeAt(0))
      url.current = URL.createObjectURL(new Blob([data], { type: 'audio/mpeg' }))
      const player = new Audio(url.current)
      audio.current = player
      const report = (state: 'started' | 'ended' | 'error') => {
        if (audio.current !== player) return
        void invoke({ kind: 'voice.preview.playback', id: packet.id, state }).catch(() => {})
        if (state !== 'started') {
          stopAudio()
          if (state === 'error') setError('Audio playback failed. Please try again.')
        }
      }
      player.onended = () => report('ended')
      player.onerror = () => report('error')
      void player.play().then(() => report('started')).catch(() => report('error'))
    })
    const onHide = () => { if (document.hidden) { stopAudio(); void invoke({ kind: 'voice.preview.stop' }).catch(() => {}) } }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      mounted.current = false
      generation.current++
      unsubscribeSettings(); unsubscribeAudio(); stopAudio()
      document.removeEventListener('visibilitychange', onHide)
      void invoke({ kind: 'voice.preview.stop' }).catch(() => {})
    }
  }, [])
  const save = async (change: { enabled?: boolean; voiceId?: VoiceId }) => {
    stopPreview(); setSaving(true); setError('')
    try {
      const value = await invoke<VoiceSettings>({ kind: 'voice.settings.set', ...change })
      if (mounted.current) setSettings(value)
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (mounted.current) setSaving(false) }
  }
  const preview = async () => {
    if (!settings) return
    const id = ++generation.current
    setPreviewing(true); setError('')
    try { await invoke({ kind: 'voice.preview', voiceId: settings.voiceId }) }
    catch (reason) { if (mounted.current && id === generation.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (mounted.current && id === generation.current) { stopAudio(); setPreviewing(false) } }
  }
  return <Card>
    <SectionHeading eyebrow="Spoken replies" title="Voice" description="Choose how Carve sounds. Your choice is saved on this Mac and applies to the next reply." />
    {!window.stewardDesktop ? <p className="copilot-setting-note">Voice settings are available in the Carve desktop app.</p> : !settings ? <p role="status">{error || 'Loading voice settings…'}</p> : <div className="voice-settings-controls">
      <Toggle label="Spoken replies" description="Send reply text to Deepgram to read it aloud. Replies can include information from your windows. Your microphone stays off. Remembered until you turn this off; provider retention applies." checked={settings.enabled} disabled={saving || !settings.available} onChange={enabled => void save({ enabled })} />
      <Field label="Voice"><select aria-label="Voice" value={settings.voiceId} disabled={saving} onChange={event => void save({ voiceId: event.target.value as VoiceId })}>
        {voices.map(voice => <option key={voice.id} value={voice.id}>{voice.name} — {voice.description}</option>)}
      </select></Field>
      <Button variant="secondary" disabled={saving || !settings.available} onClick={() => previewing ? stopPreview() : void preview()}>{previewing ? 'Stop preview' : 'Preview voice'}</Button>
      <p className="copilot-setting-note">{!settings.available ? 'Add a Deepgram API key to use spoken replies and previews.' : previewing ? 'Preparing or playing your voice preview…' : 'Previews send a fixed sample sentence to Deepgram, without your task or window content.'}</p>
      <div className="voice-sharing-settings"><strong>Microphone audio</strong><p>Sent to Deepgram only while you dictate. Carve does not save audio. Submitted text can be saved with your task.</p><small>{sharing?.allowed ? sharing.remembered ? 'Allowed until you reset audio sharing.' : 'Allowed until Carve quits.' : 'Carve asks before you first dictate.'} Deepgram’s retention applies.</small>{sharing?.allowed ? <Button variant="secondary" disabled={saving} onClick={() => { setSaving(true); void invoke<{ allowed: boolean; remembered: boolean }>({ kind: 'dictation.sharing.set', enabled: false }).then(setSharing).catch(reason => setError(String(reason))).finally(() => setSaving(false)) }}>Reset audio sharing</Button> : null}</div>
      {(error || settings.saveError) && <p role="alert">{error || settings.saveError}</p>}
    </div>}
  </Card>
}
