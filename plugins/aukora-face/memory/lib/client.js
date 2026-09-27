window.__ModuleLoader__.load({
	id: "@aukora/face-memory",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		//#region \0dsh-css:Memory.module.css.mjs
		const css = ".eGD9OG_memoryView[hidden]{display:none!important}.eGD9OG_memoryView{z-index:1;box-sizing:border-box;background:var(--dsw-specific-spatial-canvas,#111520);max-width:46rem;min-height:100%;color:var(--dsw-alias-label-primary);flex-direction:column;gap:18px;margin:0 auto;padding:22px 20px 48px;display:flex;position:relative}.eGD9OG_memoryHead{flex-direction:column;gap:4px;padding:0 4px;display:flex}.eGD9OG_memoryTitle{margin:0;font-size:20px;font-weight:600;line-height:28px}.eGD9OG_memorySubtitle{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}.eGD9OG_memoryNotice{color:var(--dsw-alias-label-tertiary);margin:6px 0 0;font-size:12px}.eGD9OG_portals{flex-direction:column;gap:10px;display:flex}.eGD9OG_portal{--tone:var(--dsw-static-spatial-mint);border:1px solid color-mix(in srgb, var(--tone) 30%, transparent);transition:border-color .25s var(--ds-ease-in-out), box-shadow .25s var(--ds-ease-in-out), background .25s var(--ds-ease-in-out);background:0 0;border-radius:14px}.eGD9OG_portal[data-tone=gold]{--tone:var(--dsw-static-spatial-gold)}.eGD9OG_portal[data-tone=violet]{--tone:var(--dsw-static-spatial-violet)}.eGD9OG_portal[data-tone=blue]{--tone:var(--dsw-static-spatial-blue,#78aaff)}.eGD9OG_portal[data-open=yes]{border-color:color-mix(in srgb, var(--tone) 58%, transparent);box-shadow:0 0 14px color-mix(in srgb, var(--tone) 14%, transparent);background:color-mix(in srgb, var(--tone) 4%, transparent)}.eGD9OG_portalHead{width:100%;min-height:64px;color:inherit;font:inherit;text-align:left;cursor:pointer;transition:transform .2s var(--ds-ease-in-out);background:0 0;border:0;align-items:center;gap:14px;padding:10px 18px;display:flex}.eGD9OG_portal[data-open=no] .eGD9OG_portalHead:hover{transform:translate(3px)}.eGD9OG_portalDot{background:var(--tone);width:9px;height:9px;box-shadow:0 0 10px color-mix(in srgb, var(--tone) 55%, transparent);border-radius:50%;flex:none}.eGD9OG_portalCopy{flex-direction:column;flex:1;gap:2px;min-width:0;display:flex}.eGD9OG_portalCopy strong{font-size:14px;font-weight:570;line-height:20px}.eGD9OG_portalCopy span{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px;overflow:hidden}.eGD9OG_portalChevron{color:color-mix(in srgb, var(--tone) 80%, transparent);flex:none;font-size:18px;line-height:1}.eGD9OG_portalBody{transform-origin:top;animation:eGD9OG_telescope .26s var(--ds-ease-in-out);flex-direction:column;gap:8px;padding:2px 14px 16px;display:flex}@keyframes eGD9OG_telescope{0%{opacity:0;transform:scaleY(.94)}to{opacity:1;transform:scaleY(1)}}.eGD9OG_portalSearch{box-sizing:border-box;border:1px solid color-mix(in srgb, var(--tone) 30%, transparent);background:color-mix(in srgb, var(--tone) 3%, transparent);width:100%;max-width:420px;height:38px;color:var(--dsw-alias-label-primary);font:inherit;text-align:center;transition:border-color .2s var(--ds-ease-in-out), box-shadow .2s var(--ds-ease-in-out);border-radius:12px;outline:none;margin:2px auto 8px;padding:0 16px;font-size:13px;display:block}.eGD9OG_portalSearch::placeholder{color:var(--dsw-alias-label-tertiary)}.eGD9OG_portalSearch:focus{border-color:color-mix(in srgb, var(--tone) 58%, transparent);box-shadow:0 0 12px color-mix(in srgb, var(--tone) 14%, transparent)}.eGD9OG_portalQuiet{color:var(--dsw-alias-label-tertiary);text-align:center;margin:4px 0;font-size:12px}.eGD9OG_memoryList{flex-direction:column;gap:8px;margin:0;padding:0;list-style:none;display:flex}.eGD9OG_memoryItem{border:1px solid color-mix(in srgb, var(--tone) 22%, transparent);transition:border-color .25s var(--ds-ease-in-out), box-shadow .25s var(--ds-ease-in-out);border-radius:12px}.eGD9OG_memoryItem[data-open=yes]{border-color:color-mix(in srgb, var(--tone) 50%, transparent);box-shadow:0 0 12px color-mix(in srgb, var(--tone) 12%, transparent)}.eGD9OG_memoryPortal{width:100%;min-height:48px;color:inherit;font:inherit;text-align:left;cursor:pointer;transition:transform .2s var(--ds-ease-in-out);background:0 0;border:0;align-items:center;gap:12px;padding:10px 14px;display:flex}.eGD9OG_memoryItem[data-open=no] .eGD9OG_memoryPortal:hover{transform:translate(3px)}.eGD9OG_memoryWords{flex:1;min-width:0;font-size:14px;line-height:20px}.eGD9OG_memoryItem[data-open=no] .eGD9OG_memoryWords{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.eGD9OG_memoryWhen{color:var(--dsw-alias-label-tertiary);flex:none;font-size:12px}.eGD9OG_memoryDetail{flex-direction:column;gap:6px;padding:0 14px 12px;display:flex}.eGD9OG_memoryMeta{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}.eGD9OG_memoryActions{flex-wrap:wrap;align-items:center;gap:8px;margin-top:4px;display:flex}.eGD9OG_memoryAsk{color:var(--dsw-alias-label-secondary);font-size:12px}.eGD9OG_pill{border:1px solid color-mix(in srgb, var(--tone) 34%, transparent);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;transition:border-color .2s var(--ds-ease-in-out), background .2s var(--ds-ease-in-out);background:0 0;border-radius:999px;padding:4px 12px;font-size:12px}.eGD9OG_pill:hover{border-color:color-mix(in srgb, var(--tone) 60%, transparent);background:color-mix(in srgb, var(--tone) 8%, transparent)}";
		const tagId = "@aukora/face-memory/Memory.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@aukora/face-memory";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var Memory_module_css_default = {
			"memoryActions": "eGD9OG_memoryActions",
			"memoryAsk": "eGD9OG_memoryAsk",
			"memoryDetail": "eGD9OG_memoryDetail",
			"memoryHead": "eGD9OG_memoryHead",
			"memoryItem": "eGD9OG_memoryItem",
			"memoryList": "eGD9OG_memoryList",
			"memoryMeta": "eGD9OG_memoryMeta",
			"memoryNotice": "eGD9OG_memoryNotice",
			"memoryPortal": "eGD9OG_memoryPortal",
			"memorySubtitle": "eGD9OG_memorySubtitle",
			"memoryTitle": "eGD9OG_memoryTitle",
			"memoryView": "eGD9OG_memoryView",
			"memoryWhen": "eGD9OG_memoryWhen",
			"memoryWords": "eGD9OG_memoryWords",
			"pill": "eGD9OG_pill",
			"portal": "eGD9OG_portal",
			"portalBody": "eGD9OG_portalBody",
			"portalChevron": "eGD9OG_portalChevron",
			"portalCopy": "eGD9OG_portalCopy",
			"portalDot": "eGD9OG_portalDot",
			"portalHead": "eGD9OG_portalHead",
			"portalQuiet": "eGD9OG_portalQuiet",
			"portalSearch": "eGD9OG_portalSearch",
			"portals": "eGD9OG_portals",
			"telescope": "eGD9OG_telescope"
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
				className: active ? [Memory_module_css_default.memoryMenuItem, Memory_module_css_default.memoryMenuItemActive].join(" ") : Memory_module_css_default.memoryMenuItem,
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
		/** The list's controls, as one piece of state. */
		/**
		* Whether the answer says there are more notes than this page.
		*
		* **THE TRAP THIS EXISTS FOR**: the wire sends `next: null` when the page is the last one, but the STUB's answer omits
		* the field entirely — so `answer.next !== null` is TRUE for `undefined` and the fixture would claim there are more
		* memories behind it. KIRA's route sends a string or `null` and nothing else, so a cursor that is a non-empty string is
		* the only thing that means "more", and everything else means "this is all of it".
		*/
		function hasMoreOf(answer) {
			return typeof answer?.next === "string" && answer.next !== "";
		}
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
			items.sort((a, b) => {
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
		/**
		* The sentence the signing action carries while signing is off.
		*
		* **A DROP PATTERN TOO LOOSE DELETED THIS WHILE `signActionState` STILL RETURNED IT** — a dangling reference that the
		* type-stripping parse cannot see and the court found immediately. It is prose for the BUTTON'S TOOLTIP rather than
		* for a sentence on the page, so it lives beside the action that shows it.
		*/
		const SIGNING_OFF_LINE = "Signing is off for now. It will be switched on when it asks for your fingerprint or password — until then, nothing here can become a rule.";
		/**
		* Whether the Sign action can run at all.
		*
		* **IT CANNOT, YET, AND THE SCREEN SAYS SO.** The design's §2.4 keeps batch signing off until a signature requires
		* Peter in person; the goal asks for the action, the design forbids shipping it live, and both are satisfied by an
		* action that is present, explains itself and sends nothing.
		*/
		function signActionState(selected) {
			if (selected.length === 0) return {
				enabled: false,
				reason: "Tick the ones you want to sign.",
				label: "Sign selected"
			};
			return {
				enabled: false,
				reason: SIGNING_OFF_LINE,
				label: `Sign ${String(selected.length)} selected`
			};
		}
		/** What Forget does when he presses it: it asks first, and it says what will happen. */
		function forgetState(view, id) {
			return {
				confirming: view.confirmingForget === id,
				question: "Forget this one? The words are erased, and a note stays behind saying you erased it."
			};
		}
		//#endregion
		//#region src/client/memory-api.ts
		/** The four paths, with the id in the body on the two POSTs, as the engine measures them. */
		/**
		* THE `why` ROUTE, WHICH IS THE LAYOUT FACE'S AND IS NAMED HERE RATHER THAN IMPORTED.
		*
		* **THE STRING IS ALREADY WRITTEN TWICE IN THE LAYOUT FACE** (`layout/src/index.ts:52` registers it and
		* `layout/src/client/why-api.ts:16` names it for the browser), so this is a third copy and that is worth saying
		* plainly rather than hiding. **The alternative is a cross-face import, and that import is not free**: this
		* repository's `build-face.py` copies each face to `packages/client/aukora-face-{name}/`, so a path from one face's
		* source to another's resolves in a court that imports `src` and would need the builder to agree — the same risk the
		* fence fix carries and which is already written up for BETA. A route both faces address over HTTP is a **published
		* contract** rather than a source dependency, and the tree already treats it that way.
		*/
		const WHY_MANIFEST_ROUTE = "/api/aukora/why";
		const KIRA_MEMORY_ROUTES = {
			list: "/api/kira/memories",
			verify: "/api/kira/memories/verify",
			forget: "/api/kira/memories/forget",
			trust: "/api/kira/trust"
		};
		/** A failure with its reason kept, so no caller has to guess one from a status code. */
		var MemoryServiceError = class extends Error {
			problem;
			status;
			code;
			body;
			constructor(problem, status, code, message, body = {}) {
				super(message);
				this.name = "MemoryServiceError";
				this.problem = problem;
				this.status = status;
				this.code = code;
				this.body = body;
			}
		};
		/** A time the wire sent as an ISO string or an epoch number, as a number, or null. */
		function wireTime(value) {
			if (typeof value === "number" && Number.isFinite(value)) return value;
			if (typeof value === "string" && value !== "") {
				const parsed = Date.parse(value);
				if (Number.isFinite(parsed)) return parsed;
			}
			return null;
		}
		/**
		* THE ADAPTER: one wire note, in the shape this app's model reads.
		*
		* A label that is not one of the seven kinds becomes `observation` — the dullest true thing that can be said about a
		* note whose kind the engine did not name — rather than an empty kind word on the screen.
		*/
		function noteToRecord(note) {
			const tier = note.tier === "trusted" ? "signed" : note.tier;
			const label = typeof note.kind === "string" && note.kind !== "" ? note.kind : typeof note.label === "string" ? note.label : "";
			const kind = [
				"fact",
				"preference",
				"decision",
				"commitment",
				"person",
				"project",
				"observation"
			].includes(label) ? label : "observation";
			return {
				id: String(note.id),
				tier,
				kind,
				text: String(note.text ?? note.statement ?? ""),
				createdAt: wireTime(note.validFrom) ?? wireTime(note.observedAt),
				source: note.citation?.source ?? null,
				aura: note.citation?.aura ?? null
			};
		}
		/**
		* The real source: the engine's routes, same-origin, carrying the page's cookie.
		*
		* Every failure is typed rather than smoothed over. A route that is not mounted, an unreadable store that raises, a
		* tier the engine refuses to list, and the signing gate each reach the screen as themselves — because the one thing
		* this app must never do is render a broken service as an empty memory.
		*/
		function httpMemorySource(options = {}) {
			const call = options.fetchImpl ?? ((...args) => fetch(...args));
			const jsonOf = async (response) => {
				try {
					const body = await response.json();
					return body !== null && typeof body === "object" && !Array.isArray(body) ? body : {};
				} catch {
					return {};
				}
			};
			const judge = async (response) => {
				const body = await jsonOf(response);
				if (response.ok) return body;
				const code = typeof body.error === "string" ? body.error : null;
				throw new MemoryServiceError(response.status === 404 ? "absent" : code === null ? "failed" : "refused", response.status, code, `the memory route answered ${String(response.status)}${code === null ? "" : ` (${code})`}`, body);
			};
			const send = async (path, init) => {
				let response;
				try {
					response = await call(path, init);
				} catch (error) {
					throw new MemoryServiceError("absent", 0, "kira.route:unreachable", `the memory route could not be reached: ${error instanceof Error ? error.message : String(error)}`);
				}
				return await judge(response);
			};
			return {
				kind: "live",
				async list(input) {
					const params = new URLSearchParams({ tier: input.tier });
					if (input.q !== void 0 && input.q !== "") params.set("q", input.q);
					if (input.limit !== void 0) params.set("limit", String(input.limit));
					if (input.before !== void 0 && input.before !== null) params.set("before", input.before);
					const body = await send(`${KIRA_MEMORY_ROUTES.list}?${params.toString()}`, { credentials: "same-origin" });
					return {
						items: (Array.isArray(body.items) ? body.items : []).filter((one) => one !== null && typeof one === "object").map(noteToRecord),
						next: typeof body.next === "string" && body.next !== "" ? body.next : null
					};
				},
				async verify(id) {
					return await send(KIRA_MEMORY_ROUTES.verify, {
						method: "POST",
						credentials: "same-origin",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ id })
					});
				},
				async forget(id, reason) {
					return await send(KIRA_MEMORY_ROUTES.forget, {
						method: "POST",
						credentials: "same-origin",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(reason === void 0 || reason === "" ? { id } : {
							id,
							reason
						})
					});
				},
				async trust(ids) {
					return await send(KIRA_MEMORY_ROUTES.trust, {
						method: "POST",
						credentials: "same-origin",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ ids: [...ids] })
					});
				}
			};
		}
		//#endregion
		//#region src/client/MemorySurface.tsx
		/**
		* THE MEMORY VIEW — one calm list of what Auma remembers, what Peter signed, what she proposes and what he forgot.
		*
		* PETER'S WORDS: *"a memory app on the right, and you click it, and then it shows memories in the middle that are
		* approved or unapproved"*. Everything on this screen is a sentence rather than a state machine's name, and the two
		* facts that must never be faked are visible: **a receipt badge is only a tick when a check answered VERIFIED**, and
		* **signing is off** until it asks for him in person.
		*
		* IT READS THROUGH ONE INTERFACE (`memory-api.ts`) AND SAYS WHICH ONE. Until the engine's routes land the source is
		* the stub, and the top of the screen says so in plain words: a person reading examples as his own memories is the
		* failure this line exists to prevent.
		*
		* @module MemorySurface
		*/
		/** The source this build reads from. Swapping the stub for the routes is this one value. */
		/**
		* **THE LIVE ROUTES ARE THE APP'S SOURCE; THE STUB IS A COURT FIXTURE.** Until round 1 of akui-11 this was
		* `stubMemorySource()` — the app Peter opens showed examples — and the day KIRA's routes landed the change is this
		* one value, which is what building behind one interface was for. The courts import the stub directly.
		*/
		const SOURCE = httpMemorySource();
		/** A date a person reads, or the honest absence of one. */
		function whenText(at) {
			return at === null ? "a time it did not record" : new Date(at).toLocaleDateString();
		}
		/**
		* The Memory view.
		* @param props - the localized copy.
		* @returns the list, its controls and its actions.
		*/
		function MemorySurface({ activeSurface, t, openSource, surfaceTarget }) {
			const active = activeSurface === "memory";
			const [view, setView] = (0, react.useState)(INITIAL_VIEW);
			const [items, setItems] = (0, react.useState)([]);
			const [state, setState] = (0, react.useState)("loading");
			const [signAnswer, setSignAnswer] = (0, react.useState)(null);
			const [actionFailed, setActionFailed] = (0, react.useState)(false);
			/**
			* **WHY THE LIST IS NOT THERE — THREE ANSWERS, NOT ONE.** `MemoryServiceError` carries `absent` (nothing is
			* mounted), `refused` (the engine said no by name) and `failed`; rendering all three as "we could not show your
			* memories" is the same lie as rendering them as an empty list, one step less obvious.
			*/
			const [trouble, setTrouble] = (0, react.useState)(null);
			/**
			* **A TRUNCATED LIST MUST NOT READ AS THE WHOLE STORE.** KIRA's list route pages: fifty notes by default and a `next`
			* cursor when there are more. Until this round the view threw that cursor away, so past fifty notes Peter would see
			* fifty and nothing would say the rest existed — the same lie as an empty list for a failed read, one step further in.
			*/
			const [hasMore, setHasMore] = (0, react.useState)(false);
			const [whyTrouble, setWhyTrouble] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				let cancelled = false;
				setState("loading");
				SOURCE.list({
					tier: view.tier,
					q: view.query
				}).then((answer) => {
					if (cancelled) return;
					setHasMore(hasMoreOf(answer));
					setItems(itemsOf(answer, {
						tier: view.tier,
						query: view.query,
						kind: view.kind,
						receipts: view.receipts,
						citedIds: view.citedIds
					}).items);
					setState("ready");
				}).catch((error) => {
					if (cancelled) return;
					setTrouble({
						problem: error instanceof MemoryServiceError ? error.problem : "failed",
						code: error instanceof MemoryServiceError ? error.code : null
					});
					setState("failed");
				});
				return () => {
					cancelled = true;
				};
			}, [
				view.tier,
				view.query,
				view.kind,
				view.receipts,
				view.citedIds
			]);
			(0, react.useEffect)(() => {
				if (surfaceTarget === void 0 || surfaceTarget === "") {
					setView((current) => current.citedIds === null ? current : {
						...current,
						citedIds: null
					});
					setWhyTrouble(false);
					return;
				}
				let cancelled = false;
				fetch(`${WHY_MANIFEST_ROUTE}?reply=${encodeURIComponent(surfaceTarget)}`, { credentials: "same-origin" }).then((answer) => answer.ok ? answer.json() : null).then((answer) => {
					if (cancelled) return;
					if (answer === null) {
						setWhyTrouble(true);
						return;
					}
					setWhyTrouble(false);
					setView((current) => ({
						...current,
						citedIds: citedIdsOf(answer)
					}));
				}).catch(() => {
					if (!cancelled) setWhyTrouble(true);
				});
				return () => {
					cancelled = true;
				};
			}, [surfaceTarget]);
			signActionState(view.selected);
			const [openTier, setOpenTier] = (0, react.useState)(null);
			const [openItem, setOpenItem] = (0, react.useState)(null);
			const TONE = {
				remembered: "mint",
				signed: "gold",
				proposal: "violet",
				forgotten: "blue"
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: Memory_module_css_default.memoryView,
				"data-memory-surface": true,
				"data-source": SOURCE.kind,
				"aria-label": t("view.title"),
				hidden: !active,
				"aria-hidden": !active,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
					className: Memory_module_css_default.memoryHead,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							className: Memory_module_css_default.memoryTitle,
							children: t("view.title")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: Memory_module_css_default.memorySubtitle,
							children: t("view.subtitle")
						}),
						SOURCE.kind === "stub" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: Memory_module_css_default.memoryNotice,
							"data-memory-stub": true,
							children: t("surface.stub")
						}) : null,
						whyTrouble ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: Memory_module_css_default.memoryNotice,
							"data-memory-why-trouble": true,
							children: t("surface.whyTrouble")
						}) : null
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: Memory_module_css_default.portals,
					children: TIER_TABS.map((each) => {
						const open = openTier === each.tier;
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: Memory_module_css_default.portal,
							"data-tone": TONE[each.tier] ?? "mint",
							"data-open": open ? "yes" : "no",
							"data-memory-tab": each.tier,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: Memory_module_css_default.portalHead,
								"aria-expanded": open,
								onClick: () => {
									setOpenItem(null);
									setActionFailed(false);
									if (open) {
										setOpenTier(null);
										return;
									}
									setOpenTier(each.tier);
									setView((current) => ({
										...current,
										tier: each.tier,
										query: "",
										selected: [],
										confirmingForget: null
									}));
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: Memory_module_css_default.portalDot,
										"aria-hidden": "true"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: Memory_module_css_default.portalCopy,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t(`tab.${each.tier}`) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t(`tab.${each.tier}.blurb`) })]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: Memory_module_css_default.portalChevron,
										"aria-hidden": "true",
										children: open ? "−" : "+"
									})
								]
							}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: Memory_module_css_default.portalBody,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "search",
										className: Memory_module_css_default.portalSearch,
										"data-memory-search": true,
										placeholder: t("search.placeholder"),
										value: view.query,
										autoFocus: true,
										onChange: (event) => {
											setView((current) => ({
												...current,
												query: event.target.value
											}));
										}
									}),
									state === "loading" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: Memory_module_css_default.portalQuiet,
										children: t("surface.loading")
									}) : null,
									state === "failed" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: Memory_module_css_default.portalQuiet,
										"data-memory-failed": trouble?.problem ?? "failed",
										children: trouble?.problem === "absent" ? t("surface.notRunning") : trouble?.code === "kira.memory:aumlok-not-linked" ? t("surface.notLinked") : trouble?.code === "kira.route:tier-not-listable" ? t("surface.notListed") : t("surface.failed")
									}) : null,
									actionFailed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: Memory_module_css_default.portalQuiet,
										"data-memory-action-failed": true,
										children: t("surface.actionFailed")
									}) : null,
									state === "ready" && items.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: Memory_module_css_default.portalQuiet,
										"data-memory-empty": view.tier,
										children: view.tier === "signed" ? t("signed.empty") : t("surface.empty")
									}) : null,
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
										className: Memory_module_css_default.memoryList,
										children: items.map((item) => {
											const expanded = openItem === item.id;
											const forget = forgetState(view, item.id);
											const words = item.erased ? `${t("forgotten.tombstone")} ${item.forgottenAt === null ? t("when.unknown") : new Date(item.forgottenAt).toLocaleDateString()} — ${t("forgotten.erased")}` : item.unreadable ? t("surface.unreadable") : item.text;
											return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
												className: Memory_module_css_default.memoryItem,
												"data-memory-row": item.id,
												"data-open": expanded ? "yes" : "no",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
													type: "button",
													className: Memory_module_css_default.memoryPortal,
													"aria-expanded": expanded,
													onClick: () => {
														setOpenItem(expanded ? null : item.id);
													},
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: Memory_module_css_default.memoryWords,
														children: words
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: Memory_module_css_default.memoryWhen,
														children: whenText(item.createdAt)
													})]
												}), expanded ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: Memory_module_css_default.memoryDetail,
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
															className: Memory_module_css_default.memoryMeta,
															children: [
																t(`kind.${item.kind}`),
																" · ",
																t("row.from"),
																" ",
																item.source.titleKnown ? item.source.sessionTitle : t("source.unnamed"),
																" ",
																t("row.at"),
																" ",
																whenText(item.source.at),
																item.signedAt === null ? null : ` · ${t("row.signed")} ${whenText(item.signedAt)}`
															]
														}),
														item.erased || item.tier === "signed" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
															className: Memory_module_css_default.memoryMeta,
															"data-memory-receipt": item.receipt.state,
															children: item.receipt.state === "unchecked" ? t("receipt.unchecked") : t(`receipt.${item.receipt.state}`)
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
															className: Memory_module_css_default.memoryActions,
															children: [
																item.source.sessionId !== null && openSource !== void 0 && !item.erased ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																	type: "button",
																	className: Memory_module_css_default.pill,
																	onClick: () => {
																		openSource(item.source.sessionId);
																	},
																	children: t("action.openSource")
																}) : null,
																item.erased || item.tier === "signed" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																	type: "button",
																	className: Memory_module_css_default.pill,
																	"data-memory-verify": item.id,
																	onClick: () => {
																		SOURCE.verify(item.id).then((answer) => {
																			setView((current) => ({
																				...current,
																				receipts: {
																					...current.receipts,
																					[item.id]: receiptBadgeOf(answer)
																				}
																			}));
																		}).then(() => {
																			setActionFailed(false);
																		}).catch(() => {
																			setActionFailed(true);
																		});
																	},
																	children: t("action.verify")
																}),
																item.erased || item.tier === "signed" ? null : forget.confirming ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
																	/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																		className: Memory_module_css_default.memoryAsk,
																		children: t("forget.question")
																	}),
																	/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																		type: "button",
																		className: Memory_module_css_default.pill,
																		"data-memory-forget-confirm": item.id,
																		onClick: () => {
																			SOURCE.forget(item.id).then(() => {
																				setView((current) => ({
																					...current,
																					confirmingForget: null
																				}));
																			}).then(() => {
																				setActionFailed(false);
																			}).catch(() => {
																				setActionFailed(true);
																			});
																		},
																		children: t("action.confirm")
																	}),
																	/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																		type: "button",
																		className: Memory_module_css_default.pill,
																		onClick: () => {
																			setView((current) => ({
																				...current,
																				confirmingForget: null
																			}));
																		},
																		children: t("action.cancel")
																	})
																] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																	type: "button",
																	className: Memory_module_css_default.pill,
																	"data-memory-forget": item.id,
																	onClick: () => {
																		setView((current) => ({
																			...current,
																			confirmingForget: item.id
																		}));
																	},
																	children: t("action.forget")
																})
															]
														})
													]
												}) : null]
											}, item.id);
										})
									}),
									hasMore ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: Memory_module_css_default.portalQuiet,
										"data-memory-more": true,
										children: t("surface.more")
									}) : null
								]
							}) : null]
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
			"surface.actionFailed": "这一步没成功——什么都没变。等一下再试。",
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
			"surface.actionFailed": "That did not work, and nothing changed. Try again in a moment.",
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