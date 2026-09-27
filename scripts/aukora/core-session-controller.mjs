#!/usr/bin/env node
// core-session-controller.mjs — THE DEFAULT CONTROLLER: THE RUNNING APP'S OWN SESSION API, OR A REFUSAL BY NAME.
//
// `create-core-session.mjs` needs exactly two things from a controller: `listSessions()` and
// `createSession({title, preset, model, effort})`. This module speaks to the app at the `attachUrl` its
// `config.json` publishes, in the contract THE RELEASE ITSELF SPEAKS. Nothing below is invented: each fact is
// read from the built release's own bytes (paths are under the release root, lines as shipped in
// aukora-release-fbcc1f20a1cf). The two exceptions are facts about the DESKTOP SHELL, which is not in the
// release: they cite the Genesis checkout (`apps/aukora-desktop/…`) and say so where they are used.
//
//   * THE CARRIER. The shipped client reaches every Remote through one call,
//     `connection.rpc.call("/api", endpoint, { args })` (packages/api/gateway/lib/client.js:1617), where
//     `endpoint` is `<namespace>/<method>` (:1797) and `args` is keyed by each parameter's WIRE name (:1650-1663).
//     `createWebConnectionRpc` (packages/client/connection/lib/client.js:1113) sends it as
//     `POST <origin>/api/<endpoint>`, `content-type: application/json`, body
//     `{type:'client-request', rpcId, method:<endpoint>, payload:{args}}`, treats a non-2xx as a transport
//     failure (:1131), refuses an answer to a different rpcId (:1133), and accepts only
//     `{type:'server-response', rpcId, result:{ok:true, value} | {ok:false, error:{code, message, details}}}`
//     (:1143-1166). The host half (packages/client/connection/lib/index.js:635-662) serves exactly that and
//     refuses a `method` that differs from the path; the gateway refuses args whose TOP-LEVEL keys are not
//     exactly the descriptor's wire names (packages/api/gateway/lib/index.js:1040-1052). INSIDE a request the
//     generated schemas are plain, non-strict zod objects (typert.host.js has no `.strict()`), so a field the
//     schema does not define is DROPPED SILENTLY, not refused: this module sends only fields the schema defines,
//     and nothing it sends can be "accepted" by being ignored.
//   * THE ENDPOINTS. `SessionController` is the `session` namespace
//     (packages/api/session-controller/lib/index.js:2726, `Remote("list")`… at :2499-2506). Wire names and
//     shapes are the generated descriptors in packages/api/session-controller/lib/typert.host.js:
//       session/list        args {_request: {}}                                       -> {items: SessionSummary[]}
//       session/create      args {request: {agentPreset}}                             -> {sessionId, agentPreset?}
//       session/selectModel args {request: {sessionId, provider, model, reasoningEffort}} -> {selected}
//       session/rename      args {request: {sessionId, title}}                        -> {title, seq}
//     (list :436-446 and :947-967; create :235-245 and :870-890; rename :633-643; selectModel :655-669). A list
//     row carries NO title field: the title is the `title` projection, `items[i].projections.values.title`
//     (:458), and a row's projections are OMITTED when the projection cache has nothing for it
//     (packages/api/session-controller/lib/index.js:1947-1958). The shipped client lists with
//     `remote.session.list({})` and creates with `remote.session.create(payload)`
//     (packages/api/session-controller/lib/client.js:2497, :2574).
//   * THE DOOR. Every `/api` request is refused 401 without the signed browser-session cookie
//     (packages/client/connection/lib/index.js:553-556, :612), and the one way to obtain it is
//     `GET <origin>/?token=<launch token>`, answered 303 with `Set-Cookie: dsh-auth-<base64url sha256(host)>=…`
//     (:280-282, :386-410). The desktop shell spends a token URL once and rewrites `attachUrl` to the bare
//     origin (`forgetBootstrapToken`, apps/aukora-desktop/main.mjs:130 IN THE GENESIS CHECKOUT, not the
//     release), so a bare origin here means THIS PROCESS
//     HAS NO CREDENTIAL: the request still goes out, and the app's 401 comes back as a named refusal that says
//     what to supply. No cookie jar, credential store or state root is read.
//
// CREATING IS THREE REQUESTS, BECAUSE THE RELEASE HAS NO ONE REQUEST THAT CARRIES ALL FOUR FIELDS:
// `session/create` takes the preset only (index.js:571-601). The model and effort (`session/selectModel`,
// index.js:605-635) and the title (`session/rename`, index.js:640-655) are applied to the new id afterwards.
// THE TITLE GOES LAST, because the title is what `create-core-session.mjs` reads to decide that CORE already
// exists: a session only becomes "the CORE session" once its preset and its model have both read back as asked.
// Read-back is exact because the release neither clamps nor aliases a selection
// (packages/llm/llm/lib/index.js:2120). Any failure after the create names the id that WAS created. A create
// request that got no usable answer (deadline, connection, non-2xx, bad envelope) cannot name an id, so its
// refusal says a new UNTITLED session on the preset may exist: never a second CORE, because the title is last.
// KNOWN SIDE EFFECT, STATED SO NOBODY IS SURPRISED BY IT: the release's `session/selectModel` also saves the
// selection as the deployment's default model (index.js:621, `agentDefaultModel.saveSelection`).
//
// THE CALLER'S SUPPORT ROOT IS THE ONE THIS CONTROLLER WRITES TO, OR NOTHING IS WRITTEN. The app's address is
// read from `$AUKORA_SUPPORT_ROOT/config.json`, else `~/Library/Application Support/AUKORA/config.json`.
// `create-core-session.mjs --support-root X` checks the release under X but does not hand X to this module
// (that tool is outside this order and must not change). So when the calling process names `--support-root`,
// this controller refuses unless it names the directory the controller reads, BEFORE reading any config: a run
// someone believes is isolated must never create, select a model on, or rename a session in another app.
// Paths are compared resolved but not realpath-ed, so a different spelling of the same directory is refused too.
// NOT FENCED HERE: a caller given no --support-root while AUKORA_SUPPORT_ROOT points elsewhere checks the default
// release but reaches the env's app. Only the caller handing its root to the controller closes that (its own order).
//
// REFUSALS, ALL BY NAME, NONE EVER RETURNED AS AN EMPTY ANSWER:
//   * `controller-unavailable` — a caller's --support-root that is not the one read here, no readable config,
//     no usable attachUrl, a non-loopback one, no answer within the deadline, a non-2xx, a body that is not the
//     server-response to THIS request in the release client's own shape, or a list that cannot vouch for every
//     title in it.
//   * `controller-refused` — the app answered `ok:false`, a create came back without an id, or a created
//     session did not read back as the preset, model or title it was asked for.
// Every request has a 5 s deadline and none is retried.
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const SUPPORT = process.env.AUKORA_SUPPORT_ROOT ?? join(homedir(), 'Library', 'Application Support', 'AUKORA');
const DEADLINE_MS = 5000;

