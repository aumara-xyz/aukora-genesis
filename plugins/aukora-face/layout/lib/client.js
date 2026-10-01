window.__ModuleLoader__.load({
	id: "@aukora/face-layout",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/stores.ts
		/**
		* Transient spatial-layout state for the root shell. Pane geometry is a
		* closed set of fractional presets rather than mutable pixel preferences;
		* surfaces and details share the same action set so every navigation gesture
		* produces one atomic shell state.
		*/
		/** Fractional track weights for every supported pane preset. */
		const PANE_WEIGHTS = {
			balanced: [
				1,
				1,
				1
			],
			"left-wide": [
				2,
				1,
				0
			],
			"left-menu-wide": [
				2,
				0,
				1
			],
			"left-focus": [
				3,
				0,
				0
			],
			"center-left-wide": [
				0,
				2,
				1
			],
			"center-right-wide": [
				1,
				2,
				0
			],
			"center-focus": [
				0,
				3,
				0
			],
			"right-wide": [
				0,
				1,
				2
			],
			"right-threads-wide": [
				1,
				0,
				2
			],
			"right-focus": [
				0,
				0,
				3
			]
		};
		const PRESET_BY_WEIGHTS = new Map(Object.entries(PANE_WEIGHTS).map(([preset, weights]) => [weights.join(","), preset]));
		/**
		* Resolve one of the ten integer compositions of three lane thirds.
		* @param weights - next [threads, surface, menu/details] weights.
		* @returns the named preset for those weights.
		*/
		function presetFor(weights) {
			const preset = PRESET_BY_WEIGHTS.get(weights.join(","));
			if (preset === void 0) throw new Error(`layout: unsupported pane weights ${weights.join("/")}`);
			return preset;
		}
		/**
		* Grow an outer lane by one third, taking space from the far side first.
		* Full-screen outer lanes return one third to the adjacent center lane.
		* @param current - current pane preset.
		* @param side - outer lane whose only hot corner was activated.
		* @returns the next pane preset, or the current preset when that lane is hidden.
		*/
		function cycleOuterPane(current, side) {
			const [left, center, right] = PANE_WEIGHTS[current];
			if (side === "left") {
				if (left === 0) return current;
				if (left === 3) return presetFor([
					2,
					1,
					0
				]);
				if (right > 0) return presetFor([
					left + 1,
					center,
					right - 1
				]);
				return presetFor([
					left + 1,
					center - 1,
					right
				]);
			}
			if (right === 0) return current;
			if (right === 3) return presetFor([
				0,
				1,
				2
			]);
			if (left > 0) return presetFor([
				left - 1,
				center,
				right + 1
			]);
			return presetFor([
				left,
				center - 1,
				right + 1
			]);
		}
		/**
		* Transfer one third across a center-lane boundary. A boundary at the frame
		* edge pulls its adjacent outer lane in; an inset boundary expands center.
		* @param current - current pane preset.
		* @param side - center boundary whose hot corner was activated.
		* @returns the next pane preset, or the current preset when center is hidden.
		*/
		function cycleCenterBoundary(current, side) {
			const [left, center, right] = PANE_WEIGHTS[current];
			if (center === 0) return current;
			if (side === "left") {
				if (left === 0) return presetFor([
					1,
					center - 1,
					right
				]);
				return presetFor([
					left - 1,
					center + 1,
					right
				]);
			}
			if (right === 0) return presetFor([
				left,
				center - 1,
				1
			]);
			return presetFor([
				left,
				center + 1,
				right - 1
			]);
		}
		/**
		* Create an independent spatial-layout store. State is intentionally
		* transient: a reload returns to the balanced conversation shell.
		* @returns the store handle used by the root slot registration.
		*/
		function createLayoutStore() {
			return (0, _deepseek_ai_dsh_client_store.defineStore)({
				init: () => ({
					conversationOpen: false,
					detailsOpen: false,
					panePreset: "balanced"
				}),
				actions: {
					cycleLeft: (d) => {
						d.panePreset = cycleOuterPane(d.panePreset, "left");
					},
					cycleCenterLeft: (d) => {
						d.panePreset = cycleCenterBoundary(d.panePreset, "left");
					},
					cycleCenterRight: (d) => {
						d.panePreset = cycleCenterBoundary(d.panePreset, "right");
					},
					cycleRight: (d) => {
						d.panePreset = cycleOuterPane(d.panePreset, "right");
					},
					selectSurface: (d, id, target, presentation = "contained") => {
						d.activeSurface = id;
						d.surfacePresentation = presentation;
						if (target === void 0) delete d.surfaceTarget;
						else d.surfaceTarget = target;
						d.detailsOpen = false;
						d.panePreset = "center-right-wide";
					},
					closeSurface: (d) => {
						delete d.activeSurface;
						delete d.surfaceTarget;
						delete d.surfacePresentation;
						d.detailsOpen = false;
						d.panePreset = "balanced";
					},
					openConversation: (d) => {
						d.conversationOpen = true;
						d.detailsOpen = false;
						if (PANE_WEIGHTS[d.panePreset][0] === 0) d.panePreset = "balanced";
					},
					closeConversation: (d) => {
						d.conversationOpen = false;
						d.detailsOpen = false;
						if (PANE_WEIGHTS[d.panePreset][0] === 0) d.panePreset = "balanced";
					},
					toggleSidebar: (d) => {
						d.panePreset = PANE_WEIGHTS[d.panePreset][0] === 0 ? "balanced" : "center-left-wide";
					},
					openDetails: (d) => {
						d.detailsOpen = true;
						d.panePreset = "balanced";
					},
					closeDetails: (d) => {
						d.detailsOpen = false;
					}
				}
			});
		}
		//#endregion
		//#region \0dsh-css:AppFrame.module.css.mjs
		const css$3 = "._5_bk4W_frame{--dsh-spatial-gap:6px;--dsh-spatial-third:calc(33.3333cqw - 4px);--dsh-spatial-two-thirds:calc(66.6667cqw - 8px);--dsh-hot-corner-size:74px;--dsh-hot-corner-gutter:10px;gap:var(--dsh-spatial-gap);box-sizing:border-box;height:100%;color:var(--aukora-text);background:var(--dsw-specific-spatial-canvas);transition:grid-template-columns var(--ds-transition-duration-slow) var(--ds-ease-in-out), gap var(--ds-transition-duration-slow) var(--ds-ease-in-out), padding var(--ds-transition-duration-slow) var(--ds-ease-in-out);grid-template-rows:minmax(0,1fr);grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1fr);padding:10px;display:grid;position:relative;overflow:hidden;container-type:inline-size}._5_bk4W_frame[data-single-measure=two-thirds]{gap:0;padding:0}._5_bk4W_frame[data-pane-preset=left-wide]{grid-template-columns:minmax(0,2fr) minmax(0,1fr) 0fr}._5_bk4W_frame[data-pane-preset=left-menu-wide]{--dsh-spatial-gap:3px;--dsh-spatial-third:calc(33.3333cqw - 2px);--dsh-spatial-two-thirds:calc(66.6667cqw - 4px);grid-template-columns:minmax(0,2fr) 0fr minmax(0,1fr)}._5_bk4W_frame[data-pane-preset=left-focus]{grid-template-columns:minmax(0,3fr) minmax(0,0fr) minmax(0,0fr)}._5_bk4W_frame[data-pane-preset=center-left-wide]{grid-template-columns:0fr minmax(0,2fr) minmax(0,1fr);padding-left:0}._5_bk4W_frame[data-pane-preset=center-right-wide]{grid-template-columns:minmax(0,1fr) minmax(0,2fr) 0fr;padding-right:0}._5_bk4W_frame[data-pane-preset=center-left-wide] ._5_bk4W_laneCenter{width:calc(100% + var(--dsh-spatial-gap));transform:translateX(calc(-1 * var(--dsh-spatial-gap)))}._5_bk4W_frame[data-pane-preset=center-right-wide] ._5_bk4W_laneCenter{width:calc(100% + var(--dsh-spatial-gap))}._5_bk4W_frame[data-pane-preset=center-focus]{grid-template-columns:minmax(0,0fr) minmax(0,3fr) minmax(0,0fr)}._5_bk4W_frame[data-pane-preset=right-wide]{grid-template-columns:0fr minmax(0,1fr) minmax(0,2fr)}._5_bk4W_frame[data-pane-preset=right-threads-wide]{--dsh-spatial-gap:3px;--dsh-spatial-third:calc(33.3333cqw - 2px);--dsh-spatial-two-thirds:calc(66.6667cqw - 4px);grid-template-columns:minmax(0,1fr) 0fr minmax(0,2fr)}._5_bk4W_frame[data-pane-preset=right-focus]{grid-template-columns:minmax(0,0fr) minmax(0,0fr) minmax(0,3fr)}._5_bk4W_lane{box-sizing:border-box;opacity:1;visibility:visible;min-width:0;min-height:0;transition:opacity .18s var(--ds-ease-in-out), visibility 0s linear, transform var(--ds-transition-duration-slow) var(--ds-ease-in-out);justify-content:center;align-items:stretch;display:flex;overflow:hidden}._5_bk4W_threadLayer[hidden],._5_bk4W_surfaceEmpty[hidden],._5_bk4W_surfaceLayer[hidden],._5_bk4W_rightLayer[hidden]{display:none}._5_bk4W_lane:not([data-pane-active]){opacity:0;visibility:hidden;pointer-events:none;transition-delay:0s, var(--ds-transition-duration-slow)}._5_bk4W_laneLeft{--dsw-specific-sidebar-fill:transparent;grid-column:1}._5_bk4W_laneCenter,._5_bk4W_centerCol{grid-column:2}._5_bk4W_laneRight{grid-column:3}._5_bk4W_laneShell{width:var(--dsh-spatial-third);border:1px solid var(--aukora-border);box-sizing:border-box;background:var(--dsw-specific-spatial-lane);min-width:0;max-width:100%;min-height:0;transition:width var(--ds-transition-duration-slow) var(--ds-ease-in-out), border-radius var(--ds-transition-duration-slow) var(--ds-ease-in-out);border-radius:22px;position:relative;overflow:hidden}._5_bk4W_laneCenter ._5_bk4W_laneShell{background:var(--dsw-specific-spatial-lane-bright)}._5_bk4W_frame[data-pane-preset=left-wide] ._5_bk4W_laneLeft ._5_bk4W_laneShell,._5_bk4W_frame[data-pane-preset=left-menu-wide] ._5_bk4W_laneLeft ._5_bk4W_laneShell,._5_bk4W_frame[data-pane-preset=right-wide] ._5_bk4W_laneRight ._5_bk4W_laneShell,._5_bk4W_frame[data-pane-preset=right-threads-wide] ._5_bk4W_laneRight ._5_bk4W_laneShell{width:var(--dsh-spatial-two-thirds)}._5_bk4W_frame[data-pane-preset=center-left-wide] ._5_bk4W_laneCenter ._5_bk4W_laneShell,._5_bk4W_frame[data-pane-preset=center-right-wide] ._5_bk4W_laneCenter ._5_bk4W_laneShell{width:100%}._5_bk4W_frame[data-single-measure=two-thirds] ._5_bk4W_laneShell{border-radius:22px;width:100%}._5_bk4W_laneBody,._5_bk4W_threadStack,._5_bk4W_threadLayer,._5_bk4W_surfaceStack,._5_bk4W_surfaceLayer,._5_bk4W_rightStack,._5_bk4W_rightLayer{width:100%;min-width:0;height:100%;min-height:0}._5_bk4W_surfaceStack,._5_bk4W_threadStack,._5_bk4W_rightStack{transition:width var(--ds-transition-duration-slow) var(--ds-ease-in-out);margin-inline:auto;position:relative}._5_bk4W_frame[data-single-measure=two-thirds][data-focused-lane=left] ._5_bk4W_threadStack,._5_bk4W_frame[data-single-measure=two-thirds][data-focused-lane=right] ._5_bk4W_rightStack,._5_bk4W_frame[data-single-measure=two-thirds][data-focused-lane=center][data-surface-presentation=contained] ._5_bk4W_surfaceStack{width:66.6667cqw}._5_bk4W_frame[data-single-measure=two-thirds][data-focused-lane=center][data-surface-presentation=full-bleed] ._5_bk4W_surfaceStack{width:100%}._5_bk4W_cornerControl{z-index:9;width:var(--dsh-hot-corner-size);height:var(--dsh-hot-corner-size);cursor:pointer;opacity:.6;transition:opacity var(--ds-transition-duration) var(--ds-ease-in-out), transform var(--ds-transition-duration) var(--ds-ease-in-out);background:0 0;border:0;padding:0;position:absolute;top:0}._5_bk4W_cornerControl:before{content:\"\";pointer-events:none;animation:3.8s ease-in-out infinite _5_bk4W_corner-pulse;position:absolute;inset:0}._5_bk4W_cornerControl:hover,._5_bk4W_cornerControl:focus-visible{opacity:1;transform:scale(1.025)}._5_bk4W_cornerControl:focus-visible{outline:none}._5_bk4W_cornerControl:focus-visible:before{opacity:1;animation:none}._5_bk4W_menuTab:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:-6px}._5_bk4W_cornerControl[data-corner=left],._5_bk4W_cornerControl[data-corner=center-right]{border-radius:0 22px 0 30px;right:0}._5_bk4W_cornerControl[data-corner=conversation-close],._5_bk4W_cornerControl[data-corner=center-left],._5_bk4W_cornerControl[data-corner=right]{border-radius:22px 0 30px;left:0}._5_bk4W_cornerControl[data-corner=conversation-close]:before,._5_bk4W_cornerControl[data-corner=left]:before{background:radial-gradient(circle at var(--dsh-corner-origin,100%) 0%, var(--dsw-specific-spatial-accent-left), transparent 52%)}._5_bk4W_cornerControl[data-corner=conversation-close]{--dsh-corner-origin:0%}._5_bk4W_cornerControl[data-corner=center-left]:before{background:radial-gradient(circle at 0% 0%, var(--dsw-specific-spatial-accent-center), transparent 52%)}._5_bk4W_cornerControl[data-corner=center-right]:before{background:radial-gradient(circle at 100% 0%, var(--dsw-specific-spatial-accent-center), transparent 52%)}._5_bk4W_cornerControl[data-corner=right]:before{background:radial-gradient(circle at 0% 0%, var(--dsw-specific-spatial-accent-right), transparent 52%)}@keyframes _5_bk4W_corner-pulse{0%,to{opacity:.42}50%{opacity:.78}}._5_bk4W_threadLayer{position:absolute;inset:0}._5_bk4W_threadLayer>[data-slot=sidebar],._5_bk4W_threadConversationBody>[data-slot=main]{width:100%;height:100%;display:block}._5_bk4W_threadLayer[data-thread-layer=conversation]{flex-direction:column;display:flex}._5_bk4W_threadLayer[hidden]{display:none}._5_bk4W_threadConversationBody{flex:1;min-width:0;min-height:0;overflow:hidden}._5_bk4W_threadConversationBody [data-phase]{background:0 0}._5_bk4W_surfaceEmpty{color:var(--dsw-alias-label-caption);letter-spacing:.28em;text-transform:uppercase;place-items:center;font-size:11px;display:grid;position:absolute;inset:0}._5_bk4W_surfaceLayer{position:absolute;inset:0}._5_bk4W_menuHeader{min-height:58px;padding:10px 14px 8px calc(var(--dsh-hot-corner-size) + var(--dsh-hot-corner-gutter));box-sizing:border-box;justify-content:space-between;align-items:center;display:flex}._5_bk4W_menuHeading{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:color-mix(in srgb, var(--dsw-static-spatial-violet) 92%, transparent);letter-spacing:.18em;text-transform:uppercase;font-size:11px;font-weight:600;line-height:16px;overflow:hidden}._5_bk4W_menuTabs{align-items:center;gap:4px;display:flex}._5_bk4W_menuTab{width:38px;height:38px;color:var(--dsw-alias-label-tertiary);cursor:pointer;transition:color var(--ds-transition-duration) var(--ds-ease-in-out), background var(--ds-transition-duration) var(--ds-ease-in-out);background:0 0;border:0;border-radius:11px;flex:none;place-items:center;padding:0;display:grid}._5_bk4W_menuTab:hover{color:var(--dsw-alias-label-primary)}._5_bk4W_menuTab[aria-selected=true]{color:color-mix(in srgb, var(--dsw-static-spatial-violet) 95%, transparent);background:color-mix(in srgb, var(--dsw-static-spatial-violet) 12%, transparent)}._5_bk4W_menuTab[data-menu-tab=system][aria-selected=true]{color:var(--dsw-static-spatial-blue);background:color-mix(in srgb, var(--dsw-static-spatial-blue) 12%, transparent)}._5_bk4W_menuTab[data-menu-tab=yours][aria-selected=true]{color:var(--dsw-static-spatial-mint);background:color-mix(in srgb, var(--dsw-static-spatial-mint) 12%, transparent)}._5_bk4W_rightStack[data-menu-tab=system] ._5_bk4W_menuHeading{color:var(--dsw-static-spatial-blue)}._5_bk4W_rightStack[data-menu-tab=yours] ._5_bk4W_menuHeading{color:var(--dsw-static-spatial-mint)}._5_bk4W_menuTabIcon{fill:#0000;stroke:currentColor;stroke-width:1.6px;stroke-linejoin:round;width:16px;height:16px}._5_bk4W_menuTab[aria-selected=true] ._5_bk4W_menuTabIcon{fill:color-mix(in srgb, var(--dsw-static-spatial-violet) 22%, transparent)}._5_bk4W_visuallyHidden{clip:rect(0 0 0 0);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}._5_bk4W_menuPanel{--dsh-spatial-menu-title-size:14px;--dsh-spatial-menu-title-line-height:20px;--dsh-spatial-menu-description-size:12px;--dsh-spatial-menu-description-line-height:18px;box-sizing:border-box;min-width:0;height:calc(100% - 58px);min-height:0;padding:4px 14px 18px;overflow:auto}._5_bk4W_menuEmpty{color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-spatial-menu-description-size);line-height:var(--dsh-spatial-menu-description-line-height);text-align:center;margin:30px 10px}._5_bk4W_menuPanel>[data-slot^=\"shell.menu.\"]>[data-aukora-action]{text-align:right;justify-content:flex-end;width:calc(100% - 4px);min-height:53px;margin:8px 2px;padding:10px 16px}._5_bk4W_menuPanel>[data-slot^=\"shell.menu.\"]>button:not([data-aukora-action]){box-sizing:border-box;border:1px solid color-mix(in srgb, var(--dsw-static-spatial-violet) 30%, transparent);width:calc(100% - 4px);min-height:53px;color:var(--dsw-alias-label-primary);font:inherit;text-align:right;cursor:pointer;transition:transform .2s var(--ds-ease-in-out), border-color .25s var(--ds-ease-in-out), box-shadow .25s var(--ds-ease-in-out), background .25s var(--ds-ease-in-out);background:0 0;border-radius:14px;justify-content:flex-end;align-items:center;gap:10px;margin:8px 2px;padding:10px 16px;display:flex}._5_bk4W_menuPanel>[data-slot^=\"shell.menu.\"]>button:not([data-aukora-action]):hover{background:color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent);transform:translate(-3px)}._5_bk4W_menuPanel>[data-slot^=\"shell.menu.\"]>button:not([data-aukora-action])[aria-current=page]{border-color:color-mix(in srgb, var(--dsw-static-spatial-violet) 90%, transparent);box-shadow:0 0 16px color-mix(in srgb, var(--dsw-static-spatial-violet) 22%, transparent)}._5_bk4W_menuPanel>[data-slot^=\"shell.menu.\"]>button:not([data-aukora-action]):focus-visible{outline:2px solid color-mix(in srgb, var(--dsw-static-spatial-violet) 90%, transparent);outline-offset:2px}._5_bk4W_overlayLayer{z-index:20;pointer-events:none;position:absolute;inset:0}._5_bk4W_overlayLayer>*{pointer-events:auto}._5_bk4W_frame [data-phase=active] [data-composer-seat]{background:0 0}._5_bk4W_frame [data-composer-stats]{display:none}@media (prefers-reduced-motion:reduce){._5_bk4W_frame,._5_bk4W_lane,._5_bk4W_laneShell,._5_bk4W_threadStack,._5_bk4W_surfaceStack,._5_bk4W_rightStack,._5_bk4W_cornerControl,._5_bk4W_menuTab,._5_bk4W_menuPanel>[data-slot^=\"shell.menu.\"]>button{transition:none}._5_bk4W_cornerControl:before{opacity:.6;animation:none}}._5_bk4W_aumaThread{color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-spatial-menu-description-size);line-height:var(--dsh-spatial-menu-description-line-height);margin:2px 10px 10px}._5_bk4W_aumaThreadWhat{color:var(--dsw-alias-label-tertiary)}._5_bk4W_aumaThreadWho{color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}._5_bk4W_aumaStatus{color:var(--dsw-alias-label-secondary);font-size:var(--dsh-spatial-menu-description-size);line-height:var(--dsh-spatial-menu-description-line-height);flex-wrap:wrap;gap:4px 14px;margin:0;padding:4px 12px;display:flex}._5_bk4W_aumaStatusKnown{color:var(--dsw-alias-label-primary)}._5_bk4W_aumaStatusUnknown{color:var(--dsw-alias-label-tertiary);font-style:italic}._5_bk4W_aumaWaiting{flex-wrap:wrap;align-items:baseline;gap:8px;margin-top:6px;font-size:12px;display:flex}._5_bk4W_aumaWaitingTitle{opacity:.7;letter-spacing:.02em}._5_bk4W_aumaWaitingBadge,._5_bk4W_aumaWaitingClear{border:1px solid;border-radius:999px;padding:1px 6px}._5_bk4W_aumaWaitingBadge{font-weight:600}._5_bk4W_aumaWaitingClear{opacity:.6}._5_bk4W_aumaWaitingOpen{font:inherit;color:inherit;cursor:pointer;background:0 0;border:none;padding:0;text-decoration:underline}._5_bk4W_aumaStatus,._5_bk4W_aumaWaiting{display:none}";
		const tagId$3 = "@aukora/face-layout/AppFrame.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$3) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@aukora/face-layout";
			tag.dataset.pluginCss = tagId$3;
			tag.textContent = css$3;
			document.head.appendChild(tag);
		}
		var AppFrame_module_css_default = {
			"aumaStatus": "_5_bk4W_aumaStatus",
			"aumaStatusKnown": "_5_bk4W_aumaStatusKnown",
			"aumaStatusUnknown": "_5_bk4W_aumaStatusUnknown",
			"aumaThread": "_5_bk4W_aumaThread",
			"aumaThreadWhat": "_5_bk4W_aumaThreadWhat",
			"aumaThreadWho": "_5_bk4W_aumaThreadWho",
			"aumaWaiting": "_5_bk4W_aumaWaiting",
			"aumaWaitingBadge": "_5_bk4W_aumaWaitingBadge",
			"aumaWaitingClear": "_5_bk4W_aumaWaitingClear",
			"aumaWaitingOpen": "_5_bk4W_aumaWaitingOpen",
			"aumaWaitingTitle": "_5_bk4W_aumaWaitingTitle",
			"centerCol": "_5_bk4W_centerCol",
			"corner-pulse": "_5_bk4W_corner-pulse",
			"cornerControl": "_5_bk4W_cornerControl",
			"frame": "_5_bk4W_frame",
			"lane": "_5_bk4W_lane",
			"laneBody": "_5_bk4W_laneBody",
			"laneCenter": "_5_bk4W_laneCenter",
			"laneLeft": "_5_bk4W_laneLeft",
			"laneRight": "_5_bk4W_laneRight",
			"laneShell": "_5_bk4W_laneShell",
			"menuEmpty": "_5_bk4W_menuEmpty",
			"menuHeader": "_5_bk4W_menuHeader",
			"menuHeading": "_5_bk4W_menuHeading",
			"menuPanel": "_5_bk4W_menuPanel",
			"menuTab": "_5_bk4W_menuTab",
			"menuTabIcon": "_5_bk4W_menuTabIcon",
			"menuTabs": "_5_bk4W_menuTabs",
			"overlayLayer": "_5_bk4W_overlayLayer",
			"rightLayer": "_5_bk4W_rightLayer",
			"rightStack": "_5_bk4W_rightStack",
			"surfaceEmpty": "_5_bk4W_surfaceEmpty",
			"surfaceLayer": "_5_bk4W_surfaceLayer",
			"surfaceStack": "_5_bk4W_surfaceStack",
			"threadConversationBody": "_5_bk4W_threadConversationBody",
			"threadLayer": "_5_bk4W_threadLayer",
			"threadStack": "_5_bk4W_threadStack",
			"visuallyHidden": "_5_bk4W_visuallyHidden"
		};
		//#endregion
		//#region src/client/auma-thread.ts
		/**
		* WHICH THREAD AUMA LIVE IS SPEAKING THROUGH — one pure decision, so the apps corner can say it and a court can
		* measure it.
		*
		* WHY THIS IS NOT IN THE COMPONENT. A React file cannot be imported by a court, and the shell keeps learning
		* that lesson the expensive way: the rule ends up described in a comment and measured nowhere. The decision is
		* therefore here — `AumaThreadView` — and `AppFrame.tsx` only renders what this returns.
		*
		* WHAT IS DECIDED, AND ON WHAT EVIDENCE:
		*   · NO SELECTION IS NOT A GUESS. With no current session the view is `none`, and the corner says so rather
		*     than naming the last thing it saw. Peter asked never to have to guess; a stale name is worse than silence.
		*   · THE HOME THREAD IS THE AUMA LANE'S OWN THREAD. `AUMA_LANE` matches the lane word the thread titles carry
		*     and the board and the organism reader already use to name lanes (`LANE_PATTERN` in the organism reader).
		*     AUMA's auma-36 adds the home session; **when it lands with an authoritative marker, this predicate is the
		*     one line that changes** and nothing else in the shell has to move.
		*   · EVERY OTHER THREAD IS NAMED BY ITS OWN NAME, capped: the label sits in a narrow corner beside the menu
		*     tabs, and a title that overflows it would push the tabs instead of naming the thread.
		*   · A THREAD WITH NO NAME IS STILL NAMED. `SessionSummary.title` is optional until the host projects one, and
		*     an empty label would read as a broken label rather than as a thread that has not been titled yet, so the
		*     fallback carries part of the session id.
		*
		* @module auma-thread
		*/
		/** The lane word the AUMA lane's own thread carries. The home thread is the lane's thread. */
		const AUMA_LANE = /^auma\b/iu;
		/**
		* The thread Auma Live is speaking through, from the shell's live selection.
		*
		* @param input - the current session id and the name the thread list shows for it.
		* @returns which case the corner is in, and the name to print when it is an ordinary thread.
		*/
		function aumaThreadOf(input) {
			const id = typeof input?.sessionId === "string" ? input.sessionId.trim() : "";
			if (id === "") return { kind: "none" };
			const home = typeof input?.homeSessionId === "string" ? input.homeSessionId.trim() : "";
			if (home !== "") return id === home ? { kind: "home" } : namedThread(id, input?.title);
			return namedThread(id, input?.title);
		}
		/** A thread that is not her home: its own name when it has one, and its id when the host has not titled it. */
		function namedThread(id, rawTitle) {
			const title = typeof rawTitle === "string" ? rawTitle.trim() : "";
			if (title !== "" && AUMA_LANE.test(title)) return { kind: "home" };
			if (title === "") return {
				kind: "thread",
				text: `thread ${id.slice(0, 12)}`
			};
			return {
				kind: "thread",
				text: title.length <= 60 ? title : `${title.slice(0, 59).trimEnd()}…`
			};
		}
		//#endregion
		//#region src/client/auma-status.ts
		/**
		* THE STRIP'S FACTS — five questions about what Auma Live can do right now, each either answered or UNKNOWN.
		*
		* **THE RULE THAT SHAPES THIS WHOLE MODULE: AN UNKNOWN IS NEVER A GREEN.** A strip that renders a failed lookup
		* as `0 lanes` or `$0.00 spent` tells a person she is idle and broke when the truth is that nobody asked. So
		* every fact here is `{ known: true, text }` or `{ known: false, text: 'unknown' }`, and the frame renders the
		* two differently — a known value in the label's own colour, an unknown in the muted one, with the word spelled
		* out rather than left blank.
		*
		* WHERE EACH ANSWER COMES FROM:
		*   · thread     the live session store, with the HOME session the host names taking precedence over the lane
		*                word in a title — the authority is the host's, not a guess (`auma-thread.ts` decides it).
		*   · lanes      the live session store (counted by the frame, `lanesRunningOf`).
		*   · core       the CORE fact on the minds response: whether this Host's conductor session exists.
		*   · hands      the mind keys the same response offers: what this Host would actually accept.
		*   · spend      today's spend and the cap, from the spend gate through the same response.
		* The last three arrive in ONE request that the panel already makes at mount (`/api/auma-live/minds`), so the
		* strip costs no new route and no write of any kind.
		*
		* PURE, SO IT CAN BE MEASURED: a React file cannot be imported by a court, and the "unknown is not green" rule
		* is exactly the kind of rule that reads as satisfied while a lookup silently returns zero.
		*
		* @module auma-status
		*/
		/** The surface id the Auma Live panel registers under. */
		const AUMA_LIVE_SURFACE = "auma-live";
		/**
		* The route these facts arrive on: AUMA's read-only `/api/auma-live/status`.
		*
		* **ONE SOURCE, ONE IMPLEMENTATION.** This strip used to assemble its facts itself — the spend gate and the CORE
		* id off the minds answer, the lane count off the session store — which made two implementations of the same
		* question. AUMA's route answers all of it, so the strip reads that route and the assembly goes away wherever the
		* route covers it; a fact the route does not carry is `unknown`, never a value this file guessed.
		*
		* **THE PAYLOAD'S FIELD NAMES ARE PROVISIONAL UNTIL HER COMMIT LANDS.** The route answers, per the order: the home
		* session and its liveness, the lanes with those waiting on Peter, whether the CORE session exists, the hands that
		* resolve, today's spend against the cap, and the last wake decision — each unknown-able. The two names already
		* fixed by her own acceptance court (`spentTodayUsd`, `capUsd`) are used here; the rest are marked so the swap is
		* a rename rather than a rewrite. The court drives a FIXTURE of this shape meanwhile.
		*/
		const AUMA_STATUS_PATH = "/api/auma-live/status";
		/**
		* The minds route, which carries the per-lane approval log the waiting badge is computed from.
		*
		* TWO ROUTES, TWO QUESTIONS, AND BOTH ARE NEEDED: the status route answers what she can do right now (her
		* thread, the lanes running, CORE, the hands, the spend, the last wake), and this one carries the lanes'
		* approval events, which is the only thing that can say WHO IS STOPPED AND FOR HOW LONG. A strip that inferred
		* a waiting lane from a running count would go quiet exactly when it matters.
		*/
		const AUMA_MINDS_PATH = "/api/auma-live/minds";
		/** The one word an unanswered fact is rendered with. Spelled out, because a blank reads as a broken strip. */
		const UNKNOWN_TEXT = "unknown";
		/** A value that may be absent: absent is unknown, present is known. NEVER a default in its place. */
		function factOf(value) {
			return value === null ? {
				known: false,
				text: UNKNOWN_TEXT
			} : {
				known: true,
				text: value
			};
		}
		/**
		* Build the strip's five facts.
		*
		* @param input - the live selection, the lane count the frame measured, and the route's answer (or null when it
		*   could not be read — a failed fetch is an unknown, never a zero).
		* @returns the facts, each marked known or unknown.
		*/
		function aumaStatusOf(input) {
			const answer = input.answer ?? null;
			const thread = aumaThreadOf({
				sessionId: input.sessionId ?? null,
				title: input.title ?? null,
				homeSessionId: typeof answer?.homeSession === "string" ? answer.homeSession : input.homeSessionId ?? null
			});
			const threadFact = thread.kind === "none" ? {
				known: false,
				text: UNKNOWN_TEXT
			} : {
				known: true,
				text: thread.kind === "home" ? "her home thread" : thread.text
			};
			const lanesAnswer = answer?.lanes;
			const lanes = (lanesAnswer !== null && lanesAnswer !== void 0 && Number.isFinite(Number(lanesAnswer.running)) ? String(Number(lanesAnswer.running)) : null) ?? (typeof input.lanesRunning === "number" && Number.isFinite(input.lanesRunning) ? String(input.lanesRunning) : null);
			const waitingCount = lanesAnswer !== null && lanesAnswer !== void 0 && Number.isFinite(Number(lanesAnswer.waitingOnOwner)) ? Number(lanesAnswer.waitingOnOwner) : null;
			const waitingFact = waitingCount === null ? null : waitingCount === 0 ? "none waiting on Peter" : `${String(waitingCount)} waiting on Peter`;
			const wakeAnswer = answer?.lastWake;
			const wakeFact = wakeAnswer !== null && wakeAnswer !== void 0 && typeof wakeAnswer.decision === "string" && wakeAnswer.decision.trim() !== "" ? `last wake: ${wakeAnswer.decision.trim()}` : null;
			const coreAnswer = answer?.core;
			const coreFact = coreAnswer !== null && coreAnswer !== void 0 && coreAnswer.known === true && typeof coreAnswer.exists === "boolean" ? coreAnswer?.exists === true ? "CORE session present" : "CORE session absent" : null;
			const hands = answer?.hands;
			const handsFact = Array.isArray(hands) ? `${String(hands.length)} hand${hands.length === 1 ? "" : "s"} resolvable` : null;
			const spendAnswer = answer?.spend;
			const spendKnown = spendAnswer !== null && spendAnswer !== void 0 && spendAnswer.known === true && Number.isFinite(Number(spendAnswer.spentTodayUsd)) && Number.isFinite(Number(spendAnswer.capUsd));
			const spent = spendKnown ? Number(spendAnswer?.spentTodayUsd) : 0;
			const cap = spendKnown ? Number(spendAnswer?.capUsd) : 0;
			const spend = spendKnown ? `$${spent.toFixed(2)} of $${cap.toFixed(2)} today` : null;
			const status = {
				thread: threadFact,
				lanes: factOf(lanes),
				waiting: factOf(waitingFact),
				core: factOf(coreFact),
				hands: factOf(handsFact),
				spend: factOf(spend),
				wake: factOf(wakeFact),
				anyUnknown: false
			};
			return Object.freeze({
				...status,
				anyUnknown: !status.thread.known || !status.lanes.known || !status.waiting.known || !status.core.known || !status.hands.known || !status.spend.known || !status.wake.known
			});
		}
		/** The lane words a conversation carries in its title — the same vocabulary the board and organism reader use. */
		const LANE_WORDS = /^(AUMA|AURA|AK-UI|AUMLOK|BETA|KIRA|ALPHA)\b/u;
		/** How recently a lane's thread must have moved to count as running. */
		const LANE_RUNNING_WINDOW_MS = 600 * 1e3;
		/**
		* HOW MANY LANES ARE RUNNING, from the live session store.
		*
		* A LANE IS A NAMED CONVERSATION THAT HAS MOVED RECENTLY: the title names a lane, the session is not blank, and
		* its `updatedAt` is inside the window. **A COUNT THAT WOULD BE A GUESS IS `null` INSTEAD**: a session whose
		* `updatedAt` is not a number leaves the count unknown, because the one thing worse than an unknown lane count is
		* a confident one — `SessionSummary.updatedAt` is required today, so that branch is a guard rather than a path.
		* @param sessions - the sessions store's list state, or anything else when the store is absent.
		* @param now - the clock, injectable so the window is measured rather than assumed.
		* @returns the count, or null when it cannot be counted.
		*/
		function lanesRunningOf(sessions, now = () => Date.now()) {
			if (sessions === null || sessions === void 0 || typeof sessions !== "object") return null;
			const ids = Array.isArray(sessions.ids) ? sessions.ids : null;
			const byId = sessions.byId;
			if (ids === null || byId === null || typeof byId !== "object") return null;
			const cutoff = now() - LANE_RUNNING_WINDOW_MS;
			let running = 0;
			for (const id of ids) {
				const summary = byId[id];
				if (summary === void 0 || summary === null) continue;
				if (typeof summary.updatedAt !== "number" || !Number.isFinite(summary.updatedAt)) return null;
				if (summary.blank === true) continue;
				const title = typeof summary.displayTitle === "string" ? summary.displayTitle.trim() : "";
				if (title === "" || !LANE_WORDS.test(title)) continue;
				if (summary.updatedAt < cutoff) continue;
				running += 1;
			}
			return running;
		}
		//#endregion
		//#region src/client/waiting.ts
		/**
		* WHO IS WAITING ON PETER, PER LANE — the fact AK-UI itself needed and nobody showed him.
		*
		* THE DEFECT THIS EXISTS FOR. AK-UI sat sixteen hours on four unanswered escalation approvals. They were never
		* refused and never granted; the work simply stopped, and nothing in the thread list said so. A lane that is
		* WAITING looks idle from the outside, which is the one state a person must never have to guess at.
		*
		* **UNKNOWN IS NEVER "NONE".** A lane whose question cannot be answered — no events were read, the source did not
		* answer, the approval carries no timestamp — renders as `unknown`, never as a reassuring blank. The distinction is
		* the whole point: "nobody is waiting on you" and "I could not find out" lead a person to different actions, and a
		* strip that conflates them sends him back to sleep. This is the same rule `auma-status.ts` applies to her facts.
		*
		* PURE, AND SOURCE-AGNOSTIC ON PURPOSE. It reads a list of approval EVENTS and nothing else, so it can be driven
		* by the session's own ask/outcome log — which the Host's `approval` service writes for every pair, and which is
		* readable today — and by AUMA's `/api/auma-live/status` lane facts the moment her commit lands. No clock, no
		* store, no fetch: `now` is injected, so an age is measured rather than assumed.
		*
		* @module waiting
		*/
		/** The word an undeterminable lane renders as. Spelled out, because a blank reads as "nobody needs you". */
		const WAITING_UNKNOWN = "unknown";
		/** The word a lane with nothing outstanding renders as. This is a FACT, not a default. */
		const WAITING_NONE = "none";
		/** Hours, minutes, days — the coarsest unit that still says something useful. */
		function waitingAgeText(ms) {
			const minutes = Math.floor(ms / 6e4);
			if (minutes < 1) return "less than a minute";
			if (minutes < 60) return `${String(minutes)}m`;
			const hours = Math.floor(minutes / 60);
			if (hours < 48) return `${String(hours)}h`;
			return `${String(Math.floor(hours / 24))}d`;
		}
		/**
		* The waiting fact for one lane.
		*
		* @param input - the lane to answer for, the approval events (or null when they could not be read), and the clock.
		* @returns the fact, with `known: false` when the question itself could not be answered.
		*/
		function waitingOf(input) {
			const unknown = {
				known: false,
				text: WAITING_UNKNOWN,
				oldestMs: null,
				approvalId: null
			};
			if (input.events === null || input.events === void 0) return unknown;
			const now = typeof input.now === "number" && Number.isFinite(input.now) ? input.now : null;
			const lane = typeof input.lane === "string" && input.lane !== "" ? input.lane : null;
			const named = input.events.some((event) => typeof event.lane === "string" && event.lane !== "");
			const mine = lane === null || !named ? [...input.events] : input.events.filter((event) => event.lane === lane);
			const closed = new Set(mine.filter((event) => event.kind === "answered" && typeof event.id === "string").map((event) => String(event.id)));
			const open = [];
			const pendingUnidentified = [];
			for (const event of mine) {
				if (event.kind === "asked") {
					if (typeof event.id === "string" && closed.has(event.id)) continue;
					open.push(event);
					if (typeof event.id !== "string") pendingUnidentified.push(event);
					continue;
				}
				if (typeof event.id === "string") {
					const index = open.findIndex((ask) => ask.id === event.id);
					if (index !== -1) open.splice(index, 1);
					continue;
				}
				const oldest = pendingUnidentified.shift();
				if (oldest !== void 0) {
					const index = open.indexOf(oldest);
					if (index !== -1) open.splice(index, 1);
				}
			}
			if (open.length === 0) return {
				known: true,
				text: WAITING_NONE,
				oldestMs: null,
				approvalId: null
			};
			const stamped = open.filter((event) => typeof event.at === "number" && Number.isFinite(event.at));
			const oldest = stamped.length === 0 ? null : stamped.reduce((best, event) => Number(event.at) < Number(best.at) ? event : best);
			const oldestMs = oldest === null || now === null ? null : Math.max(0, now - Number(oldest.at));
			const approvalId = oldest !== null && typeof oldest.id === "string" && oldest.id !== "" ? oldest.id : null;
			return {
				known: true,
				text: oldestMs === null ? "waiting" : `waiting ${waitingAgeText(oldestMs)}`,
				oldestMs,
				approvalId
			};
		}
		//#endregion
		//#region src/client/conversation-opener.ts
		/**
		* Whether one observed change of the current session opens the conversation.
		*
		* @param previous - the session the frame observed last, or undefined when it has seen none since mount or a gap.
		* @param next - the selection now.
		* @returns true only for a switch from one session to a different, non-blank one.
		*/
		function selectionOpensConversation(previous, next) {
			if (next.session === void 0) return false;
			if (previous === void 0) return false;
			if (next.session === previous) return false;
			if (next.blank !== false) return false;
			return true;
		}
		/** The frame's memory between renders: the last session it observed, fed through the decision above. */
		var ConversationOpener = class {
			#previous = void 0;
			/**
			* Record one observation of the selection.
			* @param next - the selection the frame's subscription delivers now.
			* @returns whether the frame opens the conversation for it.
			*/
			observe(next) {
				const opens = selectionOpensConversation(this.#previous, next);
				this.#previous = next.session;
				return opens;
			}
		};
		//#endregion
		//#region src/client/AppFrame.tsx
		/**
		* The lanes the host reported, with each one's waiting fact — or NULL when it did not report them at all.
		*
		* **NULL AND AN EMPTY LIST ARE DIFFERENT ANSWERS.** Null means the payload carried no `waiting` field, so nobody
		* knows; an empty list would mean every lane was read and none is waiting. The render keeps them apart for the same
		* reason the fact module does.
		*/
		function waitingLanesOf(answer, now) {
			if (answer === null || typeof answer !== "object") return null;
			const waiting = answer.waiting;
			if (!Array.isArray(waiting)) return null;
			return waiting.flatMap((entry) => {
				if (entry === null || typeof entry !== "object") return [];
				const { lane, sessionId, events } = entry;
				if (typeof lane !== "string" || lane === "" || typeof sessionId !== "string" || sessionId === "") return [];
				if (!Array.isArray(events)) return [];
				return [{
					lane,
					sessionId,
					fact: waitingOf({
						lane,
						now,
						events
					})
				}];
			});
		}
		/** Frame padding plus the two fixed inter-lane gaps. */
		const FRAME_FIXED_INLINE_SPACE = 32;
		const MENU_TABS = [
			"apps",
			"system",
			"yours"
		];
		const MENU_SLOTS = {
			apps: "shell.menu.apps",
			system: "shell.menu.system",
			yours: "shell.menu.yours"
		};
		/**
		* Identify the single visible lane of a focused preset.
		* @param preset - current pane preset.
		* @returns the focused lane, or undefined for multi-lane presets.
		*/
		function focusedLane(preset) {
			if (preset === "left-focus") return "left";
			if (preset === "center-focus") return "center";
			if (preset === "right-focus") return "right";
		}
		/** Inner measure used while one lane owns the complete frame rail. */
		function singleMeasure(preset) {
			if (preset.endsWith("-focus")) return "two-thirds";
		}
		/** One accessible pane-cycle control positioned on a lane corner. */
		function CornerControl(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: AppFrame_module_css_default.cornerControl,
				"data-corner": props.corner,
				"aria-label": props.label,
				onClick: props.onClick
			});
		}
		/** Compact geometric mark for one right-menu category. */
		function MenuTabIcon({ tab }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				className: AppFrame_module_css_default.menuTabIcon,
				viewBox: "0 0 16 16",
				"aria-hidden": "true",
				children: [
					tab === "apps" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M8 2.25 13.5 13H2.5L8 2.25Z" }),
					tab === "system" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "3",
						y: "3",
						width: "10",
						height: "10",
						rx: "1.5"
					}),
					tab === "yours" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "8",
						cy: "8",
						r: "5.25"
					})
				]
			});
		}
		/** Rounded lane wrapper shared by threads, center, and right-side content. */
		function LaneShell(props) {
			const laneClass = props.lane === "left" ? AppFrame_module_css_default.laneLeft : props.lane === "center" ? `${AppFrame_module_css_default.laneCenter} ${AppFrame_module_css_default.centerCol}` : AppFrame_module_css_default.laneRight;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
				className: `${AppFrame_module_css_default.lane} ${laneClass}`,
				"data-lane": props.lane,
				"data-pane-active": props.active || void 0,
				"aria-label": props.label,
				"aria-hidden": !props.active || void 0,
				ref: (element) => {
					element?.toggleAttribute("inert", !props.active);
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: AppFrame_module_css_default.laneShell,
					children: [props.controls, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: AppFrame_module_css_default.laneBody,
						children: props.children
					})]
				})
			});
		}
		/**
		* Convert the left track weight into the pixel owner value expected by the
		* existing sidebar occupant. Single-pane modes follow their centered measure.
		* @param frameWidth - measured spatial-frame width.
		* @param leftWeight - left track's fractional weight.
		* @param measure - centered measure when the left lane owns the frame.
		* @returns rendered sidebar content width in pixels.
		*/
		function laneWidth(frameWidth, weight, measure) {
			if (weight === 0) return 0;
			if (measure === "two-thirds") return Math.round(frameWidth * 2 / 3);
			const available = Math.max(0, frameWidth - FRAME_FIXED_INLINE_SPACE);
			return Math.round(available * weight / 3);
		}
		/** Three-lane application frame. */
		function AppFrame({ useStore, useSessions, actions, renderSlot, t, openThread }) {
			const state = useStore((value) => value);
			const currentSession = useSessions((sessions) => sessions.current);
			const currentThreadTitle = useSessions((sessions) => {
				const current = sessions.current;
				return current === void 0 ? void 0 : sessions.byId[current]?.displayTitle;
			});
			const lanesRunning = useSessions((sessions) => lanesRunningOf(sessions));
			const aumaLiveOpen = state.activeSurface === AUMA_LIVE_SURFACE;
			const [aumaAnswer, setAumaAnswer] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				if (!aumaLiveOpen) return void 0;
				let cancelled = false;
				const read = () => {
					fetch(AUMA_STATUS_PATH, { credentials: "same-origin" }).then((response) => response.ok ? response.json() : null).then((body) => {
						if (!cancelled) setAumaAnswer(body);
					}).catch(() => {
						if (!cancelled) setAumaAnswer(null);
					});
				};
				read();
				const timer = setInterval(read, 3e4);
				return () => {
					cancelled = true;
					clearInterval(timer);
				};
			}, [aumaLiveOpen]);
			const [lanesAnswer, setLanesAnswer] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				if (!aumaLiveOpen) return void 0;
				let cancelled = false;
				const read = () => {
					fetch(AUMA_MINDS_PATH, { credentials: "same-origin" }).then((response) => response.ok ? response.json() : null).then((body) => {
						if (!cancelled) setLanesAnswer(body);
					}).catch(() => {
						if (!cancelled) setLanesAnswer(null);
					});
				};
				read();
				const timer = setInterval(read, 3e4);
				return () => {
					cancelled = true;
					clearInterval(timer);
				};
			}, [aumaLiveOpen]);
			const currentBlank = useSessions((sessions) => {
				const current = sessions.current;
				return current === void 0 ? void 0 : sessions.byId[current]?.blank;
			});
			const detailsSession = useSessions((sessions) => {
				const current = sessions.current;
				return current !== void 0 && sessions.byId[current]?.blank === false ? current : void 0;
			});
			const [menuTab, setMenuTab] = (0, react.useState)("system");
			const frameRef = (0, react.useRef)(null);
			const [frameWidth, setFrameWidth] = (0, react.useState)(() => window.innerWidth);
			const menuId = (0, react.useId)();
			(0, react.useLayoutEffect)(() => {
				const frame = frameRef.current;
				if (frame === null) return;
				const measureFrame = () => {
					const width = frame.getBoundingClientRect().width;
					setFrameWidth(width > 0 ? width : window.innerWidth);
				};
				measureFrame();
				if (typeof ResizeObserver === "undefined") {
					window.addEventListener("resize", measureFrame);
					return () => {
						window.removeEventListener("resize", measureFrame);
					};
				}
				const observer = new ResizeObserver(measureFrame);
				observer.observe(frame);
				return () => {
					observer.disconnect();
				};
			}, []);
			const lastDetailsSession = (0, react.useRef)(detailsSession);
			const [conversationOpener] = (0, react.useState)(() => new ConversationOpener());
			(0, react.useLayoutEffect)(() => {
				if (conversationOpener.observe({
					session: currentSession,
					blank: currentBlank
				})) actions.openConversation();
			}, [
				actions,
				conversationOpener,
				currentSession,
				currentBlank
			]);
			(0, react.useLayoutEffect)(() => {
				if (detailsSession === void 0) return;
				if (lastDetailsSession.current !== void 0 && lastDetailsSession.current !== detailsSession) actions.closeDetails();
				lastDetailsSession.current = detailsSession;
			}, [actions, detailsSession]);
			const weights = PANE_WEIGHTS[state.panePreset];
			const focused = focusedLane(state.panePreset);
			const measure = singleMeasure(state.panePreset);
			const rightWidth = laneWidth(frameWidth, weights[2], focused === "right" ? measure : void 0);
			const owner = {
				...state.activeSurface === void 0 ? {} : { activeSurface: state.activeSurface },
				...state.surfaceTarget === void 0 ? {} : { surfaceTarget: state.surfaceTarget },
				openSurface: actions.selectSurface,
				closeSurface: actions.closeSurface
			};
			const showDetails = state.detailsOpen && detailsSession !== void 0;
			const activeMenuSlot = MENU_SLOTS[menuTab];
			const aumaThread = aumaThreadOf({
				sessionId: currentSession,
				title: currentThreadTitle
			});
			const waitingLanes = waitingLanesOf(lanesAnswer, Date.now());
			const laneTitles = useSessions((sessions) => sessions.byId);
			const aumaStatus = aumaStatusOf({
				sessionId: currentSession,
				title: currentThreadTitle,
				lanesRunning,
				answer: aumaAnswer
			});
			const chooseMenuTab = (tab, focus = false, tabList) => {
				setMenuTab(tab);
				if (!focus) return;
				const index = MENU_TABS.indexOf(tab);
				tabList?.querySelectorAll("[role=\"tab\"]")[index]?.focus();
			};
			const onTabKeyDown = (event, index) => {
				let next;
				if (event.key === "ArrowRight") next = (index + 1) % MENU_TABS.length;
				else if (event.key === "ArrowLeft") next = (index - 1 + MENU_TABS.length) % MENU_TABS.length;
				else if (event.key === "Home") next = 0;
				else if (event.key === "End") next = MENU_TABS.length - 1;
				if (next === void 0) return;
				const tab = MENU_TABS[next];
				if (tab === void 0) return;
				event.preventDefault();
				chooseMenuTab(tab, true, event.currentTarget.parentElement);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: frameRef,
				className: AppFrame_module_css_default.frame,
				"data-pane-preset": state.panePreset,
				"data-focused-lane": focused,
				"data-single-measure": measure,
				"data-surface-presentation": state.surfacePresentation ?? "contained",
				"data-conversation-open": state.conversationOpen || void 0,
				"data-details-open": showDetails || void 0,
				"data-details-collapsed": !showDetails || void 0,
				"data-sidebar-collapsed": weights[0] === 0 || void 0,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(LaneShell, {
						lane: "left",
						label: t("lane.threads"),
						active: weights[0] !== 0,
						controls: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [state.conversationOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CornerControl, {
							corner: "conversation-close",
							label: t("thread.close"),
							onClick: actions.closeConversation
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CornerControl, {
							corner: "left",
							label: t("corner.left"),
							onClick: actions.cycleLeft
						})] }),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: AppFrame_module_css_default.threadStack,
							"data-thread-view": state.conversationOpen ? "conversation" : "list",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: AppFrame_module_css_default.threadLayer,
								"data-thread-layer": "list",
								hidden: state.conversationOpen,
								children: renderSlot("sidebar", {
									collapsed: weights[0] === 0,
									width: laneWidth(frameWidth, weights[0], focused === "left" ? measure : void 0)
								})
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: AppFrame_module_css_default.threadLayer,
								"data-thread-layer": "conversation",
								hidden: !state.conversationOpen,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: AppFrame_module_css_default.threadConversationBody,
									children: renderSlot("main", {}, { entryKey: "conversation" })
								})
							})]
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(LaneShell, {
						lane: "center",
						label: t("lane.surface"),
						active: weights[1] !== 0,
						controls: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CornerControl, {
							corner: "center-left",
							label: t("corner.centerLeft"),
							onClick: actions.cycleCenterLeft
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CornerControl, {
							corner: "center-right",
							label: t("corner.centerRight"),
							onClick: actions.cycleCenterRight
						})] }),
						children: [
							state.activeSurface === "auma-live" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: AppFrame_module_css_default.aumaStatus,
								"data-auma-status": aumaStatus.anyUnknown ? "unknown" : "known",
								children: [
									[
										"thread",
										t("status.thread"),
										aumaStatus.thread
									],
									[
										"lanes",
										t("status.lanes"),
										aumaStatus.lanes
									],
									[
										"waiting",
										t("status.waiting"),
										aumaStatus.waiting
									],
									[
										"core",
										t("status.core"),
										aumaStatus.core
									],
									[
										"hands",
										t("status.hands"),
										aumaStatus.hands
									],
									[
										"spend",
										t("status.spend"),
										aumaStatus.spend
									],
									[
										"wake",
										t("status.wake"),
										aumaStatus.wake
									]
								].map(([id, label, fact]) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: fact.known ? AppFrame_module_css_default.aumaStatusKnown : AppFrame_module_css_default.aumaStatusUnknown,
									"data-auma-status-item": id,
									"data-known": fact.known,
									children: [
										label,
										": ",
										fact.text
									]
								}, id))
							}) : null,
							state.activeSurface === "auma-live" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: AppFrame_module_css_default.aumaWaiting,
								"data-auma-waiting": waitingLanes === null ? "unknown" : "known",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: AppFrame_module_css_default.aumaWaitingTitle,
									children: t("waiting.title")
								}), waitingLanes === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: AppFrame_module_css_default.aumaStatusUnknown,
									"data-auma-waiting-item": "unread",
									children: t("waiting.unread")
								}) : waitingLanes.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: row.fact.text === "none" ? AppFrame_module_css_default.aumaWaitingClear : AppFrame_module_css_default.aumaWaitingBadge,
									"data-auma-waiting-item": row.lane,
									"data-waiting": row.fact.known ? row.fact.text === "none" ? "clear" : "waiting" : "unknown",
									"data-session": row.sessionId,
									children: row.fact.known ? row.fact.text === "none" ? `${laneTitles[row.sessionId]?.displayTitle ?? row.lane}: ${t("waiting.clear")}` : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: AppFrame_module_css_default.aumaWaitingOpen,
										onClick: () => {
											openThread?.(row.sessionId);
										},
										children: `${laneTitles[row.sessionId]?.displayTitle ?? row.lane}: ${t("waiting.badge")} ${row.fact.oldestMs === null ? "" : waitingAgeText(row.fact.oldestMs)}`.trim()
									}) : `${laneTitles[row.sessionId]?.displayTitle ?? row.lane}: ${t("waiting.unknown")}`
								}, row.lane))]
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: AppFrame_module_css_default.surfaceStack,
								"data-surface-active": state.activeSurface,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: AppFrame_module_css_default.surfaceEmpty,
									"data-surface-empty": true,
									hidden: state.activeSurface !== void 0,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("surface.empty") })
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: AppFrame_module_css_default.surfaceLayer,
									"data-surface-layer": "extension",
									children: renderSlot("shell.surface", owner)
								})]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(LaneShell, {
						lane: "right",
						label: t("lane.menu"),
						active: weights[2] !== 0,
						controls: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CornerControl, {
							corner: "right",
							label: t("corner.right"),
							onClick: actions.cycleRight
						}),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: AppFrame_module_css_default.rightStack,
							"data-menu-tab": menuTab,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: AppFrame_module_css_default.rightLayer,
								"data-right-layer": "menu",
								hidden: showDetails,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: AppFrame_module_css_default.menuHeader,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: AppFrame_module_css_default.menuHeading,
										"data-menu-heading": true,
										children: t(`menu.${menuTab}`)
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: AppFrame_module_css_default.menuTabs,
										role: "tablist",
										"aria-label": t("menu.tabs"),
										children: MENU_TABS.map((tab, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											id: `${menuId}-${tab}`,
											type: "button",
											role: "tab",
											className: AppFrame_module_css_default.menuTab,
											"data-menu-tab": tab,
											"aria-selected": menuTab === tab,
											"aria-controls": `${menuId}-panel`,
											tabIndex: menuTab === tab ? 0 : -1,
											onClick: () => {
												chooseMenuTab(tab);
											},
											onKeyDown: (event) => {
												onTabKeyDown(event, index);
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MenuTabIcon, { tab }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: AppFrame_module_css_default.visuallyHidden,
												children: t(`menu.${tab}`)
											})]
										}, tab))
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									id: `${menuId}-panel`,
									className: AppFrame_module_css_default.menuPanel,
									role: "tabpanel",
									"aria-labelledby": `${menuId}-${menuTab}`,
									children: [menuTab === "apps" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
										className: AppFrame_module_css_default.aumaThread,
										"data-auma-thread": aumaThread.kind,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: AppFrame_module_css_default.aumaThreadWhat,
												children: t("menu.aumaThread")
											}),
											" ",
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: AppFrame_module_css_default.aumaThreadWho,
												children: aumaThread.kind === "home" ? t("menu.aumaThread.home") : aumaThread.kind === "none" ? t("menu.aumaThread.none") : aumaThread.text
											})
										]
									}) : null, renderSlot(activeMenuSlot, owner, { fallback: menuTab === "yours" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: AppFrame_module_css_default.menuEmpty,
										children: t("menu.yours.empty")
									}) : null })]
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: AppFrame_module_css_default.rightLayer,
								"data-right-layer": "details",
								hidden: !showDetails,
								children: renderSlot("rightbar", {
									width: rightWidth,
									viewportWidth: frameWidth,
									canShow: showDetails
								})
							})]
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: AppFrame_module_css_default.overlayLayer,
						"data-shell-overlay": true,
						children: renderSlot("shell.overlay", {})
					})
				]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/** `layout` namespace dictionaries. */
		/** Dictionary namespace owned by the spatial shell. */
		const NS = "layout";
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"composer.mode": "会话模式",
			"composer.chat": "CHAT",
			"composer.build": "BUILD",
			"composer.yolo": "YOLO",
			"composer.yoloReason": "YOLO 不可用：必须保留原生隔离。",
			"composer.vision": "VISION",
			"composer.visionUnavailable": "视觉不可用",
			"composer.visionReason": "视觉不可用：尚未接入真实能力和权限状态。",
			"composer.modeUnknown": "尚未收到主机模式。",
			"composer.modeUnavailable": "原生隔离不可用，不能切换模式。",
			"composer.currentYolo": "主机模式为 YOLO；完全访问不可用。",
			"composer.failed": "模式更改未确认，请查看主机状态。",
			"why.receipt.empty": "这份回执是空的——它没有记下任何当时在她提示里的东西。",
			"why.title": "她为什么这么说",
			"why.lead": "这是她回答你的时候，手里握着的东西。",
			"why.group.outside": "这一整块都是外面来的话",
			"why.outside": "外面来的话，不能当作授权",
			"why.rebuild.matches": "重新拼起来的是同一份，和发出去的一模一样。",
			"why.rebuild.differs": "重新拼出来的和发出去的不一样——这份记录对不上。",
			"why.rebuild.unchecked": "没有重建过，所以没法确认：",
			"why.trouble.absent": "读不到回执的服务，所以这里没有东西可显示。",
			"why.trouble.failed": "回执没能读出来。",
			"menu.why": "她为什么这么说",
			"menu.why.tip": "看看她回答时手里握着什么",
			"firstRun.trouble.noThread": "Auma 这里还没有可以打开的对话——第一次对话还没有开始。",
			"firstRun.trouble.absent": "第一遍设置的界面连不上服务，所以现在还保存不了。",
			"firstRun.trouble.failed": "刚才那一步没保存成功。你可以再试一次。",
			"approvals.absent": "这台机器还没有批准记录——不是没有批准过，是还没有开始记。",
			"approvals.skipped": "有几行记录读不出来，所以这里可能不全。",
			"approvals.source.none": "还没有批准记录文件。",
			"approvals.title": "批准记录",
			"approvals.noProof": "是有人在这台 Mac 上点了“批准”；这个应用还没法证明那是你。",
			"approvals.empty": "还没有任何批准记录。",
			"approvals.subject.none": "（记录里没有写清楚问的是什么）",
			"approvals.dwell.none": "没有记录看了多久",
			"approvals.words.mismatch": "给你看的字和实际要签的不一样",
			"approvals.open.show": "展开原文",
			"approvals.open.hide": "收起原文",
			"approvals.trouble.absent": "读不到批准记录的服务，所以这里没有东西可显示。",
			"approvals.trouble.failed": "批准记录没能读出来。",
			"approvals.source.fixture": "这是示例记录，不是真的历史。",
			"approvals.source.log": "这是真实的批准记录。",
			"approvals.pending.title": "在等你决定",
			"approvals.pending.empty": "现在没有等你的记忆。",
			"approvals.pending.absent": "读不到记忆队列，所以这里不代表「没有等你的东西」。",
			"approvals.pending.bytes": "下面是要批准的原话。",
			"approvals.pending.approve": "批准",
			"approvals.pending.asking": "正在提交…",
			"approvals.pending.asked": "已经交给主人了；还需要他本人当面回答，这一步不能代替他。",
			"approvals.pending.refused": "没有提交：",
			"approvals.pending.unreadable": "有 {n} 个排队文件读不出来，所以这里可能不全。",
			"menu.approvals": "批准记录",
			"menu.approvals.tip": "看看都批准过什么",
			"health.title": "这台机器的状态",
			"health.lead": "这里的每个数字都写着它是从哪儿来的。",
			"health.empty": "还没有取到任何一次读数。",
			"health.unknown": "还不知道",
			"health.disk": "剩余磁盘",
			"health.disk.free": "可用",
			"health.scratch": "AUKORA 的临时文件",
			"health.footprint": "后台占用内存",
			"health.pressure": "系统内存压力",
			"health.lanes": "正在跑的泳道",
			"health.lanes.value": "运行中 {running}，等你 {waiting}",
			"health.ci": "最近一次 CI",
			"health.trend.none": "历史还不够，看不出趋势",
			"health.warn.disk": "磁盘快满了——不到 20 GB。",
			"health.warn.restart": "后台内存快到上限了，建议重启它。",
			"health.warn.near": "后台内存正在接近上限。是否重启由看门狗决定。",
			"health.trouble.absent": "读不到状态服务，所以这里没有读数。",
			"health.trouble.failed": "状态读数没能取出来。",
			"menu.health": "机器状态",
			"menu.health.tip": "看看磁盘、内存和泳道",
			"firstRun.title": "欢迎——我们来让你和 Auma 说上话",
			"firstRun.lab": "这是一个实验版本。它会老实说明什么能用、什么还不能用，不会装作一切正常。",
			"firstRun.name.label": "她该怎么称呼你？",
			"firstRun.name.placeholder": "你的名字",
			"firstRun.key.label": "你自己的模型密钥（OpenRouter）",
			"firstRun.key.promise": "只保存在这台机器上。不会写进日志，也不会放进提示词。你随时可以在这里删掉它。",
			"firstRun.key.remove": "删除已保存的密钥",
			"firstRun.key.prefix": "这看起来不是 OpenRouter 的密钥——它们的开头是 sk-or-。",
			"firstRun.key.short": "这个密钥看起来太短，可能没复制完整。",
			"firstRun.key.empty": "请粘贴你的密钥再继续。",
			"firstRun.voice.label": "声音",
			"firstRun.voice.on": "直接说话",
			"firstRun.voice.off": "打字",
			"firstRun.voice.onNote": "直接说话需要先在这台机器上做一次设置才能用。你可以以后再设置，先用打字。",
			"firstRun.voice.offNote": "打字不需要任何设置。你以后可以再打开声音。",
			"firstRun.status.on": "已开启",
			"firstRun.status.off": "未开启",
			"firstRun.status.unknown": "还不知道",
			"firstRun.topic.voice": "声音",
			"firstRun.topic.memory": "记忆",
			"firstRun.topic.approvals": "批准",
			"firstRun.topic.messaging": "消息",
			"firstRun.start": "开始说话",
			"firstRun.start.needsKey": "先填上你的密钥——她靠它来思考。",
			"lane.threads": "会话",
			"lane.surface": "当前页面",
			"lane.menu": "导航菜单",
			"menu.tabs": "导航分类",
			"menu.apps": "Aukora 应用",
			"menu.system": "系统",
			"menu.yours": "我的应用",
			"menu.yours.empty": "你创建的应用会显示在这里",
			"thread.close": "返回会话列表",
			"surface.empty": "应用将在此处打开",
			"corner.left": "切换会话栏宽度",
			"corner.centerLeft": "向左切换主页面宽度",
			"corner.centerRight": "向右切换主页面宽度",
			"corner.right": "切换菜单栏宽度",
			"menu.aumaThread": "Auma Live 正在使用的会话",
			"menu.aumaThread.home": "她的 AUMA 主会话",
			"menu.aumaThread.none": "未选择会话",
			"status.thread": "会话",
			"status.lanes": "运行中的泳道",
			"status.waiting": "等待你",
			"status.core": "CORE",
			"status.hands": "订阅通道",
			"status.spend": "今日花费",
			"status.wake": "最近唤醒",
			"waiting.title": "等待你",
			"waiting.badge": "已等待",
			"waiting.clear": "无",
			"waiting.unknown": "未知",
			"waiting.unread": "未知——无法读取各泳道",
			"firstRun.key.placeholder": "sk-or-…"
		};
		/** English dictionary, checked complete against the Chinese key set. */
		const en = {
			"composer.mode": "Session mode",
			"composer.chat": "CHAT",
			"composer.build": "BUILD",
			"composer.yolo": "YOLO",
			"composer.yoloReason": "YOLO unavailable: native confinement is required.",
			"composer.vision": "VISION",
			"composer.visionUnavailable": "Vision unavailable",
			"composer.visionReason": "Vision unavailable: capability and permission state are not connected.",
			"composer.modeUnknown": "Host mode has not been received.",
			"composer.modeUnavailable": "Native confinement unavailable; mode changes are disabled.",
			"composer.currentYolo": "Host mode is YOLO; full access is unavailable.",
			"composer.failed": "Mode change was not confirmed. Check the host state.",
			"why.receipt.empty": "This receipt is empty — it records nothing that was in her prompt.",
			"why.title": "Why she said that",
			"why.lead": "This is what she was holding when she answered you.",
			"why.group.outside": "this whole block is words from outside",
			"why.outside": "words from outside; could not authorise anything",
			"why.rebuild.matches": "Rebuilt from the pieces and it is the same as what was sent.",
			"why.rebuild.differs": "The rebuild is not the same as what was sent — this record does not match.",
			"why.rebuild.unchecked": "No rebuild was recorded, so this cannot be confirmed:",
			"why.trouble.absent": "The receipt service is not running, so there is nothing to show here.",
			"why.trouble.failed": "The receipt could not be read.",
			"menu.why": "Why she said that",
			"menu.why.tip": "See what she was holding when she answered",
			"lane.threads": "Threads",
			"lane.surface": "Current surface",
			"lane.menu": "Navigation menu",
			"menu.tabs": "Navigation categories",
			"menu.apps": "Aukora Apps",
			"menu.system": "System",
			"menu.yours": "My Apps",
			"menu.yours.empty": "Apps you create will appear here",
			"thread.close": "Back to threads",
			"surface.empty": "Apps open here",
			"corner.left": "Cycle thread pane width",
			"corner.centerLeft": "Cycle main pane toward threads",
			"corner.centerRight": "Cycle main pane toward menu",
			"corner.right": "Cycle menu pane width",
			"menu.aumaThread": "Auma Live is speaking through",
			"menu.aumaThread.home": "her home AUMA thread",
			"menu.aumaThread.none": "no thread selected",
			"status.thread": "Thread",
			"status.lanes": "Lanes running",
			"status.waiting": "Waiting on you",
			"status.core": "CORE",
			"status.hands": "Subscription hands",
			"status.spend": "Spent today",
			"status.wake": "Last wake",
			"waiting.title": "Waiting on you",
			"waiting.badge": "waiting",
			"waiting.clear": "none",
			"waiting.unknown": "unknown",
			"waiting.unread": "unknown — the lanes could not be read",
			"firstRun.key.placeholder": "sk-or-…",
			"firstRun.trouble.noThread": "There is no conversation for Auma to open yet — this machine has not started one.",
			"firstRun.trouble.absent": "The first-run service is not running, so nothing can be saved yet.",
			"firstRun.trouble.failed": "That step did not save. You can try again.",
			"approvals.absent": "This Mac has no approval log yet — not that nothing was approved, but that nothing has been logged.",
			"approvals.skipped": "Some lines of the log could not be read, so this may be incomplete.",
			"approvals.source.none": "There is no approval log file yet.",
			"approvals.title": "Approvals",
			"approvals.noProof": "someone at this Mac clicked Approve; the app cannot yet prove it was you",
			"approvals.empty": "Nothing has been approved yet.",
			"approvals.subject.none": "(the record does not say what was asked)",
			"approvals.dwell.none": "how long he looked was not recorded",
			"approvals.words.mismatch": "the words shown were not the words signed",
			"approvals.open.show": "Open the text he saw",
			"approvals.open.hide": "Hide the text he saw",
			"approvals.trouble.absent": "The approval log service is not running, so there is nothing to show here.",
			"approvals.trouble.failed": "The approval log could not be read.",
			"approvals.source.fixture": "These are example records, not real history.",
			"approvals.source.log": "This is the real approval history.",
			"approvals.pending.title": "Waiting for you",
			"approvals.pending.empty": "No memories are waiting for you.",
			"approvals.pending.absent": "The memory queue could not be read, so this is not \"nothing is waiting\".",
			"approvals.pending.bytes": "These are the exact words you would be approving.",
			"approvals.pending.approve": "Approve",
			"approvals.pending.asking": "Submitting…",
			"approvals.pending.asked": "Handed to the owner; he still answers in person, and this step cannot stand in for him.",
			"approvals.pending.refused": "Not submitted: ",
			"approvals.pending.unreadable": "{n} queued file(s) could not be read, so this may be incomplete.",
			"menu.approvals": "Approvals",
			"menu.approvals.tip": "See what has been approved",
			"health.title": "How this machine is doing",
			"health.lead": "Every number here says where it came from.",
			"health.empty": "No reading has been taken yet.",
			"health.unknown": "not known yet",
			"health.disk": "Free disk",
			"health.disk.free": "free",
			"health.scratch": "AUKORA scratch",
			"health.footprint": "Backend memory",
			"health.pressure": "Memory pressure",
			"health.lanes": "Lanes",
			"health.lanes.value": "{running} running, {waiting} waiting on you",
			"health.ci": "Last CI result",
			"health.trend.none": "not enough history yet to see a trend",
			"health.warn.disk": "Disk is running out — under 20 GB free.",
			"health.warn.restart": "Backend memory is past the limit; a restart is recommended.",
			"health.warn.near": "Backend memory is nearing the limit. Whether to restart is the watchdog’s call.",
			"health.trouble.absent": "The health service is not running, so there are no readings.",
			"health.trouble.failed": "The health readings could not be taken.",
			"menu.health": "Health",
			"menu.health.tip": "Disk, memory and lanes at a glance",
			"firstRun.title": "Welcome — let’s get you talking to Auma",
			"firstRun.lab": "This is a lab build. It is honest about what works and what does not, and it will not pretend otherwise.",
			"firstRun.name.label": "What should she call you?",
			"firstRun.name.placeholder": "your name",
			"firstRun.key.label": "Your own model key (OpenRouter)",
			"firstRun.key.promise": "Kept on this machine only. It is never written to a log and never put in a prompt. You can remove it here at any time.",
			"firstRun.key.remove": "Remove the stored key",
			"firstRun.key.prefix": "That does not look like an OpenRouter key — they begin with sk-or-.",
			"firstRun.key.short": "That key looks too short to be complete.",
			"firstRun.key.empty": "Paste your key to continue.",
			"firstRun.voice.label": "Voice",
			"firstRun.voice.on": "Talk out loud",
			"firstRun.voice.off": "Type instead",
			"firstRun.voice.onNote": "Talking out loud needs a one-time setup on this machine before it can work. You can set it up later and type until then.",
			"firstRun.voice.offNote": "Typing needs no setup. You can turn voice on later.",
			"firstRun.status.on": "on",
			"firstRun.status.off": "off",
			"firstRun.status.unknown": "not known yet",
			"firstRun.topic.voice": "Voice",
			"firstRun.topic.memory": "Memory",
			"firstRun.topic.approvals": "Approvals",
			"firstRun.topic.messaging": "Messaging",
			"firstRun.start": "Start talking",
			"firstRun.start.needsKey": "Add your key first — it is what lets her think."
		};
		//#endregion
		//#region \0dsh-css:ComposerControls.module.css.mjs
		const css$2 = ".g6A8Uq_controls{flex:none;align-items:center;gap:10px;min-width:0;display:inline-flex}.g6A8Uq_mode,.g6A8Uq_vision{align-items:center;gap:5px;height:28px;display:inline-flex}.g6A8Uq_mode{--composer-accent:var(--aukora-text-muted)}.g6A8Uq_mode[data-mode=\"0\"]{--composer-accent:var(--aukora-green)}.g6A8Uq_mode[data-mode=\"1\"]{--composer-accent:var(--aukora-blue)}.g6A8Uq_mode[data-mode=\"2\"]{--composer-accent:var(--aukora-gold)}.g6A8Uq_slider{flex:none;align-items:center;width:28px;height:28px;display:inline-flex;position:relative}.g6A8Uq_track{box-sizing:border-box;border:1px solid var(--aukora-border);background:0 0;border-radius:999px;width:28px;height:10px;display:block;position:relative}.g6A8Uq_fill{border-radius:inherit;background:var(--composer-accent);opacity:.7;width:0;transition:width .16s;position:absolute;top:0;bottom:0;left:0}.g6A8Uq_mode[data-mode=\"1\"] .g6A8Uq_fill{width:13px}.g6A8Uq_mode[data-mode=\"2\"] .g6A8Uq_fill{width:22px}.g6A8Uq_dot{background:var(--composer-accent);border-radius:50%;width:6px;height:6px;transition:transform .16s;position:absolute;top:50%;left:1px;transform:translateY(-50%)}.g6A8Uq_mode[data-mode=\"1\"] .g6A8Uq_dot{transform:translate(9px,-50%)}.g6A8Uq_mode[data-mode=\"2\"] .g6A8Uq_dot{transform:translate(18px,-50%)}.g6A8Uq_mode[data-mode=\"-1\"] .g6A8Uq_dot{visibility:hidden}.g6A8Uq_range{opacity:0;cursor:pointer;width:28px;height:28px;margin:0;position:absolute;inset:0}.g6A8Uq_slider:has(.g6A8Uq_range:focus-visible) .g6A8Uq_track{outline:2px solid var(--composer-accent);outline-offset:3px}.g6A8Uq_mode[data-disabled=true],.g6A8Uq_vision{opacity:.5}.g6A8Uq_range:disabled{cursor:default}.g6A8Uq_label{width:30px;color:var(--composer-accent);letter-spacing:.03em;white-space:nowrap;font-size:9px;font-weight:400;line-height:12px}.g6A8Uq_vision{--composer-accent:var(--aukora-text-muted);cursor:default}.g6A8Uq_vision .g6A8Uq_label{width:auto}.g6A8Uq_vision[data-vision=on]{--composer-accent:var(--aukora-purple)}.g6A8Uq_vision[data-vision=on] .g6A8Uq_dot{transform:translate(18px,-50%)}.g6A8Uq_vision[data-vision=on] .g6A8Uq_fill{width:22px}.g6A8Uq_mode[data-error=true] .g6A8Uq_track{border-color:var(--aukora-red-warning)}.g6A8Uq_srOnly{clip-path:inset(50%);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}@media (prefers-reduced-motion:reduce){.g6A8Uq_dot,.g6A8Uq_fill{transition:none}}@media (forced-colors:active){.g6A8Uq_track{border-color:canvastext}.g6A8Uq_dot,.g6A8Uq_fill{background:highlight}.g6A8Uq_vision .g6A8Uq_dot{background:graytext}}";
		const tagId$2 = "@aukora/face-layout/ComposerControls.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$2) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@aukora/face-layout";
			tag.dataset.pluginCss = tagId$2;
			tag.textContent = css$2;
			document.head.appendChild(tag);
		}
		var ComposerControls_module_css_default = {
			"controls": "g6A8Uq_controls",
			"dot": "g6A8Uq_dot",
			"fill": "g6A8Uq_fill",
			"label": "g6A8Uq_label",
			"mode": "g6A8Uq_mode",
			"range": "g6A8Uq_range",
			"slider": "g6A8Uq_slider",
			"srOnly": "g6A8Uq_srOnly",
			"track": "g6A8Uq_track",
			"vision": "g6A8Uq_vision"
		};
		//#endregion
		//#region src/client/ComposerControls.tsx
		const modes = [
			"read-only",
			"workspace-write",
			"danger-full-access"
		];
		const copy = [
			"composer.chat",
			"composer.build",
			"composer.yolo"
		];
		/** The dot and single label follow the host projection; unavailable controls never invent a selection. */
		function ComposerControls({ locked, selectMode, useProjection, sessionId, t }) {
			const state = useProjection("aukoraComposerMode");
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(false);
			const generation = (0, react.useRef)(0);
			const hintId = (0, react.useId)();
			const visionHintId = (0, react.useId)();
			(0, react.useEffect)(() => {
				generation.current++;
				setBusy(false);
				setError(false);
				return () => {
					generation.current++;
				};
			}, [sessionId]);
			const choose = async (mode) => {
				if (mode === "danger-full-access" || busy || locked || state?.available !== true || state.mode === mode) return;
				const submittedGeneration = generation.current;
				setBusy(true);
				setError(false);
				try {
					await selectMode(mode);
				} catch {
					if (generation.current === submittedGeneration) setError(true);
				} finally {
					if (generation.current === submittedGeneration) setBusy(false);
				}
			};
			const index = state === void 0 ? -1 : modes.indexOf(state.mode);
			const label = index < 0 ? "—" : t(copy[index] ?? "composer.mode");
			const disabled = state === void 0 || !state.available || locked || busy;
			const hint = [t("composer.yoloReason"), state === void 0 ? t("composer.modeUnknown") : !state.available ? t("composer.modeUnavailable") : state.mode === "danger-full-access" ? t("composer.currentYolo") : ""].filter(Boolean).join(" ");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: ComposerControls_module_css_default.controls,
				"aria-busy": busy,
				"data-composer-mode": state?.mode ?? "unknown",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: ComposerControls_module_css_default.mode,
						"data-mode": index,
						"data-disabled": disabled || void 0,
						"data-error": error || void 0,
						title: hint,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: ComposerControls_module_css_default.slider,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: ComposerControls_module_css_default.track,
									"aria-hidden": "true",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: ComposerControls_module_css_default.fill }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: ComposerControls_module_css_default.dot })]
								}), index >= 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: ComposerControls_module_css_default.range,
									type: "range",
									min: "0",
									max: "2",
									step: "1",
									value: index,
									"aria-label": t("composer.mode"),
									"aria-valuetext": label,
									"aria-describedby": hintId,
									disabled,
									onChange: (event) => {
										const requested = modes[Number(event.currentTarget.value)];
										event.currentTarget.value = String(index);
										if (requested !== void 0) choose(requested);
									}
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ComposerControls_module_css_default.label,
								"aria-hidden": "true",
								children: label
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								id: hintId,
								className: ComposerControls_module_css_default.srOnly,
								children: hint
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: ComposerControls_module_css_default.vision,
						"data-vision": "unavailable",
						role: "group",
						"aria-label": t("composer.visionUnavailable"),
						"aria-disabled": "true",
						"aria-describedby": visionHintId,
						title: t("composer.visionReason"),
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ComposerControls_module_css_default.slider,
								"aria-hidden": "true",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: ComposerControls_module_css_default.track,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: ComposerControls_module_css_default.fill }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: ComposerControls_module_css_default.dot })]
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ComposerControls_module_css_default.label,
								"aria-hidden": "true",
								children: t("composer.vision")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								id: visionHintId,
								className: ComposerControls_module_css_default.srOnly,
								children: t("composer.visionReason")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: ComposerControls_module_css_default.srOnly,
						role: "alert",
						children: error ? t("composer.failed") : ""
					})
				]
			});
		}
		/** Replace the existing permission seat and inspect the canonical command's host outcome. */
		function installComposerControls(ctx) {
			ctx.slots.inject("conversation.input.permission", () => ctx.slots.register({
				name: "conversation.input.permission",
				priority: -10,
				locale: NS,
				inject: (sessionId) => ({ selectMode: async (mode) => {
					if (ctx.sessions.binding(sessionId)?.session === void 0) throw new Error("Session unavailable");
					const remote = ctx.get("remote");
					if (remote?.commands === void 0) throw new Error("Command transport unavailable");
					const result = await remote.commands.execute(sessionId, `/aukora-mode ${mode}`, []);
					if (!result.ok || result.value?.result.kind !== "success") throw new Error("Mode change unavailable");
				} })
			}, ComposerControls));
		}
		//#endregion
		//#region src/client/service.ts
		/** `ctx.layout` controller backed by the mounted root entry's store actions. */
		var LayoutController = class {
			#panels;
			/** Pending navigation, aborted when a later one begins or the owner unloads. */
			#navigation = new AbortController();
			/**
			* Begin a navigation and cancel any earlier one.
			* @returns the signal for this navigation.
			*/
			beginNavigation() {
				this.#navigation.abort();
				this.#navigation = new AbortController();
				return this.#navigation.signal;
			}
			/**
			* Record the harness's main-panel selection — and OPEN NOTHING.
			*
			* WHO CALLS THIS, MEASURED — AND THE LOAD-TIME CALLER IS THE HARNESS ITSELF. Upstream's thread browser and
			* sidebar call it with `null` to show the conversation, and both upstream rows are disabled in this composition
			* (`scripts/materialize-aukora-release.py`). That leaves the harness, and it calls this on EVERY PAGE LOAD with
			* nobody touching anything — which is why the method exists in this shape, and what the startup panel court
			* drives directly (`tests/aukora-layout-startup-panel.test.mjs`, "THE HARNESS SELECTING ITS PANEL ON LOAD OPENS
			* NOTHING"). The other callers are the threads face's own gestures in `threads/src/client/navigation.ts`, which
			* call `openConversation()` explicitly first. This call is bookkeeping about which panel is active — it carries
			* no intent — and this shell has exactly one panel, so there is nothing else it could switch to. It used to open
			* the conversation too; that was not the load-time opener (the frame's own selection watcher was — see
			* `conversation-opener.ts`), but a call that means nothing must not navigate — least of all one the harness makes
			* by itself, on every load, before a person has done anything.
			* @param panelId - upstream main-panel id, or null for the conversation.
			*/
			selectPanel(panelId) {
				if (panelId !== null) return;
			}
			/** Invalidate a pending navigation when the layout owner is unloaded. */
			dispose() {
				this.#navigation.abort();
			}
			/**
			* Attach the root entry's current action set. A replacement registration
			* overwrites actions captured from the prior entry instance.
			* @param actions - bound actions of the root spatial-layout store.
			*/
			attachPanels(actions) {
				this.#panels = actions;
			}
			/** Select a center surface, an optional target, and its focused-canvas behavior. */
			openSurface(id, target, presentation) {
				if (presentation === void 0) this.#require().selectSurface(id, target);
				else this.#require().selectSurface(id, target, presentation);
			}
			/** Return the center lane to its empty app canvas. */
			closeSurface() {
				this.#require().closeSurface();
			}
			/** Replace the left thread browser with the resident Conversation. */
			openConversation() {
				this.#require().openConversation();
			}
			/** Return the left lane to its thread browser. */
			closeConversation() {
				this.#require().closeConversation();
			}
			/** Toggle the thread lane between visible and hidden presets. */
			toggleSidebar() {
				this.#require().toggleSidebar();
			}
			/** Show details for the current real Session and return to balanced panes. */
			openDetails() {
				this.#require().openDetails();
			}
			/** Return the right lane to its navigation menu. */
			closeDetails() {
				this.#require().closeDetails();
			}
			/**
			* Show the right column for the right Sidebar.
			* @param _track - upstream column reservation; this frame's lanes are fixed.
			* @param _fullscreen - upstream viewport cover; this frame has no such mode.
			*/
			openRightbar(_track, _fullscreen) {
				this.openDetails();
			}
			/** Hide the right column for the right Sidebar. */
			closeRightbar() {
				this.closeDetails();
			}
			/** @returns the attached store actions, or throws when root assembly has not completed. */
			#require() {
				if (this.#panels === void 0) throw new Error("layout: actions not wired (root entry not mounted)");
				return this.#panels;
			}
		};
		//#endregion
		//#region src/client/theme-presenter.ts
		/** Body attribute selecting the dark base palette in the token stylesheets. */
		const DARK_ATTRIBUTE = "data-ds-dark-theme";
		/** Applies theme snapshots to the document; one instance per plugin fiber. */
		var ThemePresenter = class {
			/** Token names this presenter wrote in the last apply (its retraction set). */
			appliedTokens = [];
			/** The single metadata node this presenter inserts and removes. */
			themeColorMeta;
			/** Create the presenter-owned metadata node before the first snapshot arrives. */
			constructor() {
				this.themeColorMeta = document.createElement("meta");
				this.themeColorMeta.name = "theme-color";
			}
			/**
			* AUKORA has one dark surface, so native controls and the legacy token palette
			* stay dark even when the saved preference or OS scheme is light. Light-mode
			* overrides cannot be applied on that surface: use the registered dark base
			* in that case. This presents the fixed palette without writing preferences.
			* @param snapshot - resolved theme snapshot from ctx.theme.
			*/
			apply(snapshot) {
				document.documentElement.style.colorScheme = "dark";
				const body = document.body;
				body.setAttribute(DARK_ATTRIBUTE, "");
				for (const name of this.appliedTokens) body.style.removeProperty(name);
				this.appliedTokens = [];
				const tokens = snapshot.active.colorScheme === "dark" ? snapshot.active.tokens : snapshot.themes.find((theme) => theme.id === "dark")?.tokens ?? {};
				for (const [name, value] of Object.entries(tokens)) {
					body.style.setProperty(name, value);
					this.appliedTokens.push(name);
				}
				this.themeColorMeta.content = getComputedStyle(body).backgroundColor;
				if (!this.themeColorMeta.isConnected) document.head.append(this.themeColorMeta);
			}
			/** Retract root color-scheme, the palette attribute, token variables, and the owned metadata node. */
			dispose() {
				document.documentElement.style.removeProperty("color-scheme");
				const body = document.body;
				body.removeAttribute(DARK_ATTRIBUTE);
				for (const name of this.appliedTokens) body.style.removeProperty(name);
				this.appliedTokens = [];
				this.themeColorMeta.remove();
			}
		};
		//#endregion
		//#region \0dsh-global-css:/packages/client/aukora-face-layout/src/client/spatial-tokens.css.mjs
		const css$1 = "body{--dsw-static-spatial-blue:#96b4ff;--dsw-static-spatial-gold:#e0b76a;--dsw-static-spatial-mint:#81d4b4;--dsw-static-spatial-violet:#c4aaff;--aukora-blue:var(--dsw-static-spatial-blue);--aukora-green:var(--dsw-static-spatial-mint);--aukora-purple:var(--dsw-static-spatial-violet);--aukora-gold:var(--dsw-static-spatial-gold);--aukora-red-warning:#f2555a;--aukora-background:#0b0d18;--aukora-surface:#262b36b8;--aukora-border:#ffffff1a;--aukora-text:#e8eaed;--aukora-text-secondary:#b8bcc4;--aukora-text-muted:#8b9099;--aukora-backdrop:#0809108f;--aukora-radius:14px;--dsw-static-spatial-night-800:#111520;--dsw-static-spatial-night-850:#0b0d18;--dsw-static-spatial-night-900:#090a12;--dsw-static-spatial-night-950:#080910;--dsw-specific-spatial-accent-center:#5686fe47;--dsw-specific-spatial-accent-left:#22c55e3d;--dsw-specific-spatial-accent-right:#4176e63d;--dsw-specific-spatial-border:#2631481f;--dsw-specific-spatial-canvas:radial-gradient(1100px 760px at 82% 110%, #c4aaff1f, transparent 60%), radial-gradient(1200px 800px at 18% -10%, #81d4b41a, transparent 60%), linear-gradient(160deg, #f4f7fc 0%, #edf2fa 55%, #f7f4fc 100%);--dsw-specific-spatial-lane:#ffffffad;--dsw-specific-spatial-lane-bright:#ffffffd1;--dsw-specific-spatial-selection:#4176e61f}body[data-ds-dark-theme]{--dsw-specific-spatial-accent-center:#96b4ff66;--dsw-specific-spatial-accent-left:#81d4b466;--dsw-specific-spatial-accent-right:#c4aaff66;--dsw-specific-spatial-border:#ffffff1a;--dsw-specific-spatial-canvas:radial-gradient(1200px 800px at 18% -10%, #81d4b41a, transparent 60%), radial-gradient(1100px 760px at 82% 110%, #c4aaff1f, transparent 60%), radial-gradient(900px 700px at 50% 50%, #96b4ff12, transparent 65%), linear-gradient(160deg, var(--dsw-static-spatial-night-900) 0%, var(--dsw-static-spatial-night-850) 55%, var(--dsw-static-spatial-night-950) 100%);--dsw-specific-spatial-lane:#ffffff0b;--dsw-specific-spatial-lane-bright:radial-gradient(circle at 8% 2%, color-mix(in srgb, var(--dsw-static-spatial-mint) 9%, transparent), transparent 30%), radial-gradient(circle at 96% 0%, color-mix(in srgb, var(--dsw-static-spatial-violet) 10%, transparent), transparent 34%), var(--dsw-alias-bg-layer-1);--dsw-specific-spatial-selection:#c4aaff1f}:root{--dsw-font-family-mono:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", monospace;--dsw-alias-label-error:var(--dsw-alias-state-error-primary,#f2555a);--dsh-documents-inline-padding:12px;--dsh-messages-inline-padding:12px;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);--dsh-session-list-edge-inset:var(--dsh-sidebar-inline-padding);--dsh-session-list-scrollbar-offset:2px;--dsh-session-list-scrollbar-width:8px;--dsh-sidebar-inline-padding:12px}";
		const tagId$1 = "@aukora/face-layout/spatial-tokens.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@aukora/face-layout";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region \0dsh-css:Primitives.module.css.mjs
		const css = ".aefiDq_blue{--aukora-accent:var(--aukora-blue)}.aefiDq_green{--aukora-accent:var(--aukora-green)}.aefiDq_purple{--aukora-accent:var(--aukora-purple)}.aefiDq_gold{--aukora-accent:var(--aukora-gold)}.aefiDq_red-warning{--aukora-accent:var(--aukora-red-warning)}:where(.aefiDq_panel){box-sizing:border-box;border:1px solid var(--aukora-border);border-radius:var(--aukora-radius);background:var(--aukora-surface);min-width:0;color:var(--aukora-text)}:where(.aefiDq_action){box-sizing:border-box;border:1px solid color-mix(in srgb, var(--aukora-accent) 38%, transparent);border-radius:var(--aukora-radius);background:var(--aukora-surface);min-height:32px;color:var(--aukora-accent);font:inherit;cursor:pointer;justify-content:center;align-items:center;gap:8px;padding:6px 12px;font-size:13px;line-height:18px;text-decoration:none;transition:border-color .18s,box-shadow .18s;display:inline-flex}.aefiDq_action[aria-pressed=false]{color:var(--aukora-text-muted);border-color:var(--aukora-border)}.aefiDq_action:hover:not(:disabled),.aefiDq_action[aria-pressed=true],.aefiDq_action[aria-current=page],.aefiDq_portal[data-open=yes]{border-color:color-mix(in srgb, var(--aukora-accent) 70%, transparent);box-shadow:0 0 14px color-mix(in srgb, var(--aukora-accent) 14%, transparent)}.aefiDq_action:focus-visible,.aefiDq_portalButton:focus-visible{outline:2px solid var(--aukora-accent);outline-offset:3px}.aefiDq_action:disabled,.aefiDq_portalButton:disabled{opacity:.5;cursor:default}:where(.aefiDq_portal){border-color:color-mix(in srgb, var(--aukora-accent) 30%, transparent);transition:border-color .18s,box-shadow .18s}:where(.aefiDq_portalButton){box-sizing:border-box;border-radius:inherit;width:100%;min-width:0;min-height:64px;color:inherit;font:inherit;text-align:start;cursor:pointer;background:0 0;border:0;align-items:center;gap:14px;padding:10px 18px;display:flex}.aefiDq_portalButton:hover:not(:disabled){color:var(--aukora-accent)}.aefiDq_portalIcon{color:var(--aukora-accent);flex:none;display:inline-flex}.aefiDq_portalCopy{flex-direction:column;flex:1;gap:2px;min-width:0;display:flex}.aefiDq_portalTitle{min-width:0;font-size:14px;font-weight:570;line-height:20px}.aefiDq_portalSubtitle{color:var(--aukora-text-muted);overflow-wrap:anywhere;font-size:12px;line-height:18px}.aefiDq_portalChevron{color:var(--aukora-accent);flex:none;font-size:18px;line-height:1}:where(.aefiDq_portalContent){min-width:0;padding:2px 14px 16px}.aefiDq_portalContent[hidden]{display:none}:where(.aefiDq_sectionHeader){align-items:center;gap:8px;min-width:0;display:flex}@media (prefers-reduced-motion:reduce){.aefiDq_action,.aefiDq_portal{transition:none}}";
		const tagId = "@aukora/face-layout/Primitives.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@aukora/face-layout";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var Primitives_module_css_default = {
			"action": "aefiDq_action",
			"blue": "aefiDq_blue",
			"gold": "aefiDq_gold",
			"green": "aefiDq_green",
			"panel": "aefiDq_panel",
			"portal": "aefiDq_portal",
			"portalButton": "aefiDq_portalButton",
			"portalChevron": "aefiDq_portalChevron",
			"portalContent": "aefiDq_portalContent",
			"portalCopy": "aefiDq_portalCopy",
			"portalIcon": "aefiDq_portalIcon",
			"portalSubtitle": "aefiDq_portalSubtitle",
			"portalTitle": "aefiDq_portalTitle",
			"purple": "aefiDq_purple",
			"red-warning": "aefiDq_red-warning",
			"sectionHeader": "aefiDq_sectionHeader"
		};
		//#endregion
		//#region src/client/primitives.tsx
		const classes = (...values) => values.filter(Boolean).join(" ");
		/** Native action or navigation, sharing the same outline and keyboard focus treatment. */
		const ActionButton = (0, react.forwardRef)(function ActionButton({ variant = "blue", className, ...props }, ref) {
			const style = classes(Primitives_module_css_default.action, Primitives_module_css_default[variant], className);
			if (typeof props.href === "string") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
				...props,
				ref,
				className: style,
				"data-aukora-action": true
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				...props,
				ref,
				className: style,
				"data-aukora-action": true
			});
		});
		/** One dark-glass surface; consumers supply their own content and geometry. */
		const Panel = (0, react.forwardRef)(function Panel({ className, ...props }, ref) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				...props,
				ref,
				className: classes(Primitives_module_css_default.panel, className)
			});
		});
		const Card = Panel;
		/** Keeps the caller's heading level, copy and controls intact. */
		const SectionHeader = (0, react.forwardRef)(function SectionHeader({ className, ...props }, ref) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("header", {
				...props,
				ref,
				className: classes(Primitives_module_css_default.sectionHeader, className)
			});
		});
		/** A native disclosure: content opens directly below its button, never in an overlay. */
		const PortalButton = (0, react.forwardRef)(function PortalButton({ title, subtitle, icon, trailing, children, variant = "blue", expanded, defaultExpanded = false, onExpandedChange, onClick, className, buttonClassName, contentClassName, containerProps, contentProps, showIndicator = true, ...props }, ref) {
			const [localExpanded, setLocalExpanded] = (0, react.useState)(defaultExpanded);
			const open = expanded ?? localExpanded;
			const contentId = (0, react.useId)();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Card, {
				...containerProps,
				className: classes(Primitives_module_css_default.portal, Primitives_module_css_default[variant], className, containerProps?.className),
				"data-open": open ? "yes" : "no",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					...props,
					type: props.type ?? "button",
					ref,
					className: classes(Primitives_module_css_default.portalButton, buttonClassName),
					"aria-expanded": open,
					"aria-controls": contentId,
					onClick: (event) => {
						onClick?.(event);
						if (event.defaultPrevented) return;
						if (expanded === void 0) setLocalExpanded(!open);
						onExpandedChange?.(!open);
					},
					children: [
						icon != null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: Primitives_module_css_default.portalIcon,
							children: icon
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: Primitives_module_css_default.portalCopy,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: Primitives_module_css_default.portalTitle,
								children: title
							}), subtitle != null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: Primitives_module_css_default.portalSubtitle,
								children: subtitle
							})]
						}),
						trailing,
						showIndicator && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: Primitives_module_css_default.portalChevron,
							"aria-hidden": "true",
							children: open ? "−" : "+"
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					...contentProps,
					id: contentId,
					hidden: !open,
					className: classes(Primitives_module_css_default.portalContent, contentClassName, contentProps?.className),
					children: open ? children : null
				})]
			});
		});
		//#endregion
		//#region src/client/index.ts
		/** The one panel this shell has: never a keyed global panel, always the Conversation. */
		const CONVERSATION_PANEL = Object.freeze({ activePanelId: null });
		/** Required services for slot composition, localized chrome, and theme projection. */
		const inject = [
			"slots",
			"theme",
			"locale",
			"sessions"
		];
		/**
		* Register the spatial root shell and document theme presenter.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			installComposerControls(ctx);
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "ui-layout: dictionaries");
			const layout = new LayoutController();
			const panelInfo = {
				getSnapshot: () => CONVERSATION_PANEL,
				subscribe: () => () => {}
			};
			ctx.effect(() => {
				const disposePanelInfo = ctx.slots.provideRoot({ hooks: { panelInfo } });
				const disposeService = ctx.reflect.provide("layout", layout);
				const disposeRegistration = ctx.slots.register({
					name: "root",
					locale: NS,
					children: {
						"sidebar": {
							kind: "single",
							scope: "root"
						},
						"main": {
							kind: "keyed",
							scope: "root"
						},
						"rightbar": {
							kind: "single",
							scope: "root"
						},
						"shell.surface": {
							kind: "list",
							scope: "root"
						},
						"shell.menu.apps": {
							kind: "list",
							scope: "root"
						},
						"shell.menu.system": {
							kind: "list",
							scope: "root"
						},
						"shell.menu.yours": {
							kind: "list",
							scope: "root"
						},
						"shell.overlay": {
							kind: "list",
							scope: "root"
						}
					},
					store: createLayoutStore,
					inject: (actions) => {
						layout.attachPanels(actions);
						return { openThread: (sessionId) => {
							ctx.sessions.open(sessionId);
						} };
					}
				}, AppFrame);
				return () => {
					layout.dispose();
					disposeRegistration();
					disposePanelInfo();
					disposeService();
				};
			}, "ui-layout: service + root registration");
			ctx.effect(() => {
				const presenter = new ThemePresenter();
				presenter.apply(ctx.theme.getTheme());
				const off = ctx.on("theme/change", (snapshot) => {
					presenter.apply(snapshot);
				});
				return () => {
					off();
					presenter.dispose();
				};
			}, "ui-layout: theme presenter");
		}
		//#endregion
		exports.ActionButton = ActionButton;
		exports.Card = Card;
		exports.LayoutController = LayoutController;
		exports.Panel = Panel;
		exports.PortalButton = PortalButton;
		exports.SectionHeader = SectionHeader;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map