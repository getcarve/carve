import type {
  ComputerActionModifier,
  ComputerActionProposal,
  ProviderTokenUsage,
} from './types.js'

/**
 * Anthropic Claude computer-use vocabulary for the Amazon Bedrock adapter.
 *
 * Claude emits `tool_use` blocks against a pre-defined `computer` tool. Every
 * block is translated here into Carve's provider-neutral, advisory
 * `ComputerActionProposal`s so the same controller, compiler, supervision and
 * budgets that govern OpenAI proposals also govern Claude. Nothing in this
 * module executes input.
 *
 * Bedrock pairs each computer-use beta with a tool type. The defaults track
 * the pairing Bedrock documents for current Claude models; both remain
 * configurable so a newer pairing can be tried without a code change.
 */
export const defaultBedrockComputerToolType = 'computer_20251124'
export const defaultBedrockComputerBeta = 'computer-use-2025-11-24'
/** Display hint used before the first screenshot reveals the real frame. */
export const defaultBedrockDisplay = { width: 1440, height: 900 }
export const bedrockComputerToolName = 'computer'
/** Pixels scrolled per Claude scroll "click". Claude scrolls in wheel notches;
 * Carve backends scroll in pixels. */
export const bedrockScrollPixelsPerClick = 100
const maximumProposalsPerTurn = 32
const maximumKeyRepeat = 20

export interface BedrockComputerToolConfig {
  toolType: string
  beta: string
}

export interface ClaudeContentBlock {
  type?: string
  text?: string
  id?: string
  name?: string
  input?: unknown
  [key: string]: unknown
}

export interface ClaudeMessagesResponse {
  id?: string
  model?: string
  stop_reason?: string
  /** Populated only for `stop_reason: "refusal"`. */
  stop_details?: { type?: string; category?: string | null; explanation?: string | null } | null
  content?: ClaudeContentBlock[]
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
  error?: { type?: string; message?: string }
  message?: string
  Message?: string
}

export interface ClaudeComputerTurnContent {
  /** Ids of every computer tool_use block, in order; each needs a tool_result. */
  toolUseIds: string[]
  actions: ComputerActionProposal[]
  /** Assistant text when the turn contained no computer call. */
  terminalText: string | null
}

export function parseBedrockComputerToolConfig(env: NodeJS.ProcessEnv): BedrockComputerToolConfig {
  const toolType = env.STEWARD_BEDROCK_COMPUTER_TOOL?.trim() || defaultBedrockComputerToolType
  const beta = env.STEWARD_BEDROCK_COMPUTER_BETA?.trim() || defaultBedrockComputerBeta
  if (!/^computer_\d{8}$/u.test(toolType)) throw new Error('STEWARD_BEDROCK_COMPUTER_TOOL must look like computer_20251124')
  if (!/^computer-use-\d{4}-\d{2}-\d{2}$/u.test(beta)) throw new Error('STEWARD_BEDROCK_COMPUTER_BETA must look like computer-use-2025-11-24')
  return { toolType, beta }
}

export function bedrockComputerToolDefinition(config: BedrockComputerToolConfig, display: { width: number; height: number }): Record<string, unknown> {
  return {
    type: config.toolType,
    name: bedrockComputerToolName,
    display_width_px: display.width,
    display_height_px: display.height,
  }
}

/**
 * Translate one Claude response into Carve proposals. A response with no
 * computer call is the model's final answer; a response that mixes text with
 * calls keeps the calls and discards the commentary, matching how the OpenAI
 * adapter treats interleaved messages.
 */
export function claudeComputerTurnContent(
  blocks: unknown,
  frame: { width: number; height: number },
): ClaudeComputerTurnContent {
  if (!Array.isArray(blocks)) throw new Error('Claude response content must be an array')
  const toolUseIds: string[] = []
  const actions: ComputerActionProposal[] = []
  const text: string[] = []
  for (const [index, raw] of blocks.entries()) {
    const block = objectValue(raw, `content block ${index + 1}`)
    if (block['type'] === 'text') {
      if (typeof block['text'] === 'string') text.push(block['text'])
      continue
    }
    if (block['type'] !== 'tool_use') continue
    const name = boundedString(block['name'], `tool_use ${index + 1} name`, 100)
    // The first-party toolset names each member tool (left_click, type, …) and
    // marks the block with toolset_name; the single Bedrock tool is named
    // computer and carries the member as input.action. Both reach one grammar.
    const toolset = block['toolset_name'] === bedrockComputerToolName
    if (!toolset && name !== bedrockComputerToolName) throw new Error(`Claude requested an unsupported tool "${name}"`)
    toolUseIds.push(boundedString(block['id'], `tool_use ${index + 1} id`, 300))
    const input = toolset ? { ...objectValue(block['input'] ?? {}, `tool_use ${index + 1} input`), action: name } : block['input']
    actions.push(...claudeComputerAction(input, frame, toolUseIds.length))
  }
  if (actions.length > maximumProposalsPerTurn) throw new Error(`Claude computer turn exceeded Carve's ${maximumProposalsPerTurn}-action proposal limit`)
  if (toolUseIds.length === 0) {
    const joined = text.join('\n').trim()
    return { toolUseIds, actions: [], terminalText: joined ? joined.slice(0, 10_000) : null }
  }
  return { toolUseIds, actions, terminalText: null }
}

