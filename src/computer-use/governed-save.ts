import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { posix } from 'node:path'
import type { LiveComputerAction, LiveComputerPhysicalActionReceipt, LiveComputerTarget } from '../types.js'
import { ComputerInputDeliveryError } from './input-delivery.js'
import { sha256, stableJson } from '../util.js'

/**
 * Governed "save as <path>" for the compact engine.
 *
 * Nineteen packaged research→document runs typed a correct document into
 * TextEdit and never saved it: every attempt died inside the Save sheet
 * (the Name field is unlabelled in the observation, so the actor filled the
 * Tags field; Go to Folder's path field had no resolved receiver; clicks were
 * withheld as ambiguous; focus could not be confirmed once a tag popup was up).
 * The input bridge already ships a transactional TextEdit save
 * (`textedit.save_document`, CarveLiveInputBridge.mm performTextEditSaveDocument:
 * Cmd+S, filename by accessibility value with read-back, Go to Folder by
 * accessibility, one Save press, then the file checked on disk). It was only
 * reachable from the older structured engine. This module lets the compact
 * actor ask for it with one navigation, `{"kind":"save_as","text":PATH}`,
 * bound to the ordinary Cmd+S chord so the existing effect review and
 * supervision policy authorize it exactly like a Save keypress.
 *
 * The path is controller-checked here (under the home folder, a new `.txt`
 * file, every folder below home and the file name named in the approved
 * task) and again natively (absolute, standardized, not existing, not in a
 * protected directory, parent directory exists, never overwrites).
 *
 * `STEWARD_COMPACT_GOVERNED_SAVE=off` removes the navigation, its prompt
 * sentence and the binding; the raw Save-panel recipe returns.
 */
export function governedSaveEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STEWARD_COMPACT_GOVERNED_SAVE?.trim().toLowerCase() !== 'off'
}

export class GovernedSaveRefusal extends Error {}

const words = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[‘’]/gu, "'").replace(/\s+/gu, ' ').trim()

/** Resolve and check the actor's requested path. Returns the absolute,
 * standardized path, or throws a refusal that tells the actor what to fix. */
export function resolveGovernedSavePath(raw: unknown, approvedGoal: string, home: string = homedir()): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 1_000 || /[\p{Cc}]/u.test(raw)) {
    throw new GovernedSaveRefusal('save_as needs text: the full path of the new file, for example ~/Documents/Folder/Name.txt.')
  }
  const text = raw.trim()
  const homeRoot = posix.normalize(home).replace(/\/+$/u, '')
  const expanded = text === '~' || text.startsWith('~/') ? homeRoot + text.slice(1) : text
  if (!expanded.startsWith('/')) throw new GovernedSaveRefusal('save_as needs a full path starting with ~/ or /, for example ~/Documents/Folder/Name.txt.')
  const filePath = posix.normalize(expanded)
  if (filePath !== expanded.replace(/\/{2,}/gu, '/') || /(^|\/)\.\.?(\/|$)/u.test(expanded)) throw new GovernedSaveRefusal('save_as refuses a path with . or .. components.')
  if (!filePath.startsWith(homeRoot + '/')) throw new GovernedSaveRefusal('save_as saves only inside your home folder (for example ~/Documents/...).')
  const relative = filePath.slice(homeRoot.length + 1).split('/')
  const name = relative.at(-1) ?? ''
  const folders = relative.slice(0, -1)
  if (!/\.txt$/iu.test(name) || name.length < 5) throw new GovernedSaveRefusal('save_as saves a new plain-text .txt file; name it with the .txt extension the task asked for.')
  if (relative.some(part => !part || part.startsWith('.'))) throw new GovernedSaveRefusal('save_as refuses hidden files and folders.')
  // Authority comes from the person's approved task, never from the page: the
  // file name and every folder below home must be named there.
  const goal = ` ${words(approvedGoal)} `
  const missing = [name, ...folders].filter(part => !goal.includes(words(part)))
  if (missing.length) {
    throw new GovernedSaveRefusal(`save_as saves only to a file and folders the approved task names; not named there: ${missing.map(part => JSON.stringify(part)).join(', ')}. Use exactly the file name and folders the task gives.`)
  }
  return filePath
}

/** The controller-owned authorization the native adapter checks: the same
 * binding shape the structured engine hashes for a path from the approved
 * goal (live-computer.ts operationAuthorizationForAction). */
