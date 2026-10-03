/**
 * Completion evidence the controller can establish on its own.
 *
 * Three numbers from testing had one lever behind them. Correct
 * writes went unreported (six of eight byte-correct files in one run, four of
 * four TextEdit files in another, half of them told to nobody) because the
 * completion reviewer judges a saved file from a screenshot, and a screenshot
 * cannot show a saved file. The reviewer was also the largest fixed cost of a
 * read: on a Chrome page 9.5 s to answer and 10.4 s to review it. And the
 * reviewer's `uncertain` funded another lap, so a finished task ran to its
 * deadline, at measurable cost, against almost none for one that stopped.
 *
 * What the controller holds at the moment the actor claims completion is
 * better evidence than any screenshot: the field values read back after each
 * typed input, the input ledger, the document's text as the application
 * exposes it, the saved file on disk when the window names one, and every line
 * of text observed in the window since the session began. This module turns
 * that evidence into a verdict the reviewer would otherwise be asked for:
 *
 *  - a write is proven when every requested value or content span is present
 *    in the readback, nothing beyond the request changed, and the requested
 *    persistence is established by a saved-file readback. A pressed control
 *    establishes delivery only; its result still needs independent review;
 *  - an answer is grounded when every specific claim in it (numbers, quoted
 *    text, named things) occurs in the text observed in the window the task
 *    named, and the answer does not hedge.
 *
 * Anything short of that goes to the reviewer, with what the controller could
 * prove marked as established so the reviewer judges only the remainder.
 * Nothing here authorizes an action or weakens a checkpoint: it recognises
 * finished work, it never permits work.
 */
import type { ModelJsonSchema } from '../providers/types.js'
import type { ActionEffectClass } from '../types.js'
import type { LiveComputerCapturedFrame } from '../live-computer.js'
import type { CompletionReview, ObservedFieldValue, RequestedValue } from './completion-review.js'
import { exactFieldDiscrepancies } from './completion-review.js'

/** `STEWARD_COMPLETION_EVIDENCE=off` restores the previous behaviour: every completion claim is reviewed by a model. */
export function completionEvidenceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STEWARD_COMPLETION_EVIDENCE?.trim() !== 'off'
}
/** `STEWARD_ANSWER_GROUNDING=off` keeps the full visual review instead of selecting a bounded text-only review. */
export function answerGroundingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return completionEvidenceEnabled(env) && env.STEWARD_ANSWER_GROUNDING?.trim() !== 'off'
}

// ---------------------------------------------------------------------------
// Requested content: the literal spans a document must and must not contain.
// ---------------------------------------------------------------------------

export interface RequestedContent {
  /** Exact task substrings the document, field or page must contain when the work is done. */
  mustContain: string[]
  /** Exact task substrings naming text that must be gone afterwards. */
  mustNotContain: string[]
  /** How the task asks for the work to persist: the file saved, a named control pressed, or nothing. */
  persist: { kind: 'save_file' } | { kind: 'control'; label: string } | null
}

export const requestedContentSystem = `Extract the literal content requirements of a computer task from the task text alone, without seeing any screen or result. Return mustContain: exact substrings of the task that the document, field or page must contain once the task is done (a requested new value, quoted text, the replacement in "change A to B"). Return mustNotContain: exact substrings of the task naming text that must be gone afterwards (the old value in "change A to B", text the task says to delete). Return persist: kind "save_file" when the task says to save the file or document without naming a control; kind "control" with label when the task names a button or control to press to persist the work (label is the exact substring of the task naming it, without the verb); kind "none" otherwise. Every string must be an exact substring of the task, never a paraphrase, never trimmed of characters that are part of the value. When the task writes a label together with its value ("Status: Final"), that whole span is the requirement; when it names the label separately ("change the budget to USD 1,450"), only the value is. Exclude instructions, locations, ordering phrases and prohibitions ("preserve every other line" is not content). A task that quotes no exact content (summarise, tidy, rewrite, shorten) returns empty arrays. A task that only reads returns empty arrays and persist none. This establishes requirements only, never evidence that anything was done.`

export const requestedContentSchema: ModelJsonSchema = { name: 'computer_requested_content', strict: true, schema: {
  type: 'object', additionalProperties: false, required: ['mustContain', 'mustNotContain', 'persist'], properties: {
    mustContain: { type: 'array', items: { type: 'string' } },
    mustNotContain: { type: 'array', items: { type: 'string' } },
    persist: { type: 'object', additionalProperties: false, required: ['kind', 'label'], properties: {
      kind: { type: 'string', enum: ['save_file', 'control', 'none'] }, label: { type: ['string', 'null'] },
    } },
  },
} }

