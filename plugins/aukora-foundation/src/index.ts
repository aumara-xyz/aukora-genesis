/**
 * Host plugin body — this package contributes browser presentation only.
 *
 * The node half must exist because the client module system discovers a
 * browser bundle through a live Loader row: `dsh.client.platform === 'web'`
 * plus an `exports["./client"]` entry are read from this package's manifest.
 * Rendering happens entirely in the client half.
 */
export function apply(): void {}
