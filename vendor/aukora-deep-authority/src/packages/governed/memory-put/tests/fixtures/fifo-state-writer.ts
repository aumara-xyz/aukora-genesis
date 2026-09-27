/** Supply exactly one state value to each blocking broker read. */
import { spawnSync } from 'node:child_process'
import { closeSync, fstatSync, openSync, unlinkSync, writeFileSync } from 'node:fs'

const [path, ...values] = process.argv.slice(2)
if (path === undefined || values.length === 0) throw new Error('fifo writer requires a path and state values')

for (const [index, value] of values.entries()) {
  const descriptor = openSync(path, 'w')
  try {
    const inode = fstatSync(descriptor).ino
    // Opening the writer rendezvous with the broker's reader. Replace the
    // pathname before delivering bytes: the next read must open a different
    // FIFO, so adjacent values cannot share one readFileSync stream.
    unlinkSync(path)
    if (index + 1 < values.length) {
      const created = spawnSync('mkfifo', [path], { encoding: 'utf8' })
      if (created.status !== 0) throw new Error(`mkfifo failed: ${created.stderr}`)
    } else {
      writeFileSync(path, value, { mode: 0o600, flag: 'wx' })
    }
    writeFileSync(descriptor, value, 'utf8')
    process.stdout.write(`${JSON.stringify({ index, inode, value })}\n`)
  } finally {
    closeSync(descriptor)
  }
}
