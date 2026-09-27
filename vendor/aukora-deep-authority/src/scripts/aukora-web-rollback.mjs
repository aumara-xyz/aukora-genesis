#!/usr/bin/env node
/** Apply one unexpired owner-preauthorized activation rollback; never starts or stops services. */
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { beginWebActivationRollback } from '../aukora/broker/web-activation-upgrade.mjs'
import { MAX_WEB_ROLLBACK_BUNDLE_BYTES } from '../aukora/activation/web-rollback-record.mjs'

function readBundle(path) {
  if (!isAbsolute(path) || resolve(path) !== path || realpathSync(path) !== path) throw new Error('rollback:bundle-path-invalid')
  const before = lstatSync(path, { bigint: true })
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.uid !== BigInt(process.geteuid())
    || (before.mode & 0o7777n) !== 0o600n || before.size > BigInt(MAX_WEB_ROLLBACK_BUNDLE_BYTES)) throw new Error('rollback:bundle-not-private-regular')
  const file = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const matches = value => value.dev === before.dev && value.ino === before.ino && value.size === before.size
      && value.mode === before.mode && value.uid === before.uid && value.nlink === before.nlink
      && value.mtimeNs === before.mtimeNs && value.ctimeNs === before.ctimeNs
    if (!matches(fstatSync(file, { bigint: true }))) throw new Error('rollback:bundle-changed')
    const bytes = Buffer.alloc(Number(before.size) + 1)
    let length = 0
    while (length < bytes.length) {
      const count = readSync(file, bytes, length, bytes.length - length)
      if (count === 0) break
      length += count
    }
    if (length !== Number(before.size) || !matches(fstatSync(file, { bigint: true }))
      || !matches(lstatSync(path, { bigint: true }))) throw new Error('rollback:bundle-changed')
    return JSON.parse(bytes.subarray(0, length).toString('utf8'))
  } finally { closeSync(file) }
}

let session
try {
  const args = process.argv.slice(2)
  if (args.length !== 4 || args[0] !== '--data-dir' || args[2] !== '--bundle'
    || !isAbsolute(args[1]) || resolve(args[1]) !== args[1] || realpathSync(args[1]) !== args[1]) {
    throw new Error('usage: node scripts/aukora-web-rollback.mjs --data-dir ABSOLUTE_DATA --bundle ABSOLUTE_FILE')
  }
  session = beginWebActivationRollback(join(args[1], 'broker-state'), readBundle(args[3]))
  process.stdout.write(`${JSON.stringify(session.commit())}\n`)
} catch (error) {
  process.stderr.write(`${String(error?.message ?? error)}\n`)
  process.exitCode = 1
} finally { session?.close() }