class ControllerError extends Error {
  constructor(reason, detail) { super(`${reason}: ${detail}`); this.reason = reason; this.detail = detail; }
}
const unavailable = (detail) => new ControllerError('controller-unavailable', detail);
const refused = (detail) => new ControllerError('controller-refused', detail);
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The app's origin and host, and the launch token if attachUrl still carries one. The token is never printed. */
function target() {
  const named = process.argv.indexOf('--support-root');
  if (named !== -1 && resolve(process.argv[named + 1] ?? '') !== resolve(SUPPORT)) {
    throw unavailable(`the calling process names --support-root ${String(process.argv[named + 1])}, but this controller reaches the app named in ${join(SUPPORT, 'config.json')} (AUKORA_SUPPORT_ROOT, else ~/Library/Application Support/AUKORA). Refusing before this controller reads any config: set AUKORA_SUPPORT_ROOT to the same directory`);
  }
  const path = join(SUPPORT, 'config.json');
  let raw;
  try { raw = JSON.parse(readFileSync(path, 'utf8')).attachUrl; } catch (error) {
    throw unavailable(`the app's config at ${path} cannot be read (${String(error?.code ?? error?.message ?? error)})`);
  }
  if (typeof raw !== 'string' || raw.length === 0) {
    throw unavailable(`the app publishes no attachUrl in ${path}, so its session API has no address this tool can reach`);
  }
  let url;
  try { url = new URL(raw); } catch {
    throw unavailable(`the attachUrl in ${path} is not a URL`);
  }
  // PARSE, NEVER PREFIX-MATCH, and the same policy the desktop shell applies to the same key
  // (apps/aukora-desktop/url-policy.mjs:23 IN THE GENESIS CHECKOUT): a launch token and session writes go to
  // 127.0.0.1 over http or nowhere.
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
    throw unavailable(`the attachUrl names ${url.protocol}//${url.hostname}, not http://127.0.0.1: this controller sends the app's launch token and session requests to this machine's loopback only`);
  }
  return { origin: url.origin, host: url.host, token: url.searchParams.get('token') || null };
}

