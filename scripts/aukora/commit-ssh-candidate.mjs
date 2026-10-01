/**
 * Candidate commit OID writer — unsigned by default; SSH-signed when required.
 *
 * Feature flag AUKORA_REQUIRE_COMMIT_SSH=1:
 *   Requires AUKORA_COMMIT_SIGN_KEY (SSH private key path outside the repo) and
 *   AUKORA_COMMIT_ALLOWED_SIGNERS (allowed_signers file). Uses git commit-tree -S
 *   with gpg.format=ssh (spike-equivalent). Then git verify-commit must succeed
 *   or we deny('candidate:commit-signature-invalid'). No unsigned fallback.
 * Flag off (default): unsigned commit-tree so CI/main stays green.
 *
 * Decision (Airlock) key stays separate from this commit SSH key.
 * P2/P3: one-use Airlock bind over exact unsigned bytes — see
 * scripts/owner/commit-ssh-sign.mjs.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const deny = (code) => { throw new Error(code) }

// Same closed Git env as aumlok-candidate-authority (no caller config/hooks).
function git(repo, args, { input, env = {}, optional = false, encoding = 'utf8' } = {}) {
  try {
    return execFileSync('/usr/bin/git', ['-C', repo, '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
      '-c', 'core.attributesFile=/dev/null', ...args], {
      input, encoding, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: '/usr/bin:/bin', HOME: '/dev/null', XDG_CONFIG_HOME: '/dev/null',
        GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: 'file', GIT_LITERAL_PATHSPECS: '1', LANG: 'C', LC_ALL: 'C',
        // Keep Git's SSH buffers in the caller's disposable scratch. Seatbelt,
        // rather than this environment value, decides which paths are writable.
        ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}), ...env },
    })
  } catch { if (optional) return null; deny(`candidate:git-${args[0]}-failed`) }
}

export function writeCandidateCommit(repo, { tree, base, message, requireSsh = process.env.AUKORA_REQUIRE_COMMIT_SSH === '1' }) {
  const ident = ['-c', 'user.name=Auma Approved Change', '-c', 'user.email=approved@localhost']
  if (!requireSsh) {
    return git(repo, [...ident, 'commit-tree', tree, '-p', base], { input: message }).trim()
  }
  const signKey = process.env.AUKORA_COMMIT_SIGN_KEY
  const allowed = process.env.AUKORA_COMMIT_ALLOWED_SIGNERS
  if (typeof signKey !== 'string' || !signKey || typeof allowed !== 'string' || !allowed) {
    deny('candidate:commit-signing-not-configured')
  }
  if (!existsSync(signKey) || !existsSync(allowed)) deny('candidate:commit-signing-not-configured')
  const commit = git(repo, [
    ...ident,
    '-c', 'gpg.format=ssh',
    '-c', `user.signingkey=${signKey}`,
    '-c', `gpg.ssh.allowedSignersFile=${allowed}`,
    'commit-tree', '-S', tree, '-p', base,
  ], { input: message }).trim()
  const verified = git(repo, ['-c', `gpg.ssh.allowedSignersFile=${allowed}`, 'verify-commit', commit], { optional: true })
  if (verified === null) deny('candidate:commit-signature-invalid')
  return commit
}
