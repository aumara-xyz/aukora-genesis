/** Import-free public outcome classification for governed memory execution. */

export const AUKORA_MEMORY_REFUSED = 'AUKORA_MEMORY_REFUSED'
export const AUKORA_MEMORY_INDETERMINATE = 'AUKORA_MEMORY_INDETERMINATE'
export const SOURCE_OUTCOME_SETTLED = 'SETTLED'
export const SOURCE_OUTCOME_REFUSED = 'REFUSED'
export const SOURCE_OUTCOME_INDETERMINATE = 'INDETERMINATE'

/** Classify one ToolRuntime result without trusting a guest-supplied outcome. */
export function classifyMemoryToolResult(result) {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) return null
  if (typeof result.isError !== 'boolean' || !Array.isArray(result.content)) return null
  if (!result.isError) return Object.hasOwn(result, 'error') ? null : SOURCE_OUTCOME_SETTLED
  if (typeof result.error !== 'object' || result.error === null || Array.isArray(result.error)) return null
  if (typeof result.error.message !== 'string') return null
  const info = result.error.info
  if (info === undefined) return SOURCE_OUTCOME_INDETERMINATE
  if (typeof info !== 'object' || info === null || Array.isArray(info)) return null
  if (typeof info.name !== 'string' || typeof info.code !== 'string') return null
  return info.code === AUKORA_MEMORY_REFUSED
    ? SOURCE_OUTCOME_REFUSED
    : SOURCE_OUTCOME_INDETERMINATE
}
