import { VoiceSettingsCard } from './voice-settings'
import { useState } from 'react'
import { Check, Download, Eye, FlaskConical, LockKeyhole, MousePointer2, RefreshCw, Trash2 } from 'lucide-react'
import { invoke } from './api'
import { Button, Card, Dialog, Field, PageIntro, SectionHeading, Toggle } from './components'
import { CloudAccountCard } from './cloud-account'
import { LegalLinks } from './legal'
import type { ViewProps } from './views'

/** Consumer settings keep account, access and data controls close at hand.
 * Architecture switches remain in the separate development experience. */
export function CopilotSettings({ state, desktop, refresh, notify }: ViewProps) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'export' | 'delete' | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [connection, setConnection] = useState<string | null>(null)
  const active = state.providers.find(provider => provider.active && provider.kind !== 'mock')
  const hasSavedLearning = state.sessions.length > 0 || state.procedures.length > 0 || state.semanticMemory.entities.length > 0
  const run = async (name: string, action: () => Promise<void>) => {
    if (busy) return
    setBusy(name); setError(null)
    try { await action(); await refresh() }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { setBusy(null) }
  }
  const close = () => { if (!busy) { setDialog(null); setPassphrase(''); setConfirmation(''); setError(null) } }
  return <div className="page page--copilot-settings">
    <PageIntro label="Settings" title="Make yourself at home." description="Your connection, your permissions, your data." />
    {error && !dialog ? <div className="connection-warning" role="alert">{error}</div> : null}
    <div className="copilot-settings-grid">
      <section className="copilot-settings-main">
        <CloudAccountCard notify={notify} desktop={desktop.desktop} focused />
        <VoiceSettingsCard />
        {active ? <Card>
          <SectionHeading eyebrow="AI connection" title={active.name} description={active.kind === 'hosted' ? 'Selected window images and relevant task context are shared with this service when you allow it.' : 'This connection runs on your Mac.'} />
          <div className="copilot-setting-row"><span>{active.configured ? 'Connected on this Mac' : 'Connection needs setup'}</span><Button variant="secondary" size="small" disabled={Boolean(busy)} onClick={() => void run('connection', async () => {
            const result = await invoke<{ ok: boolean; message: string }>({ kind: 'provider.action', providerId: active.id, action: 'health' })
            setConnection(result.ok ? 'Connection is ready.' : result.message)
          })}><RefreshCw size={15} />{busy === 'connection' ? 'Checking…' : 'Check connection'}</Button></div>
          {connection ? <p role="status" className="copilot-setting-note">{connection}</p> : null}
        </Card> : null}
        <Card>
          <SectionHeading eyebrow="Permissions" title="Only when you need it" description="Choose a window before asking for help. Microphone access is requested only when you use dictation." />
          {([
            ['screenRecording', 'See your selected window', 'Read the page or controls you ask about.', Eye, 'computer.request_screen_recording_permission'],
            ['accessibility', 'Point, click, and type', 'Interact with the window you choose.', MousePointer2, 'computer.request_accessibility_permission'],
          ] as const).map(([permission, title, detail, Icon, kind]) => <div className="copilot-permission" key={permission}>
            <Icon size={20} /><div><strong>{title}</strong><small>{detail}</small></div>
            {desktop.permissions[permission] === 'granted' ? <span className="copilot-granted"><Check size={15} /> Allowed</span> : <Button variant="secondary" size="small" disabled={!desktop.desktop || Boolean(busy)} onClick={() => void run(permission, async () => { await invoke({ kind }) })}>{desktop.permissions[permission] === 'denied' ? 'Open Settings' : 'Allow'}</Button>}
          </div>)}
          <Button variant="ghost" size="small" disabled={Boolean(busy)} onClick={() => void run('permissions', refresh)}><RefreshCw size={14} /> Check permissions again</Button>
        </Card>
        {state.product.localDiagnostics ? <Card>
          <SectionHeading eyebrow="Local build" title="Model" description="Developer toggle for this Mac only. Applies to new tasks; the capsule shows the model in use." />
          <div className="copilot-setting-row">
            <div className="assistance-segments" role="group" aria-label="Computer-use model">
              {([['astra', 'Astra'], ['adaptive_5_6', 'Sol']] as const).map(([profile, label]) => <button key={profile} type="button" aria-pressed={state.liveComputer.modelProfile === profile} disabled={Boolean(busy)} onClick={() => void run('model', async () => {
                await invoke<{ profile: 'adaptive_5_6' | 'astra' }>({ kind: 'computer.model_profile.set', profile })
              })}>{label}</button>)}
            </div>
            <span className="copilot-setting-note"><FlaskConical size={14} /> {state.liveComputer.modelDebugTag ?? '—'}{state.liveComputer.modelPolicy ? ` · ${state.liveComputer.modelPolicy.strategyModel === state.liveComputer.modelPolicy.executionModel ? state.liveComputer.modelPolicy.strategyModel : `${state.liveComputer.modelPolicy.strategyModel} / ${state.liveComputer.modelPolicy.executionModel}`} · from ${state.liveComputer.modelPolicy.source}` : ''}</span>
          </div>
          <Toggle
            checked={state.liveComputer.serviceTier?.tier === 'fast'}
            disabled={Boolean(busy) || state.liveComputer.serviceTier?.source === 'environment'}
            onChange={(enabled) => void run('fast_mode', async () => { await invoke({ kind: 'computer.service_tier.set', tier: enabled ? 'fast' : 'default' }) })}
            label="Fast mode"
            description={state.liveComputer.serviceTier?.source === 'environment' ? `Set by STEWARD_OPENAI_SERVICE_TIER=${state.liveComputer.serviceTier.tier} in the environment.` : 'Direct OpenAI requests for choosing each step ask for fast processing at twice the standard token price. The stronger model that checks answers stays at the standard price. Carve Cloud requests are unaffected.'}
          />
        </Card> : null}
        <Card>
          <SectionHeading eyebrow="History & privacy" title="Your work stays yours" description="Task history is stored on this Mac. Hosted AI receives the context needed for your request; its retention policies also apply." />
          <p className="copilot-setting-note">{state.dataBoundary.encryptionAtRest}</p>
          <div className="copilot-data-actions"><Button variant="secondary" onClick={() => { setDialog('export'); setError(null) }}><Download size={16} /> Export data</Button><Button variant="ghost" onClick={() => { setDialog('delete'); setError(null) }}><Trash2 size={16} /> Delete local data</Button></div>
          {hasSavedLearning ? <details className="copilot-saved-work"><summary>Previously saved learning</summary><p>Your earlier sessions and memory are saved locally on this device. New copilot tasks do not search this history.</p></details> : null}
        </Card>
      </section>
      <aside>
        <Card><SectionHeading eyebrow="At your fingertips" title="A little help, anywhere" /><dl className="copilot-shortcuts"><div><dt>Explain a window</dt><dd><kbd>{desktop.guideShortcut}</kbd></dd></div>{desktop.doItShortcut ? <div><dt>Take action</dt><dd><kbd>{desktop.doItShortcut}</kbd></dd></div> : null}<div><dt>Stop immediately</dt><dd><kbd>{desktop.globalStopShortcut}</kbd></dd></div></dl></Card>
        <Card><LockKeyhole size={21} /><h3>Clear by design</h3><p className="copilot-setting-note">A selected window. A task you choose. Visible work, with Stop always available during a task.</p><LegalLinks compact /></Card>
        <p className="copilot-version">Carve {desktop.version} · Local preview<br />macOS copilot</p>
      </aside>
    </div>
    {dialog ? <Dialog title={dialog === 'export' ? 'Protect your export' : 'Delete data on this Mac?'} description={dialog === 'export' ? 'Choose a passphrase of at least 12 characters. Keep it somewhere safe; it cannot be recovered.' : 'This permanently removes local history and saved learning. Your cloud account is separate.'} onDismiss={close}>
      <form onSubmit={event => { event.preventDefault(); void run(dialog, async () => {
        if (dialog === 'export') {
          if (passphrase.length < 12 || confirmation !== passphrase) throw new Error('Use at least 12 characters and match both passphrases.')
          const result = await invoke({ kind: 'data.export', passphrase })
          const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }))
          const link = document.createElement('a'); link.href = url; link.download = `carve-export-${new Date().toISOString().slice(0, 10)}.steward`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
          notify('Export prepared.', 'positive')
        } else {
          if (confirmation !== 'DELETE') throw new Error('Type DELETE to confirm.')
          await invoke({ kind: 'data.purge', confirmation: 'DELETE ALL STEWARD DATA' }); notify('Local data deleted.', 'positive')
        }
        setDialog(null); setPassphrase(''); setConfirmation('')
      }) }}>
        {dialog === 'export' ? <Field label="Passphrase"><input autoFocus type="password" autoComplete="new-password" value={passphrase} onChange={event => setPassphrase(event.target.value)} /></Field> : null}
        <Field label={dialog === 'export' ? 'Confirm passphrase' : 'Type DELETE to confirm'}><input type={dialog === 'export' ? 'password' : 'text'} autoComplete="off" value={confirmation} onChange={event => setConfirmation(event.target.value)} /></Field>
        {error ? <p role="alert">{error}</p> : null}
        <div className="dialog__buttons"><Button variant={dialog === 'delete' ? 'danger' : 'primary'} disabled={Boolean(busy) || (dialog === 'export' ? passphrase.length < 12 || confirmation !== passphrase : confirmation !== 'DELETE')}>{busy ? 'Working…' : dialog === 'export' ? 'Export encrypted data' : 'Delete local data'}</Button><Button type="button" variant="ghost" disabled={Boolean(busy)} onClick={close}>Cancel</Button></div>
      </form>
    </Dialog> : null}
  </div>
}
