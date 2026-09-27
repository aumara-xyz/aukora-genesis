import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  APPROVAL_ARTIFACT_DOMAIN,
  APPROVAL_ARTIFACT_FIELDS,
  approvalArtifactDigest,
  createApprovalArtifact,
  parseApprovalArtifact,
  verifyApprovalArtifact,
  type ApprovalArtifact,
  type ApprovalArguments,
} from '../aukora/approval/artifact.mjs'
import { renderApprovalArtifact } from '../aukora/approval/render.mjs'
import { definitionDigest, WORKSPACE_PATCH } from '../aukora/broker/effect-definition.mjs'
import { buildOperation } from '../aukora/broker/operation.mjs'
import { reviewProjectionLines } from '../aukora/broker/review.mjs'
import type { WorkspacePatchArgs } from '../aukora/broker/workspace-patch-args.mjs'
import { canonicalJSON } from '../aukora/kernel-seed/canonical-json.mjs'

const context = {
  expiry: 1_900_000_000,
  activationDigest: 'a1'.repeat(32),
  occurrenceId: 'c3'.repeat(16),
  rendererId: 'b2'.repeat(32),
}
const args = (): WorkspacePatchArgs => ({
  workspace: 'project',
  path: 'src/message.txt',
  beforeSha256: 'd4'.repeat(32),
  content: 'hello\n世界 🦋\u001b[31m\u202e\\tail\n',
})
const artifact = (operationArguments: WorkspacePatchArgs = args()) => createApprovalArtifact({
  ...context,
  toolName: WORKSPACE_PATCH,
  operationArguments,
})
const wire = (source: ApprovalArtifact<ApprovalArguments> = artifact()): Record<string, unknown> => ({
  ...source,
  operationArguments: { ...source.operationArguments },
  semanticProjection: [...source.semanticProjection],
})

