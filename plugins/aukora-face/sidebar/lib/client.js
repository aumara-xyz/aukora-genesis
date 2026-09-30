window.__ModuleLoader__.load({
	id: "@aukora/face-sidebar",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
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
		//#region \0dsh-css:SidebarRoot.module.css.mjs
		const css = ".zGTtba_root{height:100%;padding:6px var(--dsh-sidebar-inline-padding);box-sizing:border-box;background:var(--dsw-specific-sidebar-fill);color:var(--dsw-alias-label-primary);flex-direction:column;font-size:14px;display:flex}.zGTtba_root.zGTtba_collapsed{padding:18px 10px 6px}.zGTtba_fading>*{opacity:0;transition:opacity .15s var(--ds-ease-in-out)}.zGTtba_wide{animation:zGTtba_wide-in .2s var(--ds-ease-in-out)}@keyframes zGTtba_wide-in{0%{opacity:0}}.zGTtba_railIn .zGTtba_regionArea{animation:zGTtba_rail-in .15s var(--ds-ease-in-out) backwards}.zGTtba_railIn .zGTtba_footArea{animation:zGTtba_rail-fade-in .15s var(--ds-ease-in-out) backwards}@keyframes zGTtba_rail-in{0%{opacity:0;transform:translate(49px)}}@keyframes zGTtba_rail-fade-in{0%{opacity:0}}.zGTtba_logoRow{height:60px;padding:8px 0 8px 4px;padding-right:calc(var(--dsh-hot-corner-size,74px) + var(--dsh-hot-corner-gutter,10px) - var(--dsh-sidebar-inline-padding));box-sizing:border-box;flex:none;justify-content:flex-end;align-items:center;gap:8px;margin-bottom:8px;display:flex;overflow:hidden}.zGTtba_collapsed .zGTtba_logoRow{justify-content:flex-start;height:36px;margin-bottom:12px;padding:0}.zGTtba_brand{min-width:0;color:inherit;cursor:default;background:0 0;border:none;flex:1;align-items:center;padding:0;display:inline-flex;overflow:hidden}.zGTtba_brandIdentity{align-items:center;gap:8px;min-width:0;height:24px;display:inline-flex}.zGTtba_brandMark{flex:none;justify-content:center;align-items:center;display:inline-flex}.zGTtba_brandName{letter-spacing:.04em;align-items:center;gap:6px;min-width:0;height:24px;font-size:18px;font-weight:600;line-height:24px;display:inline-flex}.zGTtba_fallbackBrandName{letter-spacing:0;white-space:nowrap;font-size:17px}.zGTtba_headerActions{flex:none;align-items:center;min-width:0;display:flex}.zGTtba_regionArea{min-height:0;margin-left:-4px;margin-right:calc(-1 * var(--dsh-sidebar-inline-padding));flex-direction:column;flex:1;padding-left:4px;display:flex;overflow:hidden}.zGTtba_collapsed .zGTtba_regionArea{margin-left:0;margin-right:0;padding-left:0}.zGTtba_footArea{flex-direction:column;flex:none;display:flex}.zGTtba_footerActions{flex:none;width:100%;min-width:0;display:flex}.zGTtba_collapsed .zGTtba_footArea{align-items:center}.zGTtba_collapsed .zGTtba_footerActions{justify-content:center;width:auto;display:flex}@media (prefers-reduced-motion:reduce){.zGTtba_wide,.zGTtba_fading>*,.zGTtba_railIn .zGTtba_footArea,.zGTtba_railIn .zGTtba_regionArea{transition:none;animation:none}}";
		const tagId = "@aukora/face-sidebar/SidebarRoot.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@aukora/face-sidebar";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var SidebarRoot_module_css_default = {
			"brand": "zGTtba_brand",
			"brandIdentity": "zGTtba_brandIdentity",
			"brandMark": "zGTtba_brandMark",
			"brandName": "zGTtba_brandName",
			"collapsed": "zGTtba_collapsed",
			"fading": "zGTtba_fading",
			"fallbackBrandName": "zGTtba_fallbackBrandName",
			"footArea": "zGTtba_footArea",
			"footerActions": "zGTtba_footerActions",
			"headerActions": "zGTtba_headerActions",
			"logoRow": "zGTtba_logoRow",
			"rail-fade-in": "zGTtba_rail-fade-in",
			"rail-in": "zGTtba_rail-in",
			"railIn": "zGTtba_railIn",
			"regionArea": "zGTtba_regionArea",
			"root": "zGTtba_root",
			"wide": "zGTtba_wide",
			"wide-in": "zGTtba_wide-in"
		};
		//#endregion
		//#region src/client/SidebarRoot.tsx
		/**
		* Thread-list shell with AUKORA identity, header and footer action holes,
		* workspace content, and pointer-scoped scrollbars. AppFrame owns pane
		* navigation and Settings lives in its right-side System menu.
		*/
		/** Wide-content unmount delay; matches the 150ms wide-content fade-out. */
		const COLLAPSE_SETTLE_MS = 150;
		/**
		* How long the column's scrollbars stay drawn after the pointer leaves it.
		* The bar is a pointer affordance here, and hiding it on the leave event
		* itself makes it blink out while the pointer is only crossing the column's
		* edge — on the way to the conversation, or around a portalled menu.
		*/
		const SCROLLBAR_LINGER_MS = 2e3;
		/**
		* Render the sidebar column shell.
		* @param props - composed slot props (runtime share + injected callbacks, contract/slots.ts).
		* @returns the sidebar element tree.
		*/
		function SidebarRoot({ collapsed, width, toggleSidebar, renderSlot }) {
			const [settled, setSettled] = (0, react.useState)(collapsed);
			(0, react.useEffect)(() => {
				if (!collapsed) {
					setSettled(false);
					return;
				}
				const timer = window.setTimeout(() => {
					setSettled(true);
				}, COLLAPSE_SETTLE_MS);
				return () => {
					window.clearTimeout(timer);
				};
			}, [collapsed]);
			const wide = !collapsed || !settled;
			const lastWideWidth = (0, react.useRef)(width);
			if (!collapsed) lastWideWidth.current = width;
			const everWide = (0, react.useRef)(!collapsed);
			if (!collapsed) everWide.current = true;
			const column = (0, react.useRef)(null);
			const [pointerInside, setPointerInside] = (0, react.useState)(false);
			const lingerTimer = (0, react.useRef)(void 0);
			const armLinger = () => {
				if (lingerTimer.current !== void 0) return;
				lingerTimer.current = window.setTimeout(() => {
					lingerTimer.current = void 0;
					setPointerInside(false);
				}, SCROLLBAR_LINGER_MS);
			};
			const cancelLinger = () => {
				window.clearTimeout(lingerTimer.current);
				lingerTimer.current = void 0;
			};
			(0, react.useEffect)(() => {
				if (!pointerInside) return;
				const onMove = (event) => {
					const rect = column.current?.getBoundingClientRect();
					/* v8 ignore next -- the listener only exists while the column is mounted and revealed. */
					if (rect === void 0) return;
					if (event.clientX >= rect.left && event.clientX < rect.right && event.clientY >= rect.top && event.clientY < rect.bottom) cancelLinger();
					else armLinger();
				};
				document.addEventListener("pointermove", onMove);
				return () => {
					document.removeEventListener("pointermove", onMove);
					cancelLinger();
				};
			}, [pointerInside]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: column,
				className: clsx(SidebarRoot_module_css_default.root, !wide && SidebarRoot_module_css_default.collapsed, !wide && everWide.current && SidebarRoot_module_css_default.railIn, collapsed && wide && SidebarRoot_module_css_default.fading, !pointerInside && SidebarRoot_module_css_default.quietBars),
				style: wide ? { width: collapsed ? lastWideWidth.current : width } : void 0,
				onPointerEnter: () => {
					cancelLinger();
					setPointerInside(true);
				},
				onPointerLeave: () => {
					armLinger();
				},
				children: [
					wide && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: SidebarRoot_module_css_default.logoRow,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: clsx(SidebarRoot_module_css_default.brand, SidebarRoot_module_css_default.wide),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: SidebarRoot_module_css_default.brandIdentity,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: SidebarRoot_module_css_default.brandMark,
									children: renderSlot("sidebar.brand.mark", { size: 28 }, { fallback: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
										src: "/branding/aumara-icon-96.png",
										width: "28",
										height: "28",
										alt: ""
									}) })
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: SidebarRoot_module_css_default.brandName,
									children: renderSlot("sidebar.brand.name", {}, { fallback: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: SidebarRoot_module_css_default.fallbackBrandName,
										children: "AUKORA"
									}) })
								})]
							})
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: clsx(SidebarRoot_module_css_default.headerActions, SidebarRoot_module_css_default.wide),
							children: renderSlot("sidebar.header.actions", {})
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: SidebarRoot_module_css_default.regionArea,
						children: renderSlot("sidebar.workspaces", {
							wide,
							expandSidebar: () => {
								if (collapsed) toggleSidebar();
							}
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: SidebarRoot_module_css_default.footArea,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: SidebarRoot_module_css_default.footerActions,
							children: renderSlot("sidebar.footer.action", { wide })
						})
					})
				]
			});
		}
		//#endregion
		//#region src/client/index.ts
		/** Services required by the sidebar plugin. */
		const inject = ["slots", "layout"];
		/** Registers the sidebar shell and its service callbacks.
		* @param ctx - Client root context.
		*/
		function apply(ctx) {
			const injectProps = () => ({ toggleSidebar: () => {
				ctx.layout.toggleSidebar();
			} });
			ctx.effect(() => ctx.slots.register({
				name: "sidebar",
				children: {
					"sidebar.brand.mark": {
						kind: "single",
						scope: "root"
					},
					"sidebar.brand.name": {
						kind: "single",
						scope: "root"
					},
					"sidebar.header.actions": {
						kind: "list",
						scope: "root"
					},
					"sidebar.workspaces": {
						kind: "single",
						scope: "root"
					},
					"sidebar.footer.action": {
						kind: "list",
						scope: "root"
					}
				},
				inject: injectProps
			}, SidebarRoot), "ui-sidebar: slot registration");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map