/**
 * THE WHOLE RELEASE, ONE DIGEST: covered files under a directory (regular files by content, symlinks by target), sorted,
 * hashed under one domain. become binds the release tree and the shell it will run into the plugin-set record, so the
 * one popup approves what actually loads: shell (with the signer), apps/cli, the gate bootstrap, workers, node_modules
 * and the plugins. Checked against the bytes on disk before the popup is skipped and again just before apply; the gate
 * does not re-check it at each boot. The same uid can still rewrite the tree after apply.
 */
import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs'
import { join } from 'node:path'

export const RELEASE_TREE_DOMAIN = 'aukora:release-tree:v1'
/** The record binds this digest, so it cannot be inside it. */
const EXCLUDED = new Set(['.dsh-build/plugin-set.json'])

export function treeDigest(dir) {
  const rows = []
  const walk = (rel) => {
    for (const name of readdirSync(join(dir, rel)).sort()) {
      const path = rel ? `${rel}/${name}` : name
      if (EXCLUDED.has(path)) continue
      const stat = lstatSync(join(dir, path))
      // Finder's header, not just a filename/mode: a renamed JavaScript module stays covered.
      let content
      if (name === '.DS_Store' && stat.isFile() && !(stat.mode & 0o111)) {
        content = readFileSync(join(dir, path))
        if (content.subarray(0, 8).equals(Buffer.from('0000000142756431', 'hex'))) continue
      }
      if (stat.isSymbolicLink()) rows.push(`l ${path}\0${readlinkSync(join(dir, path))}`)
      else if (stat.isDirectory()) walk(path)
      else if (stat.isFile()) rows.push(`${stat.mode & 0o111 ? 'x' : 'f'} ${path}\0${createHash('sha256').update(content ?? readFileSync(join(dir, path))).digest('hex')}`)
      else throw new Error(`${join(dir, path)} is not a file, directory or symlink`)
    }
  }
  walk('')
  rows.sort()
  const digest = createHash('sha256').update(`${RELEASE_TREE_DOMAIN}\0${rows.join('\n')}`).digest('hex')
  return { digest, files: rows.length }
}

/** What the record carries and the popup shows: the commit, the release tree and the shell. */
export function releaseBinding({ commit, release, shell }) {
  if (!/^[0-9a-f]{40}$/u.test(commit)) throw new Error('release binding needs a full commit id')
  const tipSha = JSON.parse(readFileSync(join(release, '.dsh-build', 'aukora-release.json'), 'utf8')).tipSha
  if (commit !== tipSha) throw new Error(`bind commit ${commit} does not match release tipSha ${String(tipSha)}`)
  const tree = treeDigest(release)
  return { commit, tree: tree.digest, files: tree.files, shell: treeDigest(shell).digest }
}

export const sameBinding = (a, b) => Boolean(a && b) && a.commit === b.commit && a.tree === b.tree
  && a.files === b.files && a.shell === b.shell