export function governedSaveAuthorization(transactionId: string, filePath: string, windowId: number): NonNullable<LiveComputerAction['operationAuthorization']> {
  const bindings = [
    { parameterId: 'destination_path', type: 'absolute_path', source: 'approved_goal', value: filePath, authorized: true, authorityImpact: 'external_effect' },
    { parameterId: 'overwrite', type: 'boolean', source: 'controller_default', value: false, authorized: true, authorityImpact: 'none' },
    { parameterId: 'target_document', type: 'resource', source: 'application_state', value: `window:${windowId}`, authorized: true, authorityImpact: 'selects_target' },
  ]
  return { transactionId, operationId: 'text_document.save_new', parameterBindingsSha256: sha256(stableJson(bindings)), targetSha256: sha256(filePath), overwriteAuthorized: false }
}

/** Turn the reviewed Cmd+S live action into the governed native save. */
export function governedSaveLiveAction(action: LiveComputerAction, filePath: string, target: Pick<LiveComputerTarget, 'windowId' | 'bundleIdentifier'>): LiveComputerAction {
  if (target.bundleIdentifier !== 'com.apple.TextEdit') throw new GovernedSaveRefusal('save_as is available only in a TextEdit document window.')
  const rest: LiveComputerAction = { ...action }
  delete rest.inputReceiver
  return { ...rest, kind: 'invoke_safe_command', command: 'textedit.save_document', filePath, key: null, text: null, point: null,
    risk: 'reversible_write', summary: 'Save the document to the approved new file', operationAuthorization: governedSaveAuthorization(action.id, filePath, target.windowId) }
}

/** A governed save counts only when the native adapter attests the exact new
 * file (its own disk read-back). Anything else is reported to the actor with
 * the transaction's phase and code, never as a delivered save; a commit that
 * may have happened is uncertain, so the actor looks before trying again. */
export function requireGovernedSave(receipt: LiveComputerPhysicalActionReceipt | void, diagnostic?: (detail: Record<string, unknown>) => void): void {
  const transaction = receipt ? receipt.operationTransaction ?? null : null
  const saved = Boolean(receipt && receipt.verifiedEffect === 'text_document.saved_new_file' && transaction?.status === 'completed')
  diagnostic?.({ stage: 'governed_save', outcome: saved ? 'saved' : transaction?.status ?? 'no_receipt', phase: transaction?.failure?.phase ?? transaction?.phase ?? null,
    code: transaction?.failure?.code ?? receipt?.failure?.code ?? null, commitAttempted: transaction?.commit.attempted ?? null })
  if (saved) return
  const failure = transaction?.failure
  const mayHaveSaved = Boolean(transaction?.commit.effectMayHaveOccurred || transaction?.status === 'uncertain' || !transaction)
  throw new ComputerInputDeliveryError(failure
    ? `The governed save did not complete (${failure.code} at ${failure.phase.replaceAll('_', ' ')}): ${failure.message.slice(0, 300)}${mayHaveSaved ? ' The file may have been written: observe the window title before trying again.' : ' Nothing was saved.'}`
    : 'The governed save returned no transaction receipt; whether the file was written is unknown. Observe the window title before trying again.', false)
}

/**
 * The save receipt. In testing, the governed save
 * wrote the exact file, but nothing told the actor or the final check where.
 * The window only showed "notes.txt", which the task instructions say does
 * not establish the location, so the actor issued save_as again; the adapter
 * refused to overwrite the file it had just made ("Nothing was saved"), three
 * refusals closed input, and the stage ended as "Choose the document to
 * continue" although the file was on disk.
 *
 * With the receipt, a confirmed save is controller evidence: the actor and the
 * final check are told the saved path and size, a second save_as of an
 * unchanged document to the same path is answered locally, and a hand-off
 * stage that ends without a completion report still reports the saved file.
 * `STEWARD_GOVERNED_SAVE_RECEIPT=off` restores the earlier behavior.
 */
export function governedSaveReceiptEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STEWARD_GOVERNED_SAVE_RECEIPT?.trim().toLowerCase() !== 'off'
}

export interface GovernedSaveRecord {
  /** Absolute path the adapter wrote. */
  filePath: string
  /** The same path with the home folder shown as ~, for people and the actor. */
  displayPath: string
  bytes: number
  contentSha256: string
}

export function displaySavePath(filePath: string, home: string = homedir()): string {
  const root = posix.normalize(home).replace(/\/+$/u, '')
  return filePath.startsWith(root + '/') ? '~' + filePath.slice(root.length) : filePath
}

