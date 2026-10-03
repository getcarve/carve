import type { LiveComputerElement } from '../types.js'
import { liveComputerElementSupportsTextEntry } from '../live-computer-action-contract.js'

/** `STEWARD_CODE_EDITOR_INPUT=off` restores typed keystrokes into code editors,
 * no editor readback and no strategy switch. */
export function codeEditorInputEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STEWARD_CODE_EDITOR_INPUT?.trim().toLowerCase() !== 'off'
}

/**
 * A browser code editor's text receiver, recognized by what the platform
 * exposes for every such editor rather than by site: Monaco's input is an
 * AXTextArea named "Editor content" with aria-roledescription "editor" (which
 * Chrome reports as its description); CodeMirror and Ace name their receivers
 * in identifiers or labels; CodeMirror 5 and Ace take keys through a hidden
 * (1-4 px) text area. These editors auto-close brackets and quotes and
 * auto-indent what is typed, so typed JSON came out as {"a": 1,}} (JSONLint,
 * 27 September), while their paste inserts text literally.
 */
export function isCodeEditorReceiver(element: LiveComputerElement): boolean {
  if (element.sensitive || element.enabled === false || !liveComputerElementSupportsTextEntry(element)) return false
  const description = (element.description ?? '').trim()
  const labels = [element.name, element.description, element.help, element.identifier, element.placeholder].filter((value): value is string => typeof value === 'string').join(' ')
  const hidden = Boolean(element.bounds && (element.bounds.width < 4 || element.bounds.height < 4)) && /textarea/iu.test(element.role)
  return /^(?:code )?editor$/iu.test(description)
    || /\beditor content\b/iu.test(element.name ?? '')
    || /\b(?:monaco|codemirror|cm-content|ace_text-input|ace editor|code editor|source code)\b/iu.test(labels)
    || hidden
}

export type EditorReadback = { status: 'match' | 'mismatch' | 'unknown'; observed: string | null }

const closers = /^[)\]}"'`>]+/u

/**
 * Deterministic readback of text written into a code editor, compared with
 * the requested literal. The receiver's own complete value decides when it has
 * one (a plain text area, CodeMirror 6). Monaco's input holds no value, so the
 * page's rendered text decides: whitespace is ignored (editors render
 * indentation and wrap lines their own way), the literal must appear exactly
 * once, and closing brackets or quotes right after it are what an editor's
 * auto-close added. Anything less certain is 'unknown', which changes nothing.
 */
export function codeEditorReadback(requested: string, receiver: LiveComputerElement | null, pageText: string | null): EditorReadback {
  const lines = (value: string) => value.replace(/\r\n?/gu, '\n').split('\n').map(line => line.replace(/[\s\u00a0]+$/u, '')).join('\n').trim()
  if (receiver && receiver.valueComplete === true && typeof receiver.value === 'string' && receiver.value.trim()) {
    return lines(receiver.value) === lines(requested) ? { status: 'match', observed: null } : { status: 'mismatch', observed: receiver.value.slice(0, 400) }
  }
  if (!pageText) return { status: 'unknown', observed: null }
  const strip = (value: string) => value.replace(/[\s\u00a0\u200b\ufeff]+/gu, '')
  const wanted = strip(requested), shown = strip(pageText)
  if (!wanted) return { status: 'unknown', observed: null }
  const at = shown.indexOf(wanted)
  if (at < 0 || shown.indexOf(wanted, at + 1) >= 0) return { status: 'unknown', observed: null }
  const tail = shown.slice(at + wanted.length).match(closers)?.[0] ?? ''
  return tail ? { status: 'mismatch', observed: (wanted + tail).slice(0, 400) } : { status: 'match', observed: null }
}

/** One code-editor fill's history in this run: how its readback went. */
export interface EditorFillRecord { mismatches: number; identical: number; observed: string | null; strategy: 'paste' | 'clear_then_paste' }

/**
 * What the next identical fill into the same editor does. Two identical
 * readback mismatches switch to clearing the editor first (select-all,
 * Delete, then paste); a mismatch after that stops refilling, so the run
 * reports what the editor shows instead of writing the same text again.
 */
export function nextEditorStrategy(record: EditorFillRecord | undefined): 'paste' | 'clear_then_paste' | 'stop' {
  if (!record || record.mismatches === 0) return 'paste'
  if (record.strategy === 'clear_then_paste') return 'stop'
  return record.identical >= 2 ? 'clear_then_paste' : 'paste'
}

/** Fold one readback into the record. Only mismatches count. */
export function recordEditorReadback(record: EditorFillRecord | undefined, readback: EditorReadback, strategy: 'paste' | 'clear_then_paste'): EditorFillRecord | undefined {
  if (readback.status === 'match') return undefined
  if (readback.status === 'unknown') return record ? { ...record, strategy } : record
  const identical = record && record.observed === readback.observed ? record.identical + 1 : 1
  return { mismatches: (record?.mismatches ?? 0) + 1, identical, observed: readback.observed, strategy }
}
