import z from "@deepseek-ai/schemastery";
import { z as z$1 } from "zod";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
//#region lib/types/aura/projection.js
/**
* Pure Aura Coherence projection over durable session records.
*
* This is a preparatory adapter, not the Aukora receipt chain. It deliberately
* excludes message bodies, tool arguments, tool results, approval reasons,
* and opaque ids. Every retained value can be replayed from event metadata.
*
* @module @aukora/face-settings/aura/projection
*/
const RECENT_LIMIT = 18;
const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;
const recordKindSchema = z$1.union([
	z$1.literal("message"),
	z$1.literal("action"),
	z$1.literal("approval"),
	z$1.literal("policy"),
	z$1.literal("lifecycle"),
	z$1.literal("system")
]);
const descriptorSchema = z$1.object({
	seq: z$1.number().int().nonnegative(),
	time: z$1.number().nonnegative(),
	type: z$1.string(),
	kind: recordKindSchema,
	label: z$1.string()
}).strict();
const auraCoherenceSchema = z$1.object({
	version: z$1.literal(1),
	source: z$1.literal("durable-session-log"),
	counts: z$1.object({
		records: z$1.number().int().nonnegative(),
		interactions: z$1.number().int().nonnegative(),
		turns: z$1.number().int().nonnegative(),
		humanMessages: z$1.number().int().nonnegative(),
		contextMessages: z$1.number().int().nonnegative(),
		assistantMessages: z$1.number().int().nonnegative(),
		toolCalls: z$1.number().int().nonnegative(),
		toolResults: z$1.number().int().nonnegative(),
		toolErrors: z$1.number().int().nonnegative()
	}).strict(),
	approvals: z$1.object({
		asked: z$1.number().int().nonnegative(),
		allowed: z$1.number().int().nonnegative(),
		rejected: z$1.number().int().nonnegative(),
		cancelled: z$1.number().int().nonnegative(),
		unavailable: z$1.number().int().nonnegative()
	}).strict(),
	confinement: z$1.object({
		preset: z$1.string().nullable(),
		sandbox: z$1.string().nullable(),
		approval: z$1.string().nullable()
	}).strict(),
	lastSeq: z$1.number().int().min(-1),
	lastTime: z$1.number().nonnegative().nullable(),
	recordFingerprint: z$1.string().regex(/^[0-9a-f]{8}$/u),
	recent: z$1.array(descriptorSchema).max(RECENT_LIMIT),
	identityBound: z$1.literal(false),
	cryptographicReceipts: z$1.literal(false),
	externallyAnchored: z$1.literal(false)
}).strict();
/**
* Construct the empty-log Aura state.
* @returns a fresh unbound state with no observed records.
*/
function emptyAuraCoherenceState() {
	return {
		version: 1,
		source: "durable-session-log",
		counts: {
			records: 0,
			interactions: 0,
			turns: 0,
			humanMessages: 0,
			contextMessages: 0,
			assistantMessages: 0,
			toolCalls: 0,
			toolResults: 0,
			toolErrors: 0
		},
		approvals: {
			asked: 0,
			allowed: 0,
			rejected: 0,
			cancelled: 0,
			unavailable: 0
		},
		confinement: {
			preset: null,
			sandbox: null,
			approval: null
		},
		lastSeq: -1,
		lastTime: null,
		recordFingerprint: FNV_OFFSET.toString(16).padStart(8, "0"),
		recent: [],
		identityBound: false,
		cryptographicReceipts: false,
		externallyAnchored: false
	};
}
/**
* Extend a non-cryptographic FNV-1a checksum with content-free event metadata.
* @param prior - prior eight-digit checksum.
* @param event - durable event whose metadata is incorporated.
* @returns the next eight-digit checksum.
*/
function extendFingerprint(prior, event) {
	let hash = Number.parseInt(prior, 16) >>> 0;
	const input = `${event.seq}|${event.time}|${event.type};`;
	for (let index = 0; index < input.length; index += 1) {
		hash ^= input.charCodeAt(index);
		hash = Math.imul(hash, FNV_PRIME) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}
/**
* Classify an event without retaining payload content.
* @param event - one durable session event.
* @returns descriptor kind and display label.
*/
function describeEvent(event) {
	switch (event.type) {
		case "user/message": return event.data.source.kind === "user" ? {
			kind: "message",
			label: "Human message"
		} : {
			kind: "system",
			label: "Context entered"
		};
		case "assistant/message": return {
			kind: "message",
			label: event.data.interrupted === true ? "Assistant interrupted" : "Assistant message"
		};
		case "tool/call": return {
			kind: "action",
			label: `${event.data.name} requested`
		};
		case "tool/result": return {
			kind: "action",
			label: event.data.error === void 0 ? "Tool completed" : "Tool failed"
		};
		case "approval/asked": return {
			kind: "approval",
			label: `${event.data.toolName} approval requested`
		};
		case "approval/decided": return {
			kind: "approval",
			label: `Approval ${event.data.outcome}`
		};
		case "permission/preset": return {
			kind: "policy",
			label: `Preset ${event.data.preset}`
		};
		case "sandbox/mode": return {
			kind: "policy",
			label: `Sandbox ${event.data.mode}`
		};
		case "approval/policy": return {
			kind: "policy",
			label: `Approval policy ${event.data.policy}`
		};
		case "turn/start": return {
			kind: "lifecycle",
			label: `Turn ${event.data.turn} opened`
		};
		case "turn/end": return {
			kind: "lifecycle",
			label: `Turn ${event.data.turn} ${event.data.reason.kind}`
		};
		case "step/start": return {
			kind: "lifecycle",
			label: `Step ${event.data.step} opened`
		};
		case "step/end": return {
			kind: "lifecycle",
			label: `Step ${event.data.step} closed`
		};
		default: return {
			kind: "system",
			label: event.type
		};
	}
}
/**
* Whether a durable record is one high-level interaction rather than a
* lifecycle or rendering fact.
* @param event - one durable event.
* @returns true for messages, model-requested actions, approval asks, and policy changes.
*/
function isInteraction(event) {
	switch (event.type) {
		case "user/message":
		case "assistant/message":
		case "tool/call":
		case "approval/asked":
		case "permission/preset":
		case "sandbox/mode":
		case "approval/policy": return true;
		default: return false;
	}
}
/**
* Fold one durable event into Aura's content-free session adapter.
* @param state - whole state before the event.
* @param event - next committed event.
* @returns the next whole state, or the same reference for a raw token chunk.
*/
function applyAuraCoherenceEvent(state, event) {
	const description = describeEvent(event);
	const descriptor = {
		seq: event.seq,
		time: event.time,
		type: event.type,
		kind: description.kind,
		label: description.label
	};
	const next = {
		...state,
		counts: {
			...state.counts,
			records: state.counts.records + 1,
			interactions: state.counts.interactions + (isInteraction(event) ? 1 : 0)
		},
		lastSeq: event.seq,
		lastTime: event.time,
		recordFingerprint: extendFingerprint(state.recordFingerprint, event),
		recent: [...state.recent, descriptor].slice(-18)
	};
	switch (event.type) {
		case "turn/start":
			next.counts.turns += 1;
			break;
		case "user/message":
			if (event.data.source.kind === "user") next.counts.humanMessages += 1;
			else next.counts.contextMessages += 1;
			break;
		case "assistant/message":
			next.counts.assistantMessages += 1;
			break;
		case "tool/call":
			next.counts.toolCalls += 1;
			break;
		case "tool/result":
			next.counts.toolResults += 1;
			if (event.data.error !== void 0) next.counts.toolErrors += 1;
			break;
		case "approval/asked":
			next.approvals = {
				...state.approvals,
				asked: state.approvals.asked + 1
			};
			break;
		case "approval/decided":
			next.approvals = { ...state.approvals };
			if (event.data.outcome === "allowed-once") next.approvals.allowed += 1;
			else next.approvals[event.data.outcome] += 1;
			break;
		case "permission/preset":
			next.confinement = {
				...state.confinement,
				preset: event.data.preset
			};
			break;
		case "sandbox/mode":
			next.confinement = {
				...state.confinement,
				sandbox: event.data.mode
			};
			break;
		case "approval/policy":
			next.confinement = {
				...state.confinement,
				approval: event.data.policy
			};
			break;
		default: break;
	}
	return next;
}
/** Aura's replayable session projection registered on `ctx.sessionProjections`. */
const auraCoherenceProjectionDefinition = {
	key: "auraCoherence",
	stateVersion: 1,
	stateSchema: auraCoherenceSchema,
	init: emptyAuraCoherenceState,
	apply: applyAuraCoherenceEvent,
	wire: {
		viewSchema: auraCoherenceSchema,
		view: (state) => state
	}
};
//#endregion
//#region lib/types/index.js
/**
* Host loader entry: the Aura session projection, the onboarding settings namespace, and
* one authenticated read-only route that projects the Aura evidence already on disk.
*
* TWO DIFFERENT THINGS, KEPT APART ON PURPOSE. The session projection is ACTIVITY — a
* content-free fold over the durable session log, which declares in its own schema that
* it carries no receipts, no identity binding and no external anchor. The route below is
* EVIDENCE — receipts and retention read from the composition state, verified by the
* adapter that owns verification. A screen may show both; it may never add them up.
*
* The route adds no verification of its own. It spawns
* `evidence/aura-evidence.py`, which calls `scripts/aura/adapter.py` and reports what it
* answers, refusal names included.
*/
var __rewriteRelativeImportExtension = function(path, preserveJsx) {
	if (typeof path === "string" && /^\.\.?\//.test(path)) return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function(m, tsx, d, ext, cm) {
		return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : d + ext + "." + cm.toLowerCase() + "js";
	});
	return path;
};
/** Same-origin GET route serving the read-only Aura evidence projection. */
const AURA_EVIDENCE_ENDPOINT = "/api/aukora/aura-evidence";
/** Same-origin GET route through which a shell asks this backend what it is. */
const BACKEND_IDENTITY_ENDPOINT = "/api/aukora/backend-identity";
/** The faces whose presence in a release makes it the spatial frontend. */
const SPATIAL_FACES = Object.freeze([
	"layout",
	"sidebar",
	"threads",
	"settings"
]);
/** The projection is a short read; a run longer than this is a refusal, not a wait. */
const PROJECTION_TIMEOUT_MS = 2e4;
/** A projection document larger than this is refused rather than buffered. */
const PROJECTION_MAX_BYTES = 4 * 1024 * 1024;
/** This file's own directory, and the release (or package) root two levels above it. */
const HERE = dirname(fileURLToPath(import.meta.url));
/**
* Resolve the composition state directory the way the gate itself resolves it.
*
* ONE SOURCE OF TRUTH, NOT A SECOND COPY OF THE PRECEDENCE. `resolveStateDir` lives in
* the association plugin and reads config.stateDir, then config.gateRoot, then the
* stateDir inside $AUKORA_GATE_CONFIG, then `<gateRoot>/gate-state`. Re-deriving that
* order here would work until the day it drifted, and then this route would confidently
* report evidence from a directory nothing else was using.
* @param releaseRoot - the root the face was loaded from.
* @returns the state directory, or undefined when the association plugin is not carried.
*/
async function resolveGateState(releaseRoot) {
	const candidate = join(releaseRoot, "plugins/aukora-aura-association/lib/index.js");
	try {
		const module = await import(__rewriteRelativeImportExtension(candidate));
		if (typeof module.resolveStateDir !== "function") return void 0;
		return module.resolveStateDir({ gateRoot: releaseRoot }, process.env);
	} catch {
		return;
	}
}
/**
* What this backend is, answered by the backend itself.
*
* WHY A BACKEND MUST ANSWER THIS. A window showing a page cannot tell which release
* serves it, and the two ways to guess are both wrong: reading a launch record out of
* another deployment's private state root crosses a boundary that should stay closed,
* and matching a port names a listener rather than a release. So the backend reports its
* own identity over an authenticated route, and a window that cannot reach this route
* reports the identity as unknown rather than inferring one.
*
* Everything here is read from the tree this module was loaded out of. It carries no
* secret: a release path, the commit that release records about itself, and which face
* plugins are beside it.
* @param releaseRoot - the root this face was loaded from.
* @returns the identity document.
*/
function backendIdentity(releaseRoot) {
	const observedAt = (/* @__PURE__ */ new Date()).toISOString();
	let genesisCommit = null;
	let recordError = null;
	try {
		const commit = JSON.parse(readFileSync(join(releaseRoot, ".dsh-build/genesis-artifacts.json"), "utf8")).producer?.genesisCommit;
		genesisCommit = typeof commit === "string" ? commit : null;
	} catch (error) {
		recordError = String(error.message ?? error);
	}
	const faces = SPATIAL_FACES.filter((face) => existsSync(join(releaseRoot, `plugins/aukora-face-${face}/lib/client.js`)));
	return {
		schema: "aukora-face/backend-identity:v1",
		observedAt,
		release: {
			root: releaseRoot,
			name: releaseRoot.split("/").filter(Boolean).pop() ?? releaseRoot,
			genesisCommit,
			recordError
		},
		frontend: {
			identity: faces.length === SPATIAL_FACES.length ? "spatial" : faces.length === 0 ? "stock" : "partial",
			facesPresent: faces,
			facesExpected: [...SPATIAL_FACES]
		}
	};
}
/** A refusal body in the projection's own shape, so a consumer parses one thing. */
function refusalDocument(code, reason) {
	return {
		source: { schema: "aukora-face/aura-evidence:v1" },
		ceilings: [],
		refusal: {
			code,
			reason
		}
	};
}
/** Durable settings namespace for product-wide GUI onboarding facts. */
const ONBOARDING_SETTINGS_NAMESPACE = "ui-onboarding";
const OnboardingSettingsSchema = z.object({ welcomeNoticeVersion: z.string() });
/**
* Run the evidence projection once and return its document.
* @param releaseRoot - the root this face was loaded from.
* @returns the projection document, or a refusal in the same shape.
*/
async function readAuraEvidence(releaseRoot) {
	const script = join(HERE, "..", "evidence", "aura-evidence.py");
	const scripts = join(releaseRoot, "scripts");
	const state = await resolveGateState(releaseRoot);
	if (state === void 0) return refusalDocument("aura-state-unresolved", "the association plugin that owns state resolution is not carried here, so this route will not guess which directory the gate is using");
	return await new Promise((settle) => {
		execFile("python3", [
			script,
			"--state",
			state,
			"--scripts",
			scripts
		], {
			timeout: PROJECTION_TIMEOUT_MS,
			maxBuffer: PROJECTION_MAX_BYTES,
			cwd: releaseRoot
		}, (error, stdout) => {
			if (error) {
				settle(refusalDocument("aura-projection-failed", `${error.name}: ${error.message}`));
				return;
			}
			try {
				settle(JSON.parse(stdout));
			} catch (parseError) {
				settle(refusalDocument("aura-projection-unparseable", String(parseError)));
			}
		});
	});
}
/** Register the projection, the settings namespace, and the evidence route. */
function apply(ctx) {
	ctx.inject(["sessionProjections"], (projectionCtx) => {
		projectionCtx.sessionProjections.register(auraCoherenceProjectionDefinition);
	});
	ctx.inject(["settings"], (settingsCtx) => {
		settingsCtx.settings.register(ONBOARDING_SETTINGS_NAMESPACE, OnboardingSettingsSchema);
	});
	ctx.inject(["webServer", "connection"], (webCtx) => {
		const releaseRoot = resolve(HERE, "..", "..", "..");
		const gate = () => Reflect.get(webCtx, "connection");
		webCtx.effect(() => webCtx.webServer.register({
			kind: "exact",
			path: AURA_EVIDENCE_ENDPOINT,
			handler: async (req, res) => {
				const rejection = gate().requestRejection(req);
				if (rejection !== void 0) {
					res.writeHead(rejection, { "cache-control": "no-store" });
					res.end();
					return;
				}
				if (req.method !== "GET") {
					res.writeHead(405, {
						allow: "GET",
						"cache-control": "no-store"
					});
					res.end();
					return;
				}
				const document = await readAuraEvidence(releaseRoot);
				res.writeHead(200, {
					"cache-control": "no-store",
					"content-type": "application/json; charset=utf-8",
					"x-content-type-options": "nosniff"
				});
				res.end(JSON.stringify(document));
			}
		}), "ui-settings-general: aura evidence route");
		webCtx.effect(() => webCtx.webServer.register({
			kind: "exact",
			path: BACKEND_IDENTITY_ENDPOINT,
			handler: (req, res) => {
				const rejection = gate().requestRejection(req);
				if (rejection !== void 0) {
					res.writeHead(rejection, { "cache-control": "no-store" });
					res.end();
					return;
				}
				if (req.method !== "GET") {
					res.writeHead(405, {
						allow: "GET",
						"cache-control": "no-store"
					});
					res.end();
					return;
				}
				res.writeHead(200, {
					"cache-control": "no-store",
					"content-type": "application/json; charset=utf-8",
					"x-content-type-options": "nosniff"
				});
				res.end(JSON.stringify(backendIdentity(releaseRoot)));
			}
		}), "ui-settings-general: backend identity route");
	});
}
//#endregion
export { AURA_EVIDENCE_ENDPOINT, BACKEND_IDENTITY_ENDPOINT, apply, backendIdentity, readAuraEvidence };
