import type { AuditLog } from './audit.js'
import type { CarveDatabase } from './db.js'
import type { NativeCaptureAdapter } from './native-capture.js'
import type {
  ObservationRecord,
  ObservationReview,
  ObservationReviewInput,
  RegionExclusion,
  ReviewedEpisode,
  ReviewedEpisodeSegment,
} from './types.js'
import { id, nowIso } from './util.js'

export class NativeReviewService {
  constructor(
    private readonly database: CarveDatabase,
    private readonly audit: AuditLog,
    private readonly nativeCapture: NativeCaptureAdapter,
  ) {}

  async save(observationId: string, rawInput: ObservationReviewInput): Promise<ObservationReview> {
    const observation = this.requireNativeObservation(observationId)
    const session = this.database.getSession(observation.sessionId)
    if (!session || session.status !== 'stopped') throw new Error('Stop the observation session before reviewing its evidence')
    const previous = this.database.getLatestObservationReview(observationId)
    const input = validateInput({ ...rawInput, visualDescription: rawInput.visualDescription ?? previous?.visualDescription ?? '' })
    if (input.disposition === 'approved' && observation.excluded) throw new Error('Privacy-excluded evidence cannot be approved')

    const version = (previous?.version ?? 0) + 1
    const originalRef = observation.facts.screenshotRef ?? null
    const availableSourceRef = previous?.sanitizedScreenshotRef ?? (previous?.originalDeleted ? null : originalRef)
    let sanitizedScreenshotRef: string | null = previous?.sanitizedScreenshotRef ?? null
    let originalDeleted = previous?.originalDeleted ?? false
    let createdDerivative: string | null = null

    if (input.createSanitizedCopy) {
      if (!availableSourceRef) throw new Error('A source screenshot is required to create a sanitized copy')
      const outputName = `${observation.sessionId}-${observation.sequence}-review-v${version}.png`
      const sanitized = await this.nativeCapture.sanitizeScreenshot(availableSourceRef, outputName, input.crop, input.masks)
      sanitizedScreenshotRef = sanitized.relativePath
      createdDerivative = sanitized.relativePath
    }

    if (input.discardSourceScreenshot) {
      if (!originalRef || originalDeleted) throw new Error('The original screenshot is already unavailable')
      if (input.disposition === 'approved' && !sanitizedScreenshotRef) throw new Error('Create a sanitized copy before discarding approved source evidence')
      const deleted = await this.nativeCapture.deleteScreenshot(originalRef)
      if (!deleted) {
        if (createdDerivative) await this.nativeCapture.deleteScreenshot(createdDerivative)
        throw new Error('The original screenshot could not be deleted; no review was saved')
      }
      originalDeleted = true
    }

    const review: ObservationReview = {
      id: id('review'),
      observationId,
      sessionId: observation.sessionId,
      version,
      disposition: input.disposition,
      annotationKind: input.annotationKind,
      taskBoundary: input.taskBoundary,
      label: input.label,
      notes: input.notes,
      visualDescription: input.visualDescription,
      crop: input.crop,
      masks: input.masks,
      sourceScreenshotRef: availableSourceRef,
      sanitizedScreenshotRef,
      sourceEvidenceHash: observation.evidenceHash,
      originalDeleted,
      createdAt: nowIso(),
      createdBy: 'user',
    }
    try {
      this.database.appendObservationReview(review)
    } catch (error) {
      if (createdDerivative) await this.nativeCapture.deleteScreenshot(createdDerivative)
      throw error
    }
    this.audit.append('memory.observation_reviewed', 'user', review.id, {
      observationId,
      sessionId: review.sessionId,
      version,
      disposition: review.disposition,
      annotationKind: review.annotationKind,
      taskBoundary: review.taskBoundary,
      sourceEvidenceHash: review.sourceEvidenceHash,
      sanitizedDerivativeCreated: Boolean(createdDerivative),
      maskCount: review.masks.length,
      cropped: Boolean(review.crop),
      originalDeleted,
      executableMemoryCreated: false,
    })
    return review
  }

  async deletePermanently(observationId: string): Promise<{ deleted: true; fileCount: number }> {
    const observation = this.requireNativeObservation(observationId)
    const session = this.database.getSession(observation.sessionId)
    if (!session || session.status !== 'stopped') throw new Error('Stop the observation session before deleting its evidence')
    const reviews = this.database.listObservationReviews(observation.sessionId).filter((review) => review.observationId === observationId)
    const aiDraftVersions = this.database.listAiWorkflowDrafts(observation.sessionId, false).filter((draft) => draft.disclosure.evidenceObservationIds.includes(observationId))
    const references = new Set<string>()
    if (observation.facts.screenshotRef) references.add(observation.facts.screenshotRef)
    for (const review of reviews) if (review.sanitizedScreenshotRef) references.add(review.sanitizedScreenshotRef)
    let fileCount = 0
    for (const reference of references) if (await this.nativeCapture.deleteScreenshot(reference)) fileCount += 1
    this.database.deleteObservation(observationId)
    this.audit.append('privacy.observation_permanently_deleted', 'user', observation.sessionId, {
      observationId,
      sourceEvidenceHash: observation.evidenceHash,
      reviewVersionsDeleted: reviews.length,
      aiDraftVersionsDeleted: aiDraftVersions.length,
      fileCount,
      recoverable: false,
    })
    return { deleted: true, fileCount }
  }

