#!/usr/bin/env node
import { closeSync, constants, openSync } from 'node:fs'
import { readOwnerDaemonConfig } from '../../apps/aukora-desktop/aumlok-airlock-config.mjs'

// Run as Peter after the admin ceremony. Opening is enough: never read key bytes.
try {
  const config = readOwnerDaemonConfig()
  if (!config || process.getuid() !== config.callerUid || process.geteuid() !== config.callerUid
    || config.ownerUid === config.callerUid) throw new Error('caller-or-config')
  let denied = false
  try {
    const fd = openSync(config.keyPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    closeSync(fd)
  } catch (error) {
    if (error.code === 'EACCES') denied = true
    else throw error
  }
  if (!denied) throw new Error('key-readable')
  console.log(`VERIFIED EACCES: configured key path cannot be opened by UID ${process.getuid()}`)
  console.log('NOT VERIFIED: key existence, daemon service, popup consent, installed app, and rollback protection')
} catch {
  console.log('SAME_UID: separate custody is NOT VERIFIED (requires EACCES as the configured caller)')
  process.exitCode = 1
}
