window.__ModuleLoader__.load({
	id: "@aukora/face-aumlok",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let _deepseek_ai_cordis = require("@deepseek-ai/cordis");
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
		//#region \0dsh-css:Aumlok.module.css.mjs
		const css = ".bUB28G_surface{--aumlok-root:var(--dsw-static-spatial-mint);--aumlok-unite:var(--dsw-static-spatial-blue);--aumlok-rise:var(--dsw-static-spatial-violet);--aumlok-anchor:var(--dsw-static-spatial-gold);box-sizing:border-box;width:100%;min-width:0;height:100%;min-height:0;color:var(--dsw-alias-label-primary);background:radial-gradient(circle at 8% 2%, color-mix(in srgb, var(--aumlok-root) 9%, transparent), transparent 30%), radial-gradient(circle at 96% 0%, color-mix(in srgb, var(--aumlok-rise) 10%, transparent), transparent 34%), var(--dsw-alias-bg-layer-1);padding:clamp(20px,3.2%,48px);overflow:auto;container:bUB28G_aumlok/inline-size}.bUB28G_surface[hidden]{display:none}.bUB28G_canvas{box-sizing:border-box;width:min(100%,1160px);min-height:100%;margin:0 auto}.bUB28G_identityCard{flex-direction:column;align-items:center;gap:clamp(24px,4cqi,40px);width:min(100%,680px);margin:0 auto;padding:clamp(12px,3cqi,32px) 0;display:flex}.bUB28G_identityHeader{justify-content:space-between;align-items:center;gap:16px;width:100%;display:flex}.bUB28G_identityHeader h2{overflow-wrap:anywhere;letter-spacing:-.03em;min-width:0;margin:0;font-size:clamp(32px,5cqi,48px);font-weight:620}.bUB28G_identityQr{aspect-ratio:1;box-sizing:border-box;width:min(100%,360px);box-shadow:0 0 0 1px color-mix(in srgb, var(--aumlok-anchor) 40%, transparent);background:#fff;border-radius:20px;place-items:center;padding:20px;display:grid}.bUB28G_identityQr img{object-fit:contain;width:100%;height:100%;image-rendering:pixelated;display:block}.bUB28G_identityQrPending{border:2px solid #ddd;border-top-color:#888;border-radius:50%;width:24px;height:24px}.bUB28G_identityValues{gap:12px;width:100%;display:grid}.bUB28G_identityValue{border:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 75%, transparent);border-radius:16px;align-items:center;gap:12px;min-width:0;padding:12px 14px 12px 20px;display:flex}.bUB28G_identityValue code{overflow-wrap:anywhere;min-width:0;font-family:var(--dsw-font-family-mono,ui-monospace, monospace);color:var(--dsw-alias-label-secondary);flex:1;font-size:12px;line-height:1.8}.bUB28G_identityActions{gap:16px;display:flex}.bUB28G_identityAction{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);width:44px;height:44px;color:var(--aumlok-anchor);cursor:pointer;border-radius:14px;flex:none;place-items:center;display:inline-grid}.bUB28G_identityAction svg{width:20px;height:20px}.bUB28G_identityAction:hover:not(:disabled),.bUB28G_identityAction:focus-visible{border-color:var(--aumlok-anchor);outline:2px solid color-mix(in srgb, var(--aumlok-anchor) 30%, transparent);outline-offset:2px}.bUB28G_identityAction:disabled{opacity:.4;cursor:default}.bUB28G_identityAction[data-result=check]{color:var(--aumlok-root)}.bUB28G_identityAction[data-result=error]{color:#cf695f}.bUB28G_hero{border-bottom:1px solid var(--dsw-alias-border-l1);justify-content:space-between;align-items:flex-start;gap:24px;padding-bottom:clamp(24px,4cqi,42px);display:flex}.bUB28G_heroCopy{min-width:0}.bUB28G_hero p,.bUB28G_hero h2,.bUB28G_hero span,.bUB28G_phraseStage h3,.bUB28G_flow h3,.bUB28G_explanation{margin:0}.bUB28G_hero p,.bUB28G_phraseStage h3,.bUB28G_flow h3,.bUB28G_statusBadge,.bUB28G_bandHeader,.bUB28G_anchorMeta,.bUB28G_position{font-family:var(--dsw-font-family-mono,ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)}.bUB28G_hero p{color:var(--aumlok-unite);letter-spacing:.16em;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:720;line-height:16px;overflow:hidden}.bUB28G_hero h2{letter-spacing:.07em;text-overflow:ellipsis;white-space:nowrap;margin-top:8px;font-size:clamp(30px,5cqi,46px);font-weight:640;line-height:1;overflow:hidden}.bUB28G_statusBadge{border:1px solid color-mix(in srgb, var(--aumlok-anchor) 48%, transparent);color:var(--aumlok-anchor);background:color-mix(in srgb, var(--aumlok-anchor) 8%, transparent);letter-spacing:.14em;white-space:nowrap;border-radius:999px;flex:none;padding:7px 12px;font-size:10px;font-weight:720;line-height:14px}.bUB28G_composition{gap:clamp(20px,3.4cqi,40px);padding:clamp(18px,3cqi,34px) 0;display:grid}.bUB28G_phraseStage,.bUB28G_flow{min-width:0}.bUB28G_phraseStage h3,.bUB28G_flow h3{color:var(--dsw-alias-label-tertiary);letter-spacing:.16em;font-size:11px;font-weight:720;line-height:16px}.bUB28G_anchorToken{--band-color:var(--aumlok-anchor);box-sizing:border-box;border:1px solid color-mix(in srgb, var(--aumlok-anchor) 58%, transparent);background:linear-gradient(135deg, color-mix(in srgb, var(--aumlok-anchor) 15%, transparent), color-mix(in srgb, var(--dsw-alias-bg-layer-2) 76%, transparent));min-height:88px;box-shadow:inset 0 0 28px color-mix(in srgb, var(--aumlok-anchor) 5%, transparent);border-radius:17px;flex-direction:column;align-items:flex-start;gap:12px;margin-top:14px;padding:18px 20px;display:flex}.bUB28G_anchorBoxes{justify-content:flex-start;align-items:center;gap:8px;min-width:0;display:flex}.bUB28G_anchorBox{box-sizing:border-box;border:1px solid color-mix(in srgb, var(--aumlok-anchor) 62%, transparent);width:40px;height:46px;color:var(--aumlok-anchor);background:color-mix(in srgb, var(--aumlok-anchor) 13%, transparent);box-shadow:inset 0 0 14px color-mix(in srgb, var(--aumlok-anchor) 10%, transparent);font-family:var(--dsw-font-family-mono,ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);border-radius:11px;flex:none;place-items:center;font-size:22px;line-height:1;animation-name:bUB28G_aumlok-letter-settle;animation-duration:.42s;animation-timing-function:ease-out;animation-fill-mode:both;display:grid}.bUB28G_anchorBoxes .bUB28G_anchorBox:nth-child(2){animation-delay:60ms}.bUB28G_anchorBoxes .bUB28G_anchorBox:nth-child(3){animation-delay:.12s}.bUB28G_anchorBoxes .bUB28G_anchorBox:nth-child(4){animation-delay:.18s}.bUB28G_anchorBoxes .bUB28G_anchorBox:nth-child(5){animation-delay:.24s}.bUB28G_anchorBoxes .bUB28G_anchorBox:nth-child(6){animation-delay:.3s}.bUB28G_anchorDot{width:9px;height:9px;box-shadow:0 0 12px color-mix(in srgb, currentcolor 46%, transparent);background:currentColor;border-radius:50%;display:block}.bUB28G_handleField{flex-direction:column;gap:6px;margin:0 0 14px;display:flex}.bUB28G_handleLabel{color:var(--dsw-alias-label-primary);letter-spacing:.06em;text-transform:uppercase;font-size:13px;font-weight:600}.bUB28G_handleInput{box-sizing:border-box;border:1px solid color-mix(in srgb, var(--aumlok-anchor) 62%, transparent);width:100%;min-width:0;height:44px;color:var(--dsw-alias-label-primary);background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 82%, transparent);font-family:var(--dsw-font-family-mono,ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);letter-spacing:.08em;border-radius:11px;padding:0 14px;font-size:16px}.bUB28G_handleInput:focus{border-color:color-mix(in srgb, var(--aumlok-anchor) 82%, transparent);outline:2px solid color-mix(in srgb, var(--aumlok-anchor) 34%, transparent);outline-offset:1px}.bUB28G_handleInput:disabled{opacity:.6}.bUB28G_handleLocked{box-sizing:border-box;border:1px dashed color-mix(in srgb, var(--aumlok-anchor) 42%, transparent);width:100%;min-width:0;height:44px;color:var(--dsw-alias-label-primary);background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 62%, transparent);font-family:var(--dsw-font-family-mono,ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);letter-spacing:.08em;cursor:default;border-radius:11px;padding:0 14px;font-size:16px}.bUB28G_handleLocked:focus{outline:none}.bUB28G_handleHint{color:var(--dsw-alias-label-secondary,var(--dsw-alias-label-primary));margin:0;font-size:12px;line-height:1.4}.bUB28G_anchorInput{box-sizing:border-box;border:1px solid color-mix(in srgb, var(--aumlok-anchor) 62%, transparent);width:100%;min-width:0;height:46px;color:var(--dsw-alias-label-primary);background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 82%, transparent);font-family:var(--dsw-font-family-mono,ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);letter-spacing:.12em;border-radius:11px;padding:0 14px;font-size:16px}.bUB28G_anchorInput:focus{border-color:color-mix(in srgb, var(--aumlok-anchor) 82%, transparent);outline:2px solid color-mix(in srgb, var(--aumlok-anchor) 34%, transparent);outline-offset:1px}.bUB28G_anchorMeta{flex-direction:column;gap:4px;min-width:0;display:flex}.bUB28G_anchorMeta strong{color:var(--aumlok-anchor);letter-spacing:.11em;font-size:12px;line-height:17px}.bUB28G_anchorMeta span{color:var(--dsw-alias-label-tertiary);letter-spacing:.04em;font-size:10px;line-height:15px}.bUB28G_wordMask{align-items:center;gap:7px;display:flex}.bUB28G_wordMask i{box-shadow:0 0 12px color-mix(in srgb, currentcolor 46%, transparent);background:currentColor;border-radius:50%;flex:none;display:block}.bUB28G_anchorToken .bUB28G_wordMask i{width:9px;height:9px}.bUB28G_bands{flex-direction:column;gap:13px;margin-top:18px;display:flex}.bUB28G_phraseBand{--band-color:var(--aumlok-unite);border:1px solid color-mix(in srgb, var(--band-color) 34%, transparent);border-left:3px solid color-mix(in srgb, var(--band-color) 76%, transparent);background:linear-gradient(100deg, color-mix(in srgb, var(--band-color) 10%, transparent), color-mix(in srgb, var(--dsw-alias-bg-layer-2) 55%, transparent));border-radius:15px;gap:12px;padding:15px;display:grid}.bUB28G_phraseBand[data-aumlok-tone=green]{--band-color:var(--aumlok-root)}.bUB28G_phraseBand[data-aumlok-tone=blue]{--band-color:var(--aumlok-unite)}.bUB28G_phraseBand[data-aumlok-tone=purple]{--band-color:var(--aumlok-rise)}.bUB28G_bandHeader{justify-content:space-between;align-items:baseline;gap:14px;display:flex}.bUB28G_bandHeader strong{color:var(--band-color);letter-spacing:.12em;font-size:12px;line-height:17px}.bUB28G_bandHeader span{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:10px;line-height:15px;overflow:hidden}.bUB28G_bandRows{grid-template-columns:minmax(0,1fr);gap:9px;display:grid}.bUB28G_phraseRow{box-sizing:border-box;border:1px solid color-mix(in srgb, var(--band-color) 22%, transparent);background:color-mix(in srgb, var(--dsw-alias-bg-layer-1) 70%, transparent);border-radius:11px;align-items:center;gap:9px;min-width:0;height:44px;padding:0 12px 0 8px;animation-name:bUB28G_aumlok-row-settle;animation-duration:.38s;animation-timing-function:ease-out;animation-fill-mode:both;display:flex}.bUB28G_bandRows .bUB28G_phraseRow:nth-child(2){animation-delay:.12s}.bUB28G_phraseBand:nth-child(2) .bUB28G_bandRows .bUB28G_phraseRow:first-child{animation-delay:.24s}.bUB28G_phraseBand:nth-child(2) .bUB28G_bandRows .bUB28G_phraseRow:nth-child(2){animation-delay:.36s}.bUB28G_phraseBand:nth-child(3) .bUB28G_bandRows .bUB28G_phraseRow:first-child{animation-delay:.48s}.bUB28G_phraseBand:nth-child(3) .bUB28G_bandRows .bUB28G_phraseRow:nth-child(2){animation-delay:.6s}.bUB28G_position{width:12px;color:var(--dsw-alias-label-dimmed);text-align:right;font-size:9px;line-height:12px}.bUB28G_initialBox{box-sizing:border-box;border:1px solid color-mix(in srgb, var(--aumlok-anchor) 52%, transparent);width:26px;height:26px;color:var(--aumlok-anchor);background:color-mix(in srgb, var(--aumlok-anchor) 10%, transparent);font-family:var(--dsw-font-family-mono,ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);border-radius:8px;flex:none;place-items:center;font-size:13px;line-height:1;display:grid}.bUB28G_wordMask{min-width:0;color:var(--band-color);flex:1}.bUB28G_wordMask i{opacity:.64;width:6px;height:6px}.bUB28G_tileEmpty{box-sizing:border-box;border:1px dashed color-mix(in srgb, var(--band-color) 30%, transparent);min-width:0;height:30px;color:var(--dsw-alias-label-dimmed);border-radius:8px;flex:1;place-items:center;font-size:12px;line-height:1;display:grid}.bUB28G_tileWord{min-width:0;color:var(--band-color);font-family:var(--dsw-font-family-mono,ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);letter-spacing:.06em;text-overflow:ellipsis;white-space:nowrap;flex:1;font-size:15px;line-height:20px;overflow:hidden}.bUB28G_tileInput{box-sizing:border-box;border:1px solid color-mix(in srgb, var(--band-color) 52%, transparent);min-width:0;height:32px;color:var(--dsw-alias-label-primary);background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 82%, transparent);font-family:var(--dsw-font-family-mono,ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);letter-spacing:.05em;border-radius:8px;flex:1;padding:0 10px;font-size:13px}.bUB28G_tileInput:focus{border-color:color-mix(in srgb, var(--band-color) 78%, transparent);outline:2px solid color-mix(in srgb, var(--band-color) 34%, transparent);outline-offset:1px}.bUB28G_runtimePosture{flex-direction:column;gap:15px;margin-top:14px;display:flex}.bUB28G_runtimePosture>div{flex-direction:column;gap:5px;display:flex}.bUB28G_runtimePosture strong{color:var(--aumlok-anchor);font-size:15px;font-weight:610;line-height:21px}.bUB28G_runtimePosture span{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}.bUB28G_missingBinding{color:var(--dsw-alias-label-secondary);margin:0;font-size:13px;line-height:20px}.bUB28G_controlProjection{gap:10px;margin:2px 0 0;display:grid}.bUB28G_controlProjection>div{border:1px solid color-mix(in srgb, var(--aumlok-anchor) 18%, transparent);background:color-mix(in srgb, var(--aumlok-anchor) 4%, transparent);border-radius:10px;grid-template-columns:minmax(112px,.34fr) minmax(0,1fr);align-items:baseline;gap:12px;min-width:0;padding:9px 11px;display:grid}.bUB28G_controlProjection dt{color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-family-mono,ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);letter-spacing:.08em;font-size:9px;font-weight:700;line-height:14px}.bUB28G_controlProjection dd{min-width:0;margin:0}.bUB28G_controlProjection code{overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary);font-size:10px;line-height:15px;display:block}.bUB28G_flow h3{margin-bottom:14px}.bUB28G_ceremonyAction{box-sizing:border-box;border:1px solid color-mix(in srgb, var(--aumlok-anchor) 38%, transparent);background:linear-gradient(125deg, color-mix(in srgb, var(--aumlok-anchor) 11%, transparent), color-mix(in srgb, var(--dsw-alias-bg-layer-2) 58%, transparent));border-radius:15px;flex-direction:column;gap:12px;margin-top:16px;padding:16px 17px;display:flex}.bUB28G_ceremonyAction button{box-sizing:border-box;border:1px solid color-mix(in srgb, var(--aumlok-anchor) 62%, transparent);width:100%;min-height:46px;color:var(--aumlok-anchor);background:color-mix(in srgb, var(--aumlok-anchor) 12%, transparent);cursor:pointer;font:inherit;border-radius:999px;padding:11px 18px;font-size:13px;font-weight:610;line-height:20px}.bUB28G_ceremonyAction button:hover:enabled{background:color-mix(in srgb, var(--aumlok-anchor) 19%, transparent)}.bUB28G_ceremonyAction button:disabled{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-dimmed);background:var(--dsw-alias-bg-layer-2);cursor:not-allowed}.bUB28G_redraw{border-bottom:1px solid color-mix(in srgb, var(--aumlok-anchor) 34%, transparent);color:var(--dsw-alias-label-secondary);cursor:pointer;letter-spacing:.02em;align-self:flex-start;padding:2px 0;font-size:12px;line-height:18px;transition:color .12s,border-color .12s}.bUB28G_redraw:hover{border-color:color-mix(in srgb, var(--aumlok-anchor) 62%, transparent);color:var(--aumlok-anchor)}.bUB28G_ceremonyRefusal{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px;line-height:19px}.bUB28G_ceremonyRefusal code{overflow-wrap:anywhere;color:var(--dsw-alias-label-error);font-family:var(--dsw-font-family-mono,ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);font-size:11px;line-height:17px}.bUB28G_details{border-top:1px solid var(--dsw-alias-border-l1);margin-top:18px;padding-top:12px}.bUB28G_detailsSummary{color:var(--dsw-alias-label-tertiary);cursor:pointer;font-family:var(--dsw-font-family-mono,ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);letter-spacing:.14em;font-size:10px;line-height:15px;list-style:none}.bUB28G_detailsSummary::-webkit-details-marker{display:none}.bUB28G_boundReceipt{box-sizing:border-box;border:1px solid color-mix(in srgb, var(--aumlok-anchor) 44%, transparent);background:color-mix(in srgb, var(--aumlok-anchor) 7%, transparent);border-radius:14px;margin-top:18px;padding:14px 16px}.bUB28G_boundQuiet{color:var(--dsw-alias-label-tertiary);letter-spacing:.14em;text-transform:uppercase;margin:0;font-size:11px;line-height:16px}.bUB28G_boundLine{color:var(--aumlok-anchor);margin:0;font-size:15px;font-weight:610;line-height:22px}.bUB28G_receipt{gap:8px;margin:10px 0 0;display:grid}.bUB28G_receipt>div{grid-template-columns:minmax(96px,.28fr) minmax(0,1fr);align-items:baseline;gap:12px;min-width:0;display:grid}.bUB28G_receipt dt{color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-family-mono,ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);letter-spacing:.08em;font-size:9px;font-weight:700;line-height:14px}.bUB28G_receipt dd{min-width:0;margin:0}.bUB28G_receipt code{overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px}.bUB28G_confirm{box-sizing:border-box;border:1px solid color-mix(in srgb, var(--aumlok-anchor) 52%, transparent);background:color-mix(in srgb, var(--aumlok-anchor) 8%, transparent);border-radius:12px;flex-direction:column;gap:10px;padding:12px 13px;display:flex}.bUB28G_confirmWarning{color:var(--dsw-alias-label-primary);margin:0;font-size:13px;font-weight:560;line-height:20px}.bUB28G_confirmRow{color:var(--dsw-alias-label-secondary);cursor:pointer;align-items:center;gap:9px;font-size:12px;line-height:18px;display:flex}.bUB28G_confirmRow input{width:16px;height:16px;accent-color:var(--aumlok-anchor);flex:none}.bUB28G_explanation{color:var(--dsw-alias-label-secondary);flex-direction:column;gap:8px;margin-top:13px;padding:0;font-size:13px;line-height:20px;list-style:none;display:flex}.bUB28G_explanation li{padding-left:15px;position:relative}.bUB28G_explanation li:before{content:\"\";background:color-mix(in srgb, var(--aumlok-anchor) 72%, transparent);border-radius:50%;width:5px;height:5px;position:absolute;top:8px;left:0}.bUB28G_warning{box-sizing:border-box;border:1px solid color-mix(in srgb, var(--aumlok-anchor) 42%, transparent);color:var(--dsw-alias-label-secondary);background:color-mix(in srgb, var(--aumlok-anchor) 7%, transparent);border-radius:11px;margin:0;padding:10px 12px;font-size:12px;line-height:19px}.bUB28G_menuItem{box-sizing:border-box;width:100%;min-height:44px;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:right;background:0 0;border:1px solid #0000;border-radius:12px;align-items:center;padding:10px 12px;font-family:inherit;display:flex}.bUB28G_menuItem:hover{background:var(--dsw-alias-interactive-bg-hover)}.bUB28G_menuItemActive{border-color:var(--dsw-alias-border-l1);background:var(--dsw-specific-sidebar-nav-item-active)}.bUB28G_menuCopy{flex-direction:column;flex:1;align-items:flex-end;min-width:0;display:flex}.bUB28G_menuCopy strong{width:100%;font-size:var(--dsh-spatial-menu-title-size,14px);line-height:var(--dsh-spatial-menu-title-line-height,20px);text-overflow:ellipsis;text-align:right;white-space:nowrap;font-weight:570;overflow:hidden}.bUB28G_menuCopy span{width:100%;color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-spatial-menu-description-size,12px);line-height:var(--dsh-spatial-menu-description-line-height,18px);text-overflow:ellipsis;text-align:right;white-space:nowrap;overflow:hidden}.bUB28G_visuallyHidden{clip:rect(0 0 0 0);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}@container bUB28G_aumlok (width>=760px){.bUB28G_composition{grid-template-columns:minmax(360px,1.08fr) minmax(300px,.92fr);align-items:start}.bUB28G_flow{position:sticky;top:0}}@container bUB28G_aumlok (width<=520px){.bUB28G_surface{padding:18px}.bUB28G_hero{gap:14px}.bUB28G_hero h2{font-size:30px}}[data-aumlok-reveal=words]{display:contents}@keyframes bUB28G_aumlok-letter-settle{0%{opacity:0}to{opacity:1}}@keyframes bUB28G_aumlok-row-settle{0%{opacity:0}to{opacity:1}}@media (prefers-reduced-motion:reduce){.bUB28G_anchorBox,.bUB28G_anchorBoxes .bUB28G_anchorBox:nth-child(2),.bUB28G_anchorBoxes .bUB28G_anchorBox:nth-child(3),.bUB28G_anchorBoxes .bUB28G_anchorBox:nth-child(4),.bUB28G_anchorBoxes .bUB28G_anchorBox:nth-child(5),.bUB28G_anchorBoxes .bUB28G_anchorBox:nth-child(6),.bUB28G_phraseRow,.bUB28G_bandRows .bUB28G_phraseRow:nth-child(2),.bUB28G_phraseBand:nth-child(2) .bUB28G_bandRows .bUB28G_phraseRow:first-child,.bUB28G_phraseBand:nth-child(2) .bUB28G_bandRows .bUB28G_phraseRow:nth-child(2),.bUB28G_phraseBand:nth-child(3) .bUB28G_bandRows .bUB28G_phraseRow:first-child,.bUB28G_phraseBand:nth-child(3) .bUB28G_bandRows .bUB28G_phraseRow:nth-child(2){animation:none}}";
		const tagId = "@aukora/face-aumlok/Aumlok.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@aukora/face-aumlok";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var Aumlok_module_css_default = {
			"anchorBox": "bUB28G_anchorBox",
			"anchorBoxes": "bUB28G_anchorBoxes",
			"anchorDot": "bUB28G_anchorDot",
			"anchorInput": "bUB28G_anchorInput",
			"anchorMeta": "bUB28G_anchorMeta",
			"anchorToken": "bUB28G_anchorToken",
			"aumlok": "bUB28G_aumlok",
			"aumlok-letter-settle": "bUB28G_aumlok-letter-settle",
			"aumlok-row-settle": "bUB28G_aumlok-row-settle",
			"bandHeader": "bUB28G_bandHeader",
			"bandRows": "bUB28G_bandRows",
			"bands": "bUB28G_bands",
			"boundLine": "bUB28G_boundLine",
			"boundQuiet": "bUB28G_boundQuiet",
			"boundReceipt": "bUB28G_boundReceipt",
			"canvas": "bUB28G_canvas",
			"ceremonyAction": "bUB28G_ceremonyAction",
			"ceremonyRefusal": "bUB28G_ceremonyRefusal",
			"composition": "bUB28G_composition",
			"confirm": "bUB28G_confirm",
			"confirmRow": "bUB28G_confirmRow",
			"confirmWarning": "bUB28G_confirmWarning",
			"controlProjection": "bUB28G_controlProjection",
			"details": "bUB28G_details",
			"detailsSummary": "bUB28G_detailsSummary",
			"explanation": "bUB28G_explanation",
			"flow": "bUB28G_flow",
			"handleField": "bUB28G_handleField",
			"handleHint": "bUB28G_handleHint",
			"handleInput": "bUB28G_handleInput",
			"handleLabel": "bUB28G_handleLabel",
			"handleLocked": "bUB28G_handleLocked",
			"hero": "bUB28G_hero",
			"heroCopy": "bUB28G_heroCopy",
			"identityAction": "bUB28G_identityAction",
			"identityActions": "bUB28G_identityActions",
			"identityCard": "bUB28G_identityCard",
			"identityHeader": "bUB28G_identityHeader",
			"identityQr": "bUB28G_identityQr",
			"identityQrPending": "bUB28G_identityQrPending",
			"identityValue": "bUB28G_identityValue",
			"identityValues": "bUB28G_identityValues",
			"initialBox": "bUB28G_initialBox",
			"menuCopy": "bUB28G_menuCopy",
			"menuItem": "bUB28G_menuItem",
			"menuItemActive": "bUB28G_menuItemActive",
			"missingBinding": "bUB28G_missingBinding",
			"phraseBand": "bUB28G_phraseBand",
			"phraseRow": "bUB28G_phraseRow",
			"phraseStage": "bUB28G_phraseStage",
			"position": "bUB28G_position",
			"receipt": "bUB28G_receipt",
			"redraw": "bUB28G_redraw",
			"runtimePosture": "bUB28G_runtimePosture",
			"statusBadge": "bUB28G_statusBadge",
			"surface": "bUB28G_surface",
			"tileEmpty": "bUB28G_tileEmpty",
			"tileInput": "bUB28G_tileInput",
			"tileWord": "bUB28G_tileWord",
			"visuallyHidden": "bUB28G_visuallyHidden",
			"warning": "bUB28G_warning",
			"wordMask": "bUB28G_wordMask"
		};
		//#endregion
		//#region src/client/AumlokMenu.tsx
		/** Text-only AUMLOK entry in the shell's right-side System menu. */
		/**
		* Open the standalone AUMLOK preview.
		* @param props - System-menu owner share and localized copy.
		* @returns the AUMLOK launcher button.
		*/
		function AumlokMenu({ activeSurface, openSurface, t }) {
			const active = activeSurface === "aumlok";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				"data-aumlok-launcher": true,
				className: clsx(Aumlok_module_css_default.menuItem, active && Aumlok_module_css_default.menuItemActive),
				"aria-current": active ? "page" : void 0,
				onClick: () => {
					openSurface("aumlok");
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: Aumlok_module_css_default.menuCopy,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("menu.title") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("menu.description") })]
				})
			});
		}
		/** The gold anchor card on top, and the six tiles under it in the three bands. */
		const AUMLOK_BANDS = [
			{
				id: "root",
				positions: [1, 2],
				tone: "green",
				label: "band.root",
				detail: "band.root.detail"
			},
			{
				id: "unite",
				positions: [3, 4],
				tone: "blue",
				label: "band.unite",
				detail: "band.unite.detail"
			},
			{
				id: "rise",
				positions: [5, 6],
				tone: "purple",
				label: "band.rise",
				detail: "band.rise.detail"
			}
		];
		/**
		* Which of the three states the screen is in.
		*
		* A REFRESH BEFORE A BINDING HAS NOTHING TO REPLACE, and §3 offers "New phrase" on the BOUND state
		* only, so an unbound machine is unbound whatever else is asked of it: reporting it as refreshing
		* would draw a second phrase over a machine that has no first one.
		* @param inputs - bound, and whether a refresh has been asked for.
		* @returns the state whose layout and controls the screen renders.
		*/
		function aumlokSurfaceState(inputs) {
			if (!inputs.bound) return "unbound";
			return inputs.refreshing ? "refresh" : "bound";
		}
		/**
		* The badge's word.
		*
		* TWO WORDS FOR THREE STATES, and that is the plan's: a refresh is an act ON the bound state, the old
		* binding stands until the new words are typed back, and §3 gives the badge no third word.
		* @param state - the state the screen renders.
		* @returns the badge's dictionary key.
		*/
		function aumlokBadgeWord(state) {
			return state === "unbound" ? "unbound" : "bound";
		}
		/**
		* The SIX boxes inside the gold anchor card, one per letter of the anchor.
		*
		* WHY SIX AND ALWAYS SIX. Peter drew the anchor as six gold rounded letter boxes in a row, and the
		* anchor IS a six-letter word; a card that drew as many boxes as a word happened to have would draw a
		* different card at every beat and for every defect in the lists. So a word that is not six letters
		* draws six boxes with the gap left EMPTY — never padded with a letter the anchor does not have, and
		* never re-flowed into a different shape.
		*
		* NO LETTER EVER SURVIVES INTO THE BOUND FACE. The six themed words' initials spell the anchor, so a
		* bound card that still showed them would hand the anchor to whoever is looking at the screen. The
		* dots face therefore returns six dots and reads nothing.
		* @param face - what the tiles show at this beat.
		* @param word - the drawn anchor, while it is on the screen.
		* @returns exactly {@link AUMLOK_ANCHOR_LETTERS} boxes.
		*/
		function aumlokAnchorBoxes(face, word) {
			return Array.from({ length: 6 }, (_, index) => {
				if (face === "dots") return { kind: "dot" };
				if (face !== "word") return { kind: "empty" };
				const letter = word?.[index];
				return letter === void 0 || letter.length === 0 ? { kind: "empty" } : {
					kind: "letter",
					letter
				};
			});
		}
		/**
		* The first letter for the small gold box beside one themed word in its row.
		*
		* ONLY WHILE THE WORD IS ON THE SCREEN, for the reason the anchor boxes give: these six letters spell
		* the anchor, and a bound row that kept them would publish the phrase one letter at a time. At every
		* other beat this is the empty string, which is a box with nothing in it rather than a letter that is
		* not there.
		* @param face - what the tiles show at this beat.
		* @param word - the drawn word, while it is on the screen.
		* @returns the letter, or '' when there is none to show.
		*/
		function aumlokWordInitial(face, word) {
			if (face !== "word" || word === void 0 || word.length === 0) return "";
			return word.slice(0, 1);
		}
		/**
		* Whether the confirmation step is being asked, and whether its button is live.
		*
		* BIND IS DEAD UNTIL THE BOX IS TICKED, and dead at every beat except `confirm`. The gate is a
		* decision rather than a JSX condition so a court can hold it: `ask` is the step being on the screen,
		* and `bindEnabled` is the ONE big button being able to write an identity that the person has just
		* said out loud that they will never see again.
		* @param input - the beat, whether the box is ticked, and whether a ceremony is already running.
		* @returns the two answers the screen renders.
		*/
		function aumlokConfirmGate(input) {
			const ask = input.beat === "confirm";
			return {
				ask,
				bindEnabled: ask && input.acknowledged && !input.busy
			};
		}
		Object.freeze({
			min: 3,
			max: 24
		});
		const AUMLOK_HANDLE_PATTERN = /^[a-z0-9._-]{3,24}$/u;
		/**
		* THE HANDLE GATE: whether the field is asked for, whether what is in it can be a handle, and whether
		* the seven words may be drawn yet.
		*
		* ON A NEW MACHINE THE HANDLE COMES FIRST, THEN THE SEVEN WORDS — Peter's own order, and the reason it
		* is an order rather than a preference: the handle salts the key, so a phrase drawn before the handle
		* is a ceremony with half of its key missing. `canDraw` is that rule as a decision a court can hold,
		* and `AumlokSurface.tsx` consults it before it asks the shell to draw anything.
		*
		* ON A MACHINE THAT IS ALREADY BOUND the field is not asked for again: the record publishes the handle,
		* the shell reads it from there for a refresh, and asking a person to retype a public name would be
		* asking them to remember something that is not a secret.
		*
		* THE NORMALISATION IS THE CONTRACT'S: NFKC first, then lower case, applied before the pattern is
		* tested, so the field accepts `Anchor.Keeper` and a full-width `ＡＮＣＨＯＲ` — which the ceremony
		* accepts — and refuses what the ceremony would refuse. Nothing is trimmed, here or there.
		* @param input - the state the screen renders, and what is in the field.
		* @returns the three answers the screen renders.
		*/
		function aumlokHandleGate(input) {
			const ask = input.state === "unbound";
			const normalized = typeof input.handle === "string" ? input.handle.normalize("NFKC").toLowerCase() : "";
			const valid = AUMLOK_HANDLE_PATTERN.test(normalized);
			const shown = !ask && typeof input.handle === "string" && input.handle.length > 0;
			return {
				ask,
				shown,
				locked: shown,
				value: shown ? input.handle : "",
				valid,
				canDraw: ask ? valid : true
			};
		}
		/**
		* The receipt, out of the record's own two fields.
		*
		* THE ROOT IS THE RECORD'S OWN DIGEST — `activeControlDigest`, which the v3 record projection fills
		* with the record's `rootId` — and the BOUND TIME IS THE RECORD'S OWN `boundAt`, rendered as the UTC
		* instant it is. A record that carries no readable time gets `undefined`, and the screen says so
		* rather than printing a time nobody recorded: a receipt with an invented date would be worse than no
		* receipt at all. Seconds are the unit the organ writes (`buildRecordV3({root, boundAt})`), and an
		* ISO-8601 string is passed through because that is what a reader of a v1-era record would hold.
		* @param control - the projection the screen is showing.
		* @returns the two facts the bound screen prints.
		*/
		function aumlokReceipt(control) {
			const boundAt = control.boundAt;
			return {
				root: control.activeControlDigest,
				boundAt: typeof boundAt === "number" && Number.isFinite(boundAt) ? (/* @__PURE__ */ new Date(boundAt * 1e3)).toISOString() : typeof boundAt === "string" && /^\d{4}-\d{2}-\d{2}T/u.test(boundAt) ? boundAt : void 0
			};
		}
		/**
		* "GIVE ME ANOTHER" — PETER'S OWN TWO WORDS, AND THE ONE PLACE A PHRASE CAN BE REDRAWN (Y3).
		*
		* PETER'S BIND, 2026-09-23 17:02, Y3 VERBATIM: "'Give me another': before binding, a button to draw a
		* new phrase as many times as the person likes until one feels right. Nothing is written until they
		* confirm and type it back." This decision is that sentence, and the three clauses of it are the three
		* answers below.
		*
		* "BEFORE BINDING" IS WHY IT IS OFFERED AT ONE BEAT ONLY. The words are on the screen at the `shown`
		* beat and there alone: the moment the person turns them over, they are typing the phrase back and the
		* draw is behind them. So the control appears with the words it would replace and leaves with them.
		*
		* "NOTHING IS WRITTEN" IS WHY IT CANNOT LIVE ON A BOUND MACHINE. A bound machine already has an
		* identity on disk, and a redraw there is the REFRESH — which §3 gives its own control, its own words
		* ("Rotate phrase", Y2) and its own confirmation. Offering "Give me another" beside it would put two
		* controls on the state Peter asked to carry exactly one.
		*
		* AND IT IS A QUIET CONTROL OF A DIFFERENT ELEMENT KIND, WHICH IS A CONSTRAINT AND NOT A STYLE. X6
		* courts EXACTLY ONE `<button>` in this surface, and that one button is the ceremony's own. A redraw
		* added as a second `<button>` would be the second big button Peter ruled out, and would break a
		* ticked requirement to satisfy this one — so the surface renders this as a `<span role="button">`,
		* small and unpressed-looking, and `offered` is what decides whether it is there at all.
		* @param input - the state the screen renders, the beat, and whether a ceremony is already running.
		* @returns whether the quiet redraw is offered, the copy it carries, and the element kind it must be.
		*/
		function aumlokRedraw(input) {
			const offered = input.state === "unbound" && input.beat === "shown" && !input.busy;
			return {
				offered,
				action: offered ? "surface.action.another" : void 0,
				kind: "quiet"
			};
		}
		/**
		* The action each state offers at each beat of its ceremony.
		*/
		const ACTIONS = {
			unbound: {
				none: "surface.action.give",
				shown: "surface.action.learned",
				typed: "runtime.binding.bind",
				confirm: "runtime.binding.bind"
			},
			bound: {
				none: "surface.action.newPhrase",
				shown: "surface.action.newPhrase",
				typed: "surface.action.newPhrase",
				confirm: "surface.action.newPhrase"
			},
			refresh: {
				none: "runtime.binding.busy",
				shown: "surface.action.learned",
				typed: "runtime.binding.bind",
				confirm: "runtime.binding.bind"
			}
		};
		/**
		* The button the state offers at this beat.
		* @param state - the state the screen renders.
		* @param beat - how far the person is through the ceremony that state runs.
		* @returns the key of the words on the button.
		*/
		function aumlokActionKey(state, beat) {
			return ACTIONS[state][beat];
		}
		/**
		* What one tile shows.
		*
		* THE WORDS LEAVE AS THE TILES TURN OVER. At the `shown` beat all seven tiles carry the drawn words;
		* at the `typed` and `confirm` beats they carry inputs and the words are gone from the screen,
		* because a screen that showed them while accepting them would be reading the phrase back to the
		* person typing it — and at the confirmation step it would be reading it back to somebody who has
		* just been told it is the last time they will see it. In the refresh state the old binding still
		* stands until the new words are typed back, so the tiles show dots rather than an empty screen where
		* a binding exists.
		* @param state - the state the screen renders.
		* @param beat - how far the person is through the ceremony that state runs.
		* @returns what every one of the seven tiles shows.
		*/
		function aumlokTileFace(state, beat) {
			switch (state) {
				case "bound": return "dots";
				case "unbound": return beat === "shown" ? "word" : beat === "none" ? "empty" : "input";
				case "refresh": return beat === "none" ? "dots" : beat === "shown" ? "word" : "input";
			}
		}
		/**
		* The technical status, keyed by the one discriminator the screen already branches on.
		*
		* IT LIVES HERE RATHER THAN IN THE MIDDLE OF THE MARKUP because Peter's 14:20 instruction puts every
		* sentence of it behind one closed disclosure, and the screen that renders it should hold no
		* technical key of its own: the disclosure reads this table, and a court can hold the table without
		* rendering anything. `action` is gone with the read-only button X6 deletes — a disabled control that
		* did nothing was the sentence a person did not need to act on, in button form.
		*/
		const AUMLOK_RUNTIME_POSTURE = {
			"not-connected": {
				status: "runtime.status",
				detail: "runtime.detail"
			},
			"connected": {
				status: "runtime.connected.status",
				detail: "runtime.connected.detail"
			}
		};
		/** The copy for each named absence, which is what the disclosure quotes when there is no control. */
		const AUMLOK_NOT_CONNECTED_REASON = {
			"no-controller-service": "runtime.reason.no-controller-service",
			"adapter-unbound": "runtime.reason.adapter-unbound",
			"controller-absent": "runtime.reason.controller-absent",
			"control-unreadable": "runtime.reason.control-unreadable",
			"record-names-no-machine": "runtime.reason.record-names-no-machine"
		};
		//#endregion
		//#region src/client/IdentityCard.tsx
		function Icon({ name }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.6",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: {
					copy: "M9 9h11v11H9z M15 5V2H2v13h3",
					share: "M12 16V2 M7 7l5-5 5 5 M4 12v9h16v-9",
					rotate: "M20 7a9 9 0 1 0 1 9 M20 2v6h-6",
					check: "m4 12 5 5L20 6",
					error: "m6 6 12 12 M6 18 18 6"
				}[name] })
			});
		}
		function Action({ icon, label, run, disabled = false }) {
			const [result, setResult] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const timer = (0, react.useRef)(void 0);
			const mounted = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
					clearTimeout(timer.current);
				};
			}, []);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: Aumlok_module_css_default.identityAction,
				"aria-label": label,
				title: label,
				disabled: disabled || busy,
				"data-result": result ?? void 0,
				onClick: () => {
					setBusy(true);
					run().then(() => {
						if (mounted.current) setResult("check");
					}).catch((error) => {
						if (mounted.current && (!(error instanceof Error) || error.name !== "AbortError")) setResult("error");
					}).finally(() => {
						if (!mounted.current) return;
						setBusy(false);
						clearTimeout(timer.current);
						timer.current = setTimeout(() => {
							setResult(null);
						}, 1800);
					});
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Icon, { name: result ?? icon })
			});
		}
		function IdentityCard({ control, active, readIdentity, rotate, t }) {
			const [identity, setIdentity] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				setIdentity(null);
				if (!active) return;
				const controller = new AbortController();
				let timer;
				const refresh = async () => {
					let bound = false;
					try {
						const next = await readIdentity(controller.signal);
						if (controller.signal.aborted) return;
						const matches = next.subject === control.subject && (control.handle === void 0 || next.label === control.handle);
						setIdentity(matches ? next : null);
						bound = matches && next.binding !== null;
					} catch {
						if (!controller.signal.aborted) setIdentity(null);
					}
					if (!controller.signal.aborted) timer = setTimeout(() => {
						refresh();
					}, bound ? 15e3 : 2e3);
				};
				refresh();
				return () => {
					controller.abort();
					clearTimeout(timer);
				};
			}, [
				active,
				control.subject,
				control.handle,
				control.epoch,
				readIdentity
			]);
			const copy = async (text) => {
				await navigator.clipboard.writeText(text);
			};
			const share = async () => {
				if (!identity) return;
				if (typeof navigator.share === "function") await navigator.share({ text: identity.contact });
				else await copy(identity.contact);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: Aumlok_module_css_default.identityCard,
				"data-aumlok-identity": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: Aumlok_module_css_default.identityHeader,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							id: "aumlok-title",
							"data-aumlok-owner": true,
							children: control.handle || t("title")
						}), rotate ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: Aumlok_module_css_default.identityAction,
							onClick: rotate,
							"aria-label": t("surface.action.newPhrase"),
							title: t("surface.action.newPhrase"),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Icon, { name: "rotate" })
						}) : null]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: Aumlok_module_css_default.identityQr,
						"data-aumlok-contact-qr": true,
						children: identity?.qrDataUrl ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
							src: identity.qrDataUrl,
							alt: t("identity.qr"),
							draggable: false
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: Aumlok_module_css_default.identityQrPending,
							"aria-hidden": "true"
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: Aumlok_module_css_default.identityValues,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: Aumlok_module_css_default.identityValue,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
								"data-aumlok-subject": true,
								"aria-label": t("identity.id"),
								children: control.subject
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Action, {
								icon: "copy",
								label: t("identity.copyId"),
								run: () => copy(control.subject)
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: Aumlok_module_css_default.identityValue,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
								"data-aumlok-npub": true,
								"aria-label": "npub",
								children: identity?.npub ?? ""
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Action, {
								icon: "copy",
								label: t("identity.copyNpub"),
								disabled: !identity,
								run: () => copy(identity?.npub ?? "")
							})]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: Aumlok_module_css_default.identityActions,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Action, {
							icon: "copy",
							label: t("identity.copyContact"),
							disabled: !identity,
							run: () => copy(identity?.contact ?? "")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Action, {
							icon: "share",
							label: t("identity.share"),
							disabled: !identity,
							run: share
						})]
					})
				]
			});
		}
		//#endregion
		//#region src/client/AumlokSurface.tsx
		/** Public identity when bound; the shell's existing phrase ceremony for creation and rotation. */
		function isEditableTarget(target) {
			const el = target;
			const tag = typeof el?.tagName === "string" ? el.tagName : "";
			return el?.isContentEditable === true || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
		}
		/**
		* The backend this page was served by, which is the backend every status here describes.
		*
		* Taken from the document rather than from configuration on purpose: the projection is
		* fetched with a path relative to this origin, so reading it here cannot disagree with
		* where the answer actually came from. It is rendered inside the details disclosure, where
		* a reading about one particular machine belongs.
		*
		* @returns the origin, or undefined where there is no document to ask.
		*/
		function readBackendOrigin() {
			const origin = globalThis.location?.origin;
			return typeof origin === "string" && origin.length > 0 && origin !== "null" ? origin : void 0;
		}
		/** The seven tiles are one set of seven; the typed words are held here until they cross back. */
		const TILE_POSITIONS = [
			0,
			1,
			2,
			3,
			4,
			5,
			6
		];
		/** A fresh set of empty tiles, one entry per position. */
		function emptyTyped() {
			return TILE_POSITIONS.map(() => "");
		}
		/**
		* ONE OF THE ANCHOR CARD'S SIX BOXES. A letter while the words are on the screen, a dot once they are
		* a binding, and nothing at all before then — the three faces are decided by `aumlokAnchorBoxes`, so a
		* box cannot invent a fourth.
		*/
		function AnchorBox({ box, index }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: Aumlok_module_css_default.anchorBox,
				"data-aumlok-anchor-box": index,
				"data-aumlok-anchor-box-kind": box.kind,
				children: box.kind === "letter" ? box.letter : box.kind === "dot" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { className: Aumlok_module_css_default.anchorDot }) : null
			});
		}
		/**
		* WHAT ONE THEMED ROW SHOWS. There is one body per face and no others: an empty slot, dots where a
		* bound phrase is never shown, the drawn word for the one beat it is on the screen, and the input that
		* takes it back. The face itself comes from `aumlokTileFace`, so no row can invent a state the layout
		* does not have.
		*/
		function TileBody({ face, position, word, value, dots, onType, t }) {
			switch (face) {
				case "empty": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: Aumlok_module_css_default.tileEmpty,
					"data-aumlok-tile-face": "empty",
					"aria-hidden": "true",
					children: "—"
				});
				case "dots": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: Aumlok_module_css_default.wordMask,
					"data-aumlok-tile-face": "dots",
					"aria-hidden": "true",
					children: Array.from({ length: dots }, (_, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {}, index))
				});
				case "word": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: Aumlok_module_css_default.tileWord,
					"data-aumlok-tile-face": "word",
					children: word ?? ""
				});
				case "input": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					className: Aumlok_module_css_default.tileInput,
					"data-aumlok-tile-face": "input",
					"data-aumlok-tile-input": position,
					value,
					onChange: (event) => {
						onType(position, event.target.value);
					},
					"aria-label": t("tile.input").replace("{position}", String(position)),
					autoComplete: "off",
					autoCapitalize: "none",
					spellCheck: false
				});
			}
		}
		/** The one shape a band's two rows take, from the same face as the anchor above them. */
		function PhraseBand({ band, face, words, typed, onType, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: Aumlok_module_css_default.phraseBand,
				"data-aumlok-band": band.id,
				"data-aumlok-tone": band.tone,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
					className: Aumlok_module_css_default.bandHeader,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t(band.label) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t(band.detail) })]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: Aumlok_module_css_default.bandRows,
					children: band.positions.map((position) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: Aumlok_module_css_default.phraseRow,
						"data-aumlok-token": position,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: Aumlok_module_css_default.position,
								"aria-hidden": "true",
								children: position
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: Aumlok_module_css_default.initialBox,
								"data-aumlok-initial-box": position,
								"aria-hidden": "true",
								children: aumlokWordInitial(face, words?.[position])
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TileBody, {
								face,
								position,
								word: words?.[position],
								value: typed[position] ?? "",
								dots: 5,
								onType,
								t
							}),
							face === "dots" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: Aumlok_module_css_default.visuallyHidden,
								children: t("token.rowMasked")
							}) : null
						]
					}, position))
				})]
			});
		}
		/**
		* Render the AUMLOK surface: the ceremony in its three states, and the technical status behind one
		* closed disclosure.
		* @param props - shell visibility, close action, ceremony source, and localized copy.
		* @returns the always-mounted AUMLOK surface.
		*/
		function AumlokSurface({ activeSurface, closeSurface, t, useControlProjection, ceremonyAvailable, drawPhrase, submitPhrase, refreshControlStatus, readIdentity }) {
			const active = activeSurface === "aumlok";
			const projection = useControlProjection((value) => value);
			const posture = AUMLOK_RUNTIME_POSTURE[projection.status];
			const backendOrigin = readBackendOrigin();
			const [refreshing, setRefreshing] = (0, react.useState)(false);
			const [beat, setBeat] = (0, react.useState)("none");
			const [words, setWords] = (0, react.useState)(void 0);
			const [typed, setTyped] = (0, react.useState)(emptyTyped);
			const [handle, setHandle] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [acknowledged, setAcknowledged] = (0, react.useState)(false);
			const [outcome, setOutcome] = (0, react.useState)(void 0);
			const state = aumlokSurfaceState({
				bound: projection.status === "connected",
				refreshing
			});
			const face = aumlokTileFace(state, beat);
			const action = aumlokActionKey(state, beat);
			const gate = aumlokConfirmGate({
				beat,
				acknowledged,
				busy
			});
			const redraw = aumlokRedraw({
				state,
				beat,
				busy
			});
			const boundHandle = projection.status === "connected" ? projection.control.handle : void 0;
			const handleGate = aumlokHandleGate({
				state,
				handle: typeof boundHandle === "string" && boundHandle.length > 0 ? boundHandle : state === "unbound" ? handle : ""
			});
			const receipt = projection.status === "connected" ? aumlokReceipt(projection.control) : void 0;
			const onType = (position, value) => {
				if (beat === "confirm") setAcknowledged(false);
				setTyped((current) => current.map((word, index) => index === position ? value : word));
			};
			const begin = (intent) => {
				if (!handleGate.canDraw) return;
				setBusy(true);
				setOutcome(void 0);
				setAcknowledged(false);
				if (intent === "refresh") setRefreshing(true);
				(async () => {
					const drawn = await drawPhrase(intent);
					setBusy(false);
					if (!drawn.ok || drawn.words === void 0) {
						setOutcome(drawn.reason === void 0 ? { ok: false } : {
							ok: false,
							reason: drawn.reason
						});
						if (intent === "refresh") setRefreshing(false);
						return;
					}
					setWords(drawn.words);
					setTyped(emptyTyped());
					setBeat("shown");
				})();
			};
			const submit = (intent) => {
				setBusy(true);
				setOutcome(void 0);
				(async () => {
					const result = await submitPhrase(intent, typed, handle);
					setBusy(false);
					setWords(void 0);
					setAcknowledged(false);
					setOutcome(result);
					if (!result.ok) {
						if (result.drawSpent === true) {
							setTyped(emptyTyped());
							setBeat("none");
							if (intent === "refresh") setRefreshing(false);
							return;
						}
						setBeat("typed");
						return;
					}
					setBeat("none");
					setTyped(emptyTyped());
					setRefreshing(false);
					refreshControlStatus();
				})();
			};
			const act = () => {
				if (busy) return;
				if (beat === "shown") {
					setWords(void 0);
					setBeat("typed");
					return;
				}
				if (beat === "typed") {
					setAcknowledged(false);
					setBeat("confirm");
					return;
				}
				if (beat === "confirm") {
					if (!gate.bindEnabled) return;
					submit(state === "refresh" ? "refresh" : "bind");
					return;
				}
				if (state === "unbound") begin("bind");
				else if (state === "bound") begin("refresh");
			};
			(0, react.useEffect)(() => {
				if (!active) return;
				const onKeyDown = (event) => {
					if (event.key !== "Escape" || event.defaultPrevented) return;
					if (isEditableTarget(event.target)) return;
					event.preventDefault();
					closeSurface();
				};
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [active, closeSurface]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
				"data-aumlok-surface": true,
				className: Aumlok_module_css_default.surface,
				hidden: !active,
				"aria-hidden": !active,
				"aria-labelledby": "aumlok-title",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: Aumlok_module_css_default.canvas,
					children: state === "bound" && projection.status === "connected" && !projection.control.revoked ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IdentityCard, {
						control: projection.control,
						active,
						readIdentity,
						t,
						...ceremonyAvailable ? { rotate: () => {
							begin("refresh");
						} } : {}
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: Aumlok_module_css_default.hero,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: Aumlok_module_css_default.heroCopy,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("eyebrow") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
								id: "aumlok-title",
								children: t("title")
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: Aumlok_module_css_default.statusBadge,
							"data-aumlok-badge": aumlokBadgeWord(state),
							children: t(aumlokBadgeWord(state))
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: Aumlok_module_css_default.composition,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: Aumlok_module_css_default.phraseStage,
							"aria-labelledby": "aumlok-phrase-label",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									id: "aumlok-phrase-label",
									children: t("phrase.label")
								}),
								handleGate.ask ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: Aumlok_module_css_default.handleField,
									"data-aumlok-handle": true,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
											className: Aumlok_module_css_default.handleLabel,
											htmlFor: "aumlok-handle",
											children: t("surface.handle.label")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											id: "aumlok-handle",
											className: Aumlok_module_css_default.handleInput,
											"data-aumlok-handle-input": true,
											value: handle,
											disabled: busy,
											onChange: (event) => {
												setHandle(event.target.value);
											},
											autoComplete: "off",
											autoCapitalize: "none",
											spellCheck: false
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: Aumlok_module_css_default.handleHint,
											"data-aumlok-handle-hint": true,
											children: handle.length === 0 || handleGate.valid ? t("surface.handle.hint") : t("surface.handle.invalid")
										})
									]
								}) : null,
								handleGate.shown ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: Aumlok_module_css_default.handleField,
									"data-aumlok-handle-locked": true,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
											className: Aumlok_module_css_default.handleLabel,
											htmlFor: "aumlok-handle-locked",
											children: t("surface.handle.label")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											id: "aumlok-handle-locked",
											className: Aumlok_module_css_default.handleLocked,
											"data-aumlok-handle-locked-input": true,
											value: handleGate.value,
											readOnly: true,
											"aria-readonly": "true",
											autoComplete: "off",
											spellCheck: false
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: Aumlok_module_css_default.handleHint,
											"data-aumlok-handle-locked-hint": true,
											children: t("surface.handle.locked")
										})
									]
								}) : null,
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: Aumlok_module_css_default.anchorToken,
									"data-aumlok-token": 0,
									"data-aumlok-anchor-card": true,
									"data-aumlok-tile-face": face,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: Aumlok_module_css_default.anchorMeta,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("anchor.label") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("anchor.detail") })]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: Aumlok_module_css_default.anchorBoxes,
											children: [face === "word" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												"data-aumlok-reveal": "words",
												"aria-hidden": "true"
											}) : null, face === "input" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												className: Aumlok_module_css_default.anchorInput,
												"data-aumlok-tile-input": 0,
												"data-aumlok-anchor-input": true,
												value: typed[0] ?? "",
												onChange: (event) => {
													onType(0, event.target.value);
												},
												"aria-label": t("tile.input").replace("{position}", String(0)),
												autoComplete: "off",
												autoCapitalize: "none",
												spellCheck: false
											}) : aumlokAnchorBoxes(face, words?.[0]).map((box, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AnchorBox, {
												box,
												index
											}, index))]
										}),
										face === "dots" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: Aumlok_module_css_default.visuallyHidden,
											children: t("token.anchorMasked")
										}) : null
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: Aumlok_module_css_default.bands,
									children: [face === "word" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										"data-aumlok-reveal": "words",
										"aria-hidden": "true"
									}) : null, AUMLOK_BANDS.map((band) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PhraseBand, {
										band,
										face,
										words,
										typed,
										onType,
										t
									}, band.id))]
								}),
								receipt === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: Aumlok_module_css_default.boundReceipt,
									"data-aumlok-bound-receipt": true,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: Aumlok_module_css_default.boundQuiet,
											"data-aumlok-bound-quiet": true,
											children: t("surface.bound.quiet")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: Aumlok_module_css_default.boundLine,
											"data-aumlok-bound-line": true,
											children: t("surface.bound.line")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
											className: Aumlok_module_css_default.receipt,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("receipt.root") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
												"data-aumlok-receipt-root": true,
												children: receipt.root
											}) })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("receipt.bound") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
												"data-aumlok-receipt-bound": true,
												children: receipt.boundAt ?? t("receipt.bound.unknown")
											}) })] })]
										})
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
									className: Aumlok_module_css_default.details,
									"data-aumlok-details": true,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", {
										className: Aumlok_module_css_default.detailsSummary,
										children: t("details")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: Aumlok_module_css_default.runtimePosture,
										"data-aumlok-runtime": projection.status,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t(posture.status) }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t(posture.detail) }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													"data-aumlok-origin": backendOrigin ?? "unknown",
													children: backendOrigin === void 0 ? t("runtime.origin.unknown") : t("runtime.origin").replace("{origin}", backendOrigin)
												})
											] }),
											projection.status === "not-connected" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
												className: Aumlok_module_css_default.missingBinding,
												"data-aumlok-missing-binding": true,
												"data-aumlok-reason": projection.reason ?? "unnamed",
												children: [
													projection.reason === void 0 ? t("runtime.reason.unnamed") : t(AUMLOK_NOT_CONNECTED_REASON[projection.reason]),
													projection.code === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [" ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
														"data-aumlok-refusal-code": true,
														children: t("runtime.reason.code").replace("{code}", projection.code)
													})] }),
													projection.detail === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														"data-aumlok-refusal-detail": true,
														children: [" ", projection.detail]
													})
												]
											}) : null,
											projection.status === "connected" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
												className: Aumlok_module_css_default.controlProjection,
												"data-aumlok-control-projection": true,
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("runtime.field.subject") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
														"data-aumlok-subject": true,
														children: projection.control.subject
													}) })] }),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("runtime.field.epoch") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
														"data-aumlok-epoch": true,
														children: projection.control.epoch
													}) })] }),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("runtime.field.activeControl") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
														"data-aumlok-control-digest": true,
														children: projection.control.activeControlDigest
													}) })] }),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("runtime.field.revoked") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
														"data-aumlok-revoked": String(projection.control.revoked),
														children: t(projection.control.revoked ? "runtime.revoked.yes" : "runtime.revoked.no")
													}) })] }),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("runtime.field.approvalKey") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
														"data-aumlok-approval-key": true,
														children: projection.control.approvalKeyDid
													}) })] }),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("runtime.field.domain") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
														"data-aumlok-domain": true,
														children: projection.control.domain
													}) })] }),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("runtime.field.custody") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
														"data-aumlok-custody-class": true,
														children: projection.control.custodyClass
													}) })] }),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("runtime.field.projectionState") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
														"data-aumlok-projection-state": true,
														"data-aumlok-connection-state": true,
														children: t("runtime.projection.loaded")
													}) })] }),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("runtime.field.bindment") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
														"data-aumlok-bindment-status": true,
														children: t("runtime.bindment.unknown")
													}) })] }),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("runtime.field.reviewChannel") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
														"data-aumlok-review-channel": true,
														children: t("runtime.reviewChannel.notReported")
													}) })] })
												]
											}) : null
										]
									})]
								})
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: Aumlok_module_css_default.flow,
							"aria-labelledby": "aumlok-flow-label",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									id: "aumlok-flow-label",
									children: t("surface.explanation.title")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("ul", {
									className: Aumlok_module_css_default.explanation,
									"data-aumlok-explanation": true,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: t("surface.explanation.install") }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: t("surface.explanation.made") }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: t("surface.explanation.spirit") })
									]
								}),
								ceremonyAvailable ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: Aumlok_module_css_default.ceremonyAction,
									"data-aumlok-ceremony-state": state,
									"data-aumlok-ceremony-beat": beat,
									children: [
										beat === "shown" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: Aumlok_module_css_default.warning,
											"data-aumlok-phrase-warning": true,
											children: t("surface.warning.lost")
										}) : null,
										redraw.offered ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: Aumlok_module_css_default.redraw,
											"data-aumlok-redraw": true,
											"data-aumlok-redraw-kind": redraw.kind,
											role: "button",
											tabIndex: 0,
											onClick: () => {
												begin("bind");
											},
											onKeyDown: (event) => {
												if (event.key !== "Enter" && event.key !== " ") return;
												event.preventDefault();
												begin("bind");
											},
											children: t(redraw.action ?? "surface.action.another")
										}) : null,
										gate.ask ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: Aumlok_module_css_default.confirm,
											"data-aumlok-confirm": true,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: Aumlok_module_css_default.confirmWarning,
												"data-aumlok-confirm-warning": true,
												children: t("surface.confirm.warning")
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
												className: Aumlok_module_css_default.confirmRow,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
													type: "checkbox",
													"data-aumlok-confirm-checkbox": true,
													checked: acknowledged,
													disabled: busy,
													onChange: (event) => {
														setAcknowledged(event.target.checked);
													}
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("surface.confirm.checkbox") })]
											})]
										}) : null,
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											"data-aumlok-bind-button": true,
											"data-aumlok-action": action,
											disabled: busy || gate.ask && !gate.bindEnabled || handleGate.ask && !handleGate.canDraw,
											"aria-busy": busy,
											onClick: act,
											children: t(busy ? "runtime.binding.busy" : action)
										}),
										outcome === void 0 || outcome.ok ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
											className: Aumlok_module_css_default.ceremonyRefusal,
											"data-aumlok-binding-refused": "true",
											children: [t("runtime.binding.failed"), outcome.reason === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [" ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
												"data-aumlok-binding-reason": true,
												children: outcome.reason
											})] })]
										})
									]
								}) : null
							]
						})]
					})] })
				})
			});
		}
		//#endregion
		//#region src/client/record-projection.ts
		/**
		* The fields `recordProjection` in `plugins/aukora-aumlok/lib/record-v3.mjs` produces.
		*
		* EIGHT, PLUS THE HANDLE WHEN THE RECORD CARRIES ONE (Y2, 2026-09-23), PLUS THE APPROVAL KEY. This list
		* used to be exhaustive at eight, and the organ's projection gained a ninth field when X8 made the
		* handle half of the key: `recordProjection` spreads `handle` only for a record that has one, because a
		* record bound before X8 carries none and must keep projecting. A list that demanded EXACTLY eight
		* therefore refused every record the CURRENT ceremony writes — including, through
		* `parseAumlokControl`, the answer the mounted adapter gives — so a machine that had just bound read
		* `control-unreadable` and its badge stayed UNBOUND. MEASURED: the organ's own projection over a fresh
		* bind carries `subject,rootId,ed25519,mlDsa65,boundAt,genesisRef,epoch,receipt,handle` and this parser
		* refused it with "fields must be exactly boundAt, ed25519, epoch, genesisRef, mlDsa65, receipt, rootId,
		* subject".
		*
		* SO THE REQUIRED SET IS THE EIGHT AND THE HANDLE IS OPTIONAL. An unknown ninth field is STILL a
		* refusal: a v3 record's field set is closed, and a value nothing validates must not reach the screen.
		*
		* `approvalKeyDid` IS REQUIRED, AND THE HANDLE'S OPTIONALITY IS EXACTLY WHY IT IS (2026-09-23). The
		* screen showed the WRONG KEY for as long as it derived one itself: it built `approvalKeyDid` from
		* `ed25519`, which is `publicRoot.ed25519` — the ROOT key — while the key that signs an approval here is
		* the MACHINE key whose seed sits in `machine-seed-v3.json` and whose public half the record lists in
		* `machines[]`. Those are different keys on a real record (`161bc509…` against `59d6f06e…` on Peter's),
		* and a signature made with one cannot verify under the other. The organ's projection now carries the
		* approval key it derived, so this parser CARRIES THAT VALUE THROUGH instead of inventing a second
		* answer. It is required rather than optional because an optional field would leave the old derivation
		* as the fallback and the wrong key would come back the moment the field was absent — and
		* `recordProjection` DOES omit it for a record that lists more than one machine, where the record alone
		* cannot say which machine signs here. Such a projection is refused by name, which is the honest screen.
		* `activeControlDigest` is still read from `rootId` rather than carried: for a v3 record the record's own
		* root IS the control head, that is the mapping this file's own comment documents, and a second copy of
		* one fact is a second thing to disagree.
		*/
		const AUMLOK_RECORD_FIELDS = [
			"subject",
			"rootId",
			"ed25519",
			"mlDsa65",
			"boundAt",
			"genesisRef",
			"epoch",
			"receipt",
			"approvalKeyDid"
		];
		/**
		* The seven control fields, as the ORGAN defines them (`plugins/aukora-aumlok/lib/projection.mjs`).
		*
		* SPELLED HERE RATHER THAN IMPORTED because that module is `node:crypto` code and cannot come into the
		* bundle, exactly as the base58 encoder below is spelled for the same reason. The court that asserts
		* this list is the organ's is `tests/aukora-face-aumlok-control.test.mjs`, which parses a projection the
		* ORGAN produced rather than one this file invented.
		*/
		const AUMLOK_RECORD_CONTROL_PROJECTION_FIELDS = [
			"domain",
			"subject",
			"epoch",
			"activeControlDigest",
			"revoked",
			"approvalKeyDid",
			"custodyClass"
		];
		/**
		* The record facts the ORGAN'S CONTROL PROJECTION carries beside the seven control fields.
		*
		* WHY THIS EXISTS, AND IT IS THE SECOND HALF OF THE SAME REPAIR. `loadLocalAumlokPublicControl` now
		* answers a v3 record with `projectRecordV3Control` — the seven fields the admission machinery reads,
		* which is what makes an approval possible at all — and that function also carries `boundAt` and
		* `handle`, because the SCREEN reads them and a read that answered with the control fields alone would
		* have taken the binding time away from the receipt and the public name away from the ceremony lock.
		* MEASURED: that read arrives here and, before this list existed, `parseAumlokControl` refused it
		* `aumlok-control-projection:unrecognised` — a machine that had just bound read UNBOUND, which is the
		* exact defect U6 exists to catch, arrived at from the other side.
		*/
		const AUMLOK_CONTROL_CARRIED_RECORD_FIELDS = ["boundAt", "handle"];
		/**
		* The record's own fields the ORGAN'S CONTROL PROJECTION carries, and the one it makes optional.
		*
		* WHAT THE ORGAN'S PROJECTION ACTUALLY IS, MEASURED RATHER THAN ASSUMED. `projectRecordV3Control`
		* returns the seven control fields, plus `boundAt` — the one field a person reads as "when did I do
		* this", which the receipt renders — plus `handle` when the record has one. It does NOT carry the
		* record's other public fields (`rootId`, `ed25519`, `mlDsa65`, `genesisRef`, `receipt`), and that is
		* the design rather than an omission: those are the RECORD's view, `recordProjection` answers them, and
		* a read that answered both would be two field sets in one value, which is the shape ambiguity this
		* file's predicates exist to remove. A caller that needs both — a screen rendering a receipt AND the
		* record's keys — reads both, and each answer is closed.
		*/
		const AUMLOK_CONTROL_RECORD_FIELDS = ["boundAt"];
		/**
		* Whether a candidate is the ORGAN'S CONTROL projection of a v3 record: the seven control fields, the
		* binding moment, and the public handle when the record carries one.
		*
		* STRICT IN BOTH DIRECTIONS, like every other shape check in this file. A missing required field is not
		* this shape, and an EXTRA field is not either — an unknown field reaching the screen is what the closed
		* sets exist to prevent. The control fields are spelled here rather than imported from the v1 parser
		* because that parser's list is its own contract and this shape is a different one.
		*/
		function isAumlokRecordControlProjection(input) {
			if (input === null || typeof input !== "object" || Array.isArray(input)) return false;
			if (Object.getPrototypeOf(input) !== Object.prototype) return false;
			const allowed = new Set([
				...AUMLOK_RECORD_CONTROL_PROJECTION_FIELDS,
				...AUMLOK_CONTROL_RECORD_FIELDS,
				...AUMLOK_CONTROL_CARRIED_RECORD_FIELDS
			]);
			if (Object.keys(input).some((key) => !allowed.has(key))) return false;
			return [...AUMLOK_RECORD_CONTROL_PROJECTION_FIELDS, ...AUMLOK_CONTROL_RECORD_FIELDS].every((field) => Object.hasOwn(input, field));
		}
		/** The one field a v3 record carries only sometimes: the public handle X8 salts the key with. */
		const AUMLOK_RECORD_OPTIONAL_FIELDS = ["handle"];
		/**
		* The domain this screen shows for a v3 record.
		*
		* IT IS NOT `aukora:aumlok-public-control:v1`, AND IT MUST NOT PRETEND TO BE. `store.mjs` names the
		* two record formats by domain so a reader can tell which one it holds; a v3 record rendered under
		* the v1 control domain would be the screen making the claim the controller refused to make. The
		* field is on the screen precisely so a person can see which record they are reading.
		*/
		const AUMLOK_RECORD_DOMAIN = "aukora:local-aumlok-control:v3";
		/**
		* The domain a CONTROL projection carries, which is NOT this file's record domain.
		*
		* SPELLED HERE RATHER THAN IMPORTED, AND THE REASON IS A CYCLE. `control-projection.ts` already imports
		* THIS module, so a value import back into it would be a cycle — the same reason the type import at the
		* top is type-only. The value is the organ's (`PUBLIC_CONTROL_DOMAIN` in
		* `plugins/aukora-aumlok/lib/projection.mjs`) and it is the same string the face's own
		* `AUMLOK_PUBLIC_CONTROL_DOMAIN` holds; the arm in `tests/aukora-face-aumlok-control.test.mjs` parses a
		* projection the ORGAN produced, so a drift between the three shows up as a refused projection rather
		* than as three spellings agreeing with each other.
		*/
		const AUMLOK_CONTROL_PROJECTION_DOMAIN = "aukora:aumlok-public-control:v1";
		const SUBJECT$1 = /^aukora:1:[0-9a-f]{64}$/u;
		const DIGEST$1 = /^[0-9a-f]{64}$/u;
		const REF24 = /^[0-9a-f]{24}$/u;
		const LOWER_HEX = /^[0-9a-f]+$/u;
		/** The one custody ceiling a local controller declares, v1 control and v3 record alike. */
		const CUSTODY_CLASS = "same-uid-posix-mode-only";
		/**
		* Validate the ORGAN'S CONTROL projection of a v3 record and map it onto what the surface renders.
		*
		* IT DOES NOT RE-DERIVE THE APPROVAL KEY, AND THAT IS THE WHOLE POINT. The value carries
		* `approvalKeyDid` because the organ decided which machine signs here — from the seed this laptop kept,
		* held against the record's own `machines[]`. This parser checks the field's SHAPE and CARRIES IT. The
		* version of this file that computed a DID itself computed the ROOT's, from `publicRoot.ed25519`, and a
		* signature made by this laptop can never verify under that key.
		*
		* THE CLOCK AND THE DIGEST ARE READ THE SAME WAY as in the record view: `activeControlDigest` is
		* carried, because on this shape the organ has already stated it, and `rootId` is the same value — the
		* arm that asserts they agree is in `tests/aukora-face-aumlok-control.test.mjs`, so the two cannot drift.
		* @param input - a value for which {@link isAumlokRecordControlProjection} is true.
		* @returns the frozen projection the surface renders.
		* @throws TypeError when the value is not exactly one control projection of a v3 record.
		*/
		function parseAumlokRecordControlProjection(input) {
			if (!isAumlokRecordControlProjection(input)) throw new TypeError(`aumlok-record-control-projection: fields must be exactly ${[...AUMLOK_RECORD_CONTROL_PROJECTION_FIELDS, ...AUMLOK_CONTROL_CARRIED_RECORD_FIELDS].sort().join(", ")}`);
			const record = input;
			const fail = (detail) => {
				throw new TypeError(`aumlok-record-control-projection: ${detail}`);
			};
			const { domain, subject, epoch, activeControlDigest, revoked, approvalKeyDid, custodyClass, boundAt } = record;
			if (domain !== "aukora:aumlok-public-control:v1") fail(`domain must equal ${AUMLOK_CONTROL_PROJECTION_DOMAIN}`);
			if (typeof revoked !== "boolean") fail("revoked must be a boolean");
			if (custodyClass !== CUSTODY_CLASS) fail(`custodyClass must equal ${CUSTODY_CLASS}`);
			const subjectText = typeof subject === "string" && SUBJECT$1.test(subject) ? subject : fail("subject must be aukora:1:<64 hex>");
			if (typeof epoch !== "number" || !Number.isSafeInteger(epoch) || epoch < 0) fail("epoch must be a non-negative integer");
			if (typeof activeControlDigest !== "string" || !DIGEST$1.test(activeControlDigest)) fail("activeControlDigest must be 64 hex characters");
			if (typeof approvalKeyDid !== "string" || !approvalKeyDid.startsWith("did:key:z")) fail("approvalKeyDid must be the did:key of the machine key that signs approvals here");
			if (typeof boundAt !== "string" && typeof boundAt !== "number") fail("boundAt must be a string or a number");
			const { handle } = record;
			if (handle !== void 0 && (typeof handle !== "string" || handle.length === 0)) fail("handle must be a non-empty string when the record carries one");
			return Object.freeze({
				domain,
				subject: subjectText,
				epoch,
				activeControlDigest,
				revoked,
				approvalKeyDid,
				custodyClass: CUSTODY_CLASS,
				boundAt,
				...typeof handle === "string" ? { handle } : {}
			});
		}
		/**
		* Whether a candidate value is a v3 record projection.
		*
		* STRICT, FOR THE SAME REASON THE SEVEN-FIELD PARSER IS. The record module builds the eight required
		* fields, plus `handle` on a record that carries one, and nothing else — so an extra field is a refusal
		* rather than a value to ignore.
		* @param input - candidate value decoded at a transport boundary.
		* @returns true when the value's keys are {@link AUMLOK_RECORD_FIELDS}, plus only
		*   {@link AUMLOK_RECORD_OPTIONAL_FIELDS} when present.
		*/
		function isAumlokRecordProjection(input) {
			if (input === null || typeof input !== "object" || Array.isArray(input)) return false;
			if (Object.getPrototypeOf(input) !== Object.prototype) return false;
			const allowed = new Set([...AUMLOK_RECORD_FIELDS, ...AUMLOK_RECORD_OPTIONAL_FIELDS]);
			if (Object.keys(input).some((key) => !allowed.has(key))) return false;
			return AUMLOK_RECORD_FIELDS.every((field) => Object.hasOwn(input, field));
		}
		/**
		* Validate one v3 record projection and map it onto the projection the surface renders.
		*
		* EVERY FIELD IS CHECKED AGAINST THE SAME GRAMMARS THE SEVEN-FIELD PARSER USES, so a record this
		* screen renders is held to the shapes the controller's own readers enforce. `receipt` is
		* present-and-null-or-object: `buildRecordV3` writes it as `null` until a binding produces one, so
		* the shape a reader sees never changes between an unbound and a bound root.
		*
		* THE TWO FIELDS A v3 RECORD DOES NOT CARRY, AND WHAT IS SHOWN FOR THEM:
		*
		*   `activeControlDigest` names the ACTIVE CONTROL HEAD in v1 — it changes on rotation and on
		*   revocation while the subject stays put. A v3 record has no control heads, so the value shown is
		*   the record's own `rootId`: the sha256 the organ computed over the record's public keys in
		*   `aumlokRootId`, which IS the v3 spelling of "the keys in play now". It is a real digest of a
		*   real public identity, it is 64 hex as the field demands, and it is labelled on the screen as
		*   the record's digest rather than passed off as a control head's. IT IS NOT THE SUBJECT and must
		*   not be required to equal it: a v3 subject is the GENESIS digest, so a refresh moves this field
		*   to the new keys while the subject stays where it was — which is the whole point of the pin.
		*
		*   `revoked` has no v3 counterpart at all — there is no revocation in this record and no control
		*   head to revoke. A lost phrase is a NEW INSTANCE, not a terminal state to publish, so this reads
		*   the honest value for a record that carries no such statement and never claims one was made.
		* @param input - a value for which {@link isAumlokRecordProjection} is true.
		* @returns the frozen projection the surface renders.
		* @throws TypeError when the value is not exactly one v3 record projection.
		*/
		function parseAumlokRecordProjection(input) {
			if (!isAumlokRecordProjection(input)) throw new TypeError(`aumlok-record-projection: fields must be exactly ${[...AUMLOK_RECORD_FIELDS].sort().join(", ")}`);
			const record = input;
			const fail = (detail) => {
				throw new TypeError(`aumlok-record-projection: ${detail}`);
			};
			const { subject, rootId, ed25519, mlDsa65, boundAt, genesisRef, epoch, receipt, approvalKeyDid, handle } = record;
			const subjectText = typeof subject === "string" && SUBJECT$1.test(subject) ? subject : fail("subject must be aukora:1:<64 hex>");
			if (typeof rootId !== "string" || !DIGEST$1.test(rootId)) fail("rootId must be 64 hex characters");
			if (typeof approvalKeyDid !== "string" || !approvalKeyDid.startsWith("did:key:z")) fail("approvalKeyDid must be the did:key of the machine key that signs approvals here — a record listing more than one machine does not settle which, and the root key is never the answer");
			if (typeof ed25519 !== "string" || !LOWER_HEX.test(ed25519) || ed25519.length !== 64) fail("ed25519 must be a 64-hex raw Ed25519 public key");
			if (typeof mlDsa65 !== "string" || !LOWER_HEX.test(mlDsa65) || mlDsa65.length === 0) fail("mlDsa65 must be the raw ML-DSA-65 public key in hex");
			if (typeof boundAt !== "string" && typeof boundAt !== "number") fail("boundAt must be a string or a number");
			if (typeof genesisRef !== "string" || !REF24.test(genesisRef)) fail("genesisRef must be 24 hex characters");
			if (typeof epoch !== "number" || !Number.isSafeInteger(epoch) || epoch < 0) fail("epoch must be a non-negative integer");
			if (receipt !== null && (typeof receipt !== "object" || Array.isArray(receipt))) fail("receipt must be null or the binding receipt object");
			if (handle !== void 0 && (typeof handle !== "string" || handle.length === 0)) fail("handle must be a non-empty string when the record carries one");
			return Object.freeze({
				domain: AUMLOK_RECORD_DOMAIN,
				subject: subjectText,
				epoch,
				activeControlDigest: rootId,
				revoked: false,
				approvalKeyDid,
				custodyClass: CUSTODY_CLASS,
				boundAt,
				...typeof handle === "string" ? { handle } : {}
			});
		}
		//#endregion
		//#region src/control-projection.ts
		/**
		* The AUMLOK public control projection, exactly as the controller plugin defines it.
		*
		* THIS FILE OWNS NO SCHEMA OF ITS OWN. `plugins/aukora-aumlok/lib/projection.mjs`
		* defines a closed seven-field public control and builds it field by field so that the
		* private half — the Ed25519 private key PEM and the ML-DSA-65 secret — structurally
		* cannot appear in it. The screen reproduces those seven fields and refuses anything
		* else on the wire. A screen with its own shape would be a second definition of a
		* public identity, and the first time the two disagreed the screen would be lying.
		*
		* WHAT THIS SURFACE IS NOT. It shows status. It never generates a phrase, never asks for one,
		* never holds a key, and never approves anything. BINDING RUNS HERE, ON THIS SCREEN: the seven
		* words are drawn once, typed back into their tiles, and the root is DERIVED from them — there is
		* no separate window in v3 and nothing is unwrapped into a record, because the words themselves
		* are the key. Approval is a separate signer process on a Unix socket. Neither is reachable from a
		* browser, and neither should be.
		*/
		const SUBJECT = /^aukora:1:[0-9a-f]{64}$/u;
		const DIGEST = /^[0-9a-f]{64}$/u;
		const DID_KEY = /^did:key:z[1-9A-HJ-NP-Za-km-z]{16,}$/u;
		/** The closed field set of `plugins/aukora-aumlok/lib/projection.mjs`. */
		const FIELDS = [
			"domain",
			"subject",
			"epoch",
			"activeControlDigest",
			"revoked",
			"approvalKeyDid",
			"custodyClass"
		];
		/** The one domain a public control projection may carry. */
		const AUMLOK_PUBLIC_CONTROL_DOMAIN = "aukora:aumlok-public-control:v1";
		/** The one custody ceiling the local controller declares. */
		const AUMLOK_LOCAL_CUSTODY_CLASS = "same-uid-posix-mode-only";
		/** Same-origin GET route serving the current AUMLOK public control. */
		const AUMLOK_CONTROL_STATUS_ENDPOINT = "/api/aukora/aumlok-control";
		/**
		* Build one not-connected body.
		* @param reason - which of the three absences this is.
		* @param code - the controller's own refusal code, when it produced one.
		* @returns the frozen body.
		*/
		function aumlokNotConnected(reason, code, detail) {
			return Object.freeze({
				status: "not-connected",
				reason,
				...code === void 0 ? {} : { code },
				...detail === void 0 || detail === "" ? {} : { detail }
			});
		}
		/**
		* Validate a candidate not-connected body from the status endpoint.
		* @param input - candidate value decoded at a transport boundary.
		* @returns the frozen body when exact, undefined otherwise.
		*/
		function parseAumlokNotConnectedBody(input) {
			if (input === null || typeof input !== "object" || Array.isArray(input)) return void 0;
			if (Object.getPrototypeOf(input) !== Object.prototype) return void 0;
			const record = input;
			if (record["status"] !== "not-connected") return void 0;
			const reason = record["reason"];
			if (reason !== "no-controller-service" && reason !== "adapter-unbound" && reason !== "controller-absent" && reason !== "control-unreadable" && reason !== "record-names-no-machine") return;
			const code = record["code"];
			if (code !== void 0 && (typeof code !== "string" || code.length === 0 || code.length > 128)) return void 0;
			const detail = record["detail"];
			if (detail !== void 0 && (typeof detail !== "string" || detail.length === 0 || detail.length > 1024)) return void 0;
			const keys = Object.keys(record).sort();
			const expected = [
				...code === void 0 ? [] : ["code"],
				...detail === void 0 ? [] : ["detail"],
				"reason",
				"status"
			];
			if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return void 0;
			return aumlokNotConnected(reason, code, detail);
		}
		/**
		* Validate a candidate public control projection against the controller's closed set.
		*
		* Exactness is the point. An extra field is a refusal, not a value to ignore: the
		* controller builds this object field by field precisely so that nothing else can ride
		* along, and a parser that tolerated extras would undo that at the last hop.
		* @param input - candidate value decoded at a transport boundary.
		* @returns the frozen projection.
		* @throws TypeError when the value is not exactly one projection.
		*/
		function parseAumlokControlProjection(input) {
			const fail = (detail) => {
				throw new TypeError(`aumlok-control-projection: ${detail}`);
			};
			if (input === null || typeof input !== "object" || Array.isArray(input)) fail("not an object");
			if (Object.getPrototypeOf(input) !== Object.prototype) fail("not a plain object");
			const record = input;
			const actual = Object.keys(record).sort();
			const expected = [...FIELDS].sort();
			if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(`fields must be exactly ${expected.join(", ")}`);
			const { domain, subject, epoch, activeControlDigest, revoked, approvalKeyDid, custodyClass } = record;
			if (domain !== "aukora:aumlok-public-control:v1") fail(`domain must equal ${AUMLOK_PUBLIC_CONTROL_DOMAIN}`);
			if (typeof subject !== "string" || !SUBJECT.test(subject)) fail("subject must be aukora:1:<64 hex>");
			if (typeof epoch !== "number" || !Number.isSafeInteger(epoch) || epoch < 0) fail("epoch must be a non-negative integer");
			if (typeof activeControlDigest !== "string" || !DIGEST.test(activeControlDigest)) fail("activeControlDigest must be 64 hex characters");
			if (typeof revoked !== "boolean") fail("revoked must be a boolean");
			if (typeof approvalKeyDid !== "string" || !DID_KEY.test(approvalKeyDid)) fail("approvalKeyDid must be a did:key");
			if (custodyClass !== "same-uid-posix-mode-only") fail(`custodyClass must equal ${AUMLOK_LOCAL_CUSTODY_CLASS}`);
			return Object.freeze({
				domain: AUMLOK_PUBLIC_CONTROL_DOMAIN,
				subject,
				epoch,
				activeControlDigest,
				revoked,
				approvalKeyDid,
				custodyClass: AUMLOK_LOCAL_CUSTODY_CLASS
			});
		}
		/**
		* Validate and normalise EITHER record shape this screen may be handed.
		*
		* THREE RECOGNISED SHAPES NOW, AND THE THIRD IS WHY THE FIRST TWO COULD NOT BE LEFT ALONE. The
		* controller's `lib/store.mjs` dispatches on the record's own domain, so a directory holding a v1
		* control record serves the seven-field public control; a directory holding a v3 record serves the
		* ORGAN'S CONTROL projection — the seven control fields plus the two record facts the screen reads,
		* which is the shape that makes an approval possible at all; and `recordProjection` serves the record's
		* own view, which the face's host half reads directly from a directory. All three are the controller's
		* own output for a BOUND machine, and a screen that accepts only one of them reports the others as an
		* unrecognised projection — which is how a machine bound the v3 way never showed BOUND at all.
		*
		* THE ORDER IS SPECIFIC-FIRST, AND THAT IS NOT AN ACCIDENT. The control projection and the record view
		* have DISJOINT field sets, so at most one predicate can match and no input is read as the wrong shape;
		* the v1 parser is last because it is the strictest and the oldest. A shape that is none of the three is
		* still a refusal, and the failure names the seven-field contract because that is the one this module
		* owns. Nothing unknown is ever rendered.
		* @param input - candidate value decoded at a transport boundary.
		* @returns the frozen projection, in the surface's own field set either way.
		* @throws TypeError when the value is neither shape.
		*/
		function parseAumlokControl(input) {
			if (isAumlokRecordControlProjection(input)) return parseAumlokRecordControlProjection(input);
			if (isAumlokRecordProjection(input)) return parseAumlokRecordProjection(input);
			return parseAumlokControlProjection(input);
		}
		//#endregion
		//#region src/client/binding-bridge.ts
		/** The only shape a word of a phrase can have: lower case, and short. */
		const WORD = /^[a-z]{1,32}$/u;
		/** The plan's phrase is seven words, and a draw that is not seven words is not a phrase. */
		const PHRASE_LENGTH = 7;
		function isFunction(value) {
			return typeof value === "function";
		}
		/**
		* Read the shell bridge off the page, if this launch has one.
		*
		* `available: true` is required as well as both verbs: the shell's own flag is the shell's statement
		* that a ceremony can actually be run here, and a bridge that declares itself unavailable must not grow
		* a working-looking button. Both verbs are required together, for the same reason.
		* @param page - the object to read the bridge from; the page's own global by default.
		* @returns the bounded bridge, or undefined in a plain browser or a half-mounted shell.
		*/
		function readAumlokCeremonyBridge(page) {
			const candidate = page === void 0 ? globalThis.aukoraAumlok : page;
			if (candidate === null || typeof candidate !== "object") return void 0;
			const record = candidate;
			if (record["available"] !== true) return void 0;
			if (!isFunction(record["draw"]) || !isFunction(record["submit"])) return void 0;
			return {
				draw: (intent) => record["draw"].call(candidate, intent),
				submit: (intent, words, handle) => record["submit"].call(candidate, intent, words, handle)
			};
		}
		/** The shell's reason, when it gave one this screen may show. */
		function readReason(value) {
			if (typeof value !== "string" || value.length === 0 || value.length > 128) return void 0;
			return value;
		}
		/**
		* Narrow one drawn phrase without inventing words the shell did not draw.
		*
		* A value that is not seven lower-case words is reported as a FAILURE, not as a success: a screen that
		* showed six words, or a word with a capital in it, would be showing something that is not a phrase,
		* and the person would type back what they were shown. The shell's own reason is carried through when
		* it gave one, so the screen quotes the shell rather than paraphrasing it.
		* @param value - the resolved value of a draw call.
		* @returns the seven words, or a failure carrying no words.
		*/
		function parseAumlokDrawnPhrase(value) {
			if (value === null || typeof value !== "object" || Array.isArray(value)) return { ok: false };
			const record = value;
			const reason = readReason(record["reason"]);
			if (record["ok"] !== true) return reason === void 0 ? { ok: false } : {
				ok: false,
				reason
			};
			const words = record["words"];
			if (!Array.isArray(words) || words.length !== PHRASE_LENGTH) return { ok: false };
			if (!words.every((word) => typeof word === "string" && WORD.test(word))) return { ok: false };
			return {
				ok: true,
				words: words.map((word) => String(word))
			};
		}
		/**
		* Narrow one submit result without inventing a claim the shell did not make.
		*
		* A value that is not the contracted shape is reported as a FAILURE with no reason, not as a success:
		* the caller then says only that no result came back, which is the whole of what is known.
		* @param value - the resolved value of a submit call.
		* @returns the contracted result, or a failure carrying no reason.
		*/
		function parseAumlokCeremonyResult(value) {
			if (value === null || typeof value !== "object" || Array.isArray(value)) return { ok: false };
			const record = value;
			const ok = record["ok"] === true;
			const reason = readReason(record["reason"]);
			const spent = record["drawSpent"] === true ? { drawSpent: true } : {};
			return reason === void 0 ? {
				ok,
				...spent
			} : {
				ok,
				reason,
				...spent
			};
		}
		/**
		* Draw one phrase and report what the shell said, and nothing more.
		*
		* A rejected promise (the shell died, its window was destroyed, the bridge was replaced) is the same
		* fact as a refusal with no reason: no phrase came back. Neither outcome is turned into a success.
		* @param bridge - the bounded bridge read from the page.
		* @param intent - which ceremony to draw for.
		* @returns the contracted drawn phrase, or a failure carrying no words.
		*/
		async function drawAumlokPhrase(bridge, intent) {
			try {
				switch (intent) {
					case "bind":
					case "refresh": return parseAumlokDrawnPhrase(await bridge.draw(intent));
					default: return {
						ok: false,
						reason: "aumlok:ceremony-intent-unknown"
					};
				}
			} catch {
				return { ok: false };
			}
		}
		/**
		* Hand the typed words back and report the shell's verdict, and nothing more.
		*
		* THE WORDS GO BACK EXACTLY AS TYPED, and this function keeps no copy of them: the array it is given
		* is passed through and then forgotten, so nothing here can grow a cache of a phrase. THE HANDLE GOES
		* WITH THEM, for the same reason and with the same care — except that it is public, so the only rule
		* it needs is that it is not invented here.
		* @param bridge - the bounded bridge read from the page.
		* @param intent - which ceremony the words belong to.
		* @param words - the seven typed words, in order, anchor first.
		* @param handle - the person's public handle, as typed, or nothing on a ceremony that does not ask.
		* @returns the contracted result, or a failure carrying no reason.
		*/
		async function submitAumlokPhrase(bridge, intent, words, handle) {
			try {
				switch (intent) {
					case "bind":
					case "refresh": return parseAumlokCeremonyResult(await bridge.submit(intent, words, handle));
					default: return {
						ok: false,
						reason: "aumlok:ceremony-intent-unknown"
					};
				}
			} catch {
				return { ok: false };
			}
		}
		//#endregion
		//#region src/client/control-projection.ts
		/** Browser-owned observable store for validated AUMLOK control status. */
		/** Stable disconnected snapshot shared by every projection store. */
		const AUMLOK_CONTROL_NOT_CONNECTED = Object.freeze({ status: "not-connected" });
		/** Browser-owned store populated only by a parent-status transport adapter. */
		var AumlokControlProjectionService = class extends _deepseek_ai_cordis.Service {
			/** Observable source injected into the AUMLOK surface. */
			store = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)(AUMLOK_CONTROL_NOT_CONNECTED);
			ceremony;
			/**
			* @param ctx - owning client context.
			*/
			constructor(ctx) {
				super(ctx, "aumlokControlProjection");
			}
			/**
			* Attach the desktop shell's ceremony bridge, when this launch has one.
			*
			* The ceremony and the STATUS it changes are two halves of one subject, which is why
			* the bridge is held here rather than in a second service: the surface that decides
			* between UNBOUND and BOUND is the surface that draws the words and hands them back,
			* and it does both through the same read model it renders. An absent bridge is the
			* plain-browser case and stays absent — no button, and no ceremony to run.
			* @param bridge - the bounded bridge read from the page, or undefined in a plain browser.
			*/
			attachCeremony(bridge) {
				this.ceremony = bridge;
			}
			/** Whether a ceremony can be run at all in this launch. */
			get ceremonyAvailable() {
				return this.ceremony !== void 0;
			}
			/**
			* Ask the shell for one phrase, which the screen shows once.
			*
			* THE WORDS PASS THROUGH AND ARE NOT KEPT. This method returns them to its caller, which is the
			* surface that displays them, and holds no copy of its own: a refusal is a refusal and never an
			* empty phrase, so a failed draw cannot put a blank screen where words belong.
			* @param intent - draw for a first binding, or for a refresh of a bound one.
			* @returns the seven words, or the shell's own refusal.
			*/
			async drawPhrase(intent) {
				if (this.ceremony === void 0) return {
					ok: false,
					reason: "aumlok:no-ceremony-bridge"
				};
				return drawAumlokPhrase(this.ceremony, intent);
			}
			/**
			* Hand the typed words back and wait for the shell's verdict.
			*
			* THIS METHOD KEEPS NOTHING EITHER, and the caller owns the decision to re-read the status, so that
			* a refusal cannot silently re-render the screen.
			* @param intent - which ceremony the words belong to.
			* @param words - the seven typed words, in order, anchor first.
			* @param handle - the person's PUBLIC handle, as typed, on the ceremony that asks for it (X8). It is
			*   half of the key and it is passed straight through; this service keeps nothing.
			* @returns the shell's verdict, never a claim this screen made up.
			*/
			async submitPhrase(intent, words, handle) {
				if (this.ceremony === void 0) return {
					ok: false,
					reason: "aumlok:no-ceremony-bridge"
				};
				return submitAumlokPhrase(this.ceremony, intent, words, handle);
			}
			/**
			* Replace the visible status with an exact parent-reported projection.
			* Invalid input first disconnects the view so stale identity cannot remain visible.
			* @param input - candidate transport value.
			*/
			connect(input) {
				let control;
				try {
					const envelope = input !== null && typeof input === "object" && !Array.isArray(input) ? input : void 0;
					control = parseAumlokControl(envelope?.status === "connected" ? envelope.control : input);
				} catch (error) {
					this.disconnect();
					throw error;
				}
				this.store.set(Object.freeze({
					status: "connected",
					control
				}));
			}
			/**
			* Remove parent status from the browser read model.
			* @param reason - which absence this is, when the host names one.
			* @param code - the controller's own refusal code, when it produced one.
			*/
			disconnect(reason, code, detail) {
				if (reason === void 0) {
					this.store.set(AUMLOK_CONTROL_NOT_CONNECTED);
					return;
				}
				this.store.set(Object.freeze({
					status: "not-connected",
					reason,
					...code === void 0 ? {} : { code },
					...detail === void 0 || detail === "" ? {} : { detail }
				}));
			}
		};
		//#endregion
		//#region src/client/control-status-loader.ts
		/**
		* Refreshes one generation-scoped AUMLOK status projection from the local page origin.
		* Every refresh disconnects first; aborted or superseded reads cannot restore stale status.
		*/
		var AumlokControlStatusLoader = class {
			projection;
			connection;
			fetchStatus;
			controller;
			disposed = false;
			/**
			* @param projection - browser-owned validated projection service.
			* @param connection - page connection facts used to refuse non-loopback reads.
			* @param fetchStatus - same-origin HTTP reader; defaults to the browser fetch implementation.
			*/
			constructor(projection, connection, fetchStatus = (input, init) => globalThis.fetch(input, init)) {
				this.projection = projection;
				this.connection = connection;
				this.fetchStatus = fetchStatus;
			}
			stale(controller) {
				return controller.signal.aborted;
			}
			/**
			* Drop the current projection and attempt one fresh loopback read.
			* Network, HTTP, media-type, and validation failures leave the service disconnected.
			* @returns after the current generation either connects or remains disconnected.
			*/
			async refresh() {
				this.controller?.abort();
				this.projection.disconnect();
				if (this.disposed || !this.connection.isLoopback) return;
				const controller = new AbortController();
				this.controller = controller;
				try {
					const response = await this.fetchStatus(AUMLOK_CONTROL_STATUS_ENDPOINT, {
						method: "GET",
						headers: { accept: "application/json" },
						cache: "no-store",
						credentials: "same-origin",
						signal: controller.signal
					});
					if (this.stale(controller)) return;
					const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
					if (response.status === 404 && mediaType === "application/json") {
						const body = parseAumlokNotConnectedBody(await response.json());
						if (!this.stale(controller)) this.projection.disconnect(body?.reason, body?.code, body?.detail);
						return;
					}
					if (response.status !== 200 || mediaType !== "application/json") return;
					const value = await response.json();
					if (this.stale(controller)) return;
					this.projection.connect(value);
				} catch {}
			}
			/** Permanently stop reads and remove any visible status. */
			dispose() {
				this.disposed = true;
				this.controller?.abort();
				this.controller = void 0;
				this.projection.disconnect();
			}
		};
		//#endregion
		//#region src/client/locales.ts
		/** AUMLOK launcher and the Aumlok screen's own copy: three states of one layout (plan §3). */
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"identity.id": "Aumlok ID",
			"identity.qr": "公开联系人二维码",
			"identity.copyId": "复制 Aumlok ID",
			"identity.copyNpub": "复制 npub",
			"identity.copyContact": "复制联系人",
			"identity.share": "分享联系人",
			"menu.title": "AUMLOK",
			"menu.description": "七词本地见证",
			"eyebrow": "七词绑定密语",
			"title": "AUMLOK",
			"unbound": "未绑定",
			"bound": "已绑定",
			"details": "详情",
			"phrase.label": "这就是密语的七个词",
			"surface.handle.label": "你的句柄",
			"surface.handle.hint": "公开。它为你的密钥加盐，并成为你的 名称@域名。请先输入它，再输入七个词。",
			"surface.handle.invalid": "3–24 个字符：a–z、0–9、点、下划线、连字符。",
			"surface.handle.locked": "这是你绑定的名字。已锁定——记录公布它，仪式不会重问。",
			"anchor.label": "词位零 · 锚词",
			"anchor.detail": "六个字母 · 七个词中的第一个",
			"band.root": "ROOT",
			"band.root.detail": "第一对 · 与大地相系",
			"band.unite": "UNITE",
			"band.unite.detail": "第二对 · 与彼此相系",
			"band.rise": "RISE",
			"band.rise.detail": "第三对 · 与托举相系",
			"token.anchorMasked": "已遮盖的六字母锚词",
			"token.rowMasked": "已遮盖的主题词",
			"tile.empty": "空位",
			"tile.input": "第 {position} 个词",
			"surface.action.give": "给我我的密语",
			"surface.action.newPhrase": "轮换密语",
			"surface.action.learned": "我记住了 —— 隐藏这些词",
			"surface.action.another": "再给我一个",
			"surface.warning.lost": "这七个词就是全部密钥，只显示这一次。一旦丢失，这个实例就不存在了：新密语就是一个新实例。",
			"surface.confirm.warning": "你再也见不到这些词了。请大声念出来。丢失它们就意味着一个新的身份。",
			"surface.confirm.checkbox": "我已把这七个词记在心里",
			"surface.bound.line": "你的 Aumlok 已绑定",
			"surface.bound.quiet": "已绑定。",
			"receipt.root": "根",
			"receipt.bound": "绑定时间",
			"receipt.bound.unknown": "此记录未报告绑定时间",
			"surface.explanation.title": "AUMLOK 是什么",
			"surface.explanation.install": "你不是安装 Aukora，而是绑定它。",
			"surface.explanation.made": "密语在你的机器上生成，只向你显示一次，也只由你逐词输入。",
			"surface.explanation.spirit": "像记住一个只回应你的灵的真名那样记住它。",
			"runtime.status": "没有控制器状态",
			"runtime.detail": "此界面不持有任何密钥：它只在仪式中把七个词显示一次，并且不批准任何操作。",
			"runtime.reason.no-controller-service": "此组合中没有控制器。这里没有任何行提供 ctx.aumlokControl，因此无从询问。加入 aukora-aumlok 插件的组合行才会有一个。",
			"runtime.reason.adapter-unbound": "控制器已挂载，但未绑定身份。插件在组合中，但其行未携带目录，因此它按名称拒绝，并继续提供一切不需要控制器的能力。目录由绑定仪式绑定，然后写入该行。",
			"runtime.reason.control-unreadable": "控制器目录不可读。已配置的目录中存在记录，但控制器无法从中投影出公共控制。记录存在且已损坏，因此请查看它，而不是去绑定。",
			"runtime.reason.controller-absent": "尚未绑定所有者。注册即可绑定一个。",
			"runtime.reason.record-names-no-machine": "此记录列出了多于一台机器，而本次读取没有说明哪一台是本机。没有损坏，也没有未绑定：知道自己是谁的调用方会传入自己的机器密钥，AUKORA 外壳在读取绑定状态时正是这样做的，因此第二台设备会读到已绑定。",
			"runtime.reason.unnamed": "状态不可用，且本次启动没有说明原因。",
			"runtime.reason.code": "控制器拒绝：{code}",
			"runtime.connected.status": "已从控制器读取公共控制",
			"runtime.connected.detail": "每次刷新都从控制器重新读取。这是七个公共字段；私有部分留在此界面从不打开的 0600 记录中。读到它们既不证明签名进程可达，也不证明有人在场。",
			"runtime.field.subject": "主体",
			"runtime.field.epoch": "控制纪元",
			"runtime.field.activeControl": "活动控制摘要",
			"runtime.field.domain": "投影域",
			"runtime.field.revoked": "活动头",
			"runtime.revoked.no": "未吊销",
			"runtime.revoked.yes": "已吊销 —— 此主体终止",
			"runtime.field.approvalKey": "批准密钥",
			"runtime.field.custody": "保管分类",
			"runtime.field.projectionState": "控制器投影",
			"runtime.projection.loaded": "本次请求由 ctx.aumlokControl.refresh() 读取",
			"runtime.field.bindment": "绑定",
			"runtime.bindment.unknown": "已绑定目录中存在记录。是否有人执行过仪式，不是此界面能读到的事实。",
			"runtime.binding.bind": "绑定",
			"runtime.binding.busy": "仪式进行中",
			"runtime.binding.failed": "仪式没有返回结果。状态保持不变。",
			"runtime.field.reviewChannel": "批准通道",
			"runtime.reviewChannel.notReported": "在 Unix 套接字上的独立签名进程。此界面无法探测它，浏览器中的任何确认都不能替代它的签名。",
			"runtime.origin": "读取自 {origin}。此状态只描述该后端，不描述其他任何后端。",
			"runtime.origin.unknown": "无法确定回答此状态的后端。请把它当作出处不明的读数。"
		};
		/** English dictionary, checked complete against the Chinese key set. */
		const en = {
			"identity.id": "Aumlok ID",
			"identity.qr": "Public contact QR code",
			"identity.copyId": "Copy Aumlok ID",
			"identity.copyNpub": "Copy npub",
			"identity.copyContact": "Copy contact",
			"identity.share": "Share contact",
			"menu.title": "AUMLOK",
			"menu.description": "seven-word binding witness",
			"eyebrow": "SEVEN-WORD BINDING PHRASE",
			"title": "AUMLOK",
			"unbound": "UNBOUND",
			"bound": "BOUND",
			"details": "details",
			"phrase.label": "THE SEVEN WORDS OF THE PHRASE",
			"surface.handle.label": "Your handle",
			"surface.handle.hint": "Public. It salts your key and becomes your name@domain. Type it first, then the seven words.",
			"surface.handle.invalid": "3–24 characters: a–z, 0–9, dot, underscore, hyphen.",
			"surface.handle.locked": "This is the name you are bound under. Locked — the record publishes it and the ceremony does not ask again.",
			"anchor.label": "WORD ZERO · ANCHOR",
			"anchor.detail": "six letters · word zero of the seven",
			"band.root": "ROOT",
			"band.root.detail": "first pair · of the earth",
			"band.unite": "UNITE",
			"band.unite.detail": "second pair · of each other",
			"band.rise": "RISE",
			"band.rise.detail": "third pair · of what lifts",
			"token.anchorMasked": "masked six-letter anchor word",
			"token.rowMasked": "masked themed word",
			"tile.empty": "empty",
			"tile.input": "word {position}",
			"surface.action.give": "Give me my phrase",
			"surface.action.newPhrase": "Rotate phrase",
			"surface.action.learned": "I have them — hide the words",
			"surface.action.another": "Give me another",
			"surface.warning.lost": "These seven words are the whole key and are shown once. If you lose them, this instance is gone: a new phrase is a new instance.",
			"surface.confirm.warning": "You will never see these words again. Say them out loud. Losing them means a new identity.",
			"surface.confirm.checkbox": "I know my seven words by heart",
			"surface.bound.line": "Your Aumlok is bound",
			"surface.bound.quiet": "Bound.",
			"receipt.root": "ROOT",
			"receipt.bound": "BOUND",
			"receipt.bound.unknown": "this record reports no bound time",
			"surface.explanation.title": "WHAT AUMLOK IS",
			"surface.explanation.install": "You do not install Aukora, you bind it.",
			"surface.explanation.made": "The phrase is made on your machine, shown to you exactly once, and typed back by you word by word.",
			"surface.explanation.spirit": "Learn it like the true name of a spirit that only answers to you.",
			"runtime.status": "No controller status",
			"runtime.detail": "This screen holds no key: it shows the seven words once, for the ceremony, and approves nothing.",
			"runtime.reason.no-controller-service": "No controller in this composition. Nothing provides ctx.aumlokControl here, so there is no controller to ask. A composition row for the aukora-aumlok plugin is what puts one in.",
			"runtime.reason.adapter-unbound": "Controller mounted, no identity bound. The plugin is in this composition but its row carries no directory, so it refuses by name and serves everything that does not need a controller. A directory is bound by the binding ceremony, then named in the row.",
			"runtime.reason.control-unreadable": "Controller directory unreadable. The configured directory holds a record and the controller could not project a public control from it. The record is there and is broken, so this is a thing to look at rather than a binding to run.",
			"runtime.reason.controller-absent": "No owner bound yet. Bind binds one.",
			"runtime.reason.record-names-no-machine": "This record lists more than one machine, and this read did not say which one is this laptop. Nothing is broken and nothing is unbound: a caller that knows which machine it is passes its own machine key, and the AUKORA shell does exactly that when it reads the binding state, so a second device reads BOUND.",
			"runtime.reason.unnamed": "Status unavailable, and this launch did not say why.",
			"runtime.reason.code": "Controller refusal: {code}",
			"runtime.connected.status": "Public control read from the controller",
			"runtime.connected.detail": "Re-read from the controller on every refresh. These are the seven public fields; the private half stays in a 0600 record this screen never opens. Reading them proves neither a reachable signer nor a person.",
			"runtime.field.subject": "SUBJECT",
			"runtime.field.epoch": "CONTROL EPOCH",
			"runtime.field.activeControl": "ACTIVE CONTROL DIGEST",
			"runtime.field.domain": "PROJECTION DOMAIN",
			"runtime.field.revoked": "ACTIVE HEAD",
			"runtime.revoked.no": "not revoked",
			"runtime.revoked.yes": "REVOKED — this subject is terminal",
			"runtime.field.approvalKey": "APPROVAL KEY",
			"runtime.field.custody": "CUSTODY CLASS",
			"runtime.field.projectionState": "CONTROLLER PROJECTION",
			"runtime.projection.loaded": "Read from ctx.aumlokControl.refresh() on this request",
			"runtime.field.bindment": "BINDING",
			"runtime.bindment.unknown": "A record exists in the bound directory. Whether a person ran the ceremony is not a fact this screen can read.",
			"runtime.binding.bind": "Bind",
			"runtime.binding.busy": "Ceremony running",
			"runtime.binding.failed": "The ceremony returned no result. The status is unchanged.",
			"runtime.field.reviewChannel": "APPROVAL CHANNEL",
			"runtime.reviewChannel.notReported": "A separate signer process on a Unix socket. This screen cannot probe it, and no confirmation in a browser substitutes for its signature.",
			"runtime.origin": "Read from {origin}. This status describes that backend and no other.",
			"runtime.origin.unknown": "The backend that answered could not be determined. Treat this as a reading of unknown provenance."
		};
		//#endregion
		//#region src/identity.ts
		const AUMLOK_IDENTITY_ENDPOINT = "/api/aukora/aumlok-identity";
		//#endregion
		//#region src/client/index.ts
		const NS = "aumlok";
		/** Services required by the AUMLOK browser plugin. */
		const inject = [
			"slots",
			"locale",
			"connection"
		];
		/**
		* Register the AUMLOK dictionaries, System launcher, and center surface.
		* @param ctx - Client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "ui-aumlok: dictionaries");
			const projection = new AumlokControlProjectionService(ctx);
			projection.attachCeremony(readAumlokCeremonyBridge());
			const connection = ctx.get("connection");
			const readIdentity = async (signal) => {
				if (!connection.isLoopback) throw new Error("aumlok:identity-non-loopback");
				const response = await fetch(AUMLOK_IDENTITY_ENDPOINT, {
					method: "GET",
					signal,
					headers: { accept: "application/json" },
					credentials: "same-origin",
					cache: "no-store"
				});
				if (!response.ok) throw new Error("aumlok:identity-unavailable");
				return await response.json();
			};
			const loader = new AumlokControlStatusLoader(projection, connection);
			ctx.effect(() => {
				const disposeReset = ctx.on("connection/reset", () => {
					loader.refresh();
				});
				loader.refresh();
				return () => {
					disposeReset();
					loader.dispose();
				};
			}, "ui-aumlok: control status refresh");
			ctx.slots.inject("shell.menu.system", () => ctx.slots.register({
				name: "shell.menu.system",
				id: "aumlok",
				order: 20,
				locale: NS
			}, AumlokMenu));
			ctx.inject(["slots", "aumlokControlProjection"], (scope) => {
				scope.slots.inject("shell.surface", () => scope.slots.register({
					name: "shell.surface",
					id: "aumlok",
					order: 20,
					locale: NS,
					inject: () => ({
						hooks: { controlProjection: scope.aumlokControlProjection.store },
						ceremonyAvailable: scope.aumlokControlProjection.ceremonyAvailable,
						drawPhrase: (intent) => scope.aumlokControlProjection.drawPhrase(intent),
						submitPhrase: (intent, words, handle) => scope.aumlokControlProjection.submitPhrase(intent, words, handle),
						refreshControlStatus: () => {
							loader.refresh();
							readIdentity(new AbortController().signal).catch(() => {});
						},
						readIdentity
					})
				}, AumlokSurface));
			});
		}
		//#endregion
		exports.AUMLOK_CONTROL_NOT_CONNECTED = AUMLOK_CONTROL_NOT_CONNECTED;
		exports.AumlokControlProjectionService = AumlokControlProjectionService;
		exports.apply = apply;
		exports.inject = inject;
		exports.parseAumlokControlProjection = parseAumlokControlProjection;
		exports.readAumlokCeremonyBridge = readAumlokCeremonyBridge;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map