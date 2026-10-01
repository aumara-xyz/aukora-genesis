/**
 * What a shell or code string SAYS it will do, read without running it.
 *
 * THIS IS A TRIPWIRE, NOT A PARSER OF INTENT. Deciding what a shell string will touch is undecidable in general —
 * `eval`, `$(…)`, base64, a script file, an alias, a git hook all defeat it — so this module reads the command TEXT
 * the model sent and refuses what that text plainly names. What the text does not show is not seen, and the gate's
 * ceilings say so. It exists because the plain spellings (`git push origin HEAD:main`, `security find-generic-password`,
 * `cat …/state/aumlok/machine-seed-v3.json`) are the ones a model actually writes.
 *
 * @module @aukora/dsh-plugin-action-gate/shell
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

/** Operators that separate one simple command from the next. Substitutions open a new command too. */
const SEPARATORS = new Set([';', '&&', '||', '|', '&', '\n', '(', ')', '$(', '`', '{', '}', '|&'])

/**
 * Split a command string into simple commands, each a list of words with quotes removed.
 * Single quotes are literal, double quotes allow `\` escapes, and `$(`/backticks start a nested command whose words
 * are scanned like any other.
 * @param {string} text - the command text.
 * @returns {{words: string[], redirects: string[]}[]} simple commands and literal output operands.
 */
export function shellCommands(text) {
  const commands = []
  let words = []
  let redirects = []
  const heredocs = []
  let redirect = null
  let word = ''
  let inWord = false
  const endWord = () => {
    if (!inWord) return
    if (redirect !== null) {
      if (redirect === '<<' || redirect === '<<-') heredocs.push({ delimiter: word, tabs: redirect === '<<-' })
      if (['>', '>>', '>|', '&>', '&>>', '<>'].includes(redirect)
        || (redirect === '>&' && !/^(?:\d+|-)$/u.test(word))) redirects.push(word)
      redirect = null
    } else words.push(word)
    word = ''; inWord = false
  }
  const endCommand = () => {
    endWord()
    if (words.length > 0 || redirects.length > 0) commands.push({ words, redirects })
    words = []; redirects = []; redirect = null
  }
  const s = String(text)
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i]
    if (c === "'") {
      const close = s.indexOf("'", i + 1)
      word += close === -1 ? s.slice(i + 1) : s.slice(i + 1, close)
      inWord = true
      i = close === -1 ? s.length : close
      continue
    }
    if (c === '"') {
      inWord = true
      for (i += 1; i < s.length && s[i] !== '"'; i += 1) {
        if (s[i] === '\\' && i + 1 < s.length) { i += 1; word += s[i]; continue }
        // A substitution inside double quotes is still a command; scan it on its own as well.
        if (s[i] === '$' && s[i + 1] === '(') {
          const end = s.indexOf(')', i)
          commands.push(...shellCommands(s.slice(i + 2, end === -1 ? s.length : end)))
        }
        word += s[i]
      }
      continue
    }
    if (c === '\\' && i + 1 < s.length) {
      if (s[i + 1] === '\n') { i += 1; continue }
      word += s[i + 1]; inWord = true; i += 1; continue
    }
    // Keep substitutions in their containing word: their computed pathname is not a literal target.
    if ((c === '$' && s[i + 1] === '(') || c === '`') {
      const start = i + (c === '`' ? 1 : 2)
      const close = s.indexOf(c === '`' ? '`' : ')', start)
      const end = close === -1 ? s.length : close + 1
      commands.push(...shellCommands(s.slice(start, close === -1 ? s.length : close)))
      word += s.slice(i, end); inWord = true; i = end - 1; continue
    }
    // Only unquoted operators are redirects; quoted '>' and interpreter source remain ordinary words.
    const operator = /^(?:&>>|&>|>>|>\||>&|>|<<<|<<-?|<>|<&|<)/u.exec(s.slice(i))?.[0]
    if (operator !== undefined) {
      if (inWord && /^\d+$/u.test(word)) { word = ''; inWord = false }
      endWord(); redirect = operator; i += operator.length - 1; continue
    }
    const two = s.slice(i, i + 2)
    if (two === '&&' || two === '||' || two === '$(' || two === '|&') { endCommand(); i += 1; continue }
    if (SEPARATORS.has(c)) {
      endCommand()
      if (c === '\n') {
        // Heredoc bodies are data. This text-only reader does not evaluate expansions inside them.
        for (const { delimiter, tabs } of heredocs.splice(0)) {
          while (i + 1 < s.length) {
            const start = i + 1
            const next = s.indexOf('\n', start)
            const end = next === -1 ? s.length : next
            const line = s.slice(start, end)
            i = end
            if ((tabs ? line.replace(/^\t+/u, '') : line) === delimiter) break
          }
        }
      }
      continue
    }
    if (c === '#' && !inWord) {
      const nl = s.indexOf('\n', i)
      i = nl === -1 ? s.length : nl - 1
      continue
    }
    if (c === ' ' || c === '\t' || c === '\r') { endWord(); continue }
    word += c
    inWord = true
  }
  endCommand()
  return commands
}

