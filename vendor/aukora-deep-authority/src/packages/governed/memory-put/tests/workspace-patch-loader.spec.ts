/** Assembled model transcript over an external transport fixture, not a custody or approval test. */
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const driver = fileURLToPath(new URL('./workspace-patch-loader-driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/governed/workspace-patch/cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))
const proposalNamespace = 'a'.repeat(32)
const proposalId = 'b'.repeat(32)
const secretlessEnv = Object.fromEntries(Object.keys(process.env)
  .filter(name => /KEY|SECRET|TOKEN|PASSWORD/i.test(name))
  .map(name => [name, undefined]))

async function runFixture(state: 'SETTLED' | 'REFUSED' | 'INDETERMINATE') {
  const root = await mkdtemp(join(tmpdir(), 'wp-'))
  const socketPath = join(root, 's')
  const sockets = new Set<Socket>()
  const requests: Record<string, unknown>[] = []
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    let buffered = ''
    socket.on('data', (chunk: Buffer) => {
      buffered += chunk.toString('utf8')
      const end = buffered.indexOf('\n')
      if (end < 0) return
      const request = JSON.parse(buffered.slice(0, end)) as Record<string, unknown>
      requests.push(request)
      let reply: Record<string, unknown>
      if (request.op === 'proposal.open') reply = { ok: true, proposalNamespace }
      else if (request.op === 'proposal.deposit') reply = { ok: true, proposalId, state: 'PENDING' }
      else if (request.op === 'proposal.status') reply = state === 'SETTLED'
        ? { ok: true, proposalId, state, receipt: { fixture: 'unsigned transport fixture' } }
        : { ok: false, proposalId, state, reason: 'fixture:parent-outcome' }
      else reply = { ok: false, state: 'REFUSED', reason: 'fixture:unknown-operation' }
      socket.end(`${JSON.stringify(reply)}\n`)
    })
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(socketPath, resolve)
    })
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'workspace patch Loader transport fixture',
      tempDirPrefix: 'workspace-patch-loader-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath,
      env: { ...secretlessEnv, WORKSPACE_PATCH_FIXTURE_SOCKET: socketPath },
    })
    expect(stderr).not.toContain('UNHANDLED')
    const line = stdout.trim().split('\n').find(value => value.startsWith('{"fixture":'))
    if (line === undefined) throw new Error(`workspace fixture report missing: ${stdout}`)
    const report = JSON.parse(line) as Record<string, unknown>
    expect(requests.map(request => request.op)).toEqual(['proposal.open', 'proposal.deposit', 'proposal.status'])
    expect(requests[1]).toEqual({
      op: 'proposal.deposit', proposalNamespace,
      callId: 'workspace-patch-fixture-call', toolName: 'workspace.patch',
      arguments: { workspace: 'project', path: 'note.txt', beforeSha256: null, content: 'hello\n' },
    })
    expect(report.guestApprovalRequests).toBe(0)
    expect(report.shellUnavailable).toBe(true)
    return report
  } finally {
    for (const socket of sockets) socket.destroy()
    if (server.listening) await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      })
    })
    await rm(root, { recursive: true, force: true })
  }
}

describe.runIf(process.platform !== 'win32')('workspace.patch through Loader and the real agent loop', () => {
  it('publishes only the governed tool and logs its transport result', async () => {
    expect(await runFixture('SETTLED')).toMatchInlineSnapshot(`
      {
        "fixture": "scripted model and unsigned transport responses; no attended approval",
        "guestApprovalRequests": 0,
        "schemas": [
          {
            "description": "Replace one UTF-8 file in a configured workspace after approval of the exact replacement. Supply the current SHA-256 digest, or null to create only.",
            "name": "workspace.patch",
            "parameters": {
              "properties": {
                "beforeSha256": {
                  "description": "SHA-256 of the current file bytes, or null if the file must not exist.",
                  "oneOf": [
                    {
                      "type": "string",
                    },
                    {
                      "type": "null",
                    },
                  ],
                },
                "content": {
                  "description": "Complete replacement UTF-8 text, including any desired final newline.",
                  "type": "string",
                },
                "path": {
                  "description": "Relative file path within the configured workspace.",
                  "type": "string",
                },
                "workspace": {
                  "description": "Configured workspace name.",
                  "type": "string",
                },
              },
              "required": [
                "workspace",
                "path",
                "beforeSha256",
                "content",
              ],
              "type": "object",
            },
          },
        ],
        "shellUnavailable": true,
        "transcript": [
          {
            "content": [
              {
                "text": "Propose creating note.txt in the configured project workspace.",
                "type": "text",
              },
            ],
            "type": "user/message",
          },
          {
            "content": [
              {
                "arguments": "{"workspace":"project","path":"note.txt","beforeSha256":null,"content":"hello\\n"}",
                "id": "workspace-patch-fixture-call",
                "name": "workspace.patch",
                "type": "tool-call",
              },
            ],
            "type": "assistant/message",
          },
          {
            "arguments": "{"workspace":"project","path":"note.txt","beforeSha256":null,"content":"hello\\n"}",
            "name": "workspace.patch",
            "type": "tool/call",
          },
          {
            "content": [
              {
                "content": [
                  {
                    "text": "{"ok":true,"proposalId":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","state":"SETTLED","receipt":{"fixture":"unsigned transport fixture"}}",
                    "type": "text",
                  },
                ],
                "isError": false,
                "toolCallId": "workspace-patch-fixture-call",
                "type": "tool-result",
              },
            ],
            "type": "tool/result",
          },
          {
            "content": [
              {
                "text": "Scripted fixture observed the tool result.",
                "type": "text",
              },
            ],
            "type": "assistant/message",
          },
        ],
      }
    `)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('preserves refusal and uncertainty despite a guest approval answerer', async () => {
    const outcomes = []
    for (const state of ['REFUSED', 'INDETERMINATE'] as const) {
      const report = await runFixture(state)
      const transcript = report.transcript as Array<{ type: string; content: unknown }>
      outcomes.push({ state, result: transcript.filter(event => event.type === 'tool/result') })
    }
    expect(outcomes).toMatchInlineSnapshot(`
      [
        {
          "result": [
            {
              "content": [
                {
                  "content": [
                    {
                      "text": "Error: workspace.patch refused: fixture:parent-outcome",
                      "type": "text",
                    },
                  ],
                  "isError": true,
                  "toolCallId": "workspace-patch-fixture-call",
                  "type": "tool-result",
                },
              ],
              "type": "tool/result",
            },
          ],
          "state": "REFUSED",
        },
        {
          "result": [
            {
              "content": [
                {
                  "content": [
                    {
                      "text": "Error: workspace.patch indeterminate: fixture:parent-outcome",
                      "type": "text",
                    },
                  ],
                  "isError": true,
                  "toolCallId": "workspace-patch-fixture-call",
                  "type": "tool-result",
                },
              ],
              "type": "tool/result",
            },
          ],
          "state": "INDETERMINATE",
        },
      ]
    `)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
