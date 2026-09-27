/** Real Loader and agent-loop driver over a test-owned external socket responder. */
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { CallId } from '@deepseek-ai/dsh-llm'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('workspace patch fixture requires a config path')

const ctx = await boot('workspace-patch-loader-fixture', resolveConfigPath(configPath, undefined))
try {
  let guestApprovalRequests = 0
  ctx.on('approval/request', async () => {
    guestApprovalRequests += 1
    return 'allowed-once'
  })
  const transcript: unknown[] = []
  let requestSchemas: unknown
  await runFixtureTurn(ctx, {
    task: 'Propose creating note.txt in the configured project workspace.',
    onEvent: (_sessionId, event) => {
      if (event.type === 'request/header') requestSchemas = event.data.header.tools
      if (event.type === 'user/message') transcript.push({ type: event.type, content: event.data.content })
      if (event.type === 'assistant/message' || event.type === 'tool/result') {
        transcript.push({ type: event.type, content: event.data.message.content })
      }
      if (event.type === 'tool/call') {
        transcript.push({ type: event.type, name: event.data.name, arguments: event.data.arguments })
      }
    },
  })
  if (requestSchemas === undefined) throw new Error('workspace fixture did not log the model tool schemas')
  const shell = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId('workspace-fixture-shell-probe'),
    name: 'bash',
    arguments: {},
  })
  process.stdout.write(`${JSON.stringify({
    fixture: 'scripted model and unsigned transport responses; no attended approval',
    schemas: requestSchemas,
    guestApprovalRequests,
    shellUnavailable: shell.isError,
    transcript,
  })}\n`)
} finally {
  await ctx.fiber.dispose()
}