/** One Claude computer call may expand to several proposals (repeat, triple click). */
export function claudeComputerAction(input: unknown, frame: { width: number; height: number }, ordinal: number): ComputerActionProposal[] {
  const label = `computer call ${ordinal}`
  const value = objectValue(input, `${label} input`)
  const action = boundedString(value['action'], `${label} action`, 40)
  switch (action) {
    case 'screenshot':
      return [{ kind: 'screenshot' }]
    case 'wait':
      return [{ kind: 'wait' }]
    case 'left_click':
    case 'right_click':
    case 'middle_click':
      return [{ kind: 'click', point: point(value['coordinate'], frame, label), button: action === 'left_click' ? 'left' : action === 'right_click' ? 'right' : 'wheel', modifiers: claudeModifiers(value['text'], label) }]
    case 'double_click':
      return [{ kind: 'double_click', point: point(value['coordinate'], frame, label), button: 'left', modifiers: claudeModifiers(value['text'], label) }]
    case 'triple_click': {
      // Carve's proposal vocabulary has no triple click; three ordered clicks
      // at one point are the closest faithful expression for text selection.
      const click: ComputerActionProposal = { kind: 'click', point: point(value['coordinate'], frame, label), button: 'left', modifiers: claudeModifiers(value['text'], label) }
      return [click, click, click]
    }
    case 'mouse_move':
      return [{ kind: 'move', point: point(value['coordinate'], frame, label), modifiers: [] }]
    case 'left_click_drag':
      return [{ kind: 'drag', path: [point(value['start_coordinate'], frame, `${label} start_coordinate`), point(value['coordinate'], frame, label)], modifiers: claudeModifiers(value['text'], label) }]
    case 'scroll': {
      const direction = boundedString(value['scroll_direction'], `${label} scroll_direction`, 10)
      const amount = boundedNumber(value['scroll_amount'] ?? 3, `${label} scroll_amount`, 0, 100)
      const pixels = Math.round(amount * bedrockScrollPixelsPerClick)
      const delta = direction === 'up' ? { deltaX: 0, deltaY: -pixels }
        : direction === 'down' ? { deltaX: 0, deltaY: pixels }
          : direction === 'left' ? { deltaX: -pixels, deltaY: 0 }
            : direction === 'right' ? { deltaX: pixels, deltaY: 0 }
              : null
      if (!delta) throw new Error(`${label} scroll_direction "${direction}" is unsupported`)
      const at = value['coordinate'] === undefined
        ? { x: Math.floor(frame.width / 2), y: Math.floor(frame.height / 2) }
        : point(value['coordinate'], frame, label)
      return [{ kind: 'scroll', point: at, ...delta, modifiers: claudeModifiers(value['text'], label) }]
    }
    case 'type':
      return [{ kind: 'type', text: boundedString(value['text'], `${label} text`, 100_000, true) }]
    case 'key': {
      const keys = claudeKeyChord(boundedString(value['text'], `${label} text`, 200))
      const repeat = value['repeat'] === undefined ? 1 : boundedNumber(value['repeat'], `${label} repeat`, 1, maximumKeyRepeat)
      return Array.from({ length: Math.round(repeat) }, () => ({ kind: 'keypress' as const, keys: [...keys] }))
    }
    case 'zoom':
      // Carve has no partial-frame observation for the provider loop. The zoom
      // is answered with a fresh full screenshot, which the system prompt tells
      // Claude to expect; no input is executed for it.
      return [{ kind: 'screenshot' }]
    case 'hold_key':
    case 'left_mouse_down':
    case 'left_mouse_up':
    case 'cursor_position':
      throw new Error(`Claude computer action "${action}" has no bounded Carve equivalent; the controller does not execute it`)
    default:
      throw new Error(`Claude computer call returned unsupported action "${action}"`)
  }
}

const claudeKeyNames: Record<string, string> = {
  RETURN: 'ENTER', ENTER: 'ENTER', KP_ENTER: 'ENTER',
  ESCAPE: 'ESC', ESC: 'ESC',
  BACKSPACE: 'BACKSPACE', DELETE: 'DELETE', TAB: 'TAB', SPACE: 'SPACE',
  UP: 'ARROWUP', DOWN: 'ARROWDOWN', LEFT: 'ARROWLEFT', RIGHT: 'ARROWRIGHT',
  PAGE_UP: 'PAGEUP', PRIOR: 'PAGEUP', PAGE_DOWN: 'PAGEDOWN', NEXT: 'PAGEDOWN',
  HOME: 'HOME', END: 'END',
  CTRL: 'CTRL', CONTROL: 'CTRL', CTRL_L: 'CTRL', CTRL_R: 'CTRL',
  ALT: 'ALT', OPTION: 'ALT', ALT_L: 'ALT', ALT_R: 'ALT',
  SHIFT: 'SHIFT', SHIFT_L: 'SHIFT', SHIFT_R: 'SHIFT',
  SUPER: 'META', SUPER_L: 'META', SUPER_R: 'META', CMD: 'META', COMMAND: 'META', META: 'META', WIN: 'META',
}

