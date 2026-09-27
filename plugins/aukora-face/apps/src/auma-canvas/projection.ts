import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { AumaCanvasProjection } from './types.ts'

const documentSchema = z.object({
  version: z.literal(1),
  title: z.string(),
  markup: z.string(),
  css: z.string(),
})

const projectionSchema = z.object({
  version: z.literal(1),
  document: z.union([documentSchema, z.null()]),
  revision: z.number().int().min(-1),
  updatedAt: z.union([z.number().int().nonnegative(), z.null()]),
})

/** Initial Auma Canvas projection before a Session writes a document. */
export const EMPTY_AUMA_CANVAS: AumaCanvasProjection = Object.freeze({
  version: 1,
  document: null,
  revision: -1,
  updatedAt: null,
})

/** Replayable last-write-wins Auma Canvas projection. */
export const aumaCanvasProjectionDefinition = {
  key: 'aumaCanvas',
  stateVersion: 1,
  stateSchema: projectionSchema,
  init: () => EMPTY_AUMA_CANVAS,
  apply: (state, event) => event.type === 'auma-canvas/document'
    ? {
      version: 1,
      document: event.data.document,
      revision: event.seq,
      updatedAt: event.time,
    }
    : state,
  wire: {
    viewSchema: projectionSchema,
    view: state => state,
  },
} satisfies ProjectionDefinition<'aumaCanvas', AumaCanvasProjection>
