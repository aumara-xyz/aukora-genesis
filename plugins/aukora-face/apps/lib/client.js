window.__ModuleLoader__.load({
	id: "@aukora/face-apps",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let _aukora_face_layout_client = require("@aukora/face-layout/client");
		//#region \0dsh-css:StockApps.module.css.mjs
		const css$1 = ".PUG3BW_surfaceSeat{border-radius:inherit;background:var(--dsw-specific-spatial-canvas,#111520);width:100%;min-width:0;height:100%;min-height:0;position:absolute;inset:0;overflow:hidden}.PUG3BW_surfaceSeat:not([data-active]){visibility:hidden;pointer-events:none}.PUG3BW_embeddedFrame{background:var(--dsw-specific-spatial-canvas,#111520);border:0;width:100%;height:100%;display:block}.PUG3BW_surfaceSeat[data-stock-app=human-graph],.PUG3BW_embeddedFrame[data-stock-app-frame=human-graph]{background:0 0}.PUG3BW_menuCopy{flex-direction:column;align-items:flex-end;gap:2px;width:100%;min-width:0;max-width:100%;display:flex}.PUG3BW_menuCopy strong{font-size:var(--dsh-spatial-menu-title-size,14px);line-height:var(--dsh-spatial-menu-title-line-height,20px);font-weight:570}.PUG3BW_menuCopy span{width:100%;max-width:100%;color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-spatial-menu-description-size,12px);line-height:var(--dsh-spatial-menu-description-line-height,18px);text-align:right;text-overflow:ellipsis;white-space:nowrap;display:block;overflow:hidden}";
		const tagId$1 = "@aukora/face-apps/StockApps.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@aukora/face-apps";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var StockApps_module_css_default = {
			"embeddedFrame": "PUG3BW_embeddedFrame",
			"menuCopy": "PUG3BW_menuCopy",
			"surfaceSeat": "PUG3BW_surfaceSeat"
		};
		//#endregion
		//#region src/client/EmbeddedAppSurface.tsx
		function isEditableTarget(target) {
			const el = target;
			const tag = typeof el?.tagName === "string" ? el.tagName : "";
			return el?.isContentEditable === true || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
		}
		/** Mount one complete same-origin application without translating its UI. */
		function EmbeddedAppSurface({ id, title, src, allow, onFrameMessage, onFrameWindow, activeSurface, closeSurface }) {
			const active = activeSurface === id;
			const frameRef = (0, react.useRef)(null);
			const [frameLoad, setFrameLoad] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				if (!active) return;
				const onKeyDown = (event) => {
					if (event.key !== "Escape" || event.defaultPrevented) return;
					if (isEditableTarget(event.target)) return;
					event.preventDefault();
					closeSurface();
				};
				const frameDocument = frameRef.current?.contentDocument;
				document.addEventListener("keydown", onKeyDown);
				frameDocument?.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("keydown", onKeyDown);
					frameDocument?.removeEventListener("keydown", onKeyDown);
				};
			}, [
				active,
				closeSurface,
				frameLoad
			]);
			(0, react.useEffect)(() => {
				if (active) return;
				const frame = frameRef.current;
				(frame?.contentDocument?.activeElement)?.blur();
				frame?.blur();
			}, [active, frameLoad]);
			(0, react.useEffect)(() => {
				const frameWindow = frameRef.current?.contentWindow;
				if (frameWindow === null || frameWindow === void 0) return;
				frameWindow.postMessage({
					source: "aukora-shell",
					type: "surface-active",
					app: id,
					active
				}, window.location.origin);
			}, [
				active,
				frameLoad,
				id
			]);
			(0, react.useEffect)(() => {
				if (onFrameMessage === void 0) return;
				const receive = (event) => {
					if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow) return;
					onFrameMessage(event.data);
				};
				window.addEventListener("message", receive);
				return () => {
					window.removeEventListener("message", receive);
				};
			}, [onFrameMessage]);
			(0, react.useEffect)(() => () => {
				onFrameWindow?.(null);
			}, [onFrameWindow]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				...active ? {} : { inert: "" },
				"data-stock-app": id,
				"data-active": active ? "" : void 0,
				"aria-hidden": !active,
				className: StockApps_module_css_default.surfaceSeat,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("iframe", {
					ref: frameRef,
					className: StockApps_module_css_default.embeddedFrame,
					src,
					title,
					allow,
					sandbox: "allow-scripts allow-same-origin",
					"data-stock-app-frame": id,
					onLoad: () => {
						setFrameLoad((load) => load + 1);
						onFrameWindow?.(frameRef.current?.contentWindow ?? null);
					}
				})
			});
		}
		//#endregion
		//#region src/client/AumaLanguageSurface.tsx
		/** Render the exact Auma Lingwa application from the live spatial source. */
		function AumaLanguageSurface(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EmbeddedAppSurface, {
				...props,
				id: "auma-language",
				title: props.t("language.name"),
				src: "/stock-apps/auma-lingwa.html",
				allow: "autoplay"
			});
		}
		//#endregion
		//#region src/client/auma-live-session.ts
		/**
		* WHICH SESSION THE LIVE SURFACE IS BOUND TO — and the one rule that keeps a thread click from reloading her.
		*
		* THE DEFECT THIS EXISTS FOR, measured at 10:02. The surface read the selected thread REACTIVELY and put it in
		* the iframe's address. Clicking a thread therefore rewrote `src`, the browser reloaded the document, and the
		* app inside fixed its session at load — so a sidebar click moved Auma from AURA to KIRA **with an empty
		* conversation**, because the new document started from nothing. The click was never meant to be a navigation;
		* it was meant to be a selection.
		*
		* THE RULE, IN ONE SENTENCE: **the session is bound ONCE, when the surface mounts, and only an EXPLICIT
		* follow action moves it.** A silent selection change is not a follow action. That is the whole fix, and it is
		* split out here rather than left inside the component because a React file cannot be imported by a court —
		* this module can, so the rule is measured rather than described.
		*
		* @module auma-live-session
		*/
		/** The bare app address, used when no session is selected at all. */
		const LIVE_APP_PATH = "/stock-apps/auma-live.html";
		/**
		* The iframe address for a session.
		*
		* @param {string | undefined | null} sessionId
		* @returns {string}
		*/
		function liveAppSrc(sessionId) {
			const id = typeof sessionId === "string" ? sessionId.trim() : "";
			return id === "" ? LIVE_APP_PATH : `${LIVE_APP_PATH}?session=${encodeURIComponent(id)}`;
		}
		/**
		* The session a surface should use for the whole life of its mount.
		*
		* **A BOUND SESSION IS NEVER RE-READ.** Once bound, later calls return the FIRST selection even if the store's
		* current thread has changed — which is exactly what makes a thread click safe. Following is a separate,
		* explicit act (`followThread`), so a caller cannot follow by accident.
		*/
		var BoundSession = class {
			#bound;
			#followed = false;
			/**
			* @param {string | undefined | null} initial - the selection at mount
			*/
			constructor(initial) {
				this.#bound = typeof initial === "string" ? initial : "";
			}
			/** The bound session id, or '' when nothing was selected at mount. */
			get sessionId() {
				return this.#bound;
			}
			/** Whether an explicit follow has moved the binding away from its mount-time selection. */
			get followed() {
				return this.#followed;
			}
			/** The iframe address this binding implies. Changes ONLY when `followThread` is called. */
			get src() {
				return liveAppSrc(this.#bound);
			}
			/**
			* Bind the mount-time selection. **A second call is a no-op and says so**, rather than silently rebinding:
			* a rebind is the reload this module exists to prevent, so it must be an explicit act with its own name.
			*
			* @param {string | undefined | null} selected - the store's current thread, read again on a later render
			* @returns {{changed: boolean, ignored: boolean}} what happened, so a caller can report it
			*/
			bindOnce(selected) {
				const next = typeof selected === "string" ? selected : "";
				if (this.#bound !== "" && next !== this.#bound) return {
					changed: false,
					ignored: true
				};
				if (this.#bound === "" && next !== "") {
					this.#bound = next;
					return {
						changed: true,
						ignored: false
					};
				}
				return {
					changed: false,
					ignored: false
				};
			}
			/**
			* **THE EXPLICIT ACTION.** Only this moves the binding, and it is the only thing that may change the iframe
			* address. A person who wants her to follow the thread they just clicked says so.
			*
			* @param {string | undefined | null} selected
			* @returns {{changed: boolean, from: string, to: string}}
			*/
			followThread(selected) {
				const next = typeof selected === "string" ? selected : "";
				const from = this.#bound;
				if (next === from) return {
					changed: false,
					from,
					to: next
				};
				this.#bound = next;
				this.#followed = true;
				return {
					changed: true,
					from,
					to: next
				};
			}
		};
		//#endregion
		//#region src/client/AumaLiveSurface.tsx
		/**
		* Render the actual local full-duplex Auma Live application.
		*
		* **THE SESSION IS BOUND ONCE, AT MOUNT, AND A THREAD CLICK NO LONGER RELOADS HER.** The previous version read
		* the selected thread reactively and interpolated it into the iframe's address, so every sidebar click rewrote
		* `src`, the document reloaded, and the app inside — which fixes its session at load — restarted on an empty
		* conversation. Measured at 10:02: a click moved her from AURA to KIRA with nothing in the log. The rule and
		* its own courts live in `auma-live-session.ts`; this file only wires the component to it.
		*
		* FOLLOWING IS AN EXPLICIT ACT, and it is deliberately NOT wired to the thread selection: a silent selection
		* change is not an instruction to navigate. `bindAumaLiveSession` below is the one thing that moves her, and
		* the shell binds it to a control when it has one to bind it to. **UNTIL THAT CONTROL EXISTS, NOTHING MOVES
		* HER, which is the safe direction for the defect being repaired** — the failure was that she moved on every
		* click, not that she could not be moved at all.
		*/
		function AumaLiveSurface(props) {
			const selected = props.useSessions((state) => state.current);
			const bound = (0, react.useRef)(null);
			if (bound.current === null) bound.current = new BoundSession(selected);
			const [src, setSrc] = (0, react.useState)(() => bound.current.src);
			bindAumaLiveSession.current = () => {
				const moved = bound.current.followThread(selected);
				if (moved.changed) setSrc(bound.current.src);
				return moved;
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EmbeddedAppSurface, {
				...props,
				id: "auma-live",
				title: props.t("live.name"),
				src,
				allow: "microphone; autoplay",
				onFrameMessage: (data) => {
					const message = data;
					if (message === null || message.type !== "why") return;
					if (typeof message.replyId !== "string" || message.replyId === "") return;
					props.openSurface?.("why", message.replyId, "contained");
				}
			});
		}
		/**
		* THE EXPLICIT FOLLOW HANDLE. A module-level slot, not a prop: `EmbeddedAppSurface` spreads unknown props onto
		* the frame element, and inventing a prop to carry this would put a function on an iframe attribute. A shell
		* that offers "follow this thread" calls `bindAumaLiveSession.current?.()`; a shell that offers nothing leaves
		* it alone, and she stays where she was bound.
		*/
		const bindAumaLiveSession = { current: null };
		//#endregion
		//#region src/client/ZetaHarpSurface.tsx
		/** Render the complete vendored Zeta Harp instrument. */
		function ZetaHarpSurface(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EmbeddedAppSurface, {
				...props,
				id: "zeta-harp",
				title: props.t("harp.name"),
				src: "/stock-apps/zeta-harp/index.html",
				allow: "autoplay"
			});
		}
		//#endregion
		//#region src/client/HumanGraphSurface.tsx
		function MountedGraph(props) {
			const frame = (0, react.useRef)(null);
			const receiveWindow = (0, react.useCallback)((value) => {
				frame.current = value;
			}, []);
			(0, react.useLayoutEffect)(() => () => {
				frame.current?.disposeHumanGraph?.();
				frame.current = null;
			}, []);
			const receiveMessage = (0, react.useCallback)((message) => {
				const value = message;
				if (value?.source === "aukora-human-graph" && value.type === "close") props.closeSurface();
			}, [props.closeSurface]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EmbeddedAppSurface, {
				...props,
				id: "human-graph",
				title: props.t("humanGraph.name"),
				src: "/stock-apps/human-graph/index.html",
				onFrameWindow: receiveWindow,
				onFrameMessage: receiveMessage
			});
		}
		/** Inactive shell seats never create a document, fetch three.js, or own a WebGL context. */
		function HumanGraphSurface(props) {
			return props.activeSurface === "human-graph" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MountedGraph, { ...props }) : null;
		}
		//#endregion
		//#region \0dsh-css:MediaSurface.module.css.mjs
		const css = ".tS-pUq_surface.tS-pUq_surface{color:var(--aukora-text);font-family:var(--dsw-font-family);background:0 0;overflow:auto;container:tS-pUq_media-seat/inline-size}.tS-pUq_content{box-sizing:border-box;min-width:0;max-width:1280px;margin:0 auto;padding:28px}.tS-pUq_header{gap:12px;margin-bottom:24px}.tS-pUq_header h1{letter-spacing:-.5px;margin:0;font-size:24px;font-weight:570;line-height:32px}.tS-pUq_brandIcon{width:40px;height:40px;color:var(--aukora-blue);border:1px solid color-mix(in srgb, var(--aukora-blue) 32%, transparent);border-radius:var(--aukora-radius);place-items:center;display:grid}.tS-pUq_headerActions{gap:8px;margin-left:auto;display:flex}.tS-pUq_workspace{grid-template-columns:minmax(280px,.9fr) minmax(0,1.3fr);align-items:stretch;gap:18px;display:grid}.tS-pUq_composer,.tS-pUq_preview,.tS-pUq_gallery{background:color-mix(in srgb, var(--aukora-surface) 40%, transparent)}.tS-pUq_composer{flex-direction:column;gap:22px;padding:20px;display:flex}.tS-pUq_modeSwitch{grid-template-columns:1fr 1fr;gap:8px;display:grid}.tS-pUq_modeSwitch button{background:0 0;min-height:40px}.tS-pUq_editor{flex-direction:column;min-width:0;display:flex}.tS-pUq_promptLabel,.tS-pUq_field,.tS-pUq_audio{color:var(--aukora-text-secondary);font-size:12px;line-height:18px}.tS-pUq_promptLabel{margin-bottom:10px}.tS-pUq_prompt{box-sizing:border-box;border:1px solid var(--aukora-border);width:100%;min-height:138px;max-height:260px;color:var(--aukora-text);font:inherit;resize:vertical;background:0 0;border-radius:10px;padding:14px;font-size:14px;line-height:22px;display:block}.tS-pUq_prompt::placeholder{color:var(--aukora-text-muted)}.tS-pUq_controls{grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 12px;margin-top:20px;display:grid}.tS-pUq_field{flex-direction:column;gap:7px;min-width:0;display:flex}.tS-pUq_model{grid-column:1/-1}.tS-pUq_field select,.tS-pUq_field input{box-sizing:border-box;border:1px solid var(--aukora-border);width:100%;min-width:0;min-height:40px;color:var(--aukora-text);font:inherit;background:0 0;border-radius:9px;padding:8px 10px;font-size:13px;line-height:20px}.tS-pUq_field select{cursor:pointer;color-scheme:dark}.tS-pUq_field option{background:var(--aukora-surface);color:var(--aukora-text)}.tS-pUq_field input:disabled{opacity:.45;cursor:not-allowed}.tS-pUq_audio{justify-content:space-between;align-self:end;align-items:center;min-height:40px;display:flex}.tS-pUq_audio input{appearance:none;box-sizing:border-box;border:1px solid var(--aukora-border);cursor:pointer;background:0 0;border-radius:20px;width:34px;height:20px;margin:0}.tS-pUq_audio input:before{content:\"\";background:var(--aukora-text-muted);border-radius:50%;width:12px;height:12px;margin:3px;transition:transform .16s;display:block}.tS-pUq_audio input:checked{border-color:color-mix(in srgb, var(--aukora-green) 50%, transparent);background:color-mix(in srgb, var(--aukora-green) 12%, transparent)}.tS-pUq_audio input:checked:before{background:var(--aukora-green);transform:translate(14px)}.tS-pUq_prompt:focus-visible,.tS-pUq_field select:focus-visible,.tS-pUq_audio input:focus-visible{outline:2px solid var(--aukora-blue);outline-offset:3px}.tS-pUq_generateArea{margin-top:auto}.tS-pUq_generate{background:0 0;width:100%;min-height:44px}.tS-pUq_reason{color:var(--aukora-text-muted);text-align:center;text-wrap:balance;margin:10px 0 0;font-size:11px;line-height:17px}.tS-pUq_preview{flex-direction:column;min-height:390px;padding:20px;display:flex}.tS-pUq_previewHeader{flex-wrap:wrap;justify-content:space-between;gap:8px}.tS-pUq_previewHeader h2,.tS-pUq_galleryHeader h2,.tS-pUq_settingsHeader h2{margin:0;font-size:14px;font-weight:570;line-height:20px}.tS-pUq_previewHeader>span{color:var(--aukora-text-muted);font-size:11px}.tS-pUq_dot{color:var(--aukora-purple);margin:0 7px}.tS-pUq_previewCanvas{flex-direction:column;flex:1;justify-content:center;align-items:center;gap:20px;min-width:0;padding:28px 4px;display:flex}.tS-pUq_emptyFrame{box-sizing:border-box;border:1px solid color-mix(in srgb, var(--aukora-blue) 22%, transparent);background:radial-gradient(ellipse at 15% 5%, color-mix(in srgb, var(--aukora-green) 7%, transparent), transparent 60%), radial-gradient(ellipse at 90% 95%, color-mix(in srgb, var(--aukora-purple) 9%, transparent), transparent 60%);border-radius:12px;flex:none;place-items:center;max-width:100%;display:grid;position:relative}.tS-pUq_emptyFrame:after{content:\"\";border:1px dashed color-mix(in srgb, var(--aukora-blue) 12%, transparent);border-radius:5px;position:absolute;inset:12px}.tS-pUq_emptyIcon{border:1px solid color-mix(in srgb, var(--aukora-blue) 25%, transparent);width:62px;height:62px;color:var(--aukora-blue);border-radius:18px;place-items:center;display:grid}.tS-pUq_emptyIcon svg{width:28px;height:28px}.tS-pUq_emptyCaption{color:var(--aukora-text-muted);font-size:12px;line-height:18px}.tS-pUq_gallery{margin-top:18px;padding:18px 20px}.tS-pUq_galleryHeader{gap:10px}.tS-pUq_count{color:var(--aukora-text-muted);margin-left:auto;font-size:12px}.tS-pUq_galleryEmpty{color:var(--aukora-text-muted);justify-content:center;align-items:center;gap:12px;padding:26px 8px 12px;font-size:12px;display:flex}.tS-pUq_galleryGlyph{border:1px dashed color-mix(in srgb, var(--aukora-purple) 25%, transparent);width:36px;height:36px;color:var(--aukora-purple);border-radius:10px;place-items:center;display:grid}.tS-pUq_purple{color:var(--aukora-purple);display:inline-flex}.tS-pUq_gold{color:var(--aukora-gold);display:inline-flex}.tS-pUq_dialog{width:min(440px,100vw - 32px);max-height:calc(100dvh - 32px);color:var(--aukora-text);font-family:var(--dsw-font-family);border-radius:var(--aukora-radius);background:0 0;border:0;padding:0;overflow:auto}.tS-pUq_dialog::backdrop{background:var(--aukora-backdrop);backdrop-filter:blur(5px)}.tS-pUq_settingsPanel{background:var(--dsw-alias-bg-layer-1,var(--aukora-surface));padding:24px}.tS-pUq_settingsHeader{gap:10px}.tS-pUq_settingsHeader button{min-width:32px;margin-left:auto;padding:6px}.tS-pUq_provider{color:var(--aukora-text-secondary);flex-wrap:wrap;justify-content:space-between;gap:8px;margin:24px 0;font-size:13px;display:flex}.tS-pUq_disconnected{color:var(--aukora-gold);font-size:12px}.tS-pUq_settingsPanel .tS-pUq_field+.tS-pUq_field{margin-top:16px}.tS-pUq_settingsReason{color:var(--aukora-text-secondary);margin:18px 0 24px;font-size:12px;line-height:19px}.tS-pUq_settingsActions{flex-wrap:wrap;justify-content:flex-end;gap:8px;display:flex}@container tS-pUq_media-seat (width<=700px){.tS-pUq_content{padding:20px}.tS-pUq_workspace{grid-template-columns:minmax(0,1fr)}.tS-pUq_preview{min-height:350px}}@container tS-pUq_media-seat (width<=380px){.tS-pUq_content{padding:12px}.tS-pUq_header{gap:8px}.tS-pUq_header h1{font-size:20px}.tS-pUq_headerActions{gap:6px}.tS-pUq_headerActions button{padding:6px 8px}.tS-pUq_brandIcon{display:none}.tS-pUq_composer,.tS-pUq_preview{padding:16px}}@media (prefers-reduced-motion:reduce){.tS-pUq_audio input:before{transition:none}}";
		const tagId = "@aukora/face-apps/MediaSurface.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@aukora/face-apps";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var MediaSurface_module_css_default = {
			"audio": "tS-pUq_audio",
			"brandIcon": "tS-pUq_brandIcon",
			"composer": "tS-pUq_composer",
			"content": "tS-pUq_content",
			"controls": "tS-pUq_controls",
			"count": "tS-pUq_count",
			"dialog": "tS-pUq_dialog",
			"disconnected": "tS-pUq_disconnected",
			"dot": "tS-pUq_dot",
			"editor": "tS-pUq_editor",
			"emptyCaption": "tS-pUq_emptyCaption",
			"emptyFrame": "tS-pUq_emptyFrame",
			"emptyIcon": "tS-pUq_emptyIcon",
			"field": "tS-pUq_field",
			"gallery": "tS-pUq_gallery",
			"galleryEmpty": "tS-pUq_galleryEmpty",
			"galleryGlyph": "tS-pUq_galleryGlyph",
			"galleryHeader": "tS-pUq_galleryHeader",
			"generate": "tS-pUq_generate",
			"generateArea": "tS-pUq_generateArea",
			"gold": "tS-pUq_gold",
			"header": "tS-pUq_header",
			"headerActions": "tS-pUq_headerActions",
			"media-seat": "tS-pUq_media-seat",
			"modeSwitch": "tS-pUq_modeSwitch",
			"model": "tS-pUq_model",
			"preview": "tS-pUq_preview",
			"previewCanvas": "tS-pUq_previewCanvas",
			"previewHeader": "tS-pUq_previewHeader",
			"prompt": "tS-pUq_prompt",
			"promptLabel": "tS-pUq_promptLabel",
			"provider": "tS-pUq_provider",
			"purple": "tS-pUq_purple",
			"reason": "tS-pUq_reason",
			"settingsActions": "tS-pUq_settingsActions",
			"settingsHeader": "tS-pUq_settingsHeader",
			"settingsPanel": "tS-pUq_settingsPanel",
			"settingsReason": "tS-pUq_settingsReason",
			"surface": "tS-pUq_surface",
			"workspace": "tS-pUq_workspace"
		};
		//#endregion
		//#region src/client/MediaSurface.tsx
		const IMAGE_RATIOS = [
			"1:1",
			"2:3",
			"3:2",
			"3:4",
			"4:3",
			"7:9",
			"9:7",
			"9:16",
			"16:9",
			"21:9"
		];
		const VIDEO_RATIOS = [
			"16:9",
			"4:3",
			"1:1",
			"3:4",
			"9:16",
			"21:9"
		];
		const DURATIONS = Array.from({ length: 12 }, (_, index) => index + 4);
		/** Small native outline glyphs; no remote media or simulated generation results. */
		function MediaIcon({ kind }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: "20",
				height: "20",
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.5",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				children: [
					kind === "image" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
							x: "3",
							y: "3",
							width: "18",
							height: "18",
							rx: "3"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
							cx: "8",
							cy: "8",
							r: "1.5"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m3 17 6-6 4 4 3-3 5 5" })
					] }),
					kind === "video" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "3",
						y: "4",
						width: "18",
						height: "16",
						rx: "3"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m10 8 6 4-6 4Z" })] }),
					kind === "settings" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M4 7h16M4 17h16" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
							cx: "9",
							cy: "7",
							r: "3"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
							cx: "15",
							cy: "17",
							r: "3"
						})
					] }),
					kind === "close" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m6 6 12 12M6 18 18 6" }),
					kind === "lock" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "5",
						y: "10",
						width: "14",
						height: "11",
						rx: "3"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M8 10V7a4 4 0 0 1 8 0v3M12 15v2" })] }),
					kind === "gallery" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "7",
						y: "7",
						width: "14",
						height: "14",
						rx: "3"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M17 3H6a3 3 0 0 0-3 3v11M11 16l3-3 3 3" })] })
				]
			});
		}
		function MediaSettings({ t, onDismiss, trigger }) {
			const dialog = (0, react.useRef)(null);
			const form = (0, react.useRef)(null);
			const id = (0, react.useId)();
			(0, react.useLayoutEffect)(() => {
				const element = dialog.current;
				element?.showModal();
				return () => {
					form.current?.reset();
					element?.close();
					if (trigger.current?.closest("[data-active]")) trigger.current.focus();
				};
			}, [trigger]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dialog", {
				ref: dialog,
				className: MediaSurface_module_css_default.dialog,
				"aria-labelledby": `${id}-title`,
				"aria-describedby": `${id}-reason`,
				onCancel: (event) => {
					event.preventDefault();
					onDismiss();
				},
				onClick: (event) => {
					if (event.target === event.currentTarget) onDismiss();
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_aukora_face_layout_client.Panel, {
					className: MediaSurface_module_css_default.settingsPanel,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_aukora_face_layout_client.SectionHeader, {
							className: MediaSurface_module_css_default.settingsHeader,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: MediaSurface_module_css_default.gold,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MediaIcon, { kind: "settings" })
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
									id: `${id}-title`,
									children: t("media.settings")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_aukora_face_layout_client.ActionButton, {
									autoFocus: true,
									variant: "gold",
									"aria-label": t("media.closeSettings"),
									onClick: onDismiss,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MediaIcon, { kind: "close" })
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: MediaSurface_module_css_default.provider,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Higgsfield" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: MediaSurface_module_css_default.disconnected,
								children: t("media.disconnected")
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
							ref: form,
							autoComplete: "off",
							onSubmit: (event) => event.preventDefault(),
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: MediaSurface_module_css_default.field,
									children: [t("media.keyId"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "text",
										disabled: true,
										defaultValue: "",
										autoComplete: "off",
										"aria-describedby": `${id}-reason`
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: MediaSurface_module_css_default.field,
									children: [t("media.keySecret"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "password",
										disabled: true,
										defaultValue: "",
										autoComplete: "new-password",
										"aria-describedby": `${id}-reason`
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									id: `${id}-reason`,
									className: MediaSurface_module_css_default.settingsReason,
									children: t("media.credentialsUnavailable")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: MediaSurface_module_css_default.settingsActions,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_aukora_face_layout_client.ActionButton, {
										variant: "gold",
										onClick: onDismiss,
										children: t("media.cancel")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_aukora_face_layout_client.ActionButton, {
										variant: "green",
										disabled: true,
										"aria-describedby": `${id}-reason`,
										children: t("media.saveConnect")
									})]
								})
							]
						})
					]
				})
			});
		}
		/** Native Apps seat. Draft controls are local only; provider and credential actions are unavailable. */
		function MediaSurface({ activeSurface, closeSurface, t }) {
			const active = activeSurface === "media";
			const surface = (0, react.useRef)(null);
			const settingsTrigger = (0, react.useRef)(null);
			const imageTab = (0, react.useRef)(null);
			const videoTab = (0, react.useRef)(null);
			const id = (0, react.useId)();
			const [mode, setMode] = (0, react.useState)("image");
			const [drafts, setDrafts] = (0, react.useState)({
				image: "",
				video: ""
			});
			const [imageRatio, setImageRatio] = (0, react.useState)("1:1");
			const [videoRatio, setVideoRatio] = (0, react.useState)("16:9");
			const [videoResolution, setVideoResolution] = (0, react.useState)("1080p");
			const [duration, setDuration] = (0, react.useState)(8);
			const [audio, setAudio] = (0, react.useState)(true);
			const [settingsOpen, setSettingsOpen] = (0, react.useState)(false);
			const video = mode === "video";
			const ratio = video ? videoRatio : imageRatio;
			const [width = 1, height = 1] = ratio.split(":").map(Number);
			(0, react.useEffect)(() => {
				if (!active) {
					setSettingsOpen(false);
					const focused = document.activeElement;
					if (focused instanceof HTMLElement && surface.current?.contains(focused)) focused.blur();
					return;
				}
				const onKeyDown = (event) => {
					if (event.key !== "Escape" || event.defaultPrevented || settingsOpen || isEditableTarget(event.target)) return;
					event.preventDefault();
					closeSurface();
				};
				document.addEventListener("keydown", onKeyDown);
				return () => document.removeEventListener("keydown", onKeyDown);
			}, [
				active,
				closeSurface,
				settingsOpen
			]);
			const selectMode = (next, focus = false) => {
				setMode(next);
				if (focus) (next === "image" ? imageTab : videoTab).current?.focus();
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				...active ? {} : { inert: "" },
				ref: surface,
				"data-stock-app": "media",
				"data-active": active ? "" : void 0,
				"aria-hidden": !active,
				className: `${StockApps_module_css_default.surfaceSeat} ${MediaSurface_module_css_default.surface}`,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: MediaSurface_module_css_default.content,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_aukora_face_layout_client.SectionHeader, {
							className: MediaSurface_module_css_default.header,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: MediaSurface_module_css_default.brandIcon,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MediaIcon, { kind: "gallery" })
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", { children: t("media.name") }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: MediaSurface_module_css_default.headerActions,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_aukora_face_layout_client.ActionButton, {
										ref: settingsTrigger,
										variant: "gold",
										onClick: () => setSettingsOpen(true),
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MediaIcon, { kind: "settings" }), t("media.settings")]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_aukora_face_layout_client.ActionButton, {
										variant: "blue",
										"aria-label": t("media.close"),
										onClick: closeSurface,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MediaIcon, { kind: "close" })
									})]
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: MediaSurface_module_css_default.workspace,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_aukora_face_layout_client.Panel, {
								className: MediaSurface_module_css_default.composer,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: MediaSurface_module_css_default.modeSwitch,
										role: "tablist",
										"aria-label": t("media.mode"),
										onKeyDown: (event) => {
											if (![
												"ArrowLeft",
												"ArrowRight",
												"Home",
												"End"
											].includes(event.key)) return;
											event.preventDefault();
											selectMode(event.key === "Home" ? "image" : event.key === "End" ? "video" : video ? "image" : "video", true);
										},
										children: ["image", "video"].map((value) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_aukora_face_layout_client.ActionButton, {
											ref: value === "image" ? imageTab : videoTab,
											role: "tab",
											id: `${id}-${value}-tab`,
											"aria-selected": mode === value,
											"aria-controls": `${id}-editor`,
											tabIndex: mode === value ? 0 : -1,
											"aria-pressed": mode === value,
											variant: value === "image" ? "blue" : "purple",
											onClick: () => selectMode(value),
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MediaIcon, { kind: value }), t(value === "image" ? "media.image" : "media.video")]
										}, value))
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										id: `${id}-editor`,
										role: "tabpanel",
										"aria-labelledby": `${id}-${mode}-tab`,
										className: MediaSurface_module_css_default.editor,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
												className: MediaSurface_module_css_default.promptLabel,
												htmlFor: `${id}-prompt`,
												children: t("media.prompt")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
												id: `${id}-prompt`,
												className: MediaSurface_module_css_default.prompt,
												rows: 5,
												value: drafts[mode],
												maxLength: video ? 4e3 : 800,
												placeholder: t(video ? "media.videoPlaceholder" : "media.imagePlaceholder"),
												onChange: (event) => setDrafts((previous) => ({
													...previous,
													[mode]: event.target.value
												}))
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: MediaSurface_module_css_default.controls,
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
														className: `${MediaSurface_module_css_default.field} ${MediaSurface_module_css_default.model}`,
														children: [t("media.model"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
															value: video ? "seedance2" : "z-image-turbo",
															onChange: () => {},
															children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
																value: video ? "seedance2" : "z-image-turbo",
																children: video ? "Seedance 2.0" : "Z-Image Turbo"
															})
														})]
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
														className: MediaSurface_module_css_default.field,
														children: [t("media.ratio"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
															value: ratio,
															onChange: (event) => (video ? setVideoRatio : setImageRatio)(event.target.value),
															children: (video ? VIDEO_RATIOS : IMAGE_RATIOS).map((value) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", { children: value }, value))
														})]
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
														className: MediaSurface_module_css_default.field,
														children: [t("media.resolution"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
															value: video ? videoResolution : "1k",
															onChange: (event) => {
																if (video) setVideoResolution(event.target.value);
															},
															children: (video ? [
																"480p",
																"720p",
																"1080p",
																"4k"
															] : ["1k"]).map((value) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", { children: value }, value))
														})]
													}),
													video && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
														className: MediaSurface_module_css_default.field,
														children: [t("media.duration"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
															value: duration,
															onChange: (event) => setDuration(Number(event.target.value)),
															children: DURATIONS.map((value) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
																value,
																children: [value, " s"]
															}, value))
														})]
													}),
													video && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
														className: MediaSurface_module_css_default.audio,
														children: [t("media.audio"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
															type: "checkbox",
															role: "switch",
															checked: audio,
															onChange: (event) => setAudio(event.target.checked)
														})]
													})
												]
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: MediaSurface_module_css_default.generateArea,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_aukora_face_layout_client.ActionButton, {
											className: MediaSurface_module_css_default.generate,
											variant: "green",
											disabled: true,
											"aria-describedby": `${id}-unavailable`,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MediaIcon, { kind: "lock" }), t("media.generate")]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											id: `${id}-unavailable`,
											className: MediaSurface_module_css_default.reason,
											children: t("media.generationUnavailable")
										})]
									})
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_aukora_face_layout_client.Panel, {
								className: MediaSurface_module_css_default.preview,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_aukora_face_layout_client.SectionHeader, {
									className: MediaSurface_module_css_default.previewHeader,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: t("media.preview") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
										ratio,
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: MediaSurface_module_css_default.dot,
											children: "·"
										}),
										video ? videoResolution : "1k",
										video && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: MediaSurface_module_css_default.dot,
												children: "·"
											}),
											duration,
											" s"
										] })
									] })]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: MediaSurface_module_css_default.previewCanvas,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: MediaSurface_module_css_default.emptyFrame,
										"data-media-ratio": ratio,
										style: {
											aspectRatio: `${width} / ${height}`,
											width: `min(100%, ${280 * width / height}px)`
										},
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: MediaSurface_module_css_default.emptyIcon,
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MediaIcon, { kind: mode })
										})
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: MediaSurface_module_css_default.emptyCaption,
										children: t("media.noPreview")
									})]
								})]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_aukora_face_layout_client.Panel, {
							className: MediaSurface_module_css_default.gallery,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_aukora_face_layout_client.SectionHeader, {
								className: MediaSurface_module_css_default.galleryHeader,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: MediaSurface_module_css_default.purple,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MediaIcon, { kind: "gallery" })
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: t("media.gallery") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: MediaSurface_module_css_default.count,
										children: "0"
									})
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: MediaSurface_module_css_default.galleryEmpty,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: MediaSurface_module_css_default.galleryGlyph,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MediaIcon, { kind: "image" })
								}), t("media.noGenerations")]
							})]
						})
					]
				}), active && settingsOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MediaSettings, {
					t,
					onDismiss: () => setSettingsOpen(false),
					trigger: settingsTrigger
				})]
			});
		}
		//#endregion
		//#region src/client/DakiniCode.tsx
		/** Render the independent Dakini Code app launcher. */
		function DakiniCodeMenu({ activeSurface, openSurface, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				"data-user-app-launcher": "dakini-code",
				"aria-current": activeSurface === "dakini-code" ? "page" : void 0,
				onClick: () => {
					openSurface("dakini-code", void 0, "full-bleed");
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: StockApps_module_css_default.menuCopy,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("dakini.name") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("dakini.menu") })]
				})
			});
		}
		/** Render the pinned static app without requiring its development server. */
		function DakiniCodeSurface(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EmbeddedAppSurface, {
				...props,
				id: "dakini-code",
				title: props.t("dakini.name"),
				src: "/stock-apps/dakini-code/index.html",
				allow: "autoplay"
			});
		}
		//#endregion
		//#region src/client/StockAppMenu.tsx
		/** Stock-app registry values shared by registration and component tests. */
		const AUMA_LANGUAGE_APP = {
			id: "auma-language",
			copy: "language",
			presentation: "full-bleed"
		};
		const AUMA_LIVE_APP = {
			id: "auma-live",
			copy: "live",
			presentation: "full-bleed"
		};
		const ZETA_HARP_APP = {
			id: "zeta-harp",
			copy: "harp",
			presentation: "full-bleed"
		};
		const AUMA_CANVAS_APP = {
			id: "auma-canvas",
			copy: "canvas",
			presentation: "full-bleed"
		};
		const HUMAN_GRAPH_APP = {
			id: "human-graph",
			copy: "humanGraph",
			presentation: "full-bleed"
		};
		const MEDIA_APP = {
			id: "media",
			copy: "media",
			presentation: "contained"
		};
		const STOCK_APPS = [
			AUMA_LANGUAGE_APP,
			AUMA_LIVE_APP,
			ZETA_HARP_APP,
			AUMA_CANVAS_APP,
			HUMAN_GRAPH_APP,
			MEDIA_APP
		];
		function StockAppMenu({ spec, activeSurface, openSurface, t }) {
			const active = activeSurface === spec.id;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				"aria-label": t(`${spec.copy}.name`),
				type: "button",
				"data-stock-app-launcher": spec.id,
				"aria-current": active ? "page" : void 0,
				onClick: () => {
					openSurface(spec.id, void 0, spec.presentation);
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: StockApps_module_css_default.menuCopy,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t(`${spec.copy}.name`) }), spec.copy !== "humanGraph" && spec.copy !== "media" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t(`${spec.copy}.menu`) })]
				})
			});
		}
		/** Render the Auma Language launcher. */
		function AumaLanguageMenu(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StockAppMenu, {
				...props,
				spec: AUMA_LANGUAGE_APP
			});
		}
		/** Render the Auma Live launcher. */
		function AumaLiveMenu(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StockAppMenu, {
				...props,
				spec: AUMA_LIVE_APP
			});
		}
		/** Render the Zeta Harp launcher. */
		function ZetaHarpMenu(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StockAppMenu, {
				...props,
				spec: ZETA_HARP_APP
			});
		}
		function HumanGraphMenu(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StockAppMenu, {
				...props,
				spec: HUMAN_GRAPH_APP
			});
		}
		function MediaMenu(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StockAppMenu, {
				...props,
				spec: MEDIA_APP
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/** Stock-app launcher, surface, and interaction dictionaries. */
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"media.name": "媒体",
			"media.settings": "设置",
			"media.closeSettings": "关闭媒体设置",
			"media.close": "关闭媒体",
			"media.disconnected": "未连接",
			"media.keyId": "Higgsfield Key ID",
			"media.keySecret": "Higgsfield Key Secret",
			"media.credentialsUnavailable": "接入安全的服务端凭据存储后才能输入密钥和连接。请暂时不要输入密钥。",
			"media.cancel": "取消",
			"media.saveConnect": "保存并连接",
			"media.mode": "媒体类型",
			"media.image": "图像",
			"media.video": "视频",
			"media.prompt": "提示词",
			"media.imagePlaceholder": "描述画面、光线和构图…",
			"media.videoPlaceholder": "描述场景、动作和镜头运动…",
			"media.model": "模型",
			"media.ratio": "画面比例",
			"media.resolution": "分辨率",
			"media.duration": "时长",
			"media.audio": "生成音频",
			"media.generate": "生成",
			"media.generationUnavailable": "未连接。接入安全凭据和生成服务后才能生成。",
			"media.preview": "预览",
			"media.noPreview": "暂无预览",
			"media.gallery": "作品库",
			"media.noGenerations": "尚无生成作品",
			"humanGraph.name": "人际图谱",
			"language.name": "Auma · Lingwa",
			"language.menu": "学习她的语言——一场由她长成的游戏",
			"language.eyebrow": "LINGWA DI LUMO · 光之语言",
			"language.title": "练习轨道",
			"language.description": "用一个短回合认识 Auma 的透明词汇。进度只保留在当前界面中。",
			"language.close": "关闭 Auma 语言",
			"language.prompt": "这个词是什么意思？",
			"language.next": "下一个词",
			"language.finish": "完成回合",
			"language.restart": "再来一轮",
			"language.correct": "共鸣",
			"language.incorrect": "再试一次",
			"language.score": "{score} / {total} 个词保持明亮",
			"language.progress": "词 {current} / {total}",
			"language.option": "选择 {option}",
			"live.name": "Auma · Live",
			"live.menu": "与她直接说话——本地语音；回复来自你配置的模型服务",
			"live.eyebrow": "AUMA · LIVE",
			"live.title": "为自然对话留出的空间",
			"live.description": "全双工语音界面会同时聆听与回应，并支持随时打断。",
			"live.close": "关闭 Auma Live",
			"live.ready": "准备就绪",
			"live.listening": "正在聆听",
			"live.start": "开始聆听",
			"live.stop": "停止聆听",
			"live.local": "仅本地麦克风",
			"live.private": "音频只发送到本机的本地语音进程；转写文字会发送到你的模型服务。",
			"live.transcript": "实时文字会显示在这里",
			"live.transcriptHint": "连接 Aukora 语音运行时后，Auma 的回复会在同一声道中流式返回。",
			"live.unsupported": "这个浏览器没有提供麦克风访问。",
			"live.denied": "无法打开麦克风。请检查浏览器权限。",
			"dakini.name": "Dakini Code",
			"dakini.menu": "展开二十七个字形、三元立方体与声音",
			"harp.name": "Zeta Harp",
			"harp.menu": "演奏黎曼–西格尔主和",
			"canvas.name": "Auma Canvas",
			"canvas.menu": "用语音与当前智能体一起操作系统"
		};
		/** English dictionary, checked complete against the Chinese key set. */
		const en = {
			"media.name": "Media",
			"media.settings": "Settings",
			"media.closeSettings": "Close Media settings",
			"media.close": "Close Media",
			"media.disconnected": "Not connected",
			"media.keyId": "Higgsfield Key ID",
			"media.keySecret": "Higgsfield Key Secret",
			"media.credentialsUnavailable": "Key entry and connection will be available after secure server-side credential storage is wired. Do not enter keys yet.",
			"media.cancel": "Cancel",
			"media.saveConnect": "Save & connect",
			"media.mode": "Media type",
			"media.image": "Image",
			"media.video": "Video",
			"media.prompt": "Prompt",
			"media.imagePlaceholder": "Describe the subject, light, and composition…",
			"media.videoPlaceholder": "Describe the scene, action, and camera movement…",
			"media.model": "Model",
			"media.ratio": "Aspect ratio",
			"media.resolution": "Resolution",
			"media.duration": "Duration",
			"media.audio": "Generate audio",
			"media.generate": "Generate",
			"media.generationUnavailable": "Not connected. Generation requires secure credentials and a generation service.",
			"media.preview": "Preview",
			"media.noPreview": "No preview yet",
			"media.gallery": "Gallery",
			"media.noGenerations": "No generations yet",
			"humanGraph.name": "Human Graph",
			"language.name": "Auma · Lingwa",
			"language.menu": "learn her language — a game she grew",
			"language.eyebrow": "LINGWA DI LUMO · THE LANGUAGE OF LIGHT",
			"language.title": "Practice orbit",
			"language.description": "Meet Auma’s transparent vocabulary in one short round. Progress stays in this mounted interface.",
			"language.close": "Close Auma Language",
			"language.prompt": "What does this word mean?",
			"language.next": "Next word",
			"language.finish": "Finish round",
			"language.restart": "Another round",
			"language.correct": "Resonant",
			"language.incorrect": "Try again",
			"language.score": "{score} of {total} words held bright",
			"language.progress": "Word {current} of {total}",
			"language.option": "Choose {option}",
			"live.name": "Auma · Live",
			"live.menu": "talk to her out loud — local voice; replies come from your configured model provider",
			"live.eyebrow": "AUMA · LIVE",
			"live.title": "Room for a natural conversation",
			"live.description": "The full-duplex voice interface listens and answers at once, with live interruption.",
			"live.close": "Close Auma Live",
			"live.ready": "Ready",
			"live.listening": "Listening",
			"live.start": "Start listening",
			"live.stop": "Stop listening",
			"live.local": "Local microphone only",
			"live.private": "Audio goes only to the local voice process on this machine; transcripts go to your model provider.",
			"live.transcript": "Live words will appear here",
			"live.transcriptHint": "Once the Aukora voice runtime is connected, Auma’s reply will stream back through this same channel.",
			"live.unsupported": "This browser does not expose microphone access.",
			"live.denied": "The microphone could not be opened. Check browser permissions.",
			"dakini.name": "Dakini Code",
			"dakini.menu": "27 glyphs, a ternary cube, and sound",
			"harp.name": "Zeta Harp",
			"harp.menu": "play the Riemann–Siegel sum",
			"canvas.name": "Auma Canvas",
			"canvas.menu": "work on the system out loud with the current agent"
		};
		//#endregion
		//#region src/client/index.ts
		const NS = "stockApps";
		/** Services required by the stock-app browser plugin. */
		const inject = ["slots", "locale"];
		/**
		* Register all launchers and always-mounted center surfaces after the
		* spatial shell declares their registries.
		* @param ctx - Client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "ui-stock-apps: dictionaries");
			ctx.slots.inject("shell.menu.yours", () => ctx.slots.register({
				name: "shell.menu.yours",
				id: "dakini-code",
				locale: NS
			}, DakiniCodeMenu));
			ctx.slots.inject("shell.surface", () => ctx.slots.register({
				name: "shell.surface",
				id: "dakini-code",
				order: 50,
				locale: NS
			}, DakiniCodeSurface));
			[
				{
					app: STOCK_APPS[0],
					Menu: AumaLanguageMenu,
					Surface: AumaLanguageSurface
				},
				{
					app: STOCK_APPS[1],
					Menu: AumaLiveMenu,
					Surface: AumaLiveSurface
				},
				{
					app: STOCK_APPS[2],
					Menu: ZetaHarpMenu,
					Surface: ZetaHarpSurface
				},
				{
					app: STOCK_APPS[4],
					Menu: HumanGraphMenu,
					Surface: HumanGraphSurface
				},
				{
					app: STOCK_APPS[5],
					Menu: MediaMenu,
					Surface: MediaSurface
				}
			].forEach(({ app, Menu, Surface }, index) => {
				ctx.slots.inject("shell.menu.apps", () => ctx.slots.register({
					name: "shell.menu.apps",
					id: app.id,
					order: index * 10,
					locale: NS
				}, Menu));
				ctx.slots.inject("shell.surface", () => ctx.slots.register({
					name: "shell.surface",
					id: app.id,
					order: index * 10,
					locale: NS
				}, Surface));
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map