/** Claude expresses chords in xdotool style ("ctrl+shift+t", "Return"). Carve
 * backends consume the uppercase provider vocabulary the OpenAI adapter uses. */
export function claudeKeyChord(text: string): string[] {
  const parts = text.split('+').map((part) => part.trim()).filter(Boolean)
  if (parts.length === 0 || parts.length > 5) throw new Error('Claude key chord must contain 1 to 5 keys')
  return parts.map((part) => {
    const upper = part.toUpperCase()
    const named = claudeKeyNames[upper]
    if (named) return named
    if (part.length === 1) return upper
    if (/^F\d{1,2}$/u.test(upper)) return upper
    return upper.replace(/[\s_-]+/gu, '')
  })
}

const claudeModifierNames: Record<string, ComputerActionModifier> = {
  SHIFT: 'SHIFT', CTRL: 'CTRL', CONTROL: 'CTRL', ALT: 'ALT', OPTION: 'ALT', SUPER: 'META', CMD: 'META', COMMAND: 'META', META: 'META', WIN: 'META',
}

export function claudeModifiers(text: unknown, label: string): ComputerActionModifier[] {
  if (text === undefined || text === null || text === '') return []
  const parts = boundedString(text, `${label} modifier keys`, 60).split('+').map((part) => part.trim().toUpperCase()).filter(Boolean)
  if (parts.length > 4) throw new Error(`${label} must hold at most four modifier keys`)
  return parts.map((part) => {
    const modifier = claudeModifierNames[part]
    if (!modifier) throw new Error(`${label} contained non-modifier key "${part}"`)
    return modifier
  })
}

export function normalizeClaudeUsage(usage: ClaudeMessagesResponse['usage']): ProviderTokenUsage {
  if (!usage) return { inputTokens: null, outputTokens: null }
  const input = count(usage.input_tokens)
  const cacheRead = count(usage.cache_read_input_tokens)
  const cacheWrite = count(usage.cache_creation_input_tokens)
  const output = count(usage.output_tokens)
  if (input === null || output === null) return { inputTokens: null, outputTokens: null }
  const inputTokens = input + (cacheRead ?? 0) + (cacheWrite ?? 0)
  return {
    inputTokens,
    outputTokens: output,
    totalTokens: inputTokens + output,
    ...(cacheRead === null ? {} : { cachedInputTokens: cacheRead }),
    ...(cacheWrite === null ? {} : { cacheWriteTokens: cacheWrite }),
  }
}

/** Screenshot data URL to a Claude image block. */
export function claudeImageBlock(dataUrl: string): Record<string, unknown> {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/u.exec(dataUrl)
  if (!match?.[1] || !match[2]) throw new Error('Computer-use screenshots must be bounded PNG, JPEG, or WebP data URLs')
  return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2].replace(/\s+/gu, '') } }
}

/**
 * Tool results for an executed batch. Every call must be answered; the fresh
 * observation is attached to the last one so the model sees the state after
 * the whole batch, exactly as the controller executed it.
 */
export function claudeBatchToolResults(toolUseIds: string[], screenshotDataUrl: string, options: { toolset?: boolean; executedText?: string } = {}): Array<Record<string, unknown>> {
  if (toolUseIds.length === 0) throw new Error('The computer-use session has no pending call to receive a screenshot')
  // Toolset results must name the toolset and use typed content blocks.
  const tag = options.toolset ? { toolset_name: bedrockComputerToolName } : {}
  const executed = options.executedText ?? 'Executed.'
  return toolUseIds.map((toolUseId, index) => index === toolUseIds.length - 1
    ? { type: 'tool_result', tool_use_id: toolUseId, ...tag, content: [...(options.executedText ? [{ type: 'text', text: executed }] : []), claudeImageBlock(screenshotDataUrl)] }
    : { type: 'tool_result', tool_use_id: toolUseId, ...tag, content: options.toolset ? [{ type: 'text', text: executed }] : executed })
}

function point(value: unknown, frame: { width: number; height: number }, label: string): { x: number; y: number } {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${label} coordinate must be an [x, y] pair`)
  return {
    x: boundedNumber(value[0], `${label} x`, 0, frame.width - 1),
    y: boundedNumber(value[1], `${label} y`, 0, frame.height - 1),
  }
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function boundedString(value: unknown, label: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || value.length > maxLength) {
    throw new Error(`${label} must be ${allowEmpty ? 'a' : 'a non-empty'} string no longer than ${maxLength} characters`)
  }
  return value
}

function boundedNumber(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be a finite number between ${minimum} and ${maximum}`)
  }
  return value
}