export function parseRequestedContent(text: string, task: string): RequestedContent {
  const parsed = JSON.parse(text) as { mustContain?: unknown; mustNotContain?: unknown; persist?: { kind?: unknown; label?: unknown } }
  const spans = (value: unknown, name: string): string[] => {
    if (!Array.isArray(value) || value.length > 20) throw new Error(`${name} must be a short array of task substrings`)
    const kept: string[] = []
    for (const item of value) {
      if (typeof item !== 'string' || !item.trim() || item.length > 400 || !task.includes(item)) throw new Error(`${name} entries must be exact substrings of the task`)
      if (!kept.includes(item)) kept.push(item)
    }
    return kept
  }
  const mustContain = spans(parsed.mustContain, 'mustContain')
  const mustNotContain = spans(parsed.mustNotContain, 'mustNotContain').filter(span => !mustContain.includes(span))
  const persistKind = parsed.persist?.kind
  let persist: RequestedContent['persist'] = null
  if (persistKind === 'save_file') persist = { kind: 'save_file' }
  else if (persistKind === 'control') {
    const label = parsed.persist?.label
    if (typeof label !== 'string' || !label.trim() || label.length > 120 || !task.includes(label)) throw new Error('persist.label must be an exact substring of the task naming the control')
    persist = { kind: 'control', label: label.trim() }
  } else if (persistKind !== 'none') throw new Error('persist.kind must be save_file, control or none')
  return { mustContain, mustNotContain, persist }
}

/** One extraction per task, shared by a background prewarm and the completion
 * check, the way the requested-values compiler works. A failed call is not
 * cached: the next request tries again, and a task that never compiles simply
 * has no content proof and goes to the reviewer as before. */
export function createRequestedContentCompiler(input: { task: () => string; call: (prompt: string, signal: AbortSignal, attempt: number) => Promise<string> }) {
  let cached: { task: string; content: RequestedContent } | null = null
  let pending: { task: string; promise: Promise<RequestedContent> } | null = null
  const extract = async (task: string, signal: AbortSignal): Promise<RequestedContent> => {
    let extractionFeedback: string | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      // The caller can escalate the one validation repair without changing
      // the prompt prefix or permitting another extraction loop.
      const text = await input.call(JSON.stringify({ task, extractionFeedback }), signal, attempt)
      try {
        const content = parseRequestedContent(text, task)
        cached = { task, content }
        return content
      } catch (error) { if (attempt === 1) throw error; extractionFeedback = error instanceof Error ? error.message : 'Invalid spans' }
    }
    throw new Error('The requested content could not be established')
  }
  return {
    current: (): RequestedContent | null => cached?.task === input.task() ? cached.content : null,
    compile: (signal: AbortSignal): Promise<RequestedContent> => {
      const task = input.task()
      if (cached?.task === task) return Promise.resolve(cached.content)
      if (pending?.task === task) return pending.promise
      const promise = extract(task, signal).finally(() => { if (pending?.promise === promise) pending = null })
      pending = { task, promise }
      return promise
    },
  }
}

// ---------------------------------------------------------------------------
// Write evidence.
// ---------------------------------------------------------------------------

export interface DocumentReadback {
  /** The document's current text as the application exposes it; null when the window shows no document. */
  text: string | null
  /** Whether the application reported the text complete (an untruncated accessibility value). */
  complete: boolean
  /** The same document as first observed, before this session delivered any input. */
  initialText: string | null
  /** The saved file's contents when the window names a local document and it could be read; null otherwise. */
  file: string | null
}

export interface EvidenceLedgerEntry { sequence: number; kind: string; label: string | null; role: string | null; chord?: 'save' | 'enter'; delivery?: 'uncertain' }

export interface EvidenceProof {
  requirement: string
  observed: string
  source: 'field_readback' | 'document_readback' | 'saved_file' | 'input_ledger'
}

export interface WriteEvidence {
  status: 'proven' | 'contradicted' | 'unproven'
  proofs: EvidenceProof[]
  /** What the controller could not establish, in the reviewer's terms. */
  open: string[]
  /** A mechanical contradiction, in the reviewer's own shape, when the readback disagrees with the request. */
  contradiction: CompletionReview | null
  /** Lines of a complete document that changed although they carry nothing the request asked for: each added line, with
   * the original line it most resembles (null when none does). Empty when nothing beyond the request changed. */
  unrequestedChanges?: UnrequestedChange[]
}

