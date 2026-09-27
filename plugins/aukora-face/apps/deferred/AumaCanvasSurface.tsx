import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { ConversationSnapshot, TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionFace } from '@deepseek-ai/dsh-api-session-controller/client'
import type { MessageId, SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { StockAppSurfaceProps } from './contract.ts'
import { EmbeddedAppSurface } from './EmbeddedAppSurface.tsx'
import type { AumaCanvasProjection } from '../auma-canvas/types.ts'

interface AumaCanvasSurfaceProps extends StockAppSurfaceProps {
  resolveSession: (sessionId: SessionId) => SessionFace | undefined
}

interface PendingCanvasTurn {
  requestId: string
  afterSeq: number
  messageIds: Set<MessageId>
  latestMessageId: MessageId | undefined
  admissions: number
  nextAdmission: number
  latestAcceptedAdmission: number
  lastState: string | undefined
}

interface CanvasReadyMessage {
  source: 'auma-canvas'
  type: 'ready'
  sessionId: string
}

interface CanvasPromptMessage {
  source: 'auma-canvas'
  type: 'prompt'
  requestId: string
  sessionId: string
  text: string
}

type CanvasFrameMessage = CanvasReadyMessage | CanvasPromptMessage

function canvasFrameMessage(value: unknown): CanvasFrameMessage | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const message = value as Record<string, unknown>
  if (message['source'] !== 'auma-canvas') return undefined
  const sessionId = typeof message['sessionId'] === 'string' ? message['sessionId'] : undefined
  if (sessionId === undefined || sessionId.length > 512) return undefined
  if (message['type'] === 'ready') return { source: 'auma-canvas', type: 'ready', sessionId }
  if (message['type'] !== 'prompt') return undefined
  const requestId = typeof message['requestId'] === 'string' ? message['requestId'].trim() : ''
  const text = typeof message['text'] === 'string' ? message['text'].trim() : ''
  if (
    requestId.length === 0
    || requestId.length > 160
    || text.length === 0
  ) {
    return undefined
  }
  return { source: 'auma-canvas', type: 'prompt', requestId, sessionId, text }
}

function latestNodeSeq(snapshot: ConversationSnapshot): number {
  let latest = -1
  for (const node of snapshot.nodes) {
    latest = Math.max(latest, node.seq)
  }
  return latest
}

type CanvasTurnOutcome =
  | { kind: 'response'; text: string }
  | { kind: 'error'; message: string }
  | { kind: 'ambiguous' }

function owningTurn(
  snapshot: ConversationSnapshot,
  promptSeq: number,
): TurnLocation | undefined {
  for (const turn of snapshot.chat.timeline.turns.values()) {
    if (turn.start === undefined || turn.start.seq >= promptSeq) continue
    if (turn.end === undefined || promptSeq < turn.end.seq) return turn
  }
  return undefined
}

function canvasTurnOutcome(
  snapshot: ConversationSnapshot,
  pending: PendingCanvasTurn,
): CanvasTurnOutcome | undefined {
  if (pending.admissions !== 0 || pending.latestMessageId === undefined) return undefined
  const prompt = snapshot.nodes.find(node => (
    (node.kind === 'user' || node.kind === 'steering')
    && node.seq > pending.afterSeq
    && node.messageId === pending.latestMessageId
  ))
  if (prompt === undefined) return undefined
  const turn = owningTurn(snapshot, prompt.seq)
  if (
    turn === undefined
    || turn.start === undefined
    || turn.status !== 'closed'
    || turn.end === undefined
  ) return undefined
  const startSeq = turn.start.seq
  const endSeq = turn.end.seq
  const otherPrompt = snapshot.nodes.some(node => (
    (node.kind === 'user' || node.kind === 'steering')
    && node.seq > pending.afterSeq
    && node.seq > startSeq
    && node.seq < endSeq
    && !pending.messageIds.has(node.messageId)
  ))
  if (otherPrompt) return { kind: 'ambiguous' }

  const reason = turn.end.data.reason
  switch (reason.kind) {
    case 'completed': {
      let response: { seq: number; text: string } | undefined
      for (const node of snapshot.nodes) {
        if (
          node.kind !== 'assistant'
          || node.turn !== turn.turn
          || node.interrupted
          || node.seq <= prompt.seq
        ) continue
        const text = node.blocks.flatMap(block => block.kind === 'text' ? [block.text] : []).join('').trim()
        if (text.length > 0 && (response === undefined || node.seq > response.seq)) {
          response = { seq: node.seq, text }
        }
      }
      return response === undefined
        ? { kind: 'error', message: 'The selected Agent finished without a spoken response.' }
        : { kind: 'response', text: response.text }
    }
    case 'error':
      return { kind: 'error', message: reason.error.message }
    case 'aborted':
      return { kind: 'error', message: 'The selected Agent turn was stopped before it produced a completed spoken response.' }
    case 'blocked':
      return { kind: 'error', message: 'The selected Agent could not begin that turn.' }
    case 'max-tokens':
      return { kind: 'error', message: 'The selected Agent reached its output limit; the partial result remains in the thread.' }
    case 'interrupted':
      return { kind: 'error', message: 'The selected Agent turn was interrupted; its partial result remains in the thread.' }
    default:
      return { kind: 'error', message: 'The selected Agent finished with an unsupported outcome; the result remains in the thread.' }
  }
}

