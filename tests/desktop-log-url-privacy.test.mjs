// Synthetic diagnostic URLs only; no Electron, network, installed logs or account state.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { installDesktopLog } from '../apps/aukora-desktop/desktop-log.mjs'

test('renderer failure diagnostics omit URL credentials and retain failure context', () => {
  const scratch = mkdtempSync('/tmp/aukora-desktop-log-test-')
  const app = new EventEmitter()
  const levels = ['log', 'info', 'warn', 'error']
  const consoleBefore = Object.fromEntries(levels.map(level => [level, console[level]]))
  const events = ['uncaughtExceptionMonitor', 'unhandledRejection']
  const listenersBefore = new Map(events.map(event => [event, new Set(process.listeners(event))]))
  try {
    const { path } = installDesktopLog({ app, stateRoot: scratch })
    const samples = [
      ['https://fixture-user:fixture-password@example.invalid:8443/api/tasks#access_token=fixture-fragment',
        'https://example.invalid:8443/api/tasks'],
      ['https://fixture%2Dencoded:fixture%2Dpassword@example.invalid/api/tasks?api_key=fixture-query#fixture-anchor',
        'https://example.invalid/api/tasks'],
      ['http://127.0.0.1:64281/plugins/client.js', 'http://127.0.0.1:64281/plugins/client.js'],
      ['invalid-url-fixture-secret', '(unparseable URL)'],
    ]
    for (const [url] of samples) app.emit('render-process-gone', null,
      { getURL: () => url }, { reason: 'crashed', exitCode: 7 })
    app.emit('render-process-gone', null, { getURL: () => { throw new Error('destroyed') } },
      { reason: 'killed', exitCode: 9 })
    const text = readFileSync(path, 'utf8')
    const diagnostics = text.split('\n').filter(line => line.includes('render-process-gone'))
    assert.equal(diagnostics.length, samples.length + 1, 'every failure is still logged')
    assert.ok(!text.includes('fixture'), 'no plain or encoded credential fixture reaches the log')
    samples.forEach(([, expected], i) => assert.ok(diagnostics[i].endsWith(
      `render-process-gone reason=crashed exitCode=7 ${expected}`), 'safe URL and crash details survive'))
    assert.ok(diagnostics.at(-1).endsWith('render-process-gone reason=killed exitCode=9 '))
  } finally {
    Object.assign(console, consoleBefore)
    for (const event of events) for (const listener of process.listeners(event)) {
      if (!listenersBefore.get(event).has(listener)) process.removeListener(event, listener)
    }
    app.removeAllListeners()
    rmSync(scratch, { recursive: true, force: true })
  }
})

test('launch diagnostics redact startup credentials while private boot transports retain them', () => {
  const scratch = mkdtempSync('/tmp/aukora-launch-url-test-')
  try {
    // Execute only the existing URL helpers, record serialization and stdout statement.
    // The launcher entry point, provenance checks and child launch never execute.
    const checked = spawnSync('python3', ['-c', String.raw`
import ast, contextlib, io, json, os, re, stat, sys, time
from pathlib import Path
from types import SimpleNamespace

source = Path(sys.argv[1]).read_text()
tree = ast.parse(source)
helpers = [node for node in tree.body
           if (isinstance(node, ast.FunctionDef) and node.name in
               ('redact_token', '_publish_url', '_new_log_text'))
           or (isinstance(node, ast.Assign) and any(isinstance(target, ast.Name)
               and target.id == 'TOKEN_IN_URL' for target in node.targets))]
record_node = next(node for node in tree.body if isinstance(node, ast.Assign)
                   and any(isinstance(target, ast.Name) and target.id == 'record'
                           for target in node.targets))
startup = next(value for key, value in zip(record_node.value.keys, record_node.value.values)
               if isinstance(key, ast.Constant) and key.value == 'startup')
write = next(node for node in tree.body if isinstance(node, ast.Expr)
             and isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Attribute)
             and node.value.func.attr == 'write_text' and "launch.json" in ast.get_source_segment(source, node))
announce = next(node for node in tree.body if isinstance(node, ast.If)
                and isinstance(node.test, ast.Name) and node.test.id == 'url')
namespace = {'re': re, 'json': json, 'os': os, 'time': time,
             'base': Path(sys.argv[2]), 'child': SimpleNamespace(pid=64281),
             'startup_timeout': 20, 'readiness': 'ready: the child printed its URL inside the window'}
exec(compile(ast.Module(body=helpers, type_ignores=[]), '<launcher URL helpers>', 'exec'), namespace)
cases = [
    ('http://127.0.0.1:64281/?token=fixture-credential', ['fixture-credential']),
    ('http://127.0.0.1:64281/?trace=1&token=fixture%2Dcredential&hint=ready', ['fixture%2Dcredential']),
    ('http://127.0.0.1:64281/?token=fixture-first&token=fixture-second', ['fixture-first', 'fixture-second']),
]
for raw_url, credentials in cases:
    line = 'dsh web: ' + raw_url + '\n'
    namespace.update(url=line.strip(), _live=[line])
    namespace['record'] = {'pid': namespace['child'].pid,
                           'startup': eval(compile(ast.Expression(body=startup), '<startup record>', 'eval'), namespace)}
    exec(compile(ast.Module(body=[write], type_ignores=[]), '<launch record write>', 'exec'), namespace)
    diagnostic = (namespace['base'] / 'launch.json').read_text()
    assert all(credential not in diagnostic for credential in credentials), 'diagnostic credential leak'
    recorded = json.loads(diagnostic)
    assert recorded['startup']['windowSeconds'] == 20
    assert recorded['startup']['readiness'] == namespace['readiness']
    assert 'http://127.0.0.1:64281/' in recorded['startup']['url'], 'diagnostic endpoint lost'
    assert '<redacted>' in recorded['startup']['url'], 'diagnostic redaction marker missing'

    assert namespace['_new_log_text']() == line, 'startup stream changed'
    namespace['_publish_url'](line)
    private_file = namespace['base'] / 'launch-url.json'
    private = json.loads(private_file.read_text())
    assert private['url'] == raw_url, 'private authenticated URL changed'
    assert private['token'] == credentials[0], 'private authentication credential changed'
    assert private['pid'] == 64281, 'private URL PID binding changed'
    assert stat.S_IMODE(private_file.stat().st_mode) == 0o600, 'private URL permissions changed'
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        exec(compile(ast.Module(body=[announce], type_ignores=[]), '<private launcher pipe>', 'exec'), namespace)
    announced = output.getvalue()
    assert all(credential not in announced for credential in credentials), 'launcher stdout credential leak'
    # supervisor.mjs takes the url only from a launch-url.json whose pid is the one announced here.
    assert re.search(r'Spawned Genesis PID (\d+)', announced).group(1) == str(private['pid']), 'announced PID is not the published PID'

namespace['url'] = None
empty = eval(compile(ast.Expression(body=startup), '<startup without URL>', 'eval'), namespace)
assert empty['url'] is None, 'no-URL startup contract changed'
print(json.dumps({'cases': len(cases), 'privateTransportsPreserved': True, 'diagnosticsRedacted': True, 'stdoutRedacted': True}))
`, new URL('../scripts/launch-dsh.py', import.meta.url).pathname, scratch], { encoding: 'utf8' })
    assert.equal(checked.status, 0, checked.stderr || 'synthetic launcher URL check failed')
    assert.deepEqual(JSON.parse(checked.stdout), {
      cases: 3, privateTransportsPreserved: true, diagnosticsRedacted: true, stdoutRedacted: true,
    })
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})
