// Shared approval text for the gate, become and packaged desktop resolver.
// The gate additionally recomputes artifact/set digests and verifies the approval signature.
const malformed = detail => Object.assign(new Error(`plugin-set-record-malformed: ${detail}`),
  { code: 'plugin-set-record-malformed', reason: detail })

export function setOperationContent(record) {
  const { artifacts, setDigest, count } = record ?? {}
  const hex = value => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value)
  if (record?.kind !== 'aukora-plugin-set/v1' || !hex(setDigest)
    || !artifacts || typeof artifacts !== 'object' || Array.isArray(artifacts)
    || count !== Object.keys(artifacts).length || Object.entries(artifacts).some(([id, artifact]) =>
      artifact?.id !== id || !hex(artifact.digest) || !artifact.files || typeof artifact.files !== 'object'
      || Array.isArray(artifact.files) || !Object.hasOwn(artifact.files, artifact.entry)
      || !Object.values(artifact.files).every(hex))) throw malformed('malformed plugin set')
  const files = new Set(Object.values(artifacts).flatMap((artifact) => Object.keys(artifact.files)))
  const ids = Object.keys(artifacts).sort()
  // Keep existing plugin-only receipts valid during the release-binding migration.
  if (record.release === undefined) {
    const width = Math.max(...ids.map(id => id.length))
    return [
      'AUKORA: ADMIT THESE PLUGINS',
      'Approve lets exactly these plugin bytes load. A changed, added or',
      'unrecorded file in them is refused when Node loads it.',
      `set ${setDigest}`,
      `${String(count)} plugins, ${String(files.size)} files, sha256 each:`,
      ...ids.map(id => `${id.padEnd(width)} ${String(Object.keys(artifacts[id].files).length).padStart(4)} ${artifacts[id].digest.slice(0, 16)}`),
      'Not covered: node_modules, the gate bootstrap, workers.',
      '',
    ].join('\n')
  }
  // Release binding (scripts/aukora/release-digest.mjs): cutover coverage, with the exclusions stated below.
  const release = record.release
  if (release !== undefined && (release === null || typeof release !== 'object' || !/^[0-9a-f]{40}$/u.test(release.commit)
    || !/^[0-9a-f]{64}$/u.test(release.tree) || !/^[0-9a-f]{64}$/u.test(release.shell) || !Number.isSafeInteger(release.files) || release.files < 0)) {
    throw malformed('the plugin set record carries a malformed release binding')
  }
  return [
    release ? 'AUKORA: LOAD THIS RELEASE' : 'AUKORA: ADMIT THESE PLUGINS',
    ...(release ? [
      `commit ${release.commit}`,
      `release ${release.tree} (${String(release.files)} files)`,
      `shell ${release.shell}`,
      'Release and shell covered at cutover; not rechecked each boot or later read.',
      'Excluded: .dsh-build/plugin-set.json (self-reference), non-executable Finder .DS_Store files; external state/tools; external symlink targets.',
    ] : []),
    'Plugin bytes checked at gate install and imports through its hook.',
    'Gate bootstrap/workers recorded; not import-gated in their own loaders.',
    `set ${setDigest}`,
    `${String(count)} plugins, ${String(files.size)} files, sha256 each:`,
    ...ids.map((id) => `${id} ${String(Object.keys(artifacts[id].files).length)} ${artifacts[id].digest.slice(0, 16)}`),
    ...(release ? [] : ['Outside plugin set: bare dependencies, apps/cli, shell (unless release-bound).']),
    '',
  ].join('\n')
}
