import { runtimeBuildId } from './model-telemetry.js'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { legacyIntervalForTiming, normalizeCaptureTiming } from './capture-timing.js'
import { entityId, type ExtractedEntity, type RecallEntity } from './entities.js'
import type { RecallMoment } from './recall.js'
import type { RecallConversation, RecallConversationMessage, RecallConversationSummary } from './recall-conversations.js'
import type { RecallScopeInput } from './desktop-contract.js'
import { projectMemoryResource } from './resources.js'
import type { ModelCall } from './types.js'
import type {
  AmbientEvent,
  AiWorkflowDraft,
  ApprovalRecord,
  AuditEvent,
  CapturePolicy,
  CheckpointDecision,
  ExecutionPlan,
  LearningSession,
  MemoryResourceOccurrence,
  MemoryResourceRecord,
  MemoryEdge,
  MemoryEntity,
  ObservationRecord,
  ObservationReview,
  ProcedureVersion,
  RecallImageEgress,
  WorkRun,
} from './types.js'
import { parseJson } from './util.js'

interface SessionRow {
  id: string
  name: string
  fixture_id: string
  goal_hint: string
  status: LearningSession['status']
  started_at: string
  ended_at: string | null
  next_fixture_index: number
  capture_policy_json: string
}

interface ObservationRow {
  id: string
  session_id: string
  sequence: number
  observed_at: string
  source: ObservationRecord['source']
  trust: ObservationRecord['trust']
  facts_json: string
  redactions_json: string
  excluded: number
  exclusion_reason: string | null
  injection_signals_json: string
  evidence_hash: string
}

interface ObservationReviewRow {
  id: string
  observation_id: string
  session_id: string
  version: number
  disposition: ObservationReview['disposition']
  annotation_kind: ObservationReview['annotationKind']
  task_boundary: ObservationReview['taskBoundary']
  label: string
  notes: string
  visual_description: string
  crop_json: string | null
  masks_json: string
  source_screenshot_ref: string | null
  sanitized_screenshot_ref: string | null
  source_evidence_hash: string
  original_deleted: number
  created_at: string
  created_by: ObservationReview['createdBy']
}

interface AiWorkflowDraftRow {
  draft_id: string
  session_id: string
  version: number
  status: AiWorkflowDraft['status']
  provider_id: string
  provider_kind: AiWorkflowDraft['providerKind']
  model: string
  proposal_json: string
  disclosure_json: string
  validation_json: string
  usage_json: string
  correction_summary: string | null
  executable: number
  created_at: string
  decided_at: string | null
}

interface ProcedureRow {
  procedure_id: string
  version: number
  learning_key: string
  name: string
  goal: string
  confidence: number
  inputs_json: string
  parameters_json: string
  outputs_json: string
  graph_json: string
  provenance_json: string
  evidence_summary_json: string
  correction_summary: string | null
  created_at: string
}

interface MemoryEntityRow {
  id: string
  kind: MemoryEntity['kind']
  name: string
  attributes_json: string
  provenance_json: string
  confidence: number
}

interface MemoryEdgeRow {
  id: string
  from_id: string
  relation: MemoryEdge['relation']
  to_id: string
  provenance_json: string
  confidence: number
}

interface RunRow {
  id: string
  plan_json: string
  status: WorkRun['status']
  current_action_index: number
  stop_requested: number
  result: string | null
  recovery_json: string | null
  plan_approval_json: string | null
  plan_authorization_json: string | null
  supervision_amendments_json: string | null
  budget_usage_json: string | null
  public_lookup_json: string | null
  budget_amendments_json: string | null
  outcome_json: string | null
  live_checkpoint_json: string | null
  created_at: string
  updated_at: string
}

interface ApprovalRow {
  id: string
  run_id: string
  action_id: string
  action_hash: string
  kind: ApprovalRecord['kind']
  status: ApprovalRecord['status']
  preview: string
  expires_at: string | null
  decided_at: string | null
}

interface CheckpointDecisionRow {
  id: string
  run_id: string
  session_id: string | null
  subject: CheckpointDecision['subject']
  subject_id: string
  subject_hash: string
  plan_hash: string
  policy_hash: string
  boundary: CheckpointDecision['boundary']
  effect_classes_json: string
  reason_codes_json: string
  preview_json: string
  scope_json: string
  status: CheckpointDecision['status']
  created_at: string
  expires_at: string | null
  decided_at: string | null
  decided_by: CheckpointDecision['decidedBy']
}

interface AuditRow {
  id: string
  sequence: number
  occurred_at: string
  category: string
  actor: AuditEvent['actor']
  subject_id: string | null
  details_json: string
  previous_hash: string
  hash: string
}

interface RecallConversationRow {
  id: string
  title: string
  created_at: string
  updated_at: string
  scope_json: string | null
  message_count?: number
}

interface RecallConversationMessageRow {
  id: string
  conversation_id: string
  role: RecallConversationMessage['role']
  content: string
  created_at: string
  result_json: string | null
}

interface RecallResourceRow {
  resource_id: string
  resource_type: MemoryResourceRecord['type']
  canonical_key: string
  title: string
  canonical_url: string | null
  domain: string | null
  aliases_json: string
  first_seen_at: string
  last_seen_at: string
  occurrence_count: number
}

export class CarveDatabase {
  readonly connection: DatabaseSync
  readonly path: string

  constructor(path = ':memory:') {
    this.path = path === ':memory:' ? path : resolve(path)
    if (this.path !== ':memory:') mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    this.connection = new DatabaseSync(this.path, { timeout: 2500 })
    if (this.path !== ':memory:') chmodSync(this.path, 0o600)
    this.connection.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON;')
    this.migrate()
  }

