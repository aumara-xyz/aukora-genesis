import { valueMap } from '@deepseek-ai/cosmokit'

let jsExpressionsRefused = false

const jsExpressionsRefusedMessage = 'loader:governed-composition-refuses-executable-config'

/**
 * Refuse later `!!js` evaluation and return the sole reset capability.
 * @returns A one-use reset closure available only to the first arming caller.
 * @throws Error `loader:executable-config-refusal-already-armed` after refusal is armed.
 */
export function refuseJsExpressions(): () => void {
  if (jsExpressionsRefused) throw new Error('loader:executable-config-refusal-already-armed')
  jsExpressionsRefused = true
  let active = true
  return () => {
    if (!active) return
    active = false
    jsExpressionsRefused = false
  }
}

/** Return whether this Loader module instance currently refuses `!!js` evaluation. */
export function areJsExpressionsRefused(): boolean {
  return jsExpressionsRefused
}

// eslint-disable-next-line no-new-func
const rawEvaluate = new Function('ctx', 'expr', `
  with (ctx) {
    return eval(expr)
  }
`) as ((ctx: object, expr: string) => any)

/**
 * Evaluate a JavaScript expression against a loader context scope.
 * @param ctx - Loader context whose properties scope the expression.
 * @param expr - Expression source evaluated with `ctx` in scope.
 * @returns The expression result.
 * @throws Error `loader:governed-composition-refuses-executable-config` while refusal is armed.
 */
export function evaluate(ctx: object, expr: string): any {
  if (jsExpressionsRefused) throw new Error(jsExpressionsRefusedMessage)
  return rawEvaluate(ctx, expr)
}

/**
 * Recursively replace YAML `!!js` expression nodes with evaluated values.
 * @param ctx - Loader context whose properties scope the expressions.
 * @param value - Configuration node possibly containing `__jsExpr` leaves.
 * @returns The fully evaluated configuration value.
 * @throws Error `loader:governed-composition-refuses-executable-config` while refusal is armed.
 */
export function interpolate(ctx: object, value: any) {
  if (isJsExpr(value)) {
    if (jsExpressionsRefused) throw new Error(jsExpressionsRefusedMessage)
    return evaluate(ctx, value.__jsExpr)
  } else if (!value || typeof value !== 'object') {
    return value
  } else if (Array.isArray(value)) {
    return value.map(item => interpolate(ctx, item))
  } else {
    return valueMap(value, item => interpolate(ctx, item))
  }
}

/** Return true when a value is a serialized loader JavaScript expression. */
export function isJsExpr(value: any): value is JsExpr {
  return value instanceof Object && '__jsExpr' in value
}

/** Serialized JavaScript expression produced by the include YAML tag. */
export interface JsExpr {
  __jsExpr: string
}