/** A completed governed save counts as a saved file only when the controller
 * reads the file back itself and it matches the adapter's receipt: the path
 * the authorization was bound to, the document content the adapter read
 * before saving, and the byte length and digest it read after. */
export async function confirmGovernedSaveOnDisk(receipt: LiveComputerPhysicalActionReceipt | void, filePath: string,
  read: (path: string) => Promise<Uint8Array> = readFile, home: string = homedir()): Promise<GovernedSaveRecord | null> {
  const transaction = receipt ? receipt.operationTransaction ?? null : null
  if (!receipt || receipt.verifiedEffect !== 'text_document.saved_new_file' || transaction?.status !== 'completed') return null
  const post = transaction.postcondition
  const digest = (value: string | null | undefined) => typeof value === 'string' ? value.toLowerCase() : null
  if (!post?.satisfied || digest(post.targetSha256) !== sha256(filePath) || digest(transaction.authorizedEffect?.targetSha256) !== sha256(filePath)) return null
  if (!post.contentSha256 || digest(post.contentSha256) !== digest(transaction.preconditions?.expectedContentSha256)) return null
  let bytes: Uint8Array
  try { bytes = await read(filePath) } catch { return null }
  const contentSha256 = sha256(bytes)
  if (contentSha256 !== digest(post.contentSha256) || (post.byteLength !== null && post.byteLength !== bytes.byteLength)) return null
  return { filePath, displayPath: displaySavePath(filePath, home), bytes: bytes.byteLength, contentSha256 }
}

/** A save made through the app's own Save dialog (the person approved each step on a card) leaves no governed-save
 * transaction, so the stage could not say the file was saved and a later governed save was refused as an overwrite
 * (e2e D01, 3 Oct: Coworking.txt written, stage failed "could not verify"). It counts as this session's save only when
 * every check holds: the window's own document is a regular file at a path the approved task names (the same rule as a
 * governed save), it was written during this session, and its bytes are exactly the text the window shows. */
export function confirmObservedSave(input: {
  documentPath: string | null
  approvedGoal: string
  documentText: string | null
  file: { isFile: boolean; mtimeMs: number; size: number } | null
  bytes: Uint8Array | null
  sinceMs: number
  home?: string
}): GovernedSaveRecord | null {
  const home = input.home ?? homedir()
  if (!input.documentPath || input.documentText === null || !input.file || !input.bytes) return null
  let filePath: string
  try { filePath = resolveGovernedSavePath(input.documentPath, input.approvedGoal, home) } catch { return null }
  if (filePath !== posix.normalize(input.documentPath)) return null
  if (!input.file.isFile || input.file.size !== input.bytes.byteLength || input.file.mtimeMs < input.sinceMs) return null
  if (new TextDecoder('utf-8', { fatal: false }).decode(input.bytes) !== input.documentText) return null
  return { filePath, displayPath: displaySavePath(filePath, home), bytes: input.bytes.byteLength, contentSha256: sha256(input.bytes) }
}

/** What the actor and the final check are told about a confirmed save. */
export function governedSaveReceiptText(record: GovernedSaveRecord & { editedAfter: boolean }): string {
  return `Carve saved this document as ${record.displayPath} (${record.bytes} bytes). The controller read that exact file back from disk and it matches the document text at the moment of saving, so the file name and folder are established.`
    + (record.editedAfter ? ' Text was typed into the document after that save; those later edits are not in the file.' : ' Nothing was typed into the document after that save.')
}

/** A second save_as of an unchanged document to the file it already made. */
export function alreadySavedRefusal(record: GovernedSaveRecord): string {
  return `Already saved: ${governedSaveReceiptText({ ...record, editedAfter: false })} Do not save again (the file exists and is never overwritten). If the document has every requested item, report completed and name ${record.displayPath}; otherwise report what is missing.`
}

/** Remaining items the receipt itself settles: saving or confirming the location of the saved file. */
export function remainingSettledBySave(item: string, record: Pick<GovernedSaveRecord, 'filePath'>): boolean {
  const name = posix.basename(record.filePath).toLowerCase()
  const text = item.toLowerCase()
  // Only a save or location check: an item that also asks for content ("add the link, then save") stays.
  return text.includes(name) && /\b(save|saved|saving|location|folder|verify|verified|confirm)/u.test(text)
    && !/\b(add|adds|added|include|includes|missing|omit|omits|omitted|link|price|write|type|correct)/u.test(text)
}

