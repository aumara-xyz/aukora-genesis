/** Resolve the installed memory location without copying any credentials. Explicit arguments are preferred for scratch use. */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readTextStrict } from './strict-read.mjs'
import { openVikingHome, readBridgeConfig } from './recall-openviking.mjs'
export function memoryDeployment({ stateDir, subject, supportRoot, config, installed = false } = {}) {
  if ((!stateDir || !subject) && installed) {
    const overlay = readTextStrict(join(supportRoot ?? process.env.AUKORA_STATE ?? join(homedir(), 'Library/Application Support/AUKORA'), 'kira-deployment-overlay.patch.yml'))
    const field = name => overlay.match(new RegExp(`^\\s+${name}:\\s+(.+?)\\s*$`, 'm'))?.[1]?.replace(/^['"]|['"]$/gu, '')
    stateDir ??= field('stateDir'); subject ??= field('subject')
  }
  if (!stateDir?.startsWith('/') || !subject) throw new Error('memory deployment requires explicit stateDir and subject, or --installed')
  return { stateDir, subject, config: config ?? readBridgeConfig(openVikingHome(stateDir)) }
}
export function deploymentArgs(argv) {
  const get = flag => { const at = argv.indexOf(flag); return at < 0 ? undefined : argv[at + 1] }
  return memoryDeployment({ stateDir: get('--state-dir'), subject: get('--subject'), supportRoot: get('--support-root'), installed: argv.includes('--installed') })
}
