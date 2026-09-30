#!/usr/bin/env node
// This client only calls the loopback door; it never reads app configuration or keys.
const [route, ...args] = process.argv.slice(2);
const from = process.env.ROOM_ME;
const fail = message => { process.stderr.write(`${message}\n`); process.exitCode = 1; };
const plain = value => String(value).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
async function main() {
  if (!from || !/^[A-Za-z0-9_-]{1,64}$/.test(from)) return fail('Set ROOM_ME to your speaker name (1-64 letters, digits, underscores or hyphens), e.g. ROOM_ME=CLAUDE.');
  if (route !== 'remember' && route !== 'recall') return fail('Unknown Viking command.');
  if (args.length < 1 || args.length > (route === 'recall' ? 2 : 1) || !args[0].trim()) {
    return fail(route === 'remember' ? 'Usage: remember "<text>"' : 'Usage: recall "<question>" [n: 1-10]');
  }
  let body;
  if (route === 'remember') body = { from, text: args[0] };
  else {
    if (args[1] !== undefined && !/^(?:[1-9]|10)$/.test(args[1])) return fail('Recall limit must be an integer from 1 to 10.');
    body = { q: args[0], ...(args[1] === undefined ? {} : { limit: Number(args[1]) }) };
  }
  const json = JSON.stringify(body);
  if (Buffer.byteLength(json) > 16 * 1024) return fail('Request exceeds 16 KiB.');
  const response = await fetch(`http://127.0.0.1:8766/${route}`, {
    method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', 'x-aukora-memory-version': '2' },
    body: json, signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) return fail(`Viking door refused the request (HTTP ${response.status}).`);
  const result = await response.json();
  if (route === 'remember') {
    if (!Number.isInteger(result?.remembered)) return fail('Viking door returned an invalid result.');
    process.stdout.write(`${result.ids?.length ? 'Remembered' : 'Not captured'}${result.index?.pending ? '; indexing pending retry' : ''}.\n`);
  } else {
    if (!Array.isArray(result?.notes)) return fail('Viking door returned an invalid result.');
    if (result.state === 'undetermined') return fail('Memory search unavailable.');
    if (!result.notes.length) process.stdout.write('No matching memories.\n');
    for (const hit of result.notes) process.stdout.write(`${plain(hit.text)}\nscore: ${Number(hit.score)}\nsource: ${plain(hit.uri)}\n\n`);
  }
}
main().catch(() => fail('Viking door unavailable or returned an invalid response; no request details printed.'));