  private migrate(): void {
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS learning_sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        fixture_id TEXT NOT NULL,
        goal_hint TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active', 'paused', 'stopped')),
        started_at TEXT NOT NULL,
        ended_at TEXT,
        next_fixture_index INTEGER NOT NULL DEFAULT 0,
        capture_policy_json TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS observations (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES learning_sessions(id),
        sequence INTEGER NOT NULL,
        observed_at TEXT NOT NULL,
        source TEXT NOT NULL,
        trust TEXT NOT NULL,
        facts_json TEXT NOT NULL,
        redactions_json TEXT NOT NULL,
        excluded INTEGER NOT NULL CHECK(excluded IN (0, 1)),
        exclusion_reason TEXT,
        injection_signals_json TEXT NOT NULL,
        evidence_hash TEXT NOT NULL,
        UNIQUE(session_id, sequence)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS observation_reviews (
        id TEXT NOT NULL UNIQUE,
        observation_id TEXT NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL REFERENCES learning_sessions(id),
        version INTEGER NOT NULL CHECK(version > 0),
        disposition TEXT NOT NULL CHECK(disposition IN ('approved', 'excluded')),
        annotation_kind TEXT NOT NULL CHECK(annotation_kind IN ('state', 'input', 'decision', 'outcome', 'interruption', 'irrelevant')),
        task_boundary TEXT NOT NULL CHECK(task_boundary IN ('none', 'start', 'end', 'start_end')),
        label TEXT NOT NULL,
        notes TEXT NOT NULL,
        visual_description TEXT NOT NULL DEFAULT '',
        crop_json TEXT,
        masks_json TEXT NOT NULL,
        source_screenshot_ref TEXT,
        sanitized_screenshot_ref TEXT,
        source_evidence_hash TEXT NOT NULL,
        original_deleted INTEGER NOT NULL CHECK(original_deleted IN (0, 1)),
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL CHECK(created_by = 'user'),
        PRIMARY KEY(observation_id, version)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS ai_workflow_drafts (
        draft_id TEXT NOT NULL,
        session_id TEXT NOT NULL REFERENCES learning_sessions(id) ON DELETE CASCADE,
        version INTEGER NOT NULL CHECK(version > 0),
        status TEXT NOT NULL CHECK(status IN ('proposed', 'accepted', 'rejected')),
        provider_id TEXT NOT NULL,
        provider_kind TEXT NOT NULL CHECK(provider_kind IN ('mock', 'hosted', 'local')),
        model TEXT NOT NULL,
        proposal_json TEXT NOT NULL,
        disclosure_json TEXT NOT NULL,
        validation_json TEXT NOT NULL,
        usage_json TEXT NOT NULL,
        correction_summary TEXT,
        executable INTEGER NOT NULL CHECK(executable = 0),
        created_at TEXT NOT NULL,
        decided_at TEXT,
        PRIMARY KEY(draft_id, version)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS procedure_versions (
        procedure_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        learning_key TEXT NOT NULL,
        name TEXT NOT NULL,
        goal TEXT NOT NULL,
        confidence REAL NOT NULL,
        inputs_json TEXT NOT NULL,
        parameters_json TEXT NOT NULL DEFAULT '[]',
        outputs_json TEXT NOT NULL,
        graph_json TEXT NOT NULL,
        provenance_json TEXT NOT NULL,
        evidence_summary_json TEXT NOT NULL,
        correction_summary TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY(procedure_id, version)
      ) STRICT;

      CREATE VIRTUAL TABLE IF NOT EXISTS procedure_search USING fts5(
        procedure_id UNINDEXED,
        version UNINDEXED,
        name,
        goal,
        body,
        tokenize='porter unicode61'
      );

      CREATE TABLE IF NOT EXISTS memory_entities (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        attributes_json TEXT NOT NULL,
        provenance_json TEXT NOT NULL,
        confidence REAL NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS memory_edges (
        id TEXT PRIMARY KEY,
        from_id TEXT NOT NULL REFERENCES memory_entities(id),
        relation TEXT NOT NULL,
        to_id TEXT NOT NULL REFERENCES memory_entities(id),
        provenance_json TEXT NOT NULL,
        confidence REAL NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS work_runs (
        id TEXT PRIMARY KEY,
        plan_json TEXT NOT NULL,
        status TEXT NOT NULL,
        current_action_index INTEGER NOT NULL,
        stop_requested INTEGER NOT NULL CHECK(stop_requested IN (0, 1)),
        result TEXT,
        recovery_json TEXT,
        plan_approval_json TEXT,
        budget_usage_json TEXT,
        public_lookup_json TEXT,
        budget_amendments_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES work_runs(id),
        action_id TEXT NOT NULL,
        action_hash TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        preview TEXT NOT NULL,
        expires_at TEXT,
        decided_at TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS checkpoint_decisions (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES work_runs(id),
        session_id TEXT,
        subject TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        subject_hash TEXT NOT NULL,
        plan_hash TEXT NOT NULL,
        policy_hash TEXT NOT NULL,
        boundary TEXT NOT NULL,
        effect_classes_json TEXT NOT NULL,
        reason_codes_json TEXT NOT NULL,
        preview_json TEXT NOT NULL,
        scope_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT,
        decided_at TEXT,
        decided_by TEXT
      ) STRICT;

      CREATE INDEX IF NOT EXISTS checkpoint_decisions_pending ON checkpoint_decisions(run_id, session_id, status);
      CREATE INDEX IF NOT EXISTS checkpoint_decisions_subject ON checkpoint_decisions(subject_hash, status);

      CREATE TABLE IF NOT EXISTS audit_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        occurred_at TEXT NOT NULL,
        category TEXT NOT NULL,
        actor TEXT NOT NULL,
        subject_id TEXT,
        details_json TEXT NOT NULL,
        previous_hash TEXT NOT NULL,
        hash TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS ambient_events (
        id TEXT PRIMARY KEY,
        app TEXT NOT NULL,
        window_title TEXT NOT NULL,
        signature TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        duration_ms INTEGER NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS ambient_events_started_at ON ambient_events(started_at);

      CREATE TABLE IF NOT EXISTS recall_moments (
        moment_id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        app TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        visual_description TEXT NOT NULL DEFAULT '',
        session_id TEXT,
        screenshot_ref TEXT
      ) STRICT;

      CREATE INDEX IF NOT EXISTS recall_moments_occurred_at ON recall_moments(occurred_at);
      CREATE INDEX IF NOT EXISTS recall_moments_session_time ON recall_moments(session_id, occurred_at);

      CREATE TABLE IF NOT EXISTS recall_chunks (
        chunk_id TEXT PRIMARY KEY,
        moment_id TEXT NOT NULL REFERENCES recall_moments(moment_id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL,
        content_sha256 TEXT NOT NULL,
        preprocessing_version TEXT NOT NULL,
        text TEXT NOT NULL,
        UNIQUE(moment_id, ordinal, preprocessing_version)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS recall_chunks_moment ON recall_chunks(moment_id);

      CREATE TABLE IF NOT EXISTS recall_embeddings (
        chunk_id TEXT NOT NULL REFERENCES recall_chunks(chunk_id) ON DELETE CASCADE,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        vector_blob BLOB NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(chunk_id, provider_id, model_id)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS recall_embeddings_source ON recall_embeddings(provider_id, model_id);

      CREATE TABLE IF NOT EXISTS recall_resources (
        resource_id TEXT PRIMARY KEY,
        resource_type TEXT NOT NULL CHECK(resource_type IN ('web_page', 'document', 'message', 'application_state')),
        canonical_key TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        canonical_url TEXT,
        domain TEXT,
        aliases_json TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        occurrence_count INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS recall_resource_occurrences (
        resource_id TEXT NOT NULL REFERENCES recall_resources(resource_id) ON DELETE CASCADE,
        moment_id TEXT NOT NULL REFERENCES recall_moments(moment_id) ON DELETE CASCADE,
        session_id TEXT,
        occurred_at TEXT NOT NULL,
        extraction_method TEXT NOT NULL CHECK(extraction_method IN ('structured_url', 'recognized_url', 'title_identity')),
        confidence REAL NOT NULL,
        PRIMARY KEY(resource_id, moment_id)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS recall_resource_occurrences_moment ON recall_resource_occurrences(moment_id);
      CREATE INDEX IF NOT EXISTS recall_resource_occurrences_session_time ON recall_resource_occurrences(session_id, occurred_at);

      -- What each model call actually consumed. The adapters have always
      -- returned this and it was always discarded, so there was no way to say
      -- what anything had cost.
      CREATE TABLE IF NOT EXISTS model_calls (
        id TEXT PRIMARY KEY,
        occurred_at TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        provider_kind TEXT NOT NULL,
        model TEXT NOT NULL,
        job TEXT NOT NULL,
        input_tokens INTEGER,
        output_tokens INTEGER
      ) STRICT;

      CREATE INDEX IF NOT EXISTS model_calls_occurred_at ON model_calls(occurred_at);

      CREATE TABLE IF NOT EXISTS recall_retrievals (
        moment_id TEXT NOT NULL,
        retrieved_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS recall_retrievals_moment ON recall_retrievals(moment_id);

      CREATE TABLE IF NOT EXISTS recall_entities (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        normalized TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        mention_count INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS recall_entity_mentions (
        entity_id TEXT NOT NULL,
        moment_id TEXT NOT NULL,
        PRIMARY KEY (entity_id, moment_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS recall_image_egress (
        id TEXT PRIMARY KEY,
        occurred_at TEXT NOT NULL,
        observation_id TEXT NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
        moment_id TEXT NOT NULL,
        review_id TEXT NOT NULL,
        review_version INTEGER NOT NULL,
        sanitized_screenshot_ref TEXT NOT NULL,
        source_evidence_hash TEXT NOT NULL,
        image_sha256 TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS recall_image_egress_observation ON recall_image_egress(observation_id);

      CREATE TABLE IF NOT EXISTS recall_conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        scope_json TEXT
      ) STRICT;

      CREATE INDEX IF NOT EXISTS recall_conversations_updated_at ON recall_conversations(updated_at DESC);

      CREATE TABLE IF NOT EXISTS recall_conversation_messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES recall_conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        result_json TEXT
      ) STRICT;

      CREATE INDEX IF NOT EXISTS recall_conversation_messages_order ON recall_conversation_messages(conversation_id, created_at);

      CREATE VIRTUAL TABLE IF NOT EXISTS recall_search USING fts5(
        moment_id UNINDEXED,
        app,
        title,
        body,
        tokenize='porter unicode61'
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS recall_resource_search USING fts5(
        resource_id UNINDEXED,
        resource_type,
        title,
        canonical_url,
        domain,
        aliases,
        tokenize='porter unicode61'
      );
    `)
    this.ensureColumn('procedure_versions', 'learning_key', "TEXT NOT NULL DEFAULT ''")
    this.ensureColumn('procedure_versions', 'evidence_summary_json', "TEXT NOT NULL DEFAULT '{\"inductionMethod\":\"deterministic_fixture_rules\",\"completedSessionIds\":[],\"interruptedSessionIds\":[],\"quarantinedSessionIds\":[],\"observedBranchValues\":{}}'")
    this.ensureColumn('procedure_versions', 'parameters_json', "TEXT NOT NULL DEFAULT '[]'")
    this.ensureColumn('work_runs', 'recovery_json', 'TEXT')
    this.ensureColumn('work_runs', 'plan_approval_json', 'TEXT')
    this.ensureColumn('work_runs', 'plan_authorization_json', 'TEXT')
    this.ensureColumn('work_runs', 'supervision_amendments_json', 'TEXT')
    this.ensureColumn('work_runs', 'budget_usage_json', 'TEXT')
    this.ensureColumn('work_runs', 'public_lookup_json', 'TEXT')
    this.ensureColumn('work_runs', 'budget_amendments_json', 'TEXT')
    this.ensureColumn('work_runs', 'outcome_json', 'TEXT')
    this.ensureColumn('work_runs', 'live_checkpoint_json', 'TEXT')
    this.ensureColumn('ambient_events', 'text', "TEXT NOT NULL DEFAULT ''")
    this.ensureColumn('model_calls', 'status', "TEXT NOT NULL DEFAULT 'completed'")
    this.ensureColumn('model_calls', 'run_id', 'TEXT')
    this.ensureColumn('model_calls', 'session_id', 'TEXT')
    this.ensureColumn('model_calls', 'phase', 'TEXT')
    this.ensureColumn('model_calls', 'duration_ms', 'INTEGER')
    this.ensureColumn('model_calls', 'vision_frames', 'INTEGER NOT NULL DEFAULT 0')
    this.ensureColumn('model_calls', 'total_tokens', 'INTEGER')
    this.ensureColumn('model_calls', 'cached_input_tokens', 'INTEGER')
    this.ensureColumn('model_calls', 'reasoning_tokens', 'INTEGER')
    this.ensureColumn('model_calls', 'turn_index', 'INTEGER')
    this.ensureColumn('model_calls', 'response_chain_id', 'TEXT')
    this.ensureColumn('model_calls', 'telemetry_json', 'TEXT')
    this.ensureColumn('model_calls', 'runtime_build_id', 'TEXT')
    this.ensureColumn('model_calls', 'cache_write_tokens', 'INTEGER')
    this.ensureColumn('observation_reviews', 'visual_description', "TEXT NOT NULL DEFAULT ''")
    this.ensureColumn('recall_moments', 'visual_description', "TEXT NOT NULL DEFAULT ''")
    // A capture the person chose never to read. Distinct from unread: unread is
    // "not yet", skipped is "not this one", and re-offering a skipped capture
    // every time a question is asked would make the choice meaningless.
    this.ensureColumn('recall_moments', 'read_skipped', 'INTEGER NOT NULL DEFAULT 0')
    // Recall v2 retains analytical metadata that observations already carried.
    // Nullable columns keep older databases and ambient-only moments compatible.
    this.ensureColumn('recall_moments', 'url', 'TEXT')
    this.ensureColumn('recall_moments', 'sequence', 'INTEGER')
    this.ensureColumn('recall_moments', 'duration_ms', 'INTEGER')
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.connection.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>
    if (!columns.some((candidate) => candidate.name === column)) this.connection.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }

  close(): void {
    this.connection.close()
  }

  createSession(session: LearningSession): void {
    this.connection.prepare(`
      INSERT INTO learning_sessions
      (id, name, fixture_id, goal_hint, status, started_at, ended_at, next_fixture_index, capture_policy_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      session.id,
      session.name,
      session.fixtureId,
      session.goalHint,
      session.status,
      session.startedAt,
      session.endedAt,
      session.nextFixtureIndex,
      JSON.stringify(session.capturePolicy),
    )
  }

  updateSession(session: LearningSession): void {
    this.connection.prepare(`
      UPDATE learning_sessions
      SET name = ?, status = ?, ended_at = ?, next_fixture_index = ?, capture_policy_json = ?
      WHERE id = ?
    `).run(
      session.name,
      session.status,
      session.endedAt,
      session.nextFixtureIndex,
      JSON.stringify(session.capturePolicy),
      session.id,
    )
  }

  getSession(sessionId: string): LearningSession | null {
    const row = this.connection.prepare('SELECT * FROM learning_sessions WHERE id = ?').get(sessionId) as SessionRow | undefined
    return row ? this.mapSession(row) : null
  }

  listSessions(): LearningSession[] {
    const rows = this.connection.prepare('SELECT * FROM learning_sessions ORDER BY started_at DESC').all() as unknown as SessionRow[]
    return rows.map((row) => this.mapSession(row))
  }

  private mapSession(row: SessionRow): LearningSession {
    const storedPolicy = parseJson<CapturePolicy>(row.capture_policy_json)
    const captureTiming = normalizeCaptureTiming(storedPolicy.captureTiming, storedPolicy.captureIntervalSeconds ?? 0)
    return {
      id: row.id,
      name: row.name,
      fixtureId: row.fixture_id,
      goalHint: row.goal_hint,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      nextFixtureIndex: row.next_fixture_index,
      capturePolicy: { ...storedPolicy, captureTiming, captureIntervalSeconds: legacyIntervalForTiming(captureTiming) },
    }
  }

  appendObservation(observation: ObservationRecord): void {
    this.connection.prepare(`
      INSERT INTO observations
      (id, session_id, sequence, observed_at, source, trust, facts_json, redactions_json, excluded, exclusion_reason, injection_signals_json, evidence_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      observation.id,
      observation.sessionId,
      observation.sequence,
      observation.observedAt,
      observation.source,
      observation.trust,
      JSON.stringify(observation.facts),
      JSON.stringify(observation.redactions),
      observation.excluded ? 1 : 0,
      observation.exclusionReason,
      JSON.stringify(observation.injectionSignals),
      observation.evidenceHash,
    )
  }

  listObservations(sessionId: string): ObservationRecord[] {
    const rows = this.connection.prepare('SELECT * FROM observations WHERE session_id = ? ORDER BY sequence').all(sessionId) as unknown as ObservationRow[]
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      sequence: row.sequence,
      observedAt: row.observed_at,
      source: row.source,
      trust: row.trust,
      facts: parseJson<ObservationRecord['facts']>(row.facts_json),
      redactions: parseJson<string[]>(row.redactions_json),
      excluded: row.excluded === 1,
      exclusionReason: row.exclusion_reason,
      injectionSignals: parseJson<string[]>(row.injection_signals_json),
      evidenceHash: row.evidence_hash,
    }))
  }

  getObservation(observationId: string): ObservationRecord | null {
    const row = this.connection.prepare('SELECT * FROM observations WHERE id = ?').get(observationId) as ObservationRow | undefined
    if (!row) return null
    return {
      id: row.id,
      sessionId: row.session_id,
      sequence: row.sequence,
      observedAt: row.observed_at,
      source: row.source,
      trust: row.trust,
      facts: parseJson<ObservationRecord['facts']>(row.facts_json),
      redactions: parseJson<string[]>(row.redactions_json),
      excluded: row.excluded === 1,
      exclusionReason: row.exclusion_reason,
      injectionSignals: parseJson<string[]>(row.injection_signals_json),
      evidenceHash: row.evidence_hash,
    }
  }

  appendObservationReview(review: ObservationReview): void {
    this.connection.prepare(`
      INSERT INTO observation_reviews
      (id, observation_id, session_id, version, disposition, annotation_kind, task_boundary, label, notes, visual_description, crop_json, masks_json, source_screenshot_ref, sanitized_screenshot_ref, source_evidence_hash, original_deleted, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      review.id,
      review.observationId,
      review.sessionId,
      review.version,
      review.disposition,
      review.annotationKind,
      review.taskBoundary,
      review.label,
      review.notes,
      review.visualDescription,
      review.crop ? JSON.stringify(review.crop) : null,
      JSON.stringify(review.masks),
      review.sourceScreenshotRef,
      review.sanitizedScreenshotRef,
      review.sourceEvidenceHash,
      review.originalDeleted ? 1 : 0,
      review.createdAt,
      review.createdBy,
    )
  }

  listObservationReviews(sessionId?: string, latestOnly = false): ObservationReview[] {
    const where = sessionId ? 'WHERE session_id = ?' : ''
    const latest = latestOnly ? `${where ? 'AND' : 'WHERE'} version = (SELECT MAX(newer.version) FROM observation_reviews newer WHERE newer.observation_id = observation_reviews.observation_id)` : ''
    const sql = `SELECT * FROM observation_reviews ${where} ${latest} ORDER BY session_id, observation_id, version`
    const rows = (sessionId ? this.connection.prepare(sql).all(sessionId) : this.connection.prepare(sql).all()) as unknown as ObservationReviewRow[]
    return rows.map((row) => this.mapObservationReview(row))
  }

  getLatestObservationReview(observationId: string): ObservationReview | null {
    const row = this.connection.prepare('SELECT * FROM observation_reviews WHERE observation_id = ? ORDER BY version DESC LIMIT 1').get(observationId) as ObservationReviewRow | undefined
    return row ? this.mapObservationReview(row) : null
  }

  deleteObservation(observationId: string): ObservationReview[] {
    const reviews = this.connection.prepare('SELECT * FROM observation_reviews WHERE observation_id = ? ORDER BY version').all(observationId) as unknown as ObservationReviewRow[]
    const affectedDraftIds = new Set(this.listAiWorkflowDrafts(undefined, false)
      .filter((draft) => draft.disclosure.evidenceObservationIds.includes(observationId))
      .map((draft) => draft.id))
    this.connection.exec('BEGIN IMMEDIATE')
    try {
      const deleteDraft = this.connection.prepare('DELETE FROM ai_workflow_drafts WHERE draft_id = ?')
      for (const draftId of affectedDraftIds) deleteDraft.run(draftId)
      this.deleteRecallMoments([`obs:${observationId}`])
      this.connection.prepare('DELETE FROM observations WHERE id = ?').run(observationId)
      this.connection.exec('COMMIT')
    } catch (error) {
      this.connection.exec('ROLLBACK')
      throw error
    }
    return reviews.map((row) => this.mapObservationReview(row))
  }

  private mapObservationReview(row: ObservationReviewRow): ObservationReview {
    return {
      id: row.id,
      observationId: row.observation_id,
      sessionId: row.session_id,
      version: row.version,
      disposition: row.disposition,
      annotationKind: row.annotation_kind,
      taskBoundary: row.task_boundary,
      label: row.label,
      notes: row.notes,
      visualDescription: row.visual_description,
      crop: row.crop_json ? parseJson<ObservationReview['crop']>(row.crop_json) : null,
      masks: parseJson<ObservationReview['masks']>(row.masks_json),
      sourceScreenshotRef: row.source_screenshot_ref,
      sanitizedScreenshotRef: row.sanitized_screenshot_ref,
      sourceEvidenceHash: row.source_evidence_hash,
      originalDeleted: row.original_deleted === 1,
      createdAt: row.created_at,
      createdBy: row.created_by,
    }
  }

  saveAiWorkflowDraft(draft: AiWorkflowDraft): void {
    this.connection.prepare(`
      INSERT INTO ai_workflow_drafts
      (draft_id, session_id, version, status, provider_id, provider_kind, model, proposal_json, disclosure_json, validation_json, usage_json, correction_summary, executable, created_at, decided_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      draft.id,
      draft.sessionId,
      draft.version,
      draft.status,
      draft.providerId,
      draft.providerKind,
      draft.model,
      JSON.stringify(draft.proposal),
      JSON.stringify(draft.disclosure),
      JSON.stringify(draft.validation),
      JSON.stringify(draft.usage),
      draft.correctionSummary,
      draft.createdAt,
      draft.decidedAt,
    )
  }

  updateAiWorkflowDraftDecision(draftId: string, version: number, status: AiWorkflowDraft['status'], decidedAt: string): void {
    const result = this.connection.prepare(`
      UPDATE ai_workflow_drafts SET status = ?, decided_at = ? WHERE draft_id = ? AND version = ?
    `).run(status, decidedAt, draftId, version)
    if (result.changes !== 1) throw new Error('AI workflow draft version not found')
  }

  getAiWorkflowDraft(draftId: string, version?: number): AiWorkflowDraft | null {
    const row = version === undefined
      ? this.connection.prepare('SELECT * FROM ai_workflow_drafts WHERE draft_id = ? ORDER BY version DESC LIMIT 1').get(draftId)
      : this.connection.prepare('SELECT * FROM ai_workflow_drafts WHERE draft_id = ? AND version = ?').get(draftId, version)
    return row ? this.mapAiWorkflowDraft(row as unknown as AiWorkflowDraftRow) : null
  }

  listAiWorkflowDrafts(sessionId?: string, latestOnly = true): AiWorkflowDraft[] {
    const where = sessionId ? 'WHERE session_id = ?' : ''
    const latest = latestOnly ? `${where ? 'AND' : 'WHERE'} version = (SELECT MAX(newer.version) FROM ai_workflow_drafts newer WHERE newer.draft_id = ai_workflow_drafts.draft_id)` : ''
    const sql = `SELECT * FROM ai_workflow_drafts ${where} ${latest} ORDER BY created_at DESC, version DESC`
    const rows = (sessionId ? this.connection.prepare(sql).all(sessionId) : this.connection.prepare(sql).all()) as unknown as AiWorkflowDraftRow[]
    return rows.map((row) => this.mapAiWorkflowDraft(row))
  }

  private mapAiWorkflowDraft(row: AiWorkflowDraftRow): AiWorkflowDraft {
    return {
      id: row.draft_id,
      sessionId: row.session_id,
      version: row.version,
      status: row.status,
      providerId: row.provider_id,
      providerKind: row.provider_kind,
      model: row.model,
      proposal: parseJson<AiWorkflowDraft['proposal']>(row.proposal_json),
      disclosure: parseJson<AiWorkflowDraft['disclosure']>(row.disclosure_json),
      validation: parseJson<AiWorkflowDraft['validation']>(row.validation_json),
      usage: parseJson<AiWorkflowDraft['usage']>(row.usage_json),
      correctionSummary: row.correction_summary,
      executable: false,
      createdAt: row.created_at,
      decidedAt: row.decided_at,
    }
  }

  expireSessionEvidence(sessionId: string): { observationIds: string[]; procedureIds: string[] } {
    const observations = this.listObservations(sessionId)
    const observationIds = observations.map((observation) => observation.id)
    if (observationIds.length === 0) return { observationIds: [], procedureIds: [] }
    const evidence = new Set(observationIds)
    const procedureIds = [...new Set(this.listProcedures(false)
      .filter((procedure) => procedure.provenanceObservationIds.some((observationId) => evidence.has(observationId)))
      .map((procedure) => procedure.procedureId))]
    const entityIds = new Set(this.listMemoryEntities().filter((entity) =>
      entity.provenanceObservationIds.some((observationId) => evidence.has(observationId))
      || typeof entity.attributes.procedureId === 'string' && procedureIds.includes(entity.attributes.procedureId),
    ).map((entity) => entity.id))

    this.connection.exec('BEGIN IMMEDIATE')
    try {
      const deleteEdge = this.connection.prepare('DELETE FROM memory_edges WHERE id = ?')
      for (const edge of this.listMemoryEdges()) {
        if (entityIds.has(edge.fromId) || entityIds.has(edge.toId) || edge.provenanceObservationIds.some((observationId) => evidence.has(observationId))) deleteEdge.run(edge.id)
      }
      const deleteEntity = this.connection.prepare('DELETE FROM memory_entities WHERE id = ?')
      for (const entityId of entityIds) deleteEntity.run(entityId)
      const deleteSearch = this.connection.prepare('DELETE FROM procedure_search WHERE procedure_id = ?')
      const deleteProcedure = this.connection.prepare('DELETE FROM procedure_versions WHERE procedure_id = ?')
      for (const procedureId of procedureIds) {
        deleteSearch.run(procedureId)
        deleteProcedure.run(procedureId)
      }
      this.connection.prepare('DELETE FROM ai_workflow_drafts WHERE session_id = ?').run(sessionId)
      const recallIds = (this.connection.prepare('SELECT moment_id FROM recall_moments WHERE session_id = ?').all(sessionId) as unknown as Array<{ moment_id: string }>)
        .map((row) => row.moment_id)
      this.deleteRecallMoments(recallIds)
      this.connection.prepare('DELETE FROM observations WHERE session_id = ?').run(sessionId)
      this.connection.exec('COMMIT')
    } catch (error) {
      this.connection.exec('ROLLBACK')
      throw error
    }
    return { observationIds, procedureIds }
  }

  saveProcedure(procedure: ProcedureVersion): void {
    const insert = this.connection.prepare(`
      INSERT INTO procedure_versions
      (procedure_id, version, learning_key, name, goal, confidence, inputs_json, parameters_json, outputs_json, graph_json, provenance_json, evidence_summary_json, correction_summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    this.connection.exec('BEGIN IMMEDIATE')
    try {
      insert.run(
        procedure.procedureId,
        procedure.version,
        procedure.learningKey,
        procedure.name,
        procedure.goal,
        procedure.confidence,
        JSON.stringify(procedure.inputs),
        JSON.stringify(procedure.parameters),
        JSON.stringify(procedure.outputs),
        JSON.stringify(procedure.graph),
        JSON.stringify(procedure.provenanceObservationIds),
        JSON.stringify(procedure.evidenceSummary),
        procedure.correctionSummary,
        procedure.createdAt,
      )
      this.connection.prepare(`
        INSERT INTO procedure_search(procedure_id, version, name, goal, body)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        procedure.procedureId,
        procedure.version,
        procedure.name,
        procedure.goal,
        JSON.stringify(procedure.graph),
      )
      this.connection.exec('COMMIT')
    } catch (error) {
      this.connection.exec('ROLLBACK')
      throw error
    }
  }

  getProcedure(procedureId: string, version?: number): ProcedureVersion | null {
    const row = version === undefined
      ? this.connection.prepare('SELECT * FROM procedure_versions WHERE procedure_id = ? ORDER BY version DESC LIMIT 1').get(procedureId)
      : this.connection.prepare('SELECT * FROM procedure_versions WHERE procedure_id = ? AND version = ?').get(procedureId, version)
    return row ? this.mapProcedure(row as unknown as ProcedureRow) : null
  }

  getProcedureByLearningKey(learningKey: string): ProcedureVersion | null {
    const row = this.connection.prepare('SELECT * FROM procedure_versions WHERE learning_key = ? ORDER BY version DESC LIMIT 1').get(learningKey)
    return row ? this.mapProcedure(row as unknown as ProcedureRow) : null
  }

  listProcedures(latestOnly = true): ProcedureVersion[] {
    const sql = latestOnly
      ? `SELECT p.* FROM procedure_versions p
         JOIN (SELECT procedure_id, MAX(version) version FROM procedure_versions GROUP BY procedure_id) latest
         ON p.procedure_id = latest.procedure_id AND p.version = latest.version
         ORDER BY p.created_at DESC`
      : 'SELECT * FROM procedure_versions ORDER BY created_at DESC'
    const rows = this.connection.prepare(sql).all() as unknown as ProcedureRow[]
    return rows.map((row) => this.mapProcedure(row))
  }

  searchProcedureIds(query: string, limit = 8): Array<{ procedureId: string; version: number; rank: number }> {
    try {
      const rows = this.connection.prepare(`
        SELECT procedure_id, CAST(version AS INTEGER) version, bm25(procedure_search) rank
        FROM procedure_search WHERE procedure_search MATCH ? ORDER BY rank LIMIT ?
      `).all(query, limit) as unknown as Array<{ procedure_id: string; version: number; rank: number }>
      return rows.map((row) => ({ procedureId: row.procedure_id, version: row.version, rank: row.rank }))
    } catch {
      return []
    }
  }

  private mapProcedure(row: ProcedureRow): ProcedureVersion {
    return {
      procedureId: row.procedure_id,
      version: row.version,
      learningKey: row.learning_key,
      name: row.name,
      goal: row.goal,
      confidence: row.confidence,
      inputs: parseJson<string[]>(row.inputs_json),
      parameters: parseJson<ProcedureVersion['parameters']>(row.parameters_json),
      outputs: parseJson<string[]>(row.outputs_json),
      graph: parseJson<ProcedureVersion['graph']>(row.graph_json),
      provenanceObservationIds: parseJson<string[]>(row.provenance_json),
      evidenceSummary: parseJson<ProcedureVersion['evidenceSummary']>(row.evidence_summary_json),
      correctionSummary: row.correction_summary,
      createdAt: row.created_at,
    }
  }

  saveSemanticMemory(entities: MemoryEntity[], edges: MemoryEdge[]): void {
    const entityInsert = this.connection.prepare(`
      INSERT INTO memory_entities(id, kind, name, attributes_json, provenance_json, confidence)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    const edgeInsert = this.connection.prepare(`
      INSERT INTO memory_edges(id, from_id, relation, to_id, provenance_json, confidence)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    this.connection.exec('BEGIN IMMEDIATE')
    try {
      for (const entity of entities) {
        entityInsert.run(
          entity.id,
          entity.kind,
          entity.name,
          JSON.stringify(entity.attributes),
          JSON.stringify(entity.provenanceObservationIds),
          entity.confidence,
        )
      }
      for (const edge of edges) {
        edgeInsert.run(
          edge.id,
          edge.fromId,
          edge.relation,
          edge.toId,
          JSON.stringify(edge.provenanceObservationIds),
          edge.confidence,
        )
      }
      this.connection.exec('COMMIT')
    } catch (error) {
      this.connection.exec('ROLLBACK')
      throw error
    }
  }

  listMemoryEntities(): MemoryEntity[] {
    const rows = this.connection.prepare('SELECT * FROM memory_entities ORDER BY rowid').all() as unknown as MemoryEntityRow[]
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      attributes: parseJson<MemoryEntity['attributes']>(row.attributes_json),
      provenanceObservationIds: parseJson<string[]>(row.provenance_json),
      confidence: row.confidence,
    }))
  }

  listMemoryEdges(): MemoryEdge[] {
    const rows = this.connection.prepare('SELECT * FROM memory_edges ORDER BY rowid').all() as unknown as MemoryEdgeRow[]
    return rows.map((row) => ({
      id: row.id,
      fromId: row.from_id,
      relation: row.relation,
      toId: row.to_id,
      provenanceObservationIds: parseJson<string[]>(row.provenance_json),
      confidence: row.confidence,
    }))
  }

  /** Bumped by every write to work_runs (saveRun, updateRun, purgeAll), which are the only writers. */
  private runsRevision = 0
  private runsCache: { revision: number; runs: WorkRun[] } | null = null

  /** listRuns() for read-only display paths (desktop state, tray): reuses the parsed runs until work_runs changes.
   * 26 September: the desktop rebuilt state() several times a second, and parsing 722 runs (5.5 MB of plan JSON) each
   * time kept the Electron main thread busy for most of a live task, delaying captures and input by seconds.
   * Callers must not mutate the returned runs. */
  listRunsCached(): WorkRun[] {
    if (this.runsCache?.revision !== this.runsRevision) this.runsCache = { revision: this.runsRevision, runs: this.listRuns() }
    return this.runsCache.runs
  }

  /** The newest audit sequence: a cheap key for caches derived from the audit log. */
  latestAuditSequence(): number {
    const row = this.connection.prepare('SELECT MAX(sequence) AS sequence FROM audit_events').get() as unknown as { sequence: number | null }
    return row.sequence ?? 0
  }

  /** The newest active run (running, awaiting approval or guidance), without reading the rest. */
  activeRun(): WorkRun | null {
    const row = this.connection.prepare("SELECT * FROM work_runs WHERE status IN ('running', 'awaiting_approval', 'awaiting_guidance') ORDER BY created_at DESC, rowid DESC LIMIT 1").get() as RunRow | undefined
    return row ? this.mapRun(row) : null
  }

  saveRun(run: WorkRun): void {
    this.runsRevision += 1
    this.connection.prepare(`
      INSERT INTO work_runs
      (id, plan_json, status, current_action_index, stop_requested, result, recovery_json, plan_approval_json, plan_authorization_json, supervision_amendments_json, budget_usage_json, budget_amendments_json, outcome_json, live_checkpoint_json, created_at, updated_at, public_lookup_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      run.id,
      JSON.stringify(run.plan),
      run.status,
      run.currentActionIndex,
      run.stopRequested ? 1 : 0,
      run.result,
      run.recoveryProposal ? JSON.stringify(run.recoveryProposal) : null,
      run.planApproval ? JSON.stringify(run.planApproval) : null,
      run.planAuthorization ? JSON.stringify(run.planAuthorization) : null,
      run.supervisionAmendments?.length ? JSON.stringify(run.supervisionAmendments) : null,
      run.budgetUsage ? JSON.stringify(run.budgetUsage) : null,
      run.budgetAmendments?.length ? JSON.stringify(run.budgetAmendments) : null,
      run.outcome ? JSON.stringify(run.outcome) : null,
      run.liveComputerCheckpoint ? JSON.stringify(run.liveComputerCheckpoint) : null,
      run.createdAt,
      run.updatedAt,
      run.publicLookup ? JSON.stringify(run.publicLookup) : null,
    )
  }

  updateRun(run: WorkRun): void {
    this.runsRevision += 1
    this.connection.prepare(`
      UPDATE work_runs SET plan_json = ?, status = ?, current_action_index = ?, stop_requested = ?, result = ?, recovery_json = ?, plan_approval_json = ?, plan_authorization_json = ?, supervision_amendments_json = ?, budget_usage_json = ?, budget_amendments_json = ?, outcome_json = ?, live_checkpoint_json = ?, updated_at = ?, public_lookup_json = ?
      WHERE id = ?
    `).run(
      JSON.stringify(run.plan),
      run.status,
      run.currentActionIndex,
      run.stopRequested ? 1 : 0,
      run.result,
      run.recoveryProposal ? JSON.stringify(run.recoveryProposal) : null,
      run.planApproval ? JSON.stringify(run.planApproval) : null,
      run.planAuthorization ? JSON.stringify(run.planAuthorization) : null,
      run.supervisionAmendments?.length ? JSON.stringify(run.supervisionAmendments) : null,
      run.budgetUsage ? JSON.stringify(run.budgetUsage) : null,
      run.budgetAmendments?.length ? JSON.stringify(run.budgetAmendments) : null,
      run.outcome ? JSON.stringify(run.outcome) : null,
      run.liveComputerCheckpoint ? JSON.stringify(run.liveComputerCheckpoint) : null,
      run.updatedAt,
      run.publicLookup ? JSON.stringify(run.publicLookup) : null,
      run.id,
    )
  }

  getRun(runId: string): WorkRun | null {
    const row = this.connection.prepare('SELECT * FROM work_runs WHERE id = ?').get(runId) as RunRow | undefined
    return row ? this.mapRun(row) : null
  }

  listRuns(): WorkRun[] {
    const rows = this.connection.prepare('SELECT * FROM work_runs ORDER BY created_at DESC, rowid DESC').all() as unknown as RunRow[]
    return rows.map((row) => this.mapRun(row))
  }

  private mapRun(row: RunRow): WorkRun {
    const plan = parseJson<ExecutionPlan>(row.plan_json)
    return {
      id: row.id,
      plan: { ...plan, parameterValues: plan.parameterValues ?? {} },
      status: row.status,
      currentActionIndex: row.current_action_index,
      stopRequested: row.stop_requested === 1,
      result: row.result,
      recoveryProposal: row.recovery_json ? parseJson<WorkRun['recoveryProposal']>(row.recovery_json) : null,
      planApproval: row.plan_approval_json ? parseJson<NonNullable<WorkRun['planApproval']>>(row.plan_approval_json) : null,
      ...(row.plan_authorization_json ? { planAuthorization: parseJson<NonNullable<WorkRun['planAuthorization']>>(row.plan_authorization_json) } : {}),
      ...(row.supervision_amendments_json ? { supervisionAmendments: parseJson<NonNullable<WorkRun['supervisionAmendments']>>(row.supervision_amendments_json) } : {}),
      ...(row.budget_usage_json ? { budgetUsage: parseJson<NonNullable<WorkRun['budgetUsage']>>(row.budget_usage_json) } : {}),
      ...(row.public_lookup_json ? { publicLookup: parseJson<NonNullable<WorkRun['publicLookup']>>(row.public_lookup_json) } : {}),
      ...(row.budget_amendments_json ? { budgetAmendments: parseJson<NonNullable<WorkRun['budgetAmendments']>>(row.budget_amendments_json) } : {}),
      ...(row.live_checkpoint_json ? { liveComputerCheckpoint: parseJson<NonNullable<WorkRun['liveComputerCheckpoint']>>(row.live_checkpoint_json) } : {}),
      ...(row.outcome_json ? { outcome: parseJson<NonNullable<WorkRun['outcome']>>(row.outcome_json) } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  saveApproval(approval: ApprovalRecord): void {
    this.connection.prepare(`
      INSERT INTO approvals
      (id, run_id, action_id, action_hash, kind, status, preview, expires_at, decided_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      approval.id,
      approval.runId,
      approval.actionId,
      approval.actionHash,
      approval.kind,
      approval.status,
      approval.preview,
      approval.expiresAt,
      approval.decidedAt,
    )
  }

  updateApproval(approval: ApprovalRecord): void {
    this.connection.prepare('UPDATE approvals SET status = ?, decided_at = ? WHERE id = ?')
      .run(approval.status, approval.decidedAt, approval.id)
  }

  getApproval(approvalId: string): ApprovalRecord | null {
    const row = this.connection.prepare('SELECT * FROM approvals WHERE id = ?').get(approvalId) as ApprovalRow | undefined
    return row ? this.mapApproval(row) : null
  }

  listApprovals(runId?: string): ApprovalRecord[] {
    const rows = runId
      ? this.connection.prepare('SELECT * FROM approvals WHERE run_id = ? ORDER BY rowid DESC').all(runId)
      : this.connection.prepare('SELECT * FROM approvals ORDER BY rowid DESC').all()
    return (rows as unknown as ApprovalRow[]).map((row) => this.mapApproval(row))
  }

  private mapApproval(row: ApprovalRow): ApprovalRecord {
    return {
      id: row.id,
      runId: row.run_id,
      actionId: row.action_id,
      actionHash: row.action_hash,
      kind: row.kind,
      status: row.status,
      preview: row.preview,
      expiresAt: row.expires_at,
      decidedAt: row.decided_at,
    }
  }

  saveCheckpointDecision(decision: CheckpointDecision): void {
    this.connection.prepare(`
      INSERT INTO checkpoint_decisions
      (id, run_id, session_id, subject, subject_id, subject_hash, plan_hash, policy_hash, boundary, effect_classes_json, reason_codes_json, preview_json, scope_json, status, created_at, expires_at, decided_at, decided_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      decision.id,
      decision.runId,
      decision.sessionId,
      decision.subject,
      decision.subjectId,
      decision.subjectHash,
      decision.planHash,
      decision.supervisionPolicyHash,
      decision.boundary,
      JSON.stringify(decision.effectClasses),
      JSON.stringify(decision.reasonCodes),
      JSON.stringify(decision.preview),
      JSON.stringify(decision.scope),
      decision.status,
      decision.createdAt,
      decision.expiresAt,
      decision.decidedAt,
      decision.decidedBy,
    )
  }

  updateCheckpointDecision(decision: CheckpointDecision): void {
    this.connection.prepare(`
      UPDATE checkpoint_decisions
      SET status = ?, expires_at = ?, decided_at = ?, decided_by = ?
      WHERE id = ?
    `).run(decision.status, decision.expiresAt, decision.decidedAt, decision.decidedBy, decision.id)
  }

  getCheckpointDecision(decisionId: string): CheckpointDecision | null {
    const row = this.connection.prepare('SELECT * FROM checkpoint_decisions WHERE id = ?').get(decisionId) as CheckpointDecisionRow | undefined
    return row ? this.mapCheckpointDecision(row) : null
  }

  listCheckpointDecisions(runId?: string, sessionId?: string): CheckpointDecision[] {
    const rows = runId && sessionId
      ? this.connection.prepare('SELECT * FROM checkpoint_decisions WHERE run_id = ? AND session_id = ? ORDER BY rowid DESC').all(runId, sessionId)
      : runId
        ? this.connection.prepare('SELECT * FROM checkpoint_decisions WHERE run_id = ? ORDER BY rowid DESC').all(runId)
        : this.connection.prepare('SELECT * FROM checkpoint_decisions ORDER BY rowid DESC').all()
    return (rows as unknown as CheckpointDecisionRow[]).map((row) => this.mapCheckpointDecision(row))
  }

  cancelPendingCheckpointDecisions(runId: string): number {
    return Number(this.connection.prepare(`
      UPDATE checkpoint_decisions
      SET status = 'cancelled', decided_at = COALESCE(decided_at, datetime('now')), decided_by = COALESCE(decided_by, 'user')
      WHERE run_id = ? AND status = 'pending'
    `).run(runId).changes ?? 0)
  }

  private mapCheckpointDecision(row: CheckpointDecisionRow): CheckpointDecision {
    return {
      version: 2,
      id: row.id,
      runId: row.run_id,
      sessionId: row.session_id,
      subject: row.subject,
      subjectId: row.subject_id,
      subjectHash: row.subject_hash,
      planHash: row.plan_hash,
      supervisionPolicyHash: row.policy_hash,
      boundary: row.boundary,
      effectClasses: parseJson<CheckpointDecision['effectClasses']>(row.effect_classes_json),
      reasonCodes: parseJson<string[]>(row.reason_codes_json),
      preview: parseJson<CheckpointDecision['preview']>(row.preview_json),
      scope: parseJson<CheckpointDecision['scope']>(row.scope_json),
      status: row.status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      decidedAt: row.decided_at,
      decidedBy: row.decided_by,
    }
  }

  appendAudit(event: Omit<AuditEvent, 'sequence'>): AuditEvent {
    this.connection.prepare(`
      INSERT INTO audit_events
      (id, occurred_at, category, actor, subject_id, details_json, previous_hash, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.occurredAt,
      event.category,
      event.actor,
      event.subjectId,
      JSON.stringify(event.details),
      event.previousHash,
      event.hash,
    )
    const row = this.connection.prepare('SELECT * FROM audit_events WHERE id = ?').get(event.id) as unknown as AuditRow
    return this.mapAudit(row)
  }

  latestAudit(): AuditEvent | null {
    const row = this.connection.prepare('SELECT * FROM audit_events ORDER BY sequence DESC LIMIT 1').get() as AuditRow | undefined
    return row ? this.mapAudit(row) : null
  }

  hasAuditEvent(category: string, subjectId: string): boolean {
    return Boolean(this.connection.prepare('SELECT 1 FROM audit_events WHERE category = ? AND subject_id = ? LIMIT 1').get(category, subjectId))
  }

  /** Every audit event about a run: as its subject, or carrying it in details. Oldest first. */
  listAuditForRun(runId: string, limit = 2_000): AuditEvent[] {
    const marker = `"runId":${JSON.stringify(runId)}`
    const rows = this.connection.prepare('SELECT * FROM audit_events WHERE subject_id = ? OR instr(details_json, ?) > 0 ORDER BY sequence ASC LIMIT ?').all(runId, marker, limit) as unknown as AuditRow[]
    return rows.map((row) => this.mapAudit(row))
  }

  /** One audit row by sequence, for checking that a cached chain head still stands. */
  auditAt(sequence: number): AuditEvent | null {
    const row = this.connection.prepare('SELECT * FROM audit_events WHERE sequence = ?').get(sequence) as AuditRow | undefined
    return row ? this.mapAudit(row) : null
  }

  /** Audit rows after a sequence, oldest first: the tail an incremental verification walks. */
  listAuditAfter(sequence: number, limit = 100_000): AuditEvent[] {
    const rows = this.connection.prepare('SELECT * FROM audit_events WHERE sequence > ? ORDER BY sequence ASC LIMIT ?').all(sequence, limit) as unknown as AuditRow[]
    return rows.map((row) => this.mapAudit(row))
  }

  listAudit(limit = 500): AuditEvent[] {
    const rows = this.connection.prepare('SELECT * FROM audit_events ORDER BY sequence DESC LIMIT ?').all(limit) as unknown as AuditRow[]
    return rows.map((row) => this.mapAudit(row))
  }

  /**
   * SQLite increments this connection-local value when another connection
   * commits a change. Consumers can use it to invalidate derived read caches
   * without rescanning an entire table on every UI refresh.
   */
  dataVersion(): number {
    const row = this.connection.prepare('PRAGMA data_version').get() as unknown as { data_version: number }
    return row.data_version
  }

  private mapAudit(row: AuditRow): AuditEvent {
    return {
      id: row.id,
      sequence: row.sequence,
      occurredAt: row.occurred_at,
      category: row.category,
      actor: row.actor,
      subjectId: row.subject_id,
      details: parseJson<Record<string, unknown>>(row.details_json),
      previousHash: row.previous_hash,
      hash: row.hash,
    }
  }

  /** Recall is a derived read model: writing a moment never alters evidence. */
  indexRecallMoment(moment: RecallMoment): void {
    this.connection.prepare(`
      INSERT INTO recall_moments(moment_id, source, occurred_at, app, title, body, session_id, screenshot_ref, url, sequence, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(moment_id) DO UPDATE SET
        occurred_at = excluded.occurred_at,
        app = excluded.app,
        title = excluded.title,
        body = excluded.body,
        session_id = excluded.session_id,
        screenshot_ref = excluded.screenshot_ref,
        url = excluded.url,
        sequence = excluded.sequence,
        duration_ms = excluded.duration_ms
    `).run(
      moment.momentId, moment.source, moment.occurredAt, moment.app, moment.title,
      moment.body, moment.sessionId, moment.screenshotRef, moment.url ?? null,
      moment.sequence ?? null, moment.durationMs ?? null,
    )
    this.connection.prepare('DELETE FROM recall_search WHERE moment_id = ?').run(moment.momentId)
    const row = this.connection.prepare('SELECT visual_description FROM recall_moments WHERE moment_id = ?').get(moment.momentId) as { visual_description: string } | undefined
    this.connection.prepare('INSERT INTO recall_search(moment_id, app, title, body) VALUES (?, ?, ?, ?)')
      .run(moment.momentId, moment.app, moment.title, `${moment.body}\n${moment.url ?? ''}\n${row?.visual_description ?? ''}`.trim())
    // A changed title or newly recovered URL may change the canonical resource.
    // Reproject this moment and remove any identity that no longer has evidence.
    this.connection.prepare('DELETE FROM recall_resource_occurrences WHERE moment_id = ?').run(moment.momentId)
    this.connection.prepare('DELETE FROM recall_resource_search WHERE resource_id NOT IN (SELECT resource_id FROM recall_resource_occurrences)').run()
    this.connection.prepare('DELETE FROM recall_resources WHERE resource_id NOT IN (SELECT resource_id FROM recall_resource_occurrences)').run()
    const projection = projectMemoryResource(moment)
    this.upsertRecallResource(projection.resource, projection.occurrence)
  }

  /** Resource projection is derived and rebuildable; source evidence is never changed. */
  upsertRecallResource(resource: MemoryResourceRecord, occurrence: MemoryResourceOccurrence): void {
    this.connection.prepare(`
      INSERT INTO recall_resources
      (resource_id, resource_type, canonical_key, title, canonical_url, domain, aliases_json, first_seen_at, last_seen_at, occurrence_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(resource_id) DO UPDATE SET
        title = excluded.title,
        canonical_url = COALESCE(excluded.canonical_url, recall_resources.canonical_url),
        domain = COALESCE(excluded.domain, recall_resources.domain),
        aliases_json = excluded.aliases_json,
        first_seen_at = MIN(recall_resources.first_seen_at, excluded.first_seen_at),
        last_seen_at = MAX(recall_resources.last_seen_at, excluded.last_seen_at)
    `).run(
      resource.id, resource.type, resource.canonicalKey, resource.title, resource.canonicalUrl,
      resource.domain, JSON.stringify(resource.aliases), resource.firstSeenAt, resource.lastSeenAt,
    )
    this.connection.prepare(`
      INSERT INTO recall_resource_occurrences
      (resource_id, moment_id, session_id, occurred_at, extraction_method, confidence)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(resource_id, moment_id) DO UPDATE SET
        session_id = excluded.session_id,
        occurred_at = excluded.occurred_at,
        extraction_method = excluded.extraction_method,
        confidence = excluded.confidence
    `).run(
      occurrence.resourceId, occurrence.momentId, occurrence.sessionId, occurrence.occurredAt,
      occurrence.extractionMethod, occurrence.confidence,
    )
    this.connection.prepare(`
      UPDATE recall_resources SET
        occurrence_count = (SELECT COUNT(*) FROM recall_resource_occurrences WHERE resource_id = ?),
        first_seen_at = (SELECT MIN(occurred_at) FROM recall_resource_occurrences WHERE resource_id = ?),
        last_seen_at = (SELECT MAX(occurred_at) FROM recall_resource_occurrences WHERE resource_id = ?)
      WHERE resource_id = ?
    `).run(resource.id, resource.id, resource.id, resource.id)
    this.connection.prepare('DELETE FROM recall_resource_search WHERE resource_id = ?').run(resource.id)
    this.connection.prepare(`
      INSERT INTO recall_resource_search(resource_id, resource_type, title, canonical_url, domain, aliases)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(resource.id, resource.type, resource.title, resource.canonicalUrl ?? '', resource.domain ?? '', resource.aliases.join(' '))
  }

  countRecallResources(): number {
    const row = this.connection.prepare('SELECT COUNT(*) AS c FROM recall_resources').get() as { c?: number } | undefined
    return Number(row?.c ?? 0)
  }

  listRecallResourcesForMoments(momentIds: string[]): Array<{ resource: MemoryResourceRecord; occurrence: MemoryResourceOccurrence }> {
    const ids = [...new Set(momentIds)]
    if (ids.length === 0) return []
    const rows = this.connection.prepare(`
      SELECT resources.*, occurrences.moment_id, occurrences.session_id, occurrences.occurred_at,
             occurrences.extraction_method, occurrences.confidence
      FROM recall_resource_occurrences occurrences
      JOIN recall_resources resources ON resources.resource_id = occurrences.resource_id
      WHERE occurrences.moment_id IN (${ids.map(() => '?').join(', ')})
      ORDER BY occurrences.occurred_at DESC
    `).all(...ids) as unknown as Array<RecallResourceRow & {
      moment_id: string
      session_id: string | null
      occurred_at: string
      extraction_method: MemoryResourceOccurrence['extractionMethod']
      confidence: number
    }>
    return rows.map((row) => ({
      resource: this.mapRecallResource(row),
      occurrence: {
        resourceId: row.resource_id,
        momentId: row.moment_id,
        sessionId: row.session_id,
        occurredAt: row.occurred_at,
        extractionMethod: row.extraction_method,
        confidence: row.confidence,
      },
    }))
  }

  listRecallResources(limit = 2_000): MemoryResourceRecord[] {
    const rows = this.connection.prepare('SELECT * FROM recall_resources ORDER BY last_seen_at DESC LIMIT ?').all(limit) as unknown as RecallResourceRow[]
    return rows.map((row) => this.mapRecallResource(row))
  }

  private mapRecallResource(row: RecallResourceRow): MemoryResourceRecord {
    return {
      id: row.resource_id,
      type: row.resource_type,
      canonicalKey: row.canonical_key,
      title: row.title,
      canonicalUrl: row.canonical_url,
      domain: row.domain,
      aliases: parseJson<string[]>(row.aliases_json),
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      occurrenceCount: row.occurrence_count,
    }
  }

  /**
   * Older recall projections intentionally kept only searchable text. Recall v2
   * can restore sequence, URL, and measured ambient dwell from immutable source
   * rows without re-running OCR or changing evidence.
   */
  hydrateRecallAnalyticalMetadata(): number {
    const observations = this.connection.prepare(`
      UPDATE recall_moments
      SET sequence = (
            SELECT observations.sequence FROM observations
            WHERE 'obs:' || observations.id = recall_moments.moment_id
          ),
          url = (
            SELECT json_extract(observations.facts_json, '$.url') FROM observations
            WHERE 'obs:' || observations.id = recall_moments.moment_id
          )
      WHERE source = 'observation'
        AND (
          sequence IS NULL
          OR (url IS NULL AND EXISTS (
            SELECT 1 FROM observations
            WHERE 'obs:' || observations.id = recall_moments.moment_id
              AND json_extract(observations.facts_json, '$.url') IS NOT NULL
          ))
        )
        AND EXISTS (SELECT 1 FROM observations WHERE 'obs:' || observations.id = recall_moments.moment_id)
    `).run()
    const ambient = this.connection.prepare(`
      UPDATE recall_moments
      SET duration_ms = (
        SELECT ambient_events.duration_ms FROM ambient_events
        WHERE 'amb:' || ambient_events.id = recall_moments.moment_id
      )
      WHERE source = 'ambient' AND duration_ms IS NULL
        AND EXISTS (SELECT 1 FROM ambient_events WHERE 'amb:' || ambient_events.id = recall_moments.moment_id)
    `).run()
    return Number(observations.changes ?? 0) + Number(ambient.changes ?? 0)
  }

  setRecallVisualDescription(observationId: string, description: string): void {
    const momentId = `obs:${observationId}`
    this.connection.prepare('UPDATE recall_moments SET visual_description = ? WHERE moment_id = ?').run(description, momentId)
    const row = this.connection.prepare('SELECT app, title, body, url, visual_description FROM recall_moments WHERE moment_id = ?').get(momentId) as { app: string; title: string; body: string; url: string | null; visual_description: string } | undefined
    if (!row) return
    this.connection.prepare('DELETE FROM recall_search WHERE moment_id = ?').run(momentId)
    this.connection.prepare('INSERT INTO recall_search(moment_id, app, title, body) VALUES (?, ?, ?, ?)')
      .run(momentId, row.app, row.title, `${row.body}\n${row.url ?? ''}\n${row.visual_description}`.trim())
    // The content-addressed chunk id changes on the next recall. Removing it
    // now prevents an old visual description being used in this process.
    this.connection.prepare('DELETE FROM recall_chunks WHERE moment_id = ?').run(momentId)
  }

  /** Re-indexing OCR must not leave entities extracted from the old text. */
  clearRecallEntityMentions(momentId: string): void {
    this.connection.prepare('DELETE FROM recall_entity_mentions WHERE moment_id = ?').run(momentId)
    this.rebuildRecallEntityStats()
  }

  removeObservationRecall(observationId: string): number {
    return this.deleteRecallMoments([`obs:${observationId}`])
  }

  recordRecallImageEgress(egress: RecallImageEgress): void {
    this.connection.prepare(`
      INSERT INTO recall_image_egress
      (id, occurred_at, observation_id, moment_id, review_id, review_version, sanitized_screenshot_ref, source_evidence_hash, image_sha256, provider_id, model)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      egress.id, egress.occurredAt, egress.observationId, egress.momentId, egress.reviewId,
      egress.reviewVersion, egress.sanitizedScreenshotRef, egress.sourceEvidenceHash,
      egress.imageSha256, egress.providerId, egress.model,
    )
  }

  listRecallImageEgress(observationId?: string): RecallImageEgress[] {
    const rows = (observationId
      ? this.connection.prepare('SELECT * FROM recall_image_egress WHERE observation_id = ? ORDER BY occurred_at').all(observationId)
      : this.connection.prepare('SELECT * FROM recall_image_egress ORDER BY occurred_at').all()) as unknown as Array<Record<string, string | number>>
    return rows.map((row) => ({
      id: String(row.id),
      occurredAt: String(row.occurred_at),
      observationId: String(row.observation_id),
      momentId: String(row.moment_id),
      reviewId: String(row.review_id),
      reviewVersion: Number(row.review_version),
      sanitizedScreenshotRef: String(row.sanitized_screenshot_ref),
      sourceEvidenceHash: String(row.source_evidence_hash),
      imageSha256: String(row.image_sha256),
      providerId: String(row.provider_id),
      model: String(row.model),
    }))
  }

  /**
   * Reconciles deterministic chunks without touching unchanged rows, so their
   * persisted vectors remain valid across restarts.
   */
  syncRecallChunks(chunks: Array<{
    id: string
    momentId: string
    ordinal: number
    contentSha256: string
    preprocessingVersion: string
    text: string
  }>): void {
    const byMoment = new Map<string, typeof chunks>()
    for (const chunk of chunks) {
      const group = byMoment.get(chunk.momentId) ?? []
      group.push(chunk)
      byMoment.set(chunk.momentId, group)
    }
    const insert = this.connection.prepare(`
      INSERT OR IGNORE INTO recall_chunks(chunk_id, moment_id, ordinal, content_sha256, preprocessing_version, text)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    const deleteChunk = this.connection.prepare('DELETE FROM recall_chunks WHERE chunk_id = ?')
    for (const [momentId, desired] of byMoment) {
      const wanted = new Set(desired.map((chunk) => chunk.id))
      const existing = this.connection.prepare('SELECT chunk_id FROM recall_chunks WHERE moment_id = ?').all(momentId) as unknown as Array<{ chunk_id: string }>
      for (const row of existing) if (!wanted.has(row.chunk_id)) deleteChunk.run(row.chunk_id)
      for (const chunk of desired) insert.run(chunk.id, chunk.momentId, chunk.ordinal, chunk.contentSha256, chunk.preprocessingVersion, chunk.text)
    }
  }

  loadRecallEmbeddings(providerId: string, modelId: string, chunkIds: Set<string>): Map<string, Float32Array> {
    const rows = this.connection.prepare(`
      SELECT chunk_id, dimensions, vector_blob FROM recall_embeddings
      WHERE provider_id = ? AND model_id = ?
    `).all(providerId, modelId) as unknown as Array<{ chunk_id: string; dimensions: number; vector_blob: Uint8Array }>
    const vectors = new Map<string, Float32Array>()
    for (const row of rows) {
      if (!chunkIds.has(row.chunk_id)) continue
      const bytes = Buffer.from(row.vector_blob)
      if (row.dimensions <= 0 || bytes.length !== row.dimensions * 4) continue
      const vector = new Float32Array(row.dimensions)
      let valid = true
      for (let index = 0; index < row.dimensions; index += 1) {
        const value = bytes.readFloatLE(index * 4)
        if (!Number.isFinite(value)) { valid = false; break }
        vector[index] = value
      }
      if (valid) vectors.set(row.chunk_id, vector)
    }
    return vectors
  }

  saveRecallEmbeddings(providerId: string, modelId: string, documents: Array<{ id: string }>, vectors: Float32Array[], createdAt: string): void {
    if (documents.length !== vectors.length) throw new Error('Cannot persist an embedding batch with mismatched inputs and vectors')
    const dimensions = vectors[0]?.length ?? 0
    if (dimensions <= 0 || vectors.some((vector) => vector.length !== dimensions)) throw new Error('Cannot persist inconsistent embedding dimensions')
    const prior = this.connection.prepare('SELECT dimensions FROM recall_embeddings WHERE provider_id = ? AND model_id = ? LIMIT 1').get(providerId, modelId) as { dimensions: number } | undefined
    if (prior && prior.dimensions !== dimensions) throw new Error(`Embedding dimensions changed for ${providerId}/${modelId}; choose a new model id or rebuild the index`)
    const insert = this.connection.prepare(`
      INSERT INTO recall_embeddings(chunk_id, provider_id, model_id, dimensions, vector_blob, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(chunk_id, provider_id, model_id) DO UPDATE SET dimensions = excluded.dimensions, vector_blob = excluded.vector_blob, created_at = excluded.created_at
    `)
    for (let index = 0; index < documents.length; index += 1) {
      const vector = vectors[index]
      const document = documents[index]
      if (!vector || !document || [...vector].some((value) => !Number.isFinite(value))) throw new Error('Cannot persist an invalid embedding vector')
      const bytes = Buffer.allocUnsafe(vector.length * 4)
      for (let offset = 0; offset < vector.length; offset += 1) bytes.writeFloatLE(vector[offset] ?? 0, offset * 4)
      insert.run(document.id, providerId, modelId, dimensions, bytes, createdAt)
    }
  }

  countRecallEmbeddings(providerId?: string, modelId?: string): number {
    const row = providerId && modelId
      ? this.connection.prepare('SELECT COUNT(*) AS c FROM recall_embeddings WHERE provider_id = ? AND model_id = ?').get(providerId, modelId)
      : this.connection.prepare('SELECT COUNT(*) AS c FROM recall_embeddings').get()
    return Number((row as { c?: number } | undefined)?.c ?? 0)
  }

  deleteRecallEmbeddings(providerId: string, modelId: string): number {
    return Number(this.connection.prepare('DELETE FROM recall_embeddings WHERE provider_id = ? AND model_id = ?').run(providerId, modelId).changes ?? 0)
  }

  /**
   * Cross-checks the derived recall read model. Foreign keys protect the
   * chunk/vector side; the explicit counts also cover FTS and association
   * tables that SQLite virtual-table constraints cannot protect for us.
   */
  recallIntegrityIssues(): {
    orphanSearchRows: number
    orphanEntityMentions: number
    orphanRetrievals: number
    orphanChunks: number
    orphanEmbeddings: number
  } {
    const count = (sql: string): number => {
      const row = this.connection.prepare(sql).get() as { c?: number } | undefined
      return Number(row?.c ?? 0)
    }
    return {
      orphanSearchRows: count('SELECT COUNT(*) AS c FROM recall_search WHERE moment_id NOT IN (SELECT moment_id FROM recall_moments)'),
      orphanEntityMentions: count('SELECT COUNT(*) AS c FROM recall_entity_mentions WHERE moment_id NOT IN (SELECT moment_id FROM recall_moments)'),
      orphanRetrievals: count('SELECT COUNT(*) AS c FROM recall_retrievals WHERE moment_id NOT IN (SELECT moment_id FROM recall_moments)'),
      orphanChunks: count('SELECT COUNT(*) AS c FROM recall_chunks WHERE moment_id NOT IN (SELECT moment_id FROM recall_moments)'),
      orphanEmbeddings: count('SELECT COUNT(*) AS c FROM recall_embeddings WHERE chunk_id NOT IN (SELECT chunk_id FROM recall_chunks)'),
    }
  }

  /** Recall entities are kept out of `memory_entities` so native observation
   *  can never reach procedure retrieval or planning through them. */
  linkRecallEntity(entity: ExtractedEntity, momentId: string, occurredAt: string): void {
    const id = entityId(entity.kind, entity.normalized)
    const existing = this.connection.prepare('SELECT mention_count FROM recall_entities WHERE id = ?').get(id) as { mention_count: number } | undefined
    if (!existing) {
      this.connection.prepare(`
        INSERT INTO recall_entities(id, kind, name, normalized, first_seen_at, last_seen_at, mention_count)
        VALUES (?, ?, ?, ?, ?, ?, 0)
      `).run(id, entity.kind, entity.name, entity.normalized, occurredAt, occurredAt)
    }
    const linked = this.connection.prepare('INSERT OR IGNORE INTO recall_entity_mentions(entity_id, moment_id) VALUES (?, ?)').run(id, momentId)
    if (Number(linked.changes ?? 0) === 0) return
    this.connection.prepare(`
      UPDATE recall_entities
      SET mention_count = mention_count + 1,
          first_seen_at = MIN(first_seen_at, ?),
          last_seen_at = MAX(last_seen_at, ?)
      WHERE id = ?
    `).run(occurredAt, occurredAt, id)
  }

  listRecallEntitiesForMoments(momentIds: string[]): RecallEntity[] {
    if (momentIds.length === 0) return []
    const placeholders = momentIds.map(() => '?').join(',')
    const rows = this.connection.prepare(`
      SELECT e.*, COUNT(m.moment_id) AS hits
      FROM recall_entities e
      JOIN recall_entity_mentions m ON m.entity_id = e.id
      WHERE m.moment_id IN (${placeholders})
      GROUP BY e.id
      ORDER BY hits DESC, e.mention_count DESC
    `).all(...momentIds) as unknown as Array<Record<string, string | number>>
    return rows.map((row) => ({
      id: String(row.id),
      kind: String(row.kind) as RecallEntity['kind'],
      name: String(row.name),
      normalized: String(row.normalized),
      firstSeenAt: String(row.first_seen_at),
      lastSeenAt: String(row.last_seen_at),
      mentionCount: Number(row.hits),
    }))
  }

  /** Every retrieval is a presentation: recalling something makes it stronger. */
  recordRecallRetrievals(momentIds: string[], atIso: string): void {
    const insert = this.connection.prepare('INSERT INTO recall_retrievals(moment_id, retrieved_at) VALUES (?, ?)')
    for (const momentId of momentIds) insert.run(momentId, atIso)
  }

  listRecallPresentations(): Map<string, number[]> {
    const rows = this.connection.prepare('SELECT moment_id, retrieved_at FROM recall_retrievals').all() as unknown as Array<{ moment_id: string; retrieved_at: string }>
    const presentations = new Map<string, number[]>()
    for (const row of rows) {
      const times = presentations.get(row.moment_id) ?? []
      times.push(Date.parse(row.retrieved_at))
      presentations.set(row.moment_id, times)
    }
    return presentations
  }

  searchRecallMomentIds(match: string, limit = 500): string[] {
    try {
      const rows = this.connection.prepare(`
        SELECT moment_id FROM recall_search WHERE recall_search MATCH ? ORDER BY bm25(recall_search) LIMIT ?
      `).all(match, limit) as unknown as Array<{ moment_id: string }>
      return rows.map((row) => row.moment_id)
    } catch {
      return []
    }
  }

  /** BM25-ranked, rather than the boolean match set the ranking used to discard. */
  rankRecallMomentIdsByBm25(match: string, limit = 500): string[] {
    try {
      const rows = this.connection.prepare(`
        SELECT moment_id FROM recall_search
        WHERE recall_search MATCH ?
        ORDER BY bm25(recall_search, 1.0, 3.0, 1.0)
        LIMIT ?
      `).all(match, limit) as unknown as Array<{ moment_id: string }>
      return rows.map((row) => row.moment_id)
    } catch {
      return []
    }
  }

  rankRecallMomentIdsByBm25InScope(match: string, limit: number, fromIso: string | null, toIso: string | null, sessionIds: string[] = []): string[] {
    const clauses = ['recall_search MATCH ?']
    const params: Array<string | number> = [match]
    if (fromIso) { clauses.push('moments.occurred_at >= ?'); params.push(fromIso) }
    if (toIso) { clauses.push('moments.occurred_at < ?'); params.push(toIso) }
    const sessions = [...new Set(sessionIds)]
    if (sessions.length > 0) {
      clauses.push(`moments.session_id IN (${sessions.map(() => '?').join(', ')})`)
      params.push(...sessions)
    }
    params.push(limit)
    try {
      const rows = this.connection.prepare(`
        SELECT recall_search.moment_id
        FROM recall_search
        JOIN recall_moments moments ON moments.moment_id = recall_search.moment_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY bm25(recall_search, 1.0, 3.0, 1.0)
        LIMIT ?
      `).all(...params) as unknown as Array<{ moment_id: string }>
      return rows.map((row) => row.moment_id)
    } catch {
      return []
    }
  }

  /** Moments mentioning an entity whose name contains any of the given terms. */
  listMomentIdsForEntityTerms(terms: string[], limit = 500): string[] {
    const usable = terms.filter((term) => term.length > 2)
    if (usable.length === 0) return []
    const clauses = usable.map(() => 'e.normalized LIKE ?').join(' OR ')
    const params: Array<string | number> = usable.map((term) => `%${term.toLowerCase()}%`)
    params.push(limit)
    try {
      const rows = this.connection.prepare(`
        SELECT m.moment_id, COUNT(*) AS strength
        FROM recall_entities e
        JOIN recall_entity_mentions m ON m.entity_id = e.id
        WHERE ${clauses}
        GROUP BY m.moment_id
        ORDER BY strength DESC
        LIMIT ?
      `).all(...params) as unknown as Array<{ moment_id: string }>
      return rows.map((row) => row.moment_id)
    } catch {
      return []
    }
  }

  listMomentIdsForEntityTermsInScope(terms: string[], limit: number, fromIso: string | null, toIso: string | null, sessionIds: string[] = []): string[] {
    const usable = terms.filter((term) => term.length > 2)
    if (usable.length === 0) return []
    const entityClauses = usable.map(() => 'e.normalized LIKE ?').join(' OR ')
    const params: Array<string | number> = usable.map((term) => `%${term.toLowerCase()}%`)
    const scopeClauses: string[] = []
    if (fromIso) { scopeClauses.push('moments.occurred_at >= ?'); params.push(fromIso) }
    if (toIso) { scopeClauses.push('moments.occurred_at < ?'); params.push(toIso) }
    const sessions = [...new Set(sessionIds)]
    if (sessions.length > 0) {
      scopeClauses.push(`moments.session_id IN (${sessions.map(() => '?').join(', ')})`)
      params.push(...sessions)
    }
    params.push(limit)
    try {
      const rows = this.connection.prepare(`
        SELECT mentions.moment_id, COUNT(*) AS strength
        FROM recall_entities e
        JOIN recall_entity_mentions mentions ON mentions.entity_id = e.id
        JOIN recall_moments moments ON moments.moment_id = mentions.moment_id
        WHERE (${entityClauses})${scopeClauses.length > 0 ? ` AND ${scopeClauses.join(' AND ')}` : ''}
        GROUP BY mentions.moment_id
        ORDER BY strength DESC
        LIMIT ?
      `).all(...params) as unknown as Array<{ moment_id: string }>
      return rows.map((row) => row.moment_id)
    } catch {
      return []
    }
  }

  listRecallMoments(fromIso: string | null, toIso: string | null, limit = 4_000, sessionIds: string[] = []): RecallMoment[] {
    const clauses: string[] = []
    const params: Array<string | number> = []
    if (fromIso) { clauses.push('occurred_at >= ?'); params.push(fromIso) }
    if (toIso) { clauses.push('occurred_at < ?'); params.push(toIso) }
    const sessions = [...new Set(sessionIds)]
    if (sessions.length > 0) {
      clauses.push(`session_id IN (${sessions.map(() => '?').join(', ')})`)
      params.push(...sessions)
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    params.push(limit)
    const rows = this.connection.prepare(`SELECT * FROM recall_moments ${where} ORDER BY occurred_at DESC LIMIT ?`).all(...params) as unknown as Array<Record<string, string | null>>
    return rows.map((row) => ({
      momentId: String(row.moment_id),
      source: String(row.source) === 'ambient' ? 'ambient' : 'observation',
      occurredAt: String(row.occurred_at),
      app: String(row.app),
      title: String(row.title),
      body: `${String(row.body)}${row.visual_description ? `\nReviewed visual description: ${String(row.visual_description)}` : ''}`,
      sessionId: row.session_id ?? null,
      screenshotRef: row.screenshot_ref ?? null,
      url: row.url ?? null,
      sequence: row.sequence === null ? null : Number(row.sequence),
      durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    }))
  }

  countRecallEntities(): number {
    const row = this.connection.prepare('SELECT COUNT(*) AS c FROM recall_entities').get() as { c: number } | undefined
    return Number(row?.c ?? 0)
  }

  countRecallMoments(): number {
    const row = this.connection.prepare('SELECT COUNT(*) AS c FROM recall_moments').get() as { c: number } | undefined
    return Number(row?.c ?? 0)
  }

  /** How much evidence a window holds, for showing the cost of a choice before it is made. */
  countRecallMomentsInWindow(fromIso: string | null, toIso: string | null, sessionIds: string[] = []): number {
    const sessions = [...new Set(sessionIds)]
    const sessionClause = sessions.length > 0 ? `AND session_id IN (${sessions.map(() => '?').join(', ')})` : ''
    const row = this.connection.prepare(`
      SELECT COUNT(*) AS c FROM recall_moments
      WHERE (? IS NULL OR occurred_at >= ?) AND (? IS NULL OR occurred_at < ?)
      ${sessionClause}
    `).get(fromIso, fromIso, toIso, toIso, ...sessions) as { c: number } | undefined
    return Number(row?.c ?? 0)
  }

  recordModelCall(call: ModelCall): void {
    this.connection.prepare(`
      INSERT INTO model_calls(id, occurred_at, provider_id, provider_kind, model, job, input_tokens, output_tokens, status, run_id, session_id, phase, duration_ms, vision_frames, total_tokens, cached_input_tokens, reasoning_tokens, turn_index, response_chain_id, telemetry_json, runtime_build_id, cache_write_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(call.id, call.occurredAt, call.providerId, call.providerKind, call.model, call.job, call.inputTokens, call.outputTokens, call.status ?? 'completed', call.runId ?? null, call.sessionId ?? null, call.phase ?? null, call.durationMs ?? null, call.visionFrames ?? 0, call.totalTokens ?? null, call.cachedInputTokens ?? null, call.reasoningTokens ?? null, call.turnIndex ?? null, call.responseChainId ?? null, call.telemetry ? JSON.stringify(call.telemetry) : null, call.runtimeBuildId ?? runtimeBuildId, call.cacheWriteTokens ?? null)
  }

  listModelCalls(sinceIso: string | null = null, limit = 5_000): ModelCall[] {
    const rows = this.connection.prepare(`
      SELECT * FROM model_calls WHERE (? IS NULL OR occurred_at >= ?) ORDER BY occurred_at DESC LIMIT ?
    `).all(sinceIso, sinceIso, limit) as unknown as Array<Record<string, string | number | null>>
    return rows.map((row) => ({
      id: String(row.id),
      occurredAt: String(row.occurred_at),
      providerId: String(row.provider_id),
      providerKind: String(row.provider_kind) as ModelCall['providerKind'],
      model: String(row.model),
      job: String(row.job) as ModelCall['job'],
      inputTokens: row.input_tokens === null ? null : Number(row.input_tokens),
      outputTokens: row.output_tokens === null ? null : Number(row.output_tokens),
      totalTokens: row.total_tokens === null ? null : Number(row.total_tokens),
      cachedInputTokens: row.cached_input_tokens === null ? null : Number(row.cached_input_tokens),
      reasoningTokens: row.reasoning_tokens === null ? null : Number(row.reasoning_tokens),
      status: row.status === 'failed' ? 'failed' : 'completed',
      runId: row.run_id === null ? null : String(row.run_id),
      sessionId: row.session_id === null ? null : String(row.session_id),
      phase: row.phase === null ? null : String(row.phase),
      durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
      visionFrames: Number(row.vision_frames ?? 0),
      turnIndex: row.turn_index === null ? null : Number(row.turn_index),
      responseChainId: row.response_chain_id === null ? null : String(row.response_chain_id),
      cacheWriteTokens: row.cache_write_tokens === null ? null : Number(row.cache_write_tokens),
      runtimeBuildId: row.runtime_build_id === null ? null : String(row.runtime_build_id),
      ...(row.telemetry_json ? { telemetry: JSON.parse(String(row.telemetry_json)) as NonNullable<ModelCall['telemetry']> } : {}),
    }))
  }

  modelUsageForRun(runId: string): { modelCalls: number; inputTokens: number; outputTokens: number; visionFrames: number } {
    const row = this.connection.prepare(`
      SELECT COUNT(*) AS model_calls,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(vision_frames), 0) AS vision_frames
      FROM model_calls WHERE run_id = ?
    `).get(runId) as { model_calls: number; input_tokens: number; output_tokens: number; vision_frames: number }
    return {
      modelCalls: Number(row.model_calls),
      inputTokens: Number(row.input_tokens),
      outputTokens: Number(row.output_tokens),
      visionFrames: Number(row.vision_frames),
    }
  }

  /** Captures still holding only a window name, never read for their contents. */
  countUnreadRecallMoments(): number {
    const row = this.connection.prepare(`
      SELECT COUNT(*) AS c FROM recall_moments
      WHERE source = 'observation' AND screenshot_ref IS NOT NULL AND body LIKE '%No window text%'
        AND read_skipped = 0
    `).get() as { c: number } | undefined
    return Number(row?.c ?? 0)
  }

  /** Unread captures inside a window, so a prompt can be about this search only. */
  countUnreadRecallMomentsInWindow(fromIso: string | null, toIso: string | null, sessionIds: string[] = []): number {
    const sessions = [...new Set(sessionIds)]
    const sessionClause = sessions.length > 0 ? `AND session_id IN (${sessions.map(() => '?').join(', ')})` : ''
    const row = this.connection.prepare(`
      SELECT COUNT(*) AS c FROM recall_moments
      WHERE source = 'observation' AND screenshot_ref IS NOT NULL AND body LIKE '%No window text%'
        AND read_skipped = 0
        AND (? IS NULL OR occurred_at >= ?) AND (? IS NULL OR occurred_at < ?)
        ${sessionClause}
    `).get(fromIso, fromIso, toIso, toIso, ...sessions) as { c: number } | undefined
    return Number(row?.c ?? 0)
  }

  /** The unread captures themselves, so a person can see what they are being asked about. */
  listUnreadRecallMoments(fromIso: string | null, toIso: string | null, limit: number, sessionIds: string[] = []): RecallMoment[] {
    const sessions = [...new Set(sessionIds)]
    const sessionClause = sessions.length > 0 ? `AND session_id IN (${sessions.map(() => '?').join(', ')})` : ''
    const rows = this.connection.prepare(`
      SELECT * FROM recall_moments
      WHERE source = 'observation' AND screenshot_ref IS NOT NULL AND body LIKE '%No window text%'
        AND read_skipped = 0
        AND (? IS NULL OR occurred_at >= ?) AND (? IS NULL OR occurred_at < ?)
        ${sessionClause}
      ORDER BY occurred_at DESC LIMIT ?
    `).all(fromIso, fromIso, toIso, toIso, ...sessions, limit) as unknown as Array<Record<string, string | null>>
    return rows.map((row) => ({
      momentId: String(row.moment_id),
      source: 'observation' as const,
      occurredAt: String(row.occurred_at),
      app: String(row.app),
      title: String(row.title),
      body: `${String(row.body)}${row.visual_description ? `\nReviewed visual description: ${String(row.visual_description)}` : ''}`,
      sessionId: row.session_id ?? null,
      screenshotRef: row.screenshot_ref ?? null,
    }))
  }

  setRecallMomentsSkipped(momentIds: string[], skipped: boolean): void {
    const statement = this.connection.prepare('UPDATE recall_moments SET read_skipped = ? WHERE moment_id = ?')
    for (const momentId of momentIds) statement.run(skipped ? 1 : 0, momentId)
  }

  countSkippedRecallMoments(): number {
    const row = this.connection.prepare('SELECT COUNT(*) AS c FROM recall_moments WHERE read_skipped = 1').get() as { c: number } | undefined
    return Number(row?.c ?? 0)
  }

  clearRecallSkips(): number {
    const skipped = this.countSkippedRecallMoments()
    this.connection.exec('UPDATE recall_moments SET read_skipped = 0 WHERE read_skipped = 1')
    return skipped
  }

  /** Oldest capture still on disk, for showing how far back "anytime" reaches. */
  earliestRecallMomentIso(): string | null {
    const row = this.connection.prepare('SELECT MIN(occurred_at) AS t FROM recall_moments').get() as { t: string | null } | undefined
    return row?.t ?? null
  }

  pruneRecallEntities(): void {
    this.rebuildRecallEntityStats()
  }

  pruneRecallMoments(beforeIso: string): number {
    const ids = (this.connection.prepare('SELECT moment_id FROM recall_moments WHERE occurred_at < ?').all(beforeIso) as unknown as Array<{ moment_id: string }>)
      .map((row) => row.moment_id)
    return this.deleteRecallMoments(ids)
  }

  /** Ambient retention must not erase session evidence that happens to be old. */
  pruneAmbientRecallMoments(beforeIso: string): number {
    const ids = (this.connection.prepare("SELECT moment_id FROM recall_moments WHERE source = 'ambient' AND occurred_at < ?").all(beforeIso) as unknown as Array<{ moment_id: string }>)
      .map((row) => row.moment_id)
    return this.deleteRecallMoments(ids)
  }

  /**
   * Removes a derived recall read-model completely. The caller owns the outer
   * transaction when source evidence is being removed alongside it.
   */
  private deleteRecallMoments(momentIds: string[]): number {
    if (momentIds.length === 0) return 0
    const deleteRetrievals = this.connection.prepare('DELETE FROM recall_retrievals WHERE moment_id = ?')
    const deleteSearch = this.connection.prepare('DELETE FROM recall_search WHERE moment_id = ?')
    const deleteMentions = this.connection.prepare('DELETE FROM recall_entity_mentions WHERE moment_id = ?')
    const deleteMoment = this.connection.prepare('DELETE FROM recall_moments WHERE moment_id = ?')
    let removed = 0
    for (const momentId of momentIds) {
      deleteRetrievals.run(momentId)
      deleteSearch.run(momentId)
      deleteMentions.run(momentId)
      removed += Number(deleteMoment.run(momentId).changes ?? 0)
    }
    this.rebuildRecallEntityStats()
    return removed
  }

  /** Keeps aggregate entity metadata truthful after a moment is removed. */
  private rebuildRecallEntityStats(): void {
    this.connection.exec(`
      DELETE FROM recall_entity_mentions WHERE moment_id NOT IN (SELECT moment_id FROM recall_moments);
      DELETE FROM recall_entities WHERE id NOT IN (SELECT entity_id FROM recall_entity_mentions);
      UPDATE recall_entities
      SET mention_count = (SELECT COUNT(*) FROM recall_entity_mentions mentions WHERE mentions.entity_id = recall_entities.id),
          first_seen_at = (SELECT MIN(moments.occurred_at) FROM recall_entity_mentions mentions JOIN recall_moments moments ON moments.moment_id = mentions.moment_id WHERE mentions.entity_id = recall_entities.id),
          last_seen_at = (SELECT MAX(moments.occurred_at) FROM recall_entity_mentions mentions JOIN recall_moments moments ON moments.moment_id = mentions.moment_id WHERE mentions.entity_id = recall_entities.id);
    `)
  }

  appendAmbientEvent(event: AmbientEvent): void {
    this.connection.prepare(`
      INSERT INTO ambient_events(id, app, window_title, signature, started_at, ended_at, duration_ms, text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(event.id, event.app, event.windowTitle, event.signature, event.startedAt, event.endedAt, event.durationMs, event.text ?? '')
  }

  listAmbientEvents(sinceIso: string): AmbientEvent[] {
    const rows = this.connection.prepare('SELECT * FROM ambient_events WHERE started_at >= ? ORDER BY started_at').all(sinceIso) as unknown as Array<Record<string, string | number>>
    return rows.map((row) => ({
      id: String(row.id),
      app: String(row.app),
      windowTitle: String(row.window_title),
      signature: String(row.signature),
      startedAt: String(row.started_at),
      endedAt: String(row.ended_at),
      durationMs: Number(row.duration_ms),
      ...(row.text ? { text: String(row.text) } : {}),
    }))
  }

  pruneAmbientEvents(beforeIso: string): number {
    const result = this.connection.prepare('DELETE FROM ambient_events WHERE started_at < ?').run(beforeIso)
    return Number(result.changes ?? 0)
  }

  setSetting(key: string, value: string): void {
    this.connection.prepare(`
      INSERT INTO settings(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value)
  }

  /** Remove only the legacy cloud bearer tokens after Keychain read-back.
   * secure_delete is already enabled. Truncate WAL so old frames do not retain
   * the plaintext; a busy reader makes migration retry instead of claiming done. */
  eraseLegacyCloudCredentials(): void {
    this.connection.exec("BEGIN IMMEDIATE; DELETE FROM settings WHERE key IN ('cloud.device_token', 'cloud.session_token'); COMMIT;")
    const checkpoint = this.connection.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as { busy: number }
    if (checkpoint.busy !== 0) throw new Error('Cloud credential migration needs the local database reader to finish; retry')
  }

  /** Every setting whose key starts with prefix, in one query (work progress for all runs at once). */
  settingsWithPrefix(prefix: string): Array<{ key: string; value: string }> {
    return this.connection.prepare("SELECT key, value FROM settings WHERE key >= ? AND key < ?").all(prefix, prefix + '\uffff') as unknown as Array<{ key: string; value: string }>
  }

  getSetting(key: string): string | null {
    const row = this.connection.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value ?? null
  }

  createRecallConversation(input: { id: string; title: string; createdAt: string; scope: RecallScopeInput | null }): RecallConversationSummary {
    this.connection.prepare(`
      INSERT INTO recall_conversations(id, title, created_at, updated_at, scope_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(input.id, input.title, input.createdAt, input.createdAt, input.scope === null ? null : JSON.stringify(input.scope))
    const created = this.getRecallConversation(input.id)
    if (!created) throw new Error('Recall conversation was not created')
    return this.summarizeRecallConversation(created)
  }

  listRecallConversations(limit = 100): RecallConversationSummary[] {
    const rows = this.connection.prepare(`
      SELECT conversations.*, COUNT(messages.id) AS message_count
      FROM recall_conversations conversations
      LEFT JOIN recall_conversation_messages messages ON messages.conversation_id = conversations.id
      GROUP BY conversations.id
      ORDER BY conversations.updated_at DESC
      LIMIT ?
    `).all(limit) as unknown as RecallConversationRow[]
    return rows.map((row) => this.mapRecallConversationSummary(row))
  }

  getRecallConversation(conversationId: string): RecallConversation | null {
    const row = this.connection.prepare(`
      SELECT conversations.*, COUNT(messages.id) AS message_count
      FROM recall_conversations conversations
      LEFT JOIN recall_conversation_messages messages ON messages.conversation_id = conversations.id
      WHERE conversations.id = ?
      GROUP BY conversations.id
    `).get(conversationId) as RecallConversationRow | undefined
    if (!row) return null
    const messages = this.connection.prepare(`
      SELECT * FROM recall_conversation_messages
      WHERE conversation_id = ?
      ORDER BY created_at, rowid
    `).all(conversationId) as unknown as RecallConversationMessageRow[]
    return { ...this.mapRecallConversationSummary(row), messages: messages.map((message) => this.mapRecallConversationMessage(message)) }
  }

  appendRecallConversationTurn(input: {
    conversationId: string
    user: { id: string; content: string; createdAt: string }
    assistant: { id: string; content: string; createdAt: string; result: Record<string, unknown> }
  }): RecallConversation {
    this.connection.exec('BEGIN IMMEDIATE')
    try {
      this.connection.prepare(`
        INSERT INTO recall_conversation_messages(id, conversation_id, role, content, created_at, result_json)
        VALUES (?, ?, 'user', ?, ?, NULL)
      `).run(input.user.id, input.conversationId, input.user.content, input.user.createdAt)
      this.connection.prepare(`
        INSERT INTO recall_conversation_messages(id, conversation_id, role, content, created_at, result_json)
        VALUES (?, ?, 'assistant', ?, ?, ?)
      `).run(input.assistant.id, input.conversationId, input.assistant.content, input.assistant.createdAt, JSON.stringify(input.assistant.result))
      this.connection.prepare('UPDATE recall_conversations SET updated_at = ? WHERE id = ?').run(input.assistant.createdAt, input.conversationId)
      this.connection.exec('COMMIT')
    } catch (error) {
      this.connection.exec('ROLLBACK')
      throw error
    }
    const conversation = this.getRecallConversation(input.conversationId)
    if (!conversation) throw new Error('Recall conversation disappeared while saving a turn')
    return conversation
  }

  replaceLatestRecallAssistant(conversationId: string, content: string, result: Record<string, unknown>, updatedAt: string): boolean {
    const latest = this.connection.prepare(`
      SELECT id FROM recall_conversation_messages
      WHERE conversation_id = ? AND role = 'assistant'
      ORDER BY created_at DESC, rowid DESC LIMIT 1
    `).get(conversationId) as { id: string } | undefined
    if (!latest) return false
    this.connection.prepare('UPDATE recall_conversation_messages SET content = ?, result_json = ?, created_at = ? WHERE id = ?')
      .run(content, JSON.stringify(result), updatedAt, latest.id)
    this.connection.prepare('UPDATE recall_conversations SET updated_at = ? WHERE id = ?').run(updatedAt, conversationId)
    return true
  }

  renameRecallConversation(conversationId: string, title: string, updatedAt: string): RecallConversationSummary | null {
    const changed = this.connection.prepare('UPDATE recall_conversations SET title = ?, updated_at = ? WHERE id = ?').run(title, updatedAt, conversationId)
    if (Number(changed.changes ?? 0) === 0) return null
    const conversation = this.getRecallConversation(conversationId)
    if (!conversation) return null
    return this.summarizeRecallConversation(conversation)
  }

  deleteRecallConversation(conversationId: string): boolean {
    return Number(this.connection.prepare('DELETE FROM recall_conversations WHERE id = ?').run(conversationId).changes ?? 0) > 0
  }

  private mapRecallConversationSummary(row: RecallConversationRow): RecallConversationSummary {
    return {
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      scope: row.scope_json ? parseJson<RecallScopeInput>(row.scope_json) : null,
      messageCount: Number(row.message_count ?? 0),
    }
  }

  private mapRecallConversationMessage(row: RecallConversationMessageRow): RecallConversationMessage {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
      result: row.result_json ? parseJson<Record<string, unknown>>(row.result_json) : null,
    }
  }

  private summarizeRecallConversation(conversation: RecallConversation): RecallConversationSummary {
    return {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      scope: conversation.scope,
      messageCount: conversation.messageCount,
    }
  }

  purgeAll(): void {
    this.runsRevision += 1
    this.connection.exec(`
      BEGIN IMMEDIATE;
      DELETE FROM checkpoint_decisions;
      DELETE FROM approvals;
      DELETE FROM work_runs;
      DELETE FROM memory_edges;
      DELETE FROM memory_entities;
      DELETE FROM observation_reviews;
      DELETE FROM ai_workflow_drafts;
      DELETE FROM procedure_versions;
      DELETE FROM procedure_search;
      DELETE FROM observations;
      DELETE FROM learning_sessions;
      DELETE FROM audit_events;
      DELETE FROM recall_conversation_messages;
      DELETE FROM recall_conversations;
      DELETE FROM recall_retrievals;
      DELETE FROM recall_entity_mentions;
      DELETE FROM recall_entities;
      DELETE FROM recall_search;
      DELETE FROM recall_moments;
      DELETE FROM ambient_events;
      DELETE FROM settings;
      DELETE FROM sqlite_sequence WHERE name = 'audit_events';
      COMMIT;
    `)
  }
}