export interface UnrequestedChange { before: string | null; after: string }

const words = (line: string): Set<string> => new Set(normalizeLabel(line).split(' ').filter(Boolean))
/** The removed line an unrequested added line most resembles: a reworded line, not new text (shared words / all words ≥ 0.5). */
export function pairUnrequestedChanges(added: string[], removed: string[]): UnrequestedChange[] {
  const left = [...removed]
  return added.map(after => {
    const a = words(after)
    let best = -1, score = 0
    left.forEach((line, index) => {
      const b = words(line), shared = [...a].filter(word => b.has(word)).length, all = new Set([...a, ...b]).size
      const value = all ? shared / all : 0
      if (value > score) { score = value; best = index }
    })
    if (best < 0 || score < 0.5) return { before: null, after }
    return { before: left.splice(best, 1)[0]!, after }
  })
}

/** "…only fixes are merged…" → "…only bug fixes are merged…": short, quoted, for a refusal or a reviewer. */
export function describeUnrequestedChanges(changes: readonly UnrequestedChange[], limit = 3): string {
  const clip = (line: string) => JSON.stringify(line.length > 160 ? `${line.slice(0, 157)}…` : line)
  return changes.slice(0, limit).map(change => change.before === null ? `added ${clip(change.after)}` : `${clip(change.before)} became ${clip(change.after)}`).join('; ')
    + (changes.length > limit ? `; and ${changes.length - limit} more` : '')
}

const normalizeText = (text: string): string => text.normalize('NFKC').replace(/\r\n?/gu, '\n').replace(/[‘’]/gu, "'").replace(/[“”]/gu, '"').replace(/[ \t\u00a0]+/gu, ' ')
const normalizeDocument = (text: string): string => normalizeText(text).split('\n').map(line => line.trimEnd()).join('\n').trim()
const documentLines = (text: string): string[] => normalizeDocument(text).split('\n').map(line => line.trim()).filter(line => line.length > 0)
const contains = (haystack: string, span: string): boolean => normalizeText(haystack).includes(normalizeText(span))
const excerpt = (text: string, span: string, radius = 40): string => {
  const normalized = normalizeText(text), needle = normalizeText(span)
  const at = normalized.indexOf(needle)
  if (at < 0) return normalized.slice(0, 2 * radius)
  return normalized.slice(Math.max(0, at - radius), Math.min(normalized.length, at + needle.length + radius)).replace(/\n/gu, ' ')
}
const normalizeLabel = (label: string): string => label.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** Whether a file on disk is the document on screen: equal when the screen text is complete, otherwise the screen text (a 500-character prefix) up to its last whole line must open the file. */
function documentAgrees(file: string, text: string, complete: boolean): boolean {
  const normalizedFile = normalizeDocument(file), normalizedText = normalizeDocument(text)
  if (complete || normalizedFile === normalizedText) return normalizedFile === normalizedText
  const lastBreak = normalizedText.lastIndexOf('\n')
  const head = lastBreak > 0 ? normalizedText.slice(0, lastBreak) : normalizedText.slice(0, Math.max(0, normalizedText.length - 20))
  return head.length > 0 && normalizedFile.startsWith(head)
}

/** Every line the final document has that the original did not, and the reverse; multiset difference so a repeated line is counted once per copy. */
function lineDifference(initial: string, final: string): { added: string[]; removed: string[] } {
  const count = (lines: string[]) => { const map = new Map<string, number>(); for (const line of lines) map.set(line, (map.get(line) ?? 0) + 1); return map }
  const before = count(documentLines(initial)), after = count(documentLines(final))
  const added: string[] = [], removed: string[] = []
  for (const [line, n] of after) for (let i = (before.get(line) ?? 0); i < n; i++) added.push(line)
  for (const [line, n] of before) for (let i = (after.get(line) ?? 0); i < n; i++) removed.push(line)
  return { added, removed }
}

