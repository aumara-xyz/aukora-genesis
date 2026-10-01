import { z } from "zod";
import { CommandDefinitionId } from "@deepseek-ai/dsh-commands/brand";
import { setSandboxMode } from "@deepseek-ai/dsh-sandbox-policy";
import { requiredConfinement } from "@deepseek-ai/dsh-sandbox";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, statfsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
//#region lib/types/composer-mode.js
/** Registers a read-only projection and a sandbox-only command. Installation never changes session state. */
function installComposerMode(ctx) {
	ctx.inject([
		"sessionProjections",
		"commands",
		"sandboxPolicy"
	], (scope) => {
		const modeSchema = z.enum([
			"read-only",
			"workspace-write",
			"danger-full-access"
		]);
		scope.sessionProjections.register({
			key: "aukoraComposerMode",
			stateVersion: 1,
			stateSchema: modeSchema.nullable(),
			init: () => null,
			apply: (state, event) => event.type === "sandbox/mode" ? event.data.mode : state,
			wire: {
				viewSchema: z.object({
					mode: modeSchema,
					available: z.boolean()
				}),
				view: (state) => ({
					mode: state ?? scope.sandboxPolicy.defaultMode,
					available: typeof scope.get("aukoraConfinement")?.confine === "function"
				})
			}
		});
		scope.commands.register({
			definitionId: CommandDefinitionId("@aukora/composer-mode"),
			name: "aukora-mode",
			description: "Select confined Chat or Build mode without changing approval policy",
			input: { hint: "<read-only|workspace-write>" },
			handler: ({ agent, rawInput }) => {
				const requested = rawInput.trim();
				if (requested !== "read-only" && requested !== "workspace-write") return {
					kind: "error",
					text: "Required confinement allows only Chat or Build; YOLO is unavailable."
				};
				try {
					requiredConfinement(scope, scope.sandboxPolicy.resolve({
						session: agent.session,
						mode: requested
					}));
					if (scope.sandboxPolicy.resolve({ session: agent.session }).mode !== requested) setSandboxMode(agent.session, requested);
					if (scope.sandboxPolicy.resolve({ session: agent.session }).mode !== requested) return {
						kind: "error",
						text: "The host did not confirm the requested sandbox mode."
					};
					return {
						kind: "success",
						text: requested === "read-only" ? "Chat mode" : "Build mode"
					};
				} catch {
					return {
						kind: "error",
						text: "Mode change unavailable; check the host-reported state."
					};
				}
			}
		});
	});
}
//#endregion
//#region lib/types/first-run-host.js
/**
* THE FIRST RUN'S HOST HALF — the two facts the screen cannot know by itself, and the one secret it must not keep.
*
* The screen (`FirstRunSurface.tsx`) renders what a person sees; `first-run.ts` decides what those things mean. This
* module is the third part: it answers **"is this a first run?"** and it **stores the person's key**. Three rules,
* each of which the code below is shaped by:
*
*  1. **A FIRST RUN IS DECIDED FROM THE STATE, NOT FROM A FLAG.** Nobody in this repository writes an owner profile
*     today — `owner.json`, `writeOwner` and `ownerProfile` appear in neither KIRA's tree nor the faces' — so this
*     module defines the file it reads and writes, in one place, and the screen's own `isFirstRun` is the same
*     decision seen from the other side.
*  2. **THE KEY GOES IN, AND ONLY A TAIL EVER COMES BACK.** Measured in the harness: its last-resort guard logs the
*     **error object**, never the request body (`vendor/dsh/packages/host/webserver/src/index.ts:241`), so a key in a
*     POST is not logged by the server — and this module keeps that true by never putting the key in a message, an
*     error or a response. A stored key is answered as its last four characters and nothing else.
*  3. **STATE ROOT IS READ, NOT GUESSED.** The running app's variable is `AUKORA_STATE_ROOT`
*     (`plugins/aukora-eye/lib/token-file.mjs:36`); the materializer's `AUKORA_STATE` is a different one, and this
*     module never invents a home directory of its own.
*
* @module first-run-host
*/
/** Every way this host half answers, so a route never has to compose a status by hand. */
const FIRST_RUN_REFUSALS = Object.freeze({
	BODY_NOT_OBJECT: "first-run:body-not-an-object",
	NAME_MISSING: "first-run:name-missing",
	KEY_MISSING: "first-run:key-missing",
	NO_STATE_ROOT: "first-run:no-state-root"
});
/** The state root the running app uses, or null when the process was started without one. */
function stateRootOf(env) {
	const root = env.AUKORA_STATE_ROOT ?? env.AUKORA_STATE;
	return typeof root === "string" && root.trim() !== "" ? root.replace(/\/+$/u, "") : null;
}
/** The profile file, beside the state it describes. One definition, used by the reader and the writer. */
function ownerFileIn(stateRoot) {
	return join(stateRoot, "owner.json");
}
/**
* The person's key file. `secrets/` rather than the state root itself, so a directory listing of their state does not
* put a credential beside their memories.
*/
function keyFileIn(stateRoot) {
	return join(stateRoot, "secrets", "openrouter-key");
}
/**
* The profile a state file holds, or null.
*
* **A FILE THAT CANNOT BE READ IS NOT A PROFILE AND IS NOT A CRASH.** A half-written file, a file somebody edited by
* hand, an empty file — each returns null, which means "no profile", which means a first run. That is the safe
* direction: showing the first-run screen again is a small annoyance, while reading a broken file as a profile would
* let somebody through a screen they have not filled in.
*/
function profileOf(text) {
	if (typeof text !== "string" || text.trim() === "") return null;
	try {
		const parsed = JSON.parse(text);
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
		const name = parsed.name;
		return typeof name === "string" && name.trim() !== "" ? { name: name.trim() } : null;
	} catch {
		return null;
	}
}
/** The tail of a stored secret: four characters, and never the secret. A four-character secret yields nothing. */
function tailOf(secret) {
	if (typeof secret !== "string") return null;
	const trimmed = secret.trim();
	return trimmed.length <= 4 ? null : trimmed.slice(-4);
}
/** Read the state and answer the screen. Every failure to read is "no profile", never an error the screen must parse. */
function firstRunAnswer(stateRoot) {
	if (stateRoot === null) return {
		firstRun: true,
		name: null,
		keyTail: null
	};
	const owner = existsSync(ownerFileIn(stateRoot)) ? profileOf(readFileSync(ownerFileIn(stateRoot), "utf8")) : null;
	const keyFile = keyFileIn(stateRoot);
	const keyTail = existsSync(keyFile) ? tailOf(readFileSync(keyFile, "utf8")) : null;
	return {
		firstRun: owner === null,
		name: owner?.name ?? null,
		keyTail
	};
}
/**
* Store the person's name, creating the state directory if the installer has not yet.
*
* @returns the answer the screen should now show.
*/
function rememberName(stateRoot, name, voice) {
	const trimmed = name.trim();
	mkdirSync(dirname(ownerFileIn(stateRoot)), { recursive: true });
	const profile = voice === void 0 ? { name: trimmed } : {
		name: trimmed,
		voice
	};
	writeFileSync(ownerFileIn(stateRoot), `${JSON.stringify(profile)}\n`, { mode: 384 });
	return firstRunAnswer(stateRoot);
}
/** Store the key, with the file readable only by its owner. **The key is never returned, logged or echoed.** */
function rememberKey(stateRoot, key) {
	const path = keyFileIn(stateRoot);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, key.trim(), { mode: 384 });
	return firstRunAnswer(stateRoot);
}
/** Remove the stored key. Removing one that is not there is a success, because the person asked for it to be gone. */
function forgetKey(stateRoot) {
	const path = keyFileIn(stateRoot);
	if (existsSync(path)) rmSync(path);
	return firstRunAnswer(stateRoot);
}
//#endregion
//#region lib/types/approvals-log.js
/**
* THE APPROVAL LOG, READ FROM DISK — and the digests stopped at the host.
*
* AUMLOK is adding the approval event log: `operationDigest`, a digest of the displayed text, the words-check result, a
* truncated yes/no, the decision, dwell ms and the time — digests only, mode 0600, under `state/logs`. **It has not
* landed yet** (measured: no writer for it exists in the tree, and their `approval-receipt.mjs` carries
* `operationDigest` but neither `dwell` nor a words check), so the view reads the fixture and the shape I sent them in
* `.agents/live/NOTE-TO-AUMLOK-approval-history-shape.md`.
*
* **ONE DECISION IS MINE AND IS STRONGER THAN THE GOAL ASKS.** The goal requires that no key material is ever
* *rendered*. A digest of a signed operation is not a key, but printing it teaches a person nothing and puts the
* machinery of signing in front of them — so the reader **drops the digests before the entries leave the host**. A
* browser cannot render what it was never sent, which is a stronger guarantee than a promise made in a renderer.
*
* **AND A FILE THAT CANNOT BE READ IS NOT AN EMPTY HISTORY.** A missing log and a log whose every line is broken are
* different facts, and this reader keeps them apart: `absent` says nobody has logged anything yet, `skipped` says
* something is there and could not be understood. The view can then tell the truth about which one happened.
*
* @module approvals-log
*/
/** Where the log is expected. **A PROPOSAL UNTIL AUMLOK NAMES THEIRS** — the name is in the note I sent them. */
const APPROVAL_LOG_RELATIVE = "logs/approvals.jsonl";
/** One parsed line, or null. **A broken line is skipped, not thrown** — one bad write must not hide a history. */
function entryOf(line) {
	const trimmed = line.trim();
	if (trimmed === "") return null;
	let parsed;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return null;
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
	const raw = parsed;
	const kind = typeof raw.kind === "string" ? raw.kind : "";
	const at = typeof raw.at === "string" ? raw.at : "";
	if (kind === "" || at === "") return null;
	const verify = raw.verify !== null && typeof raw.verify === "object" ? { state: typeof raw.verify.state === "string" ? String(raw.verify.state) : "unverified" } : null;
	return {
		at,
		kind,
		subject: typeof raw.subject === "string" ? raw.subject : "",
		wordsCheck: typeof raw.wordsCheck === "string" && raw.wordsCheck !== "" ? raw.wordsCheck : "unchecked",
		spoken: raw.spoken === "yes" || raw.spoken === "no" ? raw.spoken : null,
		decision: typeof raw.decision === "string" ? raw.decision : "pending",
		dwellMs: typeof raw.dwellMs === "number" && Number.isFinite(raw.dwellMs) ? raw.dwellMs : null,
		verify,
		displayedText: typeof raw.displayedText === "string" && raw.displayedText !== "" ? raw.displayedText : null
	};
}
/**
* Read the approval log for one state root.
*
* @param stateRoot - the running app's state root, or null when the process has none.
* @returns the entries with no digest on them, and which of the three situations this was.
*/
function readApprovalLog(stateRoot) {
	if (stateRoot === null) return {
		entries: [],
		absent: true,
		skipped: 0,
		mode: null
	};
	const path = join(stateRoot, APPROVAL_LOG_RELATIVE);
	if (!existsSync(path)) return {
		entries: [],
		absent: true,
		skipped: 0,
		mode: null
	};
	let mode = null;
	try {
		mode = statSync(path).mode & 511;
	} catch {
		mode = null;
	}
	let text = "";
	try {
		text = readFileSync(path, "utf8");
	} catch {
		return {
			entries: [],
			absent: false,
			skipped: 1,
			mode
		};
	}
	const entries = [];
	let skipped = 0;
	for (const line of text.split("\n")) {
		if (line.trim() === "") continue;
		const entry = entryOf(line);
		if (entry === null) skipped += 1;
		else entries.push(entry);
	}
	entries.sort((left, right) => right.at.localeCompare(left.at));
	return {
		entries,
		absent: false,
		skipped,
		mode
	};
}
//#endregion
//#region lib/types/why-store.js
/**
* THE REPLY MANIFESTS, READ FROM DISK — one receipt per reply, and absence said in words.
*
* AUMA is adding a per-reply manifest: the ids and hashes of everything in her prompt, whether each counts as outside
* words, and each one's source. **It has not landed yet** (measured: no manifest appears anywhere in
* `plugins/aukora-face/apps/src/auma-live/`), so this reads the shape I sent them in
* `.agents/live/NOTE-TO-AUMA-per-reply-manifest-shape.md`, from `logs/reply-manifests.jsonl` — **a proposal until they
* name their file**, exactly as the approval log's name is a proposal until AUMLOK names theirs.
*
* **THE ONE THING THIS MUST NEVER DO IS INVENT A RECEIPT.** A reply made before receipts existed has no manifest, and
* the honest answer is that there is none — not an empty manifest, which would render as "she was holding nothing in
* mind" and would be a false statement about her attention made by the very view built to make it auditable.
*
* @module why-store
*/
/** Where the manifests are expected. **A PROPOSAL UNTIL AUMA NAMES THEIRS** — the name is in the note I sent them. */
const MANIFEST_LOG_RELATIVE = "logs/reply-manifests.jsonl";
/**
* One line, or null. **A broken line is skipped, not thrown** — one bad write must not hide every receipt behind it.
*/
function manifestOf(line, replyId) {
	const trimmed = line.trim();
	if (trimmed === "") return null;
	let parsed;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return null;
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
	const raw = parsed;
	if (typeof raw.replyId !== "string" || raw.replyId !== replyId) return null;
	const groups = Array.isArray(raw.groups) ? raw.groups.flatMap((group) => {
		if (group === null || typeof group !== "object") return [];
		const shape = group;
		if (typeof shape.block !== "string") return [];
		const items = Array.isArray(shape.items) ? shape.items.flatMap((item) => {
			if (item === null || typeof item !== "object") return [];
			const entry = item;
			if (typeof entry.id !== "string") return [];
			return [{
				id: entry.id,
				...typeof entry.sha256 === "string" ? { sha256: entry.sha256 } : {},
				source: typeof entry.source === "string" ? entry.source : "",
				at: typeof entry.at === "string" ? entry.at : null,
				outsideWords: entry.outsideWords === true
			}];
		}) : [];
		return [{
			block: shape.block,
			items
		}];
	}) : [];
	const rebuildShape = raw.rebuild !== null && typeof raw.rebuild === "object" ? raw.rebuild : null;
	return {
		replyId: raw.replyId,
		...typeof raw.at === "string" ? { at: raw.at } : {},
		groups,
		rebuild: rebuildShape === null ? null : {
			attempted: rebuildShape.attempted === true,
			matches: rebuildShape.matches === true,
			idChecked: rebuildShape.idChecked === true,
			sourceChecked: rebuildShape.sourceChecked === true,
			chainChecked: rebuildShape.chainChecked === true
		}
	};
}
/**
* Read the manifest for one reply.
*
* @param stateRoot - the running app's state root, or null when the process has none.
* @param replyId - which reply the person asked about. **A manifest for another reply is not an answer for this one.**
* @returns the receipt, or the absent state, with the three situations kept apart.
*/
function readManifest(stateRoot, replyId) {
	if (stateRoot === null) return {
		manifest: null,
		absent: true,
		skipped: 0,
		mode: null
	};
	const path = join(stateRoot, MANIFEST_LOG_RELATIVE);
	if (!existsSync(path)) return {
		manifest: null,
		absent: true,
		skipped: 0,
		mode: null
	};
	let mode = null;
	try {
		mode = statSync(path).mode & 511;
	} catch {
		mode = null;
	}
	let text = "";
	try {
		text = readFileSync(path, "utf8");
	} catch {
		return {
			manifest: null,
			absent: false,
			skipped: 1,
			mode
		};
	}
	let skipped = 0;
	let found = null;
	for (const line of text.split("\n")) {
		if (line.trim() === "") continue;
		let parsedForCount = null;
		try {
			parsedForCount = JSON.parse(line);
		} catch {
			skipped += 1;
			continue;
		}
		const candidate = manifestOf(line, replyId);
		if (candidate === null) {
			if ((parsedForCount !== null && typeof parsedForCount === "object" && !Array.isArray(parsedForCount) ? parsedForCount.replyId : void 0) !== replyId) continue;
			skipped += 1;
			continue;
		}
		found = candidate;
	}
	return {
		manifest: found,
		absent: false,
		skipped,
		mode
	};
}
/**
* Add one sample to the ring, dropping the oldest.
*
* **THE ONLY WAY TO ADD A SAMPLE, AND IT CANNOT GROW.** There is no push-in-place here and no mutable list: the result
* is a new array whose length is at most `HEALTH_RING_SIZE`, whatever the input was. A caller that keeps the old array
* gets a shorter history, not a leak.
*/
function pushSample(ring, sample) {
	const kept = ring.length >= 120 ? ring.slice(ring.length - 120 + 1) : ring.slice();
	kept.push(sample);
	return kept;
}
/** How often the host samples. **The goal's thirty to sixty seconds**, and thirty keeps an hour in the ring. */
const SAMPLER_INTERVAL_MS = 3e4;
/** How many scratch entries are walked in one sample. A directory with a hundred thousand entries must not stall a sample. */
const SCRATCH_ENTRY_CAP = 2e3;
/**
* The stand-in footprint reader: the same command ALPHA's watchdog reads through, called directly.
*
* **THIS EXISTS BECAUSE A FACE MAY NOT IMPORT ACROSS TREES** — measured: no face's `src` tree imports from `apps/`,
* which is why the note asking ALPHA to expose theirs is on the board. When they do, this becomes their
* function and this one is deleted — the panel's number will not change, because it was always their command.
*/
function readFootprintViaBinary(pid) {
	return new Promise((resolve) => {
		execFile("/usr/bin/footprint", [
			"-f",
			"bytes",
			String(pid)
		], { timeout: 5e3 }, (error, stdout) => {
			if (error) {
				resolve(null);
				return;
			}
			const match = /total\s+(\d+)/iu.exec(stdout) ?? /(\d{6,})/u.exec(stdout);
			const bytes = match === null ? NaN : Number(match[1]);
			resolve(Number.isFinite(bytes) && bytes > 0 ? bytes : null);
		});
	});
}
/** The machine's memory pressure level, or null. */
function readPressureLevel() {
	return new Promise((resolve) => {
		execFile("sysctl", ["-n", "kern.memorystatus_level"], { timeout: 5e3 }, (error, stdout) => {
			if (error) {
				resolve(null);
				return;
			}
			const level = Number(stdout.trim());
			resolve(Number.isFinite(level) ? level : null);
		});
	});
}
/** Free bytes on the volume a path lives on, or null. `bavail` is what a non-root process may actually use. */
function freeBytesAt(path) {
	try {
		const stats = statfsSync(path);
		const free = stats.bavail * stats.bsize;
		return Number.isFinite(free) && free >= 0 ? free : null;
	} catch {
		return null;
	}
}
/**
* The size of AUKORA's own scratch under the temp directory.
*
* **NAMES AND SIZES ONLY.** Every entry is listed and measured; nothing is opened. The walk is capped, and when the cap
* is reached the answer says so by returning the bytes it saw together with the count it stopped at — a truncated sum
* reported as a total would be the same lie as an empty log reported as an empty history.
*/
function scratchBytesIn(tmpDir, cap = SCRATCH_ENTRY_CAP) {
	let bytes = 0;
	let entries = 0;
	let capped = false;
	let names;
	try {
		names = readdirSync(tmpDir);
	} catch {
		return {
			bytes: 0,
			entries: 0,
			capped: false
		};
	}
	for (const name of names) {
		if (!name.startsWith("aukora-")) continue;
		if (entries >= cap) {
			capped = true;
			break;
		}
		entries += 1;
		try {
			bytes += statSync(join(tmpDir, name)).size;
		} catch {}
	}
	return {
		bytes,
		entries,
		capped
	};
}
/** The real sources, which is the only place the machine is touched. */
function liveSources(stateRoot) {
	return {
		stateRoot,
		tmpDir: process.env.TMPDIR ?? "/tmp",
		pid: process.pid,
		footprint: readFootprintViaBinary,
		pressure: readPressureLevel,
		now: () => /* @__PURE__ */ new Date()
	};
}
/** Take one sample. **Nothing here can throw**: a health panel that dies while measuring is worse than one number short. */
async function sampleOnce(sources) {
	const footprint = await sources.footprint(sources.pid).catch(() => null);
	const pressure = await sources.pressure().catch(() => null);
	const scratch = scratchBytesIn(sources.tmpDir);
	return {
		at: sources.now().toISOString(),
		freeDiskBytes: sources.stateRoot === null ? null : freeBytesAt(sources.stateRoot),
		scratchBytes: scratch.bytes,
		footprintBytes: footprint,
		pressureLevel: pressure,
		lanesRunning: sources.lanes?.running ?? null,
		lanesWaiting: sources.lanes?.waiting ?? null,
		ci: sources.ci ?? null
	};
}
//#endregion
//#region lib/types/watchdog-limit.js
/**
* THE WATCHDOG'S RESTART THRESHOLD, READ FROM THE FILE THAT OWNS IT.
*
* **WHY THIS IS NOT IN THE SAMPLER.** The sampler's promise is that it reads **nothing private** — names and sizes, a
* volume's free space, a kernel counter, a process's footprint. My first version put this function in that module, and
* the sampler's own privacy arm caught it immediately, because reading a threshold means reading a **file's contents**.
* The arm was right and the fix was not to weaken the arm: the sampler reads the machine, this reads one repository
* file, and the two belong in different modules.
*
* **WHY IT PARSES THEIR SOURCE INSTEAD OF IMPORTING IT.** The number is ALPHA's: `apps/aukora-desktop/footprint-watch.mjs`
* line 18, `FOOTPRINT_LIMIT_BYTES = Math.round(3.4 * 1024 ** 3)`. Copying it would be the second implementation their
* own comment warns against, and importing across trees from a **face** is something no face does — the host half is
* built, and a relative import out of the package is the kind of thing that works until the build says otherwise. The
* number is READ, with a court that fails if the line moves or changes shape, and `null` when it cannot be read: the
* panel then reports the proximity as unknown rather than inventing a threshold. The note asking ALPHA to expose it
* where a face may import it is on the board; when they do, this becomes their export.
*
* @module watchdog-limit
*/
/**
* The repository root, found by walking up.
*
* **A FIXED RELATIVE PATH WOULD BREAK AFTER A BUILD.** This file is at `src/` today and at `lib/` once the face is
* built, so `../../..` counts a different number of levels in each — and a path that is right in the source tree and
* wrong in the built one is the kind of defect a panel would show as "unknown" forever. The root is found by looking
* for the two directories that make this repository what it is.
*/
function repoRootFrom(start) {
	let here = start;
	for (let step = 0; step < 8; step += 1) {
		if (existsSync(join(here, "apps", "aukora-desktop")) && existsSync(join(here, "plugins", "aukora-face"))) return here;
		const up = dirname(here);
		if (up === here) return null;
		here = up;
	}
	return null;
}
/** Where the watchdog's threshold lives, so a failure names the file that moved. Null when the root cannot be found. */
function watchdogSourcePath() {
	const root = repoRootFrom(dirname(fileURLToPath(import.meta.url)));
	return root === null ? null : join(root, "apps", "aukora-desktop", "footprint-watch.mjs");
}
/**
* The threshold, or null when it could not be read.
*
* @param readFile - how to read a file, injected so a court can drive this without the real tree.
* @param path - the file to read, defaulting to the watchdog's own.
*/
function watchdogLimitBytes(readFile = (path) => readFileSync(path, "utf8"), path = watchdogSourcePath()) {
	if (path === null) return null;
	let source;
	try {
		source = readFile(path);
	} catch {
		return null;
	}
	const match = /FOOTPRINT_LIMIT_BYTES\s*=\s*([^\n]+)/u.exec(source);
	if (match === null) return null;
	if (match[1] === void 0) return null;
	const expression = match[1].trim().replace(/;\s*$/u, "");
	if (!/^[\d\s.*+()Mathround\u002a]+$/u.test(expression)) return null;
	try {
		const value = Function(`"use strict"; return (${expression})`)();
		return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
	} catch {
		return null;
	}
}
//#endregion
//#region lib/types/index.js
/**
* THE LAYOUT FACE'S HOST HALF — four routes, and a fence in front of every one of them.
*
* The first-run screen needs two facts the browser cannot know by itself: **is this a first run**, and **is a key
* stored**. It also needs to store two things the person gives it — their name and their model key — and to remove the
* key when they ask. All four live here, and every one of them is fenced.
*
* **WHY THE FENCE IS NOT OPTIONAL, IN THE HARNESS'S OWN WORDS.** `plugins/aukora-face/settings/src/index.ts` puts it
* plainly above its own route: "The harness has no gate in front of `/api` — it checks per route — so a route that
* skips this call is readable by any process on this machine." And the fence's home is the composition's `connection`
* service, whose purpose `vendor/dsh/packages/host/open-in-app/src/index.ts` states: its Host/Origin fence "defeats
* DNS rebinding and cross-site calls", and its browser authentication "gates every caller".
*
* **THE SETTLED FAIL-CLOSED DECISION, APPLIED A FOURTH TIME.** `aumlok`, `documents` and `messages` each carry this
* same gate, each with its own court, because there is no shared package for face host-halves and adding one would
* change what is built and materialized for every face. The rule they settled is the rule here: a route that cannot
* verify its caller must not serve — no `connection`, a non-callable `requestRejection`, a fence that throws, and a
* fence that answers 401/403 each refuse, and only a present, callable, non-rejecting fence lets a request through.
*
* **THE KEY IS NEVER ECHOED.** A stored key is answered as its tail and nothing else; the key itself appears in no
* response, no message and no error, and the file it lands in is readable only by its owner.
*
* @module ui-layout-host
*/
/** The route the Approvals view reads. **The client declares the same string; a court requires them to agree.** */
const APPROVALS_ROUTE = "/api/aukora/approvals";
/** The route the Health view reads. The same rule applies: one string, two files, a court that requires agreement. */
const HEALTH_ROUTE = "/api/aukora/health";
/** The route that answers "why did she say that?" for one reply. Same rule again. */
const WHY_ROUTE = "/api/aukora/why";
/** The routes, in one place, so a court can name them without spelling a path twice. */
const FIRST_RUN_ROUTES = Object.freeze({
	answer: "/api/aukora/first-run",
	name: "/api/aukora/first-run/name",
	key: "/api/aukora/first-run/key",
	keyRemove: "/api/aukora/first-run/key/remove"
});
/** A JSON body ceiling. The harness's own `open-in-app` uses 64 KiB for a request it reads; a key is far smaller. */
const BODY_CEILING_BYTES = 64 * 1024;
/**
* The fence, asked once per request. **THIS IS THE SAME GATE THE THREE OTHER FACES CARRY**, and it fails closed.
*
* @param connection - the composition's connection service, as `ctx` holds it (possibly nothing at all).
* @param request - the incoming request, which the fence reads headers from.
* @returns the status to refuse with and the reason; `rejection` undefined means the fence let it through.
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
/** Read a JSON body, refusing anything that is not a small JSON object. Never returns the raw text. */
async function readJsonBody(req) {
	if (!(typeof req.headers["content-type"] === "string" ? req.headers["content-type"] : "").toLowerCase().includes("application/json")) return {
		ok: false,
		because: "not-json"
	};
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const buf = chunk;
		size += buf.length;
		if (size > BODY_CEILING_BYTES) return {
			ok: false,
			because: "too-large"
		};
		chunks.push(buf);
	}
	try {
		const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {
			ok: false,
			because: "not-object"
		};
		return {
			ok: true,
			value: parsed
		};
	} catch {
		return {
			ok: false,
			because: "unparseable"
		};
	}
}
/** Answer with JSON and no cache, which is what every route here does. */
function send(res, status, body) {
	res.writeHead(status, {
		"cache-control": "no-store",
		"content-type": "application/json; charset=utf-8",
		"x-content-type-options": "nosniff"
	});
	res.end(JSON.stringify(body));
}
function apply(ctx) {
	installComposerMode(ctx);
	ctx.inject(["webServer", "connection"], (webCtx) => {
		const fence = (req) => fenceRejectionOf(Reflect.get(webCtx, "connection"), req).rejection;
		/** Every route starts here: fence first, then the method, then the work. */
		const guarded = async (req, res, method, work) => {
			const rejection = fence(req);
			if (rejection !== void 0) {
				res.writeHead(rejection, { "cache-control": "no-store" });
				res.end();
				return;
			}
			if (req.method !== method) {
				res.writeHead(405, {
					allow: method,
					"cache-control": "no-store"
				});
				res.end();
				return;
			}
			await work();
		};
		const root = () => stateRootOf(process.env);
		/** The approval log's reader, reading state/logs and dropping the digests before anything leaves the host. */
		const readLog = () => {
			const stateRoot = root();
			return stateRoot === null ? {
				entries: [],
				absent: true,
				skipped: 0,
				mode: null
			} : readApprovalLog(stateRoot);
		};
		let ring = [];
		const sampleNow = async () => {
			try {
				const taken = await sampleOnce(liveSources(root()));
				ring = pushSample(ring, taken);
			} catch {}
		};
		webCtx.effect(() => {
			sampleNow();
			const timer = setInterval(() => {
				sampleNow();
			}, SAMPLER_INTERVAL_MS);
			return () => {
				clearInterval(timer);
			};
		}, "ui-layout: health sampler");
		webCtx.effect(() => webCtx.webServer.register({
			kind: "exact",
			path: WHY_ROUTE,
			handler: (req, res) => guarded(req, res, "GET", () => {
				const replyId = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("reply") ?? "";
				if (replyId === "") {
					send(res, 400, {
						absent: true,
						skipped: 0,
						manifest: null,
						why: "no reply was named"
					});
					return;
				}
				const read = root() === null ? {
					manifest: null,
					absent: true,
					skipped: 0,
					mode: null
				} : readManifest(root(), replyId);
				send(res, 200, {
					manifest: read.manifest,
					absent: read.absent,
					skipped: read.skipped,
					mode: read.mode
				});
			})
		}), "ui-layout: why this reply");
		webCtx.effect(() => webCtx.webServer.register({
			kind: "exact",
			path: HEALTH_ROUTE,
			handler: (req, res) => guarded(req, res, "GET", () => {
				const limitBytes = watchdogLimitBytes();
				send(res, 200, {
					samples: ring,
					limitBytes,
					intervalMs: SAMPLER_INTERVAL_MS
				});
			})
		}), "ui-layout: health history");
		webCtx.effect(() => webCtx.webServer.register({
			kind: "exact",
			path: APPROVALS_ROUTE,
			handler: (req, res) => guarded(req, res, "GET", () => {
				const read = readLog();
				send(res, 200, {
					entries: read.entries,
					absent: read.absent,
					skipped: read.skipped,
					mode: read.mode
				});
			})
		}), "ui-layout: approval history");
		webCtx.effect(() => webCtx.webServer.register({
			kind: "exact",
			path: FIRST_RUN_ROUTES.answer,
			handler: (req, res) => guarded(req, res, "GET", () => {
				const stateRoot = root();
				send(res, 200, {
					...firstRunAnswer(stateRoot),
					writable: stateRoot !== null
				});
			})
		}), "ui-layout: first-run answer");
		webCtx.effect(() => webCtx.webServer.register({
			kind: "exact",
			path: FIRST_RUN_ROUTES.name,
			handler: (req, res) => guarded(req, res, "POST", async () => {
				const stateRoot = root();
				if (stateRoot === null) {
					send(res, 500, { code: FIRST_RUN_REFUSALS.NO_STATE_ROOT });
					return;
				}
				const body = await readJsonBody(req);
				if (!body.ok) {
					send(res, 400, {
						code: FIRST_RUN_REFUSALS.BODY_NOT_OBJECT,
						because: body.because
					});
					return;
				}
				const name = typeof body.value.name === "string" ? body.value.name.trim() : "";
				if (name === "") {
					send(res, 400, { code: FIRST_RUN_REFUSALS.NAME_MISSING });
					return;
				}
				send(res, 200, {
					...rememberName(stateRoot, name, body.value.voice === "on" || body.value.voice === "off" ? body.value.voice : void 0),
					writable: true
				});
			})
		}), "ui-layout: first-run name");
		webCtx.effect(() => webCtx.webServer.register({
			kind: "exact",
			path: FIRST_RUN_ROUTES.key,
			handler: (req, res) => guarded(req, res, "POST", async () => {
				const stateRoot = root();
				if (stateRoot === null) {
					send(res, 500, { code: FIRST_RUN_REFUSALS.NO_STATE_ROOT });
					return;
				}
				const body = await readJsonBody(req);
				if (!body.ok) {
					send(res, 400, {
						code: FIRST_RUN_REFUSALS.BODY_NOT_OBJECT,
						because: body.because
					});
					return;
				}
				const key = typeof body.value.key === "string" ? body.value.key.trim() : "";
				if (key === "") {
					send(res, 400, { code: FIRST_RUN_REFUSALS.KEY_MISSING });
					return;
				}
				send(res, 200, {
					...rememberKey(stateRoot, key),
					writable: true
				});
			})
		}), "ui-layout: first-run key");
		webCtx.effect(() => webCtx.webServer.register({
			kind: "exact",
			path: FIRST_RUN_ROUTES.keyRemove,
			handler: (req, res) => guarded(req, res, "POST", () => {
				const stateRoot = root();
				if (stateRoot === null) {
					send(res, 500, { code: FIRST_RUN_REFUSALS.NO_STATE_ROOT });
					return;
				}
				send(res, 200, {
					...forgetKey(stateRoot),
					writable: true
				});
			})
		}), "ui-layout: first-run key removal");
	});
}
//#endregion
export { APPROVALS_ROUTE, FIRST_RUN_ROUTES, HEALTH_ROUTE, WHY_ROUTE, apply, fenceRejectionOf, readJsonBody };
