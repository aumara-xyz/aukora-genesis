/**
 * Laya's only moves are ASK and STOP, and the rank never falls.
 *
 * none (0) → ask (1) → stop (2). ask may repeat. stop may repeat.
 * stop → ask is laya:not-monotonic. allow, and every other word, is laya:not-stop-ask.
 * ASK and STOP are not executions. This module does not call the kernel.
 *
 * @module @aukora/effect-ir/laya
 */
export const LAYA_RANK = Object.freeze({ none: 0, ask: 1, stop: 2 })

/**
 * @param {unknown} prior
 * @param {unknown} move
 */
export function layaStep(prior, move) {
  const from = prior === undefined || prior === null ? 'none' : prior
  if (typeof from !== 'string' || !Object.hasOwn(LAYA_RANK, from)) {
    return Object.freeze({ ok: false, code: 'laya:not-stop-ask', verdict: 'REFUSE' })
  }
  if (move !== 'ask' && move !== 'stop') {
    return Object.freeze({ ok: false, code: 'laya:not-stop-ask', verdict: 'REFUSE' })
  }
  if (LAYA_RANK[move] < LAYA_RANK[from]) {
    return Object.freeze({ ok: false, code: 'laya:not-monotonic', verdict: 'REFUSE' })
  }
  return Object.freeze({ ok: true, code: `laya:${move}`, verdict: move === 'stop' ? 'STOP' : 'ASK', move })
}
