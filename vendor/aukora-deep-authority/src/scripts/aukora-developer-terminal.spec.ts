/** The parent approval reader preserves input bytes and makes TTY editing visible. */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const terminalModule = new URL('../aukora/supervisor/developer-terminal.mjs', import.meta.url).href
const checkout = fileURLToPath(new URL('..', import.meta.url))

describe('parent terminal approval input', () => {
  it.each([true, false])('reads exact lines with terminal=%s and echoes only terminal edits', (tty) => {
    // A pipe with TTY editing enabled exercises readline without borrowing the operator's terminal.
    const source = `
      import { createTerminalLines } from ${JSON.stringify(terminalModule)};
      Object.defineProperty(process.stdin, 'isTTY', { value: ${String(tty)} });
      const rawModes = [];
      process.stdin.setRawMode = mode => { rawModes.push(mode); };
      const terminal = createTerminalLines();
      try {
        const line = await terminal.read(new AbortController().signal);
        process.stdout.write(JSON.stringify({ line }) + '\\n');
      } finally {
        terminal.close();
        process.stdout.write(JSON.stringify({ rawModes }) + '\\n');
      }
    `
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd: checkout, input: 'HELIX_TTY_TYPED\n', encoding: 'utf8', timeout: 5_000,
    })
    expect(child.error).toBeUndefined()
    expect(child.status).toBe(0)
    expect(child.stdout).toBe(`${JSON.stringify({ line: 'HELIX_TTY_TYPED' })}\n${JSON.stringify({ rawModes: tty ? [true, false] : [] })}\n`)
    if (tty) expect(child.stderr).toContain('HELIX_TTY_TYPED')
    else expect(child.stderr).toBe('')
  })
})
