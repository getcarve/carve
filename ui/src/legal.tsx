import { useEffect, useState } from 'react'
import { ArrowUpRight, FileText, MousePointer2, ShieldCheck, X } from 'lucide-react'
import policies from '../../legal/documents.json'
import { invoke } from './api'
import { Button, Card, Dialog } from './components'
import type { CloudStatus } from '../../src/cloud/client'
import './legal.css'

export const LEGAL_VERSION = policies.version
export type LegalDocumentId = 'terms' | 'privacy' | 'ai-disclosure'
const icons = [FileText, ShieldCheck, MousePointer2]
const text = (value: string) => value.replaceAll('{{COMPANY_LEGAL_NAME}}', 'Carvify, Inc.')

export function LegalReader({ initial, onDismiss }: { initial: LegalDocumentId; onDismiss: () => void }) {
  const [selected, setSelected] = useState(initial)
  const [website, setWebsite] = useState<string | null>(null)
  const doc = policies.documents.find(item => item.id === selected)!
  useEffect(() => { let active = true; void invoke<CloudStatus>({ kind: 'cloud.status' }).then(status => {
    if (active && status.baseUrl && /^https?:\/\//u.test(status.baseUrl)) setWebsite(status.baseUrl)
  }).catch(() => {}); return () => { active = false } }, [])
  return <Dialog title="Carve legal center" onDismiss={onDismiss} className="legal-reader">
    <div className="legal-reader__bar"><span>Carvify, Inc. · Delaware corporation</span><Button variant="ghost" size="small" onClick={onDismiss} aria-label="Close legal document"><X size={17} /></Button></div>
    <nav className="legal-reader__tabs" aria-label="Legal documents">{policies.documents.map(item => <button type="button" key={item.id} aria-current={selected === item.id ? 'page' : undefined} onClick={() => setSelected(item.id as LegalDocumentId)}>{item.title}</button>)}</nav>
    <div className="legal-reader__body" key={selected}>
      <header><span className="legal-eyebrow">{doc.eyebrow} · {policies.date}</span><h1>{doc.title}</h1><p>{doc.description}</p></header>
      <div className="legal-reader__summary"><span className="legal-eyebrow">The short version</span><p>{doc.summary}</p><small>The full text below governs.</small></div>
      <nav className="legal-reader__contents" aria-label="Sections">{doc.sections.map(section => <a key={section.id} href={`#legal-${selected}-${section.id}`}>{section.title}</a>)}</nav>
      <article>{doc.sections.map(section => <section id={`legal-${selected}-${section.id}`} key={section.id}><h2>{section.title}</h2>{section.paragraphs.map((paragraph,index) => <p key={index}>{text(paragraph)}</p>)}</section>)}</article>
      {website ? <a className="legal-reader__contact" href={`${website}/legal`} target="_blank" rel="noreferrer">Contact details & public legal documents <ArrowUpRight size={14} /></a> : <p className="legal-reader__contact">For contact details, see the legal website supplied with your Carve release.</p>}
    </div>
  </Dialog>
}

export function LegalLinks({ compact = false }: { compact?: boolean }) {
  const [selected, setSelected] = useState<LegalDocumentId | null>(null)
  return <><nav className={`legal-links ${compact ? 'legal-links--compact' : ''}`} aria-label="Legal information">{policies.documents.map(doc => <button type="button" key={doc.id} onClick={() => setSelected(doc.id as LegalDocumentId)}>{doc.title}</button>)}</nav>{selected ? <LegalReader initial={selected} onDismiss={() => setSelected(null)} /> : null}</>
}

export function LegalCenterCard() {
  const [selected, setSelected] = useState<LegalDocumentId | null>(null)
  return <Card className="legal-center"><div className="legal-center__heading"><span className="legal-eyebrow">Your rights. Your choices.</span><h2>Trust, in plain sight.</h2><p>Understand how Carve works, what it shares, and the agreement behind it.</p></div><div className="legal-center__cards">{policies.documents.map((doc,index) => { const Icon = icons[index]!; return <button type="button" key={doc.id} onClick={() => setSelected(doc.id as LegalDocumentId)}><span><Icon size={19} /><ArrowUpRight size={16} /></span><strong>{doc.title}</strong><small>{doc.description}</small></button> })}</div><p className="legal-center__entity">Carvify, Inc. · A Delaware corporation · Edition {LEGAL_VERSION}</p>{selected ? <LegalReader initial={selected} onDismiss={() => setSelected(null)} /> : null}</Card>
}

export function LegalAcceptance({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return <div className="legal-acceptance"><LegalLinks compact /><label><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} /><span>I am at least 18 and agree to the Terms of Use. I acknowledge the Privacy Policy and AI & computer-control disclosures.</span></label><p><strong>U.S. users:</strong> the Terms include individual arbitration and a class-action waiver, with exceptions and a 30-day opt-out. This does not authorize a purchase or screen sharing.</p></div>
}

/** Acceptance is persisted by the local process, not inferred from page visits. */
export function LegalBoundary({ children, allowManagement, onManageData }: { children: React.ReactNode; allowManagement: boolean; onManageData: () => void }) {
  const [accepted, setAccepted] = useState<boolean | null>(null)
  const [checked, setChecked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Without the hosted service there is no agreement to accept: the person sees the same two disclosures and continues.
  const [termsRequired, setTermsRequired] = useState(true)
  const load = () => { void invoke<{ receipt: unknown; termsRequired?: boolean; acknowledgment?: unknown }>({ kind: 'legal.status' }).then(status => {
    const required = status.termsRequired !== false
    setTermsRequired(required); setAccepted(Boolean(status.receipt) || (!required && Boolean(status.acknowledgment))); setError(null)
  }).catch(() => { setError('Your agreement status could not be loaded. Please try again.') }) }
  useEffect(load, [allowManagement])
  if (accepted || allowManagement) return <>{children}</>
  // Until the status is known, show neither screen: an own-key install must not flash the hosted agreement.
  if (accepted === null && !error) return <section className="legal-welcome" aria-busy="true" aria-label="Welcome to Carve" />
  if (!termsRequired) return <section className="legal-welcome" aria-label="Welcome to Carve"><span className="legal-eyebrow">Welcome to Carve</span><h1>Your Mac.<br /><em>Your call.</em></h1><p>AI that helps you work deserves clear expectations.<br />Take a moment to understand yours.</p><div className="legal-welcome__facts"><div><MousePointer2 size={20} /><strong>Real actions, in your apps</strong><p>Review the work you authorize. AI can make mistakes, and completed actions may not be reversible.</p></div><div><ShieldCheck size={20} /><strong>Know what you share</strong><p>The model provider you chose receives window images and task context. You choose screen-sharing permissions separately.</p></div></div><div className="legal-acceptance"><LegalLinks compact /><p>You are running Carve with your own model key. The code is open source under AGPL-3.0. The Terms of Use and Privacy Policy cover Carve’s hosted plan and apply only if you sign in to it.</p></div>{error ? <p role="alert">{error}</p> : null}<div className="legal-welcome__actions"><Button disabled={busy || accepted === null} onClick={() => {
    setBusy(true)
    void invoke({ kind: 'legal.acknowledge', version: LEGAL_VERSION }).then(() => { setAccepted(true); setError(null) }).catch(() => setError('This could not be saved. Please try again.')).finally(() => setBusy(false))
  }}>{busy ? 'Saving…' : 'I understand'}</Button>{error ? <Button variant="secondary" onClick={load}>Try again</Button> : null}<Button variant="ghost" onClick={onManageData}>Manage existing data</Button></div><small>Carve · Open source under AGPL-3.0 · Edition {LEGAL_VERSION}</small></section>
  return <section className="legal-welcome" aria-label="Welcome and legal agreement"><span className="legal-eyebrow">Welcome to Carve</span><h1>Your Mac.<br /><em>Your call.</em></h1><p>AI that helps you work deserves clear expectations.<br />Take a moment to understand yours.</p><div className="legal-welcome__facts"><div><MousePointer2 size={20} /><strong>Real actions, in your apps</strong><p>Review the work you authorize. AI can make mistakes, and completed actions may not be reversible.</p></div><div><ShieldCheck size={20} /><strong>Know what you share</strong><p>Hosted AI can receive window images and task context. You choose screen-sharing permissions separately.</p></div></div><LegalAcceptance checked={checked} onChange={setChecked} />{error ? <p role="alert">{error}</p> : null}<div className="legal-welcome__actions"><Button disabled={!checked || busy || accepted === null} onClick={() => {
    setBusy(true)
    void invoke({ kind: 'legal.accept', version: LEGAL_VERSION }).then(() => { setAccepted(true); setError(null) }).catch(() => setError('Your agreement could not be saved. Please try again.')).finally(() => setBusy(false))
  }}>{busy ? 'Saving…' : 'Agree & continue'}</Button>{error ? <Button variant="secondary" onClick={load}>Try again</Button> : null}<Button variant="ghost" onClick={onManageData}>Manage existing data</Button></div><small>Carvify, Inc. · A Delaware corporation · Edition {LEGAL_VERSION}</small></section>
}
