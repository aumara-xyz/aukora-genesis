import { createServer } from 'node:net'
import { mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, vi } from 'vitest'
import { listenPrivateSocket } from './launchd-socket-listener.mjs'

const injection = vi.hoisted(() => ({ failStagingUnlink: false }))
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>()
  return { ...original, unlinkSync(path: Parameters<typeof original.unlinkSync>[0]) {
    if (injection.failStagingUnlink && basename(String(path)).startsWith('.p')) {
      injection.failStagingUnlink = false
      throw new Error('fixture staging unlink failed')
    }
    original.unlinkSync(path)
  } }
})

it.skipIf(process.platform === 'win32')('cleans both owned names after a publication cleanup failure, then reopens the same route', async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'review-publish-'))
  const socketPath = join(root, 'operator.sock')
  try {
    injection.failStagingUnlink = true
    await expect(listenPrivateSocket(createServer(), { socketPath, socketMode: 0o600 })).rejects.toThrow('fixture staging unlink failed')
    expect(readdirSync(root)).toEqual([])
    const listener = await listenPrivateSocket(createServer(), { socketPath, socketMode: 0o600 })
    expect(readdirSync(root)).toEqual(['operator.sock'])
    await listener.close()
    expect(readdirSync(root)).toEqual([])
  } finally {
    injection.failStagingUnlink = false
    rmSync(root, { recursive: true, force: true })
  }
})
