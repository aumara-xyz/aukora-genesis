import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

/** Absolute root of the application source copied into this package. */
export const VENDOR_ROOT = fileURLToPath(new URL('../vendor/', import.meta.url))

/** Absolute root of the repository-owned Auma Live voice sidecar. */
export const AUMA_LIVE_VOICE_ROOT = join(VENDOR_ROOT, 'auma-live', 'voice')
