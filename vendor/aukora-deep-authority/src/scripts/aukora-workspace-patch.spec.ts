import { createHash } from 'node:crypto'
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  isExactWorkspacePatchArgs,
  MAX_WORKSPACE_PATCH_BYTES,
  preflightWorkspacePatch,
  workspacePatch,
  workspacePatchBody,
  type WorkspacePatchArgs,
} from '../aukora/broker/workspace-patch.mjs'

const scratchDirectories: string[] = []
const digest = (content: string | Buffer): string => createHash('sha256').update(content).digest('hex')

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'aukora-workspace-patch-')))
  scratchDirectories.push(root)
  const workspace = join(root, 'workspace')
  const outside = join(root, 'outside')
  mkdirSync(workspace)
  mkdirSync(outside)
  return { root, workspace, outside, roots: { project: workspace } }
}

function args(changes: Partial<WorkspacePatchArgs> = {}): WorkspacePatchArgs {
  return { workspace: 'project', path: 'note.txt', beforeSha256: null, content: 'One exact sentence.\n', ...changes }
}

afterEach(() => {
  for (const path of scratchDirectories.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('workspace.patch exact arguments', () => {
  it('preserves text bytes and accepts frozen or null-prototype data records', () => {
    const input = args({ content: '初めて 🦋\r\n' })
    expect(isExactWorkspacePatchArgs(Object.freeze(input))).toBe(true)
    expect(isExactWorkspacePatchArgs(Object.assign(Object.create(null), input))).toBe(true)
    expect(workspacePatchBody(input)).toBe(input.content)
  })

  it('rejects getters and hidden riders without invoking them', () => {
    let calls = 0
    const accessor = { ...args(), get content() { calls++; return 'not captured' } }
    expect(isExactWorkspacePatchArgs(accessor)).toBe(false)
    expect(calls).toBe(0)
    expect(isExactWorkspacePatchArgs({ ...args(), extra: true })).toBe(false)
    expect(isExactWorkspacePatchArgs(Object.defineProperty(args(), 'hidden', { value: true }))).toBe(false)
    expect(isExactWorkspacePatchArgs({ ...args(), [Symbol('hidden')]: true })).toBe(false)
    expect(isExactWorkspacePatchArgs(Object.create(args()))).toBe(false)
  })

  it.each([
    '', '/note.txt', '../note.txt', 'nested/../note.txt', 'nested/./note.txt',
    'nested//note.txt', 'nested\\note.txt', '.git/config', '.Git/config', 'nested/.git/index',
    'C:note.txt', 'note.txt/', 'note.txt.', 'CON', 'com1.txt', 'nul.json', 'note\n.txt',
  ])('rejects non-portable or repository-control path %j', (path) => {
    expect(isExactWorkspacePatchArgs(args({ path }))).toBe(false)
    expect(() => workspacePatchBody(args({ path }))).toThrow('workspace.patch:arguments-not-exact')
  })

  it('bounds UTF-8 bytes rather than UTF-16 length and refuses lossy surrogate encoding', () => {
    expect(isExactWorkspacePatchArgs(args({ content: 'x'.repeat(MAX_WORKSPACE_PATCH_BYTES) }))).toBe(true)
    expect(isExactWorkspacePatchArgs(args({ content: 'x'.repeat(MAX_WORKSPACE_PATCH_BYTES + 1) }))).toBe(false)
    expect(isExactWorkspacePatchArgs(args({ content: '🦋'.repeat(MAX_WORKSPACE_PATCH_BYTES / 4 + 1) }))).toBe(false)
    expect(isExactWorkspacePatchArgs(args({ content: '\ud800' }))).toBe(false)
    expect(isExactWorkspacePatchArgs(args({ beforeSha256: 'A'.repeat(64) }))).toBe(false)
    expect(isExactWorkspacePatchArgs(args({ workspace: '../outside' }))).toBe(false)
  })

  it('keeps the full workspace resource within the v5 256-byte authorization limit', () => {
    const prefixBytes = Buffer.byteLength('workspace:file:project:')
    const first = 'a'.repeat(128)
    const last = 'b'.repeat(256 - prefixBytes - first.length - 1)
    expect(isExactWorkspacePatchArgs(args({ path: `${first}/${last}` }))).toBe(true)
    expect(isExactWorkspacePatchArgs(args({ path: `${first}/${last}b` }))).toBe(false)
  })
})

describe('bounded workspace file publication', () => {
  it('preflights without writes and creates exact content with fresh evidence', () => {
    const { workspace, roots } = fixture()
    mkdirSync(join(workspace, 'notes'))
    const input = args({ path: 'notes/first.txt', content: '初めて 🦋\r\n' })
    const before = preflightWorkspacePatch(roots, input)
    expect(before).toEqual({
      path: join(workspace, input.path), bytes: Buffer.byteLength(input.content), contentSha256: digest(input.content),
    })
    expect(readdirSync(join(workspace, 'notes'))).toEqual([])
    const result = workspacePatch(roots, input)
    expect(readFileSync(result.path)).toEqual(Buffer.from(input.content))
    expect(result).toEqual({
      ...before,
      inode: Number(lstatSync(result.path, { bigint: true }).ino),
      mtimeNs: String(lstatSync(result.path, { bigint: true }).mtimeNs),
    })
    if (process.platform !== 'win32') expect(lstatSync(result.path).mode & 0o777).toBe(0o600)
    expect(readdirSync(join(workspace, 'notes'))).toEqual(['first.txt'])
  })

  it('replaces an exact prior digest and removes execute permission', () => {
    const { workspace, roots } = fixture()
    const path = join(workspace, 'note.txt')
    writeFileSync(path, 'before\n')
    chmodSync(path, 0o755)
    const input = args({ beforeSha256: digest('before\n'), content: 'after\n' })
    const result = workspacePatch(roots, input)
    expect(readFileSync(path, 'utf8')).toBe('after\n')
    expect(result.contentSha256).toBe(digest('after\n'))
    if (process.platform !== 'win32') expect(lstatSync(path).mode & 0o777).toBe(0o600)
    expect(readdirSync(workspace)).toEqual(['note.txt'])
  })

  it('refuses a stale digest or create-over-existing without changing retained bytes', () => {
    const { workspace, roots } = fixture()
    const path = join(workspace, 'note.txt')
    writeFileSync(path, 'current\n', { mode: 0o640 })
    const before = readFileSync(path)
    const beforeStat = lstatSync(path)
    for (const beforeSha256 of [null, digest('stale\n')]) {
      expect(() => preflightWorkspacePatch(roots, args({ beforeSha256 }))).toThrow('workspace.patch:preimage-mismatch')
      expect(() => workspacePatch(roots, args({ beforeSha256 }))).toThrow('workspace.patch:preimage-mismatch')
      expect(readFileSync(path)).toEqual(before)
      expect(lstatSync(path).ino).toBe(beforeStat.ino)
      expect(lstatSync(path).mode).toBe(beforeStat.mode)
      expect(readdirSync(workspace)).toEqual(['note.txt'])
    }
  })

  it('refuses replace-of-missing, unconfigured roots, and absent parents without creating directories', () => {
    const { workspace, roots, outside } = fixture()
    const inheritedRoots = Object.create(roots) as Record<string, string>
    expect(() => workspacePatch(roots, args({ beforeSha256: digest('absent') }))).toThrow('workspace.patch:preimage-mismatch')
    expect(() => workspacePatch(roots, args({ workspace: 'outside' }))).toThrow('workspace.patch:workspace-not-configured')
    expect(() => workspacePatch(inheritedRoots, args())).toThrow('workspace.patch:workspace-not-configured')
    expect(() => workspacePatch(roots, args({ path: 'absent/note.txt' }))).toThrow('workspace.patch:parent-unavailable')
    expect(readdirSync(workspace)).toEqual([])
    expect(readdirSync(outside)).toEqual([])
  })

  it('refuses noncanonical roots and directories as file targets', () => {
    const { workspace, roots } = fixture()
    expect(() => workspacePatch({ project: `${workspace}/.` }, args())).toThrow('workspace.patch:workspace-not-canonical')
    expect(() => workspacePatch({ project: 'relative' }, args())).toThrow('workspace.patch:workspace-not-canonical')
    mkdirSync(join(workspace, 'note.txt'))
    expect(() => workspacePatch(roots, args())).toThrow('workspace.patch:target-not-file')
    expect(readdirSync(workspace)).toEqual(['note.txt'])
  })

  it.skipIf(process.platform === 'win32')('refuses target, parent, root, and above-root symlinks without touching outside bytes', () => {
    const { root, workspace, outside, roots } = fixture()
    const outsideFile = join(outside, 'note.txt')
    writeFileSync(outsideFile, 'outside bytes\n')
    symlinkSync(outsideFile, join(workspace, 'note.txt'))
    expect(() => workspacePatch(roots, args({ beforeSha256: digest('outside bytes\n') }))).toThrow('workspace.patch:target-not-file')
    symlinkSync(outside, join(workspace, 'nested'))
    expect(() => workspacePatch(roots, args({ path: 'nested/another.txt' }))).toThrow('workspace.patch:parent-not-directory')
    symlinkSync(workspace, join(root, 'linked-root'))
    expect(() => workspacePatch({ project: join(root, 'linked-root') }, args())).toThrow('workspace.patch:workspace-not-canonical')
    symlinkSync(root, join(root, 'linked-parent'))
    expect(() => workspacePatch({ project: join(root, 'linked-parent', 'workspace') }, args())).toThrow('workspace.patch:workspace-not-canonical')
    expect(readFileSync(outsideFile, 'utf8')).toBe('outside bytes\n')
    expect(readdirSync(outside)).toEqual(['note.txt'])
    expect(readdirSync(workspace).sort()).toEqual(['nested', 'note.txt'])
  })

  it.skipIf(process.platform === 'win32')('does not interpret a dangling target symlink as absence', () => {
    const { workspace, outside, roots } = fixture()
    symlinkSync(join(outside, 'missing.txt'), join(workspace, 'note.txt'))
    expect(() => workspacePatch(roots, args())).toThrow('workspace.patch:target-not-file')
    expect(lstatSync(join(workspace, 'note.txt')).isSymbolicLink()).toBe(true)
    expect(existsSync(join(outside, 'missing.txt'))).toBe(false)
  })

  it('refuses oversized existing files without reading or replacing unbounded contents', () => {
    const { workspace, roots } = fixture()
    const body = Buffer.alloc(MAX_WORKSPACE_PATCH_BYTES + 1, 42)
    const path = join(workspace, 'note.txt')
    writeFileSync(path, body)
    expect(() => workspacePatch(roots, args({ beforeSha256: digest(body) }))).toThrow('workspace.patch:existing-file-too-large')
    expect(readFileSync(path)).toEqual(body)
    expect(readdirSync(workspace)).toEqual(['note.txt'])
  })
})
