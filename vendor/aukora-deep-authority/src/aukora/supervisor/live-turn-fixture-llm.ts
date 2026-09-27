/**
 * Fixture adapter: stage one KIRA record, submit the exact arguments that
 * staging returned, then stop. Does not authorize.
 *
 * The two calls are ordered by data, not by script: the `memory.put` arguments
 * are read out of the `kira.stage` reply rather than restated here, so a
 * staging route that returned a different key would move the write instead of
 * failing an assertion about a constant. That is what makes the assembled
 * proof meaningful — the settled object's key is the record identifier KIRA
 * derived, and nothing in this file could have supplied it.
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

const STAGE_TOOL = 'kira.stage'
const PUT_TOOL = 'memory.put'
const STAGE_CALL_ID = CallId('live-turn-fixture-stage')
const PUT_CALL_ID = CallId('live-turn-fixture-put')
const SUBJECT = process.env.AUKORA_LIVE_TURN_AUMLOK_SUBJECT
const PRIVACY = process.env.AUKORA_LIVE_TURN_KIRA_PRIVACY
if (SUBJECT === undefined || SUBJECT === '' || PRIVACY === undefined || PRIVACY === '') {
  throw new Error('live-turn-fixture-llm: parent AUMLOK policy missing')
}

/**
 * One closed KIRA candidate. Every field is fixed, so the derived record
 * identifier is a constant of the fixture and the assembled test can name it.
 */
const STAGE_ARGUMENTS = {
  subject: SUBJECT,
  kind: 'observation',
  source: [],
  content: { note: 'live turn fixture' },
  links: [],
  privacy: PRIVACY,
  createdAt: '2026-08-29T00:00:00Z',
}

/** The `memory.put` arguments a `kira.stage` reply carries. */
interface StagedMemoryPut {
  key: string
  value: unknown
}

/**
 * Read the inert `memory.put` arguments out of one `kira.stage` reply.
 *
 * The reply is the tool's rendered text, so this parses rather than trusts:
 * a staging route that stopped returning `memoryPut`, or that started
 * returning authority beside it, refuses the turn here instead of reaching
 * the broker with arguments nobody checked.
 *
 * @param text - rendered `kira.stage` result text
 * @returns the staged `memory.put` arguments
 */
function readStagedMemoryPut(text: string): StagedMemoryPut {
  let reply: unknown
  try {
    reply = JSON.parse(text)
  } catch {
    throw new Error(`live-turn-fixture-llm: ${STAGE_TOOL} reply was not JSON`)
  }
  if (reply === null || typeof reply !== 'object' || Array.isArray(reply)) {
    throw new Error(`live-turn-fixture-llm: ${STAGE_TOOL} reply was not one object`)
  }
  const staged = reply as Record<string, unknown>
  if (staged.grantsAuthority !== false) {
    throw new Error(`live-turn-fixture-llm: ${STAGE_TOOL} reply did not disclaim authority`)
  }
  const put = staged.memoryPut
  if (put === null || typeof put !== 'object' || Array.isArray(put)) {
    throw new Error(`live-turn-fixture-llm: ${STAGE_TOOL} reply carried no memoryPut object`)
  }
  const { key, value } = put as Record<string, unknown>
  if (typeof key !== 'string' || key === '') {
    throw new Error(`live-turn-fixture-llm: ${STAGE_TOOL} reply carried no memoryPut key`)
  }
  if (!Object.hasOwn(put as Record<string, unknown>, 'value')) {
    throw new Error(`live-turn-fixture-llm: ${STAGE_TOOL} reply carried no memoryPut value`)
  }
  return { key, value }
}

/** One tool result returned to this deterministic fixture. */
interface FixtureToolResult {
  toolCallId: string
  isError: boolean
  text: string
}

/** The single tool-result block in the last message, if one exists. */
function lastToolResult(options: GenerateOptions): FixtureToolResult | undefined {
  const content = options.messages.at(-1)?.content
  if (content === undefined) return undefined
  const results = content.filter(block => block.type === 'tool-result')
  if (results.length === 0) return undefined
  if (results.length !== 1) {
    throw new Error('live-turn-fixture-llm: expected one tool result')
  }
  const result = results[0]
  if (result === undefined) throw new Error('live-turn-fixture-llm: tool result disappeared')
  const parts = result.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
  if (parts.length === 0) {
    throw new Error('live-turn-fixture-llm: tool result carried no text')
  }
  return {
    toolCallId: result.toolCallId,
    isError: result.isError === true,
    text: parts.join(''),
  }
}

/** Model adapter that stages one KIRA record, writes it, and ends the turn. */
class LiveTurnFixtureAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose === 'session-title') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'live turn fixture' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'live turn fixture' } }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }

    const names = (options.tools ?? []).map(tool => tool.name)
    // Both names are required before the first call. Without kira.stage the
    // turn ends here, so removing the overlay refuses before broker contact
    // rather than silently writing the record the old fixture hardcoded.
    for (const required of [STAGE_TOOL, PUT_TOOL]) {
      if (!names.includes(required)) {
        throw new Error(`live-turn-fixture-llm: tool inventory omitted ${required}`)
      }
    }

    const result = lastToolResult(options)
    if (result === undefined) {
      const args = JSON.stringify(STAGE_ARGUMENTS)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: STAGE_CALL_ID, name: STAGE_TOOL, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: STAGE_CALL_ID, name: STAGE_TOOL, arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 3 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }

    if (result.toolCallId === STAGE_CALL_ID) {
      if (result.isError) {
        throw new Error(`live-turn-fixture-llm: ${STAGE_TOOL} refused`)
      }
      const staged = readStagedMemoryPut(result.text)
      const args = JSON.stringify({ key: staged.key, value: staged.value })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: PUT_CALL_ID, name: PUT_TOOL, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: PUT_CALL_ID, name: PUT_TOOL, arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 4 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }

    if (result.toolCallId !== PUT_CALL_ID) {
      throw new Error(`live-turn-fixture-llm: unexpected tool result ${result.toolCallId}`)
    }
    if (result.isError) {
      throw new Error(`live-turn-fixture-llm: ${PUT_TOOL} refused`)
    }

    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'LIVE_TURN_FIXTURE_DONE' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'LIVE_TURN_FIXTURE_DONE' } }
    yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 2 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'live-turn-fixture-llm'
export const inject = ['llm']

/** Register the parent-staged live-turn fixture adapter. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['live-turn-fixture'], new LiveTurnFixtureAdapter())
}
