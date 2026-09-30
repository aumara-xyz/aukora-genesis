/** Automatic prompt and final-answer capture, sharing the tracked memory writer. */
import { randomUUID } from 'node:crypto'
import { basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { eventText, isRealAsk, sessionIdOfAgent, setLaneDoorMessageIds } from './autostage-hook.mjs'
import { laneDoorMessageIds } from './lane-door-messages.mjs'
import { readJsonStrict, readLinesIfPresent } from './strict-read.mjs'
import { readMemoryTurn, recentSessionHeaders, readLastUserMessage } from './session-read.mjs'
import { projectScopeOf } from './project-memory.mjs'
import { CONTROLS, ownerControlIn } from './memory-forget.mjs'
import { createTrackedMemory } from './tracked-memory.mjs'
import { openVikingHome, readBridgeConfig } from './recall-openviking.mjs'
export { MAX_NOTES_PER_TURN, boundedNotes } from './memory-capture-hook.mjs'

export function bodyAtCaptureReader({ releaseRoot, home }) {
  let pluginSetDigest = null
  try { pluginSetDigest = readJsonStrict(`${releaseRoot}/.dsh-build/plugin-set.json`).setDigest ?? null } catch { /* a checkout has none */ }
  const base = { kind: 'genesis.kira-body.v1', observationClass: 'HOST_REPORTED_CAPTURE_CONTEXT_NOT_EXECUTION_ATTESTATION', instanceId: randomUUID(), release: basename(releaseRoot), pluginSetDigest }
  return () => {
    let codeHead = null
    try {
      const last = JSON.parse(readLinesIfPresent(`${home}/aura-code/aura.jsonl`).at(-1))
      // WITH ITS OPERATION AND COMMIT: between `code.change` (approved) and `code.become` the head names code this process is not running.
      if (Number.isInteger(last?.sequence)) codeHead = { sequence: last.sequence, hash: last.hash, operation: last.operation ?? null, commit: last.commit ?? null }
    } catch { /* no code chain in this home */ }
    return { ...base, codeHead }
  }
}

export function registerRememberedCapture(ctx, options = {}) {
  const { stateDir, sessionsRoot, policyOf } = options
  const logger = options.logger ?? ctx.logger
  if (typeof ctx.on !== 'function' || !stateDir || !sessionsRoot || typeof policyOf !== 'function') return () => {}
  const bootedAt = Date.now()
  const bodyNow = bodyAtCaptureReader({ releaseRoot: options.releaseRoot ?? fileURLToPath(new URL('../../..', import.meta.url)), home: sessionsRoot })
  const laneDoorRoot = dirname(dirname(stateDir))
  let fallback
  const memoryFor = async () => {
    if (options.memory) return typeof options.memory === 'function' ? options.memory() : options.memory
    const p = await policyOf()
    return fallback ??= createTrackedMemory({ stateDir, subject: p.subject, policyOf,
      config: options.config ?? readBridgeConfig(openVikingHome(stateDir)), fetch: options.fetch })
  }
  const capture = async (payload, recovery = false) => {
    try {
      const sessionId = sessionIdOfAgent(payload?.agent)
      if (!sessionId) return
      if (!recovery && (typeof ctx.sessions?.flush !== 'function' || await ctx.sessions.flush(payload.agent.session) !== true)) {
        logger?.warn?.('aukora-kira: capture deferred; session persistence did not confirm flush')
        return
      }
      setLaneDoorMessageIds(laneDoorMessageIds(laneDoorRoot))
      const read = readMemoryTurn({ stateRoot: sessionsRoot, sessionId, turn: payload.turn,
        beforeSeq: recovery ? payload.beforeSeq : undefined })
      if (!read) return
      const control = read.ask ? ownerControlIn(eventText(read.ask.event)) : null
      if (control && CONTROLS[control]?.stopsCapture) return
      const p = await policyOf()
      if (p?.privacy !== 'local' || p.offTheRecord || Object.entries(CONTROLS).some(([k,v]) => v.stopsCapture && p.controls?.[k])) return
      const memory = await memoryFor()
      let count = 0
      for (const source of [...(read.ask && isRealAsk(read.ask.event) ? [read.ask] : []), ...read.findings]) {
        const { event, line } = source
        const agentFinding = event.type === 'assistant/message'
        const parts = agentFinding ? event.data.message.content : event.data.content
        const text = typeof parts === 'string' ? parts : (parts ?? []).filter(part => part?.type === 'text').map(part => part.text).join('\n')
        if (!text?.trim()) continue
        const result = await memory.captureTurn({ sessionId, sessionTitle: payload.agent.session?.header?.title ?? 'auma',
          seq: event.seq, at: event.time, turn: read.turn ?? payload.turn ?? 0, text, canonicalEventLine: line },
          { ...p, attributedTo: agentFinding ? 'agent' : 'owner', scope: projectScopeOf(payload.agent) ?? 'owner',
            bodyAtCapture: !recovery && event.time >= bootedAt ? bodyNow() : null })
        count += result.remembered
        if (result.remembered) options.onRemembered?.({ sessionId, turn: read.turn, seq: event.seq, ...result })
      }
      return { previousSeq: read.boundarySeq ?? read.ask?.event.seq, count }
    } catch (error) { logger?.warn?.(`aukora-kira: capture failed (${String(error?.code ?? error?.name ?? 'error')})`) }
  }
  const stops = [ctx.on('agent/turn-stopping', capture)]
  // Native and in-process children append assistant/message before turn-stopping.
  // Codex, Claude Code and ACP do not run that loop: their common lifecycle emits subagent/end.
  // local=true is already captured from its session receipt; do not duplicate it from the lifecycle summary.
  const runs = new Map()
  stops.push(ctx.on('subagent/start', async info => {
    const parent = ctx.agents?.currentInitiator?.()
    const sessionId = sessionIdOfAgent(parent)
    const ask = sessionId ? readLastUserMessage({ stateRoot: sessionsRoot, sessionId }) : null
    runs.set(info.runId, { scope: projectScopeOf(parent) ?? 'owner', paused: Boolean(ask && ownerControlIn(eventText(ask.event))), at: Date.now() })
  }))
  stops.push(ctx.on('subagent/end', async info => {
    const run = runs.get(info.runId)
    runs.delete(info.runId)
    if (info.local || info.stopReason !== 'completed' || run?.paused) return
    const text = (info.lastAssistantMessage ?? []).filter(part => part?.type === 'text').map(part => part.text).join('\n')
    if (!text.trim()) return
    try {
      const result = await (await memoryFor()).remember({ text, from: `agent:${info.provider}`, scope: run?.scope ?? 'owner',
        migrationKey: `subagent:${info.id}:${info.runId}`, at: run?.at ?? Date.now(), bodyAtCapture: bodyNow(),
        source: { state: 'UNLINKED', cited: false, because: 'host subagent/end result; no local session event was claimed', runId: info.runId, agentId: info.id } })
      if (result.remembered) options.onRemembered?.({ sessionId: info.id, turn: info.runId, ...result })
    } catch (error) { logger?.warn?.(`aukora-kira: child capture failed (${String(error?.code ?? error?.name ?? 'error')})`) }
  }))
  const recovered = new Set()
  stops.push(ctx.on('agent/created', async ({ agent }) => {
    const scope = projectScopeOf(agent) ?? 'owner'
    if (recovered.has(scope)) return
    recovered.add(scope)
    try {
      for (const header of recentSessionHeaders(sessionsRoot).filter(header => (projectScopeOf({ session: { header } }) ?? 'owner') === scope).slice(0, 8)) {
        let beforeSeq
        for (let round = 0; round < 8; round++) {
          const result = await capture({ agent: { session: { id: header.id, header } }, beforeSeq }, true)
          if (!Number.isInteger(result?.previousSeq)) break
          beforeSeq = result.previousSeq
        }
      }
    } catch (error) { logger?.warn?.(`aukora-kira: capture recovery failed (${String(error?.name ?? 'error')})`) }
  }))
  return () => { for (const stop of stops) stop?.() }
}
