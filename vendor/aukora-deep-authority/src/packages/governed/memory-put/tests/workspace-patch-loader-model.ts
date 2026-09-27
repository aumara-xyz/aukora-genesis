/** Scripted model fixture; emits one proposal without external inference. */
import type { Context } from '@deepseek-ai/cordis'
import { CallId, LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'

const CALL_ID = CallId('workspace-patch-fixture-call')

class WorkspacePatchFixtureAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const names = (options.tools ?? []).map(tool => tool.name)
    if (names.length !== 1 || names[0] !== 'workspace.patch') {
      throw new Error(`workspace fixture received unexpected tools: ${JSON.stringify(names)}`)
    }
    const results = options.messages.at(-1)?.content.filter(block => block.type === 'tool-result') ?? []
    if (results.length === 0) {
      const args = JSON.stringify({ workspace: 'project', path: 'note.txt', beforeSha256: null, content: 'hello\n' })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: CALL_ID, name: 'workspace.patch', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CALL_ID, name: 'workspace.patch', arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    if (results.length !== 1 || results[0]?.toolCallId !== CALL_ID) {
      throw new Error('workspace fixture received an unexpected tool result')
    }
    const text = 'Scripted fixture observed the tool result.'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'workspace-patch-fixture-model'
export const inject = ['llm']

/** Register the local scripted adapter for the Loader snapshot. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['workspace-patch-fixture'], new WorkspacePatchFixtureAdapter())
}
