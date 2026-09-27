/**
 * The 8088 Loader smoke: compose the repository-owned inside-out profile the
 * way `dsh --profile 8088-inside-out` composes it — through the launcher's own
 * `loadProfile` over `package.json`'s `dsh.profile.bundles` plus
 * `cordis.patch.yml` — mount the result with the REAL app-boot include, and
 * prove the tool inventory is exactly the governed effect: no shell, no
 * filesystem writes, no dynamic code, no network, nothing.
 *
 * This deliberately does NOT feed a checked-in `cordis.yml` to
 * `mountRootInclude`. That filename is owned by the launcher, which rewrites it
 * to an empty entry list on every boot (`apps/cli/src/profile-boot.ts`,
 * `prepareProfile`), so a composition read from it would be a file the real
 * command destroys. The empty root here is the same empty root the launcher
 * writes; the composition arrives as patches, exactly as at launch.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadProfile, mountRootInclude } from '@deepseek-ai/dsh-app-boot'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import { buildOperation, GovernedMemory } from '../src/index.ts'

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const PROFILE_NAME = '8088-inside-out'
/** The `dsh` app manifest the launcher resolves bundle layers from; this profile declares none. */
const INSTALL_ANCHOR = join(REPO_ROOT, 'apps', 'cli', 'package.json')
/** The launcher's own profile root: an empty entry list every patch layer applies over. */
const EMPTY_ROOT = '[]\n'
/**
 * The mounted profile deliberately resolves package exports to built `lib/`.
 * The source-plane unit suite skips those four rows on a clean tree; the
 * live-dispatch court builds first and requires this file's exact 6/6 result,
 * so a missing artifact cannot grade that court green.
 */
const builtProfileArtifactsExist = [
  'packages/core/system-prompt/lib/index.js',
  'packages/core/tools/lib/index.js',
  'packages/interaction/user-approval/lib/index.js',
  'packages/governed/memory-put/lib/index.js',
].every(path => existsSync(join(REPO_ROOT, path)))

const roots: string[] = []

function fakeAgentForSmoke(): Agent {
  return {
    session: {
      events: [{ type: 'turn/start' }],
      append: (type: string, data: Record<string, unknown>) => ({ type, data }),
    },
  } as unknown as Agent
}

async function mountProfile(): Promise<Context> {
  // The repository is the Harness home for this repository-owned profile, so
  // `$DSH_HOME/profiles/8088-inside-out` is `profiles/8088-inside-out`.
  const profile = loadProfile('dsh', PROFILE_NAME, INSTALL_ANCHOR, REPO_ROOT)
  const patches = [...profile.layers.flatMap(layer => layer.patches), ...profile.patches]
  // The root is written outside the repository: mounting must never depend on,
  // or produce, a file in the profile directory that the launcher also owns.
  const root = mkdtempSync(join(tmpdir(), 'dsh-8088-root-'))
  roots.push(root)
  const rootConfig = join(root, 'cordis.yml')
  writeFileSync(rootConfig, EMPTY_ROOT)
  const ctx = new Context()
  await ctx.plugin(Loader)
  // Bare plugin names resolve from the repo root's node_modules (the profile's
  // plugins are declared there as workspace deps for exactly this reason).
  await mountRootInclude(ctx, rootConfig, patches, `${pathToFileURL(join(REPO_ROOT, 'node_modules')).href}/`)
  return ctx
}

