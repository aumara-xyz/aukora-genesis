window.__ModuleLoader__.load({
	id: "@aukora/face-documents",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
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
		//#region src/client/DocumentsIcons.tsx
		/** Plain document sheet with a folded corner. */
		function DocumentIcon({ size = 16, className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				className,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M3.5 1.8h5.2l3.8 3.8v8.6H3.5z",
					stroke: "currentColor",
					strokeWidth: "1.4",
					strokeLinejoin: "round"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M8.7 1.8v3.8h3.8",
					stroke: "currentColor",
					strokeWidth: "1.4",
					strokeLinejoin: "round"
				})]
			});
		}
		/** Search glass for the lane's search seat. */
		function SearchIcon({ size = 16, className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				className,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					cx: "7",
					cy: "7",
					r: "4.2",
					stroke: "currentColor",
					strokeWidth: "1.4"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "m10.2 10.2 3 3",
					stroke: "currentColor",
					strokeWidth: "1.4",
					strokeLinecap: "round"
				})]
			});
		}
		/** Back chevron for the open-document return, top-left as in the thread view. */
		function BackIcon({ size = 16, className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: size,
				height: size,
				className,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M10 3 5 8l5 5",
					stroke: "currentColor",
					strokeWidth: "1.4",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			});
		}
		/** Folder mark beside the DOCUMENTS brand name. */
		function FolderMarkIcon({ size = 22, className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: size,
				height: size,
				className,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M1.9 4.2a1 1 0 0 1 1-1h3l1.3 1.6h6.9a1 1 0 0 1 1 1v6.4a1 1 0 0 1-1 1H2.9a1 1 0 0 1-1-1z",
					stroke: "currentColor",
					strokeWidth: "1.4",
					strokeLinejoin: "round"
				})
			});
		}
		//#endregion
		//#region \0dsh-css:Documents.module.css.mjs
		const css = ".uR2k1G_surface{width:100%;min-width:0;height:100%;min-height:0;padding:6px var(--dsh-documents-inline-padding);box-sizing:border-box;color:var(--dsw-alias-label-primary);background:0 0;flex-direction:column;display:flex;overflow:hidden;container-type:inline-size}.uR2k1G_surface[hidden]{display:none}.uR2k1G_lane{box-sizing:border-box;flex-direction:column;flex:1;width:100%;min-height:0;display:flex}.uR2k1G_brandRow{height:60px;padding:8px 0 8px 4px;padding-right:calc(var(--dsh-hot-corner-size,74px) + var(--dsh-hot-corner-gutter,10px) - var(--dsh-documents-inline-padding));box-sizing:border-box;flex:none;align-items:center;gap:8px;margin-bottom:8px;display:flex;overflow:hidden}.uR2k1G_brandName{letter-spacing:.04em;text-transform:uppercase;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;margin:0;font-size:18px;font-weight:600;line-height:24px;overflow:hidden}.uR2k1G_posture{color:var(--dsw-static-spatial-gold);flex:none;align-items:center;gap:7px;margin:0 0 4px;padding:0 4px;font-size:12px;line-height:17px;display:flex}.uR2k1G_posture:before{content:\"\";background:var(--dsw-static-spatial-gold);border-radius:999px;flex:none;width:6px;height:6px}.uR2k1G_postureCode{font-family:var(--dsw-font-family-mono,var(--ds-font-family-code,ui-monospace, SFMono-Regular, Menlo, monospace));color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;font-size:11px}.uR2k1G_textButton{height:26px;font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:0 0;border-radius:999px;flex:none;padding:0 12px;font-size:12px;line-height:26px}.uR2k1G_textButton:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.uR2k1G_textButton:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:1px}.uR2k1G_textButton:disabled{cursor:default;opacity:.55}.uR2k1G_searchRow{flex:none;align-items:center;gap:6px;margin-bottom:6px;padding:0 4px;display:flex}.uR2k1G_searchMark{color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;display:inline-flex}.uR2k1G_searchInput{box-sizing:border-box;min-width:0;height:28px;font:inherit;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);background:0 0;border-radius:9px;outline:none;flex:1;padding:0 10px;font-size:13px}.uR2k1G_searchInput:focus-visible{border-color:color-mix(in srgb, var(--dsw-static-spatial-gold) 58%, transparent)}.uR2k1G_categoryRow{flex-wrap:wrap;flex:none;gap:6px;margin-bottom:10px;padding:0 4px;display:flex}.uR2k1G_categoryChip{height:26px;font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:0 0;border-radius:999px;padding:0 12px;font-size:12px;line-height:26px}.uR2k1G_categoryChip:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.uR2k1G_categoryChip:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:1px}.uR2k1G_categoryChip[aria-pressed=true]{color:var(--dsw-alias-label-primary);border-color:color-mix(in srgb, var(--dsw-static-spatial-gold) 52%, transparent);background:color-mix(in srgb, var(--dsw-static-spatial-gold) 13%, transparent)}.uR2k1G_grid{scrollbar-gutter:stable;flex-direction:column;flex:1;gap:14px;min-height:0;padding:0 4px 12px;display:flex;overflow-y:auto}.uR2k1G_group{flex-direction:column;gap:8px;display:flex}.uR2k1G_groupHeading{letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);align-items:baseline;gap:8px;margin:0;font-size:12px;font-weight:600;line-height:17px;display:flex}.uR2k1G_groupCount{letter-spacing:0;text-transform:none;color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:400}.uR2k1G_portals{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;display:grid}@container (width<=868px){.uR2k1G_portals{grid-template-columns:minmax(0,1fr)}}.uR2k1G_portal{box-sizing:border-box;text-align:left;min-height:68px;color:var(--dsw-alias-label-primary);cursor:pointer;border:1px solid color-mix(in srgb, var(--dsw-static-spatial-gold) 28%, transparent);transition:transform .2s var(--ds-ease-in-out), border-color .25s var(--ds-ease-in-out), box-shadow .25s var(--ds-ease-in-out);background:0 0;border-radius:14px;align-items:flex-start;gap:10px;padding:12px 16px;display:flex}.uR2k1G_portal:hover{transform:translate(3px)}.uR2k1G_portal:focus-visible{border-color:color-mix(in srgb, var(--dsw-static-spatial-gold) 58%, transparent);box-shadow:0 0 14px color-mix(in srgb, var(--dsw-static-spatial-gold) 14%, transparent);outline:none}.uR2k1G_portalMark{width:30px;height:30px;color:var(--dsw-static-spatial-gold);background:color-mix(in srgb, var(--dsw-static-spatial-gold) 16%, transparent);border-radius:10px;flex:none;justify-content:center;align-items:center;display:inline-flex}.uR2k1G_portalCopy{flex-direction:column;gap:2px;min-width:0;display:flex}.uR2k1G_portalTitle{font-size:14px;font-weight:570;line-height:20px}.uR2k1G_portalPath{font-family:var(--dsw-font-family-mono,var(--ds-font-family-code,ui-monospace, SFMono-Regular, Menlo, monospace));color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;font-size:11px;line-height:16px}.uR2k1G_portalMeta{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}.uR2k1G_listEmpty{color:var(--dsw-alias-label-tertiary);margin:0;padding:8px;font-size:13px;line-height:19px}.uR2k1G_reader{width:min(100%,720px);min-height:0;padding-top:calc(var(--dsh-hot-corner-size,74px) * .4);box-sizing:border-box;flex-direction:column;flex:1;gap:10px;margin:0 auto;display:flex}.uR2k1G_readerHeader{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:0 0;border-radius:16px;flex:none;align-items:center;gap:8px;min-height:50px;padding:8px 12px;display:flex}@container (width<=868px){.uR2k1G_readerHeader{padding-inline:74px}}.uR2k1G_readerTitle{text-align:center;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;margin:0;font-size:14px;font-weight:600;line-height:20px;overflow:hidden}.uR2k1G_iconButton{width:28px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:9px;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.uR2k1G_iconButton:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.uR2k1G_iconButton:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:1px}.uR2k1G_readerMeta{color:var(--dsw-alias-label-tertiary);flex:none;align-items:center;gap:6px;padding:0 12px;font-size:11px;line-height:16px;display:flex}.uR2k1G_readerBody{scrollbar-gutter:stable;flex-direction:column;flex:1;gap:18px;min-height:0;padding:4px 12px 16px;display:flex;overflow-y:auto}.uR2k1G_markdownHeading{color:var(--dsw-alias-label-primary);margin:12px 0 0;font-size:17px;font-weight:600;line-height:24px}.uR2k1G_markdownParagraph{max-width:68ch;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;margin:0;font-size:15px;line-height:23px}.uR2k1G_markdownList{max-width:68ch;color:var(--dsw-alias-label-secondary);margin:0;padding-left:22px;font-size:15px;line-height:23px}.uR2k1G_markdownQuote{max-width:68ch;color:var(--dsw-alias-label-secondary);border-left:2px solid color-mix(in srgb, var(--dsw-static-spatial-gold) 42%, transparent);margin:0;padding:2px 0 2px 12px;font-size:15px;line-height:23px}.uR2k1G_markdownFigure{flex-direction:column;gap:4px;margin:0;display:flex}.uR2k1G_markdownCaption{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}.uR2k1G_markdownPre{font-family:var(--dsw-font-family-mono,var(--ds-font-family-code,ui-monospace, SFMono-Regular, Menlo, monospace));color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;margin:0;padding:10px 12px;font-size:12px;line-height:19px;overflow-x:auto}.uR2k1G_markdownInlineCode{font-family:var(--dsw-font-family-mono,var(--ds-font-family-code,ui-monospace, SFMono-Regular, Menlo, monospace));background:var(--dsw-alias-interactive-bg-hover);border-radius:6px;padding:1px 5px;font-size:12px}.uR2k1G_markdownLink{color:var(--dsw-static-spatial-gold);text-underline-offset:2px;text-decoration:underline}.uR2k1G_markdownTable{border-collapse:collapse;max-width:68ch;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:19px}.uR2k1G_markdownTable th,.uR2k1G_markdownTable td{text-align:left;border:1px solid var(--dsw-alias-border-l2);padding:4px 10px}.uR2k1G_markdownRule{border:none;border-top:1px solid var(--dsw-alias-border-l2);width:100%;margin:4px 0}.uR2k1G_failure{border:1px solid color-mix(in srgb, var(--dsw-static-spatial-gold) 42%, transparent);border-radius:14px;flex-direction:column;gap:6px;margin:4px 0 0;padding:12px 14px;display:flex}.uR2k1G_failureTitle{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:19px}.uR2k1G_failureReason{font-family:var(--dsw-font-family-mono,var(--ds-font-family-code,ui-monospace, SFMono-Regular, Menlo, monospace));color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;font-size:12px;line-height:18px}.uR2k1G_failureHint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.uR2k1G_menuItem,.uR2k1G_menuItemActive{text-align:left;width:100%;color:inherit;cursor:pointer;background:0 0;border:none;align-items:center;gap:8px;padding:0;display:flex}.uR2k1G_menuMark{color:var(--dsw-static-spatial-gold);flex:none;justify-content:center;align-items:center;display:inline-flex}.uR2k1G_menuCopy{flex-direction:column;gap:2px;min-width:0;display:flex}.uR2k1G_menuCopy strong{text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:570;line-height:20px;overflow:hidden}.uR2k1G_menuCopy span{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:17px;overflow:hidden}.uR2k1G_visuallyHidden{clip:rect(0 0 0 0);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}";
		const tagId = "@aukora/face-documents/Documents.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@aukora/face-documents";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var Documents_module_css_default = {
			"brandName": "uR2k1G_brandName",
			"brandRow": "uR2k1G_brandRow",
			"categoryChip": "uR2k1G_categoryChip",
			"categoryRow": "uR2k1G_categoryRow",
			"failure": "uR2k1G_failure",
			"failureHint": "uR2k1G_failureHint",
			"failureReason": "uR2k1G_failureReason",
			"failureTitle": "uR2k1G_failureTitle",
			"grid": "uR2k1G_grid",
			"group": "uR2k1G_group",
			"groupCount": "uR2k1G_groupCount",
			"groupHeading": "uR2k1G_groupHeading",
			"iconButton": "uR2k1G_iconButton",
			"lane": "uR2k1G_lane",
			"listEmpty": "uR2k1G_listEmpty",
			"markdownCaption": "uR2k1G_markdownCaption",
			"markdownFigure": "uR2k1G_markdownFigure",
			"markdownHeading": "uR2k1G_markdownHeading",
			"markdownInlineCode": "uR2k1G_markdownInlineCode",
			"markdownLink": "uR2k1G_markdownLink",
			"markdownList": "uR2k1G_markdownList",
			"markdownParagraph": "uR2k1G_markdownParagraph",
			"markdownPre": "uR2k1G_markdownPre",
			"markdownQuote": "uR2k1G_markdownQuote",
			"markdownRule": "uR2k1G_markdownRule",
			"markdownTable": "uR2k1G_markdownTable",
			"menuCopy": "uR2k1G_menuCopy",
			"menuItem": "uR2k1G_menuItem",
			"menuItemActive": "uR2k1G_menuItemActive",
			"menuMark": "uR2k1G_menuMark",
			"portal": "uR2k1G_portal",
			"portalCopy": "uR2k1G_portalCopy",
			"portalMark": "uR2k1G_portalMark",
			"portalMeta": "uR2k1G_portalMeta",
			"portalPath": "uR2k1G_portalPath",
			"portalTitle": "uR2k1G_portalTitle",
			"portals": "uR2k1G_portals",
			"posture": "uR2k1G_posture",
			"postureCode": "uR2k1G_postureCode",
			"reader": "uR2k1G_reader",
			"readerBody": "uR2k1G_readerBody",
			"readerHeader": "uR2k1G_readerHeader",
			"readerMeta": "uR2k1G_readerMeta",
			"readerTitle": "uR2k1G_readerTitle",
			"searchInput": "uR2k1G_searchInput",
			"searchMark": "uR2k1G_searchMark",
			"searchRow": "uR2k1G_searchRow",
			"surface": "uR2k1G_surface",
			"textButton": "uR2k1G_textButton",
			"visuallyHidden": "uR2k1G_visuallyHidden"
		};
		//#endregion
		//#region src/client/DocumentsMenu.tsx
		/** Text-only Documents entry in the shell's triangle Aukora Apps menu. */
		/**
		* Open the Documents portal grid.
		* @param props - Apps-menu owner share and localized copy.
		* @returns the Documents launcher button.
		*/
		function DocumentsMenu({ activeSurface, openSurface, t }) {
			const active = activeSurface === "documents";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				"data-documents-launcher": true,
				className: clsx(Documents_module_css_default.menuItem, active && Documents_module_css_default.menuItemActive),
				"aria-current": active ? "page" : void 0,
				onClick: () => {
					openSurface("documents");
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: Documents_module_css_default.menuMark,
					"aria-hidden": "true",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FolderMarkIcon, { size: 16 })
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: Documents_module_css_default.menuCopy,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("menu.title") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("menu.description") })]
				})]
			});
		}
		//#endregion
		//#region src/client/MarkdownView.tsx
		/** The heading element for a level, clamped to the six that exist. */
		const HEADINGS = [
			"h1",
			"h2",
			"h3",
			"h4",
			"h5",
			"h6"
		];
		/**
		* Render inline content.
		* @param nodes - the inline nodes.
		* @param keyPrefix - a stable prefix so siblings keep identity across renders.
		* @returns the rendered nodes.
		*/
		function renderInline(nodes, keyPrefix) {
			return nodes.map((node, index) => {
				const key = `${keyPrefix}.${String(index)}`;
				switch (node.kind) {
					case "text": return node.text;
					case "code": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
						className: Documents_module_css_default.markdownInlineCode,
						children: node.text
					}, key);
					case "strong": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: renderInline(node.children, key) }, key);
					case "emphasis": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("em", { children: renderInline(node.children, key) }, key);
					case "link": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
						className: Documents_module_css_default.markdownLink,
						href: node.href,
						target: "_blank",
						rel: "noreferrer noopener",
						children: renderInline(node.children, key)
					}, key);
				}
			});
		}
		/**
		* Render one document's markdown.
		* @param props - the parsed blocks.
		* @returns the rendered document body.
		*/
		function MarkdownView({ blocks }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: blocks.map((block, index) => {
				const key = `block.${String(index)}`;
				switch (block.kind) {
					case "heading": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(HEADINGS[block.level - 1] ?? "h6", {
						className: Documents_module_css_default.markdownHeading,
						children: renderInline(block.children, key)
					}, key);
					case "paragraph": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: Documents_module_css_default.markdownParagraph,
						children: renderInline(block.children, key)
					}, key);
					case "code": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("figure", {
						className: Documents_module_css_default.markdownFigure,
						children: [block.language === "" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("figcaption", {
							className: Documents_module_css_default.markdownCaption,
							children: block.language
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
							className: Documents_module_css_default.markdownPre,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: block.text })
						})]
					}, key);
					case "quote": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("blockquote", {
						className: Documents_module_css_default.markdownQuote,
						children: renderInline(block.children, key)
					}, key);
					case "list": return block.ordered ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ol", {
						className: Documents_module_css_default.markdownList,
						children: block.items.map((item, at) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: renderInline(item, `${key}.${String(at)}`) }, `${key}.${String(at)}`))
					}, key) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: Documents_module_css_default.markdownList,
						children: block.items.map((item, at) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: renderInline(item, `${key}.${String(at)}`) }, `${key}.${String(at)}`))
					}, key);
					case "table": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
						className: Documents_module_css_default.markdownTable,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tr", { children: block.header.map((cell, at) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: renderInline(cell, `${key}.h${String(at)}`) }, `${key}.h${String(at)}`)) }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: block.rows.map((row, rowAt) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tr", { children: row.map((cell, at) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: renderInline(cell, `${key}.r${String(rowAt)}c${String(at)}`) }, `${key}.r${String(rowAt)}c${String(at)}`)) }, `${key}.r${String(rowAt)}`)) })]
					}, key);
					case "rule": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("hr", { className: Documents_module_css_default.markdownRule }, key);
				}
			}) });
		}
		//#endregion
		//#region src/client/markdown.ts
		/** How deep inline nesting is followed before the rest is kept as text. */
		const INLINE_DEPTH_LIMIT = 4;
		const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/u;
		const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/u;
		const RULE = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/u;
		const QUOTE = /^ {0,3}> ?(.*)$/u;
		const BULLET = /^ {0,3}[-*+] +(.*)$/u;
		const ORDERED = /^ {0,3}\d{1,9}[.)] +(.*)$/u;
		const TABLE_ROW = /^ {0,3}\|.*\|[ \t]*$/u;
		const TABLE_DIVIDER = /^ {0,3}\|?[ \t]*:?-{1,}:?[ \t]*(?:\|[ \t]*:?-{1,}:?[ \t]*)*\|?[ \t]*$/u;
		/** Whether a target is one this screen will turn into a link. */
		function isSafeHref(href) {
			return /^(?:https?:|mailto:)/iu.test(href);
		}
		/** The plain text of inline content, for a target this screen will not link. */
		function inlineText(nodes) {
			return nodes.map((node) => node.kind === "text" || node.kind === "code" ? node.text : inlineText(node.children)).join("");
		}
		/**
		* Parse one line's inline content.
		* @param source - the line, without its block marker.
		* @param depth - current nesting depth; past the limit, markers stay as text.
		* @returns the inline nodes, in order.
		*/
		function parseInline(source, depth = 0) {
			const nodes = [];
			let text = "";
			const flush = () => {
				if (text === "") return;
				nodes.push({
					kind: "text",
					text
				});
				text = "";
			};
			let at = 0;
			while (at < source.length) {
				const character = source[at] ?? "";
				if (character === "`") {
					const end = source.indexOf("`", at + 1);
					if (end > at + 1) {
						flush();
						nodes.push({
							kind: "code",
							text: source.slice(at + 1, end)
						});
						at = end + 1;
						continue;
					}
				}
				if (character === "*" || character === "_") {
					const marker = source.startsWith(character + character, at) ? character + character : character;
					const end = source.indexOf(marker, at + marker.length);
					if (end > at + marker.length && depth < INLINE_DEPTH_LIMIT) {
						flush();
						const children = parseInline(source.slice(at + marker.length, end), depth + 1);
						nodes.push(marker.length === 2 ? {
							kind: "strong",
							children
						} : {
							kind: "emphasis",
							children
						});
						at = end + marker.length;
						continue;
					}
				}
				if (character === "[") {
					const close = source.indexOf("]", at + 1);
					if (close > at + 1 && source[close + 1] === "(") {
						const end = source.indexOf(")", close + 2);
						if (end > close + 2) {
							flush();
							const children = parseInline(source.slice(at + 1, close), depth + 1);
							const href = source.slice(close + 2, end).trim();
							nodes.push(isSafeHref(href) ? {
								kind: "link",
								href,
								children
							} : {
								kind: "text",
								text: inlineText(children)
							});
							at = end + 1;
							continue;
						}
					}
				}
				text += character;
				at += 1;
			}
			flush();
			return nodes;
		}
		/** Whether a line opens a block, which ends the paragraph above it. */
		function startsBlock(line) {
			return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || BULLET.test(line) || ORDERED.test(line) || TABLE_ROW.test(line);
		}
		/** Consume one fenced code block, and return it with the line after its closing fence. */
		function takeFence(lines, at, opening) {
			const marker = opening[1] ?? "```";
			const character = marker.slice(0, 1) === "`" ? "`" : "~";
			const closing = new RegExp(`^ {0,3}${character}{${String(marker.length)},}[ \\t]*$`, "u");
			const body = [];
			let cursor = at + 1;
			while (cursor < lines.length && !closing.test(lines[cursor] ?? "")) {
				body.push(lines[cursor] ?? "");
				cursor += 1;
			}
			const next = cursor < lines.length ? cursor + 1 : cursor;
			return [{
				kind: "code",
				language: (opening[2] ?? "").trim(),
				text: body.join("\n")
			}, next];
		}
		/** Split one table row into its cells. */
		function splitTableRow(line) {
			return line.trim().replace(/^\|/u, "").replace(/\|$/u, "").split("|").map((cell) => parseInline(cell.trim()));
		}
		/**
		* Parse a markdown document into blocks.
		* @param source - the document's bytes, as text.
		* @returns the blocks, in document order.
		*/
		function parseMarkdown(source) {
			const lines = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
			const blocks = [];
			let at = 0;
			while (at < lines.length) {
				const line = lines[at] ?? "";
				if (line.trim() === "") {
					at += 1;
					continue;
				}
				const fence = FENCE.exec(line);
				if (fence !== null) {
					const [block, next] = takeFence(lines, at, fence);
					blocks.push(block);
					at = next;
					continue;
				}
				const heading = HEADING.exec(line);
				if (heading !== null) {
					blocks.push({
						kind: "heading",
						level: (heading[1] ?? "#").length,
						children: parseInline(heading[2] ?? "")
					});
					at += 1;
					continue;
				}
				if (RULE.test(line)) {
					blocks.push({ kind: "rule" });
					at += 1;
					continue;
				}
				if (QUOTE.exec(line) !== null) {
					const quoted = [];
					while (at < lines.length) {
						const inner = QUOTE.exec(lines[at] ?? "");
						if (inner === null) break;
						quoted.push(inner[1] ?? "");
						at += 1;
					}
					blocks.push({
						kind: "quote",
						children: parseInline(quoted.join(" ").trim())
					});
					continue;
				}
				const bullet = BULLET.exec(line);
				const ordered = bullet === null ? ORDERED.exec(line) : null;
				if (bullet !== null || ordered !== null) {
					const isOrdered = bullet === null;
					const items = [];
					while (at < lines.length) {
						const match = isOrdered ? ORDERED.exec(lines[at] ?? "") : BULLET.exec(lines[at] ?? "");
						if (match === null) break;
						items.push(parseInline((match[1] ?? "").trim()));
						at += 1;
					}
					blocks.push({
						kind: "list",
						ordered: isOrdered,
						items
					});
					continue;
				}
				if (TABLE_ROW.test(line) && TABLE_DIVIDER.test(lines[at + 1] ?? "")) {
					const header = splitTableRow(line);
					at += 2;
					const rows = [];
					while (at < lines.length && TABLE_ROW.test(lines[at] ?? "")) {
						rows.push(splitTableRow(lines[at] ?? ""));
						at += 1;
					}
					blocks.push({
						kind: "table",
						header,
						rows
					});
					continue;
				}
				const paragraph = [];
				while (at < lines.length) {
					const next = lines[at] ?? "";
					if (next.trim() === "") break;
					if (paragraph.length > 0 && startsBlock(next)) break;
					paragraph.push(next.trim());
					at += 1;
				}
				blocks.push({
					kind: "paragraph",
					children: parseInline(paragraph.join(" "))
				});
			}
			return blocks;
		}
		//#endregion
		//#region src/documents-route.ts
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
		/** Every refusal reason, path-side and root-side. */
		const DOCUMENTS_REFUSAL_REASONS = [
			...[
				"documents:path-escapes-root",
				"documents:not-markdown",
				"documents:no-such-file"
			],
			"documents:unreadable",
			"documents:root-missing",
			"documents:root-unreadable"
		];
		/** The route a browser fetches one document from, one path segment per segment. */
		function documentsFileRequest(relativePath) {
			return `${DOCUMENTS_FILE_ENDPOINT}/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
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
		//#region src/client/documents-loader.ts
		/**
		* The browser half of the Documents read: same-origin requests to the host's two routes.
		*
		* NO FAILURE IS SILENT, AND NOTHING FALLS BACK TO SAMPLE DATA. Every read either returns
		* the host's answer or a named failure with the reason attached: a transport failure, an
		* HTTP status, a refusal the host named, or a body this screen cannot recognise. A screen
		* that showed an empty list for any of those would be telling the operator the root holds
		* no documents when what actually happened is that nobody read it.
		*
		* The response parsers live in `documents-route.ts`, shared with the host, so a shape this
		* half accepts is exactly the shape the host half serves.
		*
		* @module @aukora/face-documents/loader
		*/
		/** The page's own fetch, same-origin and uncached. */
		const sameOriginFetch = (input, init) => globalThis.fetch(input, init);
		/** A one-line, human-readable account of a failure. Nothing here is localized: it is a diagnostic. */
		function failureText(failure) {
			switch (failure.kind) {
				case "transport": return `no answer from the host route: ${failure.detail}`;
				case "http": return `the host answered HTTP ${String(failure.status)} with no named refusal: ${failure.detail}`;
				case "refused": return `the host refused by name: ${failure.reason}${failure.subject === "" ? "" : ` (${failure.subject})`}`;
				case "malformed": return `the host's answer is not the shape this screen can render: ${failure.detail}`;
			}
		}
		/** The message of an unknown thrown value, without inventing one. */
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}
		/**
		* Fetch one JSON body from the host, refusing to guess what a failure means.
		* @param url - the same-origin route to read.
		* @param fetchImpl - the fetch to use.
		* @returns the parsed body, or the named failure.
		*/
		async function readJson(url, fetchImpl) {
			let response;
			try {
				response = await fetchImpl(url, {
					method: "GET",
					headers: { accept: "application/json" },
					cache: "no-store",
					credentials: "same-origin"
				});
			} catch (error) {
				return {
					kind: "failed",
					failure: {
						kind: "transport",
						detail: messageOf(error)
					}
				};
			}
			const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
			if (mediaType !== "application/json") return {
				kind: "failed",
				failure: {
					kind: "http",
					status: response.status,
					detail: `content-type ${String(mediaType)} is not application/json`
				}
			};
			let value;
			try {
				value = await response.json();
			} catch (error) {
				return {
					kind: "failed",
					failure: {
						kind: "malformed",
						detail: `the body is not JSON: ${messageOf(error)}`
					}
				};
			}
			if (response.status === 200) return {
				kind: "ready",
				value
			};
			const refusal = parseDocumentsRefusalBody(value);
			if (refusal !== void 0) return {
				kind: "failed",
				failure: {
					kind: "refused",
					reason: refusal.reason,
					subject: refusal.subject
				}
			};
			return {
				kind: "failed",
				failure: {
					kind: "http",
					status: response.status,
					detail: "the body was not a refusal this face defines"
				}
			};
		}
		/**
		* Read the index: every markdown document under the host's root.
		* @param fetchImpl - the fetch to use; defaults to the page's own.
		* @returns the index, or the named failure.
		*/
		async function readDocumentsIndex(fetchImpl = sameOriginFetch) {
			const read = await readJson(DOCUMENTS_INDEX_ENDPOINT, fetchImpl);
			if (read.kind === "failed") return read;
			const body = parseDocumentsIndexBody(read.value);
			if (body === void 0) return {
				kind: "failed",
				failure: {
					kind: "malformed",
					detail: `${DOCUMENTS_INDEX_ENDPOINT} is not a documents index body`
				}
			};
			return {
				kind: "ready",
				value: body
			};
		}
		/**
		* Read one document's markdown, by its path relative to the root.
		* @param relativePath - the path as the index reported it.
		* @param fetchImpl - the fetch to use; defaults to the page's own.
		* @returns the document, or the named failure.
		*/
		async function readDocumentsDocument(relativePath, fetchImpl = sameOriginFetch) {
			const url = documentsFileRequest(relativePath);
			const read = await readJson(url, fetchImpl);
			if (read.kind === "failed") return read;
			const body = parseDocumentsDocumentBody(read.value);
			if (body === void 0) return {
				kind: "failed",
				failure: {
					kind: "malformed",
					detail: `${url} is not a document body`
				}
			};
			return {
				kind: "ready",
				value: body
			};
		}
		//#endregion
		//#region src/client/DocumentsSurface.tsx
		/**
		* The Documents center surface: the private root's markdown, listed and read full-page.
		*
		* WHAT IT READS. One same-origin fetch of the host's index when the lane first opens, and
		* one fetch per document opened. There is no sample set behind this screen any more: an
		* empty grid means the root holds no markdown, and a failed read renders the reason the
		* host or the transport gave, by name. A screen that showed an empty list for a failed
		* read would be answering a question nobody asked.
		*
		* READ-ONLY. Opening a document fetches it; nothing on this surface writes, saves, edits
		* or copies anything, and the status line says so rather than leaving a reader to assume
		* a store exists. The root is printed on the surface because a reader is entitled to know
		* which directory was read.
		*
		* The interaction is the same open/close shape as before: the grid is a categorized set of
		* portal buttons, pressing one opens that document full-page inside the lane, and the
		* top-left return closes it back to the grid, restoring focus to the row that was open.
		*/
		/** True when the event target is a text-entry control that owns its own keys. */
		function isEditableTarget(target) {
			if (!(target instanceof HTMLElement)) return false;
			const tag = target.tagName;
			return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
		}
		/** A stable `YYYY-MM-DD HH:MM UTC` view of an ISO instant; the raw value when it is not one. */
		function formatModified(instant) {
			const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/u.exec(instant);
			return match === null ? instant : `${match[1] ?? ""} ${match[2] ?? ""} UTC`;
		}
		/** The visible failure state: the named reason, and what it means for this list. */
		function FailureNotice({ failure, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: Documents_module_css_default.failure,
				"data-documents-error": true,
				role: "alert",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
						className: Documents_module_css_default.failureTitle,
						children: t("error.title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
						className: Documents_module_css_default.failureReason,
						"data-documents-error-reason": true,
						children: failureText(failure)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: Documents_module_css_default.failureHint,
						children: t("error.hint")
					})
				]
			});
		}
		/**
		* Render the Documents lane: the root's markdown grouped by folder, and one document
		* full-page as rendered markdown with a top-left return.
		* @param props - shell visibility, close action, and localized copy.
		* @returns the always-mounted Documents surface.
		*/
		function DocumentsSurface({ activeSurface, closeSurface, t }) {
			const active = activeSurface === "documents";
			const [index, setIndex] = (0, react.useState)({ kind: "idle" });
			const [category, setCategory] = (0, react.useState)("all");
			const [query, setQuery] = (0, react.useState)("");
			const [openPath, setOpenPath] = (0, react.useState)(null);
			const [opened, setOpened] = (0, react.useState)({ kind: "idle" });
			const indexGeneration = (0, react.useRef)(0);
			const documentGeneration = (0, react.useRef)(0);
			const gridRef = (0, react.useRef)(null);
			const returnButtonRef = (0, react.useRef)(null);
			const returnToRef = (0, react.useRef)(null);
			const loadIndex = (0, react.useCallback)(() => {
				indexGeneration.current += 1;
				const mine = indexGeneration.current;
				setIndex({ kind: "loading" });
				readDocumentsIndex().then((read) => {
					if (indexGeneration.current !== mine) return;
					setIndex(read.kind === "ready" ? {
						kind: "ready",
						index: read.value
					} : {
						kind: "failed",
						failure: read.failure
					});
				});
			}, []);
			const loadDocument = (0, react.useCallback)((relativePath) => {
				documentGeneration.current += 1;
				const mine = documentGeneration.current;
				setOpened({ kind: "loading" });
				readDocumentsDocument(relativePath).then((read) => {
					if (documentGeneration.current !== mine) return;
					if (read.kind === "failed") {
						setOpened({
							kind: "failed",
							failure: read.failure
						});
						return;
					}
					const body = read.value;
					setOpened({
						kind: "ready",
						entry: {
							path: body.path,
							title: body.title,
							titleFrom: body.titleFrom,
							category: body.category,
							modifiedAt: body.modifiedAt
						},
						markdown: body.markdown
					});
				});
			}, []);
			(0, react.useEffect)(() => () => {
				indexGeneration.current += 1;
				documentGeneration.current += 1;
			}, []);
			(0, react.useEffect)(() => {
				if (!active) return;
				if (index.kind !== "idle") return;
				loadIndex();
			}, [
				active,
				index.kind,
				loadIndex
			]);
			const documents = index.kind === "ready" ? index.index.documents : [];
			const root = index.kind === "ready" ? index.index.root : "";
			const categories = (0, react.useMemo)(() => {
				const seen = /* @__PURE__ */ new Set();
				for (const entry of documents) seen.add(entry.category);
				return [...seen].sort((left, right) => {
					if (left === right) return 0;
					if (left === "root") return -1;
					if (right === "root") return 1;
					return left < right ? -1 : 1;
				});
			}, [documents]);
			(0, react.useEffect)(() => {
				if (category !== "all" && !categories.includes(category)) setCategory("all");
			}, [categories, category]);
			const visible = (0, react.useMemo)(() => {
				const needle = query.trim().toLowerCase();
				return documents.filter((entry) => {
					if (category !== "all" && entry.category !== category) return false;
					if (needle === "") return true;
					return `${entry.title} ${entry.path} ${entry.category}`.toLowerCase().includes(needle);
				});
			}, [
				documents,
				category,
				query
			]);
			const grouped = (0, react.useMemo)(() => categories.map((id) => ({
				id,
				entries: visible.filter((entry) => entry.category === id)
			})).filter((group) => group.entries.length > 0), [categories, visible]);
			const blocks = (0, react.useMemo)(() => opened.kind === "ready" ? parseMarkdown(opened.markdown) : [], [opened]);
			(0, react.useEffect)(() => {
				if (!active) return;
				const onKeyDown = (event) => {
					if (event.key !== "Escape" || event.defaultPrevented) return;
					if (isEditableTarget(event.target)) return;
					event.preventDefault();
					if (openPath !== null) {
						documentGeneration.current += 1;
						setOpenPath(null);
						setOpened({ kind: "idle" });
					} else closeSurface();
				};
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [
				active,
				closeSurface,
				openPath
			]);
			(0, react.useEffect)(() => {
				if (!active) return;
				if (openPath !== null) return;
				const returning = returnToRef.current;
				if (returning === null) return;
				returnToRef.current = null;
				const portal = gridRef.current?.querySelector(`[data-document-portal="${CSS.escape(returning)}"]`);
				if (portal instanceof HTMLElement) portal.focus();
			}, [active, openPath]);
			(0, react.useEffect)(() => {
				if (openPath === null) return;
				returnButtonRef.current?.focus();
			}, [openPath]);
			const openDocument = (entry) => {
				returnToRef.current = entry.path;
				setOpenPath(entry.path);
				loadDocument(entry.path);
			};
			const closeDocument = () => {
				documentGeneration.current += 1;
				setOpenPath(null);
				setOpened({ kind: "idle" });
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
				"data-documents-surface": true,
				className: Documents_module_css_default.surface,
				hidden: !active,
				"aria-hidden": !active,
				"aria-label": t("title"),
				children: openPath === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: Documents_module_css_default.lane,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: Documents_module_css_default.brandRow,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
								className: Documents_module_css_default.brandName,
								children: t("title")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: Documents_module_css_default.textButton,
								"data-documents-refresh": true,
								onClick: loadIndex,
								disabled: index.kind === "loading",
								children: t("actions.refresh")
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: Documents_module_css_default.posture,
							"data-documents-posture": true,
							children: t("runtime.status")
						}),
						index.kind === "ready" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: Documents_module_css_default.posture,
							"data-documents-root": true,
							children: [
								t("runtime.root"),
								" ",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
									className: Documents_module_css_default.postureCode,
									children: root
								}),
								" · ",
								documents.length,
								" ",
								t("count.documents")
							]
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: Documents_module_css_default.searchRow,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: Documents_module_css_default.searchMark,
									"aria-hidden": "true",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SearchIcon, { size: 16 })
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
									className: Documents_module_css_default.visuallyHidden,
									htmlFor: "documents-search",
									children: t("search.label")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									id: "documents-search",
									className: Documents_module_css_default.searchInput,
									type: "search",
									value: query,
									placeholder: t("search.placeholder"),
									onChange: (event) => {
										setQuery(event.target.value);
									}
								})
							]
						}),
						categories.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("nav", {
							className: Documents_module_css_default.categoryRow,
							"aria-label": t("nav.categories"),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: Documents_module_css_default.categoryChip,
								"aria-pressed": category === "all",
								onClick: () => {
									setCategory("all");
								},
								children: t("nav.all")
							}), categories.map((id) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: Documents_module_css_default.categoryChip,
								"aria-pressed": category === id,
								onClick: () => {
									setCategory(id);
								},
								children: id === "root" ? t("category.root") : id
							}, id))]
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: Documents_module_css_default.grid,
							ref: gridRef,
							children: [
								index.kind === "loading" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: Documents_module_css_default.listEmpty,
									children: t("state.loading")
								}) : null,
								index.kind === "failed" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FailureNotice, {
									failure: index.failure,
									t
								}) : null,
								index.kind === "ready" && documents.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: Documents_module_css_default.listEmpty,
									children: t("list.empty")
								}) : null,
								index.kind === "ready" && documents.length > 0 && grouped.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: Documents_module_css_default.listEmpty,
									children: t("list.none")
								}) : null,
								grouped.map((group) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
									className: Documents_module_css_default.group,
									"aria-label": group.id === "root" ? t("category.root") : group.id,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h3", {
										className: Documents_module_css_default.groupHeading,
										children: [group.id === "root" ? t("category.root") : group.id, /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: Documents_module_css_default.groupCount,
											children: [
												group.entries.length,
												" ",
												t("count.documents")
											]
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: Documents_module_css_default.portals,
										children: group.entries.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											"data-document-portal": entry.path,
											className: Documents_module_css_default.portal,
											onClick: () => {
												openDocument(entry);
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: Documents_module_css_default.portalMark,
												"aria-hidden": "true",
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DocumentIcon, { size: 18 })
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: Documents_module_css_default.portalCopy,
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
														className: Documents_module_css_default.portalTitle,
														children: entry.title
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: Documents_module_css_default.portalPath,
														children: entry.path
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: Documents_module_css_default.portalMeta,
														children: [formatModified(entry.modifiedAt), entry.titleFrom === "filename" ? ` · ${t("meta.filenameTitle")}` : ""]
													})
												]
											})]
										}, entry.path))
									})]
								}, group.id))
							]
						})
					]
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
					className: Documents_module_css_default.reader,
					"data-document-open": openPath,
					"aria-label": opened.kind === "ready" ? opened.entry.title : openPath,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
							className: Documents_module_css_default.readerHeader,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								ref: returnButtonRef,
								type: "button",
								className: Documents_module_css_default.iconButton,
								"data-document-return": true,
								onClick: closeDocument,
								"aria-label": t("back"),
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BackIcon, { size: 16 })
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
								className: Documents_module_css_default.readerTitle,
								children: opened.kind === "ready" ? opened.entry.title : openPath
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: Documents_module_css_default.readerMeta,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: openPath }), opened.kind === "ready" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									"aria-hidden": "true",
									children: "·"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: formatModified(opened.entry.modifiedAt) }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									"aria-hidden": "true",
									children: "·"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
									t("meta.category"),
									" ",
									opened.entry.category === "root" ? t("category.root") : opened.entry.category
								] })
							] }) : null]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: Documents_module_css_default.readerBody,
							children: [
								opened.kind === "loading" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: Documents_module_css_default.listEmpty,
									children: t("reader.loading")
								}) : null,
								opened.kind === "failed" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FailureNotice, {
									failure: opened.failure,
									t
								}) : null,
								opened.kind === "ready" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarkdownView, { blocks }) : null
							]
						})
					]
				})
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* Documents launcher, listing and reader dictionaries.
		*
		* The chrome is localized; document titles, paths and bodies are the operator's own
		* content and stay exactly as stored. `zh` is the key-set source of truth for this
		* package, matching the Messages lane's convention.
		*
		* The failure strings are the honest half of this dictionary: the reason itself arrives
		* from the host untranslated (it is a diagnostic, not chrome), and these keys say what a
		* failed read means for the list — that an empty-looking screen is not an empty root.
		*/
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"menu.title": "文档",
			"menu.description": "只读 — 打开整页渲染",
			"title": "文档",
			"runtime.status": "只读 — 私有目录，不写入、不删除、不复制",
			"runtime.root": "根目录",
			"actions.refresh": "重新读取",
			"search.placeholder": "搜索标题或路径",
			"search.label": "搜索文档",
			"state.loading": "正在读取目录…",
			"list.none": "没有匹配的文档。",
			"list.empty": "这个根目录下没有 .md 文档。",
			"count.documents": "篇文档",
			"back": "返回",
			"reader.loading": "正在读取文档…",
			"meta.category": "分类",
			"meta.filenameTitle": "标题取自文件名",
			"category.root": "根目录",
			"nav.categories": "分类",
			"nav.all": "全部",
			"error.title": "读取失败",
			"error.hint": "列表为空并不代表没有文档——这次读取没有成功。"
		};
		/** English dictionary. */
		const en = {
			"menu.title": "Documents",
			"menu.description": "Read-only — open full-page rendered",
			"title": "Documents",
			"runtime.status": "Read-only — private directory; no writes, no deletes, no copies",
			"runtime.root": "Root",
			"actions.refresh": "Read again",
			"search.placeholder": "Search title or path",
			"search.label": "Search documents",
			"state.loading": "Reading the directory…",
			"list.none": "No matching documents.",
			"list.empty": "No .md documents under this root.",
			"count.documents": "documents",
			"back": "Back",
			"reader.loading": "Reading the document…",
			"meta.category": "Category",
			"meta.filenameTitle": "title from filename",
			"category.root": "root",
			"nav.categories": "Categories",
			"nav.all": "All",
			"error.title": "The read failed",
			"error.hint": "An empty list here does not mean an empty root — this read did not succeed."
		};
		//#endregion
		//#region src/client/index.ts
		const NS = "documents";
		/** Services required by the Documents browser plugin. */
		const inject = ["slots", "locale"];
		/**
		* Register the Documents dictionaries, Apps launcher, and center surface.
		* @param ctx - Client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "ui-documents: dictionaries");
			ctx.slots.inject("shell.menu.apps", () => ctx.slots.register({
				name: "shell.menu.apps",
				id: "documents",
				order: 60,
				locale: NS
			}, DocumentsMenu));
			ctx.slots.inject("shell.surface", () => ctx.slots.register({
				name: "shell.surface",
				id: "documents",
				order: 60,
				locale: NS
			}, DocumentsSurface));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map