describe('workspace approval uses the existing artifact', () => {
  it('retains the memory artifact digest and projection bytes', () => {
    const memory = createApprovalArtifact({
      ...context,
      operationArguments: { key: 'notes.alpha', value: { note: 'one' } },
    })
    expect(approvalArtifactDigest(memory)).toBe('fb3118f841be0ad5ca2af5c32dd6f2377dd31b7abb4ca7ffa72989653aa7ab7e')
    expect(memory.semanticProjection).toHaveLength(9)
    expect(memory.semanticProjection[0]).toBe('tool: memory.put')
    expect(renderApprovalArtifact(memory, 'e5'.repeat(8))).toContain('MEMORY.WRITE - approve this exact operation')
    expect(memory.operationDigest).toBe('f8d6b3431539b40a8efdf9bab8b76fa35caac8c427b46c6ac0f829db8574ad56')
  })

  it('binds the destination, prior digest, and complete reversible replacement bytes', () => {
    const source = args()
    const built = artifact(source)
    expect(Object.keys(built)).toEqual(APPROVAL_ARTIFACT_FIELDS)
    expect(built.operationArguments).toEqual(source)
    expect(built.definitionId).toBe(definitionDigest(WORKSPACE_PATCH))
    expect(built.operationCanonicalBytes).toBe(canonicalJSON(buildOperation(source, context.expiry, WORKSPACE_PATCH)))
    const lines = built.semanticProjection
    expect(lines).toContain('workspace: project')
    expect(lines).toContain('path: src/message.txt')
    expect(lines).toContain(`beforeSha256: ${source.beforeSha256}`)
    const contentLine = lines.find(line => line.startsWith('contentUtf8: '))
    expect(contentLine).toBeDefined()
    const decoded: unknown = JSON.parse(contentLine!.slice('contentUtf8: '.length))
    expect(decoded).toBe(source.content)
    expect(lines).toContain(`bytes: ${Buffer.byteLength(source.content, 'utf8')}`)
    expect(lines).toContain(`contentSha256: ${createHash('sha256').update(source.content, 'utf8').digest('hex')}`)
    expect(lines.every(line => /^[\x20-\x7e]*$/.test(line))).toBe(true)
    expect(renderApprovalArtifact(built, 'e5'.repeat(8))).toContain(contentLine)
    expect(renderApprovalArtifact(built, 'e5'.repeat(8))).toContain('WORKSPACE.PATCH - approve this exact operation')
    expect(verifyApprovalArtifact(wire(built), approvalArtifactDigest(built))).toEqual(built)
    expect(Object.isFrozen(built.operationArguments)).toBe(true)
  })

  it('distinguishes create-only from replacement with a prior digest', () => {
    const built = artifact({ ...args(), beforeSha256: null })
    expect(built.operationArguments.beforeSha256).toBeNull()
    expect(built.semanticProjection).toContain('beforeSha256: null (create only)')
    expect(approvalArtifactDigest(built)).not.toBe(approvalArtifactDigest(artifact()))
  })

  it('hashes all workspace argument fields without dropping them in a copy', () => {
    const built = artifact()
    const digest = createHash('sha256')
      .update(`${APPROVAL_ARTIFACT_DOMAIN} ${canonicalJSON(wire(built))}`, 'utf8').digest('hex')
    expect(approvalArtifactDigest(built)).toBe(digest)
    const variants: WorkspacePatchArgs[] = [
      { ...args(), workspace: 'other' },
      { ...args(), path: 'src/other.txt' },
      { ...args(), beforeSha256: 'e5'.repeat(32) },
      { ...args(), content: `${args().content}x` },
    ]
    for (const changed of variants) {
      expect(approvalArtifactDigest({ ...built, operationArguments: changed })).not.toBe(digest)
      expect(() => parseApprovalArtifact({ ...wire(built), operationArguments: changed }))
        .toThrow('approval:operation-bytes-mismatch')
    }
  })

  it('refuses unregistered definitions and cross-effect argument substitution', () => {
    expect(() => parseApprovalArtifact({ ...wire(), definitionId: '00'.repeat(32) }))
      .toThrow('approval:definition-mismatch')
    expect(() => parseApprovalArtifact({ ...wire(), definitionId: definitionDigest('memory.put') }))
      .toThrow('approval:arguments-not-exact')
    expect(() => { Reflect.apply(createApprovalArtifact, undefined, [{ ...context, toolName: 'bash', operationArguments: args() }]) })
      .toThrow('approval:definition-mismatch')
    expect(() => { Reflect.apply(createApprovalArtifact, undefined, [{ ...context, operationArguments: args() }]) })
      .toThrow('approval:arguments-not-exact')
  })

  it('refuses a substituted canonical operation even if its own digest is updated', () => {
    const built = artifact()
    const canonical = built.operationCanonicalBytes.replace('workspace.patch', 'memory.put')
    expect(canonical).not.toBe(built.operationCanonicalBytes)
    expect(() => parseApprovalArtifact({
      ...wire(built),
      operationCanonicalBytes: canonical,
      operationDigest: createHash('sha256').update(canonical, 'utf8').digest('hex'),
    })).toThrow('approval:operation-bytes-mismatch')
  })

  it('refuses extra fields, missing bytes, and accessor arguments without evaluating them', () => {
    let calls = 0
    const accessor = { ...args() }
    Object.defineProperty(accessor, 'content', { enumerable: true, get() { calls += 1; return 'substituted' } })
    const missing: Partial<WorkspacePatchArgs> = { ...args() }
    delete missing.content
    for (const operationArguments of [
      { ...args(), extra: true },
      missing,
      accessor,
      new Proxy(args(), {}),
      { ...args(), beforeSha256: 'not-a-digest' },
      { ...args(), path: '../outside.txt' },
    ]) {
      expect(() => parseApprovalArtifact({ ...wire(), operationArguments })).toThrow('approval:arguments-not-exact')
    }
    expect(calls).toBe(0)
  })

  it('refuses missing or substituted visible bytes', () => {
    const built = artifact()
    const absent = built.semanticProjection.filter(line => !line.startsWith('contentUtf8: '))
    const changed = built.semanticProjection.map(line => line.startsWith('contentUtf8: ') ? 'contentUtf8: "other"' : line)
    for (const semanticProjection of [absent, changed]) {
      expect(() => parseApprovalArtifact({ ...wire(built), semanticProjection }))
        .toThrow('approval:projection-mismatch')
    }
  })

  it('rejects an oversized display instead of approving a truncated representation', () => {
    const source = { ...args(), content: 'x'.repeat(5000) }
    const projection = reviewProjectionLines(buildOperation(source, context.expiry, WORKSPACE_PATCH), source)
    expect(projection).toContain(`contentUtf8: ${JSON.stringify(source.content)}`)
    expect(() => artifact(source)).toThrow('approval:display-text-invalid')
  })
})