/** Compatibility view used by the command-text tripwires. */
export function simpleCommands(text) {
  return shellCommands(text).map(command => command.words).filter(words => words.length > 0)
}

/** Wrappers that run the command that follows them. */
const WRAPPERS = new Set(['sudo', 'command', 'exec', 'nohup', 'time', 'nice', 'caffeinate', 'xargs', 'doas', 'timeout', 'gtimeout', 'stdbuf'])
/** Shells whose `-c` string is itself a command to scan. */
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish'])

/**
 * The words of a simple command with leading assignments and wrappers removed; `sh -c '…'` and `eval …` expand into
 * the commands they carry.
 * @param {{words: string[], redirects: string[]}} command - one simple command.
 * @returns {{words: string[], redirects: string[]}[]} the effective commands (usually one).
 */
export function effectiveShellCommands({ words, redirects = [] }) {
  let rest = [...words]
  for (let guard = 0; guard < 16 && rest.length > 0; guard += 1) {
    const head = rest[0]
    if (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(head)) { rest = rest.slice(1); continue }
    const program = basename(head)
    if (program === 'env') {
      rest = rest.slice(1)
      while (rest.length > 0 && (rest[0].startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/u.test(rest[0]))) rest = rest.slice(1)
      continue
    }
    if (WRAPPERS.has(program)) {
      rest = rest.slice(1)
      // `timeout 30 git …`, `nice -n 5 git …`, `xargs -I{} git …`: drop options and one numeric operand.
      while (rest.length > 0 && rest[0].startsWith('-')) rest = rest.slice(rest[0] === '-n' || rest[0] === '-I' ? 2 : 1)
      if (rest.length > 0 && /^\d+[smhd]?$/u.test(rest[0])) rest = rest.slice(1)
      continue
    }
    if (SHELLS.has(program)) {
      const at = rest.findIndex(word => /^-[a-z]*c[a-z]*$/u.test(word))
      if (at !== -1 && rest[at + 1] !== undefined) return [{ words: [], redirects }, ...shellCommands(rest[at + 1]).flatMap(effectiveShellCommands)]
      return [{ words: rest, redirects }]
    }
    if (program === 'eval') return [{ words: [], redirects }, ...shellCommands(rest.slice(1).join(' ')).flatMap(effectiveShellCommands)]
    return [{ words: rest, redirects }]
  }
  return [{ words: rest, redirects }]
}

export function effectiveCommands(words) {
  return effectiveShellCommands({ words }).map(command => command.words).filter(command => command.length > 0)
}

// ── LITERAL WRITES ───────────────────────────────────────────────────────────────────────────────────────────────