/** One bounded HTTP exchange: an answer (status and whole body) within the deadline, or a named refusal. */
async function exchange(url, init, what) {
  try {
    const response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(DEADLINE_MS) });
    return { response, text: await response.text() };
  } catch (error) {
    const why = error?.name === 'TimeoutError' ? `no answer within ${String(DEADLINE_MS)} ms` : `the connection failed (${String(error?.cause?.code ?? error?.message ?? error)})`;
    throw unavailable(`${what} at ${new URL(url).origin}: ${why}`);
  }
}

/** The browser-session cookie, minted by the release's own token exchange, or null when there is no token. */
async function connect() {
  const { origin, host, token } = target();
  if (token === null) return { origin, cookie: null };
  // The cookie the release mints is named for the authority the request reached (index.js:280-282, :392-405).
  const name = `dsh-auth-${createHash('sha256').update(host).digest('base64url')}`;
  const { response } = await exchange(`${origin}/?${new URLSearchParams({ token }).toString()}`, { method: 'GET' }, 'the launch-token exchange');
  const cookie = response.headers.getSetCookie().map((line) => line.split(';', 1)[0].trim()).find((pair) => pair.startsWith(`${name}=`));
  if (response.status !== 303 || cookie === undefined) {
    throw unavailable(`the app did not accept the launch token in attachUrl (HTTP ${String(response.status)}, ${cookie === undefined ? `no ${name} cookie` : 'a cookie'}); a launch token is valid only for the backend process that printed it`);
  }
  return { origin, cookie };
}