/** A report sentence that calls the save or its location unverified, which the receipt contradicts. */
const unverifiedSaveSentence = (sentence: string) => /\b(could not|couldn['’]t|cannot|can['’]t|did not|didn['’]t|not|unable to)\b.*\b(verify|verified|confirm|confirmed|establish|established)\b/iu.test(sentence)
  && /\b(save|saved|saving|folder|location)\b/iu.test(sentence)

/** The result of a hand-off destination stage that ended without a completion report although its governed save was
 * read back from disk: the saved path first, then the stage's own report without sentences the receipt contradicts,
 * then every remaining item the closing check listed that the receipt does not settle. */
export function savedFileStageResult(record: Pick<GovernedSaveRecord, 'filePath' | 'displayPath' | 'bytes'> & { editedAfter?: boolean }, text: string | null, remaining: readonly string[] = []): string {
  const report = (text ?? '').split(/\n{2,}/u).map(paragraph => paragraph.split(/(?<=[.!?])\s+/u).filter(sentence => !unverifiedSaveSentence(sentence)).join(' ').trim()).filter(Boolean).join('\n\n')
  const left = remaining.map(item => item.trim()).filter(item => item && !remainingSettledBySave(item, record))
  return `Saved ${record.displayPath} (${record.bytes} bytes). Carve read the file back from disk and it matches the document as it was saved.`
    + (record.editedAfter ? ' Edits made after that save are not in the file.' : '')
    + (report ? `\n\n${report}` : '')
    + (left.length ? `\n\nNot confirmed by the final check:\n${left.map(item => `- ${item}`).join('\n')}` : '')
}

/**
 * Editing a saved document. In testing, after the governed save
 * wrote notes.txt, a typed follow-up asking to add more data to the same document was routed to
 * the TextEdit window whose recorded title was still "Untitled 91"; the window now read "notes.txt", the strict
 * title check called it closed, and the turn ended as a generic "Couldn't answer". Even past that, a second
 * save_as to the same path was refused (the task does not name the file, and the adapter never overwrites).
 *
 * With this lever on: the window the conversation's receipt saved is still that window after its title becomes the
 * saved file's name; a later session in it inherits the receipt; and save_as to exactly that path saves the same
 * file in place (a plain Cmd+S on the already-named document) only when the file on disk is still what the receipt
 * recorded, the window's document is that file, and the document keeps every earlier line in order. The file is
 * read back afterwards and must still hold the earlier text. `STEWARD_EDIT_SAVED_DOCUMENT=off` restores the
 * earlier behavior.
 */
export function editSavedDocumentEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return governedSaveReceiptEnabled(env) && env.STEWARD_EDIT_SAVED_DOCUMENT?.trim().toLowerCase() !== 'off'
}

/** The absolute path save_as text names, or null when it is not a plain path under home. No authority check. */
export function expandSavePath(raw: unknown, home: string = homedir()): string | null {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 1_000 || /[\p{Cc}]/u.test(raw)) return null
  const text = raw.trim()
  const homeRoot = posix.normalize(home).replace(/\/+$/u, '')
  const expanded = text === '~' || text.startsWith('~/') ? homeRoot + text.slice(1) : text
  if (!expanded.startsWith('/') || /(^|\/)\.\.?(\/|$)/u.test(expanded)) return null
  const filePath = posix.normalize(expanded)
  return filePath.startsWith(homeRoot + '/') ? filePath : null
}

/** A document window's title after it was saved as `filePath`: the file name, with or without its extension (Finder's
 * hide-extension setting), optionally marked Edited. */
export function titleShowsSavedFile(title: string, filePath: string): boolean {
  const name = posix.basename(filePath).normalize('NFC')
  const bare = name.replace(/\.[^.]+$/u, '')
  const shown = title.normalize('NFC').trim().replace(/\s+[—–-]\s+Edited$/u, '').replace(/\s+Edited$/u, '').trim()
  return shown === name || (bare.length > 0 && shown === bare)
}

const contentLines = (text: string) => text.replace(/\r\n?/gu, '\n').split('\n').map(line => line.replace(/\s+/gu, ' ').trim()).filter(Boolean)

/** Whether `next` keeps every non-empty line of `prior`, in order (whitespace-insensitive), and whether it only
 * appends (`prior` is a prefix of `next`). `addedLines` counts lines of `next` not used to match `prior`;
 * `repeatedLines` counts added lines that repeat an earlier line verbatim. */
