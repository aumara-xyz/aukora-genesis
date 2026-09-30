import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
//#region lib/types/index.js
var __rewriteRelativeImportExtension = function(path, preserveJsx) {
	if (typeof path === "string" && /^\.\.?\//.test(path)) return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function(m, tsx, d, ext, cm) {
		return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : d + ext + "." + cm.toLowerCase() + "js";
	});
	return path;
};
const MEMORY_OPENVIKING_ROUTES = {
	remembered: "/api/aukora/memory/remembered",
	list: "/api/aukora/memory/openviking",
	forget: "/api/aukora/memory/openviking/forget"
};
const inject = ["webServer", "connection"];
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
var MemoryFaceError = class extends Error {
	code;
	status;
	constructor(code, status = 502) {
		super(code);
		this.code = code;
		this.status = status;
	}
};
function memoryStateDirectory() {
	return join(process.env.AUKORA_SUPPORT_ROOT ?? join(homedir(), "Library/Application Support/AUKORA"), "state/home/kira-memory");
}
/** Releases flatten face directories; source worktrees keep the extra aukora-face directory. */
async function loadKiraMemoryReaderModule(name) {
	for (const relative of [`../../aukora-kira/lib/${name}.mjs`, `../../../aukora-kira/lib/${name}.mjs`]) {
		const url = new URL(relative, import.meta.url);
		try {
			await access(url);
		} catch {
			continue;
		}
		return await import(__rewriteRelativeImportExtension(
			/* @vite-ignore */
			url.href
		));
	}
	throw new MemoryFaceError("memory:kira-reader-unavailable", 503);
}
/** Read the existing chained ledger without constructing a memory owner or creating directories. */
async function readFaceLiveRemembered() {
	const { buildRouteDeps } = await loadKiraMemoryReaderModule("memory-deps");
	const stateDir = memoryStateDirectory();
	const ledger = buildRouteDeps({
		stateDir,
		sessionsRoot: join(stateDir, "..")
	}).liveRemembered();
	if (!Array.isArray(ledger.notes) || ledger.unreadable > 0) throw new MemoryFaceError("memory:kira-unreadable", 503);
	return ledger.notes;
}
/** Installed configuration keeps Kira's model-locality/consent checks. Scratch overrides inherit no key. */
async function memoryOpenVikingConfig() {
	const installed = join(homedir(), "Library/Application Support/AUKORA");
	const support = process.env.AUKORA_SUPPORT_ROOT ?? installed;
	const override = process.env.AUKORA_MEMORY_OPENVIKING_URL;
	if (resolve(support) !== resolve(installed) && !override) throw new MemoryFaceError("memory:scratch-endpoint-required", 503);
	let config;
	if (override) config = {
		url: override,
		key: process.env.AUKORA_MEMORY_OPENVIKING_KEY ?? "",
		account: process.env.AUKORA_MEMORY_OPENVIKING_ACCOUNT ?? "aukora",
		user: process.env.AUKORA_MEMORY_OPENVIKING_USER ?? "owner",
		queryInstruction: process.env.AUKORA_MEMORY_OPENVIKING_QUERY_INSTRUCTION ?? ""
	};
	else {
		const { readBridgeConfig, openVikingHome } = await loadKiraMemoryReaderModule("recall-openviking");
		config = readBridgeConfig(openVikingHome(memoryStateDirectory()));
		if (config.configured !== true) throw new MemoryFaceError("memory:openviking-config-refused", 503);
	}
	let url;
	try {
		url = new URL(String(config.url ?? "http://127.0.0.1:1933"));
	} catch {
		throw new MemoryFaceError("memory:invalid-endpoint", 503);
	}
	if (url.protocol !== "http:" || ![
		"127.0.0.1",
		"localhost",
		"[::1]"
	].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new MemoryFaceError("memory:invalid-endpoint", 503);
	const account = String(config.account);
	const user = String(config.user);
	if (![account, user].every((value) => /^[a-zA-Z0-9_-]{1,64}$/u.test(value))) throw new MemoryFaceError("memory:invalid-identity", 503);
	return {
		url: url.origin,
		key: String(config.key ?? ""),
		account,
		user,
		queryInstruction: String(config.queryInstruction ?? "")
	};
}
async function vikingCall(config, path, method = "GET", body) {
	let response;
	try {
		response = await fetch(`${config.url}${path}`, {
			method,
			redirect: "error",
			signal: AbortSignal.timeout(15e3),
			headers: {
				"content-type": "application/json",
				"x-openviking-account": config.account,
				"x-openviking-user": config.user,
				...config.key ? { "x-api-key": config.key } : {}
			},
			...body === void 0 ? {} : { body: JSON.stringify(body) }
		});
	} catch {
		throw new MemoryFaceError("memory:openviking-unreachable", 503);
	}
	const answer = object(await response.json().catch(() => null));
	if (!response.ok || answer.status !== "ok") throw new MemoryFaceError(response.status === 404 ? "memory:openviking-not-found" : "memory:openviking-refused", response.status === 404 ? 404 : 502);
	return answer.result;
}
/** Accept only visible, single memory files; never Kira's mirrored index or a signed/governed namespace. */
function isFaceOwnedVikingMemory(uri, user) {
	if (!uri.startsWith(`viking://user/${user}/`) || /[%?#\\\s]/u.test(uri)) return false;
	const parts = uri.slice(`viking://user/${user}/`.length).split("/");
	if (parts.some((part) => !part || part.startsWith(".") || [
		"kira",
		"signed",
		"governed",
		"authority"
	].includes(part.toLowerCase()))) return false;
	const memoryIndex = parts[0] === "memories" ? 0 : parts[0] === "peers" && parts[2] === "memories" ? 2 : -1;
	return memoryIndex >= 0 && parts.length > memoryIndex + 1 && /\.md$/iu.test(parts.at(-1) ?? "");
}
function memoryTime(value) {
	const at = typeof value === "number" ? value < 0xe8d4a51000 ? value * 1e3 : value : typeof value === "string" ? Date.parse(value) : NaN;
	return Number.isFinite(at) ? at : null;
}
function memoryAuthor(note, tags = []) {
	const source = object(note.source);
	const attributed = String(note.attributedTo ?? note.attributed_to ?? "").toLowerCase();
	if ([
		"owner",
		"owner-voice",
		"owner-edit"
	].includes(attributed)) return "Peter";
	if ([
		"lane-requester",
		"dream",
		"agent"
	].includes(attributed)) return "agent";
	const declared = [
		note.author,
		typeof note.source === "string" ? note.source : void 0,
		source.role,
		source.kind,
		...tags.map((tag) => String(tag).match(/^(?:source|author)=(.+)$/u)?.[1])
	].map((value) => String(value ?? "").toLowerCase());
	if (declared.some((value) => [
		"peter",
		"owner",
		"user",
		"you-said",
		"owner-voice",
		"owner-edit"
	].includes(value))) return "Peter";
	if (declared.some((value) => [
		"agent",
		"assistant",
		"dream",
		"lane-requester"
	].includes(value)) || source.dream === true) return "agent";
	return null;
}
async function vikingRecord(config, row) {
	const uri = String(row.uri);
	const params = new URLSearchParams({ uri });
	const [content, statValue, attributes] = await Promise.all([
		vikingCall(config, `/api/v1/content/read?${params}`),
		row.modTime !== void 0 ? row : vikingCall(config, `/api/v1/fs/stat?${params}`),
		vikingCall(config, `/api/v1/fs/attrs?${params}`)
	]);
	if (typeof content !== "string") throw new MemoryFaceError("memory:invalid-content");
	const stat = object(statValue);
	if (stat.isDir === true) throw new MemoryFaceError("memory:not-a-note", 409);
	const attrs = object(object(attributes).attrs);
	const metadata = object(attrs.memory);
	const tags = [...Array.isArray(row.tags) ? row.tags : [], ...Array.isArray(attrs.tags) ? attrs.tags : []];
	const createdAt = memoryTime(metadata.created_at ?? metadata.createdAt ?? row.created_at ?? stat.created_at);
	const modifiedAt = memoryTime(stat.modTime ?? stat.mtime);
	return {
		id: uri,
		backend: "openviking",
		tier: "remembered",
		kind: "observation",
		text: content,
		createdAt: createdAt ?? modifiedAt,
		dateKind: createdAt === null ? "modified" : "created",
		author: memoryAuthor(metadata, tags),
		score: row.score,
		source: {
			sessionTitle: "OpenViking",
			at: createdAt ?? modifiedAt
		}
	};
}
async function findMemoryOpenViking(config, query, offset, limit) {
	const result = object(await vikingCall(config, "/api/v1/search/find", "POST", {
		query: config.queryInstruction + query,
		target_uri: `viking://user/${config.user}`,
		context_type: "memory",
		level: 2,
		limit: offset + limit + 1
	}));
	if (!Array.isArray(result.memories)) throw new MemoryFaceError("memory:invalid-list");
	return result.memories.map(object);
}
/** Uncapped live Kira notes, paged by a stable (date,id) key. Search resolves semantic URIs against this ledger. */
async function listFaceRemembered(query, before, limit = 50) {
	if (query) {
		const offset = Number(before ?? 0);
		if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1e5) throw new MemoryFaceError("memory:invalid-cursor", 400);
		const config = await memoryOpenVikingConfig();
		const { idFromUri } = await loadKiraMemoryReaderModule("recall-openviking");
		const hits = await findMemoryOpenViking(config, query, offset, limit);
		const live = new Map((await readFaceLiveRemembered()).map((note) => [String(note.id), note]));
		return {
			items: hits.slice(offset, offset + limit).flatMap((hit) => {
				const id = idFromUri(config.user, hit.uri);
				const note = live.get(id);
				return note ? [{
					...note,
					text: note.statement,
					author: memoryAuthor(note),
					score: hit.score
				}] : [];
			}),
			next: hits.length > offset + limit ? String(offset + limit) : null
		};
	}
	const notes = await readFaceLiveRemembered();
	const time = (note) => memoryTime(note.createdAt) ?? memoryTime(note.observedAt) ?? memoryTime(note.validFrom) ?? memoryTime(object(note.source).at) ?? 0;
	const compare = (a, b) => time(b) - time(a) || String(a.id).localeCompare(String(b.id));
	let cursor = null;
	if (before) {
		try {
			cursor = object(JSON.parse(before));
		} catch {
			throw new MemoryFaceError("memory:invalid-cursor", 400);
		}
		if (typeof cursor.id !== "string" || typeof cursor.createdAt !== "number") throw new MemoryFaceError("memory:invalid-cursor", 400);
	}
	const sorted = notes.sort(compare).filter((note) => cursor === null || compare(note, cursor) > 0);
	const page = sorted.slice(0, limit);
	const last = page.at(-1);
	return {
		items: page.map((note) => ({
			...note,
			text: note.statement,
			author: memoryAuthor(note)
		})),
		next: sorted.length > limit && last ? JSON.stringify({
			id: last.id,
			createdAt: time(last)
		}) : null
	};
}
/** Tree has explicit depth; recursive ls silently stops before peer memory files at its fixed depth of three. */
async function listMemoryOpenViking(query, offset = 0, limit = 50) {
	const config = await memoryOpenVikingConfig();
	const rows = query ? await findMemoryOpenViking(config, query, offset, limit) : await vikingCall(config, `/api/v1/fs/tree?${new URLSearchParams({
		uri: `viking://user/${config.user}`,
		output: "original",
		include_tags: "true",
		level_limit: "64",
		offset: String(offset),
		node_limit: String(limit)
	})}`);
	if (!Array.isArray(rows)) throw new MemoryFaceError("memory:invalid-list");
	const visible = (query ? rows.slice(offset, offset + limit) : rows).map(object).filter((row) => row.isDir !== true && isFaceOwnedVikingMemory(String(row.uri ?? ""), config.user));
	const items = [];
	const issues = /* @__PURE__ */ new Set();
	for (let i = 0; i < visible.length; i += 6) for (const result of await Promise.allSettled(visible.slice(i, i + 6).map((row) => vikingRecord(config, row)))) if (result.status === "fulfilled") items.push(result.value);
	else issues.add(result.reason instanceof MemoryFaceError ? result.reason.code : "memory:openviking-row-unreadable");
	return {
		items,
		next: (query ? rows.length > offset + limit : rows.length === limit) ? String(offset + limit) : null,
		issues: [...issues]
	};
}
async function forgetMemoryOpenViking(uri) {
	const config = await memoryOpenVikingConfig();
	if (!isFaceOwnedVikingMemory(uri, config.user)) throw new MemoryFaceError("memory:not-face-owned", 403);
	const params = new URLSearchParams({ uri });
	if (object(await vikingCall(config, `/api/v1/fs/stat?${params}`)).isDir !== false) throw new MemoryFaceError("memory:not-a-note", 409);
	if (object(await vikingCall(config, `/api/v1/fs?${params}&recursive=false`, "DELETE")).uri !== uri) throw new MemoryFaceError("memory:deletion-unconfirmed");
	return {
		id: uri,
		forgotten: true,
		localOnly: true
	};
}
function json(res, status, body) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(JSON.stringify(body));
}
/** Use the same launch-cookie and Host/Origin gate as the other faces, failing closed. */
function memoryRequestRejection(connection, req) {
	if (connection === null || typeof connection !== "object") return 403;
	const gate = Reflect.get(connection, "requestRejection");
	if (typeof gate !== "function") return 403;
	try {
		const rejection = gate.call(connection, req);
		return rejection === void 0 ? void 0 : rejection === 401 || rejection === 403 ? rejection : 403;
	} catch {
		return 403;
	}
}
async function requestBody(req) {
	let body = "";
	for await (const chunk of req) {
		body += String(chunk);
		if (body.length > 8192) throw new MemoryFaceError("memory:body-too-large", 413);
	}
	try {
		return object(JSON.parse(body));
	} catch {
		throw new MemoryFaceError("memory:invalid-body", 400);
	}
}
function apply(ctx) {
	for (const [operation, path] of Object.entries(MEMORY_OPENVIKING_ROUTES)) {
		const route = {
			kind: "exact",
			path,
			handler: async (req, res) => {
				const rejection = memoryRequestRejection(Reflect.get(ctx, "connection"), req);
				if (rejection !== void 0) {
					json(res, rejection, { error: "memory:unauthorized" });
					return;
				}
				const method = operation === "forget" ? "POST" : "GET";
				if (req.method !== method) {
					res.setHeader("allow", method);
					json(res, 405, { error: "memory:method-not-allowed" });
					return;
				}
				try {
					if (operation !== "forget") {
						const params = new URL(req.url ?? "/", "http://127.0.0.1").searchParams;
						const q = params.get("q")?.trim() ?? "";
						if (operation === "remembered") {
							if (q.length > 4e3) throw new MemoryFaceError("memory:invalid-query", 400);
							json(res, 200, await listFaceRemembered(q, params.get("before")));
							return;
						}
						const offset = Number(params.get("before") ?? 0);
						if (q.length > 4e3 || !Number.isSafeInteger(offset) || offset < 0 || offset > 1e5) throw new MemoryFaceError("memory:invalid-query", 400);
						json(res, 200, await listMemoryOpenViking(q, offset));
					} else {
						if (!req.headers["content-type"]?.startsWith("application/json")) throw new MemoryFaceError("memory:json-required", 415);
						const body = await requestBody(req);
						if (typeof body.id !== "string") throw new MemoryFaceError("memory:id-required", 400);
						json(res, 200, await forgetMemoryOpenViking(body.id));
					}
				} catch (error) {
					json(res, error instanceof MemoryFaceError ? error.status : 500, { error: error instanceof MemoryFaceError ? error.code : "memory:request-failed" });
				}
			}
		};
		ctx.effect(() => ctx.webServer.register(route), `memory: OpenViking ${operation}`);
	}
}
//#endregion
export { MEMORY_OPENVIKING_ROUTES, apply, forgetMemoryOpenViking, inject, isFaceOwnedVikingMemory, listFaceRemembered, listMemoryOpenViking, memoryAuthor, memoryOpenVikingConfig, memoryRequestRejection, readFaceLiveRemembered };