type CanvasAgentState =
  | 'acting'
  | 'queued'
  | 'responding'
  | 'sending'
  | 'steering'
  | 'thinking'
  | 'waiting'

function canvasAgentState(
  snapshot: ConversationSnapshot,
  pending: PendingCanvasTurn,
): { state: CanvasAgentState; message?: string } {
  const messageId = pending.latestMessageId
  if (messageId === undefined) return { state: 'sending' }
  const queued = snapshot.queue.find(message => message.messageId === messageId)
  if (queued !== undefined) {
    return { state: queued.placement === 'steering' ? 'steering' : 'queued' }
  }
  const prompt = snapshot.nodes.find(node => (
    (node.kind === 'user' || node.kind === 'steering')
    && node.seq > pending.afterSeq
    && node.messageId === messageId
  ))
  if (prompt === undefined) return { state: 'queued' }
  const turn = owningTurn(snapshot, prompt.seq)
  if (turn === undefined) return { state: 'queued' }
  if (snapshot.pending.length > 0) {
    const wait = snapshot.pending[0]
    return {
      state: 'waiting',
      message: wait?.kind === 'approval'
        ? 'I need your approval in the thread before I can continue.'
        : 'I need your answer in the thread before I can continue.',
    }
  }
  if (snapshot.runningCalls.some(call => call.turn === turn.turn)) return { state: 'acting' }
  if (snapshot.partial?.turn === turn.turn && snapshot.partial.blocks.length > 0) {
    return { state: 'responding' }
  }
  return { state: 'thinking' }
}