describe('8088 inside-out profile through the real launcher composition', () => {
  it('composes from the profile manifest and patch layer, not from a launcher-owned cordis.yml', () => {
    const profile = loadProfile('dsh', PROFILE_NAME, INSTALL_ANCHOR, REPO_ROOT)
    // No bundle layers: dsh-base is deliberately not applied, so the 76-plugin
    // shared core (and its 26 ungoverned model-callable tools) never arrives.
    expect(profile.layers).toEqual([])
    expect(profile.patchPath).toBe(join(REPO_ROOT, 'profiles', PROFILE_NAME, 'cordis.patch.yml'))
    expect(profile.patches.length).toBeGreaterThan(0)
  })

  it.skipIf(!builtProfileArtifactsExist)('mounts and exposes exactly the governed tool inventory', async () => {
    const ctx = await mountProfile()
    const schemas = ctx.tools.schemas().map(t => t.name).sort()
    expect(schemas).toEqual(['memory.put'])
    const service = ctx.get('aukora.memory') as unknown as Record<string, unknown>
    expect(service).toBeDefined()
    expect(Object.hasOwn(service, 'config')).toBe(false)
  })

  it.skipIf(!builtProfileArtifactsExist)('composes no model provider, session, or agent loop', async () => {
    const ctx = await mountProfile()
    // Assert the governed services ARE up first, so this row cannot pass
    // vacuously on a tree that failed to compose at all.
    expect(ctx.get('tools')).toBeDefined()
    expect(ctx.get('aukora.memory')).toBeDefined()
    // This profile is a governed tool surface, not an agent application. The
    // launch command mounts it and idles; nothing here can call a model.
    for (const service of ['llm', 'session', 'agent']) {
      expect(ctx.get(service)).toBeUndefined()
    }
  })

  it.skipIf(!builtProfileArtifactsExist)('ungoverned consequential tools are absent, not silently allowed', async () => {
    const ctx = await mountProfile()
    for (const name of ['bash', 'terminal', 'str_replace_editor', 'view', 'run_code', 'web_search', 'subagent']) {
      const result = await ctx.tools.execute({
        signal: new AbortController().signal,
        callId: CallId(`probe-${name}`),
        name,
        arguments: {},
      }) as { isError: boolean; error?: { message?: string } }
      expect(result.isError).toBe(true)
      expect(String(result.error?.message)).toMatch(/unknown tool|not found/i)
    }
  })

  it.skipIf(!builtProfileArtifactsExist)('memory.put skips guest approval and fails closed when the parent broker is absent', async () => {
    const ctx = await mountProfile()
    let guestApprovalRequests = 0
    ctx.on('approval/request', async () => {
      guestApprovalRequests += 1
      return 'allowed-once'
    })
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('headless-deny'),
      name: 'memory.put',
      arguments: { key: 'k', value: 1 },
      agent: fakeAgentForSmoke(),
    }) as { isError: boolean; error?: { message?: string } }
    expect(result.isError).toBe(true)
    expect(guestApprovalRequests).toBe(0)
    expect(String(result.error?.message)).toMatch(/memory\.put refused: .*connect (?:ENOENT|ECONNREFUSED)/i)
  })

  it('clears process-local authorization state when its owner unloads', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(ApprovalService)
    let authority: ReturnType<typeof GovernedMemory> | undefined
    const owner = await ctx.plugin({
      name: 'authority-disposal-probe',
      inject: ['tools'],
      apply(inner) {
        authority = GovernedMemory(inner, { brokerSocket: '/not-contacted' })
      },
    })
    expect(authority).toBeDefined()
    const expiry = Math.floor(Date.now() / 1000) + 300
    const args = { key: 'dispose-probe', value: 1 }
    authority?.recordPending('dispose-probe', {
      agentKey: 'agent-probe',
      executionToken: Symbol('dispose-probe'),
      operation: buildOperation(args, expiry),
      args,
    })
    authority?.issueTicket({
      callId: 'dispose-probe',
      agentKey: 'agent-probe',
      operationDigest: '0'.repeat(64),
      expiry,
      grant: {
        toolName: 'memory.put',
        digest: '0'.repeat(64),
        nonce: 'nonce-probe',
        exp: expiry,
        definitionId: '0'.repeat(64),
        operationDigest: '0'.repeat(64),
        receiptKeyId: '0'.repeat(64),
        signature: `${'A'.repeat(86)}==`,
      },
    })
    expect(authority?.sizes()).toEqual({ pending: 1, tickets: 1 })

    await owner.dispose()

    expect(authority?.sizes()).toEqual({ pending: 0, tickets: 0 })
  })

  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true })
  })
})
