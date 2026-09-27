// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE DOORWAY'S SKIN — an MCP server over stdio, one JSON-RPC message per
// line. Everything it can say lives in doorway.mjs; this file only carries
// the post. Run it with:  bun doorway/server.mjs
// and register it in an AI coder's MCP configuration as a stdio server.
// It reads stdin, writes stdout, and touches nothing else.

import { toolsList, toolCall, SERVER_INFO } from './doorway.mjs';

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

for await (const line of console) {
  if (!line.trim()) continue;
  let msg;
  try { msg = JSON.parse(line); } catch { continue; }   // not ours to answer
  const { id, method, params } = msg;
  if (method === 'initialize') {
    reply(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    });
  } else if (method === 'notifications/initialized' || String(method).startsWith('notifications/')) {
    // notifications carry no id and want no answer
  } else if (method === 'ping') {
    reply(id, {});
  } else if (method === 'tools/list') {
    reply(id, { tools: toolsList() });
  } else if (method === 'tools/call') {
    try {
      reply(id, toolCall(params?.name, params?.arguments || {}));
    } catch (e) {
      fail(id, -32603, 'the derivation failed: ' + (e?.message || String(e)));
    }
  } else if (id !== undefined) {
    fail(id, -32601, 'no such method through this doorway');
  }
}
