/**
 * Focused tests for aukora-authority-inventory.
 *
 * Verifies deterministic ordering, derivation of source and graph from pinned Git revisions,
 * separation of source from installed dependency snapshots and runtime/OS, harmless disposable
 * regressions (differing commit comments and uncommitted edits), honest refusal on missing source
 * or dirty working tree when required, non-claim assertions (no complete TCB, no security score),
 * and CLI execution modes.
 */

import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { canonicalJSON } from '../aukora/kernel-seed/canonical-json.mjs'
import {
  AuthorityInventoryError,
  authoritySourceInventory,
  EXCLUDED_TRUST_COMPONENTS,
  formatInventoryReport,
  FROZEN_VERIFIER_SHA256,
  INVENTORY_DOMAIN,
  INVENTORY_REFUSE,
  VERIFIER_GRAPH_FORMAT,
} from './aukora-authority-inventory.mjs'
import { pinnedGitEnv, REPO_DIR, resolvePinnedRevision } from './launchd-operator-seat-files.mjs'

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')

describe('aukora-authority-inventory', () => {
  it('generates a conforming inventory matching the frozen graph digest', () => {
    const inventory = authoritySourceInventory()

    expect(inventory.domain).toBe(INVENTORY_DOMAIN)
    expect(inventory.revision).toMatch(/^[0-9a-f]{40}$/u)
    expect(inventory.tree).toMatch(/^[0-9a-f]{40}$/u)

    expect(inventory.authorityGraph.format).toBe(VERIFIER_GRAPH_FORMAT)
    expect(inventory.authorityGraph.digest).toBe(FROZEN_VERIFIER_SHA256)
    expect(inventory.authorityGraph.frozenDigest).toBe(FROZEN_VERIFIER_SHA256)
    expect(inventory.authorityGraph.matchesFrozen).toBe(true)
    expect(inventory.authorityGraph.roots).toEqual([
      'aukora/broker/broker.mjs',
      'aukora/issuer/issuer.mjs',
    ])
    expect(inventory.authorityGraph.nodeCount).toBe(36)

    expect(inventory.counts.selectedSourceFiles).toBe(36)
    expect(inventory.counts.selectedSourceBytes).toBeGreaterThan(0)
    expect(inventory.counts.externalPackages).toBe(4)
    expect(inventory.counts.externalDependencyFiles).toBe(307)
    expect(inventory.counts.externalDependencyBytes).toBeGreaterThan(0)

    expect(inventory.selectedSources).toHaveLength(36)
    expect(inventory.externalDependencies).toHaveLength(4)
    expect(inventory.installedDependencies.source).toBe('installed-node-modules-snapshot')
    expect(inventory.installedDependencies.packages).toHaveLength(4)
    expect(inventory.workingTreeStatus.isClean).toBe(true)
    expect(inventory.excludedTrustComponents).toEqual(EXCLUDED_TRUST_COMPONENTS)
  })

  it('guarantees deterministic ascending ordering of sources and dependencies', () => {
    const inventory1 = authoritySourceInventory()
    const inventory2 = authoritySourceInventory()

    // Deterministic sorting of source files by path
    for (let i = 1; i < inventory1.selectedSources.length; i++) {
      expect(inventory1.selectedSources[i - 1]!.path < inventory1.selectedSources[i]!.path).toBe(true)
    }

    // Deterministic sorting of dependencies by name
    for (let i = 1; i < inventory1.externalDependencies.length; i++) {
      expect(inventory1.externalDependencies[i - 1]!.name < inventory1.externalDependencies[i]!.name).toBe(true)
    }

    // Byte-identical serialized representation
    expect(canonicalJSON(inventory1)).toBe(canonicalJSON(inventory2))
  })

  it('strictly distinguishes selected sources from external dependencies, runtime, and OS', () => {
    const inventory = authoritySourceInventory()

    // Selected sources only contain in-repo aukora files
    for (const src of inventory.selectedSources) {
      expect(src.path.startsWith('aukora/')).toBe(true)
      expect(src.path.includes('node_modules')).toBe(false)
      expect(src.byteLength).toBeGreaterThan(0)
      expect(src.sha256).toMatch(/^[0-9a-f]{64}$/u)
    }

    // External dependencies are separately labeled as installed package snapshots
    expect(inventory.installedDependencies.source).toBe('installed-node-modules-snapshot')
    expect(inventory.installedDependencies.description).toContain('installed node_modules bytes')

    const pkgNames = inventory.externalDependencies.map(dep => dep.name)
    expect(pkgNames).toEqual([
      '@noble/ciphers',
      '@noble/curves',
      '@noble/hashes',
      '@noble/post-quantum',
    ])

    for (const dep of inventory.externalDependencies) {
      expect(dep.fileCount).toBeGreaterThan(0)
      expect(dep.totalByteLength).toBeGreaterThan(0)
      expect(dep.version).toMatch(/^\d+\.\d+\.\d+/u)
      expect(dep.source).toBe('installed-node-modules-snapshot')
    }

    // Excluded components enumerate all unmeasured runtime and environment layers
    const categories = inventory.excludedTrustComponents.map(comp => comp.category)
    expect(categories).toContain('runtime')
    expect(categories).toContain('operatingSystem')
    expect(categories).toContain('sandboxing')
    expect(categories).toContain('hardware')
    expect(categories).toContain('credentials')
    expect(categories).toContain('network')
    expect(categories).toContain('ambientEnvironment')
    expect(categories).toContain('toolchain')
    expect(categories).toContain('dynamicModules')
  })

  it('explicitly refrains from complete-TCB and security-score claims', () => {
    const inventory = authoritySourceInventory()

    expect(inventory.claims.isCompleteTCB).toBe(false)
    expect(inventory.claims.securityScore).toBeNull()
    expect(inventory.claims.scope).toContain('Static source closure')
    expect(inventory.claims.disclaimer).toContain('does not constitute a complete Trusted Computing Base')

    const report = formatInventoryReport(inventory)
    expect(report).toContain('Complete TCB:   NO')
    expect(report).toContain('Security Score: NONE (explicitly omitted)')
  })

  it('refuses honestly when a selected source file is missing from disk with refuseDirty', () => {
    const mockGraph = () => ({
      format: VERIFIER_GRAPH_FORMAT,
      roots: ['broker/broker.mjs'],
      nodes: [
        {
          path: 'nonexistent/ghost-authority-module.mjs',
          byteLength: 42,
          sha256: '0000000000000000000000000000000000000000000000000000000000000000',
          sourceBase64: 'bm9wZQ==',
        },
      ],
      localEdges: [],
      externalEdges: [],
    })

    expect(() => authoritySourceInventory({ readGraph: mockGraph, refuseDirty: true })).toThrowError(
      expect.objectContaining({
        reason: INVENTORY_REFUSE.SOURCE_MISSING,
      }),
    )
  })

  it('refuses honestly when an authority source file is missing from git commit', () => {
    const emptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
    const emptyCommit = execFileSync('git', ['-C', REPO_DIR, 'commit-tree', emptyTree, '-m', 'empty commit'], {
      env: pinnedGitEnv(),
      encoding: 'utf8',
    }).trim()

    expect(() => authoritySourceInventory({ revision: emptyCommit })).toThrowError(
      expect.objectContaining({
        reason: INVENTORY_REFUSE.SOURCE_MISSING,
      }),
    )
  })

  it('refuses honestly on graph reader failure or malformed graph', () => {
    const failingGraph = () => {
      throw new Error('graph-read-fault')
    }

    expect(() => authoritySourceInventory({ readGraph: failingGraph })).toThrowError(
      expect.objectContaining({
        reason: INVENTORY_REFUSE.GRAPH_INCOMPLETE,
      }),
    )
  })

  it('refuses honestly when dependency resolution fails', () => {
    const failingDeps = () => {
      throw new Error('unresolvable-pkg')
    }

    expect(() => authoritySourceInventory({ readDependencies: failingDeps })).toThrowError(
      expect.objectContaining({
        reason: INVENTORY_REFUSE.DEPENDENCY_UNRESOLVABLE,
      }),
    )
  })

  it('refuses honestly on an unresolvable Git revision', () => {
    expect(() => authoritySourceInventory({ revision: 'non-existent-revision-0000' })).toThrowError(
      AuthorityInventoryError,
    )
  })

  describe('disposable revision attribution regressions', () => {
    it('derives exact blob hashes of earlier revision when later commit is checked out', () => {
      const headCommit = resolvePinnedRevision('HEAD')
      const originalBranch = execFileSync('git', ['-C', REPO_DIR, 'branch', '--show-current'], { encoding: 'utf8' }).trim()

      const targetFile = 'aukora/broker/effect-body.mjs'
      const originalBytes = execFileSync('git', ['-C', REPO_DIR, 'show', `${headCommit}:${targetFile}`])
      const modifiedBytes = Buffer.concat([originalBytes, Buffer.from('\n// disposable comment in later commit\n', 'utf8')])

      // Create a disposable commit in git object store differing only by comment
      const tempIndex = join(tmpdir(), `test-index-${randomUUID()}`)
      const env = { ...pinnedGitEnv(), GIT_INDEX_FILE: tempIndex }
      execFileSync('git', ['-C', REPO_DIR, 'read-tree', headCommit], { env })
      const laterBlob = execFileSync('git', ['-C', REPO_DIR, 'hash-object', '-w', '--stdin'], {
        env,
        input: modifiedBytes,
        encoding: 'utf8',
      }).trim()
      execFileSync('git', ['-C', REPO_DIR, 'update-index', '--add', '--cacheinfo', '100644', laterBlob, targetFile], { env })
      const laterTree = execFileSync('git', ['-C', REPO_DIR, 'write-tree'], { env, encoding: 'utf8' }).trim()
      const commitLater = execFileSync('git', ['-C', REPO_DIR, 'commit-tree', laterTree, '-p', headCommit, '-m', 'disposable later commit'], {
        env,
        encoding: 'utf8',
      }).trim()
      unlinkSync(tempIndex)

      try {
        // Check out the later commit
        execFileSync('git', ['-C', REPO_DIR, 'checkout', '--detach', commitLater])

        // Request the earlier revision while the later commit is checked out on disk
        const inventory = authoritySourceInventory({ revision: headCommit })
        const targetEntry = inventory.selectedSources.find(s => s.path === targetFile)

        // Assert exact selected-blob hash of earlier revision
        expect(targetEntry).toBeDefined()
        expect(targetEntry!.sha256).toBe(sha256(originalBytes))
        expect(targetEntry!.sha256).not.toBe(sha256(modifiedBytes))
        expect(inventory.revision).toBe(headCommit)

        // Working tree status detects mismatch with checked out commit
        expect(inventory.workingTreeStatus.isCurrentHead).toBe(false)
        expect(inventory.workingTreeStatus.checkedOutCommit).toBe(commitLater)

        // Refusal on mismatched checkout when explicitly requested
        expect(() => authoritySourceInventory({ revision: headCommit, refuseMismatched: true })).toThrowError(
          expect.objectContaining({
            reason: INVENTORY_REFUSE.REVISION_MISMATCHED,
          }),
        )
      } finally {
        execFileSync('git', ['-C', REPO_DIR, 'checkout', originalBranch])
      }
    })

    it('derives exact commit blob hashes when uncommitted comment is present on disk', () => {
      const targetFile = 'aukora/broker/effect-body.mjs'
      const absPath = join(REPO_DIR, targetFile)
      const headCommit = resolvePinnedRevision('HEAD')
      const cleanBytes = execFileSync('git', ['-C', REPO_DIR, 'show', `${headCommit}:${targetFile}`])

      try {
        // Introduce an uncommitted comment on disk before invocation
        appendFileSync(absPath, '\n// uncommitted comment present before invocation\n', 'utf8')

        // Invocation derives strictly from git blobs at commit, not dirty disk bytes
        const inventory = authoritySourceInventory({ revision: 'HEAD' })
        const targetEntry = inventory.selectedSources.find(s => s.path === targetFile)

        // Assert selected-blob hash matches clean commit blob, ignoring dirty disk bytes
        expect(targetEntry).toBeDefined()
        expect(targetEntry!.sha256).toBe(sha256(cleanBytes))
        expect(inventory.workingTreeStatus.isClean).toBe(false)
        expect(inventory.workingTreeStatus.modifiedFiles).toContain(targetFile)

        // Explicit refusal when refuseDirty is requested
        expect(() => authoritySourceInventory({ revision: 'HEAD', refuseDirty: true })).toThrowError(
          expect.objectContaining({
            reason: INVENTORY_REFUSE.WORKING_TREE_DIRTY,
          }),
        )
      } finally {
        execFileSync('git', ['-C', REPO_DIR, 'checkout', '--', targetFile])
      }
    })
  })

  describe('CLI execution', () => {
    it('runs default human-readable mode with exit 0', () => {
      const stdout = execFileSync('node', ['scripts/aukora-authority-inventory.mjs'], {
        cwd: REPO_DIR,
        encoding: 'utf8',
      })

      expect(stdout).toContain('AUKORA Authority Source Inventory')
      expect(stdout).toContain('Domain:         aukora:authority-source-inventory:v1')
      expect(stdout).toContain('Selected Source Files [pinned Git revision] (36 files')
      expect(stdout).toContain('External Dependencies [installed-node-modules-snapshot] (4 packages, 307 files')
      expect(stdout).toContain('Complete TCB:   NO')
    })

    it('runs --json mode and emits valid parseable JSON', () => {
      const stdout = execFileSync('node', ['scripts/aukora-authority-inventory.mjs', '--json'], {
        cwd: REPO_DIR,
        encoding: 'utf8',
      })

      const parsed = JSON.parse(stdout)
      expect(parsed.domain).toBe(INVENTORY_DOMAIN)
      expect(parsed.authorityGraph.matchesFrozen).toBe(true)
      expect(parsed.counts.selectedSourceFiles).toBe(36)
      expect(parsed.selectedSources).toHaveLength(36)
      expect(parsed.installedDependencies.source).toBe('installed-node-modules-snapshot')
      expect(parsed.claims.isCompleteTCB).toBe(false)
    })

    it('runs --check mode successfully against frozen graph', () => {
      expect(() => {
        execFileSync('node', ['scripts/aukora-authority-inventory.mjs', '--check'], {
          cwd: REPO_DIR,
          encoding: 'utf8',
        })
      }).not.toThrow()
    })

    it('runs --refuse-dirty successfully on clean checkout', () => {
      expect(() => {
        execFileSync('node', ['scripts/aukora-authority-inventory.mjs', '--refuse-dirty'], {
          cwd: REPO_DIR,
          encoding: 'utf8',
        })
      }).not.toThrow()
    })

    it('runs --help mode and displays usage', () => {
      const stdout = execFileSync('node', ['scripts/aukora-authority-inventory.mjs', '--help'], {
        cwd: REPO_DIR,
        encoding: 'utf8',
      })

      expect(stdout).toContain('usage: node scripts/aukora-authority-inventory.mjs [options]')
      expect(stdout).toContain('--revision <rev>')
      expect(stdout).toContain('--check')
      expect(stdout).toContain('--refuse-dirty')
      expect(stdout).toContain('--json')
    })

    it('exits non-zero with error message on unresolvable revision', () => {
      expect(() => {
        execFileSync('node', ['scripts/aukora-authority-inventory.mjs', '--revision', 'nonexistent-rev-xyz'], {
          cwd: REPO_DIR,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      }).toThrow()
    })
  })
})