export function priorContentKept(prior: string, next: string): { kept: boolean; appendOnly: boolean; addedLines: number; repeatedLines: number } {
  const before = contentLines(prior), after = contentLines(next)
  let index = 0
  const added: string[] = []
  for (const line of after) {
    if (index < before.length && line === before[index]) index++
    else added.push(line)
  }
  const kept = index === before.length
  const appendOnly = kept && before.every((line, position) => after[position] === line)
  const earlier = new Set(before)
  return { kept, appendOnly, addedLines: added.length, repeatedLines: added.filter(line => earlier.has(line)).length }
}

/** What a session in the saved window is told about a save an earlier turn of this conversation made. */
export function inheritedSaveReceiptText(record: GovernedSaveRecord & { editedAfter: boolean }): string {
  return `Earlier in this conversation Carve saved this document as ${record.displayPath} (${record.bytes} bytes), read back from disk. To add to that file, keep the existing text, type only the new lines at the end of the document, then return save_as with exactly ${record.displayPath}: the controller saves the same file in place and checks that the earlier text is kept.`
    + (record.editedAfter ? ' Text was typed into the document after that save; it is not in the file until it is saved.' : '')
}

/** A resave the controller refused before any input: no key was sent. */
export class GovernedResaveRefusal extends Error {}

/** Controller checks before the in-place save of the file this conversation saved. Throws a refusal (nothing sent). */
export function checkGovernedResave(input: { record: Pick<GovernedSaveRecord, 'filePath' | 'displayPath' | 'contentSha256'>; onDisk: Uint8Array | null; documentPath: string | null; documentText: string | null; bundleIdentifier: string }): { prior: string } {
  const { record } = input
  if (input.bundleIdentifier !== 'com.apple.TextEdit') throw new GovernedResaveRefusal('save_as saves a TextEdit document; this window is not one.')
  if (!input.onDisk) throw new GovernedResaveRefusal(`No input was sent: ${record.displayPath} could not be read from disk, so Carve cannot confirm it is the file it saved. Report what was added to the document and that it is not saved.`)
  if (sha256(input.onDisk) !== record.contentSha256) throw new GovernedResaveRefusal(`No input was sent: ${record.displayPath} changed on disk since Carve saved it, so Carve will not overwrite it. Report what was added to the document and that it is not saved.`)
  if (input.documentPath !== record.filePath) throw new GovernedResaveRefusal(`No input was sent: this window's document is not ${record.displayPath}, so Cmd+S would not save that file. Report what is missing.`)
  if (input.documentText === null) throw new GovernedResaveRefusal('No input was sent: the document text could not be read to confirm the earlier text is kept. Report what was added and that it is not saved.')
  const prior = new TextDecoder().decode(input.onDisk)
  const check = priorContentKept(prior, input.documentText)
  if (!check.kept) throw new GovernedResaveRefusal(`No input was sent: the document no longer contains all of the text saved in ${record.displayPath}, and saving would lose it. Restore the earlier text (keypress META+Z to undo), keep it unchanged, and add only new lines at the end.`)
  if (check.addedLines === 0) throw new GovernedResaveRefusal(`No input was sent: the document has nothing beyond what ${record.displayPath} already holds. Type the new lines at the end first, or report completed if nothing is missing.`)
  return { prior }
}

/** After the in-place save: the file must have changed and still hold every earlier line in order. Returns the new
 * record, or throws with what went wrong. */
export function confirmGovernedResave(record: Pick<GovernedSaveRecord, 'filePath' | 'displayPath' | 'contentSha256'>, prior: string, after: Uint8Array | null, home: string = homedir()): GovernedSaveRecord & { appendOnly: boolean; addedLines: number; repeatedLines: number } {
  if (!after || sha256(after) === record.contentSha256) throw new ComputerInputDeliveryError(`Cmd+S was delivered, but ${record.displayPath} on disk did not change. Observe the window title (Edited means unsaved) before trying again.`, false)
  const check = priorContentKept(prior, new TextDecoder().decode(after))
  if (!check.kept) throw new ComputerInputDeliveryError(`${record.displayPath} was saved but no longer holds all of its earlier text. Report this to the person; do not save again.`, false)
  return { filePath: record.filePath, displayPath: displaySavePath(record.filePath, home), bytes: after.byteLength, contentSha256: sha256(after), appendOnly: check.appendOnly, addedLines: check.addedLines, repeatedLines: check.repeatedLines }
}
