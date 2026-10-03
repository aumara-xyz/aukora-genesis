/** The Viking MCP memory methods share the same chain as text chat and the HTTP door. */
import { contentHash, validExternalOrigin } from './tracked-memory.mjs'
class InvalidParams extends Error {}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
export function createVikingMcp(memory) {
  const tools = [
    { name: 'write', description: 'Remember exact content in tracked memory and index it. URI is assigned from its content hash.',
      inputSchema: { type: 'object', properties: { content: { type: 'string', minLength: 1, maxLength: 1000000 }, from: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$', description: 'Agent origin; owner-prefixed names are reserved for the host.' }, uri: { type: 'string', description: 'Source for append; destination is always content-addressed.' }, mode: { type: 'string', enum: ['replace', 'append'], default: 'replace' }, wait: { type: 'boolean', default: false }, timeout: { type: ['number', 'null'], exclusiveMinimum: 0 } }, required: ['content'], additionalProperties: false } },
    { name: 'find', description: 'Chain-verified semantic memory search with local lexical fallback. Only exact bytes verified against the memory chain are returned.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['query'], additionalProperties: false } },
  ]
  return async request => {
    const { id, method, params = {} } = request
    if (id === undefined) return null
    try {
      if (!object(params)) throw new InvalidParams()
      if (method === 'initialize' && params.protocolVersion !== undefined && typeof params.protocolVersion !== 'string') throw new InvalidParams()
      let result
      if (method === 'initialize') result = { protocolVersion: params.protocolVersion ?? '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'aukora-memory', version: '1.0.0' } }
      else if (method === 'ping') result = {}
      else if (method === 'tools/list') result = { tools }
      else if (method === 'tools/call') {
        if (params.arguments !== undefined && !object(params.arguments)) throw new InvalidParams()
        const args = params.arguments ?? {}
        if (!object(args)) throw new InvalidParams()
        let value
        if (params.name === 'write') {
          if (Object.keys(args).some(key => !['content', 'from', 'uri', 'mode', 'wait', 'timeout'].includes(key))
            || typeof args.content !== 'string' || !args.content.trim() || args.content.length > 1_000_000
            || (args.from !== undefined && !validExternalOrigin(args.from))
            || (args.uri !== undefined && (typeof args.uri !== 'string' || !args.uri))) throw new InvalidParams()
          const mode = args.mode === undefined ? 'replace' : args.mode
          if (!['replace', 'append'].includes(mode) || (args.wait !== undefined && typeof args.wait !== 'boolean')
            || (args.timeout != null && (!Number.isFinite(args.timeout) || args.timeout <= 0))) throw new InvalidParams()
          let text = args.content
          if (mode === 'append') {
            const hash = typeof args.uri === 'string' ? args.uri.match(/\/content\/([0-9a-f]{64})\.md$/u)?.[1] : null
            if (!hash || ![...memory.ledger().entries.values()].some(note => note.contentHash === hash)) throw new InvalidParams()
            const prior = await memory.bridge.readContent(args.uri)
            if (typeof prior !== 'string' || contentHash(prior) !== hash) throw new Error('append-source-changed')
            text = prior + text
            if (text.length > 1_000_000) throw new InvalidParams()
          }
          // The chain is durable before reply. Indexing is attempted even when wait=false;
          // wait=true additionally requires the outbox to have drained successfully.
          const pending = memory.remember({ text, from: args.from ?? 'viking-mcp', scope: 'agent' })
          let timer
          try {
            value = args.timeout == null ? await pending : await Promise.race([pending, new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error('write-timeout')), args.timeout * 1000)
            })])
          } finally { clearTimeout(timer) }
          if (args.wait && (value.index?.pending > 0 || value.index?.failed?.length)) throw new Error('index-pending')
        } else if (params.name === 'find') {
          if (Object.keys(args).some(key => !['query', 'limit'].includes(key)) || typeof args.query !== 'string' || !args.query.trim() || (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 10))) throw new InvalidParams()
          value = await memory.recall({ question: args.query, limit: args.limit })
        } else return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown memory tool.' } }
        result = { content: [{ type: 'text', text: JSON.stringify(value) }] }
      } else return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found.' } }
      return { jsonrpc: '2.0', id, result }
    } catch (error) { return { jsonrpc: '2.0', id, error: { code: error instanceof InvalidParams ? -32602 : -32603,
      message: error instanceof InvalidParams ? 'Invalid memory parameters.' : 'Memory request failed; details suppressed.' } } }
  }
}
