import type { AuditLog } from './audit.js'
import { legacyIntervalForTiming, normalizeCaptureTiming } from './capture-timing.js'
import type { CarveDatabase } from './db.js'
import { getFixture } from './fixtures.js'
import { applyPrivacyPipeline, defaultCapturePolicy } from './privacy.js'
import type { CapturePolicy, CapturedFacts, LearningSession, ObservationRecord, ObservationSource } from './types.js'
import { id, nowIso, sha256, stableJson } from './util.js'

export class CaptureService {
  constructor(
    private readonly database: CarveDatabase,
    private readonly audit: AuditLog,
  ) {}

  start(name: string, fixtureId: string, patch: Partial<CapturePolicy> = {}): LearningSession {
    const fixture = getFixture(fixtureId)
    const active = this.database.listSessions().find((session) => session.status !== 'stopped')
    if (active) throw new Error(`Learning session ${active.id} is already ${active.status}`)
    const captureTiming = normalizeCaptureTiming(patch.captureTiming, patch.captureIntervalSeconds ?? defaultCapturePolicy.captureIntervalSeconds)
    const capturePolicy = { ...defaultCapturePolicy, ...patch, captureTiming, captureIntervalSeconds: legacyIntervalForTiming(captureTiming) }
    if (!Number.isFinite(capturePolicy.captureIntervalSeconds) || capturePolicy.captureIntervalSeconds < 0 || capturePolicy.captureIntervalSeconds > 300) throw new Error('Capture interval must be between 0 and 300 seconds')
    if (capturePolicy.excludedRegions.length > 32 || capturePolicy.excludedRegions.some((region) => [region.x, region.y, region.width, region.height].some((value) => !Number.isFinite(value) || value < 0 || value > 100_000) || region.width === 0 || region.height === 0)) throw new Error('Capture regions must contain 1–32 finite positive masks within 100,000 pixels')
    const session: LearningSession = {
      id: id('session'),
      name: name.trim() || fixture.name,
      fixtureId,
      goalHint: fixture.goal,
      status: 'active',
      startedAt: nowIso(),
      endedAt: null,
      nextFixtureIndex: 0,
      capturePolicy,
    }
    this.database.createSession(session)
    this.audit.append('capture.session_started', 'user', session.id, {
      name: session.name,
      fixtureId,
      captureManifest: {
        screenshots: session.capturePolicy.screenshots,
        activeWindow: session.capturePolicy.activeWindow,
        accessibilityTree: session.capturePolicy.accessibilityTree,
        inputMetadata: session.capturePolicy.inputMetadata,
        screenText: session.capturePolicy.screenText,
        fixtureTextAndStructuredState: !fixtureId.startsWith('browser-'),
        liveBrowserDomAndStructuredState: fixtureId.startsWith('browser-'),
        nativeMacOSWindowObservation: fixtureId === 'native-macos-observation',
        observationOnly: fixtureId === 'native-macos-observation',
        captureTiming: session.capturePolicy.captureTiming,
        captureIntervalSeconds: session.capturePolicy.captureIntervalSeconds,
      },
      exclusions: {
        applications: session.capturePolicy.excludedApplications,
        windows: session.capturePolicy.excludedWindows,
        domains: session.capturePolicy.excludedDomains,
        regions: session.capturePolicy.excludedRegions.length,
      },
    })
    return session
  }

  pause(sessionId: string): LearningSession {
    const session = this.requireSession(sessionId)
    if (session.status !== 'active') throw new Error('Only an active session can be paused')
    session.status = 'paused'
    this.database.updateSession(session)
    this.audit.append('capture.paused', 'user', session.id, { captureApiActive: false })
    return session
  }

  resume(sessionId: string): LearningSession {
    const session = this.requireSession(sessionId)
    if (session.status !== 'paused') throw new Error('Only a paused session can be resumed')
    session.status = 'active'
    this.database.updateSession(session)
    this.audit.append('capture.resumed', 'user', session.id, { captureApiActive: true })
    return session
  }

  captureNext(sessionId: string): ObservationRecord | null {
    const session = this.requireSession(sessionId)
    if (session.status !== 'active') throw new Error('Capture is not active')
    const fixture = getFixture(session.fixtureId)
    const item = fixture.observations[session.nextFixtureIndex]
    if (!item) return null
    const observedAt = new Date(new Date(session.startedAt).getTime() + item.offsetMs).toISOString()
    return this.persistFacts(session, item.facts, 'fixture', observedAt)
  }

  captureFacts(sessionId: string, facts: CapturedFacts, source: Exclude<ObservationSource, 'fixture'>): ObservationRecord {
    const session = this.requireSession(sessionId)
    if (session.status !== 'active') throw new Error('Capture is not active')
    return this.persistFacts(session, facts, source, nowIso())
  }

  private persistFacts(session: LearningSession, facts: CapturedFacts, source: ObservationSource, observedAt: string): ObservationRecord {
    const privacy = applyPrivacyPipeline(structuredClone(facts), session.capturePolicy)
    const persistedFacts = applySignalPolicy(privacy.facts, session.capturePolicy)
    const preEncodingMasks = typeof facts.state.preEncodingRegionMasks === 'number' ? facts.state.preEncodingRegionMasks : 0
    const redactions = [...new Set([...privacy.redactions, ...(preEncodingMasks > 0 ? [`${preEncodingMasks} pre-encoding region mask${preEncodingMasks === 1 ? '' : 's'}`] : [])])]
    const evidence = {
      sessionId: session.id,
      sequence: session.nextFixtureIndex + 1,
      observedAt,
      source,
      facts: persistedFacts,
    }
    const observation: ObservationRecord = {
      id: id('obs'),
      sessionId: session.id,
      sequence: session.nextFixtureIndex + 1,
      observedAt,
      source,
      trust: 'untrusted_screen',
      facts: persistedFacts,
      redactions,
      excluded: privacy.excluded,
      exclusionReason: privacy.exclusionReason,
      injectionSignals: privacy.injectionSignals,
      evidenceHash: sha256(stableJson(evidence)),
    }
    this.database.appendObservation(observation)
    session.nextFixtureIndex += 1
    this.database.updateSession(session)
    this.audit.append('capture.observation_persisted', 'system', observation.id, {
      sessionId: session.id,
      sequence: observation.sequence,
      evidenceHash: observation.evidenceHash,
      redactions: observation.redactions,
      excluded: observation.excluded,
      injectionSignals: observation.injectionSignals,
    })
    return observation
  }

  stop(sessionId: string): LearningSession {
    const session = this.requireSession(sessionId)
    if (session.status === 'stopped') return session
    session.status = 'stopped'
    session.endedAt = nowIso()
    this.database.updateSession(session)
    this.audit.append('capture.session_stopped', 'user', session.id, {
      observationCount: this.database.listObservations(session.id).length,
      captureApiActive: false,
    })
    return session
  }

  private requireSession(sessionId: string): LearningSession {
    const session = this.database.getSession(sessionId)
    if (!session) throw new Error(`Unknown session: ${sessionId}`)
    return session
  }
}

function applySignalPolicy(facts: ObservationRecord['facts'], policy: CapturePolicy): ObservationRecord['facts'] {
  const minimized = structuredClone(facts)
  if (!policy.screenshots) delete minimized.screenshotRef
  if (!policy.accessibilityTree) delete minimized.accessibility
  if (!policy.inputMetadata) delete minimized.inputEvent
  if (!policy.activeWindow) {
    minimized.app = '[NOT CAPTURED]'
    minimized.windowTitle = '[NOT CAPTURED]'
    delete minimized.url
  }
  return minimized
}