export function assessWriteEvidence(input: {
  requestedValues: RequestedValue[]
  fieldValues: ObservedFieldValue[]
  content: RequestedContent | null
  document: DocumentReadback | null
  ledger: EvidenceLedgerEntry[]
}): WriteEvidence {
  const proofs: EvidenceProof[] = []
  const open: string[] = []
  if (input.ledger.some(entry => entry.delivery === 'uncertain')) open.push('An input has uncertain delivery; independently check its outcome before claiming completion')
  const contradictions: CompletionReview['requirements'] = []
  let unrequestedChanges: UnrequestedChange[] = []
  const normalizeField = (field: string) => field.normalize('NFKC').trim().toLocaleLowerCase('en-US')
  const committed = (text: string) => text.replace(/[\r\n]+$/u, '')

  // Requested field values against the values read back after typing.
  const mismatch = exactFieldDiscrepancies(input.requestedValues, input.fieldValues)
  if (mismatch) contradictions.push(...mismatch.requirements)
  for (const value of input.requestedValues) {
    const ambiguous = new Set(input.requestedValues.filter(other => normalizeField(other.field) === normalizeField(value.field)).map(other => other.value)).size > 1
    if (ambiguous) { open.push(`Exact value for ${value.field}: the task assigns it more than one value`); continue }
    const matches = input.fieldValues.filter(field => normalizeField(field.field) === normalizeField(value.field))
    if (matches.length !== 1) { open.push(`Exact value for ${value.field}: ${matches.length === 0 ? 'no readback of that field' : 'more than one field carries that name'}`); continue }
    if (committed(matches[0]!.value) === committed(value.value)) proofs.push({ requirement: `Exact value for ${value.field}`, observed: matches[0]!.value, source: 'field_readback' })
  }

  // Requested content against the document readback (the saved file when the task asks for a save and it could be read).
  const content = input.content
  const requirements = input.requestedValues.length + (content ? content.mustContain.length + content.mustNotContain.length : 0)
  if (content && (content.mustContain.length || content.mustNotContain.length || content.persist)) {
    const document = input.document
    // The saved file is the readback only once it agrees with the document on
    // screen; a stale file means unsaved changes, not a document that still
    // carries the old value.
    // The helper caps an accessibility value at 500 characters, so a document
    // longer than that is only ever a prefix on screen; the file is then the
    // complete readback, accepted when the screen text is its prefix.
    const saved = typeof document?.file === 'string' && (document.text === null || documentAgrees(document.file, document.text, document.complete))
    const fromFile = saved && (content.persist?.kind === 'save_file' || !document!.complete)
    const readback = fromFile ? document!.file! : document?.text ?? null
    const source: EvidenceProof['source'] = fromFile ? 'saved_file' : 'document_readback'
    // A page with several editable fields has no single document: a span typed
    // into a named field is read back from that field (in testing the
    // title matched its field while the "document" was the page's body).
    const fieldWith = (span: string) => input.fieldValues.find(field => contains(field.value, span))
    if (readback === null && !content.mustContain.some(fieldWith)) {
      if (content.mustContain.length || content.mustNotContain.length) open.push('The document text could not be read back from the window')
    } else {
      for (const span of content.mustContain) {
        const field = fieldWith(span)
        if (readback !== null && contains(readback, span)) proofs.push({ requirement: `The document contains "${span}"`, observed: excerpt(readback, span), source })
        else if (field) proofs.push({ requirement: `The field ${field.field} contains "${span}"`, observed: field.value.slice(0, 120), source: 'field_readback' })
        else open.push(`The document contains "${span}": not found in the readback`)
      }
      // With no document at all the field readbacks carried every span, and
      // there is nothing to hold a forbidden span against.
      for (const span of content.mustNotContain) {
        if (readback === null) open.push(`The document no longer contains "${span}": no document readback`)
        else if (!contains(readback, span)) proofs.push({ requirement: `The document no longer contains "${span}"`, observed: 'absent from the readback', source })
        else if (fromFile || document?.complete) contradictions.push({ requirement: `The document no longer contains "${span}"`, expected: 'absent', observed: excerpt(readback, span), evidence: 'current', satisfied: false })
        else open.push(`The document no longer contains "${span}": still present in a possibly partial readback`)
      }
      // Nothing beyond the request changed: every new line carries requested
      // content, and no more lines vanished than were replaced. A property of a
      // document (one complete editable text); a page of fields is judged by
      // its field readbacks instead.
      if (readback !== null && (fromFile || document?.complete) && document?.initialText != null && content.mustContain.length) {
        const { added, removed } = lineDifference(document.initialText, readback)
        const unrequested = added.filter(line => !content.mustContain.some(span => contains(line, span)))
        // The lines themselves, not only their count: in e2e A-N1 (3 Oct) a whole-note rewrite turned "only fixes" into
        // "only bug fixes"; the reviewer was told "1 added line carry no requested content", could not see which, and
        // accepted the save.
        if (unrequested.length) unrequestedChanges = pairUnrequestedChanges(unrequested, removed.filter(line => !content.mustNotContain.some(span => contains(line, span))))
        if (unrequested.length) open.push(`${unrequested.length} added line${unrequested.length === 1 ? '' : 's'} carry no requested content: ${describeUnrequestedChanges(unrequestedChanges)}`)
        else if (removed.length > added.length) open.push(`${removed.length - added.length} line${removed.length - added.length === 1 ? '' : 's'} of the original document ${removed.length - added.length === 1 ? 'is' : 'are'} gone beyond the requested changes`)
        else if (added.length + removed.length > 0) proofs.push({ requirement: 'Every other line of the document is preserved', observed: `${added.length} line${added.length === 1 ? '' : 's'} changed, all carrying requested content`, source: 'document_readback' })
      } else if (content.mustContain.length && (fromFile || document?.complete) && document?.initialText == null) open.push('The document as first observed was not captured, so preservation of the other lines is not established')
    }
    if (content.persist?.kind === 'save_file') {
      if (typeof document?.file !== 'string') open.push('The saved file could not be read, so the save is not established')
      else if (!saved) open.push('The saved file differs from the document on screen: unsaved changes')
      else proofs.push({ requirement: 'The file is saved', observed: 'the saved file matches the document on screen', source: 'saved_file' })
    } else if (content.persist?.kind === 'control') {
      const wanted = normalizeLabel(content.persist.label)
      const lastTyped = input.ledger.filter(entry => entry.kind === 'type').at(-1)?.sequence ?? -1
      const pressed = input.ledger.find(entry => entry.delivery !== 'uncertain' && entry.sequence > lastTyped && (entry.kind === 'click' || entry.kind === 'double_click') && entry.label !== null && normalizeLabel(entry.label).includes(wanted))
      if (pressed) {
        proofs.push({ requirement: `"${content.persist.label}" was pressed after the edits`, observed: `click on "${pressed.label}"${pressed.role ? ` (${pressed.role})` : ''}`, source: 'input_ledger' })
        // Delivery proves the click, not the application's resulting state.
        // Validation, a failed request, or a pending save can leave the edited
        // fields visible without persisting them. Let independent completion
        // review establish that outcome from current evidence.
        open.push(`The result of "${content.persist.label}" needs independent confirmation; a delivered click alone does not prove persistence`)
      }
      else open.push(`"${content.persist.label}" was pressed after the edits: no such click in the input ledger`)
    }
  } else if (input.requestedValues.length === 0) {
    open.push('The task compiled no exact values or content; nothing to prove mechanically')
  }

  if (contradictions.length) {
    return { status: 'contradicted', proofs, open, contradiction: { verdict: 'incomplete', requirements: contradictions,
      feedback: mismatch?.feedback ?? 'The document readback still contains text the request said to change. Reopen the document, correct it, and verify again. Preserve other work and do not repeat submissions.' }, unrequestedChanges }
  }
  return { status: requirements > 0 && open.length === 0 && proofs.length > 0 ? 'proven' : 'unproven', proofs, open, contradiction: null, unrequestedChanges }
}

