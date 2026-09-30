window.__ModuleLoader__.load({
	id: "@aukora/face-settings",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_slots = require("@deepseek-ai/dsh-client-ui-slots");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		//#region ../../../node_modules/.pnpm/clsx@2.1.1/node_modules/clsx/dist/clsx.mjs
		function r(e) {
			var t, f, n = "";
			if ("string" == typeof e || "number" == typeof e) n += e;
			else if ("object" == typeof e) if (Array.isArray(e)) {
				var o = e.length;
				for (t = 0; t < o; t++) e[t] && (f = r(e[t])) && (n && (n += " "), n += f);
			} else for (f in e) e[f] && (n && (n += " "), n += f);
			return n;
		}
		function clsx() {
			for (var e, t, f = 0, n = "", o = arguments.length; f < o; f++) (e = arguments[f]) && (t = r(e)) && (n && (n += " "), n += t);
			return n;
		}
		//#endregion
		//#region \0dsh-css:SettingsRoot.module.css.mjs
		const css$3 = ".f24HHa_surface{box-sizing:border-box;background:var(--dsw-alias-bg-layer-1);width:100%;min-width:0;height:100%;min-height:0;padding:16px;overflow:hidden}.f24HHa_surface[hidden]{display:none}.f24HHa_panel{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);width:min(100%,1080px);height:100%;box-shadow:var(--dsw-shadow-lv1);border-radius:20px;margin:0 auto;display:flex;overflow:hidden;container:f24HHa_settings-panel/inline-size}.f24HHa_title{white-space:nowrap;text-overflow:ellipsis;min-width:0;color:var(--dsw-alias-label-primary);font-size:16px;font-weight:600;line-height:24px;overflow:hidden}.f24HHa_content{flex-direction:column;flex:1;min-width:0;min-height:0;display:flex}.f24HHa_header{height:56px;padding:12px calc(var(--dsh-hot-corner-size,74px) + var(--dsh-hot-corner-gutter,10px));box-sizing:border-box;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;align-items:center;gap:8px;display:flex}.f24HHa_actions{justify-content:flex-end;align-items:center;gap:8px;min-width:0;margin-left:auto;display:flex}.f24HHa_close{cursor:pointer;width:30px;height:30px;color:var(--dsw-alias-label-primary);background:0 0;border:none;border-radius:50%;justify-content:center;align-items:center;padding:0;display:inline-flex}.f24HHa_close:hover{background:var(--dsw-alias-interactive-bg-hover)}.f24HHa_options{flex:1;min-height:0;padding:24px;overflow-y:auto}.f24HHa_hiddenLabel{clip:rect(0 0 0 0);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}.f24HHa_menuItem{box-sizing:border-box;cursor:pointer;width:100%;min-height:44px;color:var(--dsw-alias-label-primary);text-align:left;background:0 0;border:1px solid #0000;border-radius:12px;align-items:center;gap:10px;padding:10px 12px;font-family:inherit;font-size:14px;line-height:22px;display:flex}.f24HHa_menuItem:hover{background:var(--dsw-alias-interactive-bg-hover)}.f24HHa_menuItemActive{border-color:var(--dsw-alias-border-l1);background:var(--dsw-specific-sidebar-nav-item-active)}.f24HHa_systemMenuCopy{flex-direction:column;flex:1;min-width:0;display:flex}.f24HHa_systemMenuCopy strong{font-size:var(--dsh-spatial-menu-title-size,14px);line-height:var(--dsh-spatial-menu-title-line-height,20px);font-weight:570}.f24HHa_systemMenuCopy span{color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-spatial-menu-description-size,12px);line-height:var(--dsh-spatial-menu-description-line-height,18px);text-overflow:ellipsis;white-space:nowrap;overflow:hidden}@media (width<=760px){.f24HHa_surface{padding:8px}.f24HHa_panel{border-radius:14px}}";
		const tagId$3 = "@aukora/face-settings/SettingsRoot.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$3) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@aukora/face-settings";
			tag.dataset.pluginCss = tagId$3;
			tag.textContent = css$3;
			document.head.appendChild(tag);
		}
		var SettingsRoot_module_css_default = {
			"actions": "f24HHa_actions",
			"close": "f24HHa_close",
			"content": "f24HHa_content",
			"header": "f24HHa_header",
			"hiddenLabel": "f24HHa_hiddenLabel",
			"menuItem": "f24HHa_menuItem",
			"menuItemActive": "f24HHa_menuItemActive",
			"options": "f24HHa_options",
			"panel": "f24HHa_panel",
			"settings-panel": "f24HHa_settings-panel",
			"surface": "f24HHa_surface",
			"systemMenuCopy": "f24HHa_systemMenuCopy",
			"title": "f24HHa_title"
		};
		//#endregion
		//#region src/client/AuraCoherenceMenu.tsx
		/** Text-only Aura Coherence entry in the shell's right-side System menu. */
		/**
		* Open the standalone Aura Coherence surface.
		* @param props - System-menu owner share and localized copy.
		* @returns the Aura Coherence launcher button.
		*/
		function AuraCoherenceMenu({ activeSurface, openSurface, t }) {
			const active = activeSurface === "aura-coherence";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: clsx(SettingsRoot_module_css_default.menuItem, active && SettingsRoot_module_css_default.menuItemActive),
				"aria-current": active ? "page" : void 0,
				onClick: () => {
					openSurface("aura-coherence");
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: SettingsRoot_module_css_default.systemMenuCopy,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("aura.trigger") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("aura.menu") })]
				})
			});
		}
		//#endregion
		//#region src/aura/aggregate.ts
		const RECENT_LIMIT = 18;
		const FNV_OFFSET = 2166136261;
		const FNV_PRIME = 16777619;
		function emptyCounts() {
			return {
				records: 0,
				interactions: 0,
				turns: 0,
				humanMessages: 0,
				contextMessages: 0,
				assistantMessages: 0,
				toolCalls: 0,
				toolResults: 0,
				toolErrors: 0
			};
		}
		function emptyApprovals() {
			return {
				asked: 0,
				allowed: 0,
				rejected: 0,
				cancelled: 0,
				unavailable: 0
			};
		}
		/**
		* Name the durable session-log totals available to Aura's coefficient map.
		*
		* Identity, cryptographic receipts, and external anchoring are deliberately
		* absent: this adapter reports those capabilities as unmounted and never
		* converts its checksum or timestamps into evidence coefficients.
		*
		* @param projection - one session or system summary with folded counts and approvals.
		* @returns the exact monotonic totals used by the persistent and transient maps.
		*/
		function auraChannelSourcesOf(projection) {
			return {
				persistent: {
					historyInteractions: projection.counts.interactions,
					toolCalls: projection.counts.toolCalls,
					toolResults: projection.counts.toolResults,
					toolErrors: projection.counts.toolErrors,
					approvalsAsked: projection.approvals.asked,
					approvalsAllowed: projection.approvals.allowed,
					approvalsRejected: projection.approvals.rejected,
					approvalsUnavailable: projection.approvals.unavailable,
					approvalsCancelled: projection.approvals.cancelled
				},
				activity: {
					humanMessages: projection.counts.humanMessages,
					assistantMessages: projection.counts.assistantMessages,
					toolEvents: projection.counts.toolCalls + projection.counts.toolResults
				}
			};
		}
		function extendFingerprint(hash, value) {
			let next = hash >>> 0;
			for (let index = 0; index < value.length; index += 1) {
				next ^= value.charCodeAt(index);
				next = Math.imul(next, FNV_PRIME) >>> 0;
			}
			return next;
		}
		/**
		* Combine per-session durable projections without inventing cross-session order.
		*
		* Totals are commutative. Recent records use their durable timestamps for display,
		* with session id and sequence as deterministic tie-breakers; that ordering is not
		* presented as a global receipt chain.
		*
		* @param entries - Host-listed sessions and any available Aura projections.
		* @returns one content-free system life-state summary.
		*/
		function aggregateAuraCoherence(entries) {
			const counts = emptyCounts();
			const approvals = emptyApprovals();
			const projected = entries.filter((entry) => entry.projection !== void 0).sort((left, right) => left.id.localeCompare(right.id));
			const recent = [];
			let fingerprint = FNV_OFFSET;
			let lastTime = null;
			for (const entry of projected) {
				const projection = entry.projection;
				for (const key of Object.keys(counts)) counts[key] += projection.counts[key];
				for (const key of Object.keys(approvals)) approvals[key] += projection.approvals[key];
				fingerprint = extendFingerprint(fingerprint, `${entry.id}|${projection.recordFingerprint}|${projection.lastSeq};`);
				if (projection.lastTime !== null) lastTime = lastTime === null ? projection.lastTime : Math.max(lastTime, projection.lastTime);
				recent.push(...projection.recent.map((record) => ({
					...record,
					sessionId: entry.id,
					sessionTitle: entry.title
				})));
			}
			recent.sort((left, right) => right.time - left.time || left.sessionId.localeCompare(right.sessionId) || right.seq - left.seq);
			return {
				sessions: entries.length,
				projectedSessions: projected.length,
				counts,
				approvals,
				channelSources: auraChannelSourcesOf({
					counts,
					approvals
				}),
				recordFingerprint: fingerprint.toString(16).padStart(8, "0"),
				lastTime,
				recent: recent.slice(0, RECENT_LIMIT)
			};
		}
		//#endregion
		//#region src/aura/figure.ts
		/** One full rotation in radians. */
		const TAU = Math.PI * 2;
		/** Immutable exact rest position of the breath triad. */
		const REST = Object.freeze([
			0,
			0,
			0
		]);
		/** Golden-ratio conjugate used as the non-repeating interaction phase step. */
		const HISTORY_PHASE_STEP = (Math.sqrt(5) - 1) / 2;
		/**
		* Ordered, attributable source of every coefficient emitted by the local
		* adapter. `signed` marks channels spanning `[-1, 1]`, whose readout needs a
		* bipolar center-origin meter; unsigned channels stay in `[0, 1)`.
		*/
		const AURA_COEFFICIENT_PROVENANCE = Object.freeze([
			Object.freeze({
				plane: "xy",
				channel: "historyPhase",
				lifetime: "persistent",
				signed: true,
				source: "counts.interactions"
			}),
			Object.freeze({
				plane: "xz",
				channel: "toolHealth",
				lifetime: "persistent",
				signed: false,
				source: "counts.toolCalls, counts.toolResults, counts.toolErrors"
			}),
			Object.freeze({
				plane: "yz",
				channel: "approvalPosture",
				lifetime: "persistent",
				signed: true,
				source: "approvals.asked, approvals.allowed, approvals.rejected, approvals.unavailable, approvals.cancelled"
			}),
			Object.freeze({
				plane: "xw",
				channel: "humanActivity",
				lifetime: "transient",
				signed: false,
				source: "positive delta of counts.humanMessages"
			}),
			Object.freeze({
				plane: "yw",
				channel: "assistantActivity",
				lifetime: "transient",
				signed: false,
				source: "positive delta of counts.assistantMessages"
			}),
			Object.freeze({
				plane: "zw",
				channel: "toolActivity",
				lifetime: "transient",
				signed: false,
				source: "positive delta of counts.toolCalls + counts.toolResults"
			})
		]);
		function countOrZero(value) {
			return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
		}
		function clamp(value, minimum, maximum) {
			return Math.min(maximum, Math.max(minimum, value));
		}
		function boundedCount(value) {
			const count = countOrZero(value);
			return count / (1 + count);
		}
		function positiveDelta(previous, current) {
			return Math.max(0, countOrZero(current) - countOrZero(previous));
		}
		function fractionalPart(value) {
			return value - Math.floor(value);
		}
		/**
		* Map a committed interaction count to a bounded, visibly advancing phase.
		*
		* The Kronecker sequence `2 × frac(n × φ⁻¹) - 1` never saturates, so each
		* representable positive count moves the persistent `xy` coefficient. Zero
		* remains the neutral initial state.
		*
		* @param value - committed high-level interaction count.
		* @returns deterministic phase in `[-1, 1)` or zero for an invalid/empty count.
		*/
		function historyPhaseOf(value) {
			const count = countOrZero(value);
			return count === 0 ? 0 : 2 * fractionalPart(count * HISTORY_PHASE_STEP) - 1;
		}
		/**
		* Normalize the local adapter's three durable channels into persistent coefficients.
		*
		* History phase uses the non-saturating Kronecker sequence
		* `2 × frac(interactions × φ⁻¹) - 1`. Tool health is the fraction of requested
		* calls with a committed non-error result. Approval posture is the signed
		* allowed-minus-refused share of the larger of asks or recorded outcomes;
		* cancellations and unanswered asks remain neutral mass in the denominator.
		* Every coefficient is finite and bounded to `[-1, 1]`.
		*
		* @param sources - named durable count sources from the session-log adapter.
		* @returns `xy` history phase, `xz` tool health, and `yz` approval posture.
		*/
		function persistentChannelsOf(sources) {
			const toolCalls = countOrZero(sources.toolCalls);
			const toolResults = countOrZero(sources.toolResults);
			const toolErrors = Math.min(toolResults, countOrZero(sources.toolErrors));
			const successfulToolResults = Math.max(0, toolResults - toolErrors);
			const toolHealth = toolCalls === 0 ? 0 : clamp(successfulToolResults / toolCalls, 0, 1);
			const approvalsAsked = countOrZero(sources.approvalsAsked);
			const approvalsAllowed = countOrZero(sources.approvalsAllowed);
			const approvalsRefused = countOrZero(sources.approvalsRejected) + countOrZero(sources.approvalsUnavailable);
			const approvalOutcomes = approvalsAllowed + approvalsRefused + countOrZero(sources.approvalsCancelled);
			const approvalCoverage = Math.max(approvalsAsked, approvalOutcomes);
			const approvalPosture = approvalCoverage === 0 ? 0 : clamp((approvalsAllowed - approvalsRefused) / approvalCoverage, -1, 1);
			return [
				historyPhaseOf(sources.historyInteractions),
				toolHealth,
				approvalPosture
			];
		}
		/**
		* Normalize new durable activity into three independent transient drives.
		*
		* An absent previous snapshot represents initial hydration and produces exact
		* rest, so historical records never masquerade as live activity. Positive
		* deltas use `n / (1 + n)` and removals or projection resets produce zero.
		*
		* @param previous - preceding monotonic activity totals, absent during initial hydration.
		* @param current - current monotonic activity totals.
		* @returns `xw` human, `yw` assistant, and `zw` tool activity in `[0, 1)`.
		*/
		function transientChannelsOf(previous, current) {
			if (previous === null || previous === void 0) return [
				0,
				0,
				0
			];
			return [
				boundedCount(positiveDelta(previous.humanMessages, current.humanMessages)),
				boundedCount(positiveDelta(previous.assistantMessages, current.assistantMessages)),
				boundedCount(positiveDelta(previous.toolEvents, current.toolEvents))
			];
		}
		//#endregion
		//#region src/aura/activity.ts
		/** Session-continuity tracking for Aura's transient activity coefficients. */
		function emptyActivity() {
			return {
				humanMessages: 0,
				assistantMessages: 0,
				toolEvents: 0
			};
		}
		function addActivity(target, source) {
			target.humanMessages += source.humanMessages;
			target.assistantMessages += source.assistantMessages;
			target.toolEvents += source.toolEvents;
		}
		function isMonotonic(previous, current) {
			return current.humanMessages >= previous.humanMessages && current.assistantMessages >= previous.assistantMessages && current.toolEvents >= previous.toolEvents;
		}
		/**
		* Extract per-Session activity heads from the currently available projections.
		* @param entries - Host-listed Sessions and their optional Aura projections.
		* @returns current projected heads in Host-list order.
		*/
		function auraActivityHeadsOf(entries) {
			return entries.flatMap((entry) => {
				if (entry.projection === void 0) return [];
				return [{
					sessionId: entry.id,
					lastSeq: entry.projection.lastSeq,
					activity: auraChannelSourcesOf(entry.projection).activity
				}];
			});
		}
		/**
		* Advance activity continuity without treating hydration, removal, or replay as live input.
		*
		* A Session contributes an impulse only when it existed in the preceding baseline,
		* its durable sequence advanced, and all three totals remained monotonic. New,
		* reappearing, rewound, and reset projections establish a new baseline at exact rest.
		*
		* @param previous - preceding heads keyed by opaque Session id.
		* @param current - currently projected Session heads.
		* @returns replacement baselines and the independently normalized activity impulse.
		*/
		function advanceAuraActivity(previous, current) {
			const baselines = /* @__PURE__ */ new Map();
			const comparablePrevious = emptyActivity();
			const comparableCurrent = emptyActivity();
			for (const head of current) {
				baselines.set(head.sessionId, {
					lastSeq: head.lastSeq,
					activity: { ...head.activity }
				});
				const baseline = previous.get(head.sessionId);
				if (baseline === void 0 || head.lastSeq <= baseline.lastSeq || !isMonotonic(baseline.activity, head.activity)) continue;
				addActivity(comparablePrevious, baseline.activity);
				addActivity(comparableCurrent, head.activity);
			}
			return {
				baselines,
				impulse: transientChannelsOf(comparablePrevious, comparableCurrent)
			};
		}
		//#endregion
		//#region src/aura/rotor.ts
		/** Frozen Givens-rotation order: standing `xy, xz, yz`, then breath `xw, yw, zw`. */
		const PLANES = Object.freeze([
			Object.freeze([0, 1]),
			Object.freeze([0, 2]),
			Object.freeze([1, 2]),
			Object.freeze([0, 3]),
			Object.freeze([1, 3]),
			Object.freeze([2, 3])
		]);
		/** Fixed six-plane orientation used to make the projected cage readable. */
		const FIGURE_ORIENTATION = Object.freeze([
			.38,
			-.32,
			.2,
			0,
			0,
			0
		]);
		/** Frozen bit-order enumeration of the sixteen vertices in `{−1,+1}^4`. */
		const TESSERACT_VERTICES = Object.freeze(Array.from({ length: 16 }, (_, index) => Object.freeze([
			(index & 1) === 0 ? -1 : 1,
			(index & 2) === 0 ? -1 : 1,
			(index & 4) === 0 ? -1 : 1,
			(index & 8) === 0 ? -1 : 1
		])));
		/** Thirty-two unique edges joining vertices that differ in exactly one axis. */
		const TESSERACT_EDGES = Object.freeze((() => {
			const edges = [];
			for (let vertex = 0; vertex < 16; vertex += 1) for (let axis = 0; axis < 4; axis += 1) {
				const neighbor = vertex ^ 1 << axis;
				if (neighbor > vertex) edges.push(Object.freeze([vertex, neighbor]));
			}
			return edges;
		})());
		/** Twenty-four square faces: four fixed-coordinate faces for each rotation plane. */
		const TESSERACT_FACES = Object.freeze((() => {
			const axes = [
				0,
				1,
				2,
				3
			];
			const faces = [];
			for (const [planeIndex, plane] of PLANES.entries()) {
				const [leftAxis, rightAxis] = plane;
				const fixedAxes = axes.filter((axis) => axis !== leftAxis && axis !== rightAxis);
				for (let fixedPattern = 0; fixedPattern < 4; fixedPattern += 1) {
					let base = 0;
					for (const [offset, axis] of fixedAxes.entries()) if ((fixedPattern & 1 << offset) !== 0) base |= 1 << axis;
					const left = 1 << leftAxis;
					const right = 1 << rightAxis;
					faces.push(Object.freeze({
						planeIndex,
						plane,
						vertices: Object.freeze([
							base,
							base ^ left,
							base ^ left ^ right,
							base ^ right
						])
					}));
				}
			}
			return faces;
		})());
		function finiteOrZero$1(value) {
			return typeof value === "number" && Number.isFinite(value) ? value : 0;
		}
		/**
		* Rotate a four-dimensional point through all six planes in `PLANES` order.
		* @param point - Four coordinates; absent or non-finite entries are zero.
		* @param angles - Six plane angles; absent or non-finite entries are zero.
		* @returns Length-preserving ordered Givens rotation of the normalized input point.
		*/
		function rotate4(point, angles) {
			const rotated = [
				finiteOrZero$1(point?.[0]),
				finiteOrZero$1(point?.[1]),
				finiteOrZero$1(point?.[2]),
				finiteOrZero$1(point?.[3])
			];
			for (const [planeIndex, [leftAxis, rightAxis]] of PLANES.entries()) {
				const angle = finiteOrZero$1(angles?.[planeIndex]);
				if (angle === 0) continue;
				const cosine = Math.cos(angle);
				const sine = Math.sin(angle);
				const left = rotated[leftAxis];
				const right = rotated[rightAxis];
				rotated[leftAxis] = left * cosine - right * sine;
				rotated[rightAxis] = left * sine + right * cosine;
			}
			return rotated;
		}
		/**
		* Project a four-dimensional point into three dimensions along the fourth axis.
		* @param point - Four coordinates; absent or non-finite entries are zero.
		* @param distance - Eye distance; zero and non-finite values use `W_DISTANCE`.
		* @returns Three finite coordinates with the perspective denominator clamped to `0.25`.
		*/
		function project(point, distance = 3) {
			const resolvedDistance = finiteOrZero$1(distance) || 3;
			const scale = resolvedDistance / Math.max(.25, resolvedDistance - finiteOrZero$1(point?.[3]));
			return [
				finiteOrZero$1(point?.[0]) * scale,
				finiteOrZero$1(point?.[1]) * scale,
				finiteOrZero$1(point?.[2]) * scale
			];
		}
		/**
		* Produce the sixteen projected points of one deterministic Aura frame.
		*
		* The supplied vertices carry system state. The orientation is fixed display
		* geometry and does not change with time or session activity.
		*
		* @param input - Canonical-order vertices plus an optional fixed orientation.
		* @returns Sixteen finite projected points in canonical vertex order.
		*/
		function figureFrame(input) {
			const normalized = input !== null && typeof input === "object" ? input : {};
			const vertices = normalized.vertices ?? TESSERACT_VERTICES;
			const orientation = normalized.orientation ?? FIGURE_ORIENTATION;
			const distance = normalized.distance ?? 3;
			return vertices.map((vertex) => project(rotate4(vertex, orientation), distance));
		}
		/**
		* Compute the canonical non-cryptographic digest of a projected frame.
		* @param frame - Projected points; absent or non-finite coordinates are zero.
		* @returns Lowercase FNV-1a digest after coordinate quantization to `1e-9`.
		*/
		function frameDigest(frame) {
			let hash = 2166136261;
			const consume = (value) => {
				for (let index = 0; index < value.length; index += 1) {
					hash ^= value.charCodeAt(index);
					hash = Math.imul(hash, 16777619) >>> 0;
				}
			};
			for (const point of frame ?? []) {
				for (let axis = 0; axis < 3; axis += 1) consume(`${Math.round(finiteOrZero$1(point?.[axis]) * 1e9) + 0};`);
				consume("|");
			}
			return (hash >>> 0).toString(16).padStart(8, "0");
		}
		//#endregion
		//#region src/aura/walsh.ts
		/** Frozen plane order: standing `xy, xz, yz`, then breath `xw, yw, zw`. */
		const PLANE_ORDER = Object.freeze([
			Object.freeze([0, 1]),
			Object.freeze([0, 2]),
			Object.freeze([1, 2]),
			Object.freeze([0, 3]),
			Object.freeze([1, 3]),
			Object.freeze([2, 3])
		]);
		Object.freeze([
			"xy",
			"xz",
			"yz",
			"xw",
			"yw",
			"zw"
		]);
		/** Frozen bit-order enumeration of the sixteen vertices in `{−1,+1}^4`. */
		const VERTICES = Object.freeze(Array.from({ length: 16 }, (_, index) => Object.freeze([
			(index & 1) === 0 ? -1 : 1,
			(index & 2) === 0 ? -1 : 1,
			(index & 4) === 0 ? -1 : 1,
			(index & 8) === 0 ? -1 : 1
		])));
		function finiteOrZero(value) {
			return typeof value === "number" && Number.isFinite(value) ? value : 0;
		}
		/**
		* Synthesize a 16-vertex field from six degree-two Walsh coefficients.
		* @param coefficients - Values in `PLANE_ORDER`; absent or non-finite entries are zero.
		* @returns Sixteen finite vertex amplitudes in `VERTICES` order.
		*/
		function synth6(coefficients) {
			const field = new Array(16).fill(0);
			for (const [vertexIndex, vertex] of VERTICES.entries()) {
				let amplitude = 0;
				for (const [mode, [leftAxis, rightAxis]] of PLANE_ORDER.entries()) amplitude += finiteOrZero(coefficients?.[mode]) * vertex[leftAxis] * vertex[rightAxis];
				field[vertexIndex] = amplitude;
			}
			return field;
		}
		//#endregion
		//#region src/aura/deformation.ts
		/** Pure field-driven deformation of the canonical Aura tesseract vertices. */
		/** Maximum fractional radial displacement from a canonical vertex. */
		const AURA_DEFORMATION_LIMIT = .34;
		function responseOf(amplitude) {
			return Number.isNaN(amplitude) ? 0 : Math.tanh(amplitude / 1);
		}
		/**
		* Deform the canonical tesseract through its six ordered Aura coefficients.
		*
		* The existing Walsh synthesis assigns one amplitude `f(v)` to every vertex.
		* Each vertex moves only along its radial line by
		* `1 + AURA_DEFORMATION_LIMIT * tanh(f(v) / AURA_DEFORMATION_RESPONSE)`.
		* Antipodal vertices share one Walsh amplitude, so they remain exact opposites
		* and preserve the origin-centered figure. Positive scale bounds retain the
		* canonical vertex order and edge topology.
		*
		* @param coefficients - `xy, xz, yz, xw, yw, zw`; missing or non-finite values are zero.
		* @returns sixteen finite four-dimensional points in canonical vertex order.
		*/
		function deformTesseract(coefficients) {
			const field = synth6(coefficients);
			return TESSERACT_VERTICES.map((vertex, index) => {
				const scale = 1 + AURA_DEFORMATION_LIMIT * responseOf(field[index] ?? 0);
				return [
					vertex[0] * scale,
					vertex[1] * scale,
					vertex[2] * scale,
					vertex[3] * scale
				];
			});
		}
		//#endregion
		//#region src/aura/ternary.ts
		/** Ascending balanced digits used to enumerate the three cube axes. */
		const AURA_TRITS = [
			-1,
			0,
			1
		];
		/**
		* Encode three balanced digits as one base-27 digit's zero-based index.
		* @param trits - history, tool, and approval digits.
		* @returns the unique cell index in 0 through 26.
		*/
		function auraCellIndex(trits) {
			return (trits[0] + 1) * 9 + (trits[1] + 1) * 3 + trits[2] + 1;
		}
		/**
		* Partition a normalized coefficient into equal-width thirds, with ties central.
		* @param value - finite coefficient in [-1, 1].
		* @returns lower, middle, or upper interval as a balanced digit.
		*/
		function auraTritOf(value) {
			return value < -1 / 3 ? -1 : value > 1 / 3 ? 1 : 0;
		}
		/**
		* Quantize the same persistent inputs used by the tesseract.
		* Tool health is rescaled from [0, 1] to [-1, 1] before equal-third binning.
		* @param sources - committed session-log totals, not verified effect receipts.
		* @returns source coefficients and an observed or partial 27-cell coordinate.
		*/
		function auraTernaryOf(sources) {
			const values = persistentChannelsOf(sources);
			const coverage = Math.max(sources.approvalsAsked, sources.approvalsAllowed + sources.approvalsRejected + sources.approvalsUnavailable + sources.approvalsCancelled);
			const history = sources.historyInteractions > 0 ? auraTritOf(values[0]) : null;
			const tool = sources.toolCalls > 0 ? values[1] < 1 / 3 ? -1 : values[1] > 2 / 3 ? 1 : 0 : null;
			const approval = coverage > 0 ? auraTritOf(values[2]) : null;
			return {
				values,
				trits: [
					history,
					tool,
					approval
				],
				index: history === null || tool === null || approval === null ? null : auraCellIndex([
					history,
					tool,
					approval
				])
			};
		}
		//#endregion
		//#region src/aura/motion.ts
		/** Pure presentation motion and real-activity breath envelopes for Aura. */
		/** Duration of one complete visible rotation around Aura's primary spatial plane. */
		const AURA_ROTATION_PERIOD_MS = 72e3;
		/** Fraction by which the transient activity drive relaxes on each coefficient frame. */
		const AURA_BREATH_DRIVE_DECAY = .04;
		/** Fraction by which visible breath follows its transient drive on each coefficient frame. */
		const AURA_BREATH_RESPONSE = .16;
		function finiteTime(value) {
			return Number.isFinite(value) && value > 0 ? value : 0;
		}
		function bounded(value, minimum, maximum) {
			return Math.min(maximum, Math.max(minimum, value));
		}
		/**
		* Whether two exact triads describe the same rendered coefficient state.
		* @param left - first coefficient triad.
		* @param right - second coefficient triad.
		* @returns whether all three coefficients are exactly equal.
		*/
		function sameAuraTriad(left, right) {
			return left.every((value, index) => value === right[index]);
		}
		/**
		* Move one triad toward a target and snap close values to the exact target.
		* @param previous - currently rendered coefficients.
		* @param target - coefficient target.
		* @param rate - fraction of remaining distance applied by this step.
		* @returns the next bounded transition step.
		*/
		function approachAuraTriad(previous, target, rate = .18) {
			const resolvedRate = Number.isFinite(rate) && rate > 0 && rate <= 1 ? rate : .18;
			const approach = (value, targetValue) => {
				const next = value + (targetValue - value) * resolvedRate;
				return Math.abs(targetValue - next) <= .002 ? targetValue : next;
			};
			return [
				approach(previous[0], target[0]),
				approach(previous[1], target[1]),
				approach(previous[2], target[2])
			];
		}
		/**
		* Add real logged activity to the breath drive without exceeding one per plane.
		* @param motion - current two-stage breath state.
		* @param impulse - human, assistant, and tool activity deltas.
		* @returns excited breath state; the visible value is unchanged until its attack step.
		*/
		function exciteAuraBreath(motion, impulse) {
			return {
				drive: [
					Math.min(1, motion.drive[0] + Math.max(0, impulse[0])),
					Math.min(1, motion.drive[1] + Math.max(0, impulse[1])),
					Math.min(1, motion.drive[2] + Math.max(0, impulse[2]))
				],
				value: [...motion.value]
			};
		}
		/**
		* Advance one organic attack-and-release step for the transient Aura coefficients.
		* @param motion - current drive and visible breath values.
		* @returns the next state, eventually snapping both triads to exact rest.
		*/
		function stepAuraBreath(motion) {
			const drive = approachAuraTriad(motion.drive, [...REST], AURA_BREATH_DRIVE_DECAY);
			return {
				drive,
				value: approachAuraTriad(motion.value, drive, AURA_BREATH_RESPONSE)
			};
		}
		/**
		* Whether both stages of the transient breath have returned to exact rest.
		* @param motion - current drive and visible breath values.
		* @returns whether the drive and visible values are all exactly zero.
		*/
		function auraBreathAtRest(motion) {
			return sameAuraTriad(motion.drive, [...REST]) && sameAuraTriad(motion.value, [...REST]);
		}
		/**
		* Reduce three transient coefficients to a bounded presentation strength.
		* @param breath - current human, assistant, and tool breath coefficients.
		* @returns root-mean-square activity in `[0, 1]`.
		*/
		function auraActivityEnergy(breath) {
			return bounded(Math.hypot(...breath) / Math.sqrt(3), 0, 1);
		}
		/**
		* Compute the shared slow viewing rotation.
		* @param elapsedMs - active, visible presentation time.
		* @returns six-plane viewing orientation; fourth-axis planes remain fixed.
		*/
		function auraOrientationAt(elapsedMs) {
			const phase = TAU * (finiteTime(elapsedMs) % AURA_ROTATION_PERIOD_MS) / AURA_ROTATION_PERIOD_MS;
			return [
				(FIGURE_ORIENTATION[0] ?? 0) + .09 * Math.sin(phase),
				(FIGURE_ORIENTATION[1] ?? 0) + .12 * Math.sin(phase * 2 + .8),
				(FIGURE_ORIENTATION[2] ?? 0) + phase,
				FIGURE_ORIENTATION[3] ?? 0,
				FIGURE_ORIENTATION[4] ?? 0,
				FIGURE_ORIENTATION[5] ?? 0
			];
		}
		/**
		* Compute a zero-mean, presentation-only idle presence carrier.
		* @param elapsedMs - active, visible presentation time.
		* @returns shared display scale within `1 ± AURA_REST_SCALE_LIMIT`.
		*/
		function auraRestScaleAt(elapsedMs) {
			const time = finiteTime(elapsedMs);
			return 1 + .006 * Math.sin(TAU * time / 6800) + .002 * Math.sin(TAU * time / 4100);
		}
		/**
		* Compose the presentation frame without changing data coefficients or their digest.
		* @param elapsedMs - active, visible presentation time.
		* @param breath - real-activity transient coefficients.
		* @param reducedMotion - whether all continuous presentation motion is disabled.
		* @returns shared view orientation, scale, and attributable activity strength.
		*/
		function auraPresentationAt(elapsedMs, breath, reducedMotion = false) {
			const activity = auraActivityEnergy(breath);
			if (reducedMotion) return {
				activity,
				orientation: [
					FIGURE_ORIENTATION[0] ?? 0,
					FIGURE_ORIENTATION[1] ?? 0,
					FIGURE_ORIENTATION[2] ?? 0,
					FIGURE_ORIENTATION[3] ?? 0,
					FIGURE_ORIENTATION[4] ?? 0,
					FIGURE_ORIENTATION[5] ?? 0
				],
				scale: 1
			};
			const activityWave = .036 + .01 * Math.sin(TAU * finiteTime(elapsedMs) / 1240);
			return {
				activity,
				orientation: auraOrientationAt(elapsedMs),
				scale: auraRestScaleAt(elapsedMs) + activity * activityWave
			};
		}
		//#endregion
		//#region src/client/escape.ts
		/**
		* Whether an Escape press originated inside a text-entry control, where the
		* key edits that control (clear, cancel composition) rather than the shell.
		* Duck-typed so targets from same-origin iframe documents (a different realm,
		* where `instanceof HTMLElement` fails) classify identically.
		* @param target - the keyboard event's target.
		* @returns true when the target is an input, textarea, select, or
		*   contenteditable host.
		*/
		function isEditableTarget(target) {
			const el = target;
			const tag = typeof el?.tagName === "string" ? el.tagName : "";
			return el?.isContentEditable === true || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
		}
		//#endregion
		//#region \0dsh-css:AuraCoherenceSurface.module.css.mjs
		const css$2 = "._9mi3HW_surface{box-sizing:border-box;background:radial-gradient(circle at 8% 0%, color-mix(in srgb, var(--dsw-static-spatial-mint) 7%, transparent), transparent 28%), radial-gradient(circle at 94% 6%, color-mix(in srgb, var(--dsw-static-spatial-violet) 8%, transparent), transparent 30%), var(--dsw-alias-bg-layer-1);width:100%;min-width:0;height:100%;min-height:0;color:var(--dsw-alias-label-primary);--aura-green:var(--dsw-static-spatial-mint);--aura-blue:var(--dsw-static-spatial-blue);--aura-purple:var(--dsw-static-spatial-violet);--aura-gold:var(--dsw-static-spatial-gold);--aura-green-bright:color-mix(in srgb, var(--aura-green) 76%, white);--aura-blue-bright:color-mix(in srgb, var(--aura-blue) 76%, white);--aura-purple-bright:color-mix(in srgb, var(--aura-purple) 78%, white);--aura-gold-bright:color-mix(in srgb, var(--aura-gold) 82%, white);padding:clamp(18px,3%,40px);overflow:auto}._9mi3HW_surface[hidden]{display:none}._9mi3HW_ternarySlices{grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:16px;display:grid}._9mi3HW_ternaryGrid{grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;padding:0;list-style:none;display:grid}._9mi3HW_ternaryGrid li{text-align:center;border:1px solid var(--dsw-alias-label-tertiary);color:var(--dsw-alias-label-secondary);border-radius:6px;gap:4px;padding:8px 4px;display:grid}._9mi3HW_ternaryGrid li[aria-current=true]{outline:2px solid var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:700}._9mi3HW_ternaryGrid small{font-size:11px;line-height:1.4}._9mi3HW_section{box-sizing:border-box;width:min(100%,1180px);min-height:100%;margin:0 auto;container-type:inline-size}._9mi3HW_heading{justify-content:space-between;align-items:flex-start;gap:clamp(12px,3cqi,28px);display:flex}._9mi3HW_titleBlock{flex:1;min-width:0}._9mi3HW_heading h2,._9mi3HW_heading p,._9mi3HW_figureStage,._9mi3HW_truthLine p,._9mi3HW_portal p{margin:0}._9mi3HW_heading h2{letter-spacing:-.035em;text-overflow:ellipsis;white-space:nowrap;font-size:clamp(26px,4.2cqi,38px);font-weight:500;line-height:1.08;overflow:hidden}._9mi3HW_heading p,._9mi3HW_liveState,._9mi3HW_portal summary strong,._9mi3HW_values dt,._9mi3HW_values dd,._9mi3HW_recent{font-family:var(--dsw-font-family-mono,ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)}._9mi3HW_heading p{color:var(--aura-blue);letter-spacing:.13em;white-space:nowrap;margin-top:8px;font-size:11px;font-weight:700;line-height:16px}._9mi3HW_liveState{color:var(--aura-green);letter-spacing:.1em;white-space:nowrap;flex:none;align-items:center;gap:8px;margin-top:4px;font-size:11px;font-weight:700;line-height:16px;display:flex}._9mi3HW_liveState span{background:currentColor;border-radius:50%;width:7px;height:7px;box-shadow:0 0 12px}._9mi3HW_liveState[data-state=moving] span{animation:1.1s ease-in-out infinite _9mi3HW_aura-live-pulse}._9mi3HW_liveState[data-state=absent]{color:var(--dsw-alias-label-tertiary)}._9mi3HW_liveState[data-state=waiting]{color:var(--aura-gold)}._9mi3HW_figureStage{--aura-activity:0;--aura-presence-scale:1;place-items:center;min-height:clamp(360px,76cqi,640px);margin-top:clamp(8px,2cqi,20px);display:grid;position:relative}._9mi3HW_figureStage:before{content:\"\";background:radial-gradient(circle at 42% 48%, color-mix(in srgb, var(--aura-purple) 16%, transparent), transparent 54%), radial-gradient(circle at 60% 54%, color-mix(in srgb, var(--aura-blue) 10%, transparent), transparent 64%);filter:blur(28px);pointer-events:none;border-radius:50%;position:absolute;inset:10% 12%}._9mi3HW_presenceHalo{z-index:0;aspect-ratio:1;width:min(76%,540px);opacity:calc(.22 + var(--aura-activity) * .5);background:radial-gradient(circle at 38% 42%, color-mix(in srgb, var(--aura-green) 30%, transparent), transparent 44%), radial-gradient(circle at 63% 38%, color-mix(in srgb, var(--aura-blue) 34%, transparent), transparent 48%), radial-gradient(circle at 52% 64%, color-mix(in srgb, var(--aura-purple) 36%, transparent), transparent 52%), radial-gradient(circle at 68% 68%, color-mix(in srgb, var(--aura-gold) 18%, transparent), transparent 44%);filter:blur(calc(34px + var(--aura-activity) * 18px));transform:scale(calc(.94 + var(--aura-activity) * .12));transform-origin:50%;pointer-events:none;border-radius:50%;position:absolute}._9mi3HW_tesseract{z-index:1;aspect-ratio:1;width:min(100%,680px);height:auto;filter:saturate(calc(1.5 + var(--aura-activity) * .7)) contrast(1.04) drop-shadow(0 0 calc(24px + var(--aura-activity) * 12px) color-mix(in srgb, var(--aura-purple) 28%, transparent));position:relative;overflow:visible}._9mi3HW_tesseract polygon{stroke-width:.9px;stroke-linejoin:round;vector-effect:non-scaling-stroke}._9mi3HW_tesseract line{stroke-linecap:round;vector-effect:non-scaling-stroke}._9mi3HW_tesseract circle{fill:color-mix(in srgb, var(--aura-green) 64%, var(--aura-blue-bright))}._9mi3HW_tesseract circle[data-polarity=negative]{fill:color-mix(in srgb, var(--aura-purple-bright) 72%, var(--aura-gold-bright))}._9mi3HW_referenceLayer line{stroke:color-mix(in srgb, var(--dsw-alias-label-secondary) 46%, transparent);stroke-width:.75px;stroke-dasharray:4 8;stroke-linecap:round;vector-effect:non-scaling-stroke}._9mi3HW_currentLayer polygon{mix-blend-mode:normal}._9mi3HW_currentLayer polygon[data-plane-tone=history]{stroke:var(--aura-green-bright)}._9mi3HW_currentLayer polygon[data-plane-tone=tool-health]{stroke:color-mix(in srgb, var(--aura-blue) 78%, white)}._9mi3HW_currentLayer polygon[data-plane-tone=approval]{stroke:color-mix(in srgb, var(--aura-gold) 82%, white)}._9mi3HW_currentLayer polygon[data-plane-tone=human]{stroke:color-mix(in srgb, var(--aura-purple) 82%, white)}._9mi3HW_currentLayer polygon[data-plane-tone=assistant]{stroke:color-mix(in srgb, var(--aura-blue) 48%, var(--aura-purple))}._9mi3HW_currentLayer polygon[data-plane-tone=tool-activity]{stroke:color-mix(in srgb, var(--aura-green) 52%, var(--aura-blue))}._9mi3HW_figureKey{z-index:2;color:var(--dsw-alias-label-secondary);align-items:center;gap:16px;font-size:12.5px;line-height:18px;display:flex;position:absolute;bottom:12px;right:0}._9mi3HW_figureKey span{align-items:center;gap:7px;display:inline-flex}._9mi3HW_figureKey span:before{content:\"\";border-top:2px solid var(--aura-purple);width:18px}._9mi3HW_figureKey span[data-layer=reference]:before{border-top:1px dashed var(--dsw-alias-label-tertiary)}._9mi3HW_channels{border-top:1px solid var(--dsw-alias-border-l1);padding:20px 0 24px}._9mi3HW_channels>header{justify-content:space-between;align-items:baseline;gap:24px;margin-bottom:14px;display:flex}._9mi3HW_channels h3,._9mi3HW_channels p{margin:0}._9mi3HW_channels h3{color:var(--aura-blue);letter-spacing:.1em;text-transform:uppercase;flex:none;font-size:12px;font-weight:700;line-height:18px}._9mi3HW_channels>header p{max-width:620px;color:var(--dsw-alias-label-secondary);text-align:right;font-size:13px;line-height:19px}._9mi3HW_channelGrid{grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;display:grid}._9mi3HW_channel{border:1px solid color-mix(in srgb, var(--aura-blue) 18%, var(--dsw-alias-border-l1));background:color-mix(in srgb, var(--dsw-alias-bg-layer-1) 82%, transparent);border-radius:13px;min-width:0;padding:14px}._9mi3HW_channel[data-lifetime=transient]{border-color:color-mix(in srgb, var(--aura-purple) 25%, var(--dsw-alias-border-l1))}._9mi3HW_channelHeading{grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:9px;display:grid}._9mi3HW_channelHeading strong{-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:14px;font-weight:560;line-height:18px;display:-webkit-box;overflow:hidden}._9mi3HW_channelHeading output,._9mi3HW_plane,._9mi3HW_channel>p{font-family:var(--dsw-font-family-mono,ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)}._9mi3HW_channelHeading output{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;font-size:13px}._9mi3HW_plane{min-width:24px;color:var(--aura-green);text-transform:uppercase;font-size:11px;font-weight:700;line-height:18px}._9mi3HW_channel[data-lifetime=transient] ._9mi3HW_plane{color:var(--aura-purple)}._9mi3HW_channel[data-aura-channel=toolHealth] ._9mi3HW_plane{color:var(--aura-blue)}._9mi3HW_channel[data-aura-channel=approvalPosture] ._9mi3HW_plane{color:var(--aura-gold)}._9mi3HW_channel[data-aura-channel=humanActivity] ._9mi3HW_plane{color:var(--aura-purple)}._9mi3HW_channel[data-aura-channel=assistantActivity] ._9mi3HW_plane{color:color-mix(in srgb, var(--aura-blue) 48%, var(--aura-purple))}._9mi3HW_channel[data-aura-channel=toolActivity] ._9mi3HW_plane{color:color-mix(in srgb, var(--aura-green) 52%, var(--aura-blue))}._9mi3HW_channel progress{appearance:none;background:var(--dsw-alias-border-l1);border:0;border-radius:999px;width:100%;height:3px;margin:11px 0 9px;display:block;overflow:hidden}._9mi3HW_bipolarMeter{background:var(--dsw-alias-border-l1);border-radius:999px;width:100%;height:3px;margin:11px 0 9px;display:block;position:relative}._9mi3HW_bipolarMeter:before{content:\"\";background:var(--dsw-alias-border-l2);width:1px;position:absolute;top:-2px;bottom:-2px;left:50%}._9mi3HW_bipolarFill{border-radius:inherit;background:linear-gradient(90deg, var(--aura-green), var(--aura-green-bright));position:absolute;top:0;bottom:0}._9mi3HW_bipolarFill[data-direction=positive]{left:50%}._9mi3HW_bipolarFill[data-direction=negative]{right:50%}._9mi3HW_channel[data-aura-channel=approvalPosture] ._9mi3HW_bipolarFill{background:linear-gradient(90deg, var(--aura-gold), var(--aura-gold-bright))}._9mi3HW_channel progress::-webkit-progress-bar{border-radius:inherit;background:var(--dsw-alias-border-l1)}._9mi3HW_channel progress::-webkit-progress-value{border-radius:inherit;background:linear-gradient(90deg, var(--aura-green), var(--aura-green-bright))}._9mi3HW_channel[data-lifetime=transient] progress::-webkit-progress-value{background:linear-gradient(90deg, var(--aura-purple), var(--aura-gold))}._9mi3HW_channel[data-aura-channel=toolHealth] progress::-webkit-progress-value{background:linear-gradient(90deg, var(--aura-blue), var(--aura-blue-bright))}._9mi3HW_channel[data-aura-channel=approvalPosture] progress::-webkit-progress-value{background:linear-gradient(90deg, var(--aura-gold), var(--aura-gold-bright))}._9mi3HW_channel[data-aura-channel=humanActivity] progress::-webkit-progress-value{background:linear-gradient(90deg, var(--aura-purple), var(--aura-purple-bright))}._9mi3HW_channel[data-aura-channel=assistantActivity] progress::-webkit-progress-value{background:linear-gradient(90deg, var(--aura-blue), var(--aura-purple))}._9mi3HW_channel[data-aura-channel=toolActivity] progress::-webkit-progress-value{background:linear-gradient(90deg, var(--aura-green), var(--aura-blue))}._9mi3HW_channel progress::-moz-progress-bar{border-radius:inherit;background:linear-gradient(90deg, var(--aura-green), var(--aura-green-bright))}._9mi3HW_channel[data-lifetime=transient] progress::-moz-progress-bar{background:linear-gradient(90deg, var(--aura-purple), var(--aura-gold))}._9mi3HW_channel[data-aura-channel=toolHealth] progress::-moz-progress-bar{background:linear-gradient(90deg, var(--aura-blue), var(--aura-blue-bright))}._9mi3HW_channel[data-aura-channel=approvalPosture] progress::-moz-progress-bar{background:linear-gradient(90deg, var(--aura-gold), var(--aura-gold-bright))}._9mi3HW_channel[data-aura-channel=humanActivity] progress::-moz-progress-bar{background:linear-gradient(90deg, var(--aura-purple), var(--aura-purple-bright))}._9mi3HW_channel[data-aura-channel=assistantActivity] progress::-moz-progress-bar{background:linear-gradient(90deg, var(--aura-blue), var(--aura-purple))}._9mi3HW_channel[data-aura-channel=toolActivity] progress::-moz-progress-bar{background:linear-gradient(90deg, var(--aura-green), var(--aura-blue))}._9mi3HW_channel>p{color:var(--dsw-alias-label-tertiary);text-wrap:pretty;font-size:11px;line-height:16px}._9mi3HW_truthLine{border-top:1px solid var(--dsw-alias-border-l1);border-bottom:1px solid var(--dsw-alias-border-l1);grid-template-columns:minmax(180px,.7fr) minmax(240px,1.2fr) minmax(180px,.9fr);align-items:end;gap:clamp(20px,5cqi,52px);padding:22px 0;display:grid}._9mi3HW_truthLine div{flex-direction:column;gap:5px;display:flex}._9mi3HW_truthLine div>span{color:var(--aura-blue);letter-spacing:.08em;text-transform:uppercase;font-size:11px;font-weight:650;line-height:16px}._9mi3HW_truthLine strong{font-size:clamp(17px,2.2cqi,22px);font-weight:570;line-height:1.2}._9mi3HW_truthLine p{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}._9mi3HW_portals{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:20px;display:grid}._9mi3HW_portal{border:1px solid color-mix(in srgb, var(--aura-purple) 26%, transparent);background:color-mix(in srgb, var(--dsw-alias-bg-layer-1) 74%, transparent);border-radius:14px;align-self:start;overflow:hidden}._9mi3HW_portal[open]{border-color:color-mix(in srgb, var(--aura-green) 38%, transparent);background:color-mix(in srgb, var(--dsw-alias-bg-layer-1) 88%, transparent)}._9mi3HW_portal summary{box-sizing:border-box;cursor:pointer;justify-content:space-between;align-items:center;gap:14px;min-height:64px;padding:15px 18px;list-style:none;display:flex;position:relative}._9mi3HW_portal summary::-webkit-details-marker{display:none}._9mi3HW_portal summary:after{content:\"＋\";color:var(--aura-purple);flex:none;font-size:16px}._9mi3HW_portal[open] summary:after{content:\"−\";color:var(--aura-green)}._9mi3HW_portal summary>span{flex:1;min-width:0;font-size:15px;font-weight:560;line-height:20px}._9mi3HW_portal summary strong{color:var(--dsw-alias-label-secondary);letter-spacing:.02em;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:500;line-height:16px;overflow:hidden}._9mi3HW_portalBody{border-top:1px solid var(--dsw-alias-border-l1);padding:0 18px 18px}._9mi3HW_portalBody>p{color:var(--dsw-alias-label-secondary);margin-top:14px;font-size:13px;line-height:20px}._9mi3HW_values{grid-template-columns:1fr;gap:10px;margin:16px 0 0;display:grid}._9mi3HW_values div{justify-content:space-between;align-items:baseline;gap:14px;display:flex}._9mi3HW_values dt,._9mi3HW_values dd{margin:0;font-size:11px;line-height:17px}._9mi3HW_values dt{color:var(--dsw-alias-label-tertiary)}._9mi3HW_values dd{overflow-wrap:anywhere;max-width:62%;color:var(--aura-blue);text-align:right}._9mi3HW_values ._9mi3HW_unavailable{color:var(--aura-gold)}._9mi3HW_recent{flex-direction:column;gap:8px;max-height:240px;margin:16px 0 0;padding:0;list-style:none;display:flex;overflow-y:auto}._9mi3HW_recent li{border-left:2px solid var(--aura-purple);color:var(--dsw-alias-label-secondary);justify-content:space-between;align-items:baseline;gap:12px;padding-left:11px;font-size:11px;line-height:17px;display:flex}._9mi3HW_recent li[data-kind=approval]{border-left-color:var(--aura-gold)}._9mi3HW_recent li[data-kind=action]{border-left-color:var(--aura-green)}._9mi3HW_recent li[data-kind=message]{border-left-color:var(--aura-blue)}._9mi3HW_recent time{color:var(--dsw-alias-label-tertiary);flex:none}@keyframes _9mi3HW_aura-live-pulse{0%,to{opacity:.45;transform:scale(.85)}50%{opacity:1;transform:scale(1.15)}}@container (width<=680px){._9mi3HW_truthLine{grid-template-columns:1fr;gap:10px}}@container (width<=620px){._9mi3HW_heading h2{font-size:clamp(22px,7cqi,28px)}._9mi3HW_heading p{letter-spacing:.1em;font-size:11px}._9mi3HW_liveState{letter-spacing:.06em;gap:6px;font-size:11px}._9mi3HW_figureStage{min-height:clamp(350px,92cqi,500px)}._9mi3HW_tesseract{width:min(100%,520px)}._9mi3HW_figureKey{grid-column:1;justify-self:center;margin-top:-18px;position:static}._9mi3HW_channels>header{display:block}._9mi3HW_channels>header p{text-align:left;margin-top:5px}._9mi3HW_channelGrid{grid-template-columns:repeat(2,minmax(0,1fr))}._9mi3HW_portals{grid-template-columns:1fr}}@container (width<=390px){._9mi3HW_heading{gap:10px}._9mi3HW_heading h2{font-size:21px}._9mi3HW_heading p,._9mi3HW_liveState{font-size:11px}._9mi3HW_liveState span{width:6px;height:6px}._9mi3HW_figureStage{min-height:330px}._9mi3HW_figureKey{flex-direction:column;justify-self:start;align-items:flex-start;gap:4px;margin-top:-10px}._9mi3HW_channelGrid{grid-template-columns:1fr}._9mi3HW_channel>p{white-space:normal}._9mi3HW_portal summary strong{display:none}}@media (prefers-reduced-motion:reduce){._9mi3HW_presenceHalo{transform:none}._9mi3HW_liveState span{animation:none}}";
		const tagId$2 = "@aukora/face-settings/AuraCoherenceSurface.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$2) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@aukora/face-settings";
			tag.dataset.pluginCss = tagId$2;
			tag.textContent = css$2;
			document.head.appendChild(tag);
		}
		var AuraCoherenceSurface_module_css_default = {
			"aura-live-pulse": "_9mi3HW_aura-live-pulse",
			"bipolarFill": "_9mi3HW_bipolarFill",
			"bipolarMeter": "_9mi3HW_bipolarMeter",
			"channel": "_9mi3HW_channel",
			"channelGrid": "_9mi3HW_channelGrid",
			"channelHeading": "_9mi3HW_channelHeading",
			"channels": "_9mi3HW_channels",
			"currentLayer": "_9mi3HW_currentLayer",
			"figureKey": "_9mi3HW_figureKey",
			"figureStage": "_9mi3HW_figureStage",
			"heading": "_9mi3HW_heading",
			"liveState": "_9mi3HW_liveState",
			"plane": "_9mi3HW_plane",
			"portal": "_9mi3HW_portal",
			"portalBody": "_9mi3HW_portalBody",
			"portals": "_9mi3HW_portals",
			"presenceHalo": "_9mi3HW_presenceHalo",
			"recent": "_9mi3HW_recent",
			"referenceLayer": "_9mi3HW_referenceLayer",
			"section": "_9mi3HW_section",
			"surface": "_9mi3HW_surface",
			"ternaryGrid": "_9mi3HW_ternaryGrid",
			"ternarySlices": "_9mi3HW_ternarySlices",
			"tesseract": "_9mi3HW_tesseract",
			"titleBlock": "_9mi3HW_titleBlock",
			"truthLine": "_9mi3HW_truthLine",
			"unavailable": "_9mi3HW_unavailable",
			"values": "_9mi3HW_values"
		};
		//#endregion
		//#region src/client/AuraCoherenceSurface.tsx
		/** Live Aura Coherence system surface. */
		const COEFFICIENT_FRAME_INTERVAL_MS = 1e3 / 30;
		const PRESENTATION_FRAME_INTERVAL_MS = 1e3 / 45;
		const PRESENTATION_PROJECTION_DISTANCE = 4.2;
		const ZERO_COEFFICIENTS = Object.freeze([
			0,
			0,
			0,
			0,
			0,
			0
		]);
		const FACE_TONES = [
			{
				from: "var(--aura-green)",
				to: "var(--aura-green-bright)",
				tone: "history"
			},
			{
				from: "var(--aura-blue)",
				to: "var(--aura-blue-bright)",
				tone: "tool-health"
			},
			{
				from: "var(--aura-gold)",
				to: "var(--aura-gold-bright)",
				tone: "approval"
			},
			{
				from: "var(--aura-purple)",
				to: "var(--aura-purple-bright)",
				tone: "human"
			},
			{
				from: "var(--aura-blue)",
				to: "var(--aura-purple)",
				tone: "assistant"
			},
			{
				from: "var(--aura-green)",
				to: "var(--aura-blue)",
				tone: "tool-activity"
			}
		];
		const CHANNEL_TEXT = {
			historyPhase: {
				label: "aura.channel.historyPhase.label",
				source: "aura.channel.historyPhase.source"
			},
			toolHealth: {
				label: "aura.channel.toolHealth.label",
				source: "aura.channel.toolHealth.source"
			},
			approvalPosture: {
				label: "aura.channel.approvalPosture.label",
				source: "aura.channel.approvalPosture.source"
			},
			humanActivity: {
				label: "aura.channel.humanActivity.label",
				source: "aura.channel.humanActivity.source"
			},
			assistantActivity: {
				label: "aura.channel.assistantActivity.label",
				source: "aura.channel.assistantActivity.source"
			},
			toolActivity: {
				label: "aura.channel.toolActivity.label",
				source: "aura.channel.toolActivity.source"
			}
		};
		/**
		* Map the available durable system adapter into Aura's standing triad.
		*
		* @param projection - commutative aggregate of Host-folded session projections.
		* @returns persistent history-phase, tool-health, and approval-posture coefficients.
		*/
		function systemStandingOf(projection) {
			return persistentChannelsOf(projection.channelSources.persistent);
		}
		/**
		* Project an Aura frame through the final display camera and shared presence scale.
		* @param frame - projected 4D figure points.
		* @param scale - presentation-only scale applied around the SVG center.
		* @returns screen points and depth values.
		*/
		function cameraFrame(frame, scale = 1) {
			const yaw = -.48;
			const pitch = .34;
			const cy = Math.cos(yaw);
			const sy = Math.sin(yaw);
			const cp = Math.cos(pitch);
			const sp = Math.sin(pitch);
			return frame.map(([x, y, z]) => {
				const yawX = x * cy - z * sy;
				const yawZ = x * sy + z * cy;
				const pitchY = y * cp - yawZ * sp;
				const pitchZ = y * sp + yawZ * cp;
				const perspective = 1 / Math.max(.72, 1.18 - pitchZ * .055);
				return [
					220 + yawX * 66 * perspective * scale,
					220 + pitchY * 66 * perspective * scale,
					pitchZ
				];
			});
		}
		/** Read one canonical tesseract point and fail if the renderer tables diverge. */
		function screenPointAt(frame, vertex) {
			const point = frame[vertex];
			if (point === void 0) throw new RangeError(`Aura vertex ${vertex} is absent from the display frame`);
			return point;
		}
		/** Compact numeric rendering for disclosed Aura coefficients. */
		function coefficient(value) {
			return value.toFixed(4);
		}
		/** Human-readable local time for a recent content-free record. */
		function recordTime(value) {
			return new Date(value).toLocaleTimeString([], {
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit"
			});
		}
		/** Resolve the reduced-motion media query when the host implements it. */
		function reducedMotionMedia() {
			if (typeof window === "undefined") return void 0;
			return window.matchMedia?.call(window, "(prefers-reduced-motion: reduce)");
		}
		/** Track the operating-system motion preference for both coefficient and view animation. */
		function useReducedMotion() {
			const [reduced, setReduced] = (0, react.useState)(() => reducedMotionMedia()?.matches ?? false);
			(0, react.useEffect)(() => {
				const media = reducedMotionMedia();
				if (media === void 0) return;
				const update = () => {
					setReduced(media.matches);
				};
				update();
				media.addEventListener("change", update);
				return () => {
					media.removeEventListener("change", update);
				};
			}, []);
			return reduced;
		}
		/** Track whether the document may present continuous coefficient motion. */
		function useDocumentVisible() {
			const [visible, setVisible] = (0, react.useState)(() => document.visibilityState !== "hidden");
			(0, react.useEffect)(() => {
				const update = () => {
					setVisible(document.visibilityState !== "hidden");
				};
				document.addEventListener("visibilitychange", update);
				return () => {
					document.removeEventListener("visibilitychange", update);
				};
			}, []);
			return visible;
		}
		/** Advance only active, visible presentation time and stop cleanly on stagnant test clocks. */
		function usePresentationTime(active, reducedMotion) {
			const [elapsed, setElapsed] = (0, react.useState)(0);
			const elapsedRef = (0, react.useRef)(0);
			(0, react.useEffect)(() => {
				if (!active || reducedMotion || typeof window.requestAnimationFrame !== "function") return;
				let frame = 0;
				let previousTimestamp = null;
				let publishedAt = 0;
				const resetTimestamp = () => {
					previousTimestamp = null;
				};
				const draw = (timestamp) => {
					if (previousTimestamp === null) {
						previousTimestamp = timestamp;
						publishedAt = timestamp;
						frame = window.requestAnimationFrame(draw);
						return;
					}
					if (timestamp <= previousTimestamp) {
						frame = window.requestAnimationFrame(draw);
						return;
					}
					const delta = Math.min(100, timestamp - previousTimestamp);
					previousTimestamp = timestamp;
					if (document.visibilityState !== "hidden") elapsedRef.current += delta;
					if (timestamp - publishedAt >= PRESENTATION_FRAME_INTERVAL_MS) {
						publishedAt = timestamp;
						setElapsed(elapsedRef.current);
					}
					frame = window.requestAnimationFrame(draw);
				};
				document.addEventListener("visibilitychange", resetTimestamp);
				frame = window.requestAnimationFrame(draw);
				return () => {
					document.removeEventListener("visibilitychange", resetTimestamp);
					window.cancelAnimationFrame(frame);
				};
			}, [active, reducedMotion]);
			return reducedMotion ? 0 : elapsed;
		}
		/** Animated viewing layer shared by the current geometry and its zero-state reference. */
		function AuraFigure({ active, angles, field, reducedMotion, svgPrefix, t }) {
			const elapsed = usePresentationTime(active, reducedMotion);
			const presentation = (0, react.useMemo)(() => auraPresentationAt(elapsed, [
				angles[3],
				angles[4],
				angles[5]
			], reducedMotion), [
				angles,
				elapsed,
				reducedMotion
			]);
			const displayFrame = (0, react.useMemo)(() => cameraFrame(figureFrame({
				vertices: deformTesseract(angles),
				orientation: presentation.orientation,
				distance: PRESENTATION_PROJECTION_DISTANCE
			}), presentation.scale), [
				angles,
				presentation.orientation,
				presentation.scale
			]);
			const referenceFrame = (0, react.useMemo)(() => cameraFrame(figureFrame({
				vertices: deformTesseract(ZERO_COEFFICIENTS),
				orientation: presentation.orientation,
				distance: PRESENTATION_PROJECTION_DISTANCE
			}), presentation.scale), [presentation.orientation, presentation.scale]);
			const displayFaces = (0, react.useMemo)(() => TESSERACT_FACES.map((face, faceIndex) => {
				const points = face.vertices.map((vertex) => screenPointAt(displayFrame, vertex));
				return {
					depth: points.reduce((sum, point) => sum + point[2], 0) / points.length,
					faceIndex,
					planeIndex: face.planeIndex,
					points: points.map((point) => `${point[0]},${point[1]}`).join(" ")
				};
			}).sort((left, right) => left.depth - right.depth || left.faceIndex - right.faceIndex), [displayFrame]);
			const visualStyle = {
				"--aura-activity": presentation.activity.toFixed(4),
				"--aura-presence-scale": presentation.scale.toFixed(5)
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: AuraCoherenceSurface_module_css_default.figureStage,
				"data-aura-breathing": presentation.activity > .01 ? "true" : "false",
				"data-aura-presentation-scale": presentation.scale.toFixed(5),
				style: visualStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: AuraCoherenceSurface_module_css_default.presenceHalo,
						"aria-hidden": "true"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
						className: AuraCoherenceSurface_module_css_default.tesseract,
						viewBox: "0 0 440 440",
						role: "img",
						"aria-labelledby": `${svgPrefix}-title ${svgPrefix}-description`,
						focusable: "false",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("title", {
								id: `${svgPrefix}-title`,
								children: t("aura.figure.title")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("desc", {
								id: `${svgPrefix}-description`,
								children: t("aura.figure.description")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("defs", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("linearGradient", {
									id: `${svgPrefix}-edge`,
									x1: "0",
									y1: "0",
									x2: "1",
									y2: "1",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("stop", {
											offset: "0",
											stopColor: "var(--aura-green)"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("stop", {
											offset: "0.34",
											stopColor: "var(--aura-blue-bright)"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("stop", {
											offset: "0.68",
											stopColor: "var(--aura-purple-bright)"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("stop", {
											offset: "1",
											stopColor: "var(--aura-gold-bright)"
										})
									]
								}),
								FACE_TONES.map(({ from, to }, planeIndex) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("linearGradient", {
									id: `${svgPrefix}-face-${planeIndex}`,
									x1: "0",
									y1: "0",
									x2: "1",
									y2: "1",
									"data-aura-plane-gradient": planeIndex,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("stop", {
											offset: "0",
											stopColor: from,
											stopOpacity: "0.98"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("stop", {
											offset: "0.52",
											stopColor: to,
											stopOpacity: "0.9"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("stop", {
											offset: "1",
											stopColor: from,
											stopOpacity: "0.78"
										})
									]
								}, planeIndex)),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("filter", {
									id: `${svgPrefix}-glow`,
									x: "-50%",
									y: "-50%",
									width: "200%",
									height: "200%",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("feGaussianBlur", {
										stdDeviation: "3.4",
										result: "blur"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("feMerge", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("feMergeNode", { in: "blur" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("feMergeNode", { in: "SourceGraphic" })] })]
								})
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("g", {
								className: AuraCoherenceSurface_module_css_default.referenceLayer,
								"aria-hidden": "true",
								children: TESSERACT_EDGES.map(([from, to], index) => {
									const a = referenceFrame[from];
									const b = referenceFrame[to];
									if (a === void 0 || b === void 0) return null;
									return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
										x1: a[0],
										y1: a[1],
										x2: b[0],
										y2: b[1],
										"data-aura-reference-edge": index
									}, `${from}-${to}`);
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("g", {
								className: AuraCoherenceSurface_module_css_default.currentLayer,
								children: [
									displayFaces.map((face) => {
										const amplitude = Math.abs(angles[face.planeIndex] ?? 0);
										const depthLight = Math.max(0, Math.min(1, (face.depth + 2.4) / 4.8));
										const tone = FACE_TONES[face.planeIndex]?.tone ?? "unknown";
										const faceOpacity = Math.min(.42, .12 + amplitude * .16 + depthLight * .14);
										return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("polygon", {
											points: face.points,
											fill: `url(#${svgPrefix}-face-${face.planeIndex})`,
											fillOpacity: faceOpacity,
											strokeOpacity: Math.min(.72, .34 + amplitude * .2 + depthLight * .18),
											"data-aura-face": face.faceIndex,
											"data-plane": face.planeIndex,
											"data-plane-tone": tone,
											"data-polarity": (angles[face.planeIndex] ?? 0) < 0 ? "negative" : "positive"
										}, face.faceIndex);
									}),
									TESSERACT_EDGES.map(([from, to], index) => {
										const a = displayFrame[from];
										const b = displayFrame[to];
										if (a === void 0 || b === void 0) return null;
										const depth = (a[2] + b[2]) / 2;
										return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
											x1: a[0],
											y1: a[1],
											x2: b[0],
											y2: b[1],
											opacity: Math.max(.52, Math.min(.94, .72 + depth * .08)),
											stroke: `url(#${svgPrefix}-edge)`,
											strokeWidth: Math.max(1.2, Math.min(2, 1.5 + depth * .13)),
											"data-aura-edge": index
										}, `${from}-${to}`);
									}),
									displayFrame.map(([x, y, z], index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
										cx: x,
										cy: y,
										r: Math.max(2.8, Math.min(5.2, 3.8 + z * .2)),
										opacity: Math.max(.68, Math.min(1, .84 + z * .06)),
										filter: `url(#${svgPrefix}-glow)`,
										"data-aura-vertex": index,
										"data-polarity": (field[index] ?? 0) < 0 ? "negative" : "positive"
									}, index))
								]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: AuraCoherenceSurface_module_css_default.figureKey,
						"aria-label": t("aura.figure.key.label"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							"data-layer": "current",
							children: t("aura.figure.key.current")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							"data-layer": "reference",
							children: t("aura.figure.key.reference")
						})]
					})
				]
			});
		}
		/** One portal-style disclosure row. */
		function Portal({ title, summary, children }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
				className: AuraCoherenceSurface_module_css_default.portal,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: title }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: summary })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: AuraCoherenceSurface_module_css_default.portalBody,
					children
				})]
			});
		}
		/**
		* Render Aura's life-state projection and its underlying record portals.
		* @param props - shell visibility, close action, and global session feed.
		* @returns the always-mounted Aura Coherence surface.
		*/
		function AuraCoherenceSurface(props) {
			const { activeSurface, closeSurface, t, useSessions, useSessionPendingInteraction } = props;
			const active = activeSurface === "aura-coherence";
			const sessions = useSessions((state) => state);
			const currentSessionId = sessions.current;
			const currentSession = currentSessionId === void 0 ? void 0 : sessions.byId[currentSessionId];
			const currentTitle = currentSession?.displayTitle;
			const currentProjection = currentSession?.projectionValues?.auraCoherence;
			const entries = (0, react.useMemo)(() => sessions.ids.map((id) => {
				const session = sessions.byId[id];
				const sessionProjection = session?.projectionValues?.auraCoherence;
				return {
					id,
					title: session?.displayTitle ?? id,
					...sessionProjection === void 0 ? {} : { projection: sessionProjection }
				};
			}), [sessions.byId, sessions.ids]);
			const lastProjectionRef = (0, react.useRef)(null);
			const projection = (0, react.useMemo)(() => {
				if (!active && lastProjectionRef.current !== null) return lastProjectionRef.current;
				const next = aggregateAuraCoherence(entries);
				lastProjectionRef.current = next;
				return next;
			}, [active, entries]);
			const activityHeads = (0, react.useMemo)(() => auraActivityHeadsOf(entries), [entries]);
			const pendingInteractions = useSessionPendingInteraction((state) => state);
			const pending = sessions.ids.some((id) => pendingInteractions.get(id) !== void 0);
			const svgPrefix = (0, react.useId)().replace(/:/g, "");
			const standing = (0, react.useMemo)(() => systemStandingOf(projection), [projection]);
			const ternary = (0, react.useMemo)(() => auraTernaryOf(projection.channelSources.persistent), [projection]);
			const reducedMotion = useReducedMotion();
			const documentVisible = useDocumentVisible();
			const [motion, setMotion] = (0, react.useState)(() => ({
				standing: [...standing],
				breath: [...REST]
			}));
			const motionRef = (0, react.useRef)(motion);
			const breathMotionRef = (0, react.useRef)({
				drive: [...REST],
				value: [...REST]
			});
			const activityBaselinesRef = (0, react.useRef)(/* @__PURE__ */ new Map());
			const coefficientTimeRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				const activityAdvance = advanceAuraActivity(activityBaselinesRef.current, activityHeads);
				activityBaselinesRef.current = activityAdvance.baselines;
				const targetStanding = [...standing];
				const publish = (next) => {
					motionRef.current = next;
					setMotion(next);
				};
				let breathMotion = {
					drive: [...breathMotionRef.current.drive],
					value: [...motionRef.current.breath]
				};
				let current = {
					standing: [...motionRef.current.standing],
					breath: [...breathMotion.value]
				};
				const advanceSteps = (steps) => {
					for (let step = 0; step < steps; step += 1) {
						breathMotion = stepAuraBreath(breathMotion);
						current = {
							standing: approachAuraTriad(current.standing, targetStanding),
							breath: [...breathMotion.value]
						};
						if (sameAuraTriad(current.standing, targetStanding) && auraBreathAtRest(breathMotion)) break;
					}
				};
				const now = performance.now();
				const previousTime = coefficientTimeRef.current ?? now;
				const elapsedBeforeEffect = Math.max(0, now - previousTime);
				const catchupSteps = Math.min(500, Math.floor(elapsedBeforeEffect / COEFFICIENT_FRAME_INTERVAL_MS));
				advanceSteps(catchupSteps);
				coefficientTimeRef.current = catchupSteps === 500 ? now : previousTime + catchupSteps * COEFFICIENT_FRAME_INTERVAL_MS;
				breathMotion = exciteAuraBreath(breathMotion, activityAdvance.impulse);
				breathMotionRef.current = breathMotion;
				current = {
					...current,
					breath: [...breathMotion.value]
				};
				if (!(active && documentVisible && !reducedMotion)) {
					current = {
						...current,
						standing: targetStanding
					};
					if (!sameAuraTriad(motionRef.current.standing, current.standing) || !sameAuraTriad(motionRef.current.breath, current.breath)) publish(current);
					return;
				}
				if (sameAuraTriad(current.standing, targetStanding) && auraBreathAtRest(breathMotion)) {
					if (!sameAuraTriad(motionRef.current.standing, current.standing) || !sameAuraTriad(motionRef.current.breath, current.breath)) publish(current);
					return;
				}
				let animationFrame = null;
				let timeout = null;
				const hasAnimationFrame = typeof window.requestAnimationFrame === "function";
				function schedule() {
					if (hasAnimationFrame) animationFrame = window.requestAnimationFrame(draw);
					else timeout = window.setTimeout(() => {
						draw(performance.now());
					}, COEFFICIENT_FRAME_INTERVAL_MS);
				}
				function draw(timestamp) {
					const lastTime = coefficientTimeRef.current ?? timestamp;
					if (timestamp <= lastTime) {
						schedule();
						return;
					}
					const steps = Math.min(500, Math.floor((timestamp - lastTime) / COEFFICIENT_FRAME_INTERVAL_MS));
					if (steps > 0) {
						advanceSteps(steps);
						coefficientTimeRef.current = steps === 500 ? timestamp : lastTime + steps * COEFFICIENT_FRAME_INTERVAL_MS;
						breathMotionRef.current = breathMotion;
						publish(current);
						if (sameAuraTriad(current.standing, targetStanding) && auraBreathAtRest(breathMotion)) return;
					}
					schedule();
				}
				schedule();
				return () => {
					if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
					if (timeout !== null) window.clearTimeout(timeout);
				};
			}, [
				active,
				activityHeads,
				documentVisible,
				reducedMotion,
				standing[0],
				standing[1],
				standing[2]
			]);
			const close = (0, react.useCallback)(() => {
				closeSurface();
			}, [closeSurface]);
			(0, react.useEffect)(() => {
				if (!active) return;
				const onKeyDown = (event) => {
					if (event.key !== "Escape" || event.defaultPrevented) return;
					if (isEditableTarget(event.target)) return;
					event.preventDefault();
					close();
				};
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [active, close]);
			const angles = (0, react.useMemo)(() => [...motion.standing, ...motion.breath], [motion.breath, motion.standing]);
			const auraFrame = (0, react.useMemo)(() => figureFrame({ vertices: deformTesseract(angles) }), [angles]);
			const digest = (0, react.useMemo)(() => frameDigest(auraFrame), [auraFrame]);
			const field = (0, react.useMemo)(() => synth6(angles), [angles]);
			const approvals = projection.approvals;
			const counts = projection.counts;
			const refusalTotal = approvals.rejected + approvals.unavailable;
			const changing = !sameAuraTriad(motion.standing, standing) || !sameAuraTriad(motion.breath, [...REST]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
				className: AuraCoherenceSurface_module_css_default.surface,
				hidden: !active,
				"data-aura-coherence-surface": true,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: AuraCoherenceSurface_module_css_default.section,
					"aria-labelledby": "aura-coherence-title",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
							className: AuraCoherenceSurface_module_css_default.heading,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: AuraCoherenceSurface_module_css_default.titleBlock,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
									id: "aura-coherence-title",
									children: t("aura.trigger")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("aura.subtitle") })]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: AuraCoherenceSurface_module_css_default.liveState,
								"data-state": projection.projectedSessions === 0 ? "absent" : pending ? "waiting" : changing ? "moving" : "rest",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {}), projection.projectedSessions === 0 ? t("aura.status.noRecord") : pending ? t("aura.status.awaiting") : changing ? t("aura.status.moving") : t("aura.status.rest")]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AuraFigure, {
							active,
							angles,
							field,
							reducedMotion,
							svgPrefix,
							t
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: AuraCoherenceSurface_module_css_default.channels,
							"aria-labelledby": `${svgPrefix}-channels`,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								id: `${svgPrefix}-channels`,
								children: t("aura.channels.title")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("aura.channels.note") })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: AuraCoherenceSurface_module_css_default.channelGrid,
								children: AURA_COEFFICIENT_PROVENANCE.map((channel, index) => {
									const value = angles[index] ?? 0;
									const formattedValue = `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
									const text = CHANNEL_TEXT[channel.channel];
									const lifetime = t(channel.lifetime === "persistent" ? "aura.channel.lifetime.persistent" : "aura.channel.lifetime.transient");
									const meterText = t("aura.channel.value", {
										label: t(text.label),
										lifetime,
										value: formattedValue
									});
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: AuraCoherenceSurface_module_css_default.channel,
										"data-aura-channel": channel.channel,
										"data-lifetime": channel.lifetime,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: AuraCoherenceSurface_module_css_default.channelHeading,
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: AuraCoherenceSurface_module_css_default.plane,
														children: channel.plane
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t(text.label) }),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("output", { children: formattedValue })
												]
											}),
											channel.signed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: AuraCoherenceSurface_module_css_default.bipolarMeter,
												role: "meter",
												"aria-valuemin": -1,
												"aria-valuemax": 1,
												"aria-valuenow": value,
												"aria-label": t(text.label),
												"aria-valuetext": meterText,
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: AuraCoherenceSurface_module_css_default.bipolarFill,
													"data-direction": value < 0 ? "negative" : "positive",
													style: { width: `${Math.abs(value) * 50}%` },
													"aria-hidden": "true"
												})
											}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("progress", {
												max: "1",
												value: Math.abs(value),
												"aria-label": t(text.label),
												"aria-valuetext": meterText
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t(text.source) })
										]
									}, channel.plane);
								})
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: AuraCoherenceSurface_module_css_default.channels,
							"aria-labelledby": `${svgPrefix}-ternary`,
							"data-aura-ternary": true,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									id: `${svgPrefix}-ternary`,
									children: t("aura.ternary.title")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("aura.ternary.note") })] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									"data-aura-ternary-readout": true,
									children: t("aura.ternary.readout", {
										coordinate: ternary.trits.map((value) => value === null ? "?" : String(value)).join(", "),
										index: ternary.index === null ? t("aura.ternary.unknown") : String(ternary.index)
									})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("aura.ternary.values", { values: ternary.values.map((value) => value.toFixed(4)).join(", ") }) }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: AuraCoherenceSurface_module_css_default.ternarySlices,
									children: AURA_TRITS.map((history) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("aura.ternary.slice", { value: history }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ol", {
										className: AuraCoherenceSurface_module_css_default.ternaryGrid,
										children: AURA_TRITS.flatMap((tool) => AURA_TRITS.map((approval) => {
											const index = auraCellIndex([
												history,
												tool,
												approval
											]);
											return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
												"data-aura-cell": index,
												"aria-current": ternary.index === index ? "true" : void 0,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: index }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [
													history,
													", ",
													tool,
													", ",
													approval
												] })]
											}, index);
										}))
									})] }, history))
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("aura.ternary.bins") })
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: AuraCoherenceSurface_module_css_default.truthLine,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("aura.coverage.label") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("aura.coverage.summary", {
									projected: projection.projectedSessions,
									sessions: projection.sessions
								}) })] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: projection.projectedSessions === 0 ? t("aura.coverage.waiting") : approvals.asked === 0 ? t("aura.coverage.none", { interactions: counts.interactions }) : approvals.asked === 1 ? t("aura.coverage.one", { interactions: counts.interactions }) : t("aura.coverage.many", {
									approvals: approvals.asked,
									interactions: counts.interactions
								}) }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("aura.provenance.label") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: projection.lastTime === null ? t("aura.provenance.none") : t("aura.provenance.value", {
									fingerprint: projection.recordFingerprint,
									time: recordTime(projection.lastTime)
								}) })] })
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: AuraCoherenceSurface_module_css_default.portals,
							"aria-label": t("aura.portals.label"),
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Portal, {
									title: t("aura.interaction.title"),
									summary: t("aura.interaction.summary", { records: counts.records }),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
										className: AuraCoherenceSurface_module_css_default.values,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("aura.interaction.observed") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: counts.interactions })] }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("aura.interaction.fingerprint") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: projection.recordFingerprint })] }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("aura.interaction.adapter") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: t("aura.interaction.adapterValue") })] })
										]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ol", {
										className: AuraCoherenceSurface_module_css_default.recent,
										children: projection.recent.map((record) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
											"data-kind": record.kind,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
												record.sessionTitle,
												" · ",
												record.label
											] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("time", {
												dateTime: new Date(record.time).toISOString(),
												children: recordTime(record.time)
											})]
										}, `${record.sessionId}:${record.seq}`))
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Portal, {
									title: t("aura.message.title"),
									summary: t("aura.message.summary", {
										assistant: counts.assistantMessages,
										human: counts.humanMessages
									}),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
										className: AuraCoherenceSurface_module_css_default.values,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("aura.message.human") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: counts.humanMessages })] }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("aura.message.assistant") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: counts.assistantMessages })] }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("aura.message.context") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: counts.contextMessages })] }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("aura.message.turns") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: counts.turns })] })
										]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("aura.message.note") })]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Portal, {
									title: t("aura.action.title"),
									summary: t("aura.action.summary", {
										failed: counts.toolErrors,
										requested: counts.toolCalls
									}),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
										className: AuraCoherenceSurface_module_css_default.values,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("aura.action.requests") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: counts.toolCalls })] }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("aura.action.results") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: counts.toolResults })] }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("aura.action.failures") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: counts.toolErrors })] }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("aura.action.standing") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: coefficient(motion.standing[1]) })] })
										]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("aura.action.note") })]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Portal, {
									title: t("aura.approval.title"),
									summary: t("aura.approval.summary", {
										allowed: approvals.allowed,
										refused: refusalTotal
									}),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
										className: AuraCoherenceSurface_module_css_default.values,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("aura.approval.asked") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: approvals.asked })] }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("aura.approval.allowed") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: approvals.allowed })] }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("aura.approval.rejected") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: approvals.rejected })] }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("aura.approval.unavailable") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: approvals.unavailable })] }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("aura.approval.cancelled") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: approvals.cancelled })] }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("aura.approval.standing") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: coefficient(motion.standing[2]) })] })
										]
									})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Portal, {
									title: t("aura.confinement.title"),
									summary: currentProjection?.confinement.preset ?? t("aura.confinement.default"),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
										className: AuraCoherenceSurface_module_css_default.values,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("aura.confinement.thread") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: currentTitle ?? t("aura.confinement.none") })] }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("aura.confinement.permission") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: currentProjection?.confinement.preset ?? t("aura.confinement.notOverridden") })] }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("aura.confinement.sandbox") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: currentProjection?.confinement.sandbox ?? t("aura.confinement.notOverridden") })] }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("aura.confinement.approval") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: currentProjection?.confinement.approval ?? t("aura.confinement.notOverridden") })] })
										]
									})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Portal, {
									title: t("aura.field.title"),
									summary: t("aura.field.summary"),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
										className: AuraCoherenceSurface_module_css_default.values,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("aura.field.standing") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: motion.standing.map(coefficient).join(" · ") })] }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("aura.field.breath") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: motion.breath.map(coefficient).join(" · ") })] }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("aura.field.digest") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: digest })] }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("aura.field.walsh") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: field.map((value) => value.toFixed(3)).join(" ") })] }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("aura.field.identity") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
												className: AuraCoherenceSurface_module_css_default.unavailable,
												children: t("aura.field.notMounted")
											})] }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("aura.field.receipts") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
												className: AuraCoherenceSurface_module_css_default.unavailable,
												children: t("aura.field.notMounted")
											})] }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("aura.field.anchor") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
												className: AuraCoherenceSurface_module_css_default.unavailable,
												children: t("aura.field.notMounted")
											})] }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("aura.field.order") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
												className: AuraCoherenceSurface_module_css_default.unavailable,
												children: t("aura.field.notClaimed")
											})] })
										]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("aura.field.note") })]
								})
							]
						})
					]
				})
			});
		}
		//#endregion
		//#region src/client/SettingsRoot.tsx
		/**
		* Inline settings surface. The shell keeps every surface mounted and supplies
		* its active id plus the section selected from the System menu.
		*/
		/** Render the selected settings section across the complete center pane. */
		function SettingsSurfaceContent({ renderSlot, section, onClose }) {
			const titleId = (0, react.useId)();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: SettingsRoot_module_css_default.panel,
				role: "dialog",
				"aria-labelledby": titleId,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: SettingsRoot_module_css_default.content,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: SettingsRoot_module_css_default.header,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: SettingsRoot_module_css_default.title,
								id: titleId,
								children: renderSlot("settings.header", {})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: SettingsRoot_module_css_default.actions,
								children: renderSlot("settings.action", {})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: SettingsRoot_module_css_default.close,
								onClick: onClose,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseOutline16, { size: 14 }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: SettingsRoot_module_css_default.hiddenLabel,
									children: renderSlot("settings.close", {})
								})]
							})
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: SettingsRoot_module_css_default.options,
						children: section !== void 0 && renderSlot("settings.section", { close: onClose }, { only: section.id })
					})]
				})
			});
		}
		/**
		* Render the always-mounted settings surface.
		* @param props - composed shell-surface props.
		* @returns the settings surface element tree.
		*/
		function SettingsRoot(props) {
			const { activeSurface, surfaceTarget, closeSurface, useSections, renderSlot } = props;
			const active = activeSurface === "settings";
			const close = (0, react.useCallback)(() => {
				closeSurface();
			}, [closeSurface]);
			(0, react.useEffect)(() => {
				if (!active) return;
				const onKeyDown = (event) => {
					if (event.key !== "Escape" || event.defaultPrevented) return;
					if (isEditableTarget(event.target)) return;
					event.preventDefault();
					close();
				};
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [active, close]);
			const rows = useSections((snapshot) => snapshot);
			const section = rows.find((row) => row.id === surfaceTarget) ?? rows[0];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
				className: SettingsRoot_module_css_default.surface,
				hidden: !active,
				"data-settings-surface": true,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SettingsSurfaceContent, {
					renderSlot,
					section,
					onClose: close
				})
			});
		}
		//#endregion
		//#region src/client/SettingsMenu.tsx
		/** Settings-section entries in the shell's right-side System menu. */
		/**
		* Render every registered settings section as a direct System-menu row.
		* @param props - composed system-menu props.
		* @returns the settings section menu buttons.
		*/
		function SettingsMenu({ activeSurface, surfaceTarget, openSurface, useSections }) {
			const rows = useSections((snapshot) => snapshot);
			const selected = rows.find((row) => row.id === surfaceTarget) ?? rows[0];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: rows.map((row) => {
				const active = activeSurface === "settings" && row.id === selected?.id;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: clsx(SettingsRoot_module_css_default.menuItem, active && SettingsRoot_module_css_default.menuItemActive),
					"aria-current": active ? "page" : void 0,
					"aria-label": row.label,
					onClick: () => {
						openSurface("settings", row.id);
					},
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: SettingsRoot_module_css_default.systemMenuCopy,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: row.label })
					})
				}, row.id);
			}) });
		}
		//#endregion
		//#region src/client/SettingsOnboarding.tsx
		/** Always-mounted coordinator for feature-owned settings onboarding steps. */
		/**
		* Mount the first incomplete onboarding step while the blank-session hero is
		* active. Visible chrome and readiness remain owned by the selected step.
		*
		* Every step completes itself once it decides not to appear, so no selected
		* step means onboarding can no longer take the application root inert.
		* `data-onboarding` reports that difference because the rendered tree hides it:
		* a step still resolving its durable state renders nothing, exactly like a step
		* that will never appear.
		*
		* `settled` additionally requires the session phase to have decided the hero,
		* because no step can be selected before it and the resulting quiet would
		* otherwise be reported as the end of onboarding rather than its start.
		*
		* `data-onboarding-blocker` names which of those two conditions is unmet.
		* Both render nothing, so a reader of the tree cannot tell an undecided
		* session phase from a selected step that is still resolving its durable
		* state, and the two are opposite defects: the first is a session that never
		* became ready, the second a step that never completed. The attribute is the
		* only place that difference is observable.
		* @param props - composed shell-overlay props.
		* @returns the onboarding-state marker beside the selected contribution.
		*/
		function SettingsOnboarding(props) {
			const { useOnboardingSteps, useSessions, renderSlot, openSection } = props;
			const [completed, setCompleted] = (0, react.useState)(() => /* @__PURE__ */ new Set());
			const steps = useOnboardingSteps((snapshot) => snapshot);
			const hero = useSessions((state) => {
				if (state.phase !== "ready") return "undecided";
				return state.current === void 0 || state.byId[state.current]?.blank === true ? "active" : "inactive";
			});
			const active = hero === "active";
			const step = active ? steps.find((entry) => !completed.has(entry.id)) : void 0;
			(0, react.useEffect)(() => {
				if (active) return;
				setCompleted(/* @__PURE__ */ new Set());
			}, [active]);
			const complete = (0, react.useCallback)((id) => {
				setCompleted((previous) => {
					if (previous.has(id)) return previous;
					return new Set([...previous, id]);
				});
			}, []);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				hidden: true,
				"data-onboarding": hero !== "undecided" && step === void 0 ? "settled" : "pending",
				"data-onboarding-blocker": hero === "undecided" ? "session-phase-undecided" : step === void 0 ? "none" : `step:${step.id}`
			}), step === void 0 ? null : renderSlot("settings.onboarding", {
				stepId: step.id,
				complete: () => {
					complete(step.id);
				},
				openSection
			}, { only: step.id })] });
		}
		//#endregion
		//#region src/client/chrome.tsx
		/**
		* Render the panel title text.
		* @param props - composed slot props.
		* @returns the title text node.
		*/
		function HeaderContent({ t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: t("title") });
		}
		/**
		* Render the close button's visually-hidden label text.
		* @param props - composed slot props.
		* @returns the label text node.
		*/
		function CloseLabel({ t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: t("close") });
		}
		//#endregion
		//#region \0dsh-css:GeneralSection.module.css.mjs
		const css$1 = ".oimqbW_section{flex-direction:column;width:100%;display:flex}.oimqbW_section>[data-slot=\"settings.general.item\"]>:last-child{border-bottom:none}";
		const tagId$1 = "@aukora/face-settings/GeneralSection.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@aukora/face-settings";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var GeneralSection_module_css_default = { "section": "oimqbW_section" };
		//#endregion
		//#region src/client/GeneralSection.tsx
		/**
		* Render the General section content column.
		* @param props - composed slot props (contract/slots.ts).
		* @returns the section element tree.
		*/
		function GeneralSection({ renderSlot }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: GeneralSection_module_css_default.section,
				children: renderSlot("settings.general.item", {})
			});
		}
		//#endregion
		//#region \0dsh-css:SettingsDocumentAction.module.css.mjs
		const css = ".qQFYrW_action{align-items:center;gap:8px;min-width:0;display:flex}.qQFYrW_openButton{white-space:nowrap;flex:none}.qQFYrW_openLabel{white-space:nowrap}.qQFYrW_error{max-width:180px;color:var(--dsw-alias-state-error-primary);text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px;overflow:hidden}@container (width<=440px){.qQFYrW_openButton{width:28px;padding:0}.qQFYrW_openLabel{clip:rect(0 0 0 0);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}}";
		const tagId = "@aukora/face-settings/SettingsDocumentAction.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@aukora/face-settings";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var SettingsDocumentAction_module_css_default = {
			"action": "qQFYrW_action",
			"error": "qQFYrW_error",
			"openButton": "qQFYrW_openButton",
			"openLabel": "qQFYrW_openLabel"
		};
		//#endregion
		//#region src/client/SettingsDocumentAction.tsx
		/** Optional settings-header action for opening a file-backed Host document. */
		/**
		* Render the open-document action only after Host metadata confirms document availability.
		* @param props - header owner props, localized copy, and injected document state.
		* @returns the action, or null while unavailable or unresolved.
		*/
		function SettingsDocumentAction({ controller, useSnapshot, t }) {
			const state = useSnapshot((snapshot) => snapshot);
			(0, react.useEffect)(() => {
				controller.load();
			}, [controller]);
			if (state.status !== "ready") return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: SettingsDocumentAction_module_css_default.action,
				children: [state.error === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: SettingsDocumentAction_module_css_default.error,
					role: "alert",
					children: t("openDocument.error")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					"aria-label": t("openDocument"),
					title: t("openDocument"),
					variant: "outline",
					size: "sm",
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderOpenOutline16, { size: 14 }),
					className: SettingsDocumentAction_module_css_default.openButton,
					disabled: state.opening,
					onClick: () => {
						controller.open();
					},
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: SettingsDocumentAction_module_css_default.openLabel,
						children: t("openDocument")
					})
				})]
			});
		}
		//#endregion
		//#region src/client/settings-document-store.ts
		/** Derives local-document availability from the shared mirror and invokes the pathless Host-owned open operation. */
		var SettingsDocumentStore = class {
			ctx;
			describeFace;
			/** uSES-safe state source shared by the registered header action. */
			store = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)({
				status: "idle",
				opening: false,
				error: null
			});
			following;
			/**
			* @param ctx - the plugin's context, whose loopback `remote.settings`
			* namespace opens the provider document.
			* @param describeFace - the shared mirror's describe face (`hasDocument` source).
			*/
			constructor(ctx, describeFace) {
				this.ctx = ctx;
				this.describeFace = describeFace;
			}
			/**
			* Begin following the mirror (idempotent) and reflect whether the current
			* provider owns a local document.
			* @returns settlement once the snapshot reflects the mirror.
			*/
			async load() {
				this.following ??= this.describeFace.subscribe(() => {
					this.derive();
				});
				this.store.update((state) => {
					state.status = "loading";
					state.error = null;
				});
				await this.describeFace.ensure();
				this.derive();
			}
			/**
			* Open the loaded document once; concurrent gestures collapse behind the in-flight action.
			* @returns after the native-open request settles, or immediately when unavailable/already opening.
			*/
			async open() {
				const current = this.store.getSnapshot();
				if (current.status !== "ready" || current.opening) return;
				this.store.update((state) => {
					state.opening = true;
					state.error = null;
				});
				try {
					const result = await this.ctx.remote.settings.openSettingsDocument();
					if (!result.ok) {
						const { message } = result.error;
						this.store.update((state) => {
							state.error = message;
						});
					}
				} finally {
					this.store.update((state) => {
						state.opening = false;
					});
				}
			}
			/** Stop following the mirror. */
			dispose() {
				this.following?.();
				this.following = void 0;
			}
			derive() {
				const mirrored = this.describeFace.getSnapshot();
				if (mirrored.view === void 0) {
					if (mirrored.error !== null) this.store.update((state) => {
						state.status = "unavailable";
						state.error = mirrored.error;
					});
					return;
				}
				const { hasDocument } = mirrored.view;
				this.store.update((state) => {
					state.status = hasDocument ? "ready" : "unavailable";
					state.error = null;
				});
			}
		};
		//#endregion
		//#region src/client/locales.ts
		/** Shell chrome and General-nav dictionaries; feature rows own their copy. */
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"title": "设置",
			"close": "关闭",
			"openDocument": "打开配置文件",
			"openDocument.error": "无法打开配置文件",
			"general.nav": "通用设置",
			"general.menuDescription": "语言、外观与默认选项",
			"aura.trigger": "Aura Coherence",
			"aura.menu": "系统生命状态",
			"aura.subtitle": "系统生命状态",
			"aura.status.noRecord": "无记录",
			"aura.status.awaiting": "等待决定",
			"aura.status.moving": "形变中",
			"aura.status.rest": "静止",
			"aura.figure.title": "Aura 六平面超立方体生命状态投影",
			"aura.figure.description": "六个日志系数通过 Walsh 场确定性地移动十六个四维顶点。当前形态与零系数基准共享缓慢旋转；静止微动仅用于呈现，新增日志活动则驱动瞬态呼吸。",
			"aura.figure.key.label": "Aura 几何图例",
			"aura.figure.key.current": "当前数据形态",
			"aura.figure.key.reference": "零系数基准",
			"aura.channels.title": "形变输入",
			"aura.ternary.title": "27 状态 · 持久系数的三进制视图",
			"aura.ternary.note": "三个轴各分三档，共 27 个坐标。此只读、有损视图与十六顶点超立方体使用相同日志输入；它不是身份、信任评分或三进制推理引擎。",
			"aura.ternary.readout": "历史、工具、审批：({coordinate}) · 索引 {index} / 0–26",
			"aura.ternary.unknown": "未知",
			"aura.ternary.values": "原始持久系数：({values})",
			"aura.ternary.slice": "历史 = {value}；行 = 工具，列 = 审批",
			"aura.ternary.bins": "历史和审批：低于 −1/3 → −1，−1/3 至 +1/3（含边界）→ 0，高于 +1/3 → +1。工具先按 2x−1 归一化。缺少交互、工具请求或审批覆盖时显示 ?，不选择坐标。索引 = 9(h+1)+3(t+1)+(a+1)。",
			"aura.channels.note": "每个系数都来自明确的持久化日志计数；即时活动随后衰减为零。",
			"aura.channel.historyPhase.label": "历史相位",
			"aura.channel.historyPhase.source": "交互计数 × 黄金相位 · 持久",
			"aura.channel.toolHealth.label": "工具健康度",
			"aura.channel.toolHealth.source": "成功结果 / 工具请求 · 持久",
			"aura.channel.approvalPosture.label": "审批姿态",
			"aura.channel.approvalPosture.source": "允许减拒绝 / 覆盖决定 · 持久",
			"aura.channel.humanActivity.label": "用户活动",
			"aura.channel.humanActivity.source": "新增用户消息 · 衰减",
			"aura.channel.assistantActivity.label": "助手活动",
			"aura.channel.assistantActivity.source": "新增助手消息 · 衰减",
			"aura.channel.toolActivity.label": "工具活动",
			"aura.channel.toolActivity.source": "新增工具调用与结果 · 衰减",
			"aura.channel.lifetime.persistent": "持久",
			"aura.channel.lifetime.transient": "衰减中",
			"aura.channel.value": "{label}：{value}；{lifetime}",
			"aura.coverage.label": "投影覆盖范围",
			"aura.coverage.summary": "{projected} / {sessions} 个会话",
			"aura.coverage.waiting": "正在等待持久化会话投影。",
			"aura.coverage.none": "{interactions} 次日志交互驱动持久历史相位；尚无审批活动。",
			"aura.coverage.one": "{interactions} 次日志交互；一条审批请求参与审批姿态。",
			"aura.coverage.many": "{interactions} 次日志交互；{approvals} 条审批请求参与审批姿态。",
			"aura.provenance.label": "当前来源",
			"aura.provenance.none": "没有持久化投影",
			"aura.provenance.value": "{time} · {fingerprint} · 非加密",
			"aura.portals.label": "Aura 记录披露",
			"aura.interaction.title": "交互记录",
			"aura.interaction.summary": "{records} 条记录",
			"aura.interaction.observed": "已观察交互",
			"aura.interaction.fingerprint": "投影头指纹",
			"aura.interaction.adapter": "适配器",
			"aura.interaction.adapterValue": "持久化会话日志",
			"aura.message.title": "消息流",
			"aura.message.summary": "{human} 条用户消息 · {assistant} 条助手消息",
			"aura.message.human": "用户消息",
			"aura.message.assistant": "助手消息",
			"aura.message.context": "上下文输入",
			"aura.message.turns": "已进入轮次",
			"aura.message.note": "消息正文不会进入投影。持久计数推进历史相位；新增用户或助手消息分别触发短暂形变。",
			"aura.action.title": "操作记录",
			"aura.action.summary": "{requested} 次请求 · {failed} 次失败",
			"aura.action.requests": "工具请求",
			"aura.action.results": "工具结果",
			"aura.action.failures": "结果失败",
			"aura.action.standing": "工具健康系数",
			"aura.action.note": "已提交的成功结果决定持久工具健康度；新增调用与结果只触发短暂工具形变。",
			"aura.approval.title": "审批姿态",
			"aura.approval.summary": "{allowed} 次允许 · {refused} 次拒绝",
			"aura.approval.asked": "请求",
			"aura.approval.allowed": "单次允许",
			"aura.approval.rejected": "拒绝",
			"aura.approval.unavailable": "无法回答",
			"aura.approval.cancelled": "取消",
			"aura.approval.standing": "审批姿态系数",
			"aura.confinement.title": "当前会话限制",
			"aura.confinement.default": "组合默认值",
			"aura.confinement.thread": "会话",
			"aura.confinement.none": "未选择",
			"aura.confinement.permission": "权限预设",
			"aura.confinement.sandbox": "沙箱模式",
			"aura.confinement.approval": "审批策略",
			"aura.confinement.notOverridden": "未覆盖",
			"aura.field.title": "场与限制",
			"aura.field.summary": "24 个面 · 6 个模式",
			"aura.field.standing": "持久系数",
			"aura.field.breath": "瞬态系数",
			"aura.field.digest": "当前几何摘要",
			"aura.field.walsh": "Walsh 场",
			"aura.field.identity": "身份绑定",
			"aura.field.receipts": "加密回执",
			"aura.field.anchor": "外部锚点",
			"aura.field.order": "跨会话顺序",
			"aura.field.notMounted": "未挂载",
			"aura.field.notClaimed": "不作声明",
			"aura.field.note": "只有顶点携带数据，拓扑保持固定。相同系数必得相同的标准几何；共享旋转与静止微动仅用于呈现，不会进入几何摘要。该视图不授予权限，也不声称语义真相。"
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"title": "Settings",
			"close": "Close",
			"openDocument": "Open configuration file",
			"openDocument.error": "Could not open configuration file",
			"general.nav": "General",
			"general.menuDescription": "language, appearance, and defaults",
			"aura.trigger": "Aura Coherence",
			"aura.menu": "living system state",
			"aura.subtitle": "SYSTEM LIFE STATE",
			"aura.status.noRecord": "NO RECORD",
			"aura.status.awaiting": "AWAITING DECISION",
			"aura.status.moving": "RESHAPING",
			"aura.status.rest": "AT REST",
			"aura.figure.title": "Aura six-plane tesseract life-state projection",
			"aura.figure.description": "Six logged coefficients deterministically move sixteen four-dimensional vertices through a Walsh field. The current form and zero reference share a slow rotation; idle vibration is presentation only, while new logged activity drives transient breath.",
			"aura.figure.key.label": "Aura geometry key",
			"aura.figure.key.current": "current data form",
			"aura.figure.key.reference": "zero-coefficient reference",
			"aura.channels.title": "Deformation inputs",
			"aura.ternary.title": "27 states · ternary view of persistent coefficients",
			"aura.ternary.note": "Three bins on each of three axes give 27 coordinates. This read-only, lossy view uses the same logged inputs as the sixteen-vertex tesseract; it is not identity, a trust score, or a ternary inference engine.",
			"aura.ternary.readout": "History, tool, approval: ({coordinate}) · index {index} / 0–26",
			"aura.ternary.unknown": "unknown",
			"aura.ternary.values": "Raw persistent coefficients: ({values})",
			"aura.ternary.slice": "History = {value}; rows = tool, columns = approval",
			"aura.ternary.bins": "History and approval: below −1/3 → −1, −1/3 through +1/3 inclusive → 0, above +1/3 → +1. Tool health is first normalized as 2x−1. Missing interactions, tool calls, or approval coverage show ? and select no cell. Index = 9(h+1)+3(t+1)+(a+1).",
			"aura.channels.note": "Every coefficient comes from a named durable-log count; live activity then decays to zero.",
			"aura.channel.historyPhase.label": "History phase",
			"aura.channel.historyPhase.source": "interaction count × golden phase · persistent",
			"aura.channel.toolHealth.label": "Tool health",
			"aura.channel.toolHealth.source": "successful results / tool calls · persistent",
			"aura.channel.approvalPosture.label": "Approval posture",
			"aura.channel.approvalPosture.source": "allowed minus refused / covered decisions · persistent",
			"aura.channel.humanActivity.label": "Human activity",
			"aura.channel.humanActivity.source": "new human-message delta · decays",
			"aura.channel.assistantActivity.label": "Assistant activity",
			"aura.channel.assistantActivity.source": "new assistant-message delta · decays",
			"aura.channel.toolActivity.label": "Tool activity",
			"aura.channel.toolActivity.source": "new tool calls and results · decays",
			"aura.channel.lifetime.persistent": "persistent",
			"aura.channel.lifetime.transient": "decaying",
			"aura.channel.value": "{label}: {value}; {lifetime}",
			"aura.coverage.label": "Projection coverage",
			"aura.coverage.summary": "{projected} of {sessions} sessions",
			"aura.coverage.waiting": "Waiting for a durable session projection.",
			"aura.coverage.none": "{interactions} logged interactions drive the persistent history phase. No approval activity is recorded.",
			"aura.coverage.one": "{interactions} logged interactions. One approval request contributes to approval posture.",
			"aura.coverage.many": "{interactions} logged interactions. {approvals} approval requests contribute to approval posture.",
			"aura.provenance.label": "Current source",
			"aura.provenance.none": "no durable projection",
			"aura.provenance.value": "{time} · {fingerprint} · non-cryptographic",
			"aura.portals.label": "Aura record portals",
			"aura.interaction.title": "Interaction record",
			"aura.interaction.summary": "{records} records",
			"aura.interaction.observed": "Observed interactions",
			"aura.interaction.fingerprint": "Projection-head fingerprint",
			"aura.interaction.adapter": "Adapter",
			"aura.interaction.adapterValue": "durable session logs",
			"aura.message.title": "Message flow",
			"aura.message.summary": "{human} human · {assistant} assistant",
			"aura.message.human": "Human messages",
			"aura.message.assistant": "Assistant messages",
			"aura.message.context": "Context entries",
			"aura.message.turns": "Turns entered",
			"aura.message.note": "Message bodies never enter the projection. Durable counts advance history phase; new human and assistant messages trigger separate transient deformations.",
			"aura.action.title": "Action record",
			"aura.action.summary": "{requested} requested · {failed} failed",
			"aura.action.requests": "Tool requests",
			"aura.action.results": "Tool results",
			"aura.action.failures": "Result failures",
			"aura.action.standing": "Tool-health coefficient",
			"aura.action.note": "Committed successful results set persistent tool health; new calls and results trigger only the transient tool deformation.",
			"aura.approval.title": "Approval posture",
			"aura.approval.summary": "{allowed} allowed · {refused} refused",
			"aura.approval.asked": "Asked",
			"aura.approval.allowed": "Allowed once",
			"aura.approval.rejected": "Rejected",
			"aura.approval.unavailable": "Unavailable",
			"aura.approval.cancelled": "Cancelled",
			"aura.approval.standing": "Approval-posture coefficient",
			"aura.confinement.title": "Selected-session confinement",
			"aura.confinement.default": "composition default",
			"aura.confinement.thread": "Thread",
			"aura.confinement.none": "none selected",
			"aura.confinement.permission": "Permission preset",
			"aura.confinement.sandbox": "Sandbox mode",
			"aura.confinement.approval": "Approval policy",
			"aura.confinement.notOverridden": "not overridden",
			"aura.field.title": "Field and limits",
			"aura.field.summary": "24 faces · 6 modes",
			"aura.field.standing": "Persistent coefficients",
			"aura.field.breath": "Transient coefficients",
			"aura.field.digest": "Current-geometry digest",
			"aura.field.walsh": "Walsh field",
			"aura.field.identity": "Identity binding",
			"aura.field.receipts": "Cryptographic receipts",
			"aura.field.anchor": "External anchor",
			"aura.field.order": "Cross-session order",
			"aura.field.notMounted": "not mounted",
			"aura.field.notClaimed": "not claimed",
			"aura.field.note": "Only vertices carry data while topology stays fixed. Identical coefficients reproduce identical canonical geometry; shared rotation and idle vibration are presentation only and never enter the geometry digest. This view grants no authority and makes no claim about semantic truth."
		};
		//#endregion
		//#region src/client/index.ts
		/** Dictionary namespace owned by this plugin (shell chrome + General copy). */
		const NS = "settings";
		/**
		* Required services (Cordis fiber inject). ui-layout declares the shell slots;
		* each settings child slot is declared by this plugin's corresponding shell
		* entry. Registration order stays unconstrained through `slots.inject()`.
		*/
		const inject = [
			"slots",
			"locale",
			"connection",
			"remote",
			"remote.settings",
			"settingsScope",
			"layout"
		];
		/**
		* Register the `settings` dictionaries, both System apps, the chrome content,
		* and the General section once their slot declarations are on the ledger.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "ui-settings-general: dictionaries");
			const t = ctx.locale.bind(NS);
			const documentController = ctx.get("connection").isLoopback ? new SettingsDocumentStore(ctx, ctx.settingsScope.describe()) : void 0;
			const documentInjected = documentController === void 0 ? void 0 : () => ({
				controller: documentController,
				hooks: { snapshot: documentController.store }
			});
			ctx.effect(() => () => {
				documentController?.dispose();
			}, "ui-settings-general: document action directory");
			let rowsVersion = -1;
			let rowsRevision = -1;
			let rows = [];
			let onboardingVersion = -1;
			let onboardingSteps = [];
			const shellInjected = () => ({ hooks: { sections: {
				getSnapshot: () => {
					const version = ctx.slots.getVersion("settings.section");
					const revision = ctx.locale.getSnapshot().revision;
					if (version !== rowsVersion || revision !== rowsRevision) {
						rowsVersion = version;
						rowsRevision = revision;
						rows = ctx.slots.entries("settings.section").map((entry) => {
							return {
								/* v8 ignore next -- list-slot registration requires id (SlotCore rejects an entry without one) */
								id: entry.options.id ?? "",
								order: entry.options.order ?? 0,
								label: (0, _deepseek_ai_dsh_client_ui_slots.resolveSlotLabel)(entry.options.label) ?? ""
							};
						}).sort((a, b) => a.order - b.order);
					}
					return rows;
				},
				subscribe: (listener) => {
					const offLedger = ctx.slots.subscribe("settings.section", listener);
					const offLocale = ctx.locale.subscribe(listener);
					return () => {
						offLedger();
						offLocale();
					};
				}
			} } });
			const onboardingInjected = () => ({
				openSection: (id) => {
					ctx.layout.openSurface("settings", id);
				},
				hooks: { onboardingSteps: {
					getSnapshot: () => {
						const version = ctx.slots.getVersion("settings.onboarding");
						if (version !== onboardingVersion) {
							onboardingVersion = version;
							onboardingSteps = ctx.slots.entries("settings.onboarding").map((e) => ({
								/* v8 ignore next -- list-slot registration requires id */
								id: e.options.id ?? "",
								order: e.options.order ?? 0
							})).sort((a, b) => a.order - b.order);
						}
						return onboardingSteps;
					},
					subscribe: (listener) => ctx.slots.subscribe("settings.onboarding", listener)
				} }
			});
			ctx.slots.inject("shell.surface", () => ctx.slots.register({
				name: "shell.surface",
				id: "settings",
				order: 0,
				children: {
					"settings.header": {
						kind: "single",
						scope: "root"
					},
					"settings.action": {
						kind: "list",
						scope: "root"
					},
					"settings.close": {
						kind: "single",
						scope: "root"
					},
					"settings.section": {
						kind: "list",
						scope: "root"
					}
				},
				inject: shellInjected
			}, SettingsRoot));
			ctx.slots.inject("shell.menu.system", () => ctx.slots.register({
				name: "shell.menu.system",
				id: "settings",
				order: 0,
				inject: shellInjected
			}, SettingsMenu));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "settings-onboarding",
				children: { "settings.onboarding": {
					kind: "list",
					scope: "root"
				} },
				inject: onboardingInjected
			}, SettingsOnboarding));
			ctx.slots.inject("settings.header", () => ctx.slots.register({
				name: "settings.header",
				locale: NS
			}, HeaderContent));
			if (documentInjected !== void 0) ctx.slots.inject("settings.action", () => ctx.slots.register({
				name: "settings.action",
				id: "open-document",
				order: 0,
				locale: NS,
				inject: documentInjected
			}, SettingsDocumentAction));
			ctx.slots.inject("settings.close", () => ctx.slots.register({
				name: "settings.close",
				locale: NS
			}, CloseLabel));
			ctx.slots.inject("shell.surface", () => ctx.slots.register({
				name: "shell.surface",
				id: "aura-coherence",
				order: 60,
				locale: NS
			}, AuraCoherenceSurface));
			ctx.slots.inject("shell.menu.system", () => ctx.slots.register({
				name: "shell.menu.system",
				id: "aura-coherence",
				order: -10,
				locale: NS
			}, AuraCoherenceMenu));
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "general",
				order: 0,
				label: () => t("general.nav"),
				locale: NS,
				children: { "settings.general.item": {
					kind: "list",
					scope: "root"
				} }
			}, GeneralSection));
		}
		//#endregion
		exports.SettingsDocumentStore = SettingsDocumentStore;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map