/** One Remote call on the app's /api carrier: the value the app returned for THIS request, or a named refusal. */
async function remote(conn, endpoint, args) {
  const rpcId = randomUUID();
  const headers = { 'content-type': 'application/json', ...(conn.cookie === null ? {} : { cookie: conn.cookie }) };
  const body = JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: { args } });
  const { response, text } = await exchange(`${conn.origin}/api/${endpoint}`, { method: 'POST', headers, body }, endpoint);
  if (response.status < 200 || response.status > 299) {
    const unauthenticated = response.status === 401 || response.status === 403;
    throw unavailable(`${endpoint} answered HTTP ${String(response.status)}${unauthenticated
      ? ': the app serves /api only to a client holding its browser-session cookie, minted from the launch token. Put the launcher URL WITH ?token=… in attachUrl (the desktop shell rewrites it to the bare origin once it has spent it)'
      : ` (${text.slice(0, 120)})`}`);
  }
  let envelope;
  try { envelope = JSON.parse(text); } catch {
    throw unavailable(`${endpoint} answered HTTP ${String(response.status)} with a body that is not JSON (${text.slice(0, 80)})`);
  }
  // THE RELEASE CLIENT'S OWN ACCEPTANCE RULE (client.js:1133, :1143-1166, `parseConnectionResponse`): the
  // server-response to THIS rpcId, with a result that is ok:true, or ok:false carrying an error record with a
  // string code, a string message and a details record. Anything else is not an answer.
  const result = envelope?.result;
  const failure = isRecord(result) && result.ok === false ? result.error : undefined;
  const wellFormedFailure = isRecord(failure)
    && typeof failure.code === 'string'
    && typeof failure.message === 'string'
    && isRecord(failure.details);
  if (!isRecord(envelope) || envelope.type !== 'server-response' || envelope.rpcId !== rpcId
    || !isRecord(result)
    || !(result.ok === true || (result.ok === false && wellFormedFailure))) {
    throw unavailable(`${endpoint} answered with something that is not the server-response to request ${rpcId} (${text.slice(0, 80)})`);
  }
  if (result.ok === false) {
    throw refused(`${endpoint}: the app said no: ${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

export async function listSessions() {
  const conn = await connect();
  const value = await remote(conn, 'session/list', { _request: {} });
  const items = value?.items;
  if (!Array.isArray(items)) {
    throw unavailable(`session/list answered without a list (${JSON.stringify(value ?? null).slice(0, 80)})`);
  }
  if (!items.every((item) => typeof item?.sessionId === 'string' && item.sessionId.length > 0)) {
    throw unavailable(`session/list answered rows without a session id (${JSON.stringify(items).slice(0, 80)})`);
  }
  // A TITLE THE APP DID NOT REPORT IS UNKNOWN, NOT "NOT CORE". The caller refuses a second CORE by reading
  // titles, so a row without one would let it create a second: the whole list is refused instead.
  const untitled = items.filter((item) => {
    const values = item.projections?.values;
    return !isRecord(values) || !Object.hasOwn(values, 'title') || (typeof values.title !== 'string' && values.title !== null);
  });
  if (untitled.length > 0) {
    throw unavailable(`session/list reports no title for ${String(untitled.length)} of ${String(items.length)} session(s) (${untitled.slice(0, 5).map((item) => item.sessionId).join(', ')}): any of them could be CORE, so this list cannot say that no CORE session exists`);
  }
  return items.map((item) => ({ id: item.sessionId, title: item.projections.values.title }));
}

export async function createSession({ title, preset, model, effort } = {}) {
  const slash = typeof model === 'string' ? model.indexOf('/') : -1;
  const provider = slash > 0 ? model.slice(0, slash) : '';
  const modelId = slash > 0 ? model.slice(slash + 1) : '';
  // CHECKED BEFORE ANYTHING IS SENT: a field the app could not apply would otherwise surface only after the
  // session already exists.
  if (![title, preset, effort].every((field) => typeof field === 'string' && field.length > 0) || provider === '' || modelId === '') {
    throw refused(`refusing before any request: createSession needs a non-empty title, preset and effort and a model written provider/model, and got ${JSON.stringify({ title, preset, model, effort })}`);
  }
  const conn = await connect();
  let created;
  try {
    created = await remote(conn, 'session/create', { request: { agentPreset: preset } });
  } catch (error) {
    // An ok:false is the app saying no, and its own words are carried as they are. Anything else means the
    // request may have been applied with the answer lost, and there is no id to name.
    if (error?.reason !== 'controller-unavailable') throw error;
    throw unavailable(`${error.detail}. The create request may have reached the app, so it may now hold a new UNTITLED session on preset ${preset} that this tool cannot name: look for one before running this again`);
  }
  const id = created?.sessionId;
  if (typeof id !== 'string' || id.length === 0) {
    throw refused(`session/create answered without a session id (${JSON.stringify(created ?? null).slice(0, 80)})`);
  }
  const unfinished = (why) => refused(`session ${id} WAS CREATED but is not a finished ${title} session: ${why}. It is left in the app untitled or as shown; archive it, or finish it by hand, before running this again`);
  if (created.agentPreset !== preset) {
    throw unfinished(`the app resolved preset ${JSON.stringify(created.agentPreset ?? null)}, not ${JSON.stringify(preset)}, so it was not titled ${title}`);
  }
  let selected;
  try {
    selected = (await remote(conn, 'session/selectModel', { request: { sessionId: id, provider, model: modelId, reasoningEffort: effort } }))?.selected;
  } catch (error) {
    throw unfinished(String(error?.message ?? error));
  }
  if (selected?.provider !== provider || selected?.model !== modelId || selected?.reasoningEffort !== effort) {
    throw unfinished(`session/selectModel installed ${JSON.stringify(selected ?? null)}, not ${provider}/${modelId} at ${effort}, so it was not titled ${title}`);
  }
  let renamed;
  try {
    renamed = await remote(conn, 'session/rename', { request: { sessionId: id, title } });
  } catch (error) {
    throw unfinished(String(error?.message ?? error));
  }
  if (renamed?.title !== title) {
    throw unfinished(`session/rename accepted the title ${JSON.stringify(renamed?.title ?? null)}, not ${JSON.stringify(title)}`);
  }
  return { id };
}
