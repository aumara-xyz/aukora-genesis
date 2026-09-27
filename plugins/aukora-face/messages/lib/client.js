window.__ModuleLoader__.load({
	id: "@aukora/face-messages",
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
		//#region \0dsh-css:Messages.module.css.mjs
		const css = ".PKtVvq_surface{width:100%;min-width:0;height:100%;min-height:0;padding:6px var(--dsh-messages-inline-padding);box-sizing:border-box;color:var(--dsw-alias-label-primary);background:0 0;flex-direction:column;display:flex;position:relative;overflow:hidden;container-type:inline-size}.PKtVvq_surface[hidden]{display:none}.PKtVvq_lane{box-sizing:border-box;flex-direction:column;flex:1;width:100%;min-height:0;display:flex}.PKtVvq_brandRow{height:60px;padding:8px 0 8px 4px;padding-right:calc(var(--dsh-hot-corner-size,74px) + var(--dsh-hot-corner-gutter,10px) - var(--dsh-messages-inline-padding));box-sizing:border-box;flex:none;align-items:center;gap:8px;margin-bottom:8px;display:flex;overflow:hidden}.PKtVvq_brandMark{color:var(--dsw-static-spatial-blue);flex:none;justify-content:center;align-items:center;display:inline-flex}.PKtVvq_brandName{letter-spacing:.04em;text-transform:uppercase;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;margin:0;font-size:18px;font-weight:600;line-height:24px;overflow:hidden}.PKtVvq_actions{align-items:center;gap:2px;display:inline-flex}.PKtVvq_iconButton{width:28px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:9px;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.PKtVvq_iconButton:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.PKtVvq_iconButton:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:1px}.PKtVvq_iconButton[aria-pressed=true]{background:color-mix(in srgb, currentColor 13%, transparent)}.PKtVvq_pinAction[aria-pressed=true]{color:var(--dsw-static-spatial-violet)}.PKtVvq_unreadAction[aria-pressed=true]{color:var(--dsw-alias-state-success-primary)}.PKtVvq_archiveAction[aria-pressed=true]{color:var(--dsw-static-spatial-gold)}.PKtVvq_posture{color:var(--dsw-static-spatial-gold);flex:none;align-items:center;gap:7px;margin:0 0 4px;padding:0 4px;font-size:12px;line-height:17px;display:flex}.PKtVvq_posture:before{content:\"\";background:var(--dsw-static-spatial-gold);border-radius:999px;flex:none;width:6px;height:6px}.PKtVvq_posture[data-posture=connected]{color:var(--dsw-alias-state-success-primary)}.PKtVvq_posture[data-posture=connected]:before{background:var(--dsw-alias-state-success-primary)}.PKtVvq_notice{border:1px solid color-mix(in srgb, var(--dsw-static-spatial-gold) 42%, transparent);color:var(--dsw-alias-label-primary);border-radius:12px;flex-direction:column;flex:none;gap:4px;margin:0 0 8px;padding:8px 12px;font-size:12px;line-height:17px;display:flex}.PKtVvq_noticeTitle{font-weight:600}.PKtVvq_noticeReason{color:var(--dsw-static-spatial-gold);overflow-wrap:anywhere;font-family:var(--dsw-font-family-mono,ui-monospace, SFMono-Regular, Menlo, monospace);font-size:11px}.PKtVvq_contactRow{align-items:center;min-height:64px}.PKtVvq_rowMain{flex-direction:column;flex:1;gap:2px;min-width:0;display:flex}.PKtVvq_rowTop{align-items:center;gap:6px;min-width:0;display:flex}.PKtVvq_rowTitleInMain{text-overflow:ellipsis;white-space:nowrap;flex:0 auto;min-width:0;max-width:100%;font-size:14px;font-weight:570;line-height:20px;overflow:hidden}.PKtVvq_trustMark{color:var(--dsw-alias-label-tertiary);flex:none;align-items:center;display:inline-flex}.PKtVvq_trustMark[data-state=VERIFIED]{color:var(--dsw-alias-state-success-primary)}.PKtVvq_trustMark[data-state=TEST]{color:var(--dsw-static-spatial-gold)}.PKtVvq_trustMark[data-state=UNBOUND]{color:var(--dsw-static-spatial-blue)}.PKtVvq_trustMark[data-state=FOREIGN]{color:var(--dsw-alias-state-error-primary,#d9534f)}.PKtVvq_unreadDot{background:var(--dsw-alias-state-success-primary);border-radius:999px;flex:none;width:7px;height:7px}.PKtVvq_pinMark{color:var(--dsw-static-spatial-violet);flex:none;align-items:center;display:inline-flex}.PKtVvq_time{color:var(--dsw-alias-label-tertiary);flex:none;margin-left:auto;font-size:12px;line-height:20px}.PKtVvq_rowPreview{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:18px;overflow:hidden}.PKtVvq_badge{letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;border:1px solid;flex:0 auto;align-items:center;gap:3px;min-width:0;height:18px;padding:0 6px;font-size:10px;font-weight:600;line-height:1;display:inline-flex}.PKtVvq_badge[data-state=VERIFIED]{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 16%, transparent);border-radius:9px}.PKtVvq_badge[data-state=TEST]{color:var(--dsw-static-spatial-gold);background:color-mix(in srgb, var(--dsw-static-spatial-gold) 12%, transparent);border-style:dashed;border-radius:4px}.PKtVvq_badge[data-state=UNBOUND]{color:var(--dsw-static-spatial-blue);background:color-mix(in srgb, var(--dsw-static-spatial-blue) 10%, transparent);border-style:dotted;border-radius:9px}.PKtVvq_badge[data-state=FOREIGN]{color:var(--dsw-alias-state-error-primary,#d9534f);background:repeating-linear-gradient(135deg, color-mix(in srgb, var(--dsw-alias-state-error-primary,#d9534f) 22%, transparent) 0 4px, transparent 4px 8px);border-radius:2px}.PKtVvq_badgeWord{text-overflow:ellipsis;white-space:nowrap;min-width:0;display:inline-block;overflow:hidden}.PKtVvq_sas{border:1px solid color-mix(in srgb, var(--dsw-static-spatial-violet) 40%, transparent);background:color-mix(in srgb, var(--dsw-static-spatial-violet) 10%, transparent);border-radius:10px;align-items:flex-start;gap:6px;max-width:100%;margin-top:4px;padding:5px 8px;display:flex}.PKtVvq_sasAbsent{border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;align-items:flex-start;gap:6px;max-width:100%;margin-top:4px;padding:5px 8px;display:flex}.PKtVvq_sasGlyph{color:var(--dsw-static-spatial-violet);flex:none;margin-top:2px;display:inline-flex}.PKtVvq_sasAbsentGlyph{color:var(--dsw-alias-label-tertiary);flex:none;margin-top:2px;display:inline-flex}.PKtVvq_sasBody{flex-direction:column;gap:1px;min-width:0;display:flex}.PKtVvq_sasLabel{letter-spacing:.05em;text-transform:uppercase;color:var(--dsw-static-spatial-violet);font-size:10px;line-height:14px}.PKtVvq_sasDigits{letter-spacing:.12em;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;font-size:17px;font-weight:650;line-height:22px}.PKtVvq_sasHint,.PKtVvq_sasAbsentText{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:15px}.PKtVvq_receiptMark{color:var(--dsw-alias-label-tertiary);align-items:center;margin-top:2px;display:inline-flex}.PKtVvq_receiptMark[data-receipt=pending]{color:var(--dsw-alias-label-tertiary)}.PKtVvq_receiptMark[data-receipt=delivered]{color:var(--dsw-alias-state-success-primary)}.PKtVvq_receiptMark[data-receipt=partial]{color:var(--dsw-static-spatial-gold)}.PKtVvq_receiptMark[data-receipt=refused]{color:var(--dsw-alias-state-error-primary,#d9534f)}.PKtVvq_threadNotice{color:var(--dsw-alias-label-tertiary);margin:0;padding:6px 8px;font-size:12px;line-height:17px}.PKtVvq_searchRow{flex:none;justify-content:flex-end;align-items:center;gap:6px;margin-bottom:6px;padding:0 4px;display:flex}.PKtVvq_searchInput{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);min-width:0;height:28px;color:var(--dsw-alias-label-primary);font:inherit;background:0 0;border-radius:9px;outline:none;flex:1;padding:0 10px;font-size:13px}.PKtVvq_rows{scrollbar-gutter:stable;flex-direction:column;flex:1;gap:8px;min-height:0;padding-bottom:12px;display:flex;overflow-y:auto}.PKtVvq_personRow{box-sizing:border-box;border:1px solid color-mix(in srgb, var(--dsw-static-spatial-blue) 32%, transparent);width:calc(100% - 4px);min-height:64px;color:var(--dsw-alias-label-primary);cursor:pointer;user-select:none;transition:transform .2s var(--ds-ease-in-out), border-color .25s var(--ds-ease-in-out), box-shadow .25s var(--ds-ease-in-out);background:0 0;border-radius:14px;align-items:center;gap:10px;margin-inline:2px;padding:10px 16px;display:flex}.PKtVvq_personRow:hover{transform:translate(3px)}.PKtVvq_personRow:focus-visible{border-color:color-mix(in srgb, var(--dsw-static-spatial-blue) 58%, transparent);box-shadow:0 0 14px color-mix(in srgb, var(--dsw-static-spatial-blue) 14%, transparent);outline:none}.PKtVvq_rowActions{flex:none;align-items:center;gap:2px;display:none}.PKtVvq_personRow:hover .PKtVvq_rowActions,.PKtVvq_personRow:focus-within .PKtVvq_rowActions{display:inline-flex}.PKtVvq_personRow:hover .PKtVvq_time,.PKtVvq_personRow:focus-within .PKtVvq_time{display:none}.PKtVvq_avatar{background:color-mix(in srgb, var(--dsw-static-spatial-blue) 24%, transparent);width:26px;height:26px;color:var(--dsw-alias-label-primary);border-radius:999px;flex:none;place-items:center;font-size:12px;font-weight:600;display:grid}.PKtVvq_listEmpty{color:var(--dsw-alias-label-tertiary);margin:0;padding:8px;font-size:13px;line-height:19px}.PKtVvq_visuallyHidden{clip:rect(0 0 0 0);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}.PKtVvq_thread{box-sizing:border-box;width:min(100%,720px);min-height:0;padding-top:calc(var(--dsh-hot-corner-size,74px) * .4);flex-direction:column;flex:1;gap:12px;margin:0 auto;display:flex}.PKtVvq_threadHeader{border:1px solid var(--dsw-alias-border-l2);box-sizing:border-box;background:0 0;border-radius:16px;flex:none;align-items:center;gap:8px;min-height:50px;padding:8px 12px;display:flex}@container (width<=868px){.PKtVvq_threadHeader{padding-inline:74px}}.PKtVvq_headerTail{flex:0 auto;align-items:center;gap:8px;min-width:0;display:inline-flex}.PKtVvq_chip{height:22px;color:var(--dsw-static-spatial-gold);font:inherit;cursor:pointer;white-space:nowrap;background:0 0;border:1px solid;border-radius:11px;flex:none;align-items:center;gap:4px;padding:0 9px;font-size:11px;font-weight:600;line-height:1;display:inline-flex}.PKtVvq_chip[data-trust-chip=FOREIGN]{color:var(--dsw-alias-state-error-primary,#d9534f);border-style:dashed}.PKtVvq_chip[data-trust-chip=UNBOUND]{color:var(--dsw-static-spatial-blue);border-style:dotted}.PKtVvq_chipWord{display:inline-block}.PKtVvq_threadTitle{text-align:center;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;font-size:14px;font-weight:600;line-height:20px;overflow:hidden}.PKtVvq_messages{flex-direction:column;flex:1;gap:12px;min-height:0;padding:4px 8px;display:flex;overflow-y:auto}.PKtVvq_msgThem{border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent);border-radius:22px;align-self:flex-start;max-width:min(525px,82%);margin:0;padding:10px 16px;font-size:16px;line-height:24px}.PKtVvq_msgMe{background:var(--dsw-specific-bubble);border-radius:22px;align-self:flex-end;max-width:min(525px,82%);margin:0;padding:10px 16px;font-size:16px;line-height:24px}.PKtVvq_bubbleText{white-space:pre-wrap;overflow-wrap:anywhere;display:block}.PKtVvq_composerCard{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2-darkmode-thin);background:var(--dsw-specific-input-major);width:100%;box-shadow:var(--dsw-shadow-lv2);border-radius:22px;flex-direction:column;flex:none;gap:10px;padding:12px 12px 10px;display:flex}.PKtVvq_composerCard textarea{min-height:24px;max-height:120px;color:var(--dsw-alias-label-primary);font:inherit;resize:none;background:0 0;border:0;outline:none;padding:0 4px;font-size:16px;line-height:24px}.PKtVvq_composerRow{justify-content:flex-end;display:flex}.PKtVvq_sendCircle{background:var(--dsw-alias-button-info-fill);width:34px;height:34px;color:var(--dsw-alias-label-primary,#fff);cursor:pointer;border:none;border-radius:999px;flex:none;place-items:center;transition:background-color .1s;display:grid}.PKtVvq_sendCircle:hover:not(:disabled){background:var(--dsw-alias-button-info-hover)}.PKtVvq_sendCircle:disabled{opacity:.4;cursor:default}.PKtVvq_sheetBackdrop{z-index:2;box-sizing:border-box;background:color-mix(in srgb, var(--dsw-alias-label-primary) 34%, transparent);justify-content:center;align-items:flex-end;padding:10px;display:flex;position:absolute;inset:0}.PKtVvq_sheet{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-input-major);width:min(100%,520px);min-width:0;max-height:100%;box-shadow:var(--dsw-shadow-lv2);color:var(--dsw-alias-label-primary);border-radius:18px;flex-direction:column;padding:12px 14px 14px;display:flex}.PKtVvq_sheetHeader{flex:none;align-items:center;gap:8px;min-width:0;margin-bottom:8px;display:flex}.PKtVvq_sheetTitle{text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;margin:0;font-size:15px;font-weight:600;line-height:21px;overflow:hidden}.PKtVvq_sheetBody{flex-direction:column;gap:8px;min-height:0;display:flex;overflow-y:auto}.PKtVvq_sheetBadgeRow{align-items:center;gap:8px;display:flex}.PKtVvq_sheetSentence{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px;line-height:17px}.PKtVvq_sheetRow{flex-direction:column;gap:2px;min-width:0;display:flex}.PKtVvq_sheetLabel{color:var(--dsw-alias-label-tertiary);letter-spacing:.05em;text-transform:uppercase;font-size:10px;line-height:14px}.PKtVvq_sheetValue{color:var(--dsw-alias-label-primary);overflow-wrap:anywhere;font-size:13px;line-height:18px}.PKtVvq_npub{color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family-mono,ui-monospace, SFMono-Regular, Menlo, monospace);overflow-wrap:anywhere;font-size:11px;line-height:16px}.PKtVvq_menuItem,.PKtVvq_menuItemActive{width:100%}.PKtVvq_menuCopy{text-align:right;flex-direction:column;gap:2px;min-width:0;display:flex}.PKtVvq_menuCopy strong{text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:570;line-height:20px;overflow:hidden}.PKtVvq_menuCopy span{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:17px;overflow:hidden}@container (width<=560px){.PKtVvq_brandRow{flex-wrap:wrap;row-gap:4px;height:auto;min-height:60px;padding-right:4px}.PKtVvq_brandActions{padding-right:calc(var(--dsh-hot-corner-size,74px) + var(--dsh-hot-corner-gutter,10px) - var(--dsh-messages-inline-padding));flex:100%;justify-content:flex-end}.PKtVvq_threadHeader{flex-wrap:wrap;row-gap:6px;padding-inline:4px 74px}.PKtVvq_threadTitle{text-align:left}.PKtVvq_headerTail{flex:100%;justify-content:flex-end}}.PKtVvq_verifyConfirm{gap:var(--dsh-spatial-gap,6px);margin-top:var(--dsh-spatial-gap,6px);flex-direction:column;display:flex}.PKtVvq_verifyConfirmButton{font:inherit;text-align:start;cursor:pointer;border:1px solid var(--dsw-alias-border-l2,#3a3a3c);background:var(--dsw-alias-interactive-bg-hover,#24282e);color:var(--dsw-alias-label-primary,#e8eaed);border-radius:8px;padding:10px 12px;font-weight:600}.PKtVvq_verifyConfirmNote{color:var(--dsw-alias-label-secondary,#b8bcc4);margin:0;line-height:17px}.PKtVvq_addHint{margin:0 0 var(--dsh-spatial-gap,8px);color:var(--dsw-alias-label-secondary,#b8bcc4);line-height:18px}.PKtVvq_addForm{gap:var(--dsh-spatial-gap,8px);flex-direction:column;display:flex}.PKtVvq_addField{flex-direction:column;gap:4px;display:flex}.PKtVvq_addLabel{color:var(--dsw-alias-label-secondary,#b8bcc4)}.PKtVvq_addInput{font:inherit;font-family:var(--dsw-font-family-mono,ui-monospace, SFMono-Regular, Menlo, monospace);border:1px solid var(--dsw-alias-border-l2,#3a3a3c);background:var(--dsw-alias-bg-layer-1,#17181a);color:var(--dsw-alias-label-primary,#e8eaed);border-radius:8px;padding:8px 10px}.PKtVvq_addSubmit{font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2,#3a3a3c);background:var(--dsw-alias-interactive-bg-hover,#24282e);color:var(--dsw-alias-label-primary,#e8eaed);border-radius:8px;padding:9px 12px;font-weight:600}.PKtVvq_addSubmit:disabled{cursor:default;color:var(--dsw-alias-label-tertiary,#8b9099)}.PKtVvq_addRefusal{margin:var(--dsh-spatial-gap,8px) 0 0;color:var(--dsw-alias-label-error,#f2555a);line-height:18px}.PKtVvq_addReason{font-family:var(--dsw-font-family-mono,ui-monospace, SFMono-Regular, Menlo, monospace)}.PKtVvq_addAdded{margin:var(--dsh-spatial-gap,8px) 0 0;color:var(--dsw-alias-label-secondary,#b8bcc4);line-height:18px}";
		const tagId = "@aukora/face-messages/Messages.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@aukora/face-messages";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var Messages_module_css_default = {
			"actions": "PKtVvq_actions",
			"addAdded": "PKtVvq_addAdded",
			"addField": "PKtVvq_addField",
			"addForm": "PKtVvq_addForm",
			"addHint": "PKtVvq_addHint",
			"addInput": "PKtVvq_addInput",
			"addLabel": "PKtVvq_addLabel",
			"addReason": "PKtVvq_addReason",
			"addRefusal": "PKtVvq_addRefusal",
			"addSubmit": "PKtVvq_addSubmit",
			"archiveAction": "PKtVvq_archiveAction",
			"avatar": "PKtVvq_avatar",
			"badge": "PKtVvq_badge",
			"badgeWord": "PKtVvq_badgeWord",
			"brandActions": "PKtVvq_brandActions",
			"brandMark": "PKtVvq_brandMark",
			"brandName": "PKtVvq_brandName",
			"brandRow": "PKtVvq_brandRow",
			"bubbleText": "PKtVvq_bubbleText",
			"chip": "PKtVvq_chip",
			"chipWord": "PKtVvq_chipWord",
			"composerCard": "PKtVvq_composerCard",
			"composerRow": "PKtVvq_composerRow",
			"contactRow": "PKtVvq_contactRow",
			"headerTail": "PKtVvq_headerTail",
			"iconButton": "PKtVvq_iconButton",
			"lane": "PKtVvq_lane",
			"listEmpty": "PKtVvq_listEmpty",
			"menuCopy": "PKtVvq_menuCopy",
			"menuItem": "PKtVvq_menuItem",
			"menuItemActive": "PKtVvq_menuItemActive",
			"messages": "PKtVvq_messages",
			"msgMe": "PKtVvq_msgMe",
			"msgThem": "PKtVvq_msgThem",
			"notice": "PKtVvq_notice",
			"noticeReason": "PKtVvq_noticeReason",
			"noticeTitle": "PKtVvq_noticeTitle",
			"npub": "PKtVvq_npub",
			"personRow": "PKtVvq_personRow",
			"pinAction": "PKtVvq_pinAction",
			"pinMark": "PKtVvq_pinMark",
			"posture": "PKtVvq_posture",
			"receiptMark": "PKtVvq_receiptMark",
			"rowActions": "PKtVvq_rowActions",
			"rowMain": "PKtVvq_rowMain",
			"rowPreview": "PKtVvq_rowPreview",
			"rowTitleInMain": "PKtVvq_rowTitleInMain",
			"rowTop": "PKtVvq_rowTop",
			"rows": "PKtVvq_rows",
			"sas": "PKtVvq_sas",
			"sasAbsent": "PKtVvq_sasAbsent",
			"sasAbsentGlyph": "PKtVvq_sasAbsentGlyph",
			"sasAbsentText": "PKtVvq_sasAbsentText",
			"sasBody": "PKtVvq_sasBody",
			"sasDigits": "PKtVvq_sasDigits",
			"sasGlyph": "PKtVvq_sasGlyph",
			"sasHint": "PKtVvq_sasHint",
			"sasLabel": "PKtVvq_sasLabel",
			"searchInput": "PKtVvq_searchInput",
			"searchRow": "PKtVvq_searchRow",
			"sendCircle": "PKtVvq_sendCircle",
			"sheet": "PKtVvq_sheet",
			"sheetBackdrop": "PKtVvq_sheetBackdrop",
			"sheetBadgeRow": "PKtVvq_sheetBadgeRow",
			"sheetBody": "PKtVvq_sheetBody",
			"sheetHeader": "PKtVvq_sheetHeader",
			"sheetLabel": "PKtVvq_sheetLabel",
			"sheetRow": "PKtVvq_sheetRow",
			"sheetSentence": "PKtVvq_sheetSentence",
			"sheetTitle": "PKtVvq_sheetTitle",
			"sheetValue": "PKtVvq_sheetValue",
			"surface": "PKtVvq_surface",
			"thread": "PKtVvq_thread",
			"threadHeader": "PKtVvq_threadHeader",
			"threadNotice": "PKtVvq_threadNotice",
			"threadTitle": "PKtVvq_threadTitle",
			"time": "PKtVvq_time",
			"trustMark": "PKtVvq_trustMark",
			"unreadAction": "PKtVvq_unreadAction",
			"unreadDot": "PKtVvq_unreadDot",
			"verifyConfirm": "PKtVvq_verifyConfirm",
			"verifyConfirmButton": "PKtVvq_verifyConfirmButton",
			"verifyConfirmNote": "PKtVvq_verifyConfirmNote",
			"visuallyHidden": "PKtVvq_visuallyHidden"
		};
		//#endregion
		//#region src/client/MessagesMenu.tsx
		/** Text-only Messages entry in the shell's triangle Aukora Apps menu. */
		/**
		* Open the standalone Messages preview.
		* @param props - Apps-menu owner share and localized copy.
		* @returns the Messages launcher button.
		*/
		function MessagesMenu({ activeSurface, openSurface, t }) {
			const active = activeSurface === "messages";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				"data-messages-launcher": true,
				className: clsx(Messages_module_css_default.menuItem, active && Messages_module_css_default.menuItemActive),
				"aria-current": active ? "page" : void 0,
				onClick: () => {
					openSurface("messages");
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: Messages_module_css_default.menuCopy,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("menu.title") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("menu.description") })]
				})
			});
		}
		//#endregion
		//#region src/client/add-contact.ts
		/**
		* WHAT A PERSON MAY TYPE INTO THE ADD-CONTACT SHEET, CHECKED BEFORE ANYTHING IS ASKED OF THE HOST.
		*
		* Three fields, three checks, and each one refuses with the HOST'S OWN CODE rather than a new vocabulary:
		* a client that invented `client.bad-npub` would put two names on one condition and the sheet's inline refusal
		* would no longer match what the route says when it refuses the same thing (`add-contact-route.ts`).
		*
		* WHY BECH32 IS DECODED HERE RATHER THAN TRUSTED TO `startsWith('npub1')`. An npub is a bech32 string with a
		* BIP-173 checksum, and its whole purpose is that a TYPO IS DETECTABLE. A prefix test accepts
		* `npub1thisisnotakey`, and the person then waits for a round trip to learn what their own screen could have
		* told them. The polymod below is the reference algorithm, not an approximation of it.
		*
		* THE CASING RULE IS PART OF BECH32, NOT A STYLE CHOICE: mixed case is INVALID, while all-upper and all-lower
		* are both valid, and an npub is canonically lower. So `NPUB1…` is accepted-and-lowered and `Npub1…` is refused.
		*/
		/** The bech32 character set, in value order. */
		const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
		/** The generators BIP-173's polymod multiplies by. */
		const GENERATOR = [
			996825010,
			642813549,
			513874426,
			1027748829,
			705979059
		];
		/** A bech32 string is at most 90 characters; an npub is exactly 63. */
		const NPUB_LENGTH = 63;
		/** The friend's controller key is a raw secp256k1 x-coordinate: 32 bytes, written as lower-case hex. */
		const CONTROLLER_LENGTH = 64;
		/** The refusal codes, which are the ROUTE'S (see the module header). */
		const ADD_REFUSE = Object.freeze({
			NPUB: "messages:add-npub-invalid",
			CONTROLLER: "messages:add-controller-invalid",
			NAME: "messages:add-name-invalid"
		});
		/**
		* The BIP-173 checksum step.
		* @param values - the 5-bit values to fold, including the checksum.
		* @returns the polymod residue; 1 means a valid bech32 checksum.
		*/
		function polymod(values) {
			let checksum = 1;
			for (const value of values) {
				const top = checksum >> 25;
				checksum = (checksum & 33554431) << 5 ^ value;
				for (let bit = 0; bit < 5; bit += 1) {
					const generator = GENERATOR[bit] ?? 0;
					if ((top >> bit & 1) === 1) checksum ^= generator;
				}
			}
			return checksum;
		}
		/**
		* The values a checksum is computed over: the human-readable part, a separator, then the data.
		* @param hrp - the human-readable part.
		* @returns the expanded values.
		*/
		function expand(hrp) {
			const high = [];
			const low = [];
			for (const character of hrp) {
				const code = character.charCodeAt(0);
				high.push(code >> 5);
				low.push(code & 31);
			}
			return [
				...high,
				0,
				...low
			];
		}
		/**
		* Check one npub.
		*
		* EVERY FAILURE IS THE SAME CODE, deliberately: which character was wrong is not a thing to explain to a
		* person, and a finer refusal vocabulary would leak the checksum's structure for no benefit.
		* @param value - what was typed.
		* @returns the canonical lower-case npub, or the refusal code.
		*/
		function checkNpub(value) {
			const raw = typeof value === "string" ? value.trim() : "";
			if (raw.length === 0) return {
				ok: false,
				reason: ADD_REFUSE.NPUB,
				detail: "no npub was given"
			};
			const lower = raw.toLowerCase();
			if (raw !== lower && raw !== raw.toUpperCase()) return {
				ok: false,
				reason: ADD_REFUSE.NPUB,
				detail: "mixed case is not a valid bech32 string"
			};
			if (lower.length !== NPUB_LENGTH) return {
				ok: false,
				reason: ADD_REFUSE.NPUB,
				detail: `an npub is ${String(NPUB_LENGTH)} characters; this is ${String(lower.length)}`
			};
			const separator = lower.lastIndexOf("1");
			const hrp = lower.slice(0, separator);
			const data = lower.slice(separator + 1);
			if (separator < 1 || data.length < 6) return {
				ok: false,
				reason: ADD_REFUSE.NPUB,
				detail: "the string has no readable part before its data"
			};
			if (hrp !== "npub") return {
				ok: false,
				reason: ADD_REFUSE.NPUB,
				detail: `this is a bech32 string for "${hrp}", not an npub`
			};
			const values = [];
			for (const character of data) {
				const index = CHARSET.indexOf(character);
				if (index === -1) return {
					ok: false,
					reason: ADD_REFUSE.NPUB,
					detail: `"${character}" is not a bech32 character`
				};
				values.push(index);
			}
			if (polymod([...expand(hrp), ...values]) !== 1) return {
				ok: false,
				reason: ADD_REFUSE.NPUB,
				detail: "the checksum does not match, so a character is wrong"
			};
			return {
				ok: true,
				npub: lower
			};
		}
		/**
		* Check the friend's controller key: the raw public key the contact record is written against.
		* @param value - what was typed.
		* @returns the canonical lower-case key, or the refusal code.
		*/
		function checkController(value) {
			const raw = typeof value === "string" ? value.trim() : "";
			if (raw.length === 0) return {
				ok: false,
				reason: ADD_REFUSE.CONTROLLER,
				detail: "no controller key was given"
			};
			if (!/^[0-9a-f]{64}$/u.test(raw)) return {
				ok: false,
				reason: ADD_REFUSE.CONTROLLER,
				detail: raw.length === CONTROLLER_LENGTH ? "the key is 64 characters but not lower-case hex" : `a controller key is ${String(CONTROLLER_LENGTH)} lower-case hex characters; this is ${String(raw.length)}`
			};
			return {
				ok: true,
				controller: raw
			};
		}
		/**
		* Check the name.
		* @param value - what was typed.
		* @returns the trimmed name, or the refusal code.
		*/
		function checkName(value) {
			const raw = typeof value === "string" ? value.trim() : "";
			if (raw.length === 0) return {
				ok: false,
				reason: ADD_REFUSE.NAME,
				detail: "a contact needs a name to be shown under"
			};
			if (raw.length > 120) return {
				ok: false,
				reason: ADD_REFUSE.NAME,
				detail: `a name may be up to ${String(120)} characters`
			};
			return {
				ok: true,
				name: raw
			};
		}
		/**
		* Check all three fields at once.
		* @param draft - the three fields, as typed.
		* @returns the body the route expects, or the FIRST refusal in field order.
		*/
		function checkAddContact(draft) {
			const name = checkName(draft?.name);
			if (name.ok !== true) return name;
			const npub = checkNpub(draft?.npub);
			if (npub.ok !== true) return npub;
			const controller = checkController(draft?.controller);
			if (controller.ok !== true) return controller;
			return {
				ok: true,
				body: {
					npub: npub.npub,
					controller: controller.controller,
					name: name.name
				}
			};
		}
		//#endregion
		//#region src/messages-route.ts
		/**
		* The Messages face's wire contract, written once for both ends.
		*
		* WHY ONE MODULE. The host registers these routes and the screen fetches them. If each half
		* spelled its own path, a rename on one side would leave the other fetching a route nobody
		* serves; if each half spelled its own refusal vocabulary, a refusal would reach the screen
		* as an unrecognised shape and be shown as a generic failure instead of the named reason the
		* host chose. Both halves import this file, and nothing here touches the filesystem, the
		* environment or the DOM, so the browser bundle can carry it and a court can exercise every
		* parser without starting a server. It mirrors `documents-route.ts` deliberately: same
		* endpoint-constant shape, same exact-key parsers, same refusal body.
		*
		* THREE ROUTES, AND TWO OF THEM WRITE — ONE FILE, FOR ONE MESSAGE THAT REALLY EXISTS. The listing
		* only reads. The thread opens the gift wraps a relay served and the send route composes a NIP-17
		* message and hands it to the relays; both then write ONE EVIDENCE RECORD per gift wrap that
		* actually exists: the send for the wrap a relay accepted, the thread for each wrap it opened and
		* attributed to the requested sender. The record is the six-field
		* `aukora:nostr-message-evidence:v1` document `plugins/aukora-nostr/lib/evidence.mjs` produces, and
		* nothing else on this machine is written — not the contacts file, not a key. The only addresses
		* either route opens are relays from this face's own configured list.
		*
		* A RECORD THAT COULD NOT BE WRITTEN NEVER DESTROYS THE MESSAGE, AND IS NEVER SILENT. The message is
		* the point and the record is the evidence of it, so a failed write leaves the send or the read
		* exactly as it was and is reported in the answer's own `evidence` / `evidenceRefusal` pair. A send
		* no relay accepted is `not-recorded` too, under a different code: there is no published wrap to be
		* evidence of, which is a different fact from a record that could not be written.
		*
		* ONE MESSAGE IS TWO COPIES, AND THE TWO CAN LAND DIFFERENTLY. NIP-17 wraps a copy to each recipient
		* AND one to the sender, so a single send hands two gift wraps to the relays and either of them can
		* be refused on its own. A flat `accepted` list cannot state that: it collapses "your friend has it"
		* and "only your own copy was kept" into the same word, and `ok: true` reads as the first when it may
		* be the second. So a send answer carries `copies` BESIDE the aggregate — one outcome per copy, each
		* naming WHICH copy it is (`recipient` or `self`), that wrap's own `eventId`, whether relays took it,
		* which relays took it, and, when it was refused, the named code for why. `ok` and `accepted` stay
		* exactly what they were and are derived from those same outcomes, so nothing that reads the old
		* fields reads a different answer than it did before.
		*
		* AND THE RECORDS FOLLOW THE COPIES, ONE RECORD PER ACCEPTED COPY. Each accepted copy is a published
		* event of its own, named by its own id, so each is evidence of itself; a refused copy was never
		* published and is owed NO record, because a record for a message that never left is the false claim
		* this whole lane exists to remove. The aggregate `evidence` therefore means "every copy a relay
		* accepted has a record" — a refused copy is not counted against it, and its own outcome in `copies`
		* carries the code that says why it was never published.
		*
		* THE FOUR CONTACT STATES ARE THE HEART OF THE LISTING. A npub on its own proves nothing;
		* `plugins/aukora-nostr/lib/contact.mjs` owns the meaning of each state and
		* `contacts-store.ts` is the only thing that produces them. This file only carries the bytes,
		* and it carries them with the SAS INCLUDED ONLY WHEN A BINDING VERIFIED: `sas` is either a
		* two-field object or null, in the listing and in the thread alike, and the parsers below
		* refuse a body that breaks that pairing rather than rendering it.
		*
		* THE REFUSAL VOCABULARY IS CLOSED AND FINITE, one name per condition and never a generic
		* failure. The reader's five were:
		*
		*   messages:contacts-state-missing   no contacts file at `<stateDir>/nostr/contacts.json`.
		*   messages:contacts-unparseable     the file is there and is not JSON.
		*   messages:contacts-domain-unknown  JSON, and its `domain` is not the v1 domain.
		*   messages:contact-malformed        the domain is right and one entry is not.
		*   messages:no-controller-record     no controller record to verify anything against, so not
		*                                     one contact can be resolved.
		*   messages:aumlok-not-linked        no Aumlok phrase is linked on this install yet, so there is
		*                                     no controller directory at all: link it first.
		*   messages:unreadable-state         the contacts file exists and cannot be read.
		*   messages:key-missing              no Nostr key yet; READING never mints one.
		*   messages:key-unreadable           the key file carries no usable secret.
		*
		* and the wire adds:
		*
		*   messages:malformed-request        the request is not the shape this face takes — including
		*                                     a thread asked for an npub that is not a contact.
		*   messages:request-body-unreadable  a send body arrived and is not JSON, or is too large.
		*   messages:no-such-route            the request named no endpoint this face serves.
		*   messages:state-directory-named     the request tried to name the state directory or the
		*                                     controller record. It cannot: this face reads ONE root,
		*                                     resolved by the host from its own configuration, and a
		*                                     request that names another is refused rather than obeyed.
		*   messages:text-empty               a send with nothing in it.
		*   messages:text-too-long            a send over {@link MESSAGES_TEXT_MAX_BYTES}.
		*   messages:relays-unreachable       no relay answered a read at all.
		*   messages:nobody-accepted          the relays were reached and none took the message.
		*   messages:reads-unavailable        the relay read itself failed before it could answer.
		*   messages:sender-unproven          wraps arrived for this node and NOT ONE of them could be
		*                                     opened and attributed to the contact asked about. Named
		*                                     rather than answered `messages: []`, because "nobody wrote
		*                                     to you" and "somebody did and I cannot prove who" are
		*                                     opposite facts about a conversation.
		*   messages:send-timeout             the SEND route's own budget expired before the relays
		*                                     settled. See {@link MESSAGES_SEND_BUDGET_MS}.
		*   messages:thread-timeout           the THREAD route's own budget expired before the relays
		*                                     settled. See {@link MESSAGES_THREAD_BUDGET_MS}.
		*
		* and `messages:unreadable-state` covers one more condition than its first reader did: besides a
		* contacts file that cannot be read, it is the answer when the face's OWN ENGINE throws — the
		* loaded composer refusing a message, say. An exception escaping a handler is not an answer at all
		* (the harness answers a bare 400 and the screen reads a broken transport), so every throw inside a
		* route becomes this name instead.
		*
		* AND ONE FIELD THAT IS NOT A REFUSAL AT ALL. `evidence` has THREE outcomes — `recorded`,
		* `not-recorded` and `none` — with the named reason in `evidenceRefusal` for the last two, and it
		* rides on a SUCCESSFUL answer rather than replacing one: a message that was published and a record
		* that was not written are two facts, and the second must not turn the first into a failure.
		*
		* THE THREE ARE THREE FACTS AND NONE OF THEM IS VACUOUS. `recorded` means a record exists for at
		* least one opened wrap, and never means anything else. `not-recorded` means a record was OWED for
		* an opened wrap and could not be written. `none` is the thread that opened NO wrap at all — an
		* empty conversation — where no record was owed, so `not-recorded` would invent a failure that
		* never happened and `recorded` would claim evidence nobody holds. Its reasons therefore live
		* outside {@link MESSAGES_REFUSAL_REASONS} — `messages:evidence-no-publish` for a send no relay
		* took, which has no published wrap to be evidence of, `messages:evidence-no-wrap-opened` for a
		* thread that opened no wrap at all, and `messages:evidence-module-absent` for a deployment whose
		* nostr tree carries no evidence module — alongside the module's own `nostr-evidence-unwritable`
		* when the record itself could not be written to disk.
		*
		* `messages:nobody-accepted` and `messages:relays-unreachable` are kept apart on purpose: the
		* first means every relay was reached and declined, the second means none was reached. A person
		* who is told "nobody took it" retries later; one told "we could not reach anybody" checks the
		* network. Collapsing them would make the face's one honest sentence about a failed send
		* useless.
		*
		* @module @aukora/face-messages/route
		*/
		/** The contacts listing. One exact route, GET only. */
		const MESSAGES_CONTACTS_ENDPOINT = "/aukora-messages/contacts.json";
		/** The conversation with one contact. GET, and read-only: it opens wraps and reports. */
		const MESSAGES_THREAD_ENDPOINT = "/aukora-messages/thread";
		/**
		* Compose and publish one NIP-17 message. POST, and A MUTATING ROUTE IN THIS FACE — no longer the
		* only one: `/aukora-messages/add-contact` writes `contacts.json`. That one MUTATES A LIST rather
		* than publishing to a relay, so the two are not alike; they are alike in being the only two
		* routes here through which a request can change something.
		*
		* It may do exactly two things: compose a message with this node's own key and hand it to the
		* relays. It cannot write the contacts file, cannot touch a key file, and cannot fetch an
		* arbitrary URL — the only address it ever opens is a relay from its own configured list.
		*/
		const MESSAGES_SEND_ENDPOINT = "/aukora-messages/send";
		/** Where the Confirm button POSTs: the backend asks the signer, verifies, and stores. */
		const MESSAGES_CONFIRM_CONTACT_ENDPOINT = "/aukora-messages/confirm-contact";
		/** Every state, in the order the design names them. */
		const MESSAGES_WIRE_CONTACT_STATES = [
			"VERIFIED",
			"BOUND",
			"TEST",
			"UNBOUND",
			"FOREIGN"
		];
		/** The reader's refusals: the ones a node's own files produce. */
		const MESSAGES_STORE_REFUSALS = [
			"messages:contacts-state-missing",
			"messages:contacts-unparseable",
			"messages:contacts-domain-unknown",
			"messages:contact-malformed",
			"messages:no-controller-record",
			"messages:aumlok-not-linked",
			"messages:unreadable-state",
			"messages:key-missing",
			"messages:key-unreadable",
			"messages:contact-peer-key-malformed"
		];
		/** The wire's own refusals: the ones a caller can earn without any file being involved. */
		const MESSAGES_WIRE_REFUSALS = [
			"messages:malformed-request",
			"messages:request-body-unreadable",
			"messages:no-such-route",
			"messages:state-directory-named",
			"messages:text-empty",
			"messages:text-too-long",
			"messages:relays-unreachable",
			"messages:nobody-accepted",
			"messages:reads-unavailable",
			"messages:sender-unproven",
			"messages:send-timeout",
			"messages:thread-timeout"
		];
		/** Every refusal reason, reader-side and wire-side. */
		const MESSAGES_REFUSAL_REASONS = [...MESSAGES_STORE_REFUSALS, ...MESSAGES_WIRE_REFUSALS];
		/** All three outcomes, so a parser and a caller can assert the set is closed. */
		const MESSAGES_EVIDENCE_OUTCOMES = [
			"recorded",
			"not-recorded",
			"none"
		];
		/**
		* A thread that opened no wrap has nothing to record and nothing it FAILED to record.
		*
		* The only reason `none` ever carries, and the reason `none` is neither of the other two outcomes:
		* no wrap was opened, so no record was owed, and reporting a failure here would invent one — while
		* `recorded` would claim a record exists for a wrap that was never read.
		*/
		const MESSAGES_EVIDENCE_NO_WRAP_OPENED = "messages:evidence-no-wrap-opened";
		/** Whether a value is one of the three outcomes. */
		function isMessagesEvidenceOutcome(value) {
			return MESSAGES_EVIDENCE_OUTCOMES.some((outcome) => outcome === value);
		}
		/**
		* Validate the evidence pair off the wire.
		*
		* THE PAIR IS CHECKED, NOT TWO FIELDS IN ISOLATION: `recorded` with a reason, `not-recorded`
		* without one, and `none` with anything other than its own code are all refused, because each is a
		* body that would leave a screen unable to say whether the record exists, was owed, or neither.
		* `undefined` means "not a pair this face wrote".
		*
		* WHAT THIS FUNCTION CANNOT SEE is whether the outcome matches the body it rides on — a thread's
		* messages or a send's accepted list. That pairing is asserted by the two body parsers below, at
		* the place each body's own signal is in hand.
		*
		* @param value - the body or entry carrying `evidence` and `evidenceRefusal`.
		* @returns the pair, or undefined when it is not one this face serves.
		*/
		function parseEvidencePair(value) {
			if (!isMessagesEvidenceOutcome(value.evidence)) return void 0;
			if (value.evidence === "recorded") return value.evidenceRefusal === null ? {
				evidence: "recorded",
				evidenceRefusal: null
			} : void 0;
			if (value.evidence === "none") return value.evidenceRefusal === "messages:evidence-no-wrap-opened" ? {
				evidence: "none",
				evidenceRefusal: MESSAGES_EVIDENCE_NO_WRAP_OPENED
			} : void 0;
			return isText(value.evidenceRefusal) ? {
				evidence: "not-recorded",
				evidenceRefusal: value.evidenceRefusal
			} : void 0;
		}
		/** Both roles, so a parser and a caller can assert the set is closed. */
		const MESSAGES_COPY_ROLES = ["recipient", "self"];
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
		/** Whether a value is one of the four states. */
		function isMessagesContactState(value) {
			return MESSAGES_WIRE_CONTACT_STATES.some((state) => state === value);
		}
		/** Whether a value is one of the three binding statuses. */
		function isMessagesContactBinding(value) {
			return value === "absent" || value === "verified" || value === "refused";
		}
		/** Whether a value is one of the named refusal reasons. */
		function isMessagesRefusalReason(value) {
			return MESSAGES_REFUSAL_REASONS.some((reason) => reason === value);
		}
		/** Whether a value is one of the two copy roles. */
		function isMessagesCopyRole(value) {
			return MESSAGES_COPY_ROLES.some((role) => role === value);
		}
		/** Parse one SAS off the wire, or undefined when it is not one this face serves. */
		function parseWireSas(value) {
			if (!isRecord(value)) return void 0;
			if (!hasExactKeys(value, ["digits", "spoken"])) return void 0;
			if (typeof value.digits !== "string" || !/^\d{6}$/u.test(value.digits)) return void 0;
			if (typeof value.spoken !== "string" || !/^\d{3} \d{3}$/u.test(value.spoken)) return void 0;
			return {
				digits: value.digits,
				spoken: value.spoken
			};
		}
		/**
		* Parse one contact entry off the wire.
		* @param value - one element of the listing's `contacts`.
		* @returns the entry, or undefined when it is not what this face serves.
		*/
		function parseMessagesContactEntry(value) {
			if (!isRecord(value)) return void 0;
			if (!hasExactKeys(value, [
				"npub",
				"name",
				"state",
				"reason",
				"subject",
				"sas",
				"binding",
				"peerControllerKey"
			])) return void 0;
			if (!isText(value.npub) || !isText(value.name)) return void 0;
			if (!isMessagesContactState(value.state)) return void 0;
			if (typeof value.peerControllerKey !== "string" || !/^[0-9a-f]{64}$/iu.test(value.peerControllerKey)) return void 0;
			if (typeof value.reason !== "string") return void 0;
			if (value.subject !== null && !isText(value.subject)) return void 0;
			const binding = value.binding;
			if (!isMessagesContactBinding(binding)) return void 0;
			const sas = parseWireSasForBinding(value.sas, binding);
			if (sas === void 0) return void 0;
			return {
				npub: value.npub,
				name: value.name,
				state: value.state,
				reason: value.reason,
				subject: value.subject,
				sas,
				binding,
				peerControllerKey: value.peerControllerKey
			};
		}
		/**
		* The SAS one entry may carry, given what vouched for it.
		*
		* THE WITHHOLDING IS RE-ASSERTED ON THE WIRE, IN BOTH DIRECTIONS. A body claiming a verified
		* binding and NO SAS is refused because that is the one case where the string exists and the
		* screen would have none to show; a body offering a SAS for anything other than a verified
		* binding is refused because that is the mistake this face exists to prevent. Either way the
		* pair is not a pair this face wrote.
		*
		* @param value - the entry's `sas` field.
		* @param binding - the entry's already-validated binding status.
		* @returns the SAS or null, or undefined when the pair is not one this face serves.
		*/
		function parseWireSasForBinding(value, binding) {
			if (binding === "verified") {
				const sas = parseWireSas(value);
				return sas === void 0 ? void 0 : sas;
			}
			return value === null ? null : void 0;
		}
		/**
		* Validate a listing body off the wire.
		* @param value - the parsed JSON body.
		* @returns the body, or undefined when it is not what this face serves.
		*/
		function parseMessagesContactsBody(value) {
			if (!isRecord(value)) return void 0;
			if (!hasExactKeys(value, [
				"status",
				"root",
				"contacts"
			])) return void 0;
			if (value.status !== "ok" || !isText(value.root) || !Array.isArray(value.contacts)) return void 0;
			const contacts = [];
			for (const raw of value.contacts) {
				const entry = parseMessagesContactEntry(raw);
				if (entry === void 0) return void 0;
				contacts.push(entry);
			}
			return {
				status: "ok",
				root: value.root,
				contacts
			};
		}
		/**
		* Validate a listing answer, refusal included, off the wire.
		* @param value - the parsed JSON body.
		* @returns the answer, or undefined when it is neither a listing nor a named refusal.
		*/
		function parseMessagesContactsAnswer(value) {
			if (isRecord(value) && value.status === "refused") return parseMessagesRefusalBody(value);
			return parseMessagesContactsBody(value);
		}
		/**
		* Validate a refusal body off the wire.
		* @param value - the parsed JSON body.
		* @returns the refusal, or undefined when the reason is not one this face defines.
		*/
		function parseMessagesRefusalBody(value) {
			if (!isRecord(value)) return void 0;
			if (!hasExactKeys(value, [
				"status",
				"reason",
				"subject"
			])) return void 0;
			if (value.status !== "refused" || typeof value.subject !== "string") return void 0;
			if (!isMessagesRefusalReason(value.reason)) return void 0;
			return {
				status: "refused",
				reason: value.reason,
				subject: value.subject
			};
		}
		/**
		* Validate one message off the wire.
		* @param value - one element of a thread's `messages`.
		* @returns the message, or undefined when it is not what this face serves.
		*/
		function parseMessagesWireMessage(value) {
			if (!isRecord(value)) return void 0;
			if (!hasExactKeys(value, [
				"id",
				"from",
				"text",
				"at"
			])) return void 0;
			if (!isText(value.id) || !isText(value.text)) return void 0;
			if (value.from !== "them" && value.from !== "me") return void 0;
			if (typeof value.at !== "number" || !Number.isInteger(value.at) || value.at < 0) return void 0;
			return {
				id: value.id,
				from: value.from,
				text: value.text,
				at: value.at
			};
		}
		/**
		* Validate a thread body off the wire.
		* @param value - the parsed JSON body.
		* @returns the body, or undefined when it is not what this face serves.
		*/
		function parseMessagesThreadBody(value) {
			if (!isRecord(value)) return void 0;
			if (!hasExactKeys(value, [
				"status",
				"npub",
				"contactState",
				"sas",
				"messages",
				"answered",
				"evidence",
				"evidenceRefusal"
			])) return void 0;
			if (value.status !== "ok" || !isText(value.npub)) return void 0;
			const state = value.contactState;
			if (state !== "VERIFIED" && state !== "BOUND" && state !== "TEST" && state !== "UNBOUND" && state !== "FOREIGN" && state !== "UNKNOWN") return;
			const parsedSas = parseThreadSas(value.sas, state);
			if (parsedSas === void 0) return void 0;
			const sas = parsedSas;
			if (!Array.isArray(value.messages) || !Array.isArray(value.answered)) return void 0;
			if (value.answered.some((relay) => typeof relay !== "string")) return void 0;
			const evidence = parseEvidencePair(value);
			if (evidence === void 0) return void 0;
			const messages = [];
			for (const raw of value.messages) {
				const message = parseMessagesWireMessage(raw);
				if (message === void 0) return void 0;
				messages.push(message);
			}
			if (evidence.evidence === "none" && messages.length > 0) return void 0;
			if (evidence.evidence === "recorded" && messages.length === 0) return void 0;
			return {
				status: "ok",
				npub: value.npub,
				contactState: state,
				sas,
				messages,
				answered: value.answered,
				...evidence
			};
		}
		/**
		* The SAS a thread may carry, given the contact state it reports.
		*
		* The same pairing rule as the listing, restated for the thread: a SAS exists only for a
		* binding that verified, so VERIFIED, BOUND and TEST may carry one, and those three must.
		*
		* @param value - the thread's `sas` field.
		* @param state - the thread's own contact state.
		* @returns the SAS or null, or undefined when the pair is not one this face serves.
		*/
		function parseThreadSas(value, state) {
			if (value === null) return state === "VERIFIED" || state === "BOUND" || state === "TEST" ? void 0 : null;
			if (state !== "VERIFIED" && state !== "BOUND" && state !== "TEST") return void 0;
			return parseWireSas(value);
		}
		/**
		* Validate ONE per-copy outcome off the wire.
		*
		* THE PAIRING IS ENFORCED IN BOTH DIRECTIONS, and it is the whole reason this is a function rather
		* than three field checks inside the send parser: a copy that claims `accepted` with no relay to
		* show for it names a publish nobody made, and a copy that claims to be refused while naming a relay
		* that took it is the same lie from the other side. Either is refused rather than rendered, and
		* `refusal` is refused as well when it is empty prose — a code is what a caller routes on.
		*
		* @param value - one element of a send body's `copies`.
		* @returns the outcome, or undefined when it is not one this face serves.
		*/
		function parseMessagesCopyOutcome(value) {
			if (!isRecord(value)) return void 0;
			if (!hasExactKeys(value, [
				"copy",
				"eventId",
				"accepted",
				"relays",
				"refusal"
			])) return void 0;
			if (!isMessagesCopyRole(value.copy)) return void 0;
			if (!isText(value.eventId)) return void 0;
			if (typeof value.accepted !== "boolean") return void 0;
			if (!Array.isArray(value.relays) || value.relays.some((relay) => !isText(relay))) return void 0;
			if (value.accepted) {
				if (value.relays.length === 0) return void 0;
				if (value.refusal !== null) return void 0;
				return {
					copy: value.copy,
					eventId: value.eventId,
					accepted: true,
					relays: value.relays,
					refusal: null
				};
			}
			if (value.relays.length > 0) return void 0;
			if (!isText(value.refusal)) return void 0;
			return {
				copy: value.copy,
				eventId: value.eventId,
				accepted: false,
				relays: [],
				refusal: value.refusal
			};
		}
		/**
		* Validate a send answer off the wire, refusal included.
		*
		* @param value - the parsed JSON body.
		* @returns the answer, or undefined when it is not what this face serves.
		*/
		function parseMessagesSendBody(value) {
			if (!isRecord(value)) return void 0;
			if (value.status === "refused") return parseMessagesRefusalBody(value);
			if (!hasExactKeys(value, [
				"status",
				"ok",
				"accepted",
				"copies",
				"verdict",
				"npub",
				"id",
				"at",
				"evidence",
				"evidenceRefusal"
			])) return void 0;
			if (value.status !== "sent" || !isText(value.npub) || !isText(value.id)) return void 0;
			if (typeof value.ok !== "boolean") return void 0;
			if (typeof value.at !== "number" || !Number.isInteger(value.at) || value.at < 0) return void 0;
			if (!Array.isArray(value.accepted) || value.accepted.some((relay) => typeof relay !== "string")) return void 0;
			if (value.verdict !== null && typeof value.verdict !== "string") return void 0;
			const accepted = value.accepted;
			if (value.ok !== accepted.length > 0) return void 0;
			if (value.verdict === null !== accepted.length > 0) return void 0;
			if (!Array.isArray(value.copies) || value.copies.length === 0) return void 0;
			const copies = [];
			const roles = /* @__PURE__ */ new Set();
			for (const raw of value.copies) {
				const copy = parseMessagesCopyOutcome(raw);
				if (copy === void 0) return void 0;
				if (roles.has(copy.copy)) return void 0;
				roles.add(copy.copy);
				copies.push(copy);
			}
			if (value.ok !== copies.some((copy) => copy.accepted)) return void 0;
			const namedByCopies = /* @__PURE__ */ new Set();
			for (const copy of copies) for (const relay of copy.relays) namedByCopies.add(relay);
			const namedByBody = new Set(accepted);
			if (namedByBody.size !== namedByCopies.size) return void 0;
			for (const relay of namedByBody) if (!namedByCopies.has(relay)) return void 0;
			const evidence = parseEvidencePair(value);
			if (evidence === void 0) return void 0;
			if (evidence.evidence === "recorded" && accepted.length === 0) return void 0;
			if (evidence.evidence === "none" && accepted.length > 0) return void 0;
			return {
				status: "sent",
				ok: value.ok,
				accepted,
				copies,
				verdict: value.verdict,
				npub: value.npub,
				id: value.id,
				at: value.at,
				...evidence
			};
		}
		Object.freeze({
			env: "AUKORA_NOSTR_CONTACT_MODULE",
			relative: [
				"..",
				"..",
				"..",
				"aukora-nostr",
				...["lib", "contact.mjs"]
			].join("/")
		});
		//#endregion
		//#region src/add-contact-route.ts
		/**
		* ADD A CONTACT — the write half of a list that until now could only be read.
		*
		* WHY THIS FILE EXISTS. The face registered four endpoints and every one of them READS or SENDS:
		* the listing, the contacts request, the thread, the send. **Nothing in this face wrote
		* `contacts.json`**, so the only way to add a friend was the command line — whose own header says
		* so: *"the step that has no UI, made into a command instead of hand-written JSON."* A list nobody
		* can write to is a list that never grows, and the "+" button in the surface made a local
		* placeholder instead. This is the missing half.
		*
		* IT DELEGATES RATHER THAN REIMPLEMENTS. The release already carries `aukora-nostr/bin/add-contact.mjs`
		* and it already does the hard parts: it validates the npub and the 64-hex controller key, it
		* refuses to overwrite a file it cannot parse, and it writes **atomically** (`<file>.tmp` then
		* `renameSync`, mode `0600`). This route resolves that module exactly the way the face resolves
		* `contact.mjs` — from the tree beside the deployment — and calls its exported `addContact`.
		* **A second implementation of those rules is how the two copies drift.**
		*
		* WHAT IT ADDS ON TOP, AND EACH IS DELIBERATE:
		*
		*   IT REFUSES A DUPLICATE. `addContact` REPLACES an existing entry for the same npub and reports
		*   `replaced`. That is right for a repair tool run by hand and wrong for a button: an unverified
		*   write path must not be able to silently re-point a friend at a different key. So this route
		*   reads the file first and refuses.
		*
		*   IT CANNOT PRODUCE A BOUND OR VERIFIED CONTACT. There is no path through it to either. The
		*   `binding` is **always null**, and a `binding` field in the request body is **ignored** rather
		*   than stored — a caller cannot attach a claim, only a key. Trust arrives afterwards, through the
		*   friend's own binding and then a confirmation the owner signs.
		*
		*   ITS REFUSALS HAVE NAMES, and the ledger line names neither secret: the npub's PREFIX and the
		*   NAME'S LENGTH, never the controller key in full.
		*/
		/** The endpoint a sheet POSTs to in order to add a friend. */
		const MESSAGES_ADD_CONTACT_ENDPOINT = "/aukora-messages/add-contact";
		Object.freeze({
			NPUB_INVALID: "messages:add-npub-invalid",
			CONTROLLER_INVALID: "messages:add-controller-invalid",
			NAME_INVALID: "messages:add-name-invalid",
			BODY_UNREADABLE: "messages:add-body-unreadable",
			/** An entry for this npub is already present. THE ANTI-OVERWRITE REFUSAL. */
			ALREADY_PRESENT: "messages:add-already-present",
			/** The contacts file exists and this face cannot parse it. Never clobber a list we do not understand. */
			CONTACTS_UNREADABLE: "messages:add-contacts-unreadable",
			/** The nostr tree is not beside this deployment, so there is no writer to call. */
			WRITER_ABSENT: "messages:add-writer-absent",
			WRITE_FAILED: "messages:add-write-failed"
		});
		//#endregion
		//#region src/client/contacts-client.ts
		/**
		* The browser half of the Messages read and send: same-origin requests to the host's routes.
		*
		* WHAT THIS FILE IS FOR, AND WHAT IT REFUSES TO DO. The screen on the other side of it has
		* to say which of four things is actually known about the person on the other end of an
		* npub, and it cannot work that out from the browser: the contacts file is on disk, the
		* binding is verified against a controller record the page must never be handed, and an
		* npub on its own proves nothing. So every answer here comes from the host, parsed by the
		* parsers the host itself uses (`messages-route.ts`, imported rather than re-spelled). A
		* shape this file accepts is exactly the shape the host half serves, and a shape it does
		* not accept is reported as unreadable rather than half-rendered.
		*
		* NO PATH IS SPELLED HERE. All three endpoints are the route module's own constants, and the
		* state directory is host-owned: the listing is fetched from the bare endpoint, because a
		* request that named a directory would be refused by name (see
		* `MESSAGES_HOST_OWNED_QUERY_FIELDS`) — a route that read whichever directory the caller
		* named would let the page choose which node's contacts and mail this process touches.
		*
		* A REFUSAL IS NEVER READ AS AN EMPTY RESULT. `readJson` follows `documents-loader.ts`: a
		* transport failure, a non-JSON content type, a body this screen cannot parse, a named
		* refusal, and an unnamed HTTP status are five different failures, and the surface prints
		* which one happened. `messages:reads-unavailable` — no relay answered the read — is one of
		* those names, not an empty conversation.
		*
		* A SEND IS ONLY AS DELIVERED AS ITS PARSED BODY SAYS. `parseMessagesSendBody` refuses any
		* body in which `ok` and `accepted` disagree, so this file cannot be handed a 200 that claims
		* success with no relay behind it; a body with an empty `accepted` list reaches the surface as
		* `not-accepted`.
		*
		* THE AGGREGATE IS NOT THE OUTCOME, SO BOTH ARE CARRIED. One NIP-17 send publishes a copy to
		* the recipient AND a copy to this node's own key, and either can be refused on its own: the
		* aggregate `ok` is then true while the recipient's copy never left, which is exactly the
		* sentence a bare `ok` cannot produce. So a sent answer carries the parsed `copies` array
		* beside the aggregate, and the surface reads the per-copy outcomes rather than the sum. The
		* array comes off the body {@link parseMessagesSendBody} already validated — this file adds no
		* validation of its own, so a body the host's parser would refuse still never reaches here.
		*
		* @module @aukora/face-messages/contacts-client
		*/
		/** The page's own fetch, same-origin and uncached. */
		const sameOriginFetch = (input, init) => globalThis.fetch(input, init);
		/** How long any one request may take before it is reported as no answer at all. */
		const CONTACTS_REQUEST_TIMEOUT_MS = 15e3;
		/** The message of an unknown thrown value, without inventing one. */
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}
		/**
		* A timeout signal when the runtime has `AbortSignal.timeout`, and nothing when it does not.
		* A missing timeout degrades to the runtime's own request behaviour; it never throws here.
		* @returns the signal, or undefined.
		*/
		function timeoutSignal() {
			const factory = globalThis.AbortSignal;
			if (factory?.timeout === void 0) return void 0;
			try {
				return factory.timeout(CONTACTS_REQUEST_TIMEOUT_MS);
			} catch {
				return;
			}
		}
		/**
		* Read one JSON body from the host, refusing to guess what a failure means.
		* @param url - the same-origin route to read.
		* @param init - the request, without the JSON accept/credential headers this adds.
		* @param fetchImpl - the fetch to use.
		* @returns the parsed body with its status, or the named failure.
		*/
		async function readJson(url, init, fetchImpl) {
			const signal = init.signal ?? timeoutSignal();
			const request = {
				...init,
				headers: {
					accept: "application/json",
					"content-type": "application/json",
					...init.headers
				},
				cache: "no-store",
				credentials: "same-origin"
			};
			if (signal !== void 0) request.signal = signal;
			let response;
			try {
				response = await fetchImpl(url, request);
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
			return {
				kind: "ready",
				value: {
					status: response.status,
					value
				}
			};
		}
		/**
		* Turn a non-200 answer into the refusal it named, or an unnamed-HTTP failure.
		* @param status - the response status.
		* @param value - the parsed body.
		* @returns the failure.
		*/
		function refusalOf(status, value) {
			const refusal = parseMessagesRefusalBody(value);
			if (refusal !== void 0) return {
				kind: "refused",
				reason: refusal.reason,
				subject: refusal.subject
			};
			return {
				kind: "http",
				status,
				detail: "the body was not a refusal this face defines"
			};
		}
		/**
		* Add one contact. THE ONLY PLACE A CONTACT IS WRITTEN FROM THIS FACE.
		*
		* THE REQUEST AND RESPONSE SHAPE ARE THE ROUTE'S, taken from `add-contact-route.ts` itself rather than from a
		* memory of it: `POST /aukora-messages/add-contact` with `{ npub, controller, name }` answering
		* `{ status: 'ok', npub, name, state, binding, path, total }` or a refusal `{ ok: false, code }`. Keeping the
		* call in ONE function is what makes that a one-line change if the route moves.
		*
		* @param body - the three fields, already checked by `checkAddContact`.
		* @param fetchImpl - the fetch to use; defaults to the page's own, and is injected by the court.
		* @returns the added row, the route's named refusal, or a transport/malformed failure.
		*/
		async function postContact(body, fetchImpl = sameOriginFetch) {
			const read = await readJson(MESSAGES_ADD_CONTACT_ENDPOINT, {
				method: "POST",
				body: JSON.stringify(body)
			}, fetchImpl);
			if (read.kind === "failed") {
				const failure = read.failure;
				return {
					kind: "failed",
					detail: failure.kind === "refused" ? `${failure.reason} (${failure.subject})` : failure.detail
				};
			}
			const { status, value } = read.value;
			const answer = value;
			if (answer === null || typeof answer !== "object") return {
				kind: "failed",
				detail: `the route answered ${String(status)} with something that is not a body`
			};
			if (answer.ok === false || typeof answer.code === "string") {
				const reason = typeof answer.code === "string" ? answer.code : "messages:add-refused";
				return {
					kind: "refused",
					reason,
					detail: typeof answer.detail === "string" ? answer.detail : reason
				};
			}
			if (answer.status !== "ok" || typeof answer.npub !== "string" || typeof answer.name !== "string") return {
				kind: "failed",
				detail: `the route named neither an addition nor a refusal (status ${String(status)})`
			};
			return {
				kind: "added",
				contact: {
					npub: answer.npub,
					name: answer.name,
					state: typeof answer.state === "string" ? answer.state : "UNBOUND",
					binding: answer.binding ?? null,
					path: typeof answer.path === "string" ? answer.path : "",
					total: typeof answer.total === "number" ? answer.total : 0
				}
			};
		}
		function contactsUrl() {
			return MESSAGES_CONTACTS_ENDPOINT;
		}
		/**
		* Read this node's contacts, each resolved by the host to one of the four states.
		*
		* @param fetchImpl - the fetch to use; defaults to the page's own.
		* @returns the listing, or the named failure.
		*/
		async function readContacts(fetchImpl = sameOriginFetch) {
			const url = contactsUrl();
			const read = await readJson(url, { method: "GET" }, fetchImpl);
			if (read.kind === "failed") return read;
			const { status, value } = read.value;
			const answer = parseMessagesContactsAnswer(value);
			if (answer === void 0) return status === 200 ? {
				kind: "failed",
				failure: {
					kind: "malformed",
					detail: `${url} is not a contacts listing body`
				}
			} : {
				kind: "failed",
				failure: refusalOf(status, value)
			};
			if (answer.status === "refused") return {
				kind: "failed",
				failure: {
					kind: "refused",
					reason: answer.reason,
					subject: answer.subject
				}
			};
			if (status !== 200) return {
				kind: "failed",
				failure: refusalOf(status, value)
			};
			return {
				kind: "ready",
				value: answer
			};
		}
		/**
		* Read one conversation from the host.
		*
		* `since` is omitted when the caller has no window in mind: the route then uses the relay
		* module's own lookback, which is the only correct default for NIP-17, whose gift wraps are
		* timestamped into the two days before now.
		*
		* @param npub - the contact whose conversation to read.
		* @param since - unix seconds, or null to let the route choose its own lookback.
		* @param fetchImpl - the fetch to use; defaults to the page's own.
		* @returns the conversation, or the named failure.
		*/
		async function readThread(npub, since, fetchImpl = sameOriginFetch) {
			const query = new URLSearchParams({ npub });
			if (since !== null) query.set("since", String(Math.max(1, Math.floor(since))));
			const url = `${MESSAGES_THREAD_ENDPOINT}?${query.toString()}`;
			const read = await readJson(url, { method: "GET" }, fetchImpl);
			if (read.kind === "failed") return read;
			const { status, value } = read.value;
			const body = parseMessagesThreadBody(value);
			if (body === void 0) return status === 200 ? {
				kind: "failed",
				failure: {
					kind: "malformed",
					detail: `${url} is not a thread body`
				}
			} : {
				kind: "failed",
				failure: refusalOf(status, value)
			};
			return {
				kind: "ready",
				thread: body
			};
		}
		/**
		* Send one message.
		*
		* THE RESPONSE DECIDES, NOT THE STATUS CODE. The body is validated by
		* `parseMessagesSendBody`, which refuses any answer where `ok` and `accepted` disagree, so a
		* 200 with an empty relay list arrives here as `not-accepted` and the surface cannot render it
		* as a delivered message.
		*
		* THE COPIES COME OFF THE PARSED BODY, NEVER OFF THE RAW JSON. `copies` is an exact-key field
		* of the send body the host's parser validated, so carrying it here cannot admit a shape the
		* host would have refused — and nothing is re-validated or defaulted along the way.
		*
		* @param npub - the contact to send to.
		* @param text - the message body exactly as typed.
		* @param fetchImpl - the fetch to use; defaults to the page's own.
		* @returns what the host said happened.
		*/
		async function sendMessage(npub, text, fetchImpl = sameOriginFetch) {
			const read = await readJson(MESSAGES_SEND_ENDPOINT, {
				method: "POST",
				body: JSON.stringify({
					npub,
					text
				})
			}, fetchImpl);
			if (read.kind === "failed") return read;
			const { status, value } = read.value;
			const answer = parseMessagesSendBody(value);
			if (answer === void 0) return status === 200 ? {
				kind: "failed",
				failure: {
					kind: "malformed",
					detail: `${MESSAGES_SEND_ENDPOINT} is not a send body`
				}
			} : {
				kind: "failed",
				failure: refusalOf(status, value)
			};
			const refusal = parseMessagesRefusalBody(answer);
			if (refusal !== void 0) return {
				kind: "failed",
				failure: {
					kind: "refused",
					reason: refusal.reason,
					subject: refusal.subject
				}
			};
			if (answer.status !== "sent") return {
				kind: "failed",
				failure: {
					kind: "malformed",
					detail: `${MESSAGES_SEND_ENDPOINT} named neither a send nor a refusal`
				}
			};
			if (!answer.ok || answer.accepted.length === 0) return {
				kind: "not-accepted",
				accepted: answer.accepted,
				verdict: answer.verdict ?? "",
				copies: answer.copies
			};
			return {
				kind: "accepted",
				accepted: answer.accepted,
				verdict: answer.verdict ?? "",
				copies: answer.copies
			};
		}
		/**
		* Ask the host to confirm a contact's digits.
		*
		* THE HOST DOES THE SIGNING, AND THIS FUNCTION NEVER PRETENDS OTHERWISE. The backend asks the shell signer
		* over its socket — the same path the live binding travelled — and the window that opens is the signer's
		* own, showing the bytes it is about to sign. This call WAITS for the person to decide, so a confirmation
		* can take as long as a person takes.
		*
		* IT REFUSES TO READ A REFUSAL AS SUCCESS. `confirmed` is returned only for a `200` the host itself
		* resolved as VERIFIED; a named refusal, a malformed body or a transport failure all come back as
		* `failed`, because a row that says VERIFIED without a signature behind it is worse than a row that says
		* nothing.
		*
		* @param npub - the contact whose digits were compared.
		* @param fetchImpl - the fetch to use; defaults to the page's own.
		* @returns whether the host confirmed it, or why it did not.
		*/
		async function confirmSas(npub, fetchImpl = sameOriginFetch) {
			const read = await readJson(MESSAGES_CONFIRM_CONTACT_ENDPOINT, {
				method: "POST",
				body: JSON.stringify({ npub })
			}, fetchImpl);
			if (read.kind === "failed") return read;
			const { status, value } = read.value;
			const refusal = parseMessagesRefusalBody(value);
			if (refusal !== void 0) return {
				kind: "failed",
				failure: {
					kind: "refused",
					reason: refusal.reason,
					subject: refusal.subject
				}
			};
			const answer = typeof value === "object" && value !== null ? value : {};
			if (status === 200 && answer.state === "VERIFIED" && typeof answer.npub === "string") return {
				kind: "confirmed",
				npub: answer.npub
			};
			return status === 200 ? {
				kind: "failed",
				failure: {
					kind: "malformed",
					detail: `${MESSAGES_CONFIRM_CONTACT_ENDPOINT} answered 200 without naming VERIFIED`
				}
			} : {
				kind: "failed",
				failure: refusalOf(status, value)
			};
		}
		//#endregion
		//#region src/client/MessagesIcons.tsx
		/** Pin outline, identical to the thread lane's pin glyph. */
		function PinIcon({ size = 16, className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				className,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M9.5 1.5 14.5 6.5 11 8l-1.5 4.5L4 7 8.5 5.5Z",
					stroke: "currentColor",
					strokeWidth: "1.4",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M5 11l-3 3",
					stroke: "currentColor",
					strokeWidth: "1.4",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})]
			});
		}
		/** Unread ring, identical to the thread lane's unread glyph. */
		function UnreadIcon({ size = 16, className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: size,
				height: size,
				className,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					cx: "8",
					cy: "8",
					r: "4.6",
					stroke: "currentColor",
					strokeWidth: "1.4"
				})
			});
		}
		/** Archive outline, identical to the thread lane's archive glyph. */
		function ArchiveIcon({ size = 16, className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				className,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
					x: "2",
					y: "3",
					width: "12",
					height: "3.4",
					rx: "0.8",
					stroke: "currentColor",
					strokeWidth: "1.4"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M3.4 6.4V13h9.2V6.4M6.4 9h3.2",
					stroke: "currentColor",
					strokeWidth: "1.4",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})]
			});
		}
		/**
		* Shield: the ONE trust mark a list row may carry.
		*
		* The design allows a row four things — avatar, name, preview, time — and this is the fourth: a single
		* small mark saying whether a binding was checked, with the whole story (which state, and the digits to read
		* aloud) one tap away behind it. A row that says trust in words is a row that says it in too many words.
		*
		* THE INNER MARK IS THE SECOND SIGNAL BESIDE THE COLOUR, and it carries the one distinction a row has to
		* make without words: a check means a binding verified, and a slash means it did not — TEST, UNBOUND and
		* FOREIGN are three different reasons for the same "not established", and the row does not pretend to tell
		* them apart by shape. The exact state is the mark's accessible name here and the sheet's own sentence one
		* tap away, so no reader has to separate four colours to learn which one this is.
		* @param props - glyph size, class, and whether a binding verified for this contact.
		* @returns the shield the row's trust mark is built from.
		*/
		function ShieldIcon({ size = 16, className, verified = true }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				className,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M8 1.6 13 3.4v4.3c0 3.1-2.1 5.4-5 6.7-2.9-1.3-5-3.6-5-6.7V3.4Z",
					stroke: "currentColor",
					strokeWidth: "1.4",
					strokeLinejoin: "round"
				}), verified ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M5.9 8.1 7.4 9.6l2.9-3",
					stroke: "currentColor",
					strokeWidth: "1.4",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M5.9 5.9 10.1 10.1",
					stroke: "currentColor",
					strokeWidth: "1.4",
					strokeLinecap: "round"
				})]
			});
		}
		/** Close: the one way out of a sheet, beside Escape and a tap on the backdrop. */
		function CloseIcon({ size = 16, className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: size,
				height: size,
				className,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M4 4l8 8M12 4l-8 8",
					stroke: "currentColor",
					strokeWidth: "1.5",
					strokeLinecap: "round"
				})
			});
		}
		/** Info: the one button that opens the details sheet, from a row, the list or a conversation. */
		function InfoIcon({ size = 16, className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				className,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "8",
						cy: "8",
						r: "6",
						stroke: "currentColor",
						strokeWidth: "1.4"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M8 7.2v4",
						stroke: "currentColor",
						strokeWidth: "1.5",
						strokeLinecap: "round"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "8",
						cy: "4.9",
						r: "0.9",
						fill: "currentColor"
					})
				]
			});
		}
		/** One clock: the send is in flight and nothing has been claimed about it yet. */
		function SendPendingIcon({ size = 14, className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				className,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					cx: "8",
					cy: "8",
					r: "5.8",
					stroke: "currentColor",
					strokeWidth: "1.4"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M8 4.6V8l2.4 1.6",
					stroke: "currentColor",
					strokeWidth: "1.4",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})]
			});
		}
		/** Two checks: every copy this send reported was accepted. */
		function SendDeliveredIcon({ size = 14, className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				className,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M1.4 8.4 4.2 11.2 9.8 4.6",
					stroke: "currentColor",
					strokeWidth: "1.6",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M7 8.4 9.8 11.2 14.6 4.6",
					stroke: "currentColor",
					strokeWidth: "1.6",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})]
			});
		}
		/** One check, and it is one on purpose: a copy was refused, so this is not the two-check state. */
		function SendPartialIcon({ size = 14, className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				className,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M2.6 8.4 5.4 11.2 11 4.6",
					stroke: "currentColor",
					strokeWidth: "1.6",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M11.4 11.4 14.6 11.4",
					stroke: "currentColor",
					strokeWidth: "1.6",
					strokeLinecap: "round",
					strokeDasharray: "2 2"
				})]
			});
		}
		/** A broken bar: no relay took this message, so it never left. */
		function SendRefusedIcon({ size = 14, className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				className,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M3 5.6h10M3 10.4h10",
					stroke: "currentColor",
					strokeWidth: "1.5",
					strokeLinecap: "round"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M9.4 3.2 6.6 12.8",
					stroke: "currentColor",
					strokeWidth: "1.5",
					strokeLinecap: "round"
				})]
			});
		}
		/** Plus for new-conversation, matching the lane's new-chat control weight. */
		function PlusIcon({ size = 16, className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: size,
				height: size,
				className,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M8 2.8v10.4M2.8 8h10.4",
					stroke: "currentColor",
					strokeWidth: "1.4",
					strokeLinecap: "round"
				})
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
		/** Back chevron for the open-conversation return, top-left as in the thread view. */
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
		/** Send arrow, white on the composer's info-fill circle like the AI composer. */
		function SendIcon({ size = 16, className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: size,
				height: size,
				className,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M8 13V3.8M4 7.5 8 3.5l4 4",
					stroke: "currentColor",
					strokeWidth: "1.8",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			});
		}
		/** Chat mark beside the MESSAGES brand name. */
		function ChatMarkIcon({ size = 22, className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: size,
				height: size,
				className,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M2.5 8a5.5 5.5 0 1 1 2.2 4.4L2 13.5l.8-2.6A5.5 5.5 0 0 1 2.5 8Z",
					stroke: "currentColor",
					strokeWidth: "1.4",
					strokeLinejoin: "round"
				})
			});
		}
		/** Two checks: the binding verified and is not TEST-labelled. */
		function VerifiedStateIcon({ size = 14, className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				className,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M1.8 8.4 4.6 11.2 10.2 4.6",
					stroke: "currentColor",
					strokeWidth: "1.6",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M7.4 8.4 10.2 11.2 15 4.6",
					stroke: "currentColor",
					strokeWidth: "1.6",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})]
			});
		}
		/** A flask: valid, and TEST-labelled rather than a claim about a person. */
		function TestStateIcon({ size = 14, className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				className,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M6.2 1.9h3.6M7 1.9v3.6L3.4 12a1.4 1.4 0 0 0 1.2 2.1h6.8A1.4 1.4 0 0 0 12.6 12L9 5.5V1.9",
					stroke: "currentColor",
					strokeWidth: "1.4",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M4.6 10.4h6.8",
					stroke: "currentColor",
					strokeWidth: "1.4",
					strokeLinecap: "round"
				})]
			});
		}
		/** An open, broken link: held here and vouched for by nothing. */
		function UnboundStateIcon({ size = 14, className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				className,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.7.7",
					stroke: "currentColor",
					strokeWidth: "1.4",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.5 8.8a2.6 2.6 0 0 0 3.7 3.7l.7-.7",
					stroke: "currentColor",
					strokeWidth: "1.4",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})]
			});
		}
		/** A warning: something was presented and it did not verify. */
		function ForeignStateIcon({ size = 14, className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				className,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M8 2.2 14.6 13.4H1.4L8 2.2Z",
						stroke: "currentColor",
						strokeWidth: "1.4",
						strokeLinejoin: "round"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M8 6.4v3.2",
						stroke: "currentColor",
						strokeWidth: "1.5",
						strokeLinecap: "round"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "8",
						cy: "11.6",
						r: "0.9",
						fill: "currentColor"
					})
				]
			});
		}
		/** A keyed lock: the seat the SAS occupies when a binding verified. */
		function SasIcon({ size = 14, className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				className,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					cx: "5.6",
					cy: "8",
					r: "2.6",
					stroke: "currentColor",
					strokeWidth: "1.4"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M8.2 8H14M11.6 8v2.4M13.4 8v1.6",
					stroke: "currentColor",
					strokeWidth: "1.4",
					strokeLinecap: "round"
				})]
			});
		}
		/** A slash: the seat is deliberately not a code, so it must not look like one. */
		function SasAbsentIcon({ size = 14, className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				className,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					cx: "8",
					cy: "8",
					r: "5.6",
					stroke: "currentColor",
					strokeWidth: "1.4"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M4.4 11.6 11.6 4.4",
					stroke: "currentColor",
					strokeWidth: "1.4",
					strokeLinecap: "round"
				})]
			});
		}
		/** A circular arrow for re-reading the listing, so the refresh verb is not an unread dot. */
		function RefreshIcon({ size = 16, className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				className,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M13.2 8a5.2 5.2 0 1 1-1.6-3.7",
					stroke: "currentColor",
					strokeWidth: "1.4",
					strokeLinecap: "round"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M13.4 2.4v2.9h-2.9",
					stroke: "currentColor",
					strokeWidth: "1.4",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})]
			});
		}
		//#endregion
		//#region src/client/MessagesSurface.tsx
		/**
		* Person-to-person Messages as a copy of the thread lane: the same brand row, filter
		* cluster, card rows, open-conversation view, and composer — blue accent instead of mint.
		*
		* ONE SOURCE, NAMED ON THE SURFACE. The rows come from this node's contacts, read from the host
		* route through `contacts-client.ts`, and each carries the one thing that is actually known about
		* who is on the other end: VERIFIED, TEST, UNBOUND or FOREIGN. Nothing on this surface is
		* invented. The two ways a read can come back empty are two different facts and each is said in
		* its own words: a listing with nobody in it says there are no contacts yet and what to do about
		* it, and a read that failed says so and names the reason the host returned. The status line and
		* the source line say which read is on screen and which directory was read, so a reader never has
		* to guess where a row came from — and no reader is ever shown a conversation nobody had.
		*
		* A SAS IS SHOWN ONLY WHERE ONE EXISTS. `contact.sas` is non-null only when a binding
		* actually verified — TEST and VERIFIED carry one, UNBOUND and FOREIGN do not — and where it
		* is null the row shows a sentence saying so. It never shows a placeholder, a dash, or
		* anything else that could be mistaken for digits to compare: the whole point of the four
		* states is that nobody reads a string aloud for an identity that was never proven.
		*
		* A SEND IS ONLY SHOWN AS SENT WHEN A RELAY ACCEPTED IT. The send route — the endpoint
		* constants live in `../messages-route.ts` and are never spelled here — answering 200 is not
		* delivery: the response body names the relays that accepted the message, `ok` is derived
		* from that list, and a body that names none is rendered as not delivered, in the same place
		* a successful send would have been confirmed.
		*
		* AND THE AGGREGATE IS NOT THE OUTCOME. One NIP-17 send publishes a copy to the recipient and
		* a copy to this node's own key, and either can be refused on its own, so `ok: true` can mean
		* "your friend has it" OR "only your own copy was kept" — two different facts a flat list
		* collapses into one word. The receipt therefore reads the send body's per-copy outcomes and
		* says which copy the relays kept, naming a refusal wherever one happened. A refused copy is
		* NEVER rendered as delivered: if either copy was refused, the sentence says so even though the
		* aggregate says the send succeeded, because the aggregate is what the route reports and the
		* per-copy sentence is what the person is owed.
		*/
		function isEditableTarget(target) {
			const el = target;
			const tag = typeof el?.tagName === "string" ? el.tagName : "";
			return el?.isContentEditable === true || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
		}
		/** Runtime-posture copy keys for each messaging-engine state. */
		const RUNTIME_POSTURE = {
			"not-connected": { status: "runtime.status" },
			"contacts-only": { status: "runtime.status.contacts-only" },
			"connected": { status: "runtime.status.connected" }
		};
		/** The copy for each scene: what the rows are, and which of them the source line names. */
		const SCENE = {
			"contacts": { source: "source.contacts" },
			"contacts-reading": { source: "source.contacts.reading" },
			"contacts-empty": { source: "source.contacts.empty" },
			"contacts-failed": { source: "source.contacts.failed" }
		};
		/**
		* The posture an engine state paints with. `contacts-only` is NOT green: the messaging engine is
		* absent in that state too — the local route answers and nothing is received — so painting it as a
		* connected route would be the one thing this line must never do, which is say something untrue.
		*/
		const POSTURE_TONE = {
			"not-connected": "disconnected",
			"contacts-only": "disconnected",
			"connected": "connected"
		};
		const BANNER_STATUS = {
			"not-connected": "runtime.status",
			"contacts-only": "runtime.status.contacts-only"
		};
		/**
		* The banner a status earns, or null when nothing is wrong and there is nothing to say.
		* @param status - the posture on screen.
		* @returns the status the banner is shown for, or null.
		*/
		function bannerFor(status) {
			return status === "connected" ? null : status;
		}
		/**
		* The one thing known about each contact, as copy. The four states are the wire's own
		* vocabulary (`messages-route.ts`), and every state carries a badge word, a sentence for
		* the badge's `title` and its visually-hidden label, and the honest alternative to a SAS.
		*/
		const CONTACT_STATE = {
			VERIFIED: {
				badge: "state.VERIFIED.word",
				detail: "state.VERIFIED.detail",
				title: "state.VERIFIED.title",
				sasAbsent: "sas.absent.VERIFIED"
			},
			BOUND: {
				badge: "state.BOUND.word",
				detail: "state.BOUND.detail",
				title: "state.BOUND.title",
				sasAbsent: "sas.absent.BOUND"
			},
			TEST: {
				badge: "state.TEST.word",
				detail: "state.TEST.detail",
				title: "state.TEST.title",
				sasAbsent: "sas.absent.TEST"
			},
			UNBOUND: {
				badge: "state.UNBOUND.word",
				detail: "state.UNBOUND.detail",
				title: "state.UNBOUND.title",
				sasAbsent: "sas.absent.UNBOUND"
			},
			FOREIGN: {
				badge: "state.FOREIGN.word",
				detail: "state.FOREIGN.detail",
				title: "state.FOREIGN.title",
				sasAbsent: "sas.absent.FOREIGN"
			}
		};
		/**
		* Fold the initial letters of a name, uppercased, for the avatar seat.
		* @param name - the contact's display name.
		* @returns one or two characters.
		*/
		function initialOf(name) {
			const parts = name.trim().split(/\s+/u).filter((part) => part !== "");
			if (parts.length === 0) return "?";
			if (parts.length === 1) return parts[0]?.slice(0, 1).toUpperCase() ?? "?";
			return `${parts[0]?.slice(0, 1) ?? ""}${parts[parts.length - 1]?.slice(0, 1) ?? ""}`.toUpperCase();
		}
		/** The state glyph for one contact state. Distinct shapes, so the badges survive colour. */
		function stateIcon(state) {
			switch (state) {
				case "VERIFIED": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(VerifiedStateIcon, {});
				case "TEST": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TestStateIcon, {});
				case "UNBOUND": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UnboundStateIcon, {});
				case "FOREIGN": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ForeignStateIcon, {});
			}
		}
		/**
		* The state badge: a glyph, the state WORD, a `title`, and a visually-hidden sentence.
		*
		* THE WORD IS SHORT AND THE SENTENCE IS NOT LOST. The badge used to show `state.<STATE>.detail` — a whole sentence
		* like "the key checks out; nobody has confirmed it in person" — which at 10px is about sixty characters, so in a
		* third-width pane the badge measured 369px inside 341px and its right edge left the surface. Shrinking it would
		* only have ellipsised the sentence into "the key checks out; nobo…", so the visible word is now the state's own
		* short name and the sentence lives in TWO places that can hold it: the `title` a pointer reveals, and the
		* visually-hidden span that gives the badge its accessible name.
		*
		* Colour is the fourth signal, never the only one.
		* @param props - the state, the copy, and the translate function.
		* @returns the badge element.
		*/
		function StateBadge({ state, t }) {
			const copy = CONTACT_STATE[state];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: Messages_module_css_default.badge,
				"data-state": state,
				title: t(copy.title),
				children: [
					stateIcon(state),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: Messages_module_css_default.badgeWord,
						children: t(copy.badge)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: Messages_module_css_default.visuallyHidden,
						children: t(copy.title)
					})
				]
			});
		}
		/**
		* The SAS seat beside a contact: the string to read aloud when a binding verified, and a
		* sentence — never a stand-in value — when it did not.
		* @param props - the state, the SAS or its absence, and the translate function.
		* @returns the SAS row or the honest alternative to it.
		*/
		function SasSeat({ state, sas, t }) {
			if (sas !== null) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: Messages_module_css_default.sas,
				"data-sas": "present",
				"data-state": state,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: Messages_module_css_default.sasGlyph,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SasIcon, {})
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: Messages_module_css_default.sasBody,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: Messages_module_css_default.sasLabel,
							children: [t("sas.label"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: Messages_module_css_default.visuallyHidden,
								children: `: ${t("sas.spoken")}`
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: Messages_module_css_default.sasDigits,
							"data-sas-spoken": sas.spoken,
							children: sas.spoken
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: Messages_module_css_default.sasHint,
							children: t("sas.hint")
						})
					]
				})]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: Messages_module_css_default.sasAbsent,
				"data-sas": "absent",
				"data-state": state,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: Messages_module_css_default.sasAbsentGlyph,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SasAbsentIcon, {})
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: Messages_module_css_default.sasBody,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: Messages_module_css_default.sasLabel,
						children: t("sas.label")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: Messages_module_css_default.sasAbsentText,
						children: t(CONTACT_STATE[state].sasAbsent)
					})]
				})]
			});
		}
		/**
		* The one trust mark a row carries: a shield, in the state's own colour, with the state's own
		* sentence as its accessible name.
		*
		* THE ROW DOES NOT SPELL TRUST. It was a badge with a word, a key fragment and a box of digits —
		* three separate claims in one row, which is what "too many little texts, badges and boxes" was
		* about. Here there is one mark, and the words it used to carry live in the verify sheet this mark's
		* own row opens: the state's sentence is the mark's `aria-label`, so a screen reader is told the exact
		* state, and a reader who wants it in words taps the row's conversation and the chip in it.
		*
		* @param props - the resolved state and the translate function.
		* @returns the row's trust mark.
		*/
		function TrustMark({ state, t }) {
			const spoken = t(CONTACT_STATE[state].detail);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: Messages_module_css_default.trustMark,
				"data-state": state,
				"data-trust-mark": state,
				role: "img",
				"aria-label": spoken,
				title: spoken,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ShieldIcon, {
					size: 13,
					verified: state === "VERIFIED"
				})
			});
		}
		/**
		* The sheet both of the surface's one-tap layers sit in: a panel over the lane, a title, one way out.
		*
		* It is positioned inside the surface rather than the viewport, because the surface is what has a
		* width: a fixed panel would cover the shell and measure the window instead of the lane.
		*
		* @param props - the title, the close label, a test hook, the close action, and the body.
		* @returns the sheet.
		*/
		function Sheet({ title, closeLabel, hook, onClose, children }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: Messages_module_css_default.sheetBackdrop,
				"data-messages-sheet": hook,
				onClick: onClose,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: Messages_module_css_default.sheet,
					role: "dialog",
					"aria-modal": "true",
					"aria-label": title,
					onClick: (event) => {
						event.stopPropagation();
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: Messages_module_css_default.sheetHeader,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							className: Messages_module_css_default.sheetTitle,
							"data-fit": "name",
							children: title
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: Messages_module_css_default.iconButton,
							"aria-label": closeLabel,
							onClick: onClose,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CloseIcon, {})
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: Messages_module_css_default.sheetBody,
						children
					})]
				})
			});
		}
		/**
		* The verify sheet: the whole truth about one contact's identity, one tap from the chip that says
		* "Unverified" and one tap from the row's shield.
		*
		* THE READ-ALOUD DIGITS LIVE HERE, and this is the only place they live. A string two people compare
		* by voice is not a thing to put in a list row: it is a deliberate act, it takes two of them, and a
		* row that shows digits beside a name invites a reader to treat them as decoration. Where no binding
		* verified, the sheet says that in a sentence — never a dash, never a placeholder, never anything
		* shaped like a code.
		*
		* @param props - the state, the SAS or its absence, the copy, and the close action.
		* @returns the verify sheet.
		*/
		function VerifySheet({ state, sas, contact, npub, onConfirmed, t, onClose }) {
			const [refusal, setRefusal] = (0, react.useState)(null);
			const [asking, setAsking] = (0, react.useState)(false);
			const ask = async () => {
				setAsking(true);
				setRefusal(null);
				const answer = await confirmSas(npub);
				setAsking(false);
				if (answer.kind === "failed") {
					setRefusal(answer.failure.kind === "refused" ? answer.failure.reason : answer.failure.detail);
					return;
				}
				onConfirmed();
				onClose();
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Sheet, {
				title: t("verify.title"),
				closeLabel: t("sheet.close"),
				hook: "verify",
				onClose,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: Messages_module_css_default.sheetBadgeRow,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StateBadge, {
							state,
							t
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: Messages_module_css_default.sheetSentence,
						"data-verify-state": state,
						children: t(CONTACT_STATE[state].title)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SasSeat, {
						state,
						sas,
						t
					}),
					sas !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: Messages_module_css_default.verifyConfirm,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: Messages_module_css_default.verifyConfirmButton,
							"data-verify-confirm": "available",
							disabled: asking,
							onClick: () => {
								ask();
							},
							children: t("verify.confirm.button", { contact })
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: Messages_module_css_default.verifyConfirmNote,
							"data-verify-confirm-note": refusal === null ? asking ? "asking" : "ready" : "refused",
							children: refusal ?? t("verify.confirm.ready")
						})]
					})
				]
			});
		}
		/**
		* The details sheet: everything true about this conversation or this read that a row must not carry.
		*
		* Peter's rule, applied literally: nothing true gets deleted, it moves one tap away. The key was on
		* every row as a slice; here it is whole. The path the listing was read from was a monospace line
		* under the list; here it is a labelled value. "Relays that answered" was a paragraph in the middle
		* of a conversation; here it is a row. And the receipt sentences — which a mark cannot carry — are
		* rows beside the same outcome the mark shows.
		*
		* @param props - the rows, the copy, and the close action.
		* @returns the details sheet.
		*/
		function DetailsSheet({ rows, t, onClose }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Sheet, {
				title: t("details.title"),
				closeLabel: t("sheet.close"),
				hook: "details",
				onClose,
				children: rows.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: Messages_module_css_default.sheetRow,
					"data-details-row": row.ref ?? void 0,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: Messages_module_css_default.sheetLabel,
						children: row.label
					}), row.value !== null && (row.mono === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
						className: Messages_module_css_default.npub,
						"data-details-value": row.ref ?? void 0,
						children: row.value
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: Messages_module_css_default.sheetValue,
						"data-details-value": row.ref ?? void 0,
						children: row.value
					}))]
				}, row.label))
			});
		}
		/**
		* THE ADD-CONTACT SHEET: THE ONLY WAY A CONVERSATION WITHOUT A COUNTERPARTY CAN BE STARTED, WHICH IS TO SAY
		* IT CANNOT BE.
		*
		* Three fields, and every one of them is checked before the host is asked anything: the npub is DECODED as
		* bech32 (`checkNpub`), the controller key must be 64 lower-case hex, and the name must exist. A refusal is
		* shown INLINE, WITH THE NAME THE HOST OR THE CHECKER GAVE IT — never a toast, never a silent close, because a
		* person who typed a key is owed the reason it was not written.
		*
		* ON ALREADY-PRESENT THERE IS NO SECOND PRESS. The route refuses to overwrite an existing contact, so a submit
		* button left on screen could only fail again; where the refusal is that one, the button is not rendered at all.
		*
		* ON SUCCESS THE ROW COMES FROM THE HOST, NOT FROM HERE: `onAdded` re-reads the contacts, so the row that
		* appears is the host's own — including its state, which is UNBOUND until somebody confirms that key in person.
		*
		* @param props - the copy, the close action, and the re-read to run once a contact exists.
		* @returns the add-contact sheet.
		*/
		function AddContactSheet({ t, onClose, onAdded }) {
			const [draft, setDraft] = (0, react.useState)({
				name: "",
				npub: "",
				controller: ""
			});
			const [refusal, setRefusal] = (0, react.useState)(null);
			const [added, setAdded] = (0, react.useState)(null);
			const [sending, setSending] = (0, react.useState)(false);
			const noRetry = refusal?.reason === "messages:add-already-present";
			const ready = draft.name.trim() !== "" && draft.npub.trim() !== "" && draft.controller.trim() !== "";
			const submit = () => {
				const checked = checkAddContact(draft);
				if (checked.ok !== true) {
					setRefusal({
						reason: checked.reason,
						detail: checked.detail
					});
					return;
				}
				setSending(true);
				postContact(checked.body).then((read) => {
					setSending(false);
					if (read.kind === "added") {
						setAdded(read.contact);
						setRefusal(null);
						onAdded();
						return;
					}
					setRefusal(read.kind === "refused" ? {
						reason: read.reason,
						detail: read.detail
					} : {
						reason: "messages:add-unreachable",
						detail: read.detail
					});
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Sheet, {
				title: t("add.title"),
				closeLabel: t("sheet.close"),
				hook: "add",
				onClose,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: Messages_module_css_default.addHint,
						children: t("add.hint")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: Messages_module_css_default.addForm,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: Messages_module_css_default.addField,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: Messages_module_css_default.addLabel,
									children: t("add.name")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: Messages_module_css_default.addInput,
									value: draft.name,
									"data-add-field": "name",
									onChange: (event) => {
										setDraft({
											...draft,
											name: event.target.value
										});
									}
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: Messages_module_css_default.addField,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: Messages_module_css_default.addLabel,
									children: t("add.npub")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: Messages_module_css_default.addInput,
									value: draft.npub,
									"data-add-field": "npub",
									spellCheck: false,
									autoComplete: "off",
									onChange: (event) => {
										setDraft({
											...draft,
											npub: event.target.value
										});
									}
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: Messages_module_css_default.addField,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: Messages_module_css_default.addLabel,
									children: t("add.controller")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: Messages_module_css_default.addInput,
									value: draft.controller,
									"data-add-field": "controller",
									spellCheck: false,
									autoComplete: "off",
									onChange: (event) => {
										setDraft({
											...draft,
											controller: event.target.value
										});
									}
								})]
							}),
							noRetry !== true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: Messages_module_css_default.addSubmit,
								"data-add-submit": "ready",
								disabled: sending || ready !== true,
								onClick: submit,
								children: t("add.submit")
							})
						]
					}),
					refusal !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: Messages_module_css_default.addRefusal,
						"data-add-refusal": refusal.reason,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: Messages_module_css_default.addReason,
							children: refusal.reason
						}), ` — ${refusal.detail}`]
					}),
					added !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: Messages_module_css_default.addAdded,
						"data-add-added": added.state,
						children: t("add.added", {
							name: added.name,
							npub: added.npub,
							state: added.state
						})
					})
				]
			});
		}
		/** The glyph for each mark state, so the four are four shapes and never four colours alone. */
		const MARK_ICON = {
			"pending": SendPendingIcon,
			"delivered": SendDeliveredIcon,
			"partial": SendPartialIcon,
			"refused": SendRefusedIcon,
			"unknown": RefreshIcon
		};
		/**
		* Which mark a receipt earns, read from the send's per-copy outcome rather than from the aggregate.
		*
		* `not-accepted` IS REFUSED WHATEVER THE COPIES SAY. The route sets it when no relay took the send or
		* the aggregate is false, and the one thing this mark must never do is show the two-check state over a
		* message nobody took. An `accepted` send is only `delivered` when every copy this send reported was
		* accepted; a copy that was refused lands on `partial`, which is the mark that exists because the
		* aggregate cannot tell "your friend has it" from "only your own copy was kept".
		*
		* @param receipt - what the host said about the newest send in this conversation.
		* @param outcome - the per-copy outcome, or undefined when the receipt carries no copies.
		* @returns the mark state.
		*/
		function markOf(receipt, outcome) {
			switch (receipt.kind) {
				case "pending": return "pending";
				case "failed": return "refused";
				case "not-accepted": return "refused";
				case "accepted": return outcome === void 0 ? "unknown" : COPY_OUTCOME[outcome].tone;
			}
		}
		/**
		* The sentence behind a mark, as the mark's accessible name.
		*
		* THE MARK IS NOT THE WHOLE STORY, AND IT DOES NOT PRETEND TO BE. Sighted readers get a shape in a
		* place they already look; everyone gets the exact sentence from the route, and the details sheet
		* shows that same sentence to everyone. A refused copy is named here even when the aggregate says the
		* send succeeded, because the aggregate is what the route reports and the per-copy sentence is what
		* the person is owed.
		*
		* @param receipt - what the host said about the newest send.
		* @param outcome - the per-copy outcome, or undefined when the receipt carries no copies.
		* @param t - the translate function.
		* @returns the sentence the mark stands for.
		*/
		function markSentence(receipt, outcome, t) {
			if (receipt.kind === "pending") return t(SEND_RECEIPT.pending);
			if (receipt.kind === "failed") return `${t(SEND_RECEIPT.failed)} ${failureText(receipt.failure)}`;
			if (receipt.kind === "not-accepted") return t(SEND_RECEIPT["not-accepted"]);
			if (outcome === void 0) return t("send.outcome.unread");
			return t(COPY_OUTCOME[outcome].sentence);
		}
		/**
		* The receipt as a mark: one small state mark on the message it is about, with the sentence as its
		* accessible name.
		*
		* @param props - the receipt, its per-copy outcome, and the translate function.
		* @returns the mark, or null when there is nothing to mark.
		*/
		function ReceiptMark({ receipt, outcome, t }) {
			const mark = markOf(receipt, outcome);
			const Icon = mark === "unknown" ? null : MARK_ICON[mark];
			const sentence = markSentence(receipt, outcome, t);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: Messages_module_css_default.receiptMark,
				"data-receipt": mark,
				"data-messages-receipt": mark,
				"data-copies": outcome === void 0 ? void 0 : COPY_OUTCOME[outcome].tone,
				role: "img",
				"aria-label": sentence,
				title: sentence,
				children: Icon === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Icon, { size: 13 })
			});
		}
		/**
		* One row, in Signal's grammar: avatar, name, preview, time, and one mark.
		*
		* The row this replaces carried a name, a badge with a state word, a sliced key, a box of digits or a
		* sentence saying there were none, a source tag and three status markers — six or seven claims where a
		* person scanning a list reads two. Everything that left this row is behind one of the row's own
		* controls: the conversation for the messages, the shield for the identity, and the info button for
		* the key, the source and the host.
		*
		* @param props - the row, its resolved name and preview, and the three actions a row has.
		* @returns the row.
		*/
		function ContactRow({ entry, t, name, preview, onOpen, onToggle, onDetails }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				role: "listitem",
				tabIndex: 0,
				className: clsx(Messages_module_css_default.personRow, entry.contact !== void 0 && Messages_module_css_default.contactRow),
				"data-person-row": entry.id,
				"data-contact-state": entry.contact?.state,
				onClick: () => {
					onOpen(entry);
				},
				onKeyDown: (event) => {
					if (event.key !== "Enter" && event.key !== " ") return;
					event.preventDefault();
					onOpen(entry);
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: Messages_module_css_default.avatar,
						"aria-hidden": "true",
						children: initialOf(name)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: Messages_module_css_default.rowMain,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: Messages_module_css_default.rowTop,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: Messages_module_css_default.rowTitleInMain,
									"data-fit": "name",
									children: name
								}),
								entry.contact !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TrustMark, {
									state: entry.contact.state,
									t
								}),
								entry.unread && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: Messages_module_css_default.unreadDot,
									"data-unread-mark": true,
									role: "img",
									"aria-label": t("status.unread"),
									title: t("status.unread")
								}),
								entry.pinned && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: Messages_module_css_default.pinMark,
									"data-pin-mark": true,
									role: "img",
									"aria-label": t("status.pinned"),
									title: t("status.pinned"),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PinIcon, { size: 12 })
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: Messages_module_css_default.time,
									"data-fit": "line",
									children: t("time.now")
								})
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: Messages_module_css_default.rowPreview,
							"data-fit": "line",
							children: preview
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: Messages_module_css_default.rowActions,
						onClick: (event) => {
							event.stopPropagation();
						},
						onKeyDown: (event) => {
							event.stopPropagation();
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: Messages_module_css_default.iconButton,
								"aria-label": t("details.open"),
								onClick: () => {
									onDetails(entry);
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(InfoIcon, {})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: clsx(Messages_module_css_default.iconButton, Messages_module_css_default.pinAction),
								"aria-label": entry.pinned ? t("row.unpin") : t("row.pin"),
								"aria-pressed": entry.pinned,
								onClick: () => {
									onToggle(entry, "pinned");
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PinIcon, {})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: clsx(Messages_module_css_default.iconButton, Messages_module_css_default.unreadAction),
								"aria-label": entry.unread ? t("row.markRead") : t("row.markUnread"),
								"aria-pressed": entry.unread,
								onClick: () => {
									onToggle(entry, "unread");
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UnreadIcon, {})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: clsx(Messages_module_css_default.iconButton, Messages_module_css_default.archiveAction),
								"aria-label": entry.archived ? t("row.unarchive") : t("row.archive"),
								"aria-pressed": entry.archived,
								onClick: () => {
									onToggle(entry, "archived");
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ArchiveIcon, {})
							})
						]
					})
				]
			});
		}
		/** The receipt line for each send outcome. A `not-accepted` send says exactly that. */
		const SEND_RECEIPT = {
			"pending": "send.pending",
			"accepted": "send.accepted",
			"not-accepted": "send.unaccepted",
			"failed": "send.refused"
		};
		/**
		* The sentence for each per-copy outcome, and the tone its receipt paints with.
		*
		* Every one of the four is copy, so none of them is spelled in the JSX. `tone` is the value the
		* receipt carries in `data-copies`, which is what makes a refused copy visually distinct from a
		* clean send rather than merely different words: `delivered` is the only one painted as success.
		*/
		const COPY_OUTCOME = {
			"delivered": {
				sentence: "send.outcome.delivered",
				tone: "delivered"
			},
			"self-kept": {
				sentence: "send.outcome.self-kept",
				tone: "partial"
			},
			"recipient-kept": {
				sentence: "send.outcome.recipient-kept",
				tone: "partial"
			},
			"both-refused": {
				sentence: "send.outcome.both-refused",
				tone: "refused"
			}
		};
		/**
		* The outcome of one send, read from its per-copy outcomes rather than from the aggregate.
		*
		* THE REFUSAL WINS OVER THE SUM, IN BOTH DIRECTIONS. If any copy was refused the result names
		* which one, even when the other copy was accepted and `ok` is true — showing that send as
		* plainly delivered would claim the recipient has a message the relays never took. A body whose
		* `copies` names no accepted copy at all is `both-refused` whatever else it says, because a send
		* with nothing taken must never reach a sent state.
		*
		* An empty `copies` list cannot come from the host parser, which refuses a send body that names
		* no copy; it is read as `both-refused` anyway, since "no copy reported" is the answer that
		* claims nothing, not the one that claims delivery.
		*
		* @param copies - the parsed per-copy outcomes of one send.
		* @returns the outcome the receipt is written from.
		*/
		function copyOutcomeOf(copies) {
			const recipient = copies.find((copy) => copy.copy === "recipient");
			const self = copies.find((copy) => copy.copy === "self");
			if (!copies.some((copy) => copy.accepted)) return "both-refused";
			if (recipient !== void 0 && !recipient.accepted) return "self-kept";
			if (self !== void 0 && !self.accepted) return "recipient-kept";
			return "delivered";
		}
		/**
		* The named reason each refused copy gave, one per copy, for the diagnostic detail line.
		*
		* A refusal is a named code and never prose, so it is shown as it arrived — beside the copy it
		* belongs to — rather than paraphrased into a second vocabulary that could drift from the host's.
		*
		* @param copies - the parsed per-copy outcomes of one send.
		* @returns one `<copy>: <code>` line per refused copy, in the order the send reported them.
		*/
		function copyRefusalDetails(copies) {
			return copies.filter((copy) => !copy.accepted && copy.refusal !== null).map((copy) => `${copy.copy}: ${copy.refusal}`);
		}
		/** How often the listing is re-read while the lane is open. Slow on purpose. */
		const CONTACTS_POLL_MS = 6e4;
		/**
		* Fold a contacts listing into the local rows, keeping every flag the viewer set.
		* @param current - the rows held now.
		* @param contacts - the listing that just arrived.
		* @returns contact rows, in the order the host listed them.
		*/
		function mergeContacts(current, contacts) {
			const held = new Map(current.filter((entry) => entry.contact !== void 0).map((entry) => [entry.id, entry]));
			return contacts.map((contact) => {
				const previous = held.get(contact.npub);
				return {
					id: contact.npub,
					contact,
					pinned: previous?.pinned ?? false,
					unread: previous?.unread ?? false,
					archived: previous?.archived ?? false,
					sent: previous?.sent ?? []
				};
			});
		}
		/**
		* A one-line, human-readable account of a read failure. Diagnostic, never localized copy.
		* @param failure - the failure the client layer reported.
		* @returns the reason as text.
		*/
		function failureText(failure) {
			switch (failure.kind) {
				case "transport": return `no answer from the host route: ${failure.detail}`;
				case "http": return `the host answered HTTP ${String(failure.status)} with no named refusal: ${failure.detail}`;
				case "refused": return `${failure.reason} (${failure.subject})`;
				case "malformed": return `an answer this screen cannot read: ${failure.detail}`;
			}
		}
		/**
		* Render the Messages lane over this node's contacts: a filterable list with one of four
		* identity states and their SAS on every row, click-to-open conversations read from the
		* host, and a composer whose receipt comes from the send response rather than a status code.
		* @param props - shell visibility, close action, and localized copy.
		* @returns the always-mounted Messages surface.
		*/
		function MessagesSurface({ activeSurface, closeSurface, t, messagingStatus = "not-connected" }) {
			const active = activeSurface === "messages";
			const [contactsView, setContactsView] = (0, react.useState)({ kind: "idle" });
			const [entries, setEntries] = (0, react.useState)([]);
			const [filters, setFilters] = (0, react.useState)({
				pinned: false,
				unread: false,
				archived: false
			});
			const [searchOpen, setSearchOpen] = (0, react.useState)(false);
			const [query, setQuery] = (0, react.useState)("");
			const [openId, setOpenId] = (0, react.useState)(null);
			const [draft, setDraft] = (0, react.useState)("");
			const [thread, setThread] = (0, react.useState)({ kind: "idle" });
			const [receipts, setReceipts] = (0, react.useState)({});
			/**
			* The one layer over the lane: the verify sheet a chip opens, or the details sheet an info button
			* opens. One state rather than two booleans, so "both open at once" is not a shape this can be in.
			* `entry` is the conversation the layer is about, and null for the lane's own read — the list's
			* details are about a read rather than about a person.
			*/
			const [sheet, setSheet] = (0, react.useState)(null);
			const listRef = (0, react.useRef)(null);
			const composerRef = (0, react.useRef)(null);
			const messagesRef = (0, react.useRef)(null);
			const returnToRef = (0, react.useRef)(null);
			const contactsGeneration = (0, react.useRef)(0);
			const threadGeneration = (0, react.useRef)(0);
			const retryRef = (0, react.useRef)(null);
			const openConversation = entries.find((conversation) => conversation.id === openId);
			const openContact = openConversation?.contact;
			const showingContacts = contactsView.kind === "ready";
			const scene = contactsView.kind === "ready" ? contactsView.contacts.length === 0 ? "contacts-empty" : "contacts" : contactsView.kind === "failed" ? "contacts-failed" : "contacts-reading";
			const posture = messagingStatus === "not-connected" && showingContacts ? "contacts-only" : messagingStatus;
			const contactName = (contact) => contact.name === "" ? t("contact.unnamed") : contact.name;
			const nameOf = (entry) => entry.contact === void 0 ? t("new.title") : contactName(entry.contact);
			/**
			* The whole key, and the only place it is read from. `handleOf` is what the details sheet shows and
			* what nothing on the list shows: a row that displayed it was Peter's "raw key on the main list",
			* and a row that displayed a slice of it was his "truncated contact name while an npub is shown".
			*/
			const handleOf = (entry) => entry.contact === void 0 ? t("new.handle") : entry.contact.npub;
			const messagesOf = (entry) => entry.sent.map((text) => ({
				from: "me",
				text
			}));
			/**
			* The row's one preview line: the newest thing this screen actually holds for that conversation.
			*
			* A LISTING READ CARRIES NO MESSAGE TEXT — `readContacts` returns seven leaf fields per contact and
			* none of them is a message — so for a contact whose conversation has not been read, the honest
			* preview is that there is nothing here yet, said in words rather than filled with a line this
			* screen invented. Text sent from this screen is held, so it is what a row shows once there is any.
			*/
			const previewOf = (entry) => {
				const said = entry.sent[entry.sent.length - 1];
				return said === void 0 ? t("row.nothing-sent") : said;
			};
			/** Open one of the two layers. Opening a conversation closes whatever was over it. */
			const openSheet = (kind, entry) => {
				setSheet({
					kind,
					entry
				});
			};
			const loadContacts = (0, react.useCallback)(() => {
				contactsGeneration.current += 1;
				const mine = contactsGeneration.current;
				setContactsView((current) => current.kind === "ready" ? current : { kind: "loading" });
				readContacts().then((read) => {
					if (contactsGeneration.current !== mine) return;
					setContactsView(read.kind === "ready" ? {
						kind: "ready",
						contacts: read.value.contacts,
						root: read.value.root
					} : {
						kind: "failed",
						failure: read.failure
					});
					if (read.kind === "ready") setEntries((current) => mergeContacts(current, read.value.contacts));
				});
			}, []);
			const loadThread = (0, react.useCallback)((npub) => {
				threadGeneration.current += 1;
				const mine = threadGeneration.current;
				setThread({ kind: "loading" });
				readThread(npub, null).then((read) => {
					if (threadGeneration.current !== mine) return;
					if (read.kind === "failed") {
						setThread({
							kind: "failed",
							failure: read.failure
						});
						return;
					}
					setThread({
						kind: "ready",
						thread: read.thread
					});
				});
			}, []);
			(0, react.useEffect)(() => {
				if (!active) return void 0;
				loadContacts();
				const timer = window.setInterval(() => {
					loadContacts();
				}, CONTACTS_POLL_MS);
				return () => {
					window.clearInterval(timer);
					contactsGeneration.current += 1;
				};
			}, [active, loadContacts]);
			(0, react.useEffect)(() => () => {
				if (retryRef.current !== null) window.clearTimeout(retryRef.current);
			}, []);
			(0, react.useEffect)(() => {
				if (!active) return;
				const onKeyDown = (event) => {
					if (event.key !== "Escape" || event.defaultPrevented) return;
					if (isEditableTarget(event.target)) return;
					event.preventDefault();
					if (sheet !== null) setSheet(null);
					else if (openId !== null) setOpenId(null);
					else closeSurface();
				};
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [
				active,
				closeSurface,
				openId,
				sheet
			]);
			(0, react.useEffect)(() => {
				if (!active) return;
				if (openId !== null) {
					composerRef.current?.focus();
					return;
				}
				const returning = returnToRef.current;
				if (returning === null) return;
				returnToRef.current = null;
				const row = listRef.current?.querySelector(`[data-person-row="${returning}"]`);
				if (row instanceof HTMLElement) row.focus();
			}, [active, openId]);
			(0, react.useEffect)(() => {
				const column = messagesRef.current;
				if (column === null) return;
				column.scrollTop = column.scrollHeight;
			}, [openId, openConversation === void 0 ? 0 : messagesOf(openConversation).length]);
			const mutate = (id, change) => {
				setEntries((current) => current.map((conversation) => conversation.id === id ? change(conversation) : conversation));
			};
			const toggleFilter = (key) => {
				setFilters((current) => ({
					...current,
					[key]: !current[key]
				}));
			};
			const openThread = (entry) => {
				mutate(entry.id, (conversation) => ({
					...conversation,
					unread: false
				}));
				returnToRef.current = entry.id;
				setSheet(null);
				setOpenId(entry.id);
				setDraft("");
				setReceipts((current) => {
					const next = { ...current };
					delete next[entry.id];
					return next;
				});
				if (entry.contact !== void 0) loadThread(entry.contact.npub);
				else setThread({ kind: "idle" });
			};
			/**
			* Send the draft. A contact row goes to the host and the receipt follows the response body; a
			* conversation with no contact behind it stays on this screen, where the viewer's own words are
			* the only ones in it.
			* @param entry - the open conversation.
			*/
			const sendTo = (entry) => {
				const text = draft.trim();
				if (text === "") return;
				const contact = entry.contact;
				if (contact === void 0) {
					mutate(entry.id, (current) => ({
						...current,
						sent: [...current.sent, text]
					}));
					setDraft("");
					return;
				}
				setDraft("");
				setReceipts((current) => ({
					...current,
					[entry.id]: { kind: "pending" }
				}));
				sendMessage(contact.npub, text).then((read) => {
					setReceipts((current) => {
						if (read.kind === "accepted") return {
							...current,
							[entry.id]: read
						};
						if (read.kind === "not-accepted") return {
							...current,
							[entry.id]: read
						};
						return {
							...current,
							[entry.id]: {
								kind: "failed",
								failure: read.failure
							}
						};
					});
					if (read.kind === "accepted") {
						mutate(entry.id, (current) => ({
							...current,
							sent: [...current.sent, text]
						}));
						if (retryRef.current !== null) window.clearTimeout(retryRef.current);
						retryRef.current = window.setTimeout(() => {
							loadThread(contact.npub);
						}, 1500);
					}
				});
			};
			const toggle = (entry, key) => {
				mutate(entry.id, (current) => ({
					...current,
					[key]: !current[key]
				}));
			};
			const visible = entries.filter((entry) => entry.archived === filters.archived && (!filters.pinned || entry.pinned) && (!filters.unread || entry.unread) && (query === "" || nameOf(entry).toLowerCase().includes(query.toLowerCase())));
			const openMessages = openConversation === void 0 ? [] : messagesOf(openConversation);
			const liveThread = thread.kind === "ready" ? thread.thread : void 0;
			const openThreadMessages = (liveThread?.messages ?? []).map((message) => ({
				from: message.from,
				text: message.text
			}));
			const openThreadSas = liveThread?.sas ?? openContact?.sas ?? null;
			const readBack = new Set(openThreadMessages.filter((message) => message.from === "me").map((message) => message.text));
			const openLiveMessages = openContact === void 0 ? openMessages : [...openThreadMessages, ...(openConversation?.sent ?? []).filter((text) => !readBack.has(text)).map((text) => ({
				from: "me",
				text
			}))];
			const openReceipt = openId === null ? void 0 : receipts[openId];
			const openCopies = openReceipt !== void 0 && (openReceipt.kind === "accepted" || openReceipt.kind === "not-accepted") ? openReceipt.copies : void 0;
			const openOutcome = openCopies === void 0 || openCopies.length === 0 ? void 0 : copyOutcomeOf(openCopies);
			const banner = bannerFor(posture);
			const openState = openContact?.state;
			const sheetEntry = sheet?.entry ?? null;
			const sheetState = sheetEntry?.contact?.state;
			const sheetSas = sheetEntry === null ? null : sheetEntry.id === openId ? openThreadSas : sheetEntry.contact?.sas ?? null;
			const closeSheet = () => {
				setSheet(null);
			};
			/**
			* Open the add-contact sheet, empty. The '+' USED TO INVENT A LOCAL CONVERSATION HERE (id `local-N`, handle
			* '@new') that could neither send nor receive and wrote nothing; step 4 deletes that path.
			*/
			const openAddContact = () => {
				setSheet({
					kind: "add",
					entry: null
				});
			};
			let lastMine = -1;
			openLiveMessages.forEach((message, index) => {
				if (message.from === "me") lastMine = index;
			});
			const detailsOf = (entry) => {
				const rows = [];
				const contact = entry?.contact;
				if (entry !== null) {
					rows.push({
						label: t("state.label"),
						value: contact === void 0 ? t("new.handle") : t(CONTACT_STATE[contact.state].detail)
					});
					rows.push({
						label: t("contact.npub"),
						value: handleOf(entry),
						mono: true,
						ref: "npub"
					});
				}
				rows.push({
					label: t("source.contacts.root"),
					value: contactsView.kind === "ready" ? contactsView.root : t(SCENE[scene].source),
					mono: contactsView.kind === "ready",
					ref: "source"
				});
				rows.push({
					label: t("details.host"),
					value: t(RUNTIME_POSTURE[posture].status),
					ref: "host"
				});
				if (entry !== null && entry.id === openId && liveThread !== void 0) rows.push({
					label: t("thread.answered"),
					value: liveThread.answered.length === 0 ? t("thread.unanswered") : liveThread.answered.join(", "),
					ref: "relays"
				});
				if (entry !== null && entry.id === openId && openReceipt !== void 0) {
					rows.push({
						label: t("details.sending"),
						value: markSentence(openReceipt, openOutcome, t),
						ref: "send"
					});
					for (const detail of openCopies === void 0 ? [] : copyRefusalDetails(openCopies)) rows.push({
						label: t("send.verdict"),
						value: detail,
						mono: true
					});
					if ((openReceipt.kind === "accepted" || openReceipt.kind === "not-accepted") && openReceipt.verdict !== "") rows.push({
						label: t("send.verdict"),
						value: openReceipt.verdict,
						mono: true
					});
				}
				return rows;
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				"data-messages-surface": true,
				className: Messages_module_css_default.surface,
				hidden: !active,
				"aria-hidden": !active,
				"aria-label": t("title"),
				children: [
					openConversation === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: Messages_module_css_default.lane,
						"data-messages-list": true,
						"data-messages-source": scene,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
								className: Messages_module_css_default.brandRow,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: Messages_module_css_default.brandMark,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChatMarkIcon, {})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
										className: Messages_module_css_default.brandName,
										"data-fit": "name",
										children: t("title")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: clsx(Messages_module_css_default.actions, Messages_module_css_default.brandActions),
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: Messages_module_css_default.iconButton,
												"aria-label": t("actions.new"),
												onClick: openAddContact,
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PlusIcon, {})
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: Messages_module_css_default.iconButton,
												"aria-label": t("contacts.refresh"),
												onClick: loadContacts,
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RefreshIcon, {})
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: clsx(Messages_module_css_default.iconButton, Messages_module_css_default.pinAction),
												"aria-label": t("filters.pinned"),
												"aria-pressed": filters.pinned,
												onClick: () => {
													toggleFilter("pinned");
												},
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PinIcon, {})
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: clsx(Messages_module_css_default.iconButton, Messages_module_css_default.unreadAction),
												"aria-label": t("filters.unread"),
												"aria-pressed": filters.unread,
												onClick: () => {
													toggleFilter("unread");
												},
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UnreadIcon, {})
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: clsx(Messages_module_css_default.iconButton, Messages_module_css_default.archiveAction),
												"aria-label": t("filters.archived"),
												"aria-pressed": filters.archived,
												onClick: () => {
													toggleFilter("archived");
												},
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ArchiveIcon, {})
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: Messages_module_css_default.iconButton,
												"aria-label": t("details.open"),
												"data-list-details": true,
												onClick: () => {
													openSheet("details", null);
												},
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(InfoIcon, {})
											})
										]
									})
								]
							}),
							banner !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: Messages_module_css_default.posture,
								"data-messaging-status": banner,
								"data-posture": POSTURE_TONE[banner],
								children: t(BANNER_STATUS[banner])
							}),
							contactsView.kind === "failed" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: Messages_module_css_default.notice,
								"data-messages-error": true,
								role: "alert",
								children: [contactsView.failure.kind === "refused" && contactsView.failure.reason === "messages:aumlok-not-linked" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: Messages_module_css_default.noticeTitle,
									children: t("contacts.unlinked.title")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									"data-messages-error-hint": true,
									children: t("contacts.unlinked.hint")
								})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: Messages_module_css_default.noticeTitle,
									children: t("contacts.error.title")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									"data-messages-error-hint": true,
									children: t("contacts.error.hint")
								})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
									className: Messages_module_css_default.noticeReason,
									"data-messages-error-reason": true,
									children: failureText(contactsView.failure)
								})]
							}),
							contactsView.kind === "ready" && contactsView.contacts.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: Messages_module_css_default.listEmpty,
								"data-messages-empty": true,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("contacts.none") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("contacts.none.hint") })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: Messages_module_css_default.searchRow,
								children: [searchOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: Messages_module_css_default.searchInput,
									value: query,
									placeholder: t("search.placeholder"),
									"aria-label": t("search.placeholder"),
									onChange: (event) => {
										setQuery(event.target.value);
									}
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: Messages_module_css_default.iconButton,
									"aria-label": t("actions.search"),
									"aria-pressed": searchOpen,
									onClick: () => {
										setSearchOpen((open) => !open);
										setQuery("");
									},
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SearchIcon, {})
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: Messages_module_css_default.rows,
								role: "list",
								ref: listRef,
								children: [visible.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ContactRow, {
									entry,
									t,
									name: nameOf(entry),
									preview: previewOf(entry),
									onOpen: openThread,
									onToggle: toggle,
									onDetails: (subject) => {
										openSheet("details", subject);
									}
								}, entry.id)), visible.length === 0 && entries.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: Messages_module_css_default.listEmpty,
									children: t("list.none")
								})]
							})
						]
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: Messages_module_css_default.thread,
						"data-messages-thread": true,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
								className: Messages_module_css_default.threadHeader,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: Messages_module_css_default.iconButton,
										"aria-label": t("back"),
										onClick: () => {
											setOpenId(null);
										},
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BackIcon, {})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: Messages_module_css_default.threadTitle,
										"data-fit": "name",
										children: nameOf(openConversation)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: Messages_module_css_default.headerTail,
										children: [openState !== void 0 && openState !== "VERIFIED" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: Messages_module_css_default.chip,
											"data-trust-chip": openState,
											"aria-label": t("verify.open"),
											onClick: () => {
												openSheet("verify", openConversation);
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ShieldIcon, {
												size: 12,
												verified: false
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: Messages_module_css_default.chipWord,
												"data-fit": "line",
												children: t("trust.unverified")
											})]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: Messages_module_css_default.actions,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: Messages_module_css_default.iconButton,
													"aria-label": t("details.open"),
													"data-thread-details": true,
													onClick: () => {
														openSheet("details", openConversation);
													},
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(InfoIcon, {})
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: clsx(Messages_module_css_default.iconButton, Messages_module_css_default.pinAction),
													"aria-label": t("thread.pin"),
													"aria-pressed": openConversation.pinned,
													onClick: () => {
														toggle(openConversation, "pinned");
													},
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PinIcon, {})
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: clsx(Messages_module_css_default.iconButton, Messages_module_css_default.archiveAction),
													"aria-label": t("thread.archive"),
													onClick: () => {
														toggle(openConversation, "archived");
														setOpenId(null);
													},
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ArchiveIcon, {})
												})
											]
										})]
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: Messages_module_css_default.messages,
								ref: messagesRef,
								children: [
									openContact !== void 0 && thread.kind === "loading" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: Messages_module_css_default.threadNotice,
										"data-thread-status": "loading",
										children: t("thread.loading")
									}),
									openContact !== void 0 && thread.kind === "failed" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: Messages_module_css_default.threadNotice,
										"data-thread-status": "failed",
										children: failureText(thread.failure)
									}),
									openContact !== void 0 && liveThread !== void 0 && liveThread.answered.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: Messages_module_css_default.threadNotice,
										"data-thread-status": "unanswered",
										children: t("thread.unanswered")
									}),
									openLiveMessages.map((message, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: message.from === "me" ? Messages_module_css_default.msgMe : Messages_module_css_default.msgThem,
										"data-message": message.from,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: Messages_module_css_default.bubbleText,
											children: message.text
										}), index === lastMine && openReceipt !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ReceiptMark, {
											receipt: openReceipt,
											outcome: openOutcome,
											t
										})]
									}, index)),
									openContact !== void 0 && thread.kind === "ready" && openLiveMessages.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: Messages_module_css_default.threadNotice,
										"data-thread-status": "none",
										children: t("thread.none")
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: Messages_module_css_default.composerCard,
								"data-messages-composer": true,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
									ref: composerRef,
									rows: 1,
									value: draft,
									placeholder: t("composer.placeholder"),
									"aria-label": t("composer.placeholder"),
									onChange: (event) => {
										setDraft(event.target.value);
									},
									onKeyDown: (event) => {
										if (event.key !== "Enter" || event.shiftKey) return;
										event.preventDefault();
										sendTo(openConversation);
									}
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: Messages_module_css_default.composerRow,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: Messages_module_css_default.sendCircle,
										"aria-label": t("composer.send"),
										disabled: draft.trim() === "",
										onClick: () => {
											sendTo(openConversation);
										},
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SendIcon, {})
									})
								})]
							})
						]
					}),
					sheet !== null && sheet.kind === "verify" && sheetEntry !== null && sheetState !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(VerifySheet, {
						state: sheetState,
						sas: sheetSas,
						contact: sheetEntry.contact?.name ?? sheetEntry.contact?.npub ?? "",
						npub: sheetEntry.contact?.npub ?? "",
						onConfirmed: loadContacts,
						t,
						onClose: closeSheet
					}),
					sheet !== null && sheet.kind === "add" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AddContactSheet, {
						t,
						onClose: closeSheet,
						onAdded: loadContacts
					}),
					sheet !== null && sheet.kind === "details" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DetailsSheet, {
						rows: detailsOf(sheetEntry),
						t,
						onClose: closeSheet
					})
				]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/** Messages launcher and person-to-person lane dictionaries. */
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"row.nothing-sent": "这里还没发出过消息。",
			"send.outcome.unread": "这条已经发出去了，但每一份去了哪里还没读回来。",
			"menu.title": "消息",
			"contact.unnamed": "还没有名字",
			"row.no-messages": "还没有消息",
			"trust.unverified": "未验证",
			"verify.open": "查看验证",
			"verify.title": "验证",
			"state.BOUND.title": "已绑定：密钥对得上；还没有人当面确认过。",
			"state.BOUND.detail": "密钥对得上；还没有人当面确认过",
			"verify.confirm.button": "我和 {contact} 当面核对了这些数字，它们一致",
			"verify.confirm.ready": "请两个人一起念出这六个数字。一致再按。",
			"details.open": "详情",
			"details.title": "详情",
			"details.host": "本机状态",
			"details.sending": "发送",
			"sheet.close": "关闭",
			"menu.description": "预览 — 本机通讯录；发送可用，接收尚未验证",
			"title": "消息",
			"runtime.status": "消息引擎未连接——本机通讯录还没有读到，这里也还没有收到过消息。由此发出的消息会被记录并发布",
			"runtime.status.contacts-only": "本机消息路由正在应答——通讯录与状态由本机读取，由此发出的消息会被记录并发布；接收尚未验证",
			"runtime.status.connected": "消息引擎已接通——通讯录与对话由本机路由读取",
			"source.contacts": "本机通讯录，实读",
			"source.contacts.root": "读取自",
			"source.contacts.reading": "正在读取本机通讯录…",
			"source.contacts.empty": "本机通讯录，实读——文件里一个联系人都没有",
			"source.contacts.failed": "没有列表——本机通讯录这次没有读到",
			"contacts.title": "通讯录",
			"contacts.none": "还没有联系人。",
			"contacts.none.hint": "本机通讯录文件里没有任何条目。在这台机器上添加一个联系人，下一次读取它就会出现在这里。",
			"contacts.roots.absent": "这个页面没有拿到状态目录，所以请求里没有 root 与 controllerDir。本机路由按名拒绝了它——没有任何列表可显示，而空的联系人列表会有另一种含义。",
			"contacts.loading": "正在读取本机通讯录…",
			"contacts.refresh": "重新读取通讯录",
			"contacts.error.title": "本机通讯录读取失败",
			"contacts.error.hint": "没有可显示的通讯录。下面一行是本机返回的原因，原样照录。",
			"contacts.unlinked.title": "先绑定你的 Aumlok 七个词",
			"contacts.unlinked.hint": "消息要用你的 Aumlok 身份来核对每个联系人。在 Aumlok 里绑定你的七个词，然后退出再重新打开 AUKORA。",
			"contact.npub": "npub",
			"contact.binding.absent": "没有出示任何绑定",
			"contact.binding.verified": "出示的绑定已验证",
			"contact.binding.refused": "出示的绑定未通过验证",
			"state.label": "身份状态",
			"state.VERIFIED.title": "已确认：有人当面核对了这些数字，并签署了确认。",
			"state.VERIFIED.detail": "已当面核对并签署确认",
			"state.TEST.title": "测试：绑定在结构上验证通过，但带着 TEST 标记——还不是某个人的声明。",
			"state.TEST.detail": "结构上有效，标为 TEST",
			"state.UNBOUND.title": "未绑定：本机持有这个 npub，但没有任何东西为它背书。",
			"state.UNBOUND.detail": "没有任何东西为它背书",
			"state.FOREIGN.title": "外来：出示了绑定，但它未通过验证。冒充看起来就是这样，而且绝不与未绑定合并。",
			"state.FOREIGN.detail": "出示的绑定未通过验证",
			"sas.label": "读出并比对",
			"sas.spoken": "口头",
			"sas.hint": "这是一段供两人用语音逐字比对的短验证串——不是身份，也不代表任何一方已被验证。",
			"sas.absent.VERIFIED": "已确认的绑定没有给出可读出的数字串。",
			"sas.absent.BOUND": "绑定对得上，但没有给出可读出的数字串。",
			"sas.absent.TEST": "没有可读出的验证串——TEST 标记的绑定不是某个人的声明。",
			"sas.absent.UNBOUND": "没有可读出的验证串——没有任何东西为这个 npub 背书，所以没有可比的数字。",
			"sas.absent.FOREIGN": "没有可读出的验证串——出示的绑定未通过验证。不要把人读出的数字当成已核对。",
			"thread.live": "对话",
			"thread.none": "这条对话里还没有消息。",
			"thread.loading": "正在读取对话…",
			"thread.unanswered": "没有任何中继回答这次读取，所以这里显示的不是「没有人写过消息」——而是没有人回答。",
			"thread.answered": "应答的中继：",
			"send.accepted": "已发送——接受这条消息的中继：",
			"send.unaccepted": "没有任何中继接受这条消息。它没有送达，也没有在对方那里显示为已送达。",
			"send.refused": "本机路由拒绝发送：",
			"send.pending": "正在发送…",
			"send.verdict": "判定：",
			"send.outcome.delivered": "已发送——收件人的副本和你自己的副本都被中继接受了。",
			"send.outcome.self-kept": "你自己那份留住了，对方那份被拒绝了。收件人的副本没有任何中继接受，所以对方看不到这条消息。",
			"send.outcome.recipient-kept": "对方那份已送出，你自己那份被拒绝了。收件人的副本已被中继接受；本机自己的副本没有留下，所以这里可能读不回这条消息。",
			"send.outcome.both-refused": "两份副本都被拒绝了——收件人的副本和你自己的副本都没有任何中继接受。这条消息没有送达。",
			"actions.new": "新建消息",
			"actions.search": "搜索对话",
			"search.placeholder": "搜索",
			"filters.pinned": "仅看置顶",
			"filters.unread": "仅看未读",
			"filters.archived": "查看归档",
			"status.pinned": "已置顶",
			"status.unread": "未读",
			"status.archived": "已归档",
			"row.pin": "置顶",
			"row.unpin": "取消置顶",
			"row.markUnread": "标为未读",
			"row.markRead": "标为已读",
			"row.archive": "归档",
			"row.unarchive": "取消归档",
			"list.none": "没有匹配的对话。",
			"back": "返回",
			"thread.pin": "置顶对话",
			"thread.archive": "归档对话",
			"composer.placeholder": "输入消息",
			"composer.send": "发送",
			"time.now": "刚刚",
			"new.title": "新对话",
			"new.handle": "@新朋友",
			"add.title": "添加联系人",
			"add.name": "名字",
			"add.npub": "npub",
			"add.controller": "对方的控制密钥（64 位小写十六进制）",
			"add.submit": "添加",
			"add.hint": "这三个字段由你核对。添加后为「已绑定」——密钥对得上，但还没有人当面确认过。",
			"add.added": "已添加 {name}（{npub}），状态 {state}。",
			"state.VERIFIED.word": "已确认",
			"state.BOUND.word": "已绑定",
			"state.TEST.word": "测试",
			"state.UNBOUND.word": "未绑定",
			"state.FOREIGN.word": "外来"
		};
		/** English dictionary, checked complete against the Chinese key set. */
		const en = {
			"row.nothing-sent": "Nothing has been sent from here yet.",
			"send.outcome.unread": "This was accepted; what happened to each copy has not been read yet.",
			"menu.title": "Messages",
			"contact.unnamed": "No name yet",
			"row.no-messages": "No messages yet",
			"trust.unverified": "Unverified",
			"verify.open": "Check verification",
			"verify.title": "Verification",
			"state.BOUND.title": "Bound: the key checks out; nobody has confirmed it in person.",
			"state.BOUND.detail": "the key checks out; nobody has confirmed it in person",
			"verify.confirm.button": "I compared these digits with {contact} and they matched",
			"verify.confirm.ready": "Read the six digits aloud together. Press only if they match.",
			"details.open": "Details",
			"details.title": "Details",
			"details.host": "Host status",
			"details.sending": "Sending",
			"sheet.close": "Close",
			"menu.description": "preview — this node’s contacts; sending works, receiving is not proven yet",
			"title": "Messages",
			"runtime.status": "Messaging engine not connected — no contacts have been read from this node yet, and nothing has been received here. A message sent from here is still recorded and published",
			"runtime.status.contacts-only": "The local messaging route is answering — contacts and their states are read from this machine, and a message sent from here is recorded and published. Receiving is not proven yet",
			"runtime.status.connected": "Messaging engine connected — contacts and conversations are read from the local route",
			"source.contacts": "Local contacts, read live",
			"source.contacts.root": "read from",
			"source.contacts.reading": "Reading the local contacts…",
			"source.contacts.empty": "Local contacts, read live — the file lists nobody",
			"source.contacts.failed": "No listing — this read of the local contacts did not come back",
			"contacts.title": "Contacts",
			"contacts.none": "No contacts yet.",
			"contacts.none.hint": "The local contacts file has no entries. Add a contact on this node and it will appear here on the next read.",
			"contacts.roots.absent": "This page was not given the state directory, so the request carried no root and no controllerDir. The local route refused it by name — there is no listing to show, and an empty contact list would mean something else.",
			"contacts.loading": "Reading the local contacts…",
			"contacts.refresh": "Read the contacts again",
			"contacts.error.title": "Reading the local contacts failed",
			"contacts.error.hint": "There is no listing to show. The reason the local route gave is below, exactly as it was returned.",
			"contacts.unlinked.title": "Link your Aumlok phrase first",
			"contacts.unlinked.hint": "Messages checks every contact against your Aumlok identity. Open Aumlok and link your seven words, then quit and reopen AUKORA.",
			"contact.npub": "npub",
			"contact.binding.absent": "no binding was presented",
			"contact.binding.verified": "the presented binding verified",
			"contact.binding.refused": "the presented binding did not verify",
			"state.label": "identity state",
			"state.VERIFIED.title": "Verified: a person compared these digits and signed a confirmation.",
			"state.VERIFIED.detail": "compared in person and signed",
			"state.TEST.title": "Test: the binding verifies structurally and is TEST-labelled — not yet a claim about a person.",
			"state.TEST.detail": "structurally valid, TEST-labelled",
			"state.UNBOUND.title": "Unbound: this node holds the npub and nothing vouches for it.",
			"state.UNBOUND.detail": "nothing vouches for it",
			"state.FOREIGN.title": "Foreign: something was presented and it did not verify. An impersonation attempt looks like this, and it is never merged with unbound.",
			"state.FOREIGN.detail": "the presented binding did not verify",
			"sas.label": "read aloud and compare",
			"sas.spoken": "spoken",
			"sas.hint": "A short string for two people to compare by voice, word for word — it is not an identity, and it does not mean either side has been verified.",
			"sas.absent.VERIFIED": "The confirmed binding carried no string to read aloud.",
			"sas.absent.BOUND": "The binding checks out and carried no string to read aloud.",
			"sas.absent.TEST": "No string to read aloud — a TEST-labelled binding is not a claim about a person.",
			"sas.absent.UNBOUND": "No string to read aloud — nothing vouches for this npub, so there are no digits to compare.",
			"sas.absent.FOREIGN": "No string to read aloud — the presented binding did not verify. Do not treat digits read aloud as checked.",
			"thread.live": "Conversation",
			"thread.none": "No messages in this conversation yet.",
			"thread.loading": "Reading the conversation…",
			"thread.unanswered": "No relay answered this read, so this is not \"nobody wrote to you\" — it is that nobody answered.",
			"thread.answered": "Relays that answered:",
			"send.accepted": "Sent — relays that accepted it:",
			"send.unaccepted": "No relay accepted this message. It was not delivered and it is not shown as delivered on the other side.",
			"send.refused": "The local route refused the send:",
			"send.pending": "Sending…",
			"send.verdict": "verdict:",
			"send.outcome.delivered": "Sent — relays accepted both the recipient’s copy and your own copy.",
			"send.outcome.self-kept": "Kept yours, theirs refused. No relay accepted the recipient’s copy, so it is not delivered and the other side cannot see this message.",
			"send.outcome.recipient-kept": "The recipient’s copy went out and your own copy was refused. A relay accepted the recipient’s copy; this node kept none of its own, so this message may not read back here.",
			"send.outcome.both-refused": "Both copies were refused — no relay accepted the recipient’s copy or your own. This message was not delivered.",
			"actions.new": "New message",
			"actions.search": "Search conversations",
			"search.placeholder": "Search",
			"filters.pinned": "Pinned only",
			"filters.unread": "Unread only",
			"filters.archived": "Archived only",
			"status.pinned": "Pinned",
			"status.unread": "Unread",
			"status.archived": "Archived",
			"row.pin": "Pin",
			"row.unpin": "Unpin",
			"row.markUnread": "Mark unread",
			"row.markRead": "Mark read",
			"row.archive": "Archive",
			"row.unarchive": "Unarchive",
			"list.none": "No conversations match.",
			"back": "Back",
			"thread.pin": "Pin conversation",
			"thread.archive": "Archive conversation",
			"composer.placeholder": "Type a message",
			"composer.send": "Send",
			"time.now": "now",
			"new.title": "New conversation",
			"new.handle": "@new",
			"add.title": "Add a contact",
			"add.name": "Name",
			"add.npub": "npub",
			"add.controller": "Their controller key (64 lower-case hex)",
			"add.submit": "Add",
			"add.hint": "You check these three yourself. The contact is added as Bound — the key checks out, and nobody has confirmed it in person.",
			"add.added": "Added {name} ({npub}), shown as {state}.",
			"state.VERIFIED.word": "Verified",
			"state.BOUND.word": "Bound",
			"state.TEST.word": "Test",
			"state.UNBOUND.word": "Unbound",
			"state.FOREIGN.word": "Foreign"
		};
		//#endregion
		//#region src/client/index.ts
		const NS = "messages";
		/** Services required by the Messages browser plugin. */
		const inject = ["slots", "locale"];
		/**
		* Register the Messages dictionaries, Apps launcher, and center surface.
		* @param ctx - Client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "ui-messages: dictionaries");
			ctx.slots.inject("shell.menu.apps", () => ctx.slots.register({
				name: "shell.menu.apps",
				id: "messages",
				order: 50,
				locale: NS
			}, MessagesMenu));
			ctx.slots.inject("shell.surface", () => ctx.slots.register({
				name: "shell.surface",
				id: "messages",
				order: 50,
				locale: NS
			}, MessagesSurface));
		}
		//#endregion
		exports.MessagesSurface = MessagesSurface;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map