#!/usr/bin/env node
/** Parent-staged Web guest for the same-UID governed source assembly. */
import { refuseExecutableConfig } from '@deepseek-ai/dsh-app-boot'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { prepareProfile, runProfile } from '../../apps/cli/src/profile-boot.ts'
import { createParentDisconnectLatch, GUEST_READY_TYPE } from './developer-protocol.mjs'

const PROFILE_NAME = 'aukora-web'
const PORT = /^(?:0|[1-9][0-9]{0,4})$/u

/** The staging principal prepares files; the launched guest only reads them. */
async function main() {
  if (process.argv.length === 3 && process.argv[2] === '--prepare') {
    const home = process.env.DSH_HOME
    if (typeof home !== 'string' || home.length === 0) throw new Error('supervisor:guest-profile-home-required')
    prepareProfile(PROFILE_NAME)
    return
  }
  if (process.argv.length !== 2) throw new Error('supervisor:guest-arguments-not-exact')
  if (typeof process.send !== 'function') throw new Error('supervisor:guest-parent-channel-required')
  const parentDisconnect = createParentDisconnectLatch(process)

  const port = process.env.AUKORA_WEB_PORT
  if (typeof port !== 'string' || !PORT.test(port) || Number(port) > 65535) {
    throw new Error('supervisor:aukora-web-port-required')
  }
  const presetRoot = process.env.AUKORA_PRESET_ROOT
  if (typeof presetRoot !== 'string' || presetRoot.length === 0) {
    throw new Error('supervisor:aukora-preset-root-required')
  }

  refuseExecutableConfig()
  const environmentValues = Object.fromEntries(
    Object.entries(process.env).filter((entry) => typeof entry[1] === 'string'),
  )
  const running = await runProfile({
    environment: createLaunchEnvironmentSnapshot([{ source: 'process', values: environmentValues }]),
    profile: PROFILE_NAME,
    patchFiles: process.env.AUKORA_CAPSULE_PATCH === undefined ? [] : [process.env.AUKORA_CAPSULE_PATCH],
    args: ['--host', '127.0.0.1', '--port', port, '--no-open'],
    hmrDisposition: 'declined-at-launch',
    profilePreparation: 'read-only',
    systemPresetRoot: presetRoot,
  })
  parentDisconnect.attach(() => { running.shutdown.interrupt(1) })

  await send({
    type: GUEST_READY_TYPE,
    profile: PROFILE_NAME,
    governed: true,
    environmentKeys: Object.keys(environmentValues).sort(),
    // The guest's GLOBAL registry, read from the running process rather than
    // from a profile file. Agent-session tools are deliberately not here: the
    // `aukora` preset registers `kira.stage` and `kira.recall` in an agent scope,
    // and `kira.recall` refuses without an owning session. Reporting this as the
    // session catalog would overstate what a booted guest has mounted.
    globalTools: running.ctx.tools.schemas().map(schema => schema.name).sort(),
    pid: process.pid,
  })
}

await main()

/** Send one record over the direct parent channel. */
function send(message) {
  return new Promise((resolve, reject) => {
    const sender = process.send
    if (sender === undefined) {
      reject(new Error('supervisor:guest-parent-channel-unavailable'))
      return
    }
    sender.call(process, message, error => error === null || error === undefined ? resolve() : reject(error))
  })
}
