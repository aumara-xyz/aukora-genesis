import { mkdir, open, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, posix, sep } from "node:path";
//#region lib/types/documents-route.js
/**
* The Documents face's wire contract, written once for both ends.
*
* WHY ONE MODULE. The host registers these routes and the browser fetches them. If each
* half spelled its own path, a rename on one side would leave the other fetching a route
* nobody serves; if each half spelled its own refusal vocabulary, a refusal would reach
* the screen as an unrecognised shape and be shown as a generic failure instead of the
* named reason the host chose. Both halves import this file, and nothing here touches the
* filesystem or the DOM, so the browser bundle can carry it.
*
* THE REFUSAL VOCABULARY IS CLOSED AND FINITE. Six names, each a different condition,
* never a generic not-found:
*
*   documents:path-escapes-root  the request leaves the root: an absolute path, a `..`
*                                segment, or a symlink whose target is outside.
*   documents:not-markdown       the target is not a `.md` file (a directory named `.md`
*                                is not one either).
*   documents:no-such-file       the target does not exist.
*   documents:unreadable         the target exists and this process cannot read it.
*   documents:root-missing       the configured root itself is not there.
*   documents:root-unreadable    the configured root exists and cannot be listed.
*
* The three named in the owner's request are the first three; the last three exist
* because a root that is gone and a root that cannot be listed are not the same absence
* as a missing document, and collapsing them would tell an operator nothing to do next.
*
* @module @aukora/face-documents/route
*/
/** The index: every `.md` under the root. One exact route. */
const DOCUMENTS_INDEX_ENDPOINT = "/aukora-documents/index.json";
/**
* One document's raw markdown, under a prefix route: `<endpoint>/<relative path>`.
* The path segments are percent-encoded by {@link documentsFileRequest}.
*/
const DOCUMENTS_FILE_ENDPOINT = "/aukora-documents/file";
/** The category reported for a file that sits directly in the root, in no folder. */
const DOCUMENTS_ROOT_CATEGORY = "root";
/** The path-side refusals: the three the owner named, in the order they are checked. */
const DOCUMENTS_PATH_REFUSALS = [
	"documents:path-escapes-root",
	"documents:not-markdown",
	"documents:no-such-file"
];
/** Every refusal reason, path-side and root-side. */
const DOCUMENTS_REFUSAL_REASONS = [
	...DOCUMENTS_PATH_REFUSALS,
	"documents:unreadable",
	"documents:root-missing",
	"documents:root-unreadable"
];
/** The route a browser fetches one document from, one path segment per segment. */
function documentsFileRequest(relativePath) {
	return `${DOCUMENTS_FILE_ENDPOINT}/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}
/**
* The relative path a request names, or undefined when it names none.
* @param pathname - the request pathname, already stripped of its query.
* @returns the decoded relative path, or undefined for the bare prefix or a bad escape.
*/
function documentsRequestedPath(pathname) {
	const prefix = `${DOCUMENTS_FILE_ENDPOINT}/`;
	if (!pathname.startsWith(prefix)) return void 0;
	try {
		return decodeURIComponent(pathname.slice(prefix.length));
	} catch {
		return;
	}
}
/** Whether a value is a plain JSON object, for the parsers below. */
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Whether an object carries exactly the named keys and nothing else. */
function hasExactKeys(value, keys) {
	return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
/** A non-empty string, for the parsers below. */
function isText(value) {
	return typeof value === "string" && value !== "";
}
/** Whether a value is a timestamp this face produces: ISO 8601 UTC to the millisecond. */
function isInstant(value) {
	return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value);
}
/** Whether a value is one of the two title sources. */
function isTitleSource(value) {
	return value === "heading" || value === "filename";
}
/** Parse one index entry, or undefined when it is not the shape this face produces. */
function parseDocumentsEntry(value) {
	if (!isRecord(value)) return void 0;
	if (!hasExactKeys(value, [
		"path",
		"title",
		"titleFrom",
		"category",
		"modifiedAt"
	])) return void 0;
	if (!isText(value.path) || !isText(value.title) || !isText(value.category)) return void 0;
	if (!isTitleSource(value.titleFrom) || !isInstant(value.modifiedAt)) return void 0;
	return {
		path: value.path,
		title: value.title,
		titleFrom: value.titleFrom,
		category: value.category,
		modifiedAt: value.modifiedAt
	};
}
/**
* Validate an index body off the wire.
* @param value - the parsed JSON body.
* @returns the body, or undefined when it is not what this face serves.
*/
function parseDocumentsIndexBody(value) {
	if (!isRecord(value)) return void 0;
	if (!hasExactKeys(value, [
		"status",
		"root",
		"documents"
	])) return void 0;
	if (value.status !== "ok" || !isText(value.root) || !Array.isArray(value.documents)) return void 0;
	const documents = [];
	for (const raw of value.documents) {
		const entry = parseDocumentsEntry(raw);
		if (entry === void 0) return void 0;
		documents.push(entry);
	}
	return {
		status: "ok",
		root: value.root,
		documents
	};
}
/**
* Validate one document body off the wire. An empty document is a document: `markdown`
* may be the empty string, which is why it is not held to {@link isText}.
* @param value - the parsed JSON body.
* @returns the body, or undefined when it is not what this face serves.
*/
function parseDocumentsDocumentBody(value) {
	if (!isRecord(value)) return void 0;
	if (!hasExactKeys(value, [
		"status",
		"path",
		"title",
		"titleFrom",
		"category",
		"modifiedAt",
		"markdown"
	])) return;
	if (value.status !== "ok" || typeof value.markdown !== "string") return void 0;
	if (!isText(value.path) || !isText(value.title) || !isText(value.category)) return void 0;
	if (!isTitleSource(value.titleFrom) || !isInstant(value.modifiedAt)) return void 0;
	return {
		status: "ok",
		path: value.path,
		title: value.title,
		titleFrom: value.titleFrom,
		category: value.category,
		modifiedAt: value.modifiedAt,
		markdown: value.markdown
	};
}
/**
* Validate a refusal body off the wire.
* @param value - the parsed JSON body.
* @returns the refusal, or undefined when the reason is not one this face defines.
*/
function parseDocumentsRefusalBody(value) {
	if (!isRecord(value)) return void 0;
	if (!hasExactKeys(value, [
		"status",
		"reason",
		"subject"
	])) return void 0;
	if (value.status !== "refused" || typeof value.subject !== "string") return void 0;
	if (typeof value.reason !== "string") return void 0;
	const reason = DOCUMENTS_REFUSAL_REASONS.find((candidate) => candidate === value.reason);
	if (reason === void 0) return void 0;
	return {
		status: "refused",
		reason,
		subject: value.subject
	};
}
//#endregion
//#region lib/types/documents-reader.js
/**
* The reader behind the Documents face: the private root, and nothing outside it.
*
* WHAT THIS MODULE MAY DO. It OPENS FILES READ-ONLY, and that is the whole of its
* reach: `open(path, 'r')` cannot create, truncate, append or rename, and this file
* imports no writer at all — there is no `writeFile`, `mkdir`, `rm`, `rename` or `copyFile`
* anywhere in it. It never moves, copies or deletes anything, and it never caches: every
* call re-reads the tree, so a listing cannot outlive the directory it describes.
*
* THE BOUNDARY IS THE FEATURE. A request is resolved before anything is opened, and a
* request that does not land on a markdown file inside the root is REFUSED BY NAME —
* one name per condition, never a generic not-found:
*
*   documents:path-escapes-root  an absolute path, a `..` that climbs out, or a symlink
*                                whose resolved target is outside the root.
*   documents:not-markdown       the target is not a `.md` file.
*   documents:no-such-file       the target does not exist.
*
* The first check is LEXICAL and comes first: `..` is refused before any path on disk is
* touched. The symlink check is not lexical — a symlink inside the root is followed and
* its REAL path must still be inside the root, so a link planted in the tree cannot be
* used to read a file it points at elsewhere. A refusal carries the requested path back
* as its subject, so the screen can say which request it refused.
*
* WHAT A TITLE IS, AND WHAT IT IS NOT. The title is the document's FIRST markdown ATX
* heading, with a heading inside a fenced code block skipped — a `# comment` in a shell
* snippet is not the document's name. A file with no heading falls back to its filename
* without the `.md` extension, and the answer says which of the two it used rather than
* leaving a reader to guess.
*
* WHAT THIS MODULE DOES NOT PROVE. The boundary is a path check in one process, not a
* kernel confinement: another process running as this user, between the check and the
* read, is outside what a path check can see. The containment check narrows the window
* by reading through the resolved path and by refusing anything that is not a regular
* file; it does not close it. That ceiling is stated here rather than implied away.
*
* @module @aukora/face-documents/reader
*/
/**
* The one root this face reads. Every path is resolved against it and confined to it.
*
* **THE DEFAULT IS THE USER'S OWN, NOT ONE PERSON'S FOLDER NAME.** This was `join(homedir(), 'aukora-private')`,
* and the comment beside it was proud of deriving the path from the home directory instead of hard-coding a machine
* path — **which avoids one machine's name and hard-codes one PERSON's**. `aukora-private` is the name of the folder
* the project's author keeps his own documents in, so for anybody else this face reads a directory that either does
* not exist or, worse, happens to be theirs under that name, and presents it as the place documents live.
*
* The default is now the same state root the rest of the app resolves (`plugins/aukora-eye/lib/token-file.mjs`),
* with the face's own subdirectory under it, and two overrides in the order a reader would expect: the face's own
* variable wins, then the deployment's state root, then the standard location.
*/
const DOCUMENTS_ROOT = process.env.AUKORA_DOCUMENTS_ROOT ?? join(process.env.AUKORA_STATE_ROOT ?? join(homedir(), "Library", "Application Support", "AUKORA", "state"), "documents");
/** The extension that decides whether a file is a document at all. */
const MARKDOWN_EXTENSION = ".md";
/** A refusal body, built in one place so every refusal names its subject. */
function refused(reason, subject) {
	return {
		status: "refused",
		reason,
		subject
	};
}
/** A filesystem error's stable code, or undefined when it carries none. */
function errorCode(error) {
	const code = error?.code;
	return typeof code === "string" ? code : void 0;
}
/** Whether a path is a markdown file by its extension. Case is folded, `.MD` counts. */
function isMarkdownPath(relativePath) {
	return posix.extname(relativePath).toLowerCase() === MARKDOWN_EXTENSION;
}
/** The category of a relative path: its first folder, or the root marker. */
function documentsCategoryOf(relativePath) {
	const at = relativePath.indexOf("/");
	return at < 0 ? DOCUMENTS_ROOT_CATEGORY : relativePath.slice(0, at);
}
/** The filename of a relative path without its markdown extension, for a title fallback. */
function filenameTitle(relativePath) {
	return posix.basename(relativePath).replace(/\.md$/iu, "");
}
/** Whether a resolved path is the root itself or sits under it. */
function withinRoot(root, candidate) {
	const boundary = root.endsWith(sep) ? root : root + sep;
	return candidate === root || candidate.startsWith(boundary);
}
/**
* Resolve one requested relative path against the root, without touching disk.
*
* The escape check is deliberately first and purely lexical: a request for `../../x.md`
* is refused as an escape even when the file it names happens to exist outside the root,
* because the boundary is about where the request may point, not about what is there.
*
* @param root - the root the request must stay inside.
* @param requested - the request as it arrived, `/`-separated.
* @returns the resolved target, or the named refusal.
*/
function resolveDocumentsTarget(root, requested) {
	if (requested === "" || requested.includes("\0") || isAbsolute(requested)) return {
		kind: "refused",
		refusal: refused("documents:path-escapes-root", requested)
	};
	const normalized = posix.normalize(requested);
	if (posix.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) return {
		kind: "refused",
		refusal: refused("documents:path-escapes-root", requested)
	};
	if (!isMarkdownPath(normalized)) return {
		kind: "refused",
		refusal: refused("documents:not-markdown", requested)
	};
	return {
		kind: "resolved",
		absolute: join(root, ...normalized.split("/")),
		relative: normalized,
		category: documentsCategoryOf(normalized)
	};
}
/**
* The title a markdown document declares: its first ATX heading, or undefined.
*
* A heading inside a fenced code block is skipped, because a comment in a snippet is not
* a document title. Inline emphasis and code markers are stripped for display, and a link
* heading contributes its label rather than its target. A heading with no text after the
* markers does not name the document; the scan continues past it.
*
* @param markdown - the document's bytes.
* @returns the heading text, or undefined when the document has no usable heading.
*/
function titleFromMarkdown(markdown) {
	let fence;
	for (const line of markdown.split(/\r?\n/u)) {
		const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(line);
		if (marker !== null) {
			const character = (marker[1] ?? "`").slice(0, 1);
			if (fence === void 0) fence = character;
			else if (fence === character) fence = void 0;
			continue;
		}
		if (fence !== void 0) continue;
		const heading = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/u.exec(line);
		if (heading === null) continue;
		const text = headingText(heading[2] ?? "");
		if (text !== "") return text;
	}
}
/** Strip a heading line to its display text: closing markers, links, emphasis, spacing. */
function headingText(raw) {
	return raw.replace(/[ \t]+#+[ \t]*$/u, "").replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1").replaceAll(/[*_`]/gu, "").replace(/\s+/gu, " ").trim();
}
/** The real root, or the named refusal that says why there is none. */
async function realDocumentsRoot(root) {
	try {
		return {
			kind: "root",
			real: await realpath(root)
		};
	} catch (error) {
		return {
			kind: "refused",
			refusal: refused(errorCode(error) === "ENOENT" ? "documents:root-missing" : "documents:root-unreadable", root)
		};
	}
}
/**
* Open one file read-only and confirm it is a regular file.
* @param absolute - the already-confined absolute path.
* @returns the open handle with its modification time, or the named refusal.
*/
async function openDocumentsFile(absolute) {
	let handle;
	try {
		handle = await open(absolute, "r");
	} catch (error) {
		return {
			kind: "refused",
			refusal: refused(errorCode(error) === "ENOENT" ? "documents:no-such-file" : "documents:unreadable", absolute)
		};
	}
	try {
		const info = await handle.stat();
		if (!info.isFile()) {
			handle.close().catch(() => void 0);
			return {
				kind: "refused",
				refusal: refused("documents:not-markdown", absolute)
			};
		}
		return {
			kind: "open",
			handle,
			modifiedAt: info.mtime.toISOString()
		};
	} catch {
		handle.close().catch(() => void 0);
		return {
			kind: "refused",
			refusal: refused("documents:unreadable", absolute)
		};
	}
}
/**
* Read an opened file's text and close it, whatever happens.
* @param opened - the open half of {@link openDocumentsFile}.
* @returns the text, or undefined when it could not be read.
*/
async function readAndClose(opened) {
	try {
		return await opened.handle.readFile("utf8");
	} catch {
		return;
	} finally {
		opened.handle.close().catch(() => void 0);
	}
}
/** The order the index is served in: the root's own files first, then folders, each by path. */
function compareDocuments(left, right) {
	if (left.category !== right.category) {
		if (left.category === "root") return -1;
		if (right.category === "root") return 1;
		return left.category < right.category ? -1 : 1;
	}
	if (left.path === right.path) return 0;
	return left.path < right.path ? -1 : 1;
}
/**
* Walk one directory, adding every markdown file it and its real subdirectories hold.
*
* A SUBLINKED DIRECTORY IS NOT DESCENDED: `Dirent.isDirectory()` is false for a symlink,
* so the walk never follows one and cannot loop or leave the root by walking. A symlinked
* `.md` FILE is resolved and listed only when its target is inside the root.
*
* @param root - the real root the walk must stay inside.
* @param directory - the real directory being listed.
* @param prefix - the `/`-joined path from the root to `directory`.
* @param documents - the accumulator, in walk order.
*/
async function collectMarkdown(root, directory, prefix, documents) {
	let entries;
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
		const absolute = join(directory, entry.name);
		if (entry.isDirectory()) {
			await collectMarkdown(root, absolute, relative, documents);
			continue;
		}
		const target = resolveDocumentsTarget(root, relative);
		if (target.kind === "refused") continue;
		let real;
		try {
			real = await realpath(target.absolute);
		} catch {
			continue;
		}
		if (!withinRoot(root, real)) continue;
		const info = await stat(real).catch(() => void 0);
		if (info === void 0 || !info.isFile()) continue;
		const opened = await openDocumentsFile(real);
		const text = opened.kind === "open" ? await readAndClose(opened) : void 0;
		const heading = text === void 0 ? void 0 : titleFromMarkdown(text);
		documents.push({
			path: target.relative,
			title: heading ?? filenameTitle(target.relative),
			titleFrom: heading === void 0 ? "filename" : "heading",
			category: target.category,
			modifiedAt: info.mtime.toISOString()
		});
	}
}
/**
* Build the index: every markdown file under the root, each with its title, category and
* modification time, re-read on every call.
* @param root - the root to read.
* @returns the index, or the named refusal when the root itself cannot be read.
*/
async function listDocuments(root) {
	const resolvedRoot = await realDocumentsRoot(root);
	if (resolvedRoot.kind === "refused") return resolvedRoot.refusal;
	const documents = [];
	await collectMarkdown(resolvedRoot.real, resolvedRoot.real, "", documents);
	documents.sort(compareDocuments);
	return {
		status: "ok",
		root,
		documents
	};
}
/**
* Read one document's markdown, by its path relative to the root.
* @param root - the root to read from.
* @param requested - the requested relative path.
* @returns the document, or the named refusal.
*/
async function readDocumentsDocument(root, requested) {
	const target = resolveDocumentsTarget(root, requested);
	if (target.kind === "refused") return target.refusal;
	const resolvedRoot = await realDocumentsRoot(root);
	if (resolvedRoot.kind === "refused") return resolvedRoot.refusal;
	let real;
	try {
		real = await realpath(target.absolute);
	} catch (error) {
		return refused(errorCode(error) === "ENOENT" ? "documents:no-such-file" : "documents:unreadable", requested);
	}
	if (!withinRoot(resolvedRoot.real, real)) return refused("documents:path-escapes-root", requested);
	const opened = await openDocumentsFile(real);
	if (opened.kind === "refused") return refused(opened.refusal.reason, requested);
	const text = await readAndClose(opened);
	if (text === void 0) return refused("documents:unreadable", requested);
	const heading = titleFromMarkdown(text);
	return {
		status: "ok",
		path: target.relative,
		title: heading ?? filenameTitle(target.relative),
		titleFrom: heading === void 0 ? "filename" : "heading",
		category: target.category,
		modifiedAt: opened.modifiedAt,
		markdown: text
	};
}
//#endregion
//#region lib/types/index.js
/**
* Required services: the loopback HTTP route registry, and the harness's own request gate.
* A missing gate must fail the mount rather than serve private bytes ungated.
*/
const inject = ["webServer", "connection"];
/** Answer with no body but the honest status code. */
function end(res, status) {
	res.writeHead(status, {
		"cache-control": "no-store",
		"x-content-type-options": "nosniff"
	});
	res.end();
}
/** Answer with one JSON body. Nothing served here is cacheable or sniffable. */
function json(res, status, body) {
	res.writeHead(status, {
		"cache-control": "no-store",
		"content-type": "application/json; charset=utf-8",
		"x-content-type-options": "nosniff"
	});
	res.end(JSON.stringify(body));
}
/** The HTTP status each refusal reason carries. The reason, not the code, is the contract. */
function refusalStatus(reason) {
	switch (reason) {
		case "documents:path-escapes-root": return 403;
		case "documents:not-markdown": return 415;
		case "documents:no-such-file": return 404;
		case "documents:unreadable": return 500;
		case "documents:root-missing": return 404;
		case "documents:root-unreadable": return 500;
	}
}
/**
* THE FENCE, AND THE ANSWER TO THE QUESTION THIS ITEM ASKS FIRST: a route that cannot verify its caller must not
* serve.
*
* Security has one home — the composition's `connection` service — and `vendor/dsh/packages/host/open-in-app/src/
* index.ts` states what its fence does: it "defeats DNS rebinding and cross-site calls", and its browser
* authentication "gates every caller before any resolution result, icon, or launch is reachable". This face used to
* call that fence **and** keep a fifteen-line local Host/Origin check of its own, which is a second fence that can
* drift from the one the rest of the organism uses. The local one is gone; this is the only one left.
*
* **THE FOUR CASES, AND WHY NONE OF THEM SERVES UNFENCED.** The rule on optional pins is that absent is a ceiling and
* present-and-unusable is a fault — but a security dependency is not an optional pin, so there is no ceiling branch
* here: without a working fence the request is refused, and the reason says which of the four it was.
*
* @param connection - the composition's connection service, as `ctx` holds it (possibly nothing at all).
* @param request - the incoming request, which the fence reads headers from.
* @returns the status to refuse with, and the reason; `rejection` undefined means the fence let it through.
*/
function fenceRejectionOf(connection, request) {
	if (connection === null || typeof connection !== "object") return {
		rejection: 403,
		reason: "no-connection"
	};
	const ask = connection.requestRejection;
	if (typeof ask !== "function") return {
		rejection: 500,
		reason: "rejection-not-callable"
	};
	let answer;
	try {
		answer = ask.call(connection, request);
	} catch (error) {
		return {
			rejection: 500,
			reason: `rejection-threw: ${error instanceof Error ? error.message : String(error)}`
		};
	}
	if (answer === 401 || answer === 403) return {
		rejection: answer,
		reason: "fence-rejected"
	};
	if (answer !== void 0) return {
		rejection: 500,
		reason: `rejection-unknown: ${String(answer)}`
	};
	return {
		rejection: void 0,
		reason: null
	};
}
/**
* Run the three checks every request must pass, answering the refusal when it fails.
* @param gate - the harness's per-route request gate.
* @param req - the request.
* @param res - the response, written to when the request is refused.
* @returns true when the handler may serve.
*/
function admitted(gate, req, res) {
	const fence = fenceRejectionOf(gate(), req);
	if (fence.rejection !== void 0) {
		end(res, fence.rejection);
		return false;
	}
	if (req.method !== "GET") {
		res.setHeader("allow", "GET");
		end(res, 405);
		return false;
	}
	return true;
}
/**
* Create the DEFAULT documents root when it is not there yet, and only that one.
*
* `recursive` makes an existing folder a no-op, and the mode is the private one the state root
* already uses. A failure is left to the listing that follows, which reports it by name.
*/
async function ensureDefaultRoot() {
	if (process.env.AUKORA_DOCUMENTS_ROOT !== void 0) return;
	await mkdir(DOCUMENTS_ROOT, {
		recursive: true,
		mode: 448
	}).catch(() => void 0);
}
/** The index route: the root's markdown listing, re-read on every request. */
function indexRoute(gate) {
	return {
		kind: "exact",
		path: DOCUMENTS_INDEX_ENDPOINT,
		handler: async (req, res) => {
			if (!admitted(gate, req, res)) return;
			await ensureDefaultRoot();
			const answer = await listDocuments(DOCUMENTS_ROOT);
			if (answer.status === "refused") json(res, refusalStatus(answer.reason), answer);
			else json(res, 200, answer);
		}
	};
}
/** The one-document route: raw markdown under a prefix, one segment per path segment. */
function fileRoute(gate) {
	return {
		kind: "prefix",
		path: DOCUMENTS_FILE_ENDPOINT,
		handler: async (req, res) => {
			if (!admitted(gate, req, res)) return;
			const pathname = new URL(req.url ?? "/", "http://x").pathname;
			const requested = documentsRequestedPath(pathname);
			if (requested === void 0) {
				json(res, 404, {
					status: "refused",
					reason: "documents:no-such-file",
					subject: ""
				});
				return;
			}
			const answer = await readDocumentsDocument(DOCUMENTS_ROOT, requested);
			if (answer.status === "refused") json(res, refusalStatus(answer.reason), answer);
			else json(res, 200, answer);
		}
	};
}
/**
* Register both read-only routes on the loopback web server.
* @param ctx - host context carrying the route registry and the request gate.
*/
function apply(ctx) {
	if (ctx.webServer.host !== "127.0.0.1") throw new Error("ui-documents: the private documents routes require a loopback web server");
	const gate = () => Reflect.get(ctx, "connection");
	ctx.effect(() => ctx.webServer.register(indexRoute(gate)), "ui-documents: documents index route");
	ctx.effect(() => ctx.webServer.register(fileRoute(gate)), "ui-documents: one document route");
}
//#endregion
export { DOCUMENTS_FILE_ENDPOINT, DOCUMENTS_INDEX_ENDPOINT, DOCUMENTS_PATH_REFUSALS, DOCUMENTS_REFUSAL_REASONS, DOCUMENTS_ROOT, DOCUMENTS_ROOT_CATEGORY, apply, documentsCategoryOf, documentsFileRequest, documentsRequestedPath, fenceRejectionOf, filenameTitle, inject, isMarkdownPath, listDocuments, parseDocumentsDocumentBody, parseDocumentsIndexBody, parseDocumentsRefusalBody, readDocumentsDocument, resolveDocumentsTarget, titleFromMarkdown, withinRoot };