// ---------------------------------------------------------------------------
// Page-local writes checked like reads.
// ---------------------------------------------------------------------------

/** `STEWARD_LOCAL_WRITE_TEXT_REVIEW=off` sends every write's answer to the full image check again. */
export function localWriteTextReviewEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return answerGroundingEnabled(env) && env.STEWARD_LOCAL_WRITE_TEXT_REVIEW?.trim().toLowerCase() !== 'off'
}
/** `STEWARD_START_LITERALS=off` compiles exact field values with a separate model call after typing again, instead of
 * using the literal content extracted from the task at the start of the run. */
export function startLiteralsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return completionEvidenceEnabled(env) && env.STEWARD_START_LITERALS?.trim().toLowerCase() !== 'off'
}

const pageLocalEffects = new Set<ActionEffectClass>(['read_only', 'safe_local', 'reversible_local_write'])
const committedValue = (text: string) => normalizeText(text).replace(/[\r\n]+$/u, '').trim()

export interface PageLocalWrite { eligible: boolean; reason: string; proofs: EvidenceProof[] }

/**
 * A write whose outcome is text on the same page, which the cheap text review can judge like a read: an encoder, a
 * validator, a calculator or a search box (base64 and JSONLint: 1.5–13.7 s Sol image checks where a
 * read gets a 0.9 s text review). Eligible only when, deterministically:
 *  - the task's literal content (extracted from the task alone at the start) asks for text in a field, nothing to
 *    remove, and no saved file;
 *  - every effect the run executed is local and reversible (read, safe local, reversible local write);
 *  - no input has uncertain delivery;
 *  - every literal equals a field's read-back value exactly;
 *  - a click or Enter was delivered after the last typing (the submit);
 *  - the page's text changed after the typing: the current frame's text differs from the first frame in which the
 *    fields already held every literal (the typing was done; only the submit came after it).
 * Anything else, and anything consequential, keeps the full check. This selects a review; it never accepts by itself.
 */