/** No expansion or code evaluation: only a literal spelling against a known working directory. */
export function literalPath(raw, workdir, home) {
  if (typeof raw !== 'string' || raw === '' || /[$`\0]/u.test(raw)) return null
  if (raw === '~' || raw.startsWith('~/')) return resolve(home, raw.slice(2))
  if (raw.startsWith('~')) return null
  return isAbsolute(raw) ? resolve(raw) : workdir === undefined ? null : resolve(workdir, raw)
}

/** Separate operands from ordinary options without mistaking an option's value for a filename. */
function operands(words, values = new Set()) {
  const out = []
  for (let i = 1; i < words.length; i += 1) {
    const word = words[i]
    if (word === '--') { out.push(...words.slice(i + 1)); break }
    if (values.has(word)) { i += 1; continue }
    if (word.startsWith('-') && word !== '-') continue
    out.push(word)
  }
  return out
}

/** chmod's mode is not a target; a reference supplies it without becoming a write target. */
function chmodOperands(words) {
  const files = []
  let mode = true
  let options = true
  for (let i = 1; i < words.length; i += 1) {
    const word = words[i]
    if (options) {
      if (word === '--') { options = false; continue }
      if (word === '--reference') { mode = false; i += 1; continue }
      if (word.startsWith('--reference=')) { mode = false; continue }
      // BSD's -N (remove ACL) and -E (ACL from stdin) take files without a mode operand.
      if (/^-[RcfvhHLPEN]+$/u.test(word)) { if (/[EN]/u.test(word)) mode = false; continue }
      // A leading minus can be a symbolic mode, as in `chmod -w file`.
      if (word.startsWith('-') && !/^-[rwxXstugo]*(?:[+=-][rwxXstugo]*)*(?:,[ugoa]*(?:[+=-][rwxXstugo]*)+)*$/u.test(word)) continue
    }
    if (mode) mode = false
    else files.push(word)
  }
  return files
}

/** Python's -c ends its option list; script/module arguments are not executable command strings. */
function pythonCommand(words) {
  for (let i = 1; i < words.length; i += 1) {
    const word = words[i]
    if (word === '--' || word === '-' || !word.startsWith('-') || word.startsWith('-m')) break
    if (word === '-c') return words[i + 1]
    if (word.startsWith('-c')) return word.slice(2)
    if (['-W', '-X', '--check-hash-based-pycs'].includes(word)) i += 1
  }
}

/** Direct literal Python/Node write calls; variables, expressions, escapes and aliases are not evaluated. */
function codeWriteTargets(code, python) {
  const targets = []
  const literal = `(['"])([^'"\\\\\\r\\n]*)\\1`
  if (python) {
    for (const match of code.matchAll(new RegExp(`\\bopen\\s*\\(\\s*${literal}\\s*,\\s*(?:mode\\s*=\\s*)?(['"])([^'"]*)\\3`, 'gu'))) {
      if (/[wax+]/u.test(match[4])) targets.push(match[2])
    }
    for (const match of code.matchAll(new RegExp(`\\bPath\\s*\\(\\s*${literal}\\s*\\)\\s*\\.\\s*(?:write_text|write_bytes|touch)\\s*\\(`, 'gu'))) targets.push(match[2])
    for (const match of code.matchAll(new RegExp(`\\bPath\\s*\\(\\s*${literal}\\s*\\)\\s*\\.\\s*open\\s*\\(\\s*(?:mode\\s*=\\s*)?(['"])([^'"]*)\\3`, 'gu'))) {
      if (/[wax+]/u.test(match[4])) targets.push(match[2])
    }
  } else {
    for (const match of code.matchAll(new RegExp(`\\b(?:writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|truncateSync|truncate)\\s*\\(\\s*${literal}\\s*[,)]`, 'gu'))) targets.push(match[2])
    for (const match of code.matchAll(new RegExp(`\\b(?:openSync|open)\\s*\\(\\s*${literal}\\s*,\\s*(['"])([^'"]*)\\3`, 'gu'))) {
      if (/[wax+]/u.test(match[4])) targets.push(match[2])
    }
  }
  return targets
}

/** The concrete file paths named by the modeled shell write forms. Every result goes to the seed guard. */
export function literalWriteTargets({ words, redirects }, workdir, home) {
  const targets = [...redirects]
  const program = basename(words[0] ?? '')
  if (program === 'rm') targets.push(...operands(words))
  if (program === 'chmod') targets.push(...chmodOperands(words))
  if (program === 'tee') targets.push(...operands(words).filter(word => word !== '-'))
  if (program === 'dd') targets.push(...words.slice(1).filter(word => word.startsWith('of=')).map(word => word.slice(3)))
  if (program === 'truncate') targets.push(...operands(words, new Set(['-s', '--size', '-r', '--reference'])))
  if (program === 'sed') {
    let inPlace = false
    let script = false
    const files = []
    for (let i = 1; i < words.length; i += 1) {
      const word = words[i]
      if (word === '--') { files.push(...words.slice(i + 1)); break }
      if (/^--in-place(?:=|$)|^-[^-]*i/u.test(word)) {
        inPlace = true
        if (word === '-i' && words[i + 1] === '') i += 1
      } else if (['-e', '-f', '--expression', '--file'].includes(word)) { script = true; i += 1 }
      else if (/^-[ef].|^--(?:expression|file)=/u.test(word)) script = true
      else if (!word.startsWith('-')) { if (!script) script = true; else files.push(word) }
    }
    if (inPlace) targets.push(...files)
  }
  if (['cp', 'mv', 'install', 'ditto', 'rsync', 'ln'].includes(program)) {
    const values = new Set(['-t', '--target-directory', '-S', '--suffix'])
    if (program === 'install') for (const flag of ['-m', '--mode', '-o', '--owner', '-g', '--group']) values.add(flag)
    if (program === 'rsync') for (const flag of ['-e', '--rsh', '--exclude', '--include', '--filter', '--exclude-from', '--include-from', '--files-from', '--chmod', '--chown', '--bwlimit', '--timeout']) values.add(flag)
    const files = operands(words, values)
    let destination
    for (let i = 1; i < words.length && words[i] !== '--'; i += 1) {
      if (words[i] === '-t' || words[i] === '--target-directory') destination = words[++i]
      else if (words[i].startsWith('--target-directory=')) destination = words[i].slice('--target-directory='.length)
      else if (/^-t./u.test(words[i])) destination = words[i].slice(2)
    }
    const targetDirectory = destination !== undefined
    if (!targetDirectory) destination = files.length === 1 && program === 'ln' ? '.' : files.pop()
    const dest = literalPath(destination, workdir, home)
    if (dest !== null) {
      let directory = targetDirectory || destination.endsWith('/') || files.length > 1
      try { directory ||= statSync(dest).isDirectory() } catch { /* missing destination */ }
      if (words.includes('-T') || words.includes('--no-target-directory')) directory = false
      if (program === 'install' && words.includes('-d')) targets.push(...files, destination)
      else if (!directory) targets.push(dest)
      else for (const source of files) {
        const file = literalPath(source, workdir, home)
        if (file === null) continue
        // ditto and rsync source/ copy contents into the destination. The source basename is still checked,
        // but this text-only adapter does not enumerate recursively copied trees (see index.mjs ceilings).
        targets.push(join(dest, basename(file)))
      }
    }
  }
  const python = /^python(?:\d+(?:\.\d+)*)?$/u.test(program)
  if (python || program === 'node' || program === 'nodejs') {
    const end = words.indexOf('--')
    const options = words.slice(1, end === -1 ? undefined : end)
    const at = options.findIndex(word => word === '-e' || word === '--eval')
    const code = python ? pythonCommand(words)
      : at === -1 ? options.find(word => word.startsWith('--eval='))?.slice(7) : options[at + 1]
    if (code !== undefined) targets.push(...codeWriteTargets(code, python))
  }
  return [...new Set(targets.map(target => literalPath(target, workdir, home)).filter(target => target !== null))]
}

// ── GIT ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Global git options that take a separate value. */
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env'])

/**
 * Split a git invocation into its global options, subcommand and arguments.
 * @param {string[]} words - words starting with `git`.
 * @returns {{dirs: string[], gitDir: string|null, configs: string[], sub: string|null, args: string[]}}
 */
export function parseGit(words) {
  const dirs = []
  const configs = []
  let gitDir = null
  let i = 1
  for (; i < words.length; i += 1) {
    const w = words[i]
    if (!w.startsWith('-')) break
    if (w.startsWith('--git-dir=')) { gitDir = w.slice('--git-dir='.length); continue }
    if (w.startsWith('--config-env=')) { configs.push(w.slice('--config-env='.length)); continue }
    if (w.startsWith('-c') && w !== '-c') { configs.push(w.slice(2)); continue }
    if (GIT_VALUE_OPTIONS.has(w)) {
      if (w === '-C') dirs.push(words[i + 1] ?? '')
      if (w === '--git-dir') gitDir = words[i + 1] ?? null
      if (w === '-c' || w === '--config-env') configs.push(words[i + 1] ?? '')
      i += 1
    }
  }
  return { dirs, gitDir, configs, sub: words[i] ?? null, args: words.slice(i + 1) }
}

/**
 * The branch HEAD names in the repository containing `dir`, read from `HEAD` (a text file; nothing secret).
 * @param {string} dir - a directory inside a working tree.
 * @param {string|null} [gitDir] - an explicit `--git-dir`.
 * @returns {string|null|undefined} the branch name, `null` when detached, `undefined` when no repository was found.
 */
export function currentBranch(dir, gitDir = null) {
  let found = gitDir === null ? null : resolve(dir, gitDir)
  if (found === null) {
    let at = resolve(dir)
    for (let hops = 0; hops < 64; hops += 1) {
      const candidate = join(at, '.git')
      if (existsSync(candidate)) {
        try {
          if (statSync(candidate).isDirectory()) { found = candidate } else {
            const pointer = /^gitdir:\s*(.+?)\s*$/mu.exec(readFileSync(candidate, 'utf8'))?.[1]
            if (pointer !== undefined) found = isAbsolute(pointer) ? pointer : resolve(at, pointer)
          }
        } catch { return undefined }
        break
      }
      const up = dirname(at)
      if (up === at) return undefined
      at = up
    }
  }
  if (found === null) return undefined
  try {
    const head = readFileSync(join(found, 'HEAD'), 'utf8').trim()
    const ref = /^ref:\s*refs\/heads\/(.+)$/u.exec(head)?.[1]
    return ref === undefined ? null : ref
  } catch {
    return undefined
  }
}

/** Whether a ref spelling names the protected branch. Folded, because refs are files on a case-insensitive disk. */
function namesMain(ref, mainBranch) {
  const r = String(ref).replace(/^\+/u, '').toLowerCase()
  const m = mainBranch.toLowerCase()
  return r === m || r === `refs/heads/${m}` || r === `heads/${m}`
}

/** Push options that take a separate value, so their value is not read as a remote or refspec. */
const PUSH_VALUE_OPTIONS = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec'])
/** Subcommands that advance the CURRENT branch. */
const ADVANCES_CURRENT = new Set(['commit', 'merge', 'rebase', 'cherry-pick', 'revert', 'am', 'pull', 'reset', 'filter-branch', 'filter-repo'])
/** Branch flags that rewrite, move, copy or delete a ref. */
const BRANCH_MUTATING = new Set(['-f', '--force', '-d', '-D', '--delete', '-m', '-M', '--move', '-c', '-C', '--copy'])

/**
 * Whether one git invocation would move or rewrite refs/heads/<main>, as far as its text shows.
 * @param {string[]} words - words starting with `git`.
 * @param {string|undefined} workdir - the directory the command runs in, when known.
 * @param {string} mainBranch - the protected branch name.
 * @param {string} [home] - the home directory a `-C ~/…` names (AGENTS.md teaches `git -C ~/aukora-genesis …`).
 * @returns {{rule: string, message: string}|null} the refusal, or null.
 */
export function gitMainRefusal(words, workdir, mainBranch, home) {
  const { dirs, gitDir, configs, sub, args } = parseGit(words)
  if (sub === null) return null
  let dir = workdir
  for (const d of dirs) {
    dir = home !== undefined && (d === '~' || d.startsWith('~/')) ? resolve(home, d.slice(2))
      : dir === undefined ? (isAbsolute(d) ? d : undefined) : resolve(dir, d)
  }
  const branch = () => (dir === undefined ? undefined : currentBranch(dir, gitDir))
  const flags = args.filter(a => a.startsWith('-'))
  const positional = []
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]
    if (a === '--') { positional.push(...args.slice(i + 1).map(p => `--path:${p}`)); break }
    if (a.startsWith('-')) { if (sub === 'push' && PUSH_VALUE_OPTIONS.has(a)) i += 1; continue }
    positional.push(a)
  }
  const refused = (what) => ({
    rule: 'git:main',
    message: `this command would ${what}. refs/heads/${mainBranch} moves only through the owner's approval: `
      + 'stage the change and run `node scripts/aukora/self-change.mjs "why, in one line" <path> [<path> ...]`, '
      + 'which shows Peter the full diff in the Aumlok popup and fast-forwards main only if he approves',
  })

  if (sub === 'send-pack') return {
    rule: 'git:send-pack-unresolved',
    message: '`git send-pack` bypasses the modeled push destination checks; use `git push` with an explicit destination',
  }
  if (sub === 'push') {
    const override = configs.find(config => /^(?:push\.default|remote\..+\.push)=/iu.test(config))
    if (override !== undefined) return {
      rule: 'git:push-config-unresolved',
      message: `git push with ${override.split('=')[0]} overridden has an unresolved destination; remove the override and name an explicit destination`,
    }
    if (flags.includes('--mirror')) return {
      rule: 'git:push-mirror',
      message: '`git push --mirror` can rewrite every remote ref; its destinations are not individually judged',
    }
    if (flags.some(f => f === '--all' || f === '--branches')) return refused(`push every branch, ${mainBranch} included`)
    const hasRepoOption = args.some(arg => arg === '--repo' || arg.startsWith('--repo='))
    const refspecs = positional.slice(hasRepoOption ? 0 : 1).filter(p => !p.startsWith('--path:'))
    if (refspecs.length === 0) {
      const b = branch()
      if (b === undefined) {
        return {
          rule: 'git:push-unresolved',
          message: 'a `git push` with no refspec pushes the current branch, and the gate cannot see which branch that is '
            + 'from here. Name the destination explicitly (`git push origin <branch>`); pushes to '
            + `${mainBranch} go through scripts/aukora/self-change.mjs`,
        }
      }
      if (b !== null && namesMain(b, mainBranch)) return refused(`push the current branch, which is ${mainBranch}`)
      return null
    }
    for (const spec of refspecs) {
      if (spec.includes('*') || spec === ':') return {
        rule: 'git:push-refspec-unresolved',
        message: 'a wildcard or matching git push refspec can include protected branches; name an explicit destination',
      }
      const colon = spec.lastIndexOf(':')
      const dst = colon === -1 ? spec : spec.slice(colon + 1)
      const src = colon === -1 ? spec : spec.slice(0, colon)
      if (namesMain(dst, mainBranch)) return refused(`push to ${mainBranch}`)
      if (colon === -1 && src.replace(/^\+/u, '') === 'HEAD') {
        const b = branch()
        if (b === undefined || (b !== null && namesMain(b, mainBranch))) return refused(`push HEAD, which is (or may be) ${mainBranch}`)
      }
    }
    return null
  }
  if (sub === 'update-ref') {
    if (flags.includes('--stdin')) return refused('rewrite refs read from stdin, which the gate cannot see')
    if (positional.some(p => namesMain(p, mainBranch))) return refused(`rewrite refs/heads/${mainBranch}`)
    return null
  }
  if (sub === 'branch') {
    const mutating = flags.some(f => BRANCH_MUTATING.has(f))
    if (positional.some(p => namesMain(p, mainBranch)) && (mutating || (flags.length === 0 && namesMain(positional[0], mainBranch)))) {
      return refused(`create, move, copy or delete ${mainBranch}`)
    }
    return null
  }
  if (sub === 'checkout' || sub === 'switch' || sub === 'worktree') {
    for (let i = 0; i < args.length; i += 1) {
      if (['-B', '-C', '--force-create'].includes(args[i]) && namesMain(args[i + 1] ?? '', mainBranch)) return refused(`reset ${mainBranch} to another commit`)
    }
    return null
  }
  if (sub === 'fetch') {
    if (positional.slice(1).some(spec => spec.includes(':') && namesMain(spec.slice(spec.lastIndexOf(':') + 1), mainBranch))) {
      return refused(`fetch into refs/heads/${mainBranch}`)
    }
    return null
  }
  if (sub === 'rebase' && positional.length >= 2 && namesMain(positional[1], mainBranch)) return refused(`rebase ${mainBranch}`)
  if (ADVANCES_CURRENT.has(sub)) {
    // FOLLOWING GITHUB'S MAIN IS NOT MOVING IT: main on GitHub moves only through self-change, so a fast-forward of
    // the local branch to it cannot carry unapproved content, and self-change needs the checkout at GitHub main.
    if (sub === 'pull' && flags.includes('--ff-only')) return null
    if (sub === 'merge' && flags.includes('--ff-only') && positional.length === 1 && /^origin\//u.test(positional[0])) return null
    if (sub === 'reset') {
      // A bare `git reset`, a reset to HEAD, and a reset of named paths leave the branch where it is.
      if (positional.length === 0 || (positional.length === 1 && positional[0] === 'HEAD')) return null
      if (positional.length === 1 && positional[0] === `origin/${mainBranch}`) return null
      const moving = flags.some(f => ['--hard', '--soft', '--mixed', '--keep', '--merge'].includes(f))
      if (!moving && (positional.length > 1 || positional.some(p => p.startsWith('--path:')))) return null
    }
    if (sub === 'revert' && flags.includes('--no-commit')) return null
    const b = branch()
    if (b !== undefined && b !== null && namesMain(b, mainBranch)) return refused(`advance ${mainBranch} with \`git ${sub}\` while it is checked out`)
    return null
  }
  return null
}

// ── CREDENTIALS, PUBLISHING, SPENDING ─────────────────────────────────────────────────────────────────────────────

/** `security` subcommands that read, export or unlock secrets. */
const KEYCHAIN_SECRET = /^(find-(generic|internet)-password|find-key|find-certificate|dump-keychain|export|unlock-keychain|set-key-partition-list|export-identities|delete-(generic|internet)-password|add-(generic|internet)-password)$/u

/**
 * A credential read the command text names outright: the macOS keychain CLI, git's credential helper, `gh auth token`.
 * @param {string[]} words - one effective command.
 * @returns {{rule: string, message: string}|null}
 */
export function credentialRefusal(words) {
  const program = basename(words[0] ?? '')
  if (program === 'security' && words.slice(1).some(w => KEYCHAIN_SECRET.test(w))) {
    return { rule: 'credential:keychain', message: 'the macOS keychain CLI reads or changes stored secrets; agents do not use it' }
  }
  if (program === 'git') {
    const { sub, args } = parseGit(words)
    if (sub === 'credential' || (sub !== null && sub.startsWith('credential-'))) {
      return { rule: 'credential:git-helper', message: "git's credential helper hands out the owner's stored credentials; agents do not call it" }
    }
    if (sub === 'config' && args.some(a => /^credential\./iu.test(a))) {
      return { rule: 'credential:git-helper', message: "changing git's credential configuration is not an agent action" }
    }
  }
  if (program === 'gh' && words[1] === 'auth' && (words[2] === 'token' || words.includes('--show-token') || (words[2] === 'status' && words.includes('-t')))) {
    return { rule: 'credential:gh-token', message: "`gh auth token` prints the owner's GitHub token; agents do not read it" }
  }
  return null
}

/** Release, deploy and publish verbs, by program. */
const PUBLISH = {
  npm: ['publish', 'dist-tag', 'unpublish', 'deprecate'],
  pnpm: ['publish'],
  yarn: ['publish', 'npm'],
  bun: ['publish'],
  cargo: ['publish', 'yank'],
  twine: ['upload'],
  docker: ['push'],
  podman: ['push'],
  gem: ['push'],
  netlify: ['deploy'],
  fly: ['deploy'],
  flyctl: ['deploy'],
  wrangler: ['deploy', 'publish'],
  firebase: ['deploy'],
}
/** `gh` noun/verb pairs that publish or change the repository on GitHub, or start paid CI. */
const GH_AUTHORITY = {
  pr: ['create', 'merge', 'ready', 'review', 'close', 'reopen', 'edit'],
  release: ['create', 'upload', 'edit', 'delete'],
  repo: ['create', 'edit', 'delete', 'rename', 'archive', 'unarchive', 'sync', 'fork', 'deploy-key'],
  gist: ['create', 'edit', 'delete'],
  workflow: ['run', 'enable', 'disable'],
  run: ['rerun', 'cancel'],
  secret: ['set', 'delete'],
  variable: ['set', 'delete'],
  ruleset: ['create', 'edit', 'delete'],
}
/** This deployment's own release and publishing scripts: they change what the live app runs. */
const AUTHORITY_SCRIPTS = new Set([
  'materialize-aukora-release.py', 'upgrade-release.py', 'desktop-cutover.mjs', 'cut-release.sh', 'face-dev-push.py',
  'install-owner-pin.mjs', 'install-hooks.mjs',
])
/** Payment CLIs. */
const SPEND_PROGRAMS = new Set(['stripe', 'paypal'])

/**
 * An authority action the command names: publishing, a release or cutover of the live app, or spending.
 * @param {string[]} words - one effective command.
 * @returns {{rule: string, message: string}|null}
 */
export function authorityRefusal(words) {
  const program = basename(words[0] ?? '')
  const escalate = (rule, what) => ({
    rule,
    message: `${what} is an authority action and agents do not take it on their own. Ask Peter, or for a code change run `
      + '`node scripts/aukora/self-change.mjs "why, in one line" <path> [<path> ...]`, which raises his Aumlok popup',
  })
  if (SPEND_PROGRAMS.has(program)) return escalate('authority:spend', `running \`${program}\` (payments)`)
  if (PUBLISH[program]?.includes(words[1])) return escalate('authority:publish', `\`${program} ${words[1]}\``)
  if (program === 'vercel' && (words.length === 1 || ['deploy', 'promote', 'alias', '--prod'].some(v => words.includes(v)))) {
    return escalate('authority:publish', 'a Vercel deploy')
  }
  if (program === 'gh') {
    if (GH_AUTHORITY[words[1]]?.includes(words[2])) return escalate('authority:publish', `\`gh ${words[1]} ${words[2]}\``)
    if (words[1] === 'api') {
      const method = words.find((w, i) => (words[i - 1] === '-X' || words[i - 1] === '--method'))
        ?? words.find(w => /^--method=/u.test(w))?.slice('--method='.length)
        ?? words.find(w => /^-X[A-Z]+$/u.test(w))?.slice(2)
      const hasBody = words.some(w => ['-f', '-F', '--field', '--raw-field', '--input'].includes(w) || /^--(raw-)?field=/u.test(w))
      if ((method !== undefined && method.toUpperCase() !== 'GET') || (method === undefined && hasBody)) {
        return escalate('authority:publish', 'a mutating `gh api` call')
      }
    }
  }
  for (const word of words) {
    if (AUTHORITY_SCRIPTS.has(basename(word))) return escalate('authority:publish', `\`${basename(word)}\` (a release, cutover or install into the live app)`)
  }
  return null
}

// ── NETWORK ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Programs whose bare `host` or `user@host:` operands are network destinations. */
const NET_PROGRAMS = new Set(['curl', 'wget', 'http', 'https', 'xh', 'nc', 'ncat', 'netcat', 'telnet', 'ssh', 'scp', 'sftp', 'rsync', 'ftp', 'git'])

/**
 * The hosts a command text names: every `scheme://host` anywhere, plus bare and `user@host:` operands of network
 * programs.
 * @param {string} text - the raw command text.
 * @returns {string[]} lowercase host names.
 */
export function hostsNamed(text) {
  const hosts = new Set()
  for (const m of String(text).matchAll(/\b(?:https?|ftps?|wss?|ssh|git|sftp|rsync|telnet):\/\/(?:[^\s/@'"<>]+@)?(\[[^\]\s]+\]|[^\s/:'"<>?#)]+)/giu)) {
    hosts.add(m[1].toLowerCase().replace(/^\[|\]$/gu, ''))
  }
  for (const words of simpleCommands(text).flatMap(effectiveCommands)) {
    const program = basename(words[0] ?? '')
    if (!NET_PROGRAMS.has(program)) continue
    for (const w of words.slice(1)) {
      if (w.startsWith('-') || w.includes('://')) continue
      const scp = (program === 'rsync' || program === 'scp'
        ? /^(?:[\w.-]+@)?([\w.-]+):/iu : /^[\w.-]+@([\w.-]+\.[a-z]{2,}|[\w-]+):/iu).exec(w)
      if (scp !== null) { hosts.add(scp[1].toLowerCase()); continue }
      // A local filename like notes.txt is not a network destination for file-copy commands.
      if (program === 'rsync' || program === 'scp') continue
      if (program !== 'git' && /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?(\/\S*)?$/iu.test(w)) hosts.add(w.toLowerCase().split(/[:/]/u)[0])
    }
  }
  return [...hosts]
}
