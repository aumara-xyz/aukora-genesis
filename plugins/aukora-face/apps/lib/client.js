window.__ModuleLoader__.load({
	id: "@aukora/face-apps",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region \0dsh-css:StockApps.module.css.mjs
		const css = ".NQINWW_surfaceSeat{border-radius:inherit;background:var(--dsw-specific-spatial-canvas,#111520);width:100%;min-width:0;height:100%;min-height:0;position:absolute;inset:0;overflow:hidden}.NQINWW_surfaceSeat:not([data-active]){visibility:hidden;pointer-events:none}.NQINWW_embeddedFrame{background:var(--dsw-specific-spatial-canvas,#111520);border:0;width:100%;height:100%;display:block}.NQINWW_menuCopy{flex-direction:column;align-items:flex-end;gap:2px;width:100%;min-width:0;max-width:100%;display:flex}.NQINWW_menuCopy strong{font-size:var(--dsh-spatial-menu-title-size,14px);line-height:var(--dsh-spatial-menu-title-line-height,20px);font-weight:570}.NQINWW_menuCopy span{width:100%;max-width:100%;color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-spatial-menu-description-size,12px);line-height:var(--dsh-spatial-menu-description-line-height,18px);text-align:right;text-overflow:ellipsis;white-space:nowrap;display:block;overflow:hidden}";
		const tagId = "@aukora/face-apps/StockApps.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@aukora/face-apps";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var StockApps_module_css_default = {
			"embeddedFrame": "NQINWW_embeddedFrame",
			"menuCopy": "NQINWW_menuCopy",
			"surfaceSeat": "NQINWW_surfaceSeat"
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
		const STOCK_APPS = [
			AUMA_LANGUAGE_APP,
			AUMA_LIVE_APP,
			ZETA_HARP_APP,
			{
				id: "auma-canvas",
				copy: "canvas",
				presentation: "full-bleed"
			}
		];
		function StockAppMenu({ spec, activeSurface, openSurface, t }) {
			const active = activeSurface === spec.id;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				"data-stock-app-launcher": spec.id,
				"aria-current": active ? "page" : void 0,
				onClick: () => {
					openSurface(spec.id, void 0, spec.presentation);
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: StockApps_module_css_default.menuCopy,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t(`${spec.copy}.name`) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t(`${spec.copy}.menu`) })]
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
		//#endregion
		//#region src/client/locales.ts
		/** Stock-app launcher, surface, and interaction dictionaries. */
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
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