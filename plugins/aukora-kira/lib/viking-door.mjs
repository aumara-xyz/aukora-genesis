/** Maintained source of the loopback Viking door. Imports have no side effects. */
import http from 'node:http'
import { createTrackedMemory, validExternalOrigin } from './tracked-memory.mjs'
import { contentUri, SEMANTIC_DEFAULTS } from './recall-openviking.mjs'
const MAX_BODY = 16 * 1024
class DoorError extends Error { constructor(status, message) { super(message); this.status = status } }

export function createVikingDoor({ memory, stateDir, subject, config, fetch, port = 8766, logger } = {}) {
  memory ??= createTrackedMemory({ stateDir, subject, config, fetch })
  const remember = async body => {
    if (!validExternalOrigin(body.from) || typeof body.text !== 'string' || !body.text.trim())
      throw new DoorError(400, 'Expected {from, text}.')
    return memory.remember({ text: body.text, from: body.from, scope: 'agent' })
  }
  const recall = async body => {
    if (typeof body.q !== 'string' || !body.q.trim() || (body.limit !== undefined && (!Number.isInteger(body.limit) || body.limit < 1 || body.limit > 10)))
      throw new DoorError(400, 'Expected {q, limit}, with a limit from 1 to 10.')
    if (body.lexical !== undefined && typeof body.lexical !== 'boolean') throw new DoorError(400, 'lexical must be boolean.')
    return memory.recall({ question: body.q, limit: body.limit, lexical: body.lexical === true })
  }
  const server = http.createServer(async (req, res) => {
    const route = req.url === '/remember' || req.url === '/recall' ? req.url : '<other>';
    const method = ['POST', 'GET', 'HEAD', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'].includes(req.method) ? req.method : '<other>';
    let length = 0;
    res.once('finish', () => logger?.(`${method} ${route} ${res.statusCode} ${length}`));
    const send = (status, value) => {
      let data = JSON.stringify(value);
      if ((config?.key && data.includes(config.key))) { status = 502; data = '{"error":"Response suppressed."}'; }
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(data), 'cache-control': 'no-store', 'connection': 'close' });
      res.end(data);
    };
    try {
      // NOT FROM A BROWSER. Local CLIs send no Origin, the exact loopback Host and a JSON body. A web page can reach
      // 127.0.0.1 too, but it always sends an Origin, and a JSON content type forces a CORS preflight this door never answers.
      const host = String(req.headers.host ?? '');
      const ctype = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (req.headers.origin !== undefined || req.headers.referer !== undefined
          || (host !== `127.0.0.1:${server.address()?.port ?? port}` && host !== `localhost:${server.address()?.port ?? port}`)
          || (req.method === 'POST' && ctype !== 'application/json')) {
        send(403, { error: 'local command-line callers only' });
        return;
      }
      if (req.method !== 'POST' || route === '<other>') {
        req.resume();
        return send(404, { error: 'Not found.' });
      }
      const declared = Number(req.headers['content-length']);
      if (Number.isFinite(declared) && declared > MAX_BODY) {
        length = declared; throw new DoorError(413, 'Body exceeds 16 KiB.');
      }
      const chunks = [];
      // Keep the socket writable when rejecting oversized chunked bodies.
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        length += chunk.length;
        if (length > MAX_BODY) throw new DoorError(413, 'Body exceeds 16 KiB.');
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      if ((config?.key && raw.includes(config.key))) throw new DoorError(400, 'Request refused.');
      let body;
      try { body = JSON.parse(raw); } catch { throw new DoorError(400, 'Expected a JSON object.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DoorError(400, 'Expected a JSON object.');
      // Also refuse JSON-escaped credential text without reflecting it anywhere.
      if ((config?.key && JSON.stringify(body).includes(config.key))) throw new DoorError(400, 'Request refused.');
      const value = await (route === '/remember' ? remember(body) : recall(body));
      // Existing private CLIs consume a boolean write receipt and an array of hits.
      // Maintained callers opt into the richer envelope without breaking those CLIs.
      if (req.headers['x-aukora-memory-version'] === '2') send(route === '/remember' ? 201 : 200, value);
      else if (route === '/remember') {
        const notes = value.notes?.length ? value.notes : value.ids?.length
          ? memory.read().notes.filter(note => value.ids.includes(note.id)) : [];
        const sources = notes.map(note => contentUri(config?.user ?? SEMANTIC_DEFAULTS.user,
          note.contentHash));
        send(201, { ...value, remembered: Boolean(value.ids?.length), from: body.from,
          at: notes[0]?.observedAt ?? new Date().toISOString(), source: sources[0] ?? null, sources });
      }
      else {
        if (value.state === 'undetermined') throw new DoorError(503, 'Memory search unavailable.');
        res.setHeader('x-aukora-memory-dropped-tampered', String(value.dropped?.tampered?.length ?? 0));
        if (value.degraded === true) res.setHeader('x-aukora-memory-degraded', 'true');
        send(200, value.notes.map(note => ({ ...note, source: note.uri,
          ...(value.degraded === true ? { degraded: true, method: value.method, semantic: value.semantic } : {}) })));
      }
    } catch (error) {
      if (!res.headersSent && !res.destroyed) send(error instanceof DoorError ? error.status : 500,
        { error: error instanceof DoorError ? error.message : 'Viking door request failed; details suppressed.' });
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });

  let retryTimer, initialRetry
  const listen = async () => {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
    initialRetry = setImmediate(() => void memory.retry().catch(() => {})); initialRetry.unref()
    retryTimer = setInterval(() => void memory.retry().catch(() => {}), 30_000); retryTimer.unref()
    return server.address()
  }
  const close = () => { clearImmediate(initialRetry); clearInterval(retryTimer); return new Promise(resolve => server.close(resolve)) }
  return Object.freeze({ server, listen, close, remember, recall, memory })
}
