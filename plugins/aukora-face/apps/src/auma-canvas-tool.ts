/** Model-facing tools for the Session-owned Auma Canvas document. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { AumaCanvasDocument } from './auma-canvas/types.ts'
import { aumaCanvasProjectionDefinition } from './auma-canvas/projection.ts'
import type {} from '@deepseek-ai/dsh-session-projection'

export type * from './auma-canvas/types.ts'

/** Stable Cordis plugin name. */
export const name = 'auma-canvas-tool'

/** Services required by Canvas reads, writes, and replay projection. */
export const inject = ['tools']

/** Deployment limits for one complete Canvas document. */
export interface Config {
  /** Maximum UTF-8 bytes retained by one whole-document replacement event. */
  maxDocumentBytes: number
}

export const Config: z<Config> = z.object({
  maxDocumentBytes: z.natural().min(1).required(),
})

function latestDocument(events: readonly {
  readonly type: string
  readonly seq: number
  readonly data: unknown
}[]): { document: AumaCanvasDocument | null; revision: number } {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.type !== 'auma-canvas/document') continue
    const data = event.data as { document: AumaCanvasDocument | null }
    return { document: data.document, revision: event.seq }
  }
  return { document: null, revision: -1 }
}

function documentBytes(document: AumaCanvasDocument | null): number {
  return new TextEncoder().encode(JSON.stringify({ document })).byteLength
}

/**
 * Register the Session-owned Canvas tools and replay projection.
 * @param ctx - Agent-preset context carrying the tool registry.
 * @param config - Explicit whole-document byte limit.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(aumaCanvasProjectionDefinition)
  })

  ctx.tools.register(defineTool({
    name: 'auma_canvas_read',
    description: 'Read the complete visual document currently shown in Auma Canvas. Use this before editing an existing Canvas after compaction or whenever the current page is not already present in context.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          revision: { type: 'integer', required: true },
          title: { type: 'string', required: true },
          markup: { type: 'string', required: true },
          css: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.revision < 0
          ? 'Auma Canvas is the blank living field.'
          : `Read Auma Canvas revision ${String(value.revision)}: ${value.title}`,
      }],
    },
    execute(_args, exec) {
      if (!exec.agent) throw new Error('auma_canvas_read requires an owning agent session')
      const current = latestDocument(exec.agent.session.snapshotEvents())
      return Promise.resolve({
        revision: current.revision,
        title: current.document?.title ?? '',
        markup: current.document?.markup ?? '',
        css: current.document?.css ?? '',
      })
    },
    presentCall: () => ({ card: 'generic', title: 'Read Auma Canvas', kind: 'read', rawInput: {} }),
    isConcurrencySafe: () => true,
  }))

  ctx.tools.register(defineTool({
    name: 'auma_canvas_render',
    description: 'Replace the live Auma Canvas with one complete HTML/CSS visual document. Use this when the user asks to create, show, design, or change something on the Canvas: render the result instead of only describing it. The document is displayed inside a scriptless, network-blocked browser sandbox above Auma\'s living field. Send body markup only, never scripts or a full html/head document. This tool changes the visual Canvas; use ordinary governed workspace tools separately when the user asks to lay the result into source code. Send empty markup and CSS to return to the blank living field.',
    parameters: {
      title: {
        type: 'string',
        required: true,
        description: 'Short accessible name for the complete Canvas document.',
      },
      markup: {
        type: 'string',
        required: true,
        description: 'Complete replacement body markup. Empty clears the Canvas.',
      },
      css: {
        type: 'string',
        required: true,
        description: 'Complete replacement document-local CSS. Empty when clearing.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          revision: { type: 'integer', required: true },
          bytes: { type: 'integer', required: true },
          empty: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.empty
          ? 'Returned Auma Canvas to the blank living field.'
          : `Rendered Auma Canvas revision ${String(value.revision)} (${String(value.bytes)} bytes).`,
      }],
    },
    execute(args, exec) {
      if (!exec.agent) throw new Error('auma_canvas_render requires an owning agent session')
      const title = args.title.trim()
      if (title.length > 160) throw new Error('Auma Canvas title must be 160 characters or fewer')
      const clearing = args.markup.trim().length === 0
      if (clearing && args.css.trim().length > 0) {
        throw new Error('Auma Canvas CSS must be empty when markup is empty')
      }
      if (!clearing && title.length === 0) throw new Error('Auma Canvas title must not be empty')
      const document: AumaCanvasDocument | null = clearing
        ? null
        : { version: 1, title, markup: args.markup, css: args.css }
      const bytes = documentBytes(document)
      if (bytes > config.maxDocumentBytes) {
        throw new Error(`Auma Canvas document is ${String(bytes)} bytes; limit is ${String(config.maxDocumentBytes)}`)
      }
      const event = exec.agent.session.append('auma-canvas/document', { document })
      return Promise.resolve({ revision: event.seq, bytes, empty: document === null })
    },
    presentCall: args => ({
      card: 'generic',
      title: args.markup.trim().length === 0 ? 'Clear Auma Canvas' : 'Render Auma Canvas',
      kind: 'other',
      rawInput: { title: args.title },
    }),
  }))
}