/** `STEWARD_LOCAL_WRITE_TYPED_LITERALS=off` requires a literal the finished page must still hold, as before. */
export const localWriteTypedLiteralsEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.STEWARD_LOCAL_WRITE_TYPED_LITERALS?.trim().toLowerCase() !== 'off'

/** Text the person quoted in the request ("hello carve"), in order, each once. */
export function quotedTaskLiterals(task: string): string[] {
  const found: string[] = []
  for (const match of task.matchAll(/["“]([^"“”\n]{1,400})["”]/gu)) if (match[1]!.trim() && !found.includes(match[1]!)) found.push(match[1]!)
  return found.slice(0, 8)
}

export function pageLocalWriteReadback(input: {
  content: RequestedContent | null
  /** The request as the person wrote it; its quoted text is the typed input when the finished page need not hold it. */
  task?: string
  fieldValues: ObservedFieldValue[]
  ledger: EvidenceLedgerEntry[]
  executedEffects: Iterable<ActionEffectClass>
  /** Observed frames, oldest first; the last is the current one. `text` is the page's non-field text. */
  frames: Array<{ id: string; text: string; fields: string[] }>
}): PageLocalWrite {
  const no = (reason: string): PageLocalWrite => ({ eligible: false, reason, proofs: [] })
  const content = input.content
  // A page tool that transforms its input (an encoder, a case converter) leaves no task literal on the finished page,
  // so the extractor rightly finds nothing the page must still contain (convertcase and base64 were
  // never eligible). Then the proof is the typing itself: a frame after the typing shows a field holding exactly the
  // text the person quoted, a submit follows, and the page changes.
  // The extractor is not steady about which kind a quoted input is (one run listed "the quick brown fox" as text
  // the finished page must hold), so a quoted literal the finished fields no longer hold is proven as typed input.
  const quoted = localWriteTypedLiteralsEnabled() && input.task ? quotedTaskLiterals(input.task) : []
  const holdsNow = (literal: string) => input.fieldValues.some(value => committedValue(value.value) === committedValue(literal))
  const finalLiterals = (content?.mustContain ?? []).filter(literal => holdsNow(literal) || !quoted.includes(literal))
  const typedLiterals = finalLiterals.length ? [] : quoted
  if (!finalLiterals.length && !typedLiterals.length) return no('no literal content to match')
  if (content && (content.mustNotContain.length || content.persist?.kind === 'save_file')) return no('the task removes text or saves a file')
  const effects = [...input.executedEffects]
  if (effects.some(effect => !pageLocalEffects.has(effect))) return no('an executed effect is not local and reversible')
  if (input.ledger.some(entry => entry.delivery === 'uncertain')) return no('an input has uncertain delivery')
  const proofs: EvidenceProof[] = []
  for (const literal of finalLiterals) {
    const field = input.fieldValues.find(value => committedValue(value.value) === committedValue(literal))
    if (!field) return no(`no field reads back exactly "${literal.slice(0, 40)}"`)
    proofs.push({ requirement: `A field holds exactly "${literal}"`, observed: field.value.slice(0, 120), source: 'field_readback' })
  }
  const lastTyped = input.ledger.filter(entry => entry.kind === 'type').at(-1)?.sequence
  if (lastTyped === undefined) return no('nothing was typed')
  const submit = input.ledger.find(entry => entry.sequence > lastTyped && entry.delivery !== 'uncertain' && (entry.kind === 'click' || entry.kind === 'double_click' || entry.kind === 'element_action' || entry.chord === 'enter'))
  if (!submit) return no('no click or Enter after the typing')
  const current = input.frames.at(-1)
  const literals = finalLiterals.length ? finalLiterals : typedLiterals
  const typed = input.frames.findIndex(frame => literals.every(literal => frame.fields.some(value => committedValue(value) === committedValue(literal))))
  if (!current || typed < 0) return no('no retained frame shows the typed fields')
  if (!finalLiterals.length) proofs.push(...literals.map(literal => ({ requirement: `A field held exactly "${literal}" after the typing`, observed: literal.slice(0, 120), source: 'field_readback' as const })))
  const before = input.frames[typed]!
  const fieldsChanged = !finalLiterals.length && before.fields.join('\u0000') !== current.fields.join('\u0000')
  if (typed === input.frames.length - 1 || (before.text === current.text && !fieldsChanged)) return no('the page did not change after the typing')
  proofs.push({ requirement: 'The page changed after the submit', observed: `${submit.kind}${submit.label ? ` on "${submit.label}"` : ''}`, source: 'input_ledger' })
  return { eligible: true, reason: finalLiterals.length ? 'page-local write with an exact field readback and a changed page' : 'page-local write: the quoted text was typed exactly, then submitted, and the page changed', proofs }
}

/** A captured frame as pageLocalWriteReadback reads it: its non-field text and its editable fields' values,
 * nothing sensitive. */
export function pageLocalFrame(frame: LiveComputerCapturedFrame): { id: string; text: string; fields: string[] } {
  const visible = frame.elements.filter(element => !element.sensitive)
  const editable = (element: LiveComputerCapturedFrame['elements'][number]) => element.editable === true || /text(field|area)|combobox/iu.test(element.role)
  return { id: frame.id,
    text: visible.filter(element => !editable(element)).flatMap(element => [element.name, element.value].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)).join('\n'),
    fields: visible.filter(editable).flatMap(element => typeof element.value === 'string' ? [element.value] : []) }
}

// ---------------------------------------------------------------------------
// Answer grounding.
// ---------------------------------------------------------------------------

export interface AnswerGrounding {
  status: 'grounded' | 'ambiguous' | 'unsupported'
  anchors: string[]
  missing: string[]
  reason: string
}

const hedge = /\b(?:could(?:n'?t| not)|can(?:no|')t (?:verify|confirm|tell|see|find)|unable|not (?:able|sure|certain|verified|verify|confirm|visible|shown|loaded)|unclear|appears?|seems?|likely|probably|possibly|presumably|may be|might|assum(?:e|ing|ption)|estimated?|approximately|roughly|i think|i believe|did not (?:find|see|load)|no longer|isolated test)\b/iu
const stopWords = new Set(['the', 'this', 'that', 'these', 'those', 'there', 'here', 'they', 'them', 'then', 'than', 'when', 'where', 'which', 'while', 'with', 'from', 'into', 'onto', 'over', 'under', 'after', 'before', 'about', 'also', 'only', 'both', 'each', 'none', 'some', 'most', 'many', 'much', 'more', 'less', 'very', 'yes', 'and', 'but', 'for', 'not', 'nor', 'its', 'has', 'have', 'had', 'was', 'were', 'are', 'been', 'being', 'does', 'did', 'done', 'will', 'would', 'should', 'could', 'shall', 'page', 'window', 'screen', 'document', 'file', 'answer', 'result', 'results', 'note', 'notes', 'summary', 'item', 'items', 'list', 'section', 'title', 'text', 'value', 'values', 'total', 'name', 'first', 'second', 'third', 'last', 'next', 'previous', 'latest', 'current', 'error', 'errors'])

/** The specific claims an answer makes: numbers, quoted text and named things. */
export function answerAnchors(answer: string): string[] {
  const text = normalizeText(answer)
  const anchors: string[] = []
  const add = (value: string) => { const v = value.trim(); if (v && !anchors.includes(v)) anchors.push(v) }
  for (const match of text.matchAll(/"([^"\n]{2,120})"/gu)) add(match[1]!)
  // Quoted text is one claim; its words are not scanned again as names.
  const unquoted = text.replace(/"[^"\n]{2,120}"/gu, ' ')
  for (const match of unquoted.matchAll(/(?<![\w.])(?:[$€£]\s?)?\d(?:[\d,]*\d)?(?:\.\d+)?(?:\s?%)?(?!\.?\d)(?![\p{L}])/gu)) {
    const raw = match[0]!.trim()
    const digits = raw.replace(/[^\d]/gu, '')
    if (digits.length >= 2 || /[$€£%]/u.test(raw)) add(raw)
  }
  // Names: capitalised words not at the start of a sentence, singly or in runs.
  for (const sentence of unquoted.split(/(?<=[.!?:;])\s+|\n+|(?:^|\s)[-•*]\s+/u)) {
    const words = sentence.split(/\s+/u)
    let run: string[] = []
    const flush = () => { if (run.length) add(run.join(' ')); run = [] }
    const bareWords = words.map(word => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    const capitalised = (bare: string) => /^\p{Lu}[\p{L}\p{N}'’.-]{2,}$/u.test(bare)
    const generic = (bare: string) => stopWords.has(bare.toLowerCase())
    bareWords.forEach((bare, index) => {
      // Commas and dashes separate adjacent proper names or date phrases.
      // Stripping punctuation before grouping joined "Placename, Month"
      // into one invented anchor, forcing a redundant visual-verifier turn
      // even though both individual facts were observed.
      const boundaryBefore = index > 0 && /[,()[\]—–]$/u.test(words[index - 1] ?? '')
      if (boundaryBefore) flush()
      // A generic word ("Notes", "Total") never opens a name but may continue
      // one ("Northwind Notes"). A sentence's first word is capitalised whatever
      // it is; it counts as a name only when it opens a run of capitals.
      const opens = index === 0 ? capitalised(bare) && !generic(bare) && bareWords[1] !== undefined && capitalised(bareWords[1]) : capitalised(bare) && !generic(bare)
      if (opens || (run.length > 0 && capitalised(bare))) run.push(bare)
      else flush()
      if (/[,()[\]—–]$/u.test(words[index] ?? '')) flush()
    })
    flush()
  }
  return anchors.slice(0, 40)
}

/**
 * Whether an answer's specific claims all occur in the text observed in the
 * window. Grounded means every anchor is present and the answer does not hedge;
 * ambiguous means the answer hedges or makes no specific claim, so the
 * reviewer's judgement is still needed; unsupported means at least one claim
 * was never on screen. Grounded selects the text-only semantic review; it
 * never establishes correctness on its own. A number from the wrong row or
 * a reversed negation can pass this lexical filter.
 */
export function assessAnswerGrounding(answer: string, corpus: Iterable<string>, task = ''): AnswerGrounding {
  const message = answer.trim()
  if (!message) return { status: 'ambiguous', anchors: [], missing: [], reason: 'empty answer' }
  const hedged = hedge.exec(message)
  const anchors = answerAnchors(message)
  if (hedged) return { status: 'ambiguous', anchors, missing: [], reason: `hedged: "${hedged[0]}"` }
  if (anchors.length === 0) return { status: 'ambiguous', anchors, missing: [], reason: 'no specific claim to ground' }
  // The task's own words are not claims about the page: an answer that
  // restates the threshold it was asked about ("under $40") is not inventing it.
  const canonicalMonths = (value: string) => value
    .replace(/\bjan(?:uary)?\b/giu, 'january').replace(/\bfeb(?:ruary)?\b/giu, 'february')
    .replace(/\bmar(?:ch)?\b/giu, 'march').replace(/\bapr(?:il)?\b/giu, 'april')
    .replace(/\bmay\b/giu, 'may').replace(/\bjun(?:e)?\b/giu, 'june')
    .replace(/\bjul(?:y)?\b/giu, 'july').replace(/\baug(?:ust)?\b/giu, 'august')
    .replace(/\bsep(?:t(?:ember)?)?\b/giu, 'september').replace(/\boct(?:ober)?\b/giu, 'october')
    .replace(/\bnov(?:ember)?\b/giu, 'november').replace(/\bdec(?:ember)?\b/giu, 'december')
  const text = canonicalMonths([...corpus, task].map(line => normalizeText(line).toLowerCase()).join('\n'))
  // Remove only grouping separators before an exact three-digit group. The
  // earlier broad digit-comma/space-digit rule also collapsed dates such as
  // "Nov 5–12, 2026" into "122026", so a visibly present year failed
  // grounding and forced another screenshot/verifier turn.
  const unseparated = text.replace(/(?<=\d)[, \u00a0\u202f](?=\d{3}(?:\D|$))/gu, '')
  const present = (anchor: string): boolean => {
    const needle = canonicalMonths(normalizeText(anchor).toLowerCase())
    const digits = needle.replace(/[^\d.]/gu, '')
    // A figure must stand alone: 365 is not found inside 2365. "2,365" answers
    // a sheet that shows "2365", and the reverse.
    if (digits.length >= 2 && !/\p{L}/u.test(needle)) return new RegExp(`(?<![\\d.])${digits.replace(/\./gu, '\\.')}(?!\\d|\\.\\d)`, 'u').test(unseparated)
    return text.includes(needle)
  }
  const missing = anchors.filter(anchor => !present(anchor))
  if (missing.length) return { status: 'unsupported', anchors, missing, reason: `${missing.length} of ${anchors.length} claims not observed` }
  return { status: 'grounded', anchors, missing: [], reason: `${anchors.length} claims observed in the window` }
}
