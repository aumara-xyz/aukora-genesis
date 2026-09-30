window.__ModuleLoader__.load({
	id: "@aukora/face-memory",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let _aukora_face_layout_client = require("@aukora/face-layout/client");
		//#region \0dsh-css:Memory.module.css.mjs
		const css = ".Rjr40G_memoryView[hidden]{display:none!important}.Rjr40G_memoryView{z-index:1;box-sizing:border-box;overscroll-behavior:contain;scrollbar-gutter:stable;width:100%;min-width:0;max-width:46rem;height:100%;min-height:0;color:var(--aukora-text);background:0 0;flex-direction:column;gap:18px;margin:0 auto;padding:22px 20px 48px;display:flex;position:relative;overflow:hidden auto;container-type:inline-size}.Rjr40G_memoryHead{flex-direction:column;flex:none;align-items:flex-start;gap:4px;padding:0 4px}.Rjr40G_memoryTitle{margin:0;font-size:20px;font-weight:600;line-height:28px}.Rjr40G_portals{flex-direction:column;flex:none;gap:10px;min-width:0;display:flex}.Rjr40G_portalDot{background:currentColor;border-radius:50%;width:9px;height:9px}.Rjr40G_portalBody{flex-direction:column;gap:8px;display:flex}.Rjr40G_portalSearch{box-sizing:border-box;border:1px solid color-mix(in srgb, var(--aukora-accent) 30%, transparent);border-radius:var(--aukora-radius);background:var(--aukora-surface);width:100%;max-width:420px;height:38px;color:var(--aukora-text);font:inherit;text-align:center;margin:2px auto 8px;padding:0 16px;font-size:13px;display:block}.Rjr40G_portalSearch::placeholder{color:var(--aukora-text-muted)}.Rjr40G_portalSearch:focus-visible{outline:2px solid var(--aukora-accent);outline-offset:2px}.Rjr40G_portalQuiet{color:var(--aukora-text-muted);text-align:center;margin:4px 0;font-size:12px}.Rjr40G_memoryList{flex-direction:column;gap:8px;margin:0;padding:0;list-style:none;display:flex}.Rjr40G_memoryPortal{gap:12px;min-height:48px;padding:10px 14px}.Rjr40G_memoryWords{overflow-wrap:anywhere;white-space:pre-wrap;min-width:0;font-size:14px;font-weight:400;line-height:20px;display:block}.Rjr40G_memoryItem[data-open=no] .Rjr40G_memoryWords{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.Rjr40G_memoryWhen{color:var(--aukora-text-muted);flex-direction:column;flex:none;align-items:flex-end;gap:3px;font-size:12px;display:flex}.Rjr40G_memoryDetail{padding:0 14px 12px}.Rjr40G_memoryActions{flex-wrap:wrap;align-items:center;gap:8px;margin-top:4px;display:flex}.Rjr40G_pill{padding:4px 12px;font-size:12px}.Rjr40G_memoryProblem{color:var(--aukora-red-warning);align-self:center}.Rjr40G_retry,.Rjr40G_more{align-self:center}.Rjr40G_more{padding:8px 20px}.Rjr40G_portalBody,.Rjr40G_memoryList,.Rjr40G_memoryItem,.Rjr40G_memoryDetail{min-width:0}.Rjr40G_memoryMenuItem{width:100%}@container (width<=340px){.Rjr40G_memoryPortal{flex-direction:column;align-items:flex-start;gap:6px}.Rjr40G_memoryWhen{flex-flow:wrap;gap:8px;font-size:11px}.Rjr40G_portalHead{gap:10px;padding:10px 12px}.Rjr40G_portalBody{padding:2px 8px 12px}}";
		const tagId = "@aukora/face-memory/Memory.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@aukora/face-memory";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var Memory_module_css_default = {
			"memoryActions": "Rjr40G_memoryActions",
			"memoryDetail": "Rjr40G_memoryDetail",
			"memoryHead": "Rjr40G_memoryHead",
			"memoryItem": "Rjr40G_memoryItem",
			"memoryList": "Rjr40G_memoryList",
			"memoryMenuItem": "Rjr40G_memoryMenuItem",
			"memoryPortal": "Rjr40G_memoryPortal",
			"memoryProblem": "Rjr40G_memoryProblem",
			"memoryTitle": "Rjr40G_memoryTitle",
			"memoryView": "Rjr40G_memoryView",
			"memoryWhen": "Rjr40G_memoryWhen",
			"memoryWords": "Rjr40G_memoryWords",
			"more": "Rjr40G_more",
			"pill": "Rjr40G_pill",
			"portalBody": "Rjr40G_portalBody",
			"portalDot": "Rjr40G_portalDot",
			"portalHead": "Rjr40G_portalHead",
			"portalQuiet": "Rjr40G_portalQuiet",
			"portalSearch": "Rjr40G_portalSearch",
			"portals": "Rjr40G_portals",
			"retry": "Rjr40G_retry"
		};
		//#endregion
		//#region src/client/MemoryMenu.tsx
		/**
		* Open the Memory view in the centre.
		*
		* ONE CLICK, ONE PLACE: the launcher opens the surface the way the design's §7.1 asks (`contained` in the centre),
		* and it marks itself current while that surface is open so a person can see where they are.
		*
		* @param props - the right-menu owner share and the localized copy.
		* @returns the Memory launcher button.
		*/
		function MemoryMenu({ activeSurface, openSurface, t }) {
			const active = activeSurface === "memory";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				"data-memory-launcher": true,
				className: Memory_module_css_default.memoryMenuItem,
				"aria-current": active ? "page" : void 0,
				title: t("menu.memory.tip"),
				onClick: () => {
					openSurface("memory", void 0, "contained");
				},
				children: t("menu.memory")
			});
		}
		//#endregion
		//#region src/client/memory-model.ts
		/**
		* THE MEMORY APP'S VIEW MODEL — one list Peter can read, with receipts he can check.
		*
		* PETER'S WORDS: *"a memory app on the right, and you click it, and then it shows memories in the middle that are
		* approved or unapproved"*. THE CONTRACT: `.agents/live/MEMORY-CONTRACT-v0.md` — memories are TRACKED, NOT APPROVED;
		* capture is automatic and usable at once; a human click happens only for self-modification and for marking a memory
		* trusted. The record this renders is the contract's:
		*
		*   {id, tier, kind (fact|preference|decision|commitment|person|project|observation), text, createdAt,
		*    source:{sessionId, sessionTitle, seq, at, sha256}, aura:{index, entryHash},
		*    trusted?:{signer, at, approvalDigest}, forgotten?:{at, reason, tombstoneHash}}
		*
		* **THE TAB IS CALLED SIGNED.** Contract v0 (14:37) calls this tier `trusted`; the design that landed at 14:52
		* renames it, because "a signature today proves only that some same-user process had the key" — so the label Peter
		* reads says **Signed** and the tier key stays `trusted` as the routes and records spell it. Both facts matter: the
		* screen must not claim an authority the system cannot back, and the wire format must not drift to match a rename.
		*
		* **NO JARGON ON THE SCREEN** (the goal's words). Every kind, tier and state below carries a plain sentence for Peter
		* and the technical name only where a developer needs it. A receipt badge is the clearest case: `VERIFIED`,
		* `CHANGED` and `MISSING` are the route's vocabulary, and the screen says "matches the original", "changed since it
		* was recorded" and "the original is gone" instead.
		*
		* PURE, SO THE CLAIMS ARE MEASURED. Nothing here fetches, writes or reads a clock: the source's answer arrives as
		* data, `now` is passed in, and every rule the goal names — the tiers, the exact ids a Sign sends, the confirm
		* Forget needs, and the badge that must never be green without a verify response — is checked by a court.
		*
		* @module memory-model
		*/
		/** The contract's closed kind list, in the order the filter offers them. */
		const KINDS = [
			"fact",
			"preference",
			"decision",
			"commitment",
			"person",
			"project",
			"observation"
		];
		/** The contract's four tiers: what she remembers, what he signed, what dreaming suggests, what was forgotten. */
		/**
		* The four tiers, **in KIRA's own names**.
		*
		* The middle one is `signed`, not `trusted`: `plugins/aukora-kira/lib/memory-tiers.mjs:35` declares
		* `MEMORY_TIERS = ['remembered', 'signed', 'proposal', 'forgotten']` and line 38 keeps the retirement in writing —
		* `RENAMED_TIER = { trusted: 'signed' }`. KIRA refuses the old name, so this face must not use it either.
		*
		* **WHY THESE ARE DECLARED HERE RATHER THAN IMPORTED FROM THAT FILE**: `memory-tiers.mjs` imports `node:crypto`, and
		* this module is bundled for the browser — an import would pull Node's crypto into the client bundle. The names are
		* therefore declared here and **held equal to KIRA's by a court**, which is the same arrangement the routes use and
		* the only one that survives a browser build.
		*/
		const TIERS = [
			"remembered",
			"signed",
			"proposal",
			"forgotten"
		];
		/**
		* What the tab says. `trusted` reads **Signed** — see the module note — and every tier is a sentence rather than a
		* state machine's name.
		*/
		const TIER_TABS = Object.freeze([
			{
				tier: "remembered",
				label: "Remembered",
				blurb: "Auma picked these up as you talked. They are hers to use, and they carry no authority."
			},
			{
				tier: "signed",
				label: "Signed",
				blurb: "These are the ones you signed yourself. Only these can act as a rule."
			},
			{
				tier: "proposal",
				label: "Proposals",
				blurb: "Things Auma thinks are worth making into rules. Nothing here is in effect."
			},
			{
				tier: "forgotten",
				label: "Forgotten",
				blurb: "Erased. What remains is the record that you erased it."
			}
		]);
		function receiptBadgeOf(answer) {
			const supplied = answer !== null && typeof answer === "object" && "source" in answer;
			const source = supplied ? answer.source : void 0;
			if (source !== null && typeof source === "object" && source.state === "UNLINKED") return {
				state: "unlinked",
				glyph: "·",
				label: "the original cannot be checked: the session is not in this store"
			};
			if (supplied && source !== void 0 && source !== null && typeof source !== "string") return {
				state: "malformed",
				glyph: "?",
				label: "this receipt is not in a shape that can be read"
			};
			switch (source) {
				case "VERIFIED": return {
					state: "verified",
					glyph: "✓",
					label: "matches the original"
				};
				case "CHANGED": return {
					state: "changed",
					glyph: "!",
					label: "changed since it was recorded"
				};
				case "MISSING": return {
					state: "missing",
					glyph: "?",
					label: "the original is gone"
				};
				case "ERASED": return {
					state: "erased",
					glyph: "·",
					label: "erased"
				};
				case "UNVERIFIABLE": return {
					state: "unverifiable",
					glyph: "?",
					label: "could not check"
				};
				default: return typeof source === "string" ? {
					state: "malformed",
					glyph: "?",
					label: "this receipt names a state that cannot be read"
				} : {
					state: "unchecked",
					glyph: "–",
					label: "not checked yet"
				};
			}
		}
		/**
		* THE IDS A REPLY CITED, READ OUT OF THE MANIFEST THE `why` ROUTE SERVES — AND `null` IS NOT `[]`.
		*
		* The manifest is what AUMA's log carries for one reply: `{replyId, groups: [{block, items: [{id, …}]}]}`. The ids a
		* person would want the Memory app filtered to are the **item ids across every group**, and nothing else on the
		* manifest is a memory id — `sha256` is the evidence a rebuild is checked against and the manifest's own doc says it
		* is *"Never rendered"*, so it is not read here either.
		*
		* **THE TWO EMPTY ANSWERS MEAN DIFFERENT THINGS, WHICH IS WHY THIS IS NULLABLE**:
		*   · **`null` — there is no manifest to read.** The route answered `manifest: null` (no store, or no manifest for
		*     that reply). Nothing was cited, so **no id filter is in force** and the app opens as it always does.
		*   · **`[]` — a manifest EXISTS and cites no records.** A reply that used no memory is a real reply, and the honest
		*     screen for it is **no records**, not the whole list. Returning `null` here would show every memory she has
		*     under a link that claims to show what one reply used.
		*
		* A malformed answer is `null` as well rather than a throw: this runs during a render, and a link that cannot read
		* its manifest must not take the whole app down. The distinction it loses is recorded by the caller, which knows
		* whether it asked at all.
		*
		* @param answer - the route's decoded JSON, or anything at all.
		* @returns the cited ids, `[]` for a manifest that cites none, or `null` when there is no manifest to read.
		*/
		function citedIdsOf(answer) {
			if (answer === null || typeof answer !== "object") return null;
			const manifest = answer.manifest;
			if (manifest === null || typeof manifest !== "object") return null;
			const groups = manifest.groups;
			if (!Array.isArray(groups)) return [];
			const ids = [];
			for (const group of groups) {
				if (group === null || typeof group !== "object") continue;
				const items = group.items;
				if (!Array.isArray(items)) continue;
				for (const item of items) {
					if (item === null || typeof item !== "object") continue;
					const id = item.id;
					if (typeof id === "string" && id !== "" && !ids.includes(id)) ids.push(id);
				}
			}
			return ids;
		}
		/** How a note got here, as the design's signer sheet names it (§7.3). */
		const PROVENANCE_KINDS = [
			"you-said",
			"heard",
			"edited",
			"dream",
			"backfill"
		];
		/** The view a person starts with: what she remembers, nothing ticked, nothing being confirmed. */
		const INITIAL_VIEW = Object.freeze({
			tier: "remembered",
			query: "",
			kind: "all",
			selected: [],
			confirmingForget: null,
			receipts: {},
			citedIds: null
		});
		function textOf(value) {
			return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
		}
		function timeOf(value) {
			return typeof value === "number" && Number.isFinite(value) ? value : null;
		}
		/** One record as a row, or null when it has no identity at all (a row with no id cannot be acted on). */
		function itemOf(record, receipts = {}) {
			if (record === null || typeof record !== "object") return null;
			const raw = record;
			const id = textOf(raw.id);
			if (id === null) return null;
			const tier = TIERS.includes(raw.tier) ? raw.tier : "remembered";
			const kind = KINDS.includes(raw.kind) ? raw.kind : "observation";
			const erased = tier === "forgotten";
			const text = erased ? null : textOf(raw.text);
			const source = raw.source ?? {};
			const trusted = raw.trusted ?? null;
			const forgotten = raw.forgotten ?? null;
			return {
				id,
				tier,
				backend: raw.backend === "openviking" ? "openviking" : "kira",
				author: raw.author === "Peter" || raw.author === "agent" ? raw.author : null,
				dateKind: raw.dateKind === "modified" ? "modified" : "created",
				kind,
				text: erased ? "" : text ?? "(this one could not be read)",
				createdAt: timeOf(raw.createdAt),
				source: {
					sessionTitle: textOf(source.sessionTitle) ?? "an unnamed conversation",
					titleKnown: textOf(source.sessionTitle) !== null,
					at: timeOf(source.at),
					sessionId: textOf(source.sessionId)
				},
				receipt: erased ? receiptBadgeOf({ source: "ERASED" }) : receipts[id] ?? receiptBadgeOf(null),
				provenance: {
					kind: text === null ? "you-said" : PROVENANCE_KINDS.includes(source.kind) ? source.kind : source.dream === true ? "dream" : "you-said",
					quote: text === null ? null : textOf(source.quote)
				},
				notInEffect: tier === "signed" ? false : tier === "proposal" ? true : raw.notInEffect === true,
				unreadable: !erased && text === null,
				erased,
				signedAt: trusted === null ? null : timeOf(trusted.at),
				forgottenAt: forgotten === null ? null : timeOf(forgotten.at),
				forgottenReason: forgotten === null ? null : textOf(forgotten.reason)
			};
		}
		/**
		* The rows for the open tab: newest first, filtered by the search and the kind, with unreadable records kept.
		*
		* @param answer - the list route's answer, as untrusted JSON: `{items: [...]}` or a bare array.
		* @param view - the current controls, so the filter and the receipts agree with what is on screen.
		* @returns the rows, and how many entries could not be turned into rows at all.
		*/
		function itemsOf(answer, view) {
			const list = Array.isArray(answer) ? answer : answer !== null && typeof answer === "object" && Array.isArray(answer.items) ? answer.items : [];
			const query = view.query.trim().toLowerCase();
			const items = [];
			let skipped = 0;
			for (const record of list) {
				const item = itemOf(record, view.receipts ?? {});
				if (item === null) {
					skipped += 1;
					continue;
				}
				if (item.tier !== view.tier) continue;
				if (view.kind !== "all" && item.kind !== view.kind) continue;
				if (view.citedIds !== null && !view.citedIds.includes(item.id)) continue;
				if (query !== "" && !item.text.toLowerCase().includes(query)) continue;
				items.push(item);
			}
			if (!view.ranked) items.sort((a, b) => {
				if (a.createdAt === null && b.createdAt === null) return a.id < b.id ? -1 : 1;
				if (a.createdAt === null) return 1;
				if (b.createdAt === null) return -1;
				return b.createdAt - a.createdAt;
			});
			return {
				items,
				skipped
			};
		}
		//#endregion
		//#region src/client/memory-api.ts
		const WHY_MANIFEST_ROUTE = "/api/aukora/why";
		const KIRA_MEMORY_ROUTES = {
			list: "/api/kira/memories",
			verify: "/api/kira/memories/verify",
			forget: "/api/kira/memories/forget",
			trust: "/api/kira/trust"
		};
		const OPENVIKING_MEMORY_ROUTES = {
			remembered: "/api/aukora/memory/remembered",
			list: "/api/aukora/memory/openviking",
			forget: "/api/aukora/memory/openviking/forget"
		};
		const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
		var MemoryServiceError = class extends Error {
			problem;
			status;
			code;
			body;
			constructor(problem, status, code, body = {}) {
				super(code);
				this.problem = problem;
				this.status = status;
				this.code = code;
				this.body = body;
			}
		};
		function wireTime(value) {
			const parsed = typeof value === "number" ? value < 0xe8d4a51000 ? value * 1e3 : value : typeof value === "string" ? Date.parse(value) : NaN;
			return Number.isFinite(parsed) ? parsed : null;
		}
		function noteToRecord(note) {
			const source = object(note.source ?? object(note.citation).source);
			const attributed = String(note.attributedTo ?? "").toLowerCase();
			const role = String(source.role ?? source.kind ?? "").toLowerCase();
			const author = note.author === "Peter" || note.author === "agent" ? note.author : [
				"owner",
				"owner-voice",
				"owner-edit"
			].includes(attributed) ? "Peter" : [
				"lane-requester",
				"dream",
				"agent"
			].includes(attributed) ? "agent" : [
				"assistant",
				"agent",
				"dream"
			].includes(role) || source.dream === true ? "agent" : [
				"user",
				"peter",
				"you-said",
				"edited"
			].includes(role) ? "Peter" : null;
			const kinds = [
				"fact",
				"preference",
				"decision",
				"commitment",
				"person",
				"project",
				"observation"
			];
			const kind = String(note.kind ?? note.category ?? note.label);
			return {
				...note,
				id: String(note.id),
				backend: "kira",
				tier: note.tier === "trusted" ? "signed" : note.tier,
				kind: kinds.includes(kind) ? kind : "observation",
				text: String(note.text ?? note.statement ?? ""),
				createdAt: wireTime(note.createdAt) ?? wireTime(note.observedAt) ?? wireTime(note.validFrom) ?? wireTime(source.at),
				author,
				source,
				aura: note.aura ?? object(note.citation).aura
			};
		}
		function httpMemorySource(options = {}) {
			const call = options.fetchImpl ?? ((...args) => fetch(...args));
			const send = async (path, init = {}) => {
				let response;
				try {
					response = await call(path, {
						credentials: "same-origin",
						...init
					});
				} catch {
					throw new MemoryServiceError("absent", 0, "memory:unreachable");
				}
				const body = object(await response.json().catch(() => null));
				if (!response.ok) throw new MemoryServiceError(response.status === 404 ? "absent" : "refused", response.status, typeof body.error === "string" ? body.error : "memory:request-failed", body);
				return body;
			};
			const post = (path, id) => send(path, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ id })
			});
			return {
				kind: "live",
				async list(input) {
					const cursor = input.before ? JSON.parse(input.before) : {
						kira: "",
						openviking: input.tier === "remembered" ? "" : null
					};
					const backends = ["openviking", "kira"].filter((backend) => cursor[backend] !== null);
					const results = await Promise.allSettled(backends.map(async (backend) => {
						const params = new URLSearchParams({ q: input.q ?? "" });
						if (cursor[backend]) params.set("before", cursor[backend]);
						if (backend === "kira") {
							params.set("tier", input.tier);
							params.set("limit", "500");
						}
						const body = await send(`${backend === "openviking" ? OPENVIKING_MEMORY_ROUTES.list : input.tier === "remembered" ? OPENVIKING_MEMORY_ROUTES.remembered : KIRA_MEMORY_ROUTES.list}?${params}`, input.signal ? { signal: input.signal } : {});
						if (!Array.isArray(body.items)) throw new MemoryServiceError("failed", 502, `memory:${backend}-invalid-list`);
						const items = body.items.map(object).filter((row) => typeof row.id === "string").map((row) => backend === "kira" ? noteToRecord(row) : row);
						const next = typeof body.next === "string" && body.next ? body.next : null;
						if (next !== null && next === cursor[backend]) throw new MemoryServiceError("failed", 502, `memory:${backend}-cursor-stalled`);
						return {
							backend,
							items,
							next,
							issues: Array.isArray(body.issues) ? body.issues.filter((issue) => typeof issue === "string") : []
						};
					}));
					const items = [];
					const next = {
						kira: null,
						openviking: null
					};
					const issues = [];
					for (let i = 0; i < results.length; i++) {
						const result = results[i];
						if (result.status === "fulfilled") {
							items.push(...result.value.items);
							next[result.value.backend] = result.value.next;
							issues.push(...result.value.issues.map((issue) => `${result.value.backend}:${issue}`));
						} else issues.push(`${backends[i]}:${result.reason instanceof MemoryServiceError ? result.reason.code : "memory:request-failed"}`);
					}
					if (results.length > 0 && results.every((result) => result.status === "rejected")) throw results[0].reason;
					return {
						items,
						next: next.kira !== null || next.openviking !== null ? JSON.stringify(next) : null,
						issues
					};
				},
				async verify(id) {
					return await post(KIRA_MEMORY_ROUTES.verify, id);
				},
				async forget(id) {
					const body = await post(id.startsWith("viking://") ? OPENVIKING_MEMORY_ROUTES.forget : KIRA_MEMORY_ROUTES.forget, id);
					if (body.forgotten !== true) throw new MemoryServiceError("refused", 409, typeof body.refused === "string" ? body.refused : "memory:forget-unconfirmed", body);
					return body;
				}
			};
		}
		//#endregion
		//#region src/client/MemorySurface.tsx
		/** A paged memory view inside the existing centre lane. */
		const SOURCE = httpMemorySource();
		const TONE = {
			remembered: "green",
			signed: "gold",
			proposal: "purple",
			forgotten: "blue"
		};
		const dateText = (at) => at === null ? "—" : new Date(at).toLocaleDateString();
		const errorCode = (error) => error instanceof MemoryServiceError ? error.code : "memory:request-failed";
		function WarningIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "14",
				height: "14",
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.5",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12 3 22 21H2Z" })
			});
		}
		function MemorySurface({ activeSurface, t, openSource, surfaceTarget }) {
			const active = activeSurface === "memory";
			const [view, setView] = (0, react.useState)(INITIAL_VIEW);
			const [records, setRecords] = (0, react.useState)([]);
			const [state, setState] = (0, react.useState)("loading");
			const [issues, setIssues] = (0, react.useState)([]);
			const [next, setNext] = (0, react.useState)(null);
			const [paging, setPaging] = (0, react.useState)(false);
			const [revision, setRevision] = (0, react.useState)(0);
			const [openTier, setOpenTier] = (0, react.useState)("remembered");
			const [openItem, setOpenItem] = (0, react.useState)(null);
			const [actionError, setActionError] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(null);
			const [whyTrouble, setWhyTrouble] = (0, react.useState)(false);
			const generation = (0, react.useRef)(0);
			const pageInFlight = (0, react.useRef)(false);
			const scroller = (0, react.useRef)(null);
			const more = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				if (!active || openTier === null) return;
				const current = ++generation.current;
				const abort = new AbortController();
				pageInFlight.current = false;
				setPaging(false);
				setState("loading");
				setRecords([]);
				setNext(null);
				setIssues([]);
				const timer = window.setTimeout(() => {
					SOURCE.list({
						tier: view.tier,
						q: view.query,
						signal: abort.signal
					}).then((answer) => {
						if (current !== generation.current || abort.signal.aborted) return;
						setRecords(answer.items);
						setNext(answer.next);
						setIssues(answer.issues ?? []);
						setState("ready");
					}).catch((error) => {
						if (current !== generation.current || abort.signal.aborted) return;
						setIssues([errorCode(error)]);
						setState("failed");
					});
				}, view.query ? 250 : 0);
				return () => {
					window.clearTimeout(timer);
					abort.abort();
					++generation.current;
				};
			}, [
				active,
				openTier,
				view.tier,
				view.query,
				revision
			]);
			const loadMore = (0, react.useCallback)(() => {
				if (!next || pageInFlight.current || state !== "ready") return;
				pageInFlight.current = true;
				setPaging(true);
				const current = generation.current;
				SOURCE.list({
					tier: view.tier,
					q: view.query,
					before: next
				}).then((answer) => {
					if (current !== generation.current) return;
					setRecords((previous) => {
						const merged = new Map(previous.map((record) => [record.id, record]));
						for (const record of answer.items) merged.set(record.id, record);
						return [...merged.values()];
					});
					setNext(answer.next);
					if (answer.issues?.length) setIssues((previous) => [...new Set([...previous, ...answer.issues])]);
				}).catch((error) => {
					if (current !== generation.current) return;
					setIssues((previous) => [...previous, errorCode(error)]);
					setNext(null);
				}).finally(() => {
					if (current !== generation.current) return;
					pageInFlight.current = false;
					setPaging(false);
				});
			}, [
				next,
				state,
				view.tier,
				view.query
			]);
			(0, react.useEffect)(() => {
				if (!active || !next || !more.current || paging) return;
				const observer = new IntersectionObserver((entries) => {
					if (entries.some((entry) => entry.isIntersecting)) loadMore();
				}, {
					root: scroller.current,
					rootMargin: "0px 0px 180px 0px"
				});
				observer.observe(more.current);
				return () => {
					observer.disconnect();
				};
			}, [
				active,
				next,
				paging,
				loadMore
			]);
			(0, react.useEffect)(() => {
				if (!surfaceTarget) {
					setView((current) => ({
						...current,
						citedIds: null
					}));
					setWhyTrouble(false);
					return;
				}
				const abort = new AbortController();
				fetch(`${WHY_MANIFEST_ROUTE}?reply=${encodeURIComponent(surfaceTarget)}`, {
					credentials: "same-origin",
					signal: abort.signal
				}).then((answer) => answer.ok ? answer.json() : null).then((answer) => {
					if (abort.signal.aborted) return;
					setWhyTrouble(answer === null);
					setView((current) => ({
						...current,
						citedIds: citedIdsOf(answer)
					}));
				}).catch(() => {
					if (!abort.signal.aborted) setWhyTrouble(true);
				});
				return () => {
					abort.abort();
				};
			}, [surfaceTarget]);
			const items = itemsOf({ items: records }, {
				...view,
				query: "",
				ranked: view.query.trim() !== ""
			}).items;
			const forget = (id) => {
				if (busy) return;
				setBusy(id);
				setActionError(null);
				SOURCE.forget(id).then(() => {
					++generation.current;
					setRecords((previous) => previous.filter((record) => record.id !== id));
					setView((current) => ({
						...current,
						confirmingForget: null
					}));
					setOpenItem(null);
					setRevision((value) => value + 1);
				}).catch((error) => {
					setActionError({
						id,
						code: errorCode(error)
					});
				}).finally(() => {
					setBusy(null);
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				ref: scroller,
				className: Memory_module_css_default.memoryView,
				"data-memory-surface": true,
				"data-source": "live",
				"aria-label": t("view.title"),
				hidden: !active,
				"aria-hidden": !active,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_aukora_face_layout_client.SectionHeader, {
					className: Memory_module_css_default.memoryHead,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						className: Memory_module_css_default.memoryTitle,
						children: t("view.title")
					}), whyTrouble ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: Memory_module_css_default.memoryProblem,
						role: "img",
						"aria-label": t("surface.whyTrouble"),
						title: t("surface.whyTrouble"),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WarningIcon, {})
					}) : null]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: Memory_module_css_default.portals,
					children: TIER_TABS.map((each) => {
						const open = openTier === each.tier;
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_aukora_face_layout_client.PortalButton, {
							variant: TONE[each.tier],
							expanded: open,
							containerProps: { "data-memory-tab": each.tier },
							title: t(`tab.${each.tier}`),
							subtitle: t(`tab.${each.tier}.blurb`),
							icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: Memory_module_css_default.portalDot,
								"aria-hidden": "true"
							}),
							buttonClassName: Memory_module_css_default.portalHead,
							contentClassName: Memory_module_css_default.portalBody,
							contentProps: { "aria-busy": state === "loading" || paging },
							onExpandedChange: (nextOpen) => {
								setOpenItem(null);
								setActionError(null);
								setOpenTier(nextOpen ? each.tier : null);
								if (nextOpen) setView((current) => ({
									...current,
									tier: each.tier,
									query: "",
									confirmingForget: null
								}));
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "search",
									className: Memory_module_css_default.portalSearch,
									"data-memory-search": true,
									placeholder: t("search.placeholder"),
									"aria-label": t("search.placeholder"),
									value: view.query,
									onChange: (event) => {
										setOpenItem(null);
										setView((current) => ({
											...current,
											query: event.target.value,
											confirmingForget: null
										}));
									}
								}),
								state === "loading" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: Memory_module_css_default.portalQuiet,
									role: "img",
									"aria-label": t("surface.loading"),
									children: "⋯"
								}) : null,
								issues.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_aukora_face_layout_client.ActionButton, {
									type: "button",
									variant: "red-warning",
									className: Memory_module_css_default.retry,
									"data-memory-failed": state === "failed" ? "failed" : "partial",
									"data-memory-error": issues.join(","),
									title: issues.join("\n"),
									"aria-label": t("surface.failed"),
									onClick: () => {
										setRevision((value) => value + 1);
									},
									children: "↻"
								}) : null,
								state === "ready" && !issues.length && !next && items.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: Memory_module_css_default.portalQuiet,
									"data-memory-empty": view.tier,
									children: t("surface.empty")
								}) : null,
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
									className: Memory_module_css_default.memoryList,
									children: items.map((item) => {
										const expanded = openItem === item.id;
										const confirming = view.confirmingForget === item.id;
										const mutable = !item.erased && item.tier !== "signed";
										return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
											className: Memory_module_css_default.memoryItem,
											"data-memory-row": item.id,
											"data-memory-backend": item.backend,
											"data-memory-author": item.author ?? "unknown",
											"data-open": expanded ? "yes" : "no",
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_aukora_face_layout_client.PortalButton, {
												variant: TONE[each.tier],
												expanded,
												showIndicator: false,
												buttonClassName: Memory_module_css_default.memoryPortal,
												contentClassName: Memory_module_css_default.memoryDetail,
												title: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: Memory_module_css_default.memoryWords,
													children: item.text
												}),
												onExpandedChange: (nextOpen) => {
													setOpenItem(nextOpen ? item.id : null);
												},
												trailing: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: Memory_module_css_default.memoryWhen,
													children: [item.author === "Peter" || item.author === "agent" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
														width: "14",
														height: "14",
														viewBox: "0 0 24 24",
														fill: "none",
														stroke: "currentColor",
														strokeWidth: "1.5",
														strokeLinecap: "round",
														strokeLinejoin: "round",
														role: "img",
														"aria-label": item.author,
														children: item.author === "Peter" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
															cx: "12",
															cy: "7",
															r: "4"
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M4 21v-2a8 8 0 0 1 16 0v2" })] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
															x: "4",
															y: "7",
															width: "16",
															height: "14",
															rx: "3"
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12 3v4M8 12v2m8-2v2M9 17h6" })] })
													}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("time", {
														dateTime: item.createdAt === null ? void 0 : new Date(item.createdAt).toISOString(),
														children: dateText(item.createdAt)
													})]
												}),
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: Memory_module_css_default.memoryActions,
													children: [
														item.source.sessionId && openSource ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_aukora_face_layout_client.ActionButton, {
															type: "button",
															className: Memory_module_css_default.pill,
															onClick: () => {
																openSource(item.source.sessionId);
															},
															children: t("action.openSource")
														}) : null,
														mutable && item.backend === "kira" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_aukora_face_layout_client.ActionButton, {
															type: "button",
															className: Memory_module_css_default.pill,
															variant: "green",
															"data-memory-verify": item.id,
															disabled: busy !== null,
															title: item.receipt.label,
															onClick: () => {
																setBusy(item.id);
																SOURCE.verify(item.id).then((answer) => {
																	setView((current) => ({
																		...current,
																		receipts: {
																			...current.receipts,
																			[item.id]: receiptBadgeOf(answer)
																		}
																	}));
																	setActionError(null);
																}).catch((error) => {
																	setActionError({
																		id: item.id,
																		code: errorCode(error)
																	});
																}).finally(() => {
																	setBusy(null);
																});
															},
															children: view.receipts[item.id] ? item.receipt.glyph : t("action.verify")
														}) : null,
														mutable ? confirming ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_aukora_face_layout_client.ActionButton, {
															type: "button",
															className: Memory_module_css_default.pill,
															variant: "red-warning",
															"data-memory-forget-confirm": item.id,
															disabled: busy !== null,
															onClick: () => {
																forget(item.id);
															},
															children: t("action.confirm")
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_aukora_face_layout_client.ActionButton, {
															type: "button",
															className: Memory_module_css_default.pill,
															"data-memory-keep": item.id,
															disabled: busy !== null,
															onClick: () => {
																setView((current) => ({
																	...current,
																	confirmingForget: null
																}));
																setActionError(null);
															},
															children: t("action.cancel")
														})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_aukora_face_layout_client.ActionButton, {
															type: "button",
															className: Memory_module_css_default.pill,
															variant: "red-warning",
															"data-memory-forget": item.id,
															disabled: busy !== null,
															onClick: () => {
																setActionError(null);
																setView((current) => ({
																	...current,
																	confirmingForget: item.id
																}));
															},
															children: t("action.forget")
														}) : null,
														actionError?.id === item.id ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: Memory_module_css_default.memoryProblem,
															"data-memory-action-failed": actionError.code,
															role: "img",
															"aria-label": t("surface.actionFailed"),
															title: actionError.code,
															children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WarningIcon, {})
														}) : null
													]
												})
											})
										}, item.id);
									})
								}),
								next ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_aukora_face_layout_client.ActionButton, {
									ref: more,
									type: "button",
									className: Memory_module_css_default.more,
									variant: TONE[each.tier],
									"data-memory-more": true,
									disabled: paging,
									"aria-label": t("action.more"),
									onClick: loadMore,
									children: paging ? "⋯" : "↓"
								}) : null
							]
						}, each.tier);
					})
				})]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* The Memory app's words, in Chinese and English.
		*
		* ZH IS THE KEY-SET SOURCE OF TRUTH (the design's §7.1), so every key exists in both dictionaries and a missing
		* one is a broken screen rather than a fallback. The English is written for a person who is not an engineer: no
		* "tier", no "receipt", no "manifest", no "signature" — she remembers things, he can check one against the
		* conversation it came from, and signing is off until it asks for his fingerprint.
		*
		* @module locales
		*/
		/** The Chinese dictionary. */
		const zh = {
			"action.more": "加载更多记忆",
			"source.unknown": "来源未知",
			"when.modified": "更新于",
			"when.created": "记录于",
			"menu.memory": "记忆",
			"menu.memory.tip": "看看她在记什么",
			"view.title": "Auma 记得的事",
			"view.subtitle": "她一边和你说话一边记下来的。你可以留下、改一改，或者让她忘掉。",
			"tab.remembered": "记得的",
			"tab.signed": "已签名",
			"tab.proposal": "她的建议",
			"tab.forgotten": "已忘掉",
			"tab.remembered.blurb": "她和你说话时顺手记下的。她可以用，但这些话本身没有权力。",
			"tab.signed.blurb": "这些是你亲手签过的。只有这些能当规矩用。",
			"tab.proposal.blurb": "她觉得值得变成规矩的事。这里没有一条正在生效。",
			"tab.forgotten.blurb": "已经抹掉了。留下的只是\"你抹掉了它\"这件事。",
			"search.placeholder": "找一句话",
			"filter.kind": "哪一类",
			"filter.all": "全部",
			"kind.fact": "一件事",
			"kind.preference": "你的喜好",
			"kind.decision": "一个决定",
			"kind.commitment": "一个承诺",
			"kind.person": "一个人",
			"kind.project": "一个项目",
			"kind.observation": "留意到的",
			"row.from": "来自",
			"row.at": "当时",
			"row.signed": "你签于",
			"row.noWords": "没有留下内容",
			"receipt.unchecked": "还没查过",
			"receipt.verified": "和原话一致",
			"receipt.changed": "原话后来变了",
			"receipt.missing": "原话找不到了",
			"receipt.verified.why": "和它来自的那段对话对过了，还是一样。",
			"receipt.changed.why": "那段对话后来有改动，所以这句不再和它完全一致。",
			"receipt.missing.why": "它来自的那段对话已经不在了，没法再对。",
			"receipt.unchecked.why": "还没有人拿它和原话对过。",
			"action.verify": "查一下",
			"action.openSource": "打开那段对话",
			"action.forget": "让她忘掉",
			"action.confirm": "真的要忘掉",
			"action.cancel": "先不要",
			"forget.question": "要让她忘掉这条吗？话会被抹掉，只留下\"你抹掉了它\"这件事。",
			"action.sign": "签名选中的",
			"action.sign.none": "先勾选你想签的。",
			"signing.off": "签名现在是关着的。等它需要你的指纹或密码时才会打开——在那之前，这里的任何一条都不会变成规矩。",
			"control.paused": "暂停（说“stop remembering”）",
			"control.offRecord": "不入记录（说“off the record”）",
			"control.someoneHere": "旁边有人（说“someone’s here”）",
			"control.state.on": "开着",
			"control.state.off": "关着",
			"control.state.unknown": "还不知道——没人告诉过这个应用",
			"surface.more": "还有更多——这里只显示了一页。",
			"surface.notRunning": "记忆服务没有在运行——所以这里没有显示任何记忆。",
			"surface.notLinked": "先在 Aumlok 里绑定你的七个词。绑定之后，退出再重新打开 AUKORA，记忆就会开始。",
			"surface.notListed": "这类记录存储不列出来——忘掉就是这个意思。",
			"receipt.unverifiable": "没法核对",
			"receipt.unverifiable.why": "这次核对没能进行（来源打不开），所以什么都没比过。",
			"signing.notSent": "签名还关着，所以什么都没发出去。",
			"signing.asked": "已经问了，等你确认。",
			"signing.ceiling": "SIGNING_KEY_READABLE_BY_SAME_USER",
			"signing.ceiling.plain": "（现在签名只能证明同一个账号下的程序拿到过钥匙，还不能证明是你本人。）",
			"surface.empty": "这里还没有东西。",
			"surface.unreadable": "这条读不出来",
			"surface.stub": "这些是例子，不是你的记忆：读记忆的那部分还在做。这里没有一样是真的，你按什么都不会改变什么。",
			"surface.whyTrouble": "这个链接引用的那份记录清单打不开，所以下面显示的是全部记忆。",
			"surface.loading": "正在读…",
			"surface.failed": "没能读到记忆。她没有说\"没有\"，她说的是\"读不到\"。",
			"surface.selected": "已勾选",
			"surface.actionFailed": "没能确认这一步的结果。请重试。",
			"provenance.youSaid": "你说的",
			"provenance.heard": "在对话里听到的",
			"provenance.edited": "你改过的",
			"provenance.dream": "夜里整理时想到的",
			"provenance.backfill": "从以前的对话里读到的",
			"surface.notInEffect": "还没生效——签名关着，所以这条不起作用",
			"signed.readOnly": "这条是签过名的，只能再签一次才能改——在这里点一下改不了它。",
			"signed.empty": "还没有签名的。签名现在是关着的，等它需要你本人（指纹或密码）时才会打开；在那之前，规矩只是标着“还没生效”的笔记。",
			"source.unnamed": "一段没有名字的对话",
			"forgotten.tombstone": "已忘掉",
			"forgotten.erased": "话已经抹掉了",
			"when.unknown": "（没有记下时间）",
			"receipt.erased": "已抹掉",
			"receipt.erased.why": "这条已经抹掉了，没有原话可以再对。",
			"receipt.unlinked": "原话没法核对",
			"receipt.unlinked.why": "这条来自一段不在本机存档里的对话，所以这里没有可比对的原话——这是记录在案的，不是缺失。",
			"receipt.malformed": "这条凭据读不出来",
			"receipt.malformed.why": "这条记录的凭据存在，但形状无法核对。这和「还没查过」不是一回事。"
		};
		/** The English dictionary. */
		const en = {
			"action.more": "Load more memories",
			"source.unknown": "Unknown source",
			"when.modified": "Updated",
			"when.created": "Recorded",
			"menu.memory": "Memory",
			"menu.memory.tip": "See what she remembers",
			"view.title": "What Auma remembers",
			"view.subtitle": "She writes these down as you talk. You can keep one, change it, or have her forget it.",
			"tab.remembered": "Remembered",
			"tab.signed": "Signed",
			"tab.proposal": "Proposals",
			"tab.forgotten": "Forgotten",
			"tab.remembered.blurb": "Auma picked these up as you talked. She can use them, and they carry no authority.",
			"tab.signed.blurb": "Memories you approved in the AUKORA popup, each with a receipt.",
			"tab.proposal.blurb": "Things Auma thinks are worth making into rules. Nothing here is in effect.",
			"tab.forgotten.blurb": "Erased. What remains is the record that you erased it.",
			"search.placeholder": "Find a memory",
			"filter.kind": "What kind",
			"filter.all": "Everything",
			"kind.fact": "a fact",
			"kind.preference": "something you like",
			"kind.decision": "a decision",
			"kind.commitment": "a promise",
			"kind.person": "a person",
			"kind.project": "a project",
			"kind.observation": "something noticed",
			"row.from": "from",
			"row.at": "on",
			"row.signed": "you signed it",
			"row.noWords": "no words were kept",
			"receipt.unchecked": "not checked yet",
			"receipt.verified": "matches the original",
			"receipt.changed": "changed since it was recorded",
			"receipt.missing": "source not found",
			"receipt.verified.why": "Checked against the conversation it came from, and it still matches.",
			"receipt.changed.why": "That conversation moved on since this was written down, so this no longer matches it exactly.",
			"receipt.missing.why": "The conversation this came from is gone, so it cannot be checked any more.",
			"receipt.unchecked.why": "Nobody has checked this one against the original yet.",
			"action.verify": "Check it",
			"action.openSource": "Open the conversation",
			"action.forget": "Forget it",
			"action.confirm": "Yes, forget it",
			"action.cancel": "No, keep it",
			"forget.question": "Forget this one? The words are erased, and a note stays behind saying you erased it.",
			"action.sign": "Sign selected",
			"action.sign.none": "Tick the ones you want to sign.",
			"signing.off": "Approve memories one at a time in the AUKORA popup.",
			"signing.ceiling": "SIGNING_KEY_READABLE_BY_SAME_USER",
			"control.paused": "Paused (say \"stop remembering\")",
			"control.offRecord": "Off the record (say \"off the record\")",
			"control.someoneHere": "Someone is here (say \"someone’s here\")",
			"control.state.on": "on",
			"control.state.off": "off",
			"control.state.unknown": "not known yet — nothing has told this app",
			"surface.more": "There are more than these — this shows one page of them.",
			"surface.notRunning": "The memory service is not running, so nothing is shown here.",
			"surface.notLinked": "Link your Aumlok phrase first: open Aumlok and link your seven words, then quit and reopen AUKORA. Memory starts on the next launch.",
			"surface.notListed": "The store does not hand these out — that is what forgetting means.",
			"receipt.unverifiable": "could not check",
			"receipt.unverifiable.why": "The check could not run (the source would not open), so nothing was compared.",
			"signing.notSent": "Nothing was sent.",
			"signing.asked": "Asked — waiting for you to approve it.",
			"signing.ceiling.plain": "(Today a signature proves only that a program running as you had the key. It does not yet prove it was you.)",
			"surface.empty": "Nothing here yet.",
			"surface.unreadable": "this one could not be read",
			"surface.stub": "These are examples, not your memories yet: the part that reads them is still being built. Nothing here is real and nothing you press will change anything.",
			"surface.whyTrouble": "The receipt list this link points at could not be read, so every memory is shown below.",
			"surface.loading": "Reading…",
			"surface.failed": "Could not read the memories. She is not saying \"there are none\" — she is saying \"I cannot see them\".",
			"surface.selected": "selected",
			"surface.actionFailed": "The action could not be confirmed. Try again.",
			"provenance.youSaid": "you said",
			"provenance.heard": "heard in your session",
			"provenance.edited": "edited by you",
			"provenance.dream": "from the nightly pass",
			"provenance.backfill": "read from your past conversations",
			"surface.notInEffect": "not in effect yet — signing is off, so this does nothing",
			"signed.readOnly": "This one is signed, so it can only be changed by signing again — a click here cannot do it.",
			"signed.empty": "Nothing approved yet. Ask Auma to remember something and approve it in the popup.",
			"source.unnamed": "a conversation with no name",
			"forgotten.tombstone": "Forgotten",
			"forgotten.erased": "the words were erased",
			"when.unknown": "(the time was not recorded)",
			"receipt.erased": "erased",
			"receipt.erased.why": "This one was erased, so there is no original left to check against.",
			"receipt.unlinked": "the original cannot be checked",
			"receipt.unlinked.why": "This one came from a session that is not in this store, so there is nothing here to compare it against. That is recorded, not missing.",
			"receipt.malformed": "this receipt cannot be read",
			"receipt.malformed.why": "Something was recorded as this note’s receipt, but not in a shape that can be checked. It is not the same as never having checked."
		};
		/** The namespace this face registers its dictionaries under. */
		const NS = "memory";
		//#endregion
		//#region src/client/index.ts
		/** Services required by the Memory browser plugin. */
		const inject = [
			"slots",
			"locale",
			"sessions"
		];
		/**
		* Register the Memory dictionaries, its right-menu launcher and its centre surface.
		* @param ctx - the client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "ui-memory: dictionaries");
			ctx.slots.inject("shell.menu.apps", () => ctx.slots.register({
				name: "shell.menu.apps",
				id: "memory",
				order: 40,
				locale: NS
			}, MemoryMenu));
			ctx.slots.inject("shell.surface", () => ctx.slots.register({
				name: "shell.surface",
				id: "memory",
				order: 40,
				locale: NS,
				inject: () => ({ openSource: (sessionId) => {
					ctx.sessions.open(sessionId);
				} })
			}, MemorySurface));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map