/** Render Auma Live's exact field while routing narration into the selected Agent Session. */
export function AumaCanvasSurface({ resolveSession, ...props }: AumaCanvasSurfaceProps) {
  const sessionId = props.useSessions(state => state.current)
  const session = sessionId === undefined ? undefined : resolveSession(sessionId)
  const projectionFace = session?.projections.faceOf('aumaCanvas')
  const subscribeCanvas = useCallback((listener: () => void): (() => void) => (
    projectionFace?.subscribe(listener) ?? (() => {})
  ), [projectionFace])
  const readCanvas = useCallback((): AumaCanvasProjection | undefined => (
    projectionFace?.getSnapshot() as AumaCanvasProjection | undefined
  ), [projectionFace])
  const canvasProjection = useSyncExternalStore(subscribeCanvas, readCanvas, readCanvas)
  const frameWindow = useRef<Window | null>(null)
  const currentProjection = useRef<AumaCanvasProjection | undefined>(canvasProjection)
  currentProjection.current = canvasProjection
  const pending = useRef<PendingCanvasTurn | null>(null)
  const publishPending = useRef<() => void>(() => {})
  const currentSession = useRef(session)
  currentSession.current = session

  const post = useCallback((message: Record<string, unknown>): void => {
    frameWindow.current?.postMessage({ source: 'aukora-shell', ...message }, window.location.origin)
  }, [])

  const postDocument = useCallback((projection: AumaCanvasProjection | undefined): void => {
    post({
      type: 'canvas-document',
      sessionId: sessionId ?? '',
      document: projection?.document ?? null,
      revision: projection?.revision ?? -1,
    })
  }, [post, sessionId])

  useEffect(() => { postDocument(canvasProjection) }, [canvasProjection, postDocument])

  useEffect(() => {
    pending.current = null
    if (session === undefined) return
    const publish = (): void => {
      const turn = pending.current
      if (turn === null) return
      const snapshot = session.getSnapshot()
      const outcome = canvasTurnOutcome(snapshot, turn)
      if (outcome?.kind === 'response') {
        pending.current = null
        post({ type: 'agent-response', requestId: turn.requestId, text: outcome.text })
        return
      }
      if (outcome === undefined) {
        const activity = canvasAgentState(snapshot, turn)
        const stateKey = `${activity.state}:${activity.message ?? ''}`
        if (turn.lastState !== stateKey) {
          turn.lastState = stateKey
          post({ type: 'agent-state', requestId: turn.requestId, ...activity })
        }
        return
      }
      pending.current = null
      post({
        type: 'agent-error',
        requestId: turn.requestId,
        message: outcome.kind === 'error'
          ? outcome.message
          : 'Another thread message arrived before the Agent replied; the result remains in the thread.',
      })
    }
    publishPending.current = publish
    const dispose = session.subscribe(publish)
    publish()
    return () => {
      if (publishPending.current === publish) publishPending.current = () => {}
      dispose()
      const turn = pending.current
      if (turn === null) return
      pending.current = null
      post({
        type: 'agent-error',
        requestId: turn.requestId,
        message: 'The selected thread changed before Auma finished that turn.',
      })
    }
  }, [post, session])

  const onFrameMessage = useCallback((value: unknown): void => {
    const message = canvasFrameMessage(value)
    if (message === undefined) return
    const target = currentSession.current
    if (message.type === 'ready') {
      if (props.activeSurface !== 'auma-canvas') return
      const turn = pending.current
      if (target === undefined || message.sessionId !== target.sessionId || turn === null) return
      post({ type: 'agent-resume', requestId: turn.requestId })
      turn.lastState = undefined
      publishPending.current()
      return
    }
    if (props.activeSurface !== 'auma-canvas') {
      post({
        type: 'agent-error',
        requestId: message.requestId,
        message: 'Auma Canvas closed before that spoken turn could be admitted.',
      })
      return
    }
    if (target === undefined) {
      post({
        type: 'agent-error',
        requestId: message.requestId,
        message: 'Open a thread first so Auma Canvas has a real Agent and workspace.',
      })
      return
    }
    if (message.sessionId !== target.sessionId) {
      post({
        type: 'agent-error',
        requestId: message.requestId,
        message: 'The selected thread changed before that Canvas turn could be admitted.',
      })
      return
    }
    if (message.text.length > 4_000) {
      post({
        type: 'agent-error',
        requestId: message.requestId,
        message: 'That spoken turn was too long to admit safely. Pause between thoughts and say it again.',
      })
      return
    }
    const snapshot = target.getSnapshot()
    let turn = pending.current
    if (turn === null) {
      turn = {
        requestId: message.requestId,
        afterSeq: latestNodeSeq(snapshot),
        messageIds: new Set(),
        latestMessageId: undefined,
        admissions: 0,
        nextAdmission: 0,
        latestAcceptedAdmission: 0,
        lastState: undefined,
      }
      pending.current = turn
    } else if (turn.requestId !== message.requestId) {
      post({
        type: 'agent-error',
        requestId: message.requestId,
        message: 'Auma Canvas is still completing the previous spoken exchange.',
      })
      return
    }
    const admission = ++turn.nextAdmission
    turn.admissions += 1
    turn.lastState = undefined
    publishPending.current()
    void target.prompt([{ type: 'text', text: message.text }], snapshot.running ? 'steer' : 'queue')
      .then((result) => {
        const active = pending.current
        if (active !== turn) return
        active.admissions -= 1
        if (!result.ok) {
          if (active.messageIds.size === 0 && active.admissions === 0) {
            pending.current = null
            post({ type: 'agent-error', requestId: message.requestId, message: result.error.message })
          } else {
            post({
              type: 'agent-notice',
              requestId: message.requestId,
              message: `I could not steer that turn: ${result.error.message}`,
            })
            publishPending.current()
          }
          return
        }
        active.messageIds.add(result.value.messageId)
        if (admission > active.latestAcceptedAdmission) {
          active.latestAcceptedAdmission = admission
          active.latestMessageId = result.value.messageId
        }
        post({
          type: 'agent-accepted',
          requestId: message.requestId,
          messageId: result.value.messageId,
        })
        publishPending.current()
      }, (cause: unknown) => {
        const active = pending.current
        if (active !== turn) return
        active.admissions -= 1
        const detail = cause instanceof Error ? cause.message : String(cause)
        if (active.messageIds.size === 0 && active.admissions === 0) {
          pending.current = null
          post({ type: 'agent-error', requestId: message.requestId, message: detail })
        } else {
          post({
            type: 'agent-notice',
            requestId: message.requestId,
            message: `I could not steer that turn: ${detail}`,
          })
          publishPending.current()
        }
      })
  }, [post, props.activeSurface])

  const setFrameWindow = useCallback((next: Window | null): void => {
    frameWindow.current = next
    if (next !== null) postDocument(currentProjection.current)
  }, [postDocument])

  const parameters = new URLSearchParams({ mode: 'canvas' })
  if (sessionId !== undefined) parameters.set('session', sessionId)
  return (
    <EmbeddedAppSurface
      key={sessionId ?? 'unselected'}
      {...props}
      id="auma-canvas"
      title={props.t('canvas.name')}
      src={`/stock-apps/auma-live.html?${parameters.toString()}`}
      allow="microphone; autoplay"
      onFrameMessage={onFrameMessage}
      onFrameWindow={setFrameWindow}
    />
  )
}
