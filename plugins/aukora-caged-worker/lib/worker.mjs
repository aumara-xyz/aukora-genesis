// Copied as closed code into the cage. No imports of owner code or credentials.
import { createConnection } from 'node:net'
import { readFileSync, readdirSync, openSync, closeSync } from 'node:fs'
const [socketPath, target, ownerGit, workspace] = process.argv.slice(2)
const attempt = fn => { try { fn(); return 'ALLOWED' } catch (error) { return error.code } }
const observations = {
  read: attempt(() => readFileSync(target)),
  write: attempt(() => { const fd = openSync(target, 'r+'); closeSync(fd) }),
  git: attempt(() => readFileSync(ownerGit)),
  workspace: attempt(() => readdirSync(workspace)),
}
function call(request) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath)
    let input = '', finished = false
    const finish = (error, result) => {
      if (finished) return
      finished = true; socket.destroy()
      if (error) reject(error); else resolve(result)
    }
    socket.setEncoding('utf8')
    socket.setTimeout(10_000, () => finish(new Error('worker:broker-timeout')))
    socket.on('connect', () => socket.write(JSON.stringify(request) + '\n'))
    socket.on('data', chunk => {
      input += chunk
      if (Buffer.byteLength(input) > 512 * 1024) return finish(new Error('worker:frame-too-large'))
      if (!input.includes('\n')) return
      try { finish(null, JSON.parse(input.slice(0, input.indexOf('\n')))) }
      catch (error) { finish(error) }
    })
    socket.on('error', error => finish(error))
    socket.on('end', () => finish(new Error('worker:broker-ended')))
  })
}
process.once('message', async ({ arguments: args }) => {
  try {
    const opened = await call({ op: 'proposal.open' })
    if (!opened.ok) throw new Error(opened.reason)
    let result = await call({ op: 'proposal.deposit', proposalNamespace: opened.proposalNamespace,
      callId: 'one-patch', toolName: 'workspace.patch', arguments: args })
    const until = Date.now() + 320_000
    while (result.state === 'PENDING' && Date.now() < until) {
      await new Promise(resolve => setTimeout(resolve, 100))
      result = await call({ op: 'proposal.status', proposalNamespace: opened.proposalNamespace, proposalId: result.proposalId })
    }
    process.send({ result }, () => process.disconnect())
  } catch (error) { process.send({ error: error.message }, () => process.disconnect()) }
})
process.on('disconnect', () => process.exit(0))
process.send({ ready: true, ...observations })