  episode(sessionId: string): ReviewedEpisode {
    const session = this.database.getSession(sessionId)
    if (!session || session.fixtureId !== 'native-macos-observation') throw new Error('Native observation session not found')
    const observations = this.database.listObservations(sessionId)
    const latestReviews = new Map(this.database.listObservationReviews(sessionId, true).map((review) => [review.observationId, review]))
    const approved = observations.filter((observation) => latestReviews.get(observation.id)?.disposition === 'approved')
    const excluded = observations.filter((observation) => latestReviews.get(observation.id)?.disposition === 'excluded')
    const pending = observations.filter((observation) => !latestReviews.has(observation.id))
    const segments: ReviewedEpisodeSegment[] = []
    let current: ReviewedEpisodeSegment | null = null
    for (const observation of approved) {
      const review = latestReviews.get(observation.id)
      if (!review) continue
      if (!current || review.taskBoundary === 'start' || review.taskBoundary === 'start_end') {
        current = { id: `${sessionId}-segment-${segments.length + 1}`, name: review.label || `Task ${segments.length + 1}`, observationIds: [], decisions: [], inputs: [], outcomes: [] }
        segments.push(current)
      }
      current.observationIds.push(observation.id)
      if (review.annotationKind === 'decision' && review.label) current.decisions.push(review.label)
      if (review.annotationKind === 'input' && review.label) current.inputs.push(review.label)
      if (review.annotationKind === 'outcome' && review.label) current.outcomes.push(review.label)
      if (review.taskBoundary === 'end' || review.taskBoundary === 'start_end') current = null
    }
    const blockers: string[] = []
    if (pending.length > 0) blockers.push(`${pending.length} observation${pending.length === 1 ? '' : 's'} still need review`)
    if (approved.length === 0) blockers.push('Approve at least one observation')
    if (segments.length > 0 && segments.some((segment) => segment.outcomes.length === 0)) blockers.push('Every task segment needs a labeled outcome')
    return {
      sessionId,
      executable: false,
      approvedObservationIds: approved.map((observation) => observation.id),
      excludedObservationIds: excluded.map((observation) => observation.id),
      pendingObservationIds: pending.map((observation) => observation.id),
      segments,
      readyForSegmentation: blockers.length === 0,
      blockers,
    }
  }

  private requireNativeObservation(observationId: string): ObservationRecord {
    const observation = this.database.getObservation(observationId)
    if (!observation) throw new Error(`Unknown observation: ${observationId}`)
    const session = this.database.getSession(observation.sessionId)
    if (!session || session.fixtureId !== 'native-macos-observation' || !['screen', 'accessibility'].includes(observation.source)) throw new Error('Only native screen or Accessibility observations can be reviewed here')
    return observation
  }
}

function validateInput(input: ObservationReviewInput): Required<Omit<ObservationReviewInput, 'crop'>> & { crop: RegionExclusion | null } {
  if (!['approved', 'excluded'].includes(input.disposition)) throw new Error('Review disposition is invalid')
  if (!['state', 'input', 'decision', 'outcome', 'interruption', 'irrelevant'].includes(input.annotationKind)) throw new Error('Review annotation is invalid')
  if (input.disposition === 'approved' && input.annotationKind === 'irrelevant') throw new Error('Irrelevant evidence must be excluded')
  if (!['none', 'start', 'end', 'start_end'].includes(input.taskBoundary)) throw new Error('Review task boundary is invalid')
  const label = input.label.trim()
  const notes = input.notes.trim()
  const visualDescription = (input.visualDescription ?? '').trim()
  if (label.length > 160 || notes.length > 2_000 || visualDescription.length > 1_000) throw new Error('Review label, notes, or visual description exceed the local storage limit')
  const crop = input.crop ?? null
  const masks = input.masks ?? []
  validateRegions(crop ? [crop] : [], 'crop')
  validateRegions(masks, 'masks')
  return {
    disposition: input.disposition,
    annotationKind: input.annotationKind,
    taskBoundary: input.taskBoundary,
    label,
    notes,
    visualDescription,
    crop,
    masks,
    createSanitizedCopy: input.createSanitizedCopy ?? false,
    discardSourceScreenshot: input.discardSourceScreenshot ?? false,
  }
}

function validateRegions(regions: RegionExclusion[], label: string): void {
  if (regions.length > 32 || regions.some((region) => [region.x, region.y, region.width, region.height].some((value) => !Number.isFinite(value) || value < 0 || value > 100_000) || region.width === 0 || region.height === 0)) {
    throw new Error(`Review ${label} must contain at most 32 finite positive pixel regions`)
  }
}
