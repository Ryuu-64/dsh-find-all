/*! dsh-find-all. Copyright (c) 2026 secyborg; Copyright (c) 2026 Ryuu-64. MIT.
 * Forked from secyborg/dsh-find-bar ce7eb75efe94d768127c5977c649ecd950a9356c. See LICENSE and NOTICE.md. */
import { createHistoryReader } from "./history.js";
import { createProjector, collectProjectedBlocks, rangeForBlock, mapProjectedDocument } from "./projection.js";

var BAR_ID = "dsh-find-all-root";
		var HL_ALL = "dsh-find-all-hit";
		var HL_CUR = "dsh-find-all-cur";
		var MAX_MATCHES = 5000;
		var CONTENT_TYPES = ["user", "assistant", "assistant-rich", "reasoning", "tool", "subagent", "context"];
		var DEFAULT_CONTENT_TYPES = { user: true, assistant: true, "assistant-rich": true, reasoning: false, tool: false, subagent: false, context: false };
		/** Safety cap on paged-in history: 400 pages x 50 messages. */
		var MAX_PAGES = 400;
		/** How long one page may take before the pager gives up on it. */
		var PAGE_SETTLE_MS = 5000;
		var PAGE_POLL_MS = 150;
		/** How often the open bar notices that the user switched session. */
		var SESSION_POLL_MS = 600;
		var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1 };
		// Structural boundaries, not a computed-style visibility policy. In
		// particular, host message divs and code-content/toolbars stay separate.
		var BLOCK_TAGS = {
			ADDRESS: 1, ARTICLE: 1, ASIDE: 1, BLOCKQUOTE: 1, DD: 1, DETAILS: 1,
			DIALOG: 1, DIV: 1, DL: 1, DT: 1, FIELDSET: 1, FIGCAPTION: 1, FIGURE: 1,
			FOOTER: 1, FORM: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1,
			HEADER: 1, HR: 1, LI: 1, MAIN: 1, NAV: 1, OL: 1, P: 1, PRE: 1,
			SECTION: 1, SUMMARY: 1, TABLE: 1, TBODY: 1, TD: 1, TFOOT: 1,
			TH: 1, THEAD: 1, TR: 1, UL: 1
		};

		var ZH = typeof navigator !== "undefined" && /^zh/i.test(navigator.language || "");
		var L = ZH ? {
			placeholder: "在此会话中查找…",
			prev: "上一个匹配",
			next: "下一个匹配",
			close: "关闭查找",
			move: "拖动查找栏；点击展开移动按钮", moveLeft: "向左移动", moveRight: "向右移动", moveUp: "向上移动", moveDown: "向下移动", resetPosition: "恢复默认位置",
			cap: "仅显示前 {n} 处匹配",
			resultCount: "{n} 个结果",
            jumpNumber: "跳转到结果序号", jumpRange: "输入 1–{n} 的整数；Enter 跳转，Esc 取消。", jumpInvalid: "请输入 1–{n} 的整数。",
			contentButton: "搜索选项",
			scopeLegend: "搜索范围",
			refreshHistory: "重新读取最新会话历史",
			copyDiagnostics: "复制诊断信息", copyingDiagnostics: "正在复制…", copiedDiagnostics: "诊断信息已复制，可粘贴到“反馈问题”中", copyDiagnosticsFailed: "复制失败，请重试",
			about: "关于", aboutUnavailable: "当前宿主无法显示关于对话框", aboutClose: "关闭关于", aboutDescription: "在 DSH Desktop 中搜索当前会话的已保存历史，并跳转到原聊天位置。",
            aboutAuthor: "作者", aboutSupport: "支持与交流", aboutRepository: "源码与说明", aboutGroup: "QQ 交流群", aboutCopy: "复制群号", aboutCopying: "正在复制…", aboutCopied: "群号已复制", aboutCopyFailed: "复制失败，请手动复制群号", aboutCredits: "致谢与许可", aboutUpstream: "基于 secyborg/dsh-find-bar 开发，感谢 secyborg 提供原始查找功能。", aboutNotices: "完整致谢与第三方许可",
            feedbackIssue: "反馈问题（GitHub）", feedbackPrivacy: "需 GitHub 账号；提交后公开。请粘贴诊断信息并说明复现步骤。",
			refreshUnavailable: "完整会话范围下可重新读取历史",
			contentButtonLabel: "搜索选项；{scope}；已选择 {n} 种内容{changed}",
			optionsChanged: "；已修改默认设置",
			contentLegend: "选择要搜索的内容类型",
			contentReset: "恢复默认内容类型",
			contentTypes: { user: "用户发送的消息", assistant: "助手最终回复", "assistant-rich": "最终回复中的代码、链接、引用和列表", reasoning: "思考过程", tool: "工具调用和工具结果", subagent: "子代理原始回传", context: "注入上下文" },
			scopeWhole: "完整会话",
			scopePage: "已加载内容",
			loading: "正在搜索完整对话…",
			available: "部分历史内容无法读取，搜索结果可能不完整。",
			capped: "历史内容较多，搜索结果可能不完整。",
			stopTip: "点击停止加载",
			noService: "暂时无法搜索完整对话，已显示当前找到的结果。",
			noTarget: "当前主会话没有可搜索的聊天正文",
			noRoot: "当前会话的搜索范围不可用",
			incomplete: "搜索未完成，已显示当前找到的结果。",
			find: "查找会话",
			returnPosition: "返回搜索前位置", returning: "正在返回…", returned: "已返回搜索前位置",
			returnAvailable: "已跳到匹配；可返回搜索前位置",
			matchRevealFailed: "已找到匹配，但宿主未能展开并显示它。可手动展开后重试。",
			jumpHint: "找到 {n} 个结果；按 Enter 或向下跳到第一个，按向上跳到最后一个。",
			originUnavailable: "未能记录当前阅读位置；仍可查找，但无法返回",
			returnCancelled: "已取消返回", returnFailed: "未能返回原位置。",
			return_removed: "原内容已不再可用。", return_render: "原内容已加载，但宿主未能显示原段落。可展开原内容后重试。",
			return_unavailable: "宿主无法提供所需内容或定位能力。", return_capped: "已达到历史加载上限，可重试。",
			return_stalled: "等待内容时没有进展，可重试。", return_error: "读取原内容失败，可重试。",
			return_position: "宿主未保持原段落可见。可先在正文内滚动，再重试。"
		} : {
			placeholder: "Find in this conversation…",
			prev: "Previous match",
			next: "Next match",
			close: "Close find",
			move: "Drag find bar; click for move controls", moveLeft: "Move left", moveRight: "Move right", moveUp: "Move up", moveDown: "Move down", resetPosition: "Reset position",
			cap: "Showing only the first {n} matches",
			resultCount: "{n} results",
            jumpNumber: "Go to match number", jumpRange: "Enter an integer from 1 to {n}; Enter to jump, Escape to cancel.", jumpInvalid: "Enter an integer from 1 to {n}.",
			contentButton: "Search options",
			scopeLegend: "Search scope",
			refreshHistory: "Refresh saved history",
			copyDiagnostics: "Copy diagnostics", copyingDiagnostics: "Copying…", copiedDiagnostics: "Diagnostics copied. Paste them into Report an issue", copyDiagnosticsFailed: "Copy failed. Try again",
			about: "About", aboutUnavailable: "This host cannot display the About dialog", aboutClose: "Close About", aboutDescription: "Search the current conversation’s saved history in DSH Desktop and jump to the original messages.",
            aboutAuthor: "Author", aboutSupport: "Support and community", aboutRepository: "Source and documentation", aboutGroup: "QQ group", aboutCopy: "Copy group number", aboutCopying: "Copying…", aboutCopied: "Group number copied", aboutCopyFailed: "Copy failed. Copy the group number manually", aboutCredits: "Credits and license", aboutUpstream: "Based on secyborg/dsh-find-bar. Thanks to secyborg for the original find functionality.", aboutNotices: "Full credits and third-party licenses",
            feedbackIssue: "Report an issue (GitHub)", feedbackPrivacy: "GitHub account required; submitted issues are public. Paste diagnostics and describe the steps to reproduce.",
			refreshUnavailable: "Refresh is available for Whole conversation",
			contentButtonLabel: "Search options; {scope}; {n} content types selected{changed}",
			optionsChanged: "; defaults changed",
			contentLegend: "Choose content types to search",
			contentReset: "Reset content types",
			contentTypes: { user: "User messages", assistant: "Assistant final replies", "assistant-rich": "Code, links, quotes, and lists in final replies", reasoning: "Reasoning", tool: "Tool calls and results", subagent: "Raw subagent returns", context: "Injected context" },
			scopeWhole: "Whole conversation",
			scopePage: "Loaded content",
			loading: "Searching the whole conversation…",
			available: "Some history could not be read, so results may be incomplete.",
			capped: "This conversation is long, so results may be incomplete.",
			stopTip: "Click to stop loading",
			noService: "The whole conversation cannot be searched right now. Showing the results found so far.",
			noTarget: "No searchable chat content in the main conversation",
			noRoot: "Search scope unavailable for this conversation",
			incomplete: "Search did not finish. Showing the results found so far.",
			find: "Find in conversation",
			returnPosition: "Return to reading position", returning: "Returning…", returned: "Returned to reading position",
			returnAvailable: "Moved to a match; return to the reading position is available",
			matchRevealFailed: "A match was found, but the host could not reveal and display it. Expand the section and retry.",
			jumpHint: "{n} matches found; Enter or Next goes to the first, Previous goes to the last.",
			originUnavailable: "The current reading position could not be saved; search remains available, but return is unavailable",
			returnCancelled: "Return cancelled", returnFailed: "Could not return to the reading position.",
			return_removed: "The original content is no longer available.", return_render: "The content is loaded, but the host could not display the original passage. Expand it and retry.",
			return_unavailable: "The host cannot provide the required content or positioning capability.", return_capped: "History page limit reached. You can retry.",
			return_stalled: "No progress while waiting for content. You can retry.", return_error: "Loading the original content failed. You can retry.",
			return_position: "The host did not keep the original passage visible. Try scrolling in the conversation, then retrying."
		};

		//#region pure helpers (exported for tests)

		// Literal, locale-independent Unicode simple folding on the ORIGINAL
		// text. RegExp returns UTF-16 offsets, exactly as DOM Range requires.
		// No normalization, full case folding, or transformed-string offsets.
		function findMatches(text, query) {
			if (!query) return [];
			// This is the entire pattern (not interpolated into another regex).
			// Escape regex syntax only; '-' and '/' are literal in this context.
			// Do not require the newer RegExp.escape() API in supported hosts.
			var literal = String(query).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			if (!literal) return [];
			var haystack = String(text);
			var matcher = new RegExp(literal, "giu");
			var out = [];
			var match;
			while (out.length < MAX_MATCHES && (match = matcher.exec(haystack)) !== null) {
				out.push({ start: match.index, end: match.index + match[0].length });
			}
			return out;
		}

		function findIndices(text, query) {
			return findMatches(text, query).map(function (match) { return match.start; });
		}

		// Keyboard routing, isolated so tests can drive it with spies.
		function createHandlers(ops) {
			return function onKeydown(event) {
				// Route the inline match editor before global capture-phase shortcuts.
                if (ops.matchNumberKey && ops.matchNumberKey(event)) return;
				// Let actual modals and editors with their own find UI own their keys.
				if (event.defaultPrevented || event.isComposing || (ops.ownsKeys && !ops.ownsKeys(event))) return;
				var meta = event.metaKey || event.ctrlKey;
				var key = event.key;
				if (meta && (key === "f" || key === "F")) {
					event.preventDefault();
					event.stopPropagation();
					ops.open(event.target);
					return;
				}
				if (!ops.isOpen()) return;
				if (key === "Escape") {
					event.preventDefault();
					ops.close();
					return;
				}
				var jumpKey = (meta && (key === "g" || key === "G")) || key === "F3";
				if (jumpKey) {
					event.preventDefault();
					ops.goTo(event.shiftKey ? -1 : 1);
					return;
				}
				if (key === "Enter" && !event.isComposing && ops.isBarInput(event.target)) {
					event.preventDefault();
					ops.goTo(event.shiftKey ? -1 : 1);
				}
			};
		}

		/** Page only while the public host state is ready; false is not completeness.
		 * Dependencies supply cancellable, bounded readiness/load/DOM waits.
		 * @returns { pages, reason } with done, cancelled, capped, stalled, unknown or error.
		 */
		async function runPageIn(opts) {
			var pages = 0;
			function result(reason) { return { pages: pages, reason: reason }; }
			for (;;) {
				if (opts.isCancelled()) return result("cancelled");
				var ready = await opts.waitReady();
				if (opts.isCancelled()) return result("cancelled");
				if (ready.reason) return result(ready.reason);
				if (ready.hasMore === false) return result("done");
				if (pages >= opts.maxPages) return result("capped");
				var before = opts.signature();
				var loaded;
				try { loaded = await opts.loadOlder(); }
				catch (error) { loaded = { reason: "error" }; }
				if (opts.isCancelled()) return result("cancelled");
				ready = await opts.waitReady(!!(loaded && loaded.reason));
				if (opts.isCancelled()) return result("cancelled");
				if (loaded && loaded.reason) return result(loaded.reason);
				if (ready.reason) return result(ready.reason);
				if (loaded && loaded.deferred) continue;
				if (ready.hasMore !== false) await opts.waitChange(before);
				if (opts.isCancelled()) return result("cancelled");
				ready = await opts.waitReady();
				if (opts.isCancelled()) return result("cancelled");
				if (ready.reason) return result(ready.reason);
				var changed = opts.signature() !== before;
				if (changed) {
					pages += 1;
					if (opts.onProgress) opts.onProgress(pages);
				}
				if (opts.isCancelled()) return result("cancelled");
				if (ready.hasMore === false) return result("done");
				if (!changed) return result("stalled");
			}
		}
		//#endregion

		function cssText() {
			return "" +
				"#" + BAR_ID + "{--dsh-find-all-max-width:480px;container:dsh-find-all / inline-size;position:fixed;top:var(--dsh-find-all-bar-top);right:var(--dsh-find-all-bar-right);z-index:2147483000;visibility:hidden;isolation:isolate;box-sizing:border-box;align-items:stretch;gap:4px;padding:6px 8px;display:flex;flex-direction:column;width:min(var(--dsh-find-all-max-width),var(--dsh-find-all-panel-width));max-width:calc(100vw - 16px);max-height:var(--dsh-find-all-max-height);overflow:auto;background:transparent;--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);border:0;border-radius:var(--dsw-radius-md,8px);box-shadow:var(--dsw-elevation-panel,var(--dsw-shadow-lv2))}" +
				"#" + BAR_ID + "[data-positioned]{visibility:visible}" +
				"#" + BAR_ID + ":before,#" + BAR_ID + "-content-panel:before{content:\"\";position:absolute;inset:0;z-index:-1;pointer-events:none;border-radius:inherit;background:var(--dsw-menu-surface-fill,var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2)));-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter,blur(40px) saturate(150%));backdrop-filter:var(--dsw-menu-backdrop-filter,blur(40px) saturate(150%))}" +
				"#" + BAR_ID + " .controls{display:flex;flex-wrap:nowrap;align-items:center;gap:4px;min-width:0}" +
				"#" + BAR_ID + " input.query{box-sizing:border-box;flex:1 1 0;min-width:64px;max-width:100%;width:auto;height:28px;color:var(--dsw-alias-label-primary);font:13px/1 var(--dsw-font-family);background:var(--dsw-alias-bg-base);border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm,6px);outline:none;padding:0 8px}" +
				"#" + BAR_ID + " input.query:focus-visible{border-color:var(--dsw-alias-state-business-primary)}" +
				"#" + BAR_ID + " .count{flex:0 1 auto;min-width:44px;max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font:12px/1 var(--dsw-font-family);font-variant-numeric:tabular-nums;text-align:center}" +
				"#" + BAR_ID + " button.count{width:auto;padding:0 4px;flex:0 1 auto}#" + BAR_ID + " button.count[hidden],#" + BAR_ID + " .count-editor[hidden],#" + BAR_ID + " .count-hint[hidden]{display:none}" +
                "#" + BAR_ID + " .count-editor{display:flex;align-items:center;gap:2px;flex:none;color:var(--dsw-alias-label-tertiary);font:12px/1 var(--dsw-font-family);font-variant-numeric:tabular-nums}#" + BAR_ID + " input.count-input{box-sizing:border-box;width:5.5ch;min-width:0;height:28px;padding:0 3px;text-align:right;font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l4);border-radius:4px}#" + BAR_ID + " input.count-input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}#" + BAR_ID + " input.count-input[aria-invalid=true]{border-color:var(--dsw-alias-state-error-primary,#c33)}" +
                "#" + BAR_ID + " .count-hint{padding:2px 8px 0 32px;color:var(--dsw-alias-label-secondary);font:12px/1.5 var(--dsw-font-family);overflow-wrap:anywhere}#" + BAR_ID + " .count-hint[data-error]{color:var(--dsw-alias-state-error-primary,#c33)}" +
                "#" + BAR_ID + " .status{box-sizing:border-box;width:100%;padding:2px 8px 4px 32px;color:var(--dsw-alias-label-tertiary);font:12px/1.5 var(--dsw-font-family);text-align:left;white-space:normal;overflow-wrap:anywhere}" +
				"#" + BAR_ID + " .status:empty{display:none}" +
				"#" + BAR_ID + " .position-controls{display:flex;flex-wrap:wrap;align-items:center;gap:4px}" +
				"#" + BAR_ID + " .position-controls[hidden]{display:none}" +
				"#" + BAR_ID + " button.drag-handle{touch-action:none;user-select:none;cursor:grab;flex:none}" +
				"#" + BAR_ID + "[data-dragging] button.drag-handle{cursor:grabbing}" +
				"#" + BAR_ID + " .status[data-busy]{cursor:pointer;color:var(--dsw-alias-state-business-primary)}" +
				"#" + BAR_ID + " .navigation-controls{display:flex;align-items:center;gap:4px;flex:none}" +
				"#" + BAR_ID + " .content-filter{position:relative;width:28px;padding:0}" +
				"#" + BAR_ID + " .content-filter[aria-expanded=true]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-button-ghost-active-fill,var(--dsw-alias-interactive-bg-hover))}" +
				"#" + BAR_ID + " .content-filter[aria-expanded=true]:hover{background:var(--dsw-alias-button-ghost-active-hover,var(--dsw-alias-interactive-bg-active))}" +
				"#" + BAR_ID + " .content-filter[data-filtered]:after{content:\"\";position:absolute;top:3px;right:3px;width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-state-business-primary)}" +
				"#" + BAR_ID + "-content-panel{position:fixed;z-index:2147483001;isolation:isolate;box-sizing:border-box;display:flex;flex-direction:column;min-width:0;width:320px;max-width:calc(100vw - 16px);margin:0;padding:0;overflow:hidden;--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent,var(--dsw-elevation-panel,var(--dsw-shadow-lv2)));color:var(--dsw-alias-label-primary);font:13px/20px var(--dsw-font-family);border:0;border-radius:var(--dsw-radius-md,8px);background:transparent}" +
				"#" + BAR_ID + "-content-panel[hidden]{display:none}" +
				"#" + BAR_ID + "-content-panel .content-viewport{min-height:0;overflow:auto;padding:4px;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}" +
				"#" + BAR_ID + "-content-panel fieldset{min-width:0;margin:0;padding:0;border:0}" +
				"#" + BAR_ID + "-content-panel legend{box-sizing:border-box;width:100%;padding:4px 8px;font:500 11px/16px var(--dsw-font-family);color:var(--dsw-alias-label-tertiary)}" +
				"#" + BAR_ID + "-content-panel .content-options{display:grid;grid-template-columns:minmax(0,1fr)}" +
				"#" + BAR_ID + "-content-panel .content-option{box-sizing:border-box;min-width:0;min-height:28px;padding:4px 8px;align-items:center;gap:6px;display:flex;border-radius:var(--dsw-radius-sm,6px);cursor:pointer}" +
				"#" + BAR_ID + "-content-panel .content-option:hover{background:var(--dsw-alias-interactive-bg-hover)}" +
				"#" + BAR_ID + "-content-panel .content-option span{min-width:0;overflow-wrap:anywhere}" +
				"#" + BAR_ID + "-content-panel .content-option input{appearance:auto;accent-color:var(--dsw-alias-brand-primary,var(--dsw-alias-state-business-primary));flex:none;width:16px;height:16px;margin:0;cursor:inherit}" +
				"#" + BAR_ID + "-content-panel .content-reset{margin-top:4px;padding:0 8px;font:12px/18px var(--dsw-font-family)}" +
				"#" + BAR_ID + "-content-panel .scope-group{padding-bottom:4px;margin-bottom:4px;border-bottom:1px solid var(--dsw-alias-border-l1)}" +
				"#" + BAR_ID + "-content-panel .history-command{margin-top:4px;padding-top:4px;border-top:1px solid var(--dsw-alias-border-l1)}" +
				"#" + BAR_ID + "-content-panel .diagnostic-command{display:flex;flex-wrap:wrap;align-items:center;gap:4px}" +
                "#" + BAR_ID + "-content-panel .diagnostic-command button{flex:1;width:auto}" +
                "#" + BAR_ID + "-content-panel .diagnostic-feedback{padding:0 8px;font:12px/18px var(--dsw-font-family);color:var(--dsw-alias-label-secondary)}" +
                "#" + BAR_ID + "-content-panel .feedback-issue{display:flex;align-items:center;gap:6px;box-sizing:border-box;min-height:28px;width:100%;padding:4px 8px;color:var(--dsw-alias-label-secondary);text-decoration:none;border-radius:var(--dsw-radius-sm,6px)}#" + BAR_ID + "-content-panel .feedback-issue:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}#" + BAR_ID + "-content-panel .feedback-privacy{margin:0;padding:0 8px 4px;font:12px/18px var(--dsw-font-family);color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}" +
				"#" + BAR_ID + "-content-panel .history-command button{width:100%;height:auto;min-height:28px;justify-content:flex-start;gap:6px;padding:4px 8px;text-align:left;font:13px/20px var(--dsw-font-family)}" +
				"#" + BAR_ID + " button,#" + BAR_ID + "-content-panel button{box-sizing:border-box;flex:none;height:28px;min-width:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:var(--dsw-radius-sm,6px);align-items:center;justify-content:center;display:inline-flex}" +
				"#" + BAR_ID + " button[hidden]{display:none}" +
				"#" + BAR_ID + " button:hover,#" + BAR_ID + "-content-panel button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}" +
				"#" + BAR_ID + " button:focus-visible,#" + BAR_ID + "-content-panel :focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}" +
				"#" + BAR_ID + " button:disabled,#" + BAR_ID + "-content-panel button:disabled{opacity:.5;cursor:default}" +
				"#" + BAR_ID + " [data-find-all-return][hidden]{display:none}" +
				"#" + BAR_ID + " [data-find-all-return]{gap:4px;padding:0 8px;white-space:nowrap}" +
				"@container dsh-find-all (max-width:550px){#" + BAR_ID + " .return-label{display:none}#" + BAR_ID + " [data-find-all-return]{padding:0 6px}}" +
				"@container dsh-find-all (max-width:360px){#" + BAR_ID + " .controls,#" + BAR_ID + " .navigation-controls{gap:2px}#" + BAR_ID + " .count{min-width:32px;max-width:64px}#" + BAR_ID + " .status{padding-left:30px}}" +
				"#" + BAR_ID + " svg{pointer-events:none}" +
				"#" + BAR_ID + "[data-about-open]{z-index:999;pointer-events:none}" +
                ".dsh-find-all-about{max-height:100%;font-family:var(--dsw-font-family)}.dsh-find-all-about-content{min-height:0;overflow:auto}.dsh-find-all-about-details{display:flex;flex-direction:column;gap:16px;color:var(--dsw-alias-label-primary);font:13px/20px var(--dsw-font-family);overflow-wrap:anywhere}.dsh-find-all-about-details p{margin:0}.dsh-find-all-about-details h3{margin:0 0 6px;font:500 13px/20px var(--dsw-font-family)}.dsh-find-all-about-details a{color:var(--dsw-alias-state-business-primary);text-underline-offset:3px}.dsh-find-all-about-links{display:flex;flex-wrap:wrap;gap:6px 16px}.dsh-find-all-about-group{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px}.dsh-find-all-about-status{color:var(--dsw-alias-label-secondary)}.dsh-find-all-about-details :focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}" +
                "::highlight(" + HL_ALL + "){background-color:rgba(245,197,24,.42)}" +
				"::highlight(" + HL_CUR + "){background-color:#f5a623;color:#141414}";
		}

		function injectCss() {
			if (typeof document === "undefined") return;
			var tagId = "dsh-find-all/bar.css";
			if (document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
				var tag = document.createElement("style");
				tag.setAttribute("data-plugin-css", tagId);
				tag.textContent = cssText();
				document.head.appendChild(tag);
			}
		}

		function highlightsSupported() {
			return typeof CSS !== "undefined" && CSS.highlights && typeof Highlight === "function";
		}

		// Keep the existing pager signature collector unchanged. Matching below
		// uses separate block snapshots; page-settlement semantics are out of scope.
		function collectTextNodes(root, into) {
			if (!root) return into;
			var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
				acceptNode: function (node) {
					var parent = node.parentElement;
					if (parent === null) return NodeFilter.FILTER_REJECT;
					if (SKIP_TAGS[parent.tagName]) return NodeFilter.FILTER_REJECT;
					if (parent.closest && parent.closest("#" + BAR_ID)) return NodeFilter.FILTER_REJECT;
					return node.data.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
				}
			});
			var node;
			while ((node = walker.nextNode()) !== null) {
				into.push(node);
				// descend shadow roots hosted by element siblings of this text
			}
			// shadow roots are not reached by TreeWalker — walk elements separately
			var elems = root.querySelectorAll ? root.querySelectorAll("*") : [];
			for (var i = 0; i < elems.length; i++) {
				if (elems[i].shadowRoot) collectTextNodes(elems[i].shadowRoot, into);
			}
			return into;
		}

		// MessageIconActions is host chrome: copy/branch controls, Turn usage and
		// the local clock. It must never change the conversation result set merely
		// because hover/focus changes its opacity. Current hosts expose data-clock
		// on that row. The structural fallback is limited to the four admitted
		// pre-data-clock hosts, whose official MessageItem/TurnTailNodeView sources
		// render the same icon-only copy action in the verified positions below.
		function legacyMessageActionRows(root) {
			var rows = new Set();
			if (!root) return rows;
			function includeRoot(selector, into) {
				if (root.nodeType === 1 && root.matches && root.matches(selector)) into.push(root);
				var descendants = root.querySelectorAll ? root.querySelectorAll(selector) : [];
				for (var i = 0; i < descendants.length; i++) into.push(descendants[i]);
				return into;
			}
			var markedSelector = '[data-clock="start"],[data-clock="end"]';
			if ((root.nodeType === 1 && root.matches && root.matches(markedSelector)) ||
				(root.querySelector && root.querySelector(markedSelector))) return rows;

			function containsIconOnlyAction(element) {
				if (!element || !element.querySelectorAll) return false;
				var buttons = element.querySelectorAll('button[type="button"][aria-label]');
				for (var j = 0; j < buttons.length; j++) {
					if (buttons[j].querySelector("svg") && !(buttons[j].textContent || "").trim()) return true;
				}
				return false;
			}

			var tails = includeRoot("[data-turn-tail]", []);
			for (var i = 0; i < tails.length; i++) {
				var tailAction = tails[i].lastElementChild;
				if (containsIconOnlyAction(tailAction)) rows.add(tailAction);
			}

			var flows = includeRoot('[data-chat-flow-kind="user"],[data-chat-flow-kind="steering"]', []);
			for (i = 0; i < flows.length; i++) {
				var buttons = flows[i].querySelectorAll('button[type="button"][aria-label]');
				for (var j = 0; j < buttons.length; j++) {
					if (!buttons[j].querySelector("svg") || (buttons[j].textContent || "").trim()) continue;
					var candidate = null;
					for (var node = buttons[j].parentElement; node && node !== flows[i]; node = node.parentElement) {
						var parent = node.parentElement;
						if (parent && parent !== flows[i] && parent.children.length === 2 &&
							node === parent.lastElementChild && node.previousElementSibling) candidate = node;
					}
					if (candidate) { rows.add(candidate); break; }
				}
			}
			return rows;
		}

		function messageActionRow(node, legacyRows) {
			var clock = node.getAttribute && node.getAttribute("data-clock");
			return clock === "start" || clock === "end" || legacyRows.has(node);
		}

		// Join inline Text nodes only within one structural block and DOM root.
		// These snapshots live for one scan. Preserve every original code unit,
		// including whitespace-only nodes and code newlines; never trim or pad.
		function collectTextBlocks(root, classify) {
			var blocks = [];
			var legacyActions = legacyMessageActionRows(root);
			var text = "";
			var segments = [];
			function flush() {
				if (segments.length) blocks.push({ text: text, segments: segments });
				text = "";
				segments = [];
			}
			function visit(node) {
				if (node.nodeType === 3) {
					if (node.data.length) {
						segments.push({ node: node, start: text.length, end: text.length + node.data.length, contentType: classify ? classify(node) : null });
						text += node.data;
					}
					return;
				}
				if (node.nodeType !== 1 && node.nodeType !== 11) return;
				if (SKIP_TAGS[node.tagName] || node.id === BAR_ID || messageActionRow(node, legacyActions) || node.tagName === "BR") {
					// Excluded subtrees and br are hard boundaries, not empty text.
					flush();
					return;
				}
				var boundary = BLOCK_TAGS[node.tagName] || node.nodeType === 11 || node.shadowRoot;
				if (boundary) flush();
				for (var child = node.firstChild; child; child = child.nextSibling) visit(child);
				if (boundary) flush();
				// No Range may span a shadow root and its surrounding light DOM.
				if (node.shadowRoot) visit(node.shadowRoot);
			}
			visit(root);
			flush();
			return blocks;
		}

		function collectRanges(query, root, classify, include) {
			var ranges = [];
			if (!query || !root || typeof document === "undefined") return ranges;
			var blocks = collectTextBlocks(root, classify);
			for (var i = 0; i < blocks.length && ranges.length < MAX_MATCHES; i++) {
				var block = blocks[i];
				var matches = findMatches(block.text, query);
				var start = 0, end = 0;
				for (var j = 0; j < matches.length && ranges.length < MAX_MATCHES; j++) {
					var match = matches[j];
					if (include && block.segments.some(function (segment) { return segment.end > match.start && segment.start < match.end && !include(segment.contentType); })) continue;
					// At a node junction, start at the following node and end at
					// the preceding node. Non-overlapping matches move forwards.
					while (match.start >= block.segments[start].end) start++;
					while (match.end > block.segments[end].end) end++;
					var first = block.segments[start], last = block.segments[end];
					var range = document.createRange();
					range.setStart(first.node, match.start - first.start);
					range.setEnd(last.node, match.end - last.start);
					ranges.push(range);
				}
			}
			return ranges;
		}

		function makeHighlight(ranges) {
			if (ranges.length === 0) return new Highlight();
			var highlight = new Highlight(ranges[0]);
			for (var i = 1; i < ranges.length; i++) highlight.add(ranges[i]);
			return highlight;
		}

		function matchBarRect() {
			return isOpen() && state.bar.hasAttribute("data-positioned") ? state.bar.getBoundingClientRect() : null;
		}

		// Match visibility is deliberately independent of reading-origin capture
		// and return. Range geometry alone does not account for floating UI.
		function visibleMatchRect(range, viewport) {
			if (!viewport || !rangeRect(range, viewport)) return null;
			var clip = clippedViewport(range.startContainer.parentElement, viewport), bar = matchBarRect();
			var rects = range.getClientRects();
			for (var i = 0; i < rects.length; i++) {
				var rect = rects[i], left = Math.max(rect.left, clip.left), right = Math.min(rect.right, clip.right);
				var top = Math.max(rect.top, clip.top), bottom = Math.min(rect.bottom, clip.bottom);
				if (right <= left || bottom <= top) continue;
                if(state.scope === "whole" && (rect.top < clip.top - 1 || rect.bottom > clip.bottom + 1))continue;
				if (!bar || right <= bar.left || left >= bar.right || bottom <= bar.top || top >= bar.bottom) return rect;
			}
			return null;
		}

		function scrollRangeWithin(range, scroll, viewport, bar) {
			var rect = rangeRect(range);
			if (!rect) return;
			var current = scroll.scrollTop, maximum = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
			var bands = [[viewport.top, viewport.bottom]];
			if (bar && rect.right > bar.left && rect.left < bar.right && bar.bottom > viewport.top && bar.top < viewport.bottom) {
				bands = [[viewport.top, Math.min(viewport.bottom, bar.top - 8)],
					[Math.max(viewport.top, bar.bottom + 8), viewport.bottom]];
			}
			var best = null;
			bands.forEach(function (band) {
				if (band[1] <= band[0]) return;
				var delta = rect.top < band[0] ? rect.top - band[0] :
					rect.bottom > band[1] ? Math.min(rect.top - band[0], rect.bottom - band[1]) : 0;
				delta = Math.max(0, Math.min(maximum, current + delta)) - current;
				var shown = Math.max(0, Math.min(rect.bottom - delta, band[1]) - Math.max(rect.top - delta, band[0]));
				// At either history boundary, prefer the region actually reachable
				// after clamping rather than assuming the larger region is reachable.
				if (!best || shown > best.shown || (shown === best.shown && Math.abs(delta) < Math.abs(best.delta))) best = { delta: delta, shown: shown };
			});
			var x = rect.left < viewport.left ? rect.left - viewport.left :
				rect.right > viewport.right ? Math.min(rect.left - viewport.left, rect.right - viewport.right) : 0;
			if ((best && best.delta) || x) {
				try { scroll.scrollBy({ top: best ? best.delta : 0, left: x, behavior: "instant" }); } catch (error) {}
			}
		}

		function scrollToRange(range) {
			var viewport = readingViewport(state.target);
			if (!viewport || visibleMatchRect(range, viewport)) return;
			// Reveal the exact Range, not its potentially very tall <pre>/<p>.
			// Work from inner scroll clips outwards, without scrolling the window
			// or unrelated panels. Re-read geometry after every scroll.
			for (var node = range.startContainer.parentElement; node && node !== viewport.scroll; node = node.parentElement) {
				var style = window.getComputedStyle(node);
				var clipsY = /^(auto|scroll|hidden)$/.test(style.overflowY) && node.scrollHeight > node.clientHeight;
				var clipsX = /^(auto|scroll|hidden)$/.test(style.overflowX) && node.scrollWidth > node.clientWidth;
				if (!clipsX && !clipsY) continue;
				var box = node.getBoundingClientRect(), top = box.top + node.clientTop, left = box.left + node.clientLeft;
				var rect = rangeRect(range);
				if (!rect) return;
				var clip = clippedViewport(node, viewport), local = verticalTextClip(node, style, box);
				var safeTop = Math.max(local.top, clip.top), safeBottom = Math.min(local.bottom, clip.bottom);
                // If this inner scroller is mostly outside the conversation,
                // first reveal within its own unfaded band. The outer scroll
                // then brings that band onscreen; a tiny intersection cannot
                // fit a full line and must not pin the hit inside the fade.
				var shown = safeBottom - safeTop >= rect.height - 1;
				// A code scroller may still have room when the conversation is at
				// its boundary. Let it avoid the overlay within its visible clip.
				scrollRangeWithin(range, node, { top: clipsY ? (shown ? safeTop : local.top) : rect.top,
					bottom: clipsY ? (shown ? safeBottom : local.bottom) : rect.bottom,
					left: clipsX ? left : rect.left, right: clipsX ? left + node.clientWidth : rect.right },
					clipsY && shown ? matchBarRect() : null);
			}
			viewport = readingViewport(state.target);
			if (viewport && !visibleMatchRect(range, viewport)) scrollRangeWithin(range, viewport.scroll, viewport, matchBarRect());
		}

		//#region host adapter
		// Official session-scoped header utility props supply identity. DOM selectors
		// are intentionally isolated here: see docs/compatibility.md for tag sources.
		// No global current-session state and no page-wide search fallback.
		function visible(element) {
			if (!element || !element.isConnected || !element.getClientRects().length) return false;
			for (var node = element; node; node = node.parentElement) {
				if (node.hidden || node.getAttribute("aria-hidden") === "true") return false;
				var css = window.getComputedStyle(node);
				if (css.display === "none" || css.visibility === "hidden" || css.visibility === "collapse" || css.opacity === "0") return false;
			}
			return true;
		}

		function conversationPanel(element) {
			// The host composer has its own unrelated data-phase. A conversation
			// root additionally owns the scrollport (official startup fixture).
			for (var node = element; node && node !== document.body; node = node.parentElement) {
				if (!node.hasAttribute || !node.hasAttribute("data-phase")) continue;
				var phase = node.getAttribute("data-phase");
				// Preserve even a broken declared panel boundary; never walk through
				// it to a different ancestor conversation because its scroll is absent.
				if (phase === "active" || phase === "hero" || phase === "settling" || node.querySelector('[data-conversation-scroll]')) return node;
			}
			return null;
		}

		function nestedProcessFlow(flow, root) {
			return flow.hasAttribute('data-step-process-content') && flow.closest('[data-chat-group-key]') &&
				flow.parentElement.closest('[data-chat-flow]') && (!root || root.contains(flow));
		}

		function resolveScope(anchor, sessionId) {
			if (!anchor || typeof sessionId !== "string" || !sessionId || !visible(anchor)) return null;
			var panel = conversationPanel(anchor);
			if (!panel || panel.getAttribute("data-phase") !== "active" || panel === document.documentElement) return null;
			var anchors = panel.querySelectorAll('[data-find-all-session]');
			if (anchors.length !== 1 || anchors[0] !== anchor) return null;
			var scrolls = panel.querySelectorAll('[data-conversation-scroll]');
			if (scrolls.length !== 1) return null;
			var content = scrolls[0].closest('[data-conversation-content]');
			// 0.1.6-alpha.2 has the content wrapper but no identity attribute.
			// Identity still comes from the unique session-scoped header anchor.
			if (content && content.hasAttribute('data-conversation-session') && content.getAttribute('data-conversation-session') !== sessionId) return null;
			var flows = Array.prototype.filter.call(scrolls[0].querySelectorAll('[data-chat-flow]'), function (flow) {
				return !nestedProcessFlow(flow);
			});
			if (flows.length !== 1 || !visible(flows[0])) return null;
			return { panel: panel, root: flows[0] };
		}

		function createHostAdapter(ctx, changed) {
			var entries = new Map();
			var mainFrame = null;
			var scopeUnavailable = false;
			function shown(entry) {
				return visible(entry.anchor) || visible(conversationPanel(entry.anchor) || entry.anchor.closest('[data-phase], [data-conversation-content]'));
			}
			function choose(entry) {
				if (entry) mainFrame = { anchor: entry.anchor, panel: conversationPanel(entry.anchor) };
				var scope = entry && resolveScope(entry.anchor, entry.id);
				scopeUnavailable = !!entry && !scope;
				return scope ? { id: entry.id, anchor: entry.anchor, panel: scope.panel,
					root: scope.root, registration: entry } : null;
			}
			function current(previous) {
				// Header utilities are mounted by the main conversation frame. Embedded
				// sidebars have no such utility: focus and page-wide container counts
				// cannot turn them into a search target or poison the next shortcut.
				previous = previous || mainFrame;
				var same = previous && entries.get(previous.anchor);
				if (!same && previous && visible(previous.panel)) {
					var replacements = Array.from(entries.values()).filter(function (entry) {
						return conversationPanel(entry.anchor) === previous.panel && shown(entry);
					});
					if (replacements.length === 1) same = replacements[0];
				}
				if (same && shown(same)) return choose(same);
				// A surviving main frame with a missing utility is unavailable, not an
				// invitation to select another frame. A real navigation may replace it.
				if (previous && visible(previous.panel)) { scopeUnavailable = true; return null; }
				var all = Array.from(entries.values()).filter(shown);
				scopeUnavailable = all.length > 0;
				return all.length === 1 ? choose(all[0]) : null;
			}
			return {
				mount: function (anchor, id, nodes) {
					// A new effect/store generation invalidates old async work even when
					// the session id, DOM button and flow happen to be reused.
					var entry = { anchor: anchor, id: id, nodes: nodes || null };
					entries.set(anchor, entry);
					changed();
					return function () {
						if (entries.get(anchor) === entry) entries.delete(anchor);
						changed();
					};
				},
				nodes: function (entry) { return entry && entry.registration.nodes; },
				refresh: current,
				select: function (target, previous) {
					// Explicit registered main-frame interaction disambiguates future
					// hosts with multiple main utilities. Unregistered embedded content
					// and unrelated UI never replace the current main frame.
					var direct = Array.from(entries.values()).filter(function (entry) {
						var panel = conversationPanel(entry.anchor);
						return target && (entry.anchor.contains(target) || (panel && conversationPanel(target) === panel));
					});
					return direct.length === 1 ? choose(direct[0]) : current(previous);
				},
				scopeUnavailable: function () { return scopeUnavailable; },
				valid: function (entry) {
					if (!entry || entries.get(entry.anchor) !== entry.registration) return false;
					var scope = resolveScope(entry.anchor, entry.id);
					return !!scope && scope.panel === entry.panel && scope.root === entry.root;
				},
				face: function (entry) {
					try {
						if (!this.valid(entry) || !ctx.sessions || typeof ctx.sessions.binding !== "function") return null;
						var binding = ctx.sessions.binding(entry.id);
						var face = binding && binding.session;
						return face && typeof face.loadOlder === "function" ? face : null;
					} catch (error) { return null; }
				},
				clear: function () { entries.clear(); mainFrame = null; }
			};
		}

		// RC2's rendered Turn controls call its navigation owner, including
		// cancelling a retained paging anchor. Use that actual loaded UI action;
		// never synthesize wheel/beforematch or import a private Chat controller.
		function hostNavigationReady(target, face) {
			var status = face && facePageState(face);
			if (face && (!status || status.reason || pendingLoads.has(face))) return false;
			// The snapshot can settle before React commits Chat's loadingOlder
			// input. Its direct history control must also stop being disabled.
			return !target.root.querySelector(':scope > div:not([data-chat-anchor-key]):not([data-chat-group-key]) > button:disabled');
		}

		function activateLoadedTurn(target, store, preferredTurn) {
			if (!store) return false;
			var list = target.root.parentElement, chat = list && list.parentElement, frame = chat && chat.parentElement;
			if (!frame || !target.panel.contains(frame)) return false;
			var navs = Array.prototype.filter.call(frame.querySelectorAll('nav'), function (nav) {
				var label = nav.getAttribute('aria-label');
				return !target.root.contains(nav) && (label === 'Turn navigation' || label === '轮次导航');
			});
			if (navs.length !== 1 || !visible(navs[0])) return false;
			var loaded = new Set();
			Array.prototype.forEach.call(target.root.querySelectorAll('[data-chat-anchor-key][data-chat-turn]'), function (row) {
				var key = row.getAttribute('data-chat-node-key') || row.getAttribute('data-chat-anchor-key');
				if (store.get(key)) loaded.add(row.getAttribute('data-chat-turn'));
			});
			var candidates = [];
			Array.prototype.forEach.call(navs[0].querySelectorAll('button[data-index]'), function (button) {
				// These exact loaded labels are locale-owned by the inspected host.
				// The distinct "Load and jump" labels must never be activated here.
				var match = /^(?:Jump to turn (\d+)|跳转到第 (\d+) 轮)$/.exec(button.getAttribute('aria-label') || '');
				var turn = match && (match[1] || match[2]);
				if (!turn || !loaded.has(turn) || button.disabled || button.getAttribute('aria-busy') === 'true' || !visible(button)) return;
				candidates.push({ button: button, rank: turn === preferredTurn ? 0 : button.getAttribute('aria-current') === 'true' ? 1 : 2 });
			});
			candidates.sort(function (a, b) { return a.rank - b.rank; });
			if (!candidates.length) return false;
			candidates[0].button.click();
			return true;
		}

		function domSignature(root) {
			return root ? collectTextNodes(root, []).length : 0;
		}

		function waitForPage(check, isCancelled) {
			return new Promise(function (resolve) {
				var started = Date.now();
				function finish(value) {
					clearTimeout(state.settleTimer);
					state.settleTimer = 0;
					state.settleCancel = null;
					resolve(value);
				}
				state.settleCancel = function () { finish({ reason: "cancelled" }); };
				(function poll() {
					if (isCancelled()) { finish({ reason: "cancelled" }); return; }
					var value = check();
					if (value) { finish(value); return; }
					if (Date.now() - started >= PAGE_SETTLE_MS) { finish({ reason: "stalled" }); return; }
					state.settleTimer = setTimeout(poll, PAGE_POLL_MS);
				})();
			});
		}

		function facePageState(face) {
			try {
				var snapshot = typeof face.getSnapshot === "function" && face.getSnapshot();
				if (!snapshot) return { reason: "unknown" };
				if (snapshot.openError != null || snapshot.openState === "error") return { reason: "error" };
				if (snapshot.openState === "cold" || snapshot.openState === "loading") return null;
				if (snapshot.openState !== "open" || snapshot.openError !== null) return { reason: "unknown" };
				if (snapshot.loadingOlder === true) return null;
				if (snapshot.loadingOlder !== false) return { reason: "unknown" };
				return { hasMore: typeof snapshot.hasMore === "boolean" ? snapshot.hasMore : null };
			} catch (error) { return { reason: "unknown" }; }
		}

		// A cancelled UI task cannot abort SessionFace.loadOlder(). Keep its record
		// until settlement so a later query/enable never starts a concurrent request.
		var pendingLoads = new WeakMap();
		async function loadPage(face, isCancelled) {
			var status = facePageState(face);
			if (!status || status.reason || status.hasMore === false || pendingLoads.has(face)) return { deferred: true };
			var pending = { done: false, reason: null };
			pendingLoads.set(face, pending);
			var promise;
			try { promise = Promise.resolve(face.loadOlder()); }
			catch (error) { promise = Promise.reject(error); }
			promise.then(function () {
				pending.done = true;
				pendingLoads.delete(face);
			}, function () {
				pending.done = true;
				pending.reason = "error";
				pendingLoads.delete(face);
			});
			await Promise.resolve();
			return waitForPage(function () {
				return pending.done ? { reason: pending.reason } : null;
			}, isCancelled);
		}
		//#endregion

		//#region one find session's reading origin
		function readingViewport(target) {
			var scroll = target && target.root.closest('[data-conversation-scroll]');
			if (!scroll) return null;
			var rect = scroll.getBoundingClientRect();
			var bottom = Math.min(rect.bottom, window.innerHeight);
			var composer = scroll.querySelector('[data-composer-seat]');
			if (composer) {
				var composerTop = composer.getBoundingClientRect().top;
				if (composerTop > rect.top) bottom = Math.min(bottom, composerTop);
			}
			var top = Math.max(0, rect.top);
			return bottom > top && rect.width > 0 ? { scroll: scroll, top: top, bottom: bottom, left: Math.max(0, rect.left), right: Math.min(window.innerWidth, rect.right) } : null;
		}

		function readingText(row) {
			var text = '', segments = [];
			var walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT), node;
			while ((node = walker.nextNode()) !== null) {
				var parent = node.parentElement;
				if (!parent || parent.closest('script, style, noscript, button, input, textarea, select, [data-code-block-banner]')) continue;
				if (parent.closest('[data-chat-anchor-key]') !== row) continue;
				segments.push({ node: node, start: text.length, end: text.length + node.data.length });
				text += node.data;
			}
			return { text: text, segments: segments };
		}

		function readingRange(snapshot, offset) {
			for (var i = 0; i < snapshot.segments.length; i++) {
				var segment = snapshot.segments[i];
				if (offset < segment.start || offset >= segment.end) continue;
				var start = offset - segment.start;
				var range = document.createRange();
				range.setStart(segment.node, start);
				range.setEnd(segment.node, Math.min(segment.node.data.length, start + (segment.node.data.codePointAt(start) > 65535 ? 2 : 1)));
				return range;
			}
			return null;
		}

        function verticalTextClip(element, style, box) {
            var top=box.top+element.clientTop,bottom=top+element.clientHeight;
            // Official RC2 capped process bodies paint 24px edge fades.
            if(state.scope==='whole'&&element.hasAttribute('data-step-process-body')&&style.maskImage&&style.maskImage!=='none'){
                if(element.scrollTop>1)top+=24;
                if(element.scrollTop+element.clientHeight<element.scrollHeight-1)bottom-=24;
            }
            // Never shrink a one-line overflow:hidden text box.
            if(state.scope==='whole'&&element.scrollHeight>element.clientHeight+1){top+=4;bottom-=4;}
            return {top:top,bottom:bottom};
        }
		function clippedViewport(element, viewport) {
			var top = viewport.top, bottom = viewport.bottom, left = viewport.left, right = viewport.right;
			for (var parent = element; parent && parent !== viewport.scroll; parent = parent.parentElement) {
				var style = window.getComputedStyle(parent);
				var clipsY = /^(auto|scroll|hidden|clip)$/.test(style.overflowY), clipsX = /^(auto|scroll|hidden|clip)$/.test(style.overflowX);
				if (!clipsX && !clipsY) continue;
				var box = parent.getBoundingClientRect();
                if(clipsY){var safe=verticalTextClip(parent,style,box);top=Math.max(top,safe.top);bottom=Math.min(bottom,safe.bottom);}
				if (clipsX) { left = Math.max(left, box.left); right = Math.min(right, box.right); }
			}
			return { top: top, bottom: bottom, left: left, right: right };
		}

		function rangeRect(range, viewport) {
			if (!range || !range.startContainer.isConnected || typeof range.getClientRects !== 'function') return null;
			var clip = viewport && clippedViewport(range.startContainer.parentElement, viewport);
			var rects = range.getClientRects();
			for (var i = 0; i < rects.length; i++) {
				var rect = rects[i];
				if (rect.height > 0 && rect.width > 0 && (!viewport || (clip.bottom > clip.top && clip.right > clip.left && rect.bottom > clip.top && rect.top < clip.bottom && rect.right > clip.left && rect.left < clip.right))) return rect;
			}
			return null;
		}

		function hiddenUntilFoundAncestor(node, root) {
			var element = node && (node.nodeType === 1 ? node : node.parentElement);
			for (; element && root && root.contains(element); element = element.parentElement) {
				var hidden = element.getAttribute && element.getAttribute('hidden');
				if (typeof hidden === 'string' && hidden.toLowerCase() === 'until-found') return element;
				if (element === root) break;
			}
			return null;
		}

		function captureReadingOrigin() {
			var target = state.target, viewport = readingViewport(target);
			var store = state.adapter && state.adapter.nodes(target);
			if (!viewport || !store) return null;
			var rows = target.root.querySelectorAll('[data-chat-anchor-key]');
			var best = null;
			for (var i = 0; i < rows.length; i++) {
				var row = rows[i];
				if (!visible(row) || row.hasAttribute('data-chat-group-key')) continue;
				var anchorKey = row.getAttribute('data-chat-anchor-key');
				var nodeKey = row.getAttribute('data-chat-node-key') || anchorKey;
				var node = store.get(nodeKey);
				if (!node || !Number.isFinite(node.anchorSeq)) continue;
				var snapshot = readingText(row);
				for (var j = 0; j < snapshot.segments.length; j++) {
					var segment = snapshot.segments[j];
					var whole = document.createRange(); whole.selectNodeContents(segment.node);
					if (!rangeRect(whole, viewport)) continue;
					// Text order follows the rendered line order inside one text node.
					// The final geometry check rejects unsupported or non-visible runs.
					var clipTop = clippedViewport(segment.node.parentElement, viewport).top;
					var lo = segment.start, hi = segment.end - 1;
					while (lo < hi) {
						var mid = Math.floor((lo + hi) / 2);
						var probe = rangeRect(readingRange(snapshot, mid));
						if (probe && probe.bottom <= clipTop + 1) lo = mid + 1;
						else hi = mid;
					}
					var rect = rangeRect(readingRange(snapshot, lo), viewport);
					if (!rect) continue;
					var distance = Math.abs(rect.top - viewport.top);
					if (best && distance >= best.distance) continue;
					var body = row.closest('[data-step-process-body]');
					var group = body && body.closest('[data-chat-group-key]');
					best = {
						inner: group ? { key: group.getAttribute('data-chat-group-key'), top: rect.top - body.getBoundingClientRect().top } : null,
						target: target, store: store, face: state.adapter.face(target), nodeKey: nodeKey, anchorKey: anchorKey,
						seq: node.anchorSeq, text: snapshot.text, offset: lo, top: rect.top - viewport.top,
						focus: document.activeElement, distance: distance, navigated: false
					};
				}
			}
			return best;
		}

		function originValid(origin) {
			return !!origin && isOpen() && state.origin === origin && state.target === origin.target &&
				state.adapter && state.adapter.valid(origin.target) && state.adapter.nodes(origin.target) === origin.store &&
				state.adapter.face(origin.target) === origin.face;
		}

		function readingRow(origin) {
			var rows = origin.target.root.querySelectorAll('[data-chat-anchor-key]'), found = null;
			for (var i = 0; i < rows.length; i++) {
				if (rows[i].getAttribute('data-chat-anchor-key') !== origin.anchorKey ||
					(rows[i].getAttribute('data-chat-node-key') || origin.anchorKey) !== origin.nodeKey) continue;
				if (found) return null;
				found = rows[i];
			}
			return found;
		}

		function locateReading(origin, row) {
			if (!row || !visible(row)) return null;
			var snapshot = readingText(row), offset = origin.offset;
			if (snapshot.text !== origin.text && !snapshot.text.startsWith(origin.text)) {
				var from = Math.max(0, origin.offset - 64);
				var quote = origin.text.slice(from, origin.offset + 65);
				if (origin.text.indexOf(quote) !== from || origin.text.indexOf(quote, from + 1) >= 0) return null;
				var index = snapshot.text.indexOf(quote);
				if (index < 0 || snapshot.text.indexOf(quote, index + 1) >= 0) return null;
				offset = index + origin.offset - from;
			}
			return readingRange(snapshot, offset);
		}

		function updateReturnButton() {
			if (!state.returnBtn) return;
			var available = originValid(state.origin) && state.origin.navigated;
			state.returnBtn.hidden = !state.restoring && !available;
			state.returnBtn.disabled = !!state.restoring;
			var label = state.restoring ? L.returning : L.returnPosition;
			state.returnBtn.querySelector('.return-label').textContent = label;
			state.returnBtn.setAttribute('aria-label', label);
			state.returnBtn.title = label;
		}

		function cancelNavigation() {
			clearTimeout(state.navigationTimer);
			state.navigationTimer = 0;
			state.navigationToken += 1;
            state.historyNavigating=false;state.avoidMatchRange=null;
            if(isOpen())scheduleBarPosition();
		}

		function cancelReturn(message) {
			if (!state.restoring) return;
			state.restoring = null;
			if (state.settleCancel) state.settleCancel();
			if (message) setStatus(message, false);
			updateReturnButton();
		}

		function discardOrigin() {
			cancelReturn();
			cancelNavigation();
			state.origin = null;
			updateReturnButton();
		}

		function navigateToRange(range) {
			cancelReturn(L.returnCancelled);
			cancelNavigation();
			var target = state.target, face = state.adapter && state.adapter.face(target);
			if (state.scope !== "whole" && target && state.adapter.valid(target) && hostNavigationReady(target, face)) {
				var row = range.startContainer.parentElement.closest('[data-chat-turn]');
				activateLoadedTurn(target, state.adapter.nodes(target), row && row.getAttribute('data-chat-turn'));
				if (state.target !== target || !state.adapter.valid(target) || state.adapter.face(target) !== face) return;
			}
			var origin = state.origin, token = state.navigationToken, started = Date.now();
            var dataHit=state.scope === "whole" ? state.hits[state.index] : null;
			var activated = new Set(), announceReturn = false;
			function check() {
				state.navigationTimer = 0;
				if (token !== state.navigationToken || state.target !== target || !state.adapter.valid(target) || !isOpen()) return;
				positionBar();
				var viewport = readingViewport(target);
				var current = state.ranges[state.index];
                if(dataHit){
                    var semanticNode=sourceNode(dataHit.source,state.adapter.nodes(target));
                    if(semanticNode){
                        var resolved=mapProjectedDocument(dataHit.source,semanticNode,sourceRows(target,semanticNode));
                        if(resolved.blocks){
                            current=rangeForBlock(resolved.blocks[dataHit.blockIndex],dataHit.start,dataHit.end);
                            if(current&&current.toString()===dataHit.text){state.ranges[state.index]=current;paint();}else current=null;
                        }else{current=null;expandSource(target,semanticNode,dataHit.source,activated);}
                    }
                }
                var attached = current && target.root.contains(current.startContainer);
				// hidden=until-found uses content-visibility:hidden, so Chromium may
				// report layout geometry for descendants that are not painted. Reveal
				// the host-owned disclosure before trusting Range geometry.
				var concealed = attached && hiddenUntilFoundAncestor(current.startContainer, target.root);
				var geometry = attached && !concealed && rangeRect(current);
				if (current && (!geometry || concealed)) revealMatchRange(target, current, activated);
				if (geometry && !visibleMatchRect(current, viewport)) scrollToRange(current);
                if(dataHit && geometry && !visibleMatchRect(current,viewport)){
                    // At a scroll boundary the first line cannot move below the
                    // overlay. Temporarily displace the bar, preserving the
                    // user's manual position for the next query/navigation.
                    state.avoidMatchRange=current;positionBar();
                }
				if (viewport && attached && !concealed && visibleMatchRect(current, viewport)) {
					var firstNavigation = originValid(origin) && !origin.navigated;
                    if (originValid(origin)) origin.navigated = true;
					updateReturnButton();
					if (!firstNavigation && state.status && state.status.textContent === L.matchRevealFailed) setStatus("", false);
					if (firstNavigation) {
						if (state.jumpStatus !== null) {
							var priorStatus = state.jumpStatus;
							setStatus(priorStatus, false);
						} else if(dataHit)historyStatus(); else setStatus("", false);
						announceReturn = true;
						// The secondary row/status can change the overlay height. Verify
						// the resulting layout before declaring the match visible.
						state.navigationTimer = setTimeout(check, 0);
						return;
					}
					if(dataHit && Date.now()-started<700){state.navigationTimer=setTimeout(check,100);return;}
                    if (announceReturn && state.announcement) state.announcement.textContent = L.returnAvailable;
                    return;
				}
				if (Date.now() - started < 1500) {
					state.navigationTimer = setTimeout(check, 100);
					return;
				}
				recordFailure('jump', 'render');
				setStatus(L.matchRevealFailed, false);
				if (state.announcement) state.announcement.textContent = L.matchRevealFailed;
			}
			check();
		}

		function focusWithoutScroll(element) {
			if (!element || !element.isConnected || typeof element.focus !== "function") return;
			try { element.focus({ preventScroll: true }); } catch (error) { element.focus(); }
		}

		function activateDisclosure(button, activated) {
			if (!button || button.disabled || !visible(button) || activated.has(button)) return false;
			activated.add(button);
			// DSH's disclosure handlers focus their button. Pre-focus without
			// scrolling, then restore the find control that initiated navigation.
			var previous = document.activeElement;
			focusWithoutScroll(button);
			button.click();
			if (previous !== button) focusWithoutScroll(previous);
			return true;
		}

		function revealMatchRange(target, range, activated) {
			if (!target || !range || !target.root.contains(range.startContainer)) return false;
			var element = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
			if (!element) return false;
			var changed = false;
			// Native details participates in the platform ancestor-revealing
			// algorithm. Opening it does not bypass application-owned state.
			for (var node = element; node && target.root.contains(node); node = node.parentElement) {
				if (node.tagName === "DETAILS" && !node.open) {
					node.open = true;
					changed = true;
				}
			}
			var ancestors = [];
			for (node = element; node && target.root.contains(node); node = node.parentElement) {
				ancestors.push(node);
			}

			// DSH retains folded process content with hidden=until-found. Use its
			// rendered disclosure controls so React and the navigation owner remain
			// synchronized; never edit the hidden attribute or synthesize beforematch.
			var row = element.closest('[data-chat-turn]');
			var turn = row && row.getAttribute('data-chat-turn');
			var buttons = target.root.querySelectorAll('button[data-turn-process][aria-expanded="false"]');
			for (var i = 0; i < buttons.length; i++) {
				var owner = buttons[i].closest('[data-chat-turn]');
				if (turn && owner && owner.getAttribute('data-chat-turn') === turn && activateDisclosure(buttons[i], activated)) return true;
			}
			// Prefer the disclosure's semantic aria-controls relationship for
			// nested groups. Walk outermost first because an inner control can itself
			// still be inside a folded outer Turn.
			buttons = target.root.querySelectorAll('button[aria-controls][aria-expanded="false"]');
			for (var h = ancestors.length - 1; h >= 0; h--) {
				if (!ancestors[h].id) continue;
				for (i = 0; i < buttons.length; i++) {
					if (buttons[i].getAttribute('aria-controls') === ancestors[h].id && activateDisclosure(buttons[i], activated)) return true;
				}
			}
			// Older supported hosts expose the same group disclosure without
			// aria-controls, but keep its stable group/activity markers.
			var group = row && row.closest('[data-chat-group-key]');
			var button = group && group.querySelector('button[data-process-activity][aria-expanded="false"]');
			if (activateDisclosure(button, activated)) return true;
			return changed;
		}

		function returnFailure(reason) {
			return L.returnFailed + ' ' + (L['return_' + reason] || L.return_unavailable);
		}

		async function returnToOrigin() {
            cancelCountEdit(false);
            cancelNavigation();
			var origin = state.origin;
			if (state.restoring || !originValid(origin) || !origin.navigated) return;
			if (state.paging || state.scanBusy) cancelPageIn(); cancelNavigation();
			var task = { origin: origin };
			state.restoring = task;
			setStatus(L.returning, false); updateReturnButton();
			function cancelled() { return state.restoring !== task || !originValid(origin); }
			function finishFailure(reason) {
				if (cancelled()) return;
				recordFailure('return', reason);
				state.restoring = null;
				if (reason === 'removed') state.origin = null;
				setStatus(returnFailure(reason), false); updateReturnButton();
			}
			function nodeState() {
				if (origin.face && origin.face.getSnapshot().removed) return 'removed';
				if (origin.store.get(origin.nodeKey)) return 'loaded';
				var nodes = origin.store.values();
				var first = nodes.reduce(function (min, node) { return Math.min(min, node.anchorSeq); }, Infinity);
				// Materialized Chat nodes do not expose the event window's lower bound.
				// Earlier missing content permits a bounded load attempt, not a deletion claim.
				return first > origin.seq ? 'missing' : 'unavailable';
			}
			try {
				var pages = 0;
				while (!cancelled() && nodeState() === 'missing') {
					if (!origin.face) { finishFailure('unavailable'); return; }
					if (pages >= MAX_PAGES) { finishFailure('capped'); return; }
					var ready = await waitForPage(function () {
						if (pendingLoads.has(origin.face)) return null;
						return facePageState(origin.face);
					}, cancelled);
					if (cancelled()) return;
					if (ready.reason) { finishFailure(ready.reason); return; }
					if (nodeState() !== 'missing') break;
					if (ready.hasMore !== true) { finishFailure('unavailable'); return; }
					var before = origin.store.values().map(function (node) { return node.key + ':' + node.anchorSeq; }).join('|');
					var loaded = await loadPage(origin.face, cancelled);
					if (cancelled()) return;
					if (loaded.reason) { finishFailure(loaded.reason); return; }
					var progress = await waitForPage(function () {
						if (nodeState() !== 'missing') return {};
						var after = origin.store.values().map(function (node) { return node.key + ':' + node.anchorSeq; }).join('|');
						return before !== after ? {} : null;
					}, cancelled);
					if (cancelled()) return;
					if (progress.reason) { finishFailure(progress.reason); return; }
					pages += 1;
				}
				if (cancelled()) return;
				if (nodeState() !== 'loaded') { finishFailure(nodeState()); return; }
				var navigationReady = await waitForPage(function () {
					var status = origin.face && facePageState(origin.face);
					if (status && status.reason) return status;
					return hostNavigationReady(origin.target, origin.face) ? {} : null;
				}, cancelled);
				if (cancelled()) return;
				if (navigationReady.reason) { finishFailure(navigationReady.reason); return; }
				var originalRow = readingRow(origin);
				activateLoadedTurn(origin.target, origin.store, originalRow && originalRow.getAttribute('data-chat-turn'));
				if (cancelled()) return;
				var activated = new Set();
				var rendered = await waitForPage(function () {
					var row = readingRow(origin);
					var range = locateReading(origin, row);
					if (range && !rangeRect(range)) revealMatchRange(origin.target, range, activated);
					return range && rangeRect(range) ? { row: row, range: range } : null;
				}, cancelled);
				if (cancelled()) return;
				if (rendered.reason) { finishFailure('render'); return; }
				var inner = rendered.row.closest('[data-step-process-body]');
				if (inner && inner.scrollHeight > inner.clientHeight) {
					var group = inner.closest('[data-chat-group-key]');
					if (!group) { finishFailure('render'); return; }
					var innerRect = rangeRect(rendered.range), innerBox = inner.getBoundingClientRect();
					var sameGroup = origin.inner && group.getAttribute('data-chat-group-key') === origin.inner.key;
					var innerOffset = Math.max(1 - innerRect.height, Math.min(sameGroup ? origin.inner.top : 0, inner.clientHeight - 1));
					if (cancelled()) return;
					inner.scrollTop += innerRect.top - innerBox.top - innerOffset;
				}
				var viewport = readingViewport(origin.target), rect = rangeRect(rendered.range);
				if (!viewport || !rect || cancelled()) { finishFailure('unavailable'); return; }
				var offset = Math.max(1 - rect.height, Math.min(origin.top, viewport.bottom - viewport.top - 1));
				var desired = viewport.scroll.scrollTop + rect.top - viewport.top - offset;
				var top = Math.max(0, Math.min(viewport.scroll.scrollHeight - viewport.scroll.clientHeight, desired));
				var expectedOffset = offset + desired - top;
				var initialHeight = viewport.scroll.scrollHeight, initialWidth = viewport.scroll.getBoundingClientRect().width;
				// One instant landing, then observation. Never fight the host's own
				// retained paging anchor with repeated scroll writes.
				viewport.scroll.scrollTo({ top: top, behavior: 'instant' });
				var started = Date.now(), stable = null;
				var settled = await waitForPage(function () {
					var live = locateReading(origin, readingRow(origin));
					var bounds = readingViewport(origin.target), box = bounds && rangeRect(live, bounds);
					if (!box) { stable = null; return Date.now() - started >= 1000 ? { reason: 'position' } : null; }
					var current = box.top - bounds.top;
					var layoutChanged = bounds.scroll.scrollHeight !== initialHeight || bounds.scroll.getBoundingClientRect().width !== initialWidth;
					if (!layoutChanged && Math.abs(current - expectedOffset) > 3) return Date.now() - started >= 1000 ? { reason: 'position' } : null;
					if (!stable || Math.abs(stable.top - current) > 2) stable = { top: current, since: Date.now() };
					if (Date.now() - stable.since < 600) return null;
					return { row: readingRow(origin), range: live };
				}, cancelled);
				if (cancelled()) return;
				if (settled.reason) { finishFailure(settled.reason); return; }
				if (!rangeRect(settled.range, readingViewport(origin.target))) { finishFailure('position'); return; }
				state.restoring = null;
				origin.navigated = false;
				if (state.input) state.input.focus({ preventScroll: true });
				if (state.scope === "whole") historyStatus(); else setStatus("", false);
				updateReturnButton();
				if (state.announcement) state.announcement.textContent = L.returned;
			} catch (error) { finishFailure('error'); }
			finally {
				if (state.restoring === task && !originValid(origin)) {
					state.restoring = null; state.origin = null; updateReturnButton();
					if (isOpen()) setStatus(returnFailure('unavailable'), false);
				}
			}
		}
		//#endregion

		//#region bar UI + state

		var state = {
			ctx: null,
            aboutAvailable: false, aboutViews: new Map(), aboutOwner: null, aboutEpoch: 0,
			mounted: false, writeClipboard: null, diagnosticBtn: null, diagnosticFeedback: null, copyPending: false, copyEpoch: 0, lastFailure: null,
            remote: null, history: null, historySnapshot: null, projector: null, hits: [], total: 0, queryToken: 0, scanTimer: 0, scanCursor: 0, scanCancelled: false, scanBusy: false, scanComplete: false, scanQuery: null, liveCount: 0, liveCapped: false, sourceNotice: "", refreshBtn: null,
			adapter: null,
			target: null,
			settleTimer: 0,
			settleCancel: null,
			bar: null,
			input: null,
			count: null, countEditor: null, countInput: null, countTotal: null, countHint: null, countLive: null, countEdit: null, resultsRevision: 0, pageDirty: false,
			status: null,
			scopeInputs: null,
			contentBtn: null,
			contentPanel: null,
			contentInputs: null,
			contentTypes: Object.assign({}, DEFAULT_CONTENT_TYPES),
			query: "",
			ranges: [],
			index: -1,
			selection: null,
			capped: false,
			observer: null,
			debounce: 0,
			scope: "whole",
			paging: false,
			pageTimer: 0,
			pageToken: 0,
			pages: 0,
			sessionId: null,
			sessionTimer: 0,
			origin: null, restoring: null, returnBtn: null, announcement: null, navigationTimer: 0, navigationToken: 0,
			jumpStatus: null,
			positionObserver: null,
			positionFrame: null,
			positionOwner: null, manualPosition: null, drag: null, dragHandle: null, positionControls: null, suppressMoveClick: false
		};

        // Diagnostic output is built field by field. Never serialize host records,
        // error objects, message text, IDs, paths or DOM, including error.code.
        function diagnosticCode(code) {
            switch (code) {
                case 'unsupported-host': return 'unsupported-host';
                case 'invalid-snapshot': return 'invalid-snapshot';
                case 'wrong-session': return 'wrong-session';
                case 'invalid-cursor': return 'invalid-cursor';
                case 'invalid-page': return 'invalid-page';
                case 'empty-page': return 'empty-page';
                case 'history-gap': return 'history-gap';
                case 'invalid-content': return 'invalid-content';
                case 'invalid-stream': return 'invalid-stream';
                case 'unsupported-stream': return 'unsupported-stream';
                case 'unsupported-event': return 'unsupported-event';
                case 'unsupported-body-event': return 'unsupported-body-event';
                case 'invalid-projection': return 'invalid-projection';
                case 'projection-incomplete': return 'projection-incomplete';
                case 'truncated-tool-output': return 'truncated-tool-output';
                case 'tool-renderer-unavailable': return 'tool-renderer-unavailable';
                case 'tool-projection-empty': return 'tool-projection-empty';
                case 'custom-tool-projection-unverified': return 'custom-tool-projection-unverified';
                case 'render': return 'render';
                case 'position': return 'position';
                case 'removed': return 'removed';
                case 'unavailable': return 'unavailable';
                case 'capped': return 'capped';
                case 'stalled': return 'stalled';
                case 'unknown': return 'unknown';
                default: return 'operation-failed';
            }
        }
        function diagnosticCount(value) {
            return Number.isSafeInteger(value) && value >= 0 ? value : null;
        }
        function diagnosticState() {
            var snapshot = state.historySnapshot, remote = state.remote && state.remote.session;
            var historyStatus = snapshot && ['idle', 'reading', 'projecting', 'complete', 'partial', 'error', 'cancelled'].includes(snapshot.status) ? snapshot.status : snapshot ? 'unknown' : 'not-started';
            var bound = !!(state.adapter && state.adapter.valid(state.target));
            var face = bound ? state.adapter.face(state.target) : null;
            return {
                scope: state.scope === 'whole' ? 'whole' : 'page',
                contentTypes: CONTENT_TYPES.filter(function (type) { return contentTypeEnabled(type); }),
                capabilities: { target: bound, history: !!(remote && typeof remote.follow === 'function' && typeof remote.page === 'function'),
                    projector: typeof state.projector === 'function', navigation: !!(face && typeof face.loadThrough === 'function'), clipboard: typeof state.writeClipboard === 'function' },
                history: { status: historyStatus, pages: diagnosticCount(snapshot && snapshot.pages), eventsRead: diagnosticCount(snapshot && snapshot.eventsRead),
                    documents: diagnosticCount(snapshot && snapshot.documents.length), readComplete: snapshot ? snapshot.readComplete === true : null,
                    coverageComplete: snapshot ? snapshot.coverageComplete === true : null,
                    projectionComplete: snapshot ? snapshot.projectionComplete === true : null,
                    selectedProjectionComplete: snapshot ? selectedProjectionComplete(snapshot) : null },
                scan: { busy: !!state.scanBusy, complete: !!state.scanComplete, cancelled: !!state.scanCancelled,
                    documents: state.scope === 'whole' ? diagnosticCount(state.scanCursor) : null, matches: diagnosticCount(state.scope === 'whole' ? state.total : state.ranges.length),
                    displayed: diagnosticCount(resultLength()), capped: !!state.capped, liveMatches: state.scope === 'whole' ? diagnosticCount(state.liveCount) : null, liveCapped: state.scope === 'whole' ? !!state.liveCapped : null },
                navigation: { pending: !!state.historyNavigating || !!state.navigationTimer, returning: !!state.restoring }
            };
        }
        function recordFailure(phase, code) {
            if (!state.mounted || code === 'cancelled') return;
            state.lastFailure = { phase: phase, code: diagnosticCode(code), state: diagnosticState() };
        }
        function resetDiagnosticCopy() {
            state.copyEpoch++;
            state.copyPending = false;
            if (state.diagnosticBtn) state.diagnosticBtn.removeAttribute('aria-busy');
            if (state.diagnosticFeedback) state.diagnosticFeedback.textContent = '';
        }
        function clearDiagnostics() {
            resetDiagnosticCopy();
            state.lastFailure = null;
        }
        async function copyDiagnostics() {
            if (state.copyPending || !state.mounted) return;
            // A click can arrive before the 600ms session poll. Snapshot only the
            // refreshed owner, even if the refresh closes this options panel.
            syncTarget(null, true);
            var epoch = ++state.copyEpoch, feedback = state.diagnosticFeedback;
            state.copyPending = true;
            state.diagnosticBtn.setAttribute('aria-busy', 'true');
            feedback.textContent = L.copyingDiagnostics;
            var copied = false;
            try {
                var summary = { schemaVersion: 1, pluginVersion: __DSH_FIND_ALL_VERSION__, current: diagnosticState(), lastFailure: state.lastFailure };
                copied = typeof state.writeClipboard === 'function' && await state.writeClipboard(JSON.stringify(summary, null, 2)) === true;
            } catch (error) { /* Clipboard failures must not expose raw errors. */ }
            if (!state.mounted || epoch !== state.copyEpoch || state.diagnosticFeedback !== feedback || !feedback.isConnected) return;
            state.copyPending = false;
            state.diagnosticBtn.removeAttribute('aria-busy');
            feedback.textContent = copied ? L.copiedDiagnostics : L.copyDiagnosticsFailed;
        }

		function barAnchor(target) {
			if (!target || !target.anchor || !target.panel || !target.anchor.closest) return null;
			var header = target.anchor.closest('[data-conversation-header], header');
			if (header && target.panel.contains(header)) return header;
			// Older supported hosts may not expose the header data attribute. The
			// registered utility still lives in the header's direct child of the panel.
			var child = target.anchor;
			while (child && child.parentElement && child.parentElement !== target.panel) child = child.parentElement;
			return child && child.parentElement === target.panel ? child : null;
		}

		function positionBar() {
			if (!isOpen() || !state.bar) return false;
			var target = state.target, header = barAnchor(target), viewport = readingViewport(target);
			if (!target || !header || !header.isConnected || !target.panel.isConnected || !viewport) {
				state.bar.removeAttribute("data-positioned");
				closeContentPanel();
				return false;
			}
			var panel = target.panel.getBoundingClientRect(), headerRect = header.getBoundingClientRect();
			var leftEdge = Math.max(panel.left, viewport.left) + 8;
			var rightEdge = Math.min(panel.right, viewport.right) - 8;
			var topEdge = Math.max(panel.top, viewport.top, headerRect.bottom) + 8;
			var bottomEdge = Math.min(panel.bottom, viewport.bottom) - 8;
			if (rightEdge <= leftEdge || bottomEdge <= topEdge) {
				state.bar.removeAttribute("data-positioned");
				closeContentPanel();
				return false;
			}
			var dpr = window.devicePixelRatio || 1;
			function cssPixel(value) { return Math.round(value * dpr) / dpr + "px"; }
			// This is the only position writer, including pointer, resize, scroll
			// and polling updates. Manual placement never falls back to the anchor.
			state.bar.style.setProperty("--dsh-find-all-panel-width", cssPixel(rightEdge - leftEdge));
			state.bar.style.setProperty("--dsh-find-all-max-height", cssPixel(bottomEdge - topEdge));
			var box = state.bar.getBoundingClientRect(), manual = state.manualPosition;
			var left = manual ? manual.left : rightEdge - box.width;
			var top = manual ? manual.top : topEdge;
			left = Math.max(leftEdge, Math.min(left, rightEdge - box.width));
			top = Math.max(topEdge, Math.min(top, bottomEdge - box.height));
			if (manual) { manual.left = left; manual.top = top; }
            var avoid=state.avoidMatchRange&&rangeRect(state.avoidMatchRange);
            if(avoid&&left<avoid.right&&left+box.width>avoid.left&&top<avoid.bottom&&top+box.height>avoid.top){
                var choices=[{left:left,top:avoid.bottom+8},{left:left,top:avoid.top-box.height-8},{left:avoid.left-box.width-8,top:top},{left:avoid.right+8,top:top}].filter(function(p){return p.left>=leftEdge&&p.left+box.width<=rightEdge&&p.top>=topEdge&&p.top+box.height<=bottomEdge;});
                choices.sort(function(a,b){return Math.abs(a.left-left)+Math.abs(a.top-top)-Math.abs(b.left-left)-Math.abs(b.top-top);});
                if(choices.length){left=choices[0].left;top=choices[0].top;}
            }
			state.bar.style.setProperty("--dsh-find-all-bar-top", cssPixel(top));
			state.bar.style.setProperty("--dsh-find-all-bar-right", cssPixel(window.innerWidth - left - box.width));
			state.bar.setAttribute("data-positioned", "");
			positionContentPanel();
			return true;
		}

		function finishBarDrag(event) {
			var drag = state.drag;
			if (!drag || (event && event.pointerId !== drag.id)) return;
			state.drag = null;
			state.bar.removeAttribute("data-dragging");
			try { if (drag.handle.hasPointerCapture(drag.id)) drag.handle.releasePointerCapture(drag.id); } catch (error) {}
		}

		function resetBarPosition() {
			finishBarDrag();
			state.manualPosition = null;state.avoidMatchRange=null;
			scheduleBarPosition();
		}

		function moveBarBy(x, y) {
            state.avoidMatchRange=null;
			if (!positionBar()) return;
			var box = state.bar.getBoundingClientRect();
			state.manualPosition = { left: box.left + x, top: box.top + y };
			scheduleBarPosition();
		}

		function buildPositionControls(controls, bar) {
			var moves = document.createElement("div");
			moves.className = "position-controls"; moves.id = BAR_ID + "-position"; moves.hidden = true;
			var handle = button(L.move, "M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01", function (event) {
				if (event.detail && state.suppressMoveClick) { state.suppressMoveClick = false; return; }
				moves.hidden = !moves.hidden;
				handle.setAttribute("aria-expanded", String(!moves.hidden));
				scheduleBarPosition();
			});
			handle.className = "drag-handle";
			handle.setAttribute("aria-expanded", "false"); handle.setAttribute("aria-controls", moves.id);
			handle.addEventListener("pointerdown", function (event) {
                state.avoidMatchRange=null;
				if (!event.isPrimary || event.button !== 0 || state.drag || !positionBar()) return;
				state.suppressMoveClick = false;
				try { handle.setPointerCapture(event.pointerId); } catch (error) { return; }
				var box = state.bar.getBoundingClientRect();
				state.drag = { id: event.pointerId, handle: handle, x: event.clientX, y: event.clientY, left: box.left, top: box.top };
				// Dragging the handle must not steal focus/selection from the query.
				event.preventDefault();
			});
			handle.addEventListener("pointermove", function (event) {
				var drag = state.drag;
				if (!drag || event.pointerId !== drag.id) return;
				var x = event.clientX - drag.x, y = event.clientY - drag.y;
				if (!state.suppressMoveClick && Math.abs(x) + Math.abs(y) < 4) return;
				state.suppressMoveClick = true;
				state.bar.setAttribute("data-dragging", "");
				state.manualPosition = { left: drag.left + x, top: drag.top + y };
				scheduleBarPosition();
			});
			["pointerup", "pointercancel", "lostpointercapture"].forEach(function (type) { handle.addEventListener(type, finishBarDrag); });
			moves.appendChild(button(L.moveLeft, "m14 6-6 6 6 6", function () { moveBarBy(-32, 0); }));
			moves.appendChild(button(L.moveRight, "m10 6 6 6-6 6", function () { moveBarBy(32, 0); }));
			moves.appendChild(button(L.moveUp, "m6 14 6-6 6 6", function () { moveBarBy(0, -32); }));
			moves.appendChild(button(L.moveDown, "m6 10 6 6 6-6", function () { moveBarBy(0, 32); }));
			var reset = button(L.resetPosition, "M3 10a9 9 0 1 1 2 8M3 4v6h6", resetBarPosition);
			moves.appendChild(reset);
			state.dragHandle = handle; state.positionControls = moves;
			controls.appendChild(handle);
			bar.appendChild(moves);
		}

		function scheduleBarPosition() {
			if (!isOpen() || state.positionFrame !== null) return;
			if (typeof requestAnimationFrame !== "function") { positionBar(); return; }
			state.positionFrame = requestAnimationFrame(function () {
				state.positionFrame = null;
				positionBar();
			});
		}

		function stopBarPositioning() {
			finishBarDrag();
			if (state.positionObserver) { state.positionObserver.disconnect(); state.positionObserver = null; }
			if (state.positionFrame !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(state.positionFrame);
			state.positionFrame = null;
		}

		function startBarPositioning() {
			stopBarPositioning();
			positionBar();
			var header = barAnchor(state.target);
			if (!header || typeof ResizeObserver === "undefined") return;
			state.positionObserver = new ResizeObserver(scheduleBarPosition);
			state.positionObserver.observe(header);
			var viewport = readingViewport(state.target);
			if (viewport) {
				state.positionObserver.observe(viewport.scroll);
				var composer = viewport.scroll.querySelector("[data-composer-seat]");
				if (composer) state.positionObserver.observe(composer);
			}
			state.positionObserver.observe(state.bar);
			if (state.contentPanel) state.positionObserver.observe(state.contentPanel);
			if (state.contentBtn) state.positionObserver.observe(state.contentBtn);
			if (state.target.panel !== header) state.positionObserver.observe(state.target.panel);
		}

		function paint() {
			if (!highlightsSupported()) return;
			CSS.highlights.delete(HL_ALL);
			CSS.highlights.delete(HL_CUR);
			if (state.ranges.length > 0) {
				CSS.highlights.set(HL_ALL, makeHighlight(state.ranges.filter(Boolean)));
				if (state.index >= 0 && state.ranges[state.index]) {
					CSS.highlights.set(HL_CUR, makeHighlight([state.ranges[state.index]]));
				}
			}
		}

        function resultLength() { return state.scope === "whole" ? state.hits.length : state.ranges.length; }
        function updateCount() {
            if (!state.count) return;
            var n = resultLength(), whole = state.scope === "whole";
            var total = whole ? state.total : n;
            var suffix = (whole ? !state.scanComplete : state.capped) ? "+" : "";
            if (!state.query) state.count.textContent = "";
            else if (!n) state.count.textContent = whole && (state.paging || state.scanBusy) ? "…" : whole && !state.scanComplete ? L.resultCount.replace("{n}", "0+") : "0/0";
            else if (state.index < 0) state.count.textContent = L.resultCount.replace("{n}", String(total) + suffix);
            else state.count.textContent = (state.index + 1) + "/" + total + suffix;
            var cap = state.capped ? L.cap.replace("{n}", String(MAX_MATCHES)) : "";
            state.count.title = state.count.textContent + (cap ? "; " + cap : "");
            state.count.setAttribute("aria-label", state.count.title + "; " + L.jumpNumber);
            state.count.disabled = !state.query || !n;
            if (state.countLive && state.countLive.textContent !== state.count.textContent) state.countLive.textContent = state.count.textContent;
            if (state.countEdit && !n) cancelCountEdit(false);
            if (state.countEdit) {
                state.countTotal.textContent = "/" + total + suffix;
                updateCountHint();
            }
        }

        function updateCountHint() {
            if (!state.countEdit) return;
            var invalid = state.countInput.getAttribute("aria-invalid") === "true";
            state.countHint.textContent = (invalid ? L.jumpInvalid : L.jumpRange).replace("{n}", String(resultLength()));
            if (state.capped) state.countHint.textContent += " " + L.cap.replace("{n}", String(resultLength()));
        }
        function cancelCountEdit(restoreFocus) {
            if (!state.countEdit) return;
            state.countEdit = null; // Clear before hiding: blur is a cancellation fallback.
            state.countEditor.hidden = true;
            state.countHint.hidden = true;
            state.count.hidden = false;
            if (restoreFocus && !state.count.disabled && isOpen()) state.count.focus({ preventScroll: true });
        }
        function beginCountEdit() {
            if (state.countEdit || !isOpen() || !state.query || !resultLength()) return;
            if (state.scope === "page" && state.observer?.takeRecords().length) scheduleRescan();
            if (state.scope === "page" && state.pageDirty) runSearch(true);
            if (!resultLength() || !state.adapter?.valid(state.target)) return;
            cancelReturn(L.returnCancelled); cancelNavigation(); closeContentPanel();
            state.countEdit = { target: state.target, query: state.query, scope: state.scope, revision: state.resultsRevision, composing: false };
            state.countInput.value = String(state.index < 0 ? 1 : state.index + 1);
            state.countInput.removeAttribute("aria-invalid"); state.countHint.removeAttribute("data-error");
            state.count.hidden = true; state.countEditor.hidden = false; state.countHint.hidden = false;
            updateCount();
            state.countInput.focus({ preventScroll: true }); state.countInput.select();
        }
        function commitCountEdit() {
            var edit = state.countEdit;
            if (!edit) return;
            // A synchronous DOM mutation may precede MutationObserver delivery.
            if (state.scope === "page" && state.observer?.takeRecords().length) scheduleRescan();
            if (!state.countEdit || edit.target !== state.target || edit.query !== state.query || edit.scope !== state.scope || edit.revision !== state.resultsRevision || !state.adapter?.valid(state.target)) { cancelCountEdit(true); return; }
            var value = state.countInput.value.trim(), n = Number(value), length = resultLength();
            if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(n) || n < 1 || n > length) {
                state.countInput.setAttribute("aria-invalid", "true"); state.countHint.setAttribute("data-error", ""); updateCountHint(); return;
            }
            cancelCountEdit(true);
            activateMatch(n - 1);
        }
        function matchNumberKey(event) {
            if (event.target === state.countInput && state.countEdit) {
                if (event.isComposing || event.keyCode === 229 || state.countEdit.composing) return true;
                if (event.key === "F3" || ((event.metaKey || event.ctrlKey) && /^[gG]$/.test(event.key))) { event.preventDefault(); event.stopPropagation(); return true; }
                if (event.key === "Enter" || event.key === "Escape") {
                    event.preventDefault(); event.stopPropagation();
                    if (!event.repeat) { if (event.key === "Enter") commitCountEdit(); else cancelCountEdit(true); }
                }
                return true;
            }
            if (event.target === state.count && (event.key === "Enter" || event.key === " ")) {
                if (event.repeat) event.preventDefault();
                return true; // Native button activation is the only opening path.
            }
            return false;
        }

		function setStatus(text, busy) {
			if (!state.status) return;
			state.jumpStatus = null;
			state.status.textContent = text || "";
			state.status.title = busy ? L.stopTip : (text || "");
			if (busy) state.status.setAttribute("data-busy", "1");
			else state.status.removeAttribute("data-busy");
			updateCount();
		}

		function setJumpStatus(base) {
			setStatus(L.jumpHint.replace("{n}", String(resultLength())) + (base ? " " + base : ""), false);
			state.jumpStatus = base || "";
		}

		function updateScopeButton() {
			if (!state.scopeInputs) return;
			state.scopeInputs.whole.checked = state.scope === "whole";
			state.scopeInputs.page.checked = state.scope === "page";
			if (state.refreshBtn) {
				state.refreshBtn.disabled = state.scope !== "whole";
				state.refreshBtn.title = state.scope === "whole" ? L.refreshHistory : L.refreshUnavailable;
			}
			updateContentButton();
		}

		function selectedContentCount() {
			return CONTENT_TYPES.filter(function (type) { return state.contentTypes[type] === true; }).length;
		}

		function contentSelectionIsDefault() {
			return CONTENT_TYPES.every(function (type) { return state.contentTypes[type] === DEFAULT_CONTENT_TYPES[type]; });
		}

		function updateContentButton() {
			if (!state.contentBtn) return;
			var count = selectedContentCount();
			var changed = state.scope !== "whole" || !contentSelectionIsDefault();
			var label = L.contentButtonLabel.replace("{n}", String(count)).replace("{scope}", state.scope === "whole" ? L.scopeWhole : L.scopePage).replace("{changed}", changed ? L.optionsChanged : "");
			state.contentBtn.setAttribute("aria-label", label);
			state.contentBtn.title = label;
			if (!changed) state.contentBtn.removeAttribute("data-filtered");
			else state.contentBtn.setAttribute("data-filtered", "1");
		}

		// Search options are a body-level floating layer, so expanding it never changes
		// the find bar's geometry or gets clipped by the bar's overflow container.
		function positionContentPanel() {
			var popup = state.contentPanel, trigger = state.contentBtn;
			if (!popup || popup.hidden) return;
			if (!trigger || !state.target) { closeContentPanel(); return; }
			var viewport = readingViewport(state.target), header = barAnchor(state.target);
			if (!viewport || !header || !state.bar.hasAttribute("data-positioned")) {
				closeContentPanel(); return;
			}
			var bounds = state.target.panel.getBoundingClientRect(), anchor = trigger.getBoundingClientRect();
			var barBounds = state.bar.getBoundingClientRect(), gap = 4;
			var leftEdge = Math.max(bounds.left, viewport.left) + 8;
			var rightEdge = Math.min(bounds.right, viewport.right) - 8;
			var topEdge = Math.max(bounds.top, viewport.top, header.getBoundingClientRect().bottom) + 8;
			var bottomEdge = Math.min(bounds.bottom, viewport.bottom) - 8;
			var width = Math.min(320, rightEdge - leftEdge);
			var below = Math.max(0, bottomEdge - barBounds.bottom - gap);
			var above = Math.max(0, barBounds.top - topEdge - gap);
			if (width <= 0 || Math.max(below, above) <= 0) { closeContentPanel(); return; }
			popup.style.width = width + "px";
			// Prefer the whole bar's lower edge. Near the panel's bottom, flip the
			// layer above it and scroll its contents instead of moving the toolbar.
			var desired = popup.querySelector('.content-viewport').scrollHeight + 2;
			var opensAbove = below < Math.min(desired, 160) && above > below;
			popup.style.maxHeight = (opensAbove ? above : below) + "px";
			var box = popup.getBoundingClientRect();
			popup.style.left = Math.max(leftEdge, Math.min(anchor.left, rightEdge - width)) + "px";
			popup.style.top = (opensAbove ? barBounds.top - gap - box.height : barBounds.bottom + gap) + "px";
			popup.setAttribute("data-placement", opensAbove ? "top" : "bottom");
		}

		function closeContentPanel(restoreFocus) {
			if (!state.contentPanel || state.contentPanel.hidden) return false;
			resetDiagnosticCopy();
			state.contentPanel.hidden = true;
			state.contentBtn?.setAttribute("aria-expanded", "false");
			if (restoreFocus && state.contentBtn?.isConnected) state.contentBtn.focus({ preventScroll: true });
			return true;
		}

        function closeAbout() {
            var owner = state.aboutOwner;
            state.aboutOwner = null;
            state.aboutEpoch += 1;
            if (state.bar) { state.bar.removeAttribute('data-about-open'); state.bar.inert = false; }
            if (owner) owner.setOpen(false);
        }

        function openAbout() {
            var owner = state.target && state.aboutViews.get(state.target.anchor);
            if (!state.aboutAvailable || !owner || state.aboutOwner || !state.mounted) return;
            cancelCountEdit(false);
            cancelReturn(L.returnCancelled);
            cancelNavigation();
            // The host Modal must remember the persistent trigger, not this hidden menu item.
            closeContentPanel(true);
            state.aboutOwner = owner;
            state.aboutEpoch += 1;
            state.bar.setAttribute('data-about-open', '');
            owner.setOpen(true);
        }

		function toggleContentPanel() {
			if (!state.contentPanel) return;
			if (closeContentPanel(true)) return;
			state.contentPanel.hidden = false;
			state.contentBtn.setAttribute("aria-expanded", "true");
			// Reopening starts at the scope choices; preventScroll must not leave
			// keyboard focus above a previously scrolled options viewport.
			state.contentPanel.querySelector('.content-viewport').scrollTop = 0;
			positionContentPanel();
			if (!state.contentPanel.hidden) state.scopeInputs[state.scope].focus({ preventScroll: true });
		}

		function contentTypeEnabled(type) {
			return !!type && state.contentTypes[type] === true;
		}

		function sourceContentType(source) {
			if (source.kind === "user") return "user";
			if (source.kind === "assistant") return "assistant";
			if (source.kind === "reasoning" || source.contentType === "reasoning") return "reasoning";
			if (source.kind === "tool-call" || source.kind === "tool-result") return "tool";
			if (source.kind === "context") return source.sourceKind === "agent-message" ? "subagent" : "context";
			return null;
		}

		function contentMatchEnabled(source, block, start, end) {
			var fallback = sourceContentType(source);
			var parts = Array.isArray(block.contentParts) && block.contentParts.length ? block.contentParts : [{ start: 0, end: block.text.length, type: fallback }];
			var cursor = start;
			for (var i = 0; i < parts.length && cursor < end; i++) {
				var part = parts[i];
				if (part.end <= start || part.start >= end) continue;
				if (part.start > cursor && !contentTypeEnabled(fallback)) return false;
				if (!contentTypeEnabled(part.type)) return false;
				cursor = Math.max(cursor, Math.min(end, part.end));
			}
			return cursor >= end || contentTypeEnabled(fallback);
		}

		function selectedHistoryErrors(snapshot) {
			return (snapshot?.errors || []).filter(function (error) {
				if (error.textKind === "assistant") return contentTypeEnabled("assistant") || contentTypeEnabled("assistant-rich");
				return !error.textKind || contentTypeEnabled(sourceContentType({ kind: error.textKind, sourceKind: error.messageSourceKind }));
			});
		}

		function selectedProjectionComplete(snapshot) {
			return !!snapshot && snapshot.readComplete && (snapshot.status === "complete" || snapshot.status === "partial") && selectedHistoryErrors(snapshot).length === 0;
		}

		function assistantDomContentType(node, row) {
			var semantic = node.parentElement?.closest('a,code,blockquote,li,[data-code-block-content],[data-footnotes],sup');
			return semantic && row.contains(semantic) ? "assistant-rich" : "assistant";
		}

		function loadedContentType(node, store) {
			var row = node.parentElement?.closest("[data-chat-node-key]");
			if (!row || !state.target?.root.contains(row)) return null;
			var kind = row.getAttribute("data-chat-flow-kind");
			var part = row.getAttribute("data-chat-group-part");
			if (kind === "user" || kind === "steering") return "user";
			if (kind === "assistant-step") return part === "reasoning" ? "reasoning" : assistantDomContentType(node, row);
			if (kind === "tool-call" || kind === "command") return "tool";
			if (kind === "context" || kind === "turn-trigger") {
				var semantic = store && typeof store.get === "function" ? store.get(row.getAttribute("data-chat-node-key")) : null;
				return semantic?.data?.source?.kind === "agent-message" ? "subagent" : "context";
			}
			if (kind === "system-prompt") return "context";
			return null;
		}

		function contentSelectionChanged() {
            cancelCountEdit(false);
			cancelReturn(L.returnCancelled); cancelNavigation();
			state.selection = null; state.ranges = []; state.index = -1;
			updateContentButton(); setStatus("", false); runSearch(false);
			if (state.scope === "whole" && state.query) schedulePageIn();
		}

		function unavailableStatus() {
			return state.target || (state.adapter && state.adapter.scopeUnavailable()) ? L.noRoot : L.noTarget;
		}

		// The code content wrapper survives the host's plain-pre -> Shiki tree
		// swap (0.2.0-rc.2 CodeBlock). Otherwise use the nearest block boundary.
		function selectionBlock(range, root) {
			var nearest = null;
			for (var node = range.startContainer.parentNode; node; node = node.parentNode) {
				if (node === root || node.nodeType === 11) return nearest || node;
				if (node.hasAttribute && node.hasAttribute("data-code-block-content")) return node;
				if (!nearest && BLOCK_TAGS[node.tagName]) nearest = node;
			}
			return nearest;
		}

		function positionInBlocks(range, blocks) {
			for (var i = 0; i < blocks.length; i++) {
				var start = null, end = null;
				for (var j = 0; j < blocks[i].segments.length; j++) {
					var segment = blocks[i].segments[j];
					if (segment.node === range.startContainer) start = segment.start + range.startOffset;
					if (segment.node === range.endContainer) end = segment.start + range.endOffset;
				}
				if (start !== null && end !== null) return { run: i, start: start, end: end };
			}
			return null;
		}

		function matchNodes(blocks, position) {
			if (!position) return [];
			return blocks[position.run].segments.filter(function (segment) {
				return segment.end > position.start && segment.start < position.end;
			}).map(function (segment) {
				return {
					node: segment.node, text: segment.node.data,
					start: Math.max(position.start, segment.start) - segment.start,
					end: Math.min(position.end, segment.end) - segment.start
				};
			});
		}

		function rememberSelection() {
			var range = state.ranges[state.index];
			state.selection = null;
			if (!range || !state.target) return;
			var block = selectionBlock(range, state.target.root);
			var blocks = block ? collectTextBlocks(block) : [];
			var position = positionInBlocks(range, blocks);
			var nodes = matchNodes(blocks, position);
			state.selection = {
				target: state.target, query: state.query, root: state.target.root,
				startNode: range.startContainer, startOffset: range.startOffset,
				endNode: range.endContainer, endOffset: range.endOffset,
				block: block, position: position, nodes: nodes,
				texts: blocks.map(function (item) { return item.text; })
			};
		}

		function retainedIndex(saved) {
			if (!saved || saved.target !== state.target || saved.query !== state.query || saved.root !== state.target.root) return -1;
			if (!saved.block || !saved.block.isConnected || !saved.position) return -1;
			var blocks = collectTextBlocks(saved.block);
			var i, range;
			for (i = 0; i < state.ranges.length; i++) {
				range = state.ranges[i];
				if (range.startContainer !== saved.startNode || range.startOffset !== saved.startOffset ||
					range.endContainer !== saved.endNode || range.endOffset !== saved.endOffset) continue;
				// Compare the new match's actual ordered participants. Old nodes can
				// remain connected with unchanged text after moving outside this hit.
				var nodes = matchNodes(blocks, positionInBlocks(range, blocks));
				if (nodes.length > 0 && nodes.length === saved.nodes.length && nodes.every(function (item, index) {
					var previous = saved.nodes[index];
					return item.node === previous.node && item.text === previous.text && item.start === previous.start && item.end === previous.end;
				})) return i;
			}
			if (blocks.length !== saved.texts.length || blocks.some(function (item, index) { return item.text !== saved.texts[index]; })) return -1;
			var segments = blocks[saved.position.run].segments;
			var first = null, last = null;
			for (i = 0; i < segments.length; i++) {
				if (saved.position.start >= segments[i].start && saved.position.start < segments[i].end) first = segments[i];
				if (saved.position.end > segments[i].start && saved.position.end <= segments[i].end) last = segments[i];
			}
			if (!first || !last) return -1;
			for (i = 0; i < state.ranges.length; i++) {
				range = state.ranges[i];
				if (range.startContainer === first.node && range.startOffset === saved.position.start - first.start &&
					range.endContainer === last.node && range.endOffset === saved.position.end - last.start) return i;
			}
			return -1;
		}

		function runSearch(keepIndex) {
            if (state.scope === "whole") { searchHistory(!keepIndex); return; }
            cancelCountEdit(false); state.resultsRevision++; state.pageDirty = false; cancelNavigation();
			var valid = state.adapter && state.adapter.valid(state.target);
			var store = valid ? state.adapter.nodes(state.target) : null;
			state.ranges = valid ? collectRanges(state.query, state.target.root, function (node) { return loadedContentType(node, store); }, contentTypeEnabled) : [];
			if (!valid) setStatus(unavailableStatus(), false);
			state.capped = state.ranges.length >= MAX_MATCHES;
			var retained = keepIndex && valid ? retainedIndex(state.selection) : -1;
			if (!state.ranges.length) state.index = -1;
			else if (!keepIndex) state.index = 0;
			else if (state.index < 0) state.index = -1;
			else state.index = retained >= 0 ? retained : Math.max(0, Math.min(state.index, state.ranges.length - 1));
			rememberSelection();
			paint();
			updateCount();

		}

        function goTo(delta) {
            cancelCountEdit(false);
            var n = resultLength();
            if (!n) return;
            activateMatch(state.index < 0 ? (delta < 0 ? n - 1 : 0) : ((state.index + delta) % n + n) % n);
        }
        function activateMatch(index) {
            if (!Number.isInteger(index) || index < 0 || index >= resultLength()) return;
            cancelReturn(L.returnCancelled); cancelNavigation();
            if (!state.adapter?.valid(state.target)) { runSearch(false); return; }
            if (state.scope === "whole") { activateHistoryMatch(index); return; }
            var range = state.ranges[index];
            if (!range || !state.target.root.contains(range.startContainer) || !state.target.root.contains(range.endContainer)) { runSearch(true); return; }
            state.index = index;
            rememberSelection(); paint(); updateCount(); navigateToRange(range);
        }

		function scheduleRescan() {
            if (state.scope === "page") { state.pageDirty = true; cancelCountEdit(false); }
			// While a page-in is running the pager rescans itself after every page;
			// rescanning on each mutation as well would walk the whole DOM per row.
			if (state.paging) return;
			clearTimeout(state.debounce);
			state.debounce = setTimeout(function () {
				if (isOpen()) runSearch(true);
			}, 250);
		}

		function startObserver() {
			if (state.observer || !state.target || typeof MutationObserver === "undefined") return;
			state.observer = new MutationObserver(scheduleRescan);
			state.observer.observe(state.target.root, { childList: true, subtree: true, characterData: true });
		}

		function stopObserver() {
			if (state.observer) { state.observer.disconnect(); state.observer = null; }
			clearTimeout(state.debounce);
		}
		//#endregion

		//#region paging the older history in

        function cancelHistoryScan(pause = true) {
            state.scanCancelled=pause;
            state.queryToken++;clearTimeout(state.scanTimer);state.scanTimer=0;state.scanBusy=false;state.scanComplete=false;
        }
        function cancelPageIn() {
            state.pageToken++;
            if(state.history){state.history.cancel();state.historySnapshot=state.history.snapshot();}
            cancelHistoryScan();
            if(state.settleCancel)state.settleCancel();
            clearTimeout(state.settleTimer);clearTimeout(state.pageTimer);state.pageTimer=0;state.paging=false;
        }
        function schedulePageIn() {
            clearTimeout(state.pageTimer);
            state.pageTimer=setTimeout(function(){state.pageTimer=0;startPageIn();},150);
        }
        function historyStatus() {
            if(state.scope!=="whole"||!state.status)return;
            var snapshot=state.historySnapshot;
			var relevantErrors=selectedHistoryErrors(snapshot);
			var projectionComplete=selectedProjectionComplete(snapshot);
            var text;
			if(!state.projector)text=ZH?'无法搜索完整对话，请选择“已加载内容”。':'The whole conversation cannot be searched. Choose “Loaded content”.';
			else if(!snapshot)text=state.query?(ZH?'正在搜索完整对话…':'Searching the whole conversation…'):'';
			else if(snapshot.status==='reading'||snapshot.status==='projecting'||state.scanBusy)text=ZH?'正在搜索完整对话…':'Searching the whole conversation…';
			else if(snapshot.readComplete&&snapshot.status==='partial'&&!state.scanCancelled&&state.scanCursor>=snapshot.documents.length&&relevantErrors.length&&relevantErrors.every(function(error){return error.code==='truncated-tool-output';}))text=ZH?'部分内容没有完整保存，搜索结果可能不完整。':'Some content was not saved in full, so results may be incomplete.';
			else if(!snapshot.readComplete||!projectionComplete||!state.scanComplete)text=L.incomplete;
			else text='';
			function add(part){if(part)text+=(text?' · ':'')+part;}
			if(state.capped)add(L.cap.replace('{n}',String(MAX_MATCHES)));
			add(state.sourceNotice);
			if(state.liveCount)add((ZH?'当前正在生成的回复中另有 ':'The reply being generated contains ')+state.liveCount+(state.liveCapped?'+':'')+(ZH?' 个匹配。':' additional matches.'));
            setStatus(text,state.paging||state.scanBusy);
        }
        function startPageIn() {
            if(state.scope!=="whole"||!state.query||!isOpen())return;
            var target=state.target;
            if(!state.adapter||!state.adapter.valid(target)){setStatus(unavailableStatus(),false);return;}
            var remote=state.remote&&state.remote.session;
            if(!state.projector||!remote||typeof remote.follow!=='function'||typeof remote.page!=='function'){
                recordFailure('capability', 'unsupported-host');
                setStatus(ZH?"完整会话搜索不可用：宿主缺少完整历史接口。请切换到已加载内容":"Whole-session search unavailable: complete-history API missing. Switch to Loaded content",false);return;
            }
            if(state.history&&state.historySnapshot&&state.historySnapshot.sessionId===target.id&& !['cancelled','error'].includes(state.historySnapshot.status)){
                searchHistory(false);return;
            }
            var token=++state.pageToken, errorCount=0;
            state.paging=true;state.sourceNotice='';state.historySnapshot=null;searchHistory(true);
            state.history=createHistoryReader({remote:state.remote,sessionId:target.id,generation:token,project:state.projector,onUpdate:function(snapshot){
                if(token!==state.pageToken||state.target!==target||!isOpen()||state.scope!=="whole"||!state.adapter.valid(target))return;
                state.historySnapshot=snapshot;state.paging=['reading','projecting','idle'].includes(snapshot.status);
                if(snapshot.status!=='cancelled' && snapshot.errors.length>errorCount){
                    recordFailure(snapshot.readComplete?'projection':'history', snapshot.errors[snapshot.errors.length-1].code);
                    errorCount=snapshot.errors.length;
                }
                searchHistory(false);historyStatus();
            }});
            state.history.start();historyStatus();
        }
        function searchHistory(reset) {
            if(state.scope!=="whole")return;
            if(reset||state.scanQuery!==state.query){
                cancelCountEdit(false); state.resultsRevision++; cancelNavigation();
                cancelHistoryScan(false);state.scanQuery=state.query;state.scanCursor=0;state.hits=[];state.total=0;state.ranges=[];state.index=-1;state.capped=false;state.sourceNotice='';state.liveCount=0;paint();
            }
            if(!state.query){setStatus("",false);return;}
            if(!state.historySnapshot||state.scanCancelled){updateCount();return;}
            if(state.scanBusy)return;
            var token=state.queryToken,target=state.target,query=state.query;
            var pattern=query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
            var matcher=new RegExp(pattern,'giu');
            state.scanBusy=true;state.scanComplete=false;
            function cancelled(){return token!==state.queryToken||state.target!==target||!isOpen()||state.scope!=="whole";}
            var source=null,blockIndex=0;
            function pass(){
                state.scanTimer=0;if(cancelled())return;
                var started=Date.now(),matches=0;
                while(Date.now()-started<10){
                    var docs=state.historySnapshot.documents;
                    if(!source){
                        if(state.scanCursor>=docs.length){
							state.scanBusy=false;state.scanComplete=selectedProjectionComplete(state.historySnapshot);state.capped=state.total>MAX_MATCHES;
                            scanLiveCount();updateCount();historyStatus();return;
                        }
                        source=docs[state.scanCursor];blockIndex=0;matcher.lastIndex=0;
                    }
                    if(blockIndex>=source.blocks.length){source=null;state.scanCursor++;continue;}
					var block=source.blocks[blockIndex],match;
					while((match=matcher.exec(block.text))!==null){
						if(contentMatchEnabled(source,block,match.index,match.index+match[0].length)){
							state.total++;
							if(state.hits.length<MAX_MATCHES)state.hits.push({source:source,blockIndex:blockIndex,start:match.index,end:match.index+match[0].length,text:match[0]});
						}
                        if(++matches%256===0&&Date.now()-started>=10)break;
                    }
                    if(match!==null)break;
                    matcher.lastIndex=0;blockIndex++;
                }
                state.capped=state.total>MAX_MATCHES;updateCount();historyStatus();state.scanTimer=setTimeout(pass,0);
            }
            pass();
        }
        function scanLiveCount(){
            state.liveCount=0;state.liveCapped=false;
            var store=state.adapter&&state.adapter.nodes(state.target);
            if(!store||!state.projector||!state.query)return;
            for(var node of store.values()){
                if(node.kind!=='assistant-step'||node.data?.status!=='running')continue;
                var blocks=node.data.blocks||[];
                for(var i=0;i<blocks.length;i++){
                    if(blocks[i].kind!=='text'&&blocks[i].kind!=='reasoning')continue;
                    try{
                        var projected=state.projector({kind:blocks[i].kind==='reasoning'?'reasoning':'assistant',format:'markdown',raw:blocks[i].text,streaming:true});
						for(var block of projected.blocks){
							var liveMatches=findMatches(block.text,state.query).filter(function(match){return contentMatchEnabled({kind:blocks[i].kind==='reasoning'?'reasoning':'assistant'},block,match.start,match.end);}).length;
							state.liveCount+=liveMatches;if(liveMatches>=MAX_MATCHES)state.liveCapped=true;
						}
                    }catch(error){}
                }
            }
        }
        function sourceNode(source,store){
            var found=store.values().filter(function(node){
                if(source.kind==='user'||source.kind==='context')return node.data?.seq===source.seq;
                if(source.callId)return node.kind==='tool-call'&&node.data?.root?.callId===(source.rootCallId||source.callId);
                return node.kind==='assistant-step'&&node.data?.finalNode?.seq===source.seq&&(!source.messageId||node.data.finalNode.messageId===source.messageId);
            });
            return found.length===1?found[0]:null;
        }
        function sourceRows(target,node){
            return Array.from(target.root.querySelectorAll('[data-chat-node-key]')).filter(function(row){return row.dataset.chatNodeKey===node.key;});
        }
        function expandSource(target,node,source,activated){
            var rows=sourceRows(target,node),buttons=[];
            // Expand only the target Turn, its containing process group and its
            // own tool/reasoning disclosures. Never invoke Inspect/tool actions.
            var turn=rows[0]?.dataset.chatTurn||String(source.turn||'');
            for(var b of target.root.querySelectorAll('button[data-turn-process][aria-expanded="false"]')){
                if(b.closest('[data-chat-turn]')?.dataset.chatTurn===turn)buttons.push(b);
            }
            for(var row of rows){
                for(var group=row.parentElement;group&&group!==target.root;group=group.parentElement){
                    if(group.hasAttribute('data-chat-group-key'))buttons.push(...group.querySelectorAll('button[data-process-activity][aria-expanded="false"],[role="button"][data-process-activity][aria-expanded="false"]'));
                }
                buttons.push(...row.querySelectorAll('button[aria-expanded="false"],[role="button"][aria-expanded="false"]'));
            }
            for(var button of new Set(buttons))if(activateDisclosure(button,activated))return true;
            return false;
        }
        function activateHistoryMatch(index){
            state.index=index;
            state.ranges=[];paint();updateCount();
            var hit=state.hits[state.index],source=hit.source;
			state.sourceNotice='';
            historyStatus();
			if(source.blocks[hit.blockIndex].rendered===false||(source.blocks[hit.blockIndex].visibleChars!==undefined&&hit.end>source.blocks[hit.blockIndex].visibleChars)){state.sourceNotice=ZH?'已找到结果，但这部分内容未在对话中完整显示。':'A result was found, but this content is not fully shown in the conversation.';historyStatus();return;}
			if(source.blocks[hit.blockIndex].imageDescription){state.sourceNotice=ZH?'在图片说明中找到结果，但无法在正文中高亮。':'A result was found in an image description, but it cannot be highlighted in the conversation.';historyStatus();return;}
            if(source.transcriptVisible===false||source.mapping==='stored'){
				state.sourceNotice=ZH?'已找到结果，但它没有显示在对话正文中。':'A result was found, but it is not shown in the conversation.';historyStatus();return;
            }
            navigateHistoryHit(hit);
        }
        async function navigateHistoryHit(hit){
            var target=state.target,source=hit.source,token=state.navigationToken,queryToken=state.queryToken;
            var face=state.adapter.face(target),store=state.adapter.nodes(target),activated=new Set();
            function current(){return token===state.navigationToken&&queryToken===state.queryToken&&state.target===target&&state.scope==='whole'&&isOpen()&&state.adapter.valid(target)&&state.adapter.face(target)===face&&state.hits[state.index]===hit;}
            function pause(){return new Promise(resolve=>setTimeout(resolve,35));}
            if(!face||typeof face.loadThrough!=='function'||!store){if(current())recordFailure('jump','unavailable');setStatus(L.matchRevealFailed,false);return;}
            state.historyNavigating=true;
            try{
                if(!sourceNode(source,store))await face.loadThrough(source.seq);
                if(!current())return;
                var started=Date.now(),mapped,node,turnActivated=false;
                while(current()&&Date.now()-started<5000){
                    node=sourceNode(source,store);
                    if(node){
                        if(!turnActivated&&hostNavigationReady(target,face)){turnActivated=activateLoadedTurn(target,store,String(source.turn||''));if(turnActivated){await pause();if(!current())return;}}
                        if(!current())return;
                        var rows=sourceRows(target,node);mapped=mapProjectedDocument(source,node,rows);
                        if(mapped.blocks){
                            var range=rangeForBlock(mapped.blocks[hit.blockIndex],hit.start,hit.end);
                            if(!range||range.toString()!==hit.text)break;
                            if(!current())return;
                            state.ranges[state.index]=range;paint();
                            state.historyNavigating=false;navigateToRange(range);return;
                        }
                        if(!expandSource(target,node,source,activated)&&mapped.reason!=='renderer-not-expanded'&&mapped.reason!=='read-card-unavailable'&&mapped.reason!=='read-lines-not-expanded'&&mapped.reason!=='tool-card-not-expanded'&&mapped.reason!=='tool-field-not-expanded'&&mapped.reason!=='context-not-expanded')break;
                    }
                    await pause();
                }
                if(current()){
                    recordFailure('jump','render');
                    state.historyNavigating=false;
					state.sourceNotice=L.matchRevealFailed;historyStatus();
                }
			}catch(error){if(current()){recordFailure('jump','error');state.historyNavigating=false;state.sourceNotice=L.matchRevealFailed;historyStatus();}}
        }

		function syncTarget(target, passive) {
			if (!state.adapter) return;
			var selected = passive ? state.adapter.refresh(state.target) : state.adapter.select(target || document.activeElement, state.target);
			if (selected) {
				var owner = state.positionOwner;
				if (owner && (owner.id !== selected.id || owner.panel !== selected.panel)) {
					resetBarPosition();
					if (state.positionControls) state.positionControls.hidden = true;
					if (state.dragHandle) state.dragHandle.setAttribute("aria-expanded", "false");
				}
				state.positionOwner = { id: selected.id, panel: selected.panel };
			}
			if (selected && state.target && selected.id === state.target.id && selected.anchor === state.target.anchor && selected.root === state.target.root && selected.panel === state.target.panel && selected.registration === state.target.registration) {
				if (state.origin && !originValid(state.origin)) { discardOrigin(); setStatus(returnFailure('unavailable'), false); }
				scheduleBarPosition();
				return;
			}
			if (!selected && !state.target) {
				if (isOpen()) runSearch(false);
				return;
			}
			clearDiagnostics();
            cancelCountEdit(false);
			closeContentPanel();
			discardOrigin();
			cancelPageIn();
			stopObserver();
			if (!selected || !state.target || selected.id !== state.target.id) { state.history = null; state.historySnapshot = null; }
            state.target = selected;
			state.sessionId = selected ? selected.id : null;
			if (!isOpen()) return;
			startBarPositioning();
			setStatus(selected ? "" : unavailableStatus(), false);
			runSearch(false);
			startObserver();
			if (selected && state.scope === "whole" && state.query) schedulePageIn();
		}

		function watchSession() {
			clearInterval(state.sessionTimer);
			state.sessionTimer = setInterval(function () {
				if (isOpen()) syncTarget(null, true);
			}, SESSION_POLL_MS);
		}

		function stopWatchingSession() {
			clearInterval(state.sessionTimer);
			state.sessionTimer = 0;
		}
		//#endregion

		function icon(d, size) {
			var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			svg.setAttribute("width", size); svg.setAttribute("height", size);
			svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("fill", "none");
			svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "2");
			svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round");
			var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
			path.setAttribute("d", d);
			svg.appendChild(path);
			return svg;
		}

		function button(label, d, onClick) {
			var btn = document.createElement("button");
			btn.type = "button";
			btn.setAttribute("aria-label", label);
			btn.title = label;
			btn.appendChild(icon(d, 14));
			btn.addEventListener("click", onClick);
			return btn;
		}

        function onQueryInput(input) {
            cancelCountEdit(false);
            cancelReturn(L.returnCancelled); cancelNavigation();
            state.query = input.value;
            if (state.scope === "whole") { searchHistory(true); if (state.query) schedulePageIn(); return; }
            setStatus("", false); runSearch(false);
            if (state.ranges.length && highlightsSupported()) navigateToRange(state.ranges[state.index]);
        }
        function setScope(scope) {
            if (state.scope === scope) return;
            cancelCountEdit(false);
            cancelReturn(L.returnCancelled); cancelNavigation(); cancelPageIn();
            state.scope = scope;
            state.ranges=[];state.index=-1;state.selection=null;updateScopeButton();setStatus("",false);
            runSearch(false);
            if (state.scope === "whole" && state.query) schedulePageIn();
        }

		function buildBar() {
			var bar = document.createElement("div");
			bar.id = BAR_ID;
			bar.setAttribute("role", "search");
			var controls = document.createElement("div");
			controls.className = "controls";
			var navigation = document.createElement("div");
			navigation.className = "navigation-controls";

			var input = document.createElement("input");
			input.type = "text";
			input.className = "query";
			input.placeholder = L.placeholder;
			input.setAttribute("aria-label", L.placeholder);
			input.addEventListener("input", function () { onQueryInput(input); });

			var contentBtn = document.createElement("button");
			contentBtn.type = "button";
			contentBtn.className = "content-filter";
			contentBtn.appendChild(icon("M5 12h.01M12 12h.01M19 12h.01", 16));
			contentBtn.setAttribute("aria-expanded", "false");
			contentBtn.setAttribute("aria-controls", BAR_ID + "-content-panel");
			contentBtn.addEventListener("click", toggleContentPanel);

			var contentPanel = document.createElement("div");
			contentPanel.id = BAR_ID + "-content-panel";
			contentPanel.className = "content-panel";
			contentPanel.hidden = true;
			contentPanel.setAttribute("role", "group");
			contentPanel.setAttribute("aria-label", L.contentButton);
			// Keep the menu material on the fixed shell while only its contents scroll.
			var contentViewport = document.createElement("div");
			contentViewport.className = "content-viewport";
			var scopeGroup = document.createElement("fieldset");
			scopeGroup.className = "scope-group";
			var scopeLegend = document.createElement("legend");
			scopeLegend.textContent = L.scopeLegend;
			scopeGroup.appendChild(scopeLegend);
			var scopeInputs = {};
			["whole", "page"].forEach(function (scope) {
				var option = document.createElement("label");
				option.className = "content-option";
				var radio = document.createElement("input");
				radio.type = "radio";
				radio.name = BAR_ID + "-scope";
				radio.value = scope;
				radio.checked = state.scope === scope;
				radio.addEventListener("change", function () { if (radio.checked) setScope(scope); });
				var label = document.createElement("span");
				label.textContent = scope === "whole" ? L.scopeWhole : L.scopePage;
				option.appendChild(radio); option.appendChild(label); scopeGroup.appendChild(option);
				scopeInputs[scope] = radio;
			});
			contentViewport.appendChild(scopeGroup);
			var contentGroup = document.createElement("fieldset");
			var legend = document.createElement("legend");
			legend.textContent = L.contentLegend;
			contentGroup.appendChild(legend);
			var contentOptions = document.createElement("div");
			contentOptions.className = "content-options";
			var contentInputs = {};
			CONTENT_TYPES.forEach(function (type) {
				var option = document.createElement("label");
				option.className = "content-option";
				var checkbox = document.createElement("input");
				checkbox.type = "checkbox";
				checkbox.id = BAR_ID + "-content-" + type;
				option.htmlFor = checkbox.id;
				checkbox.checked = state.contentTypes[type] === true;
				checkbox.addEventListener("change", function () { state.contentTypes[type] = checkbox.checked; contentSelectionChanged(); });
				var label = document.createElement("span");
				label.textContent = L.contentTypes[type];
				option.appendChild(checkbox); option.appendChild(label); contentOptions.appendChild(option); contentInputs[type] = checkbox;
			});
			contentGroup.appendChild(contentOptions);
			contentViewport.appendChild(contentGroup);
			var resetContent = document.createElement("button");
			resetContent.type = "button";
			resetContent.className = "content-reset";
			resetContent.textContent = L.contentReset;
			resetContent.addEventListener("click", function () {
				CONTENT_TYPES.forEach(function (type) { state.contentTypes[type] = DEFAULT_CONTENT_TYPES[type]; contentInputs[type].checked = DEFAULT_CONTENT_TYPES[type]; });
				contentSelectionChanged();
			});
			contentGroup.appendChild(resetContent);
			contentPanel.appendChild(contentViewport);

			var count = document.createElement("button");
            count.type = "button"; count.className = "count"; count.disabled = true;
            count.addEventListener("click", beginCountEdit);
            var countEditor = document.createElement("span");
            countEditor.className = "count-editor"; countEditor.hidden = true;
            var countInput = document.createElement("input");
            countInput.className = "count-input"; countInput.type = "text"; countInput.inputMode = "numeric"; countInput.autocomplete = "off";
            countInput.setAttribute("aria-label", L.jumpNumber); countInput.setAttribute("aria-describedby", BAR_ID + "-count-hint");
            countInput.addEventListener("input", function () { countInput.removeAttribute("aria-invalid"); state.countHint.removeAttribute("data-error"); updateCountHint(); });
            countInput.addEventListener("blur", function () { cancelCountEdit(false); });
            countInput.addEventListener("compositionstart", function () { if (state.countEdit) state.countEdit.composing = true; });
            countInput.addEventListener("compositionend", function () { if (state.countEdit) state.countEdit.composing = false; });
            var countTotal = document.createElement("span"); countTotal.setAttribute("aria-hidden", "true");
            countEditor.append(countInput, countTotal);
            var countHint = document.createElement("span"); countHint.className = "count-hint"; countHint.id = BAR_ID + "-count-hint"; countHint.hidden = true;
            countHint.setAttribute("role", "status"); countHint.setAttribute("aria-atomic", "true");
            var countLive = document.createElement("span");
            countLive.setAttribute("role", "status"); countLive.setAttribute("aria-live", "polite"); countLive.setAttribute("aria-atomic", "true");
            countLive.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)";
            state.countEditor = countEditor; state.countInput = countInput; state.countTotal = countTotal; state.countHint = countHint; state.countLive = countLive;

			var status = document.createElement("span");
			status.className = "status";
			status.setAttribute("role", "status");
			status.setAttribute("aria-live", "polite");
			status.setAttribute("aria-atomic", "true");
			status.title = L.stopTip;
			status.addEventListener("click", function () {
				if (!state.paging && !state.scanBusy) return;
				cancelPageIn();
				setStatus(L.incomplete, false);
			});

			buildPositionControls(controls, bar);
			controls.appendChild(input);
			controls.appendChild(count); controls.appendChild(countEditor);
			var refreshBtn = button(L.refreshHistory, "M20 7v5h-5M4 17v-5h5M6 8a7 7 0 0 1 12-2l2 3M4 15l2 3a7 7 0 0 0 12-2", function () {
				if (state.scope !== "whole") return;
				closeContentPanel(true);
				cancelPageIn(); cancelNavigation(); state.history = null; state.historySnapshot = null;
				searchHistory(true); startPageIn();
			});
			var refreshLabel = document.createElement("span");
			refreshLabel.textContent = L.refreshHistory;
			refreshBtn.appendChild(refreshLabel);
			var historyCommand = document.createElement("div");
			historyCommand.className = "history-command";
			historyCommand.appendChild(refreshBtn);
			contentViewport.appendChild(historyCommand);
			state.refreshBtn = refreshBtn;
            var diagnosticCommand = document.createElement('div');
            diagnosticCommand.className = 'history-command diagnostic-command';
            var diagnosticBtn = button(L.copyDiagnostics, 'M9 5H5v16h12v-4M9 3h12v12H9z', copyDiagnostics);
            var diagnosticLabel = document.createElement('span');
            diagnosticLabel.textContent = L.copyDiagnostics;
            diagnosticBtn.appendChild(diagnosticLabel);
            var diagnosticFeedback = document.createElement('span');
            diagnosticFeedback.className = 'diagnostic-feedback';
            diagnosticFeedback.setAttribute('role', 'status');
            var feedbackIssue = document.createElement('a');
            feedbackIssue.className = 'feedback-issue'; feedbackIssue.textContent = L.feedbackIssue;
            feedbackIssue.href = 'https://github.com/Ryuu-64/dsh-find-all/issues';
            feedbackIssue.target = '_blank'; feedbackIssue.rel = 'noopener noreferrer';
            feedbackIssue.appendChild(icon('M14 3h7v7M21 3l-9 9M10 5H5v14h14v-5', 14));
            var feedbackPrivacy = document.createElement('p');
            feedbackPrivacy.className = 'feedback-privacy'; feedbackPrivacy.textContent = L.feedbackPrivacy;
            feedbackPrivacy.id = BAR_ID + '-feedback-privacy'; feedbackIssue.setAttribute('aria-describedby', feedbackPrivacy.id);
            diagnosticCommand.append(diagnosticBtn, diagnosticFeedback, feedbackIssue, feedbackPrivacy);
            contentViewport.appendChild(diagnosticCommand);
            var aboutCommand = document.createElement('div');
            aboutCommand.className = 'history-command';
            var aboutBtn = document.createElement('button');
            aboutBtn.type = 'button'; aboutBtn.textContent = L.about;
            aboutBtn.disabled = !state.aboutAvailable;
            if (!state.aboutAvailable) aboutBtn.title = L.aboutUnavailable;
            aboutBtn.setAttribute('aria-haspopup', 'dialog');
            aboutBtn.addEventListener('click', openAbout);
            aboutCommand.appendChild(aboutBtn); contentViewport.appendChild(aboutCommand);
            state.diagnosticBtn = diagnosticBtn;
            state.diagnosticFeedback = diagnosticFeedback;
			navigation.appendChild(button(L.prev, "m18 15-6-6-6 6", function () { goTo(-1); }));
			navigation.appendChild(button(L.next, "m6 9 6 6 6-6", function () { goTo(1); }));
			var returnBtn = document.createElement('button');
			returnBtn.type = 'button'; returnBtn.setAttribute('data-find-all-return', '');
			returnBtn.hidden = true;
			returnBtn.appendChild(icon('M9 10H4l5-5M4 10h10a6 6 0 0 1 0 12h-3', 14));
			var returnLabel = document.createElement('span');
			returnLabel.className = 'return-label';
			returnBtn.appendChild(returnLabel);
			returnBtn.addEventListener('click', returnToOrigin);
			state.returnBtn = returnBtn;
			navigation.appendChild(returnBtn);
			navigation.appendChild(contentBtn);
			var closeBtn = button(L.close, "M18 6 6 18M6 6l12 12", close);
			navigation.appendChild(closeBtn);
			// The portal follows its trigger in keyboard order without trapping focus.
			contentPanel.addEventListener("keydown", function (event) {
				if (event.key !== "Tab") return;
				if (event.shiftKey && event.target === scopeInputs[state.scope]) {
					event.preventDefault(); closeContentPanel(true);
				} else if (!event.shiftKey && event.target === (aboutBtn.disabled ? feedbackIssue : aboutBtn)) {
					event.preventDefault(); closeContentPanel(); closeBtn.focus({ preventScroll: true });
				}
			});
			controls.appendChild(navigation);
			bar.insertBefore(controls, bar.firstChild);
			bar.appendChild(countHint); bar.appendChild(status); bar.appendChild(countLive);

			state.bar = bar;
			state.input = input;
			state.count = count;
			state.status = status;
			state.scopeInputs = scopeInputs;
			state.contentBtn = contentBtn;
			state.contentPanel = contentPanel;
			state.contentInputs = contentInputs;
			updateScopeButton();
			updateContentButton();
			document.body.appendChild(bar);
			document.body.appendChild(contentPanel);
			var announcement = document.createElement('span');
			announcement.setAttribute('role', 'status'); announcement.setAttribute('aria-live', 'polite');
			announcement.setAttribute('aria-atomic', 'true');
			announcement.style.cssText = 'position:fixed;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)';
			state.announcement = announcement;
			document.body.appendChild(announcement);
		}

		function open(target) {
			if (typeof document === "undefined" || document.body === null) return;
			var wasOpen = isOpen();
			syncTarget(target || document.activeElement, false);
			if (!wasOpen) state.origin = captureReadingOrigin();
			if (!state.bar) buildBar();
			state.bar.style.display = "flex";
			startBarPositioning();
			updateReturnButton();
			if (state.announcement) state.announcement.textContent = "";
			var selection = "";
			try { selection = String(window.getSelection()).trim(); } catch (error) {}
			if (state.target && selection && selection.length <= 200 && selection !== state.query) {
				state.query = selection;
			}
			state.input.value = state.query;
			state.input.focus();
			state.input.select();
			runSearch(false);
			if (!state.query && state.target && state.adapter && state.adapter.valid(state.target) && !state.origin) {
				setStatus(L.originUnavailable, false);
			}
			startObserver();
			watchSession();
			if (state.scope === "whole" && state.query) schedulePageIn();
		}

		function close() {
            closeAbout();
            cancelCountEdit(false);
            resetDiagnosticCopy();
			closeContentPanel();
			discardOrigin();
			cancelPageIn();
			stopWatchingSession();
			stopBarPositioning();
			state.manualPosition = state.positionOwner = null;
			state.suppressMoveClick = false;
			if (state.positionControls) state.positionControls.hidden = true;
			if (state.dragHandle) state.dragHandle.setAttribute("aria-expanded", "false");
			if (state.bar) { state.bar.style.display = "none"; state.bar.removeAttribute("data-positioned"); }
			state.ranges = [];
            state.hits=[];state.total=0;state.scanQuery=null;
			state.index = -1;
			state.selection = null;
			setStatus("", false);
			paint(); // clears registered highlights
			updateCount();
			stopObserver();
		}

		function isOpen() {
			return !!state.bar && state.bar.style.display !== "none";
		}

		function apply(ctx) {
			var react = require("react");
			var ui = require("@deepseek-ai/dsh-client-ui-primitives");
			state.aboutAvailable = !!ui.Modal;
			var SearchIcon = ui.IconSearchOutlineRegular || ui.IconSearchOutline16;
			state.ctx = ctx;
            state.writeClipboard = typeof ui.writeClipboard === "function" ? ui.writeClipboard : null;
            // A child dependency scope may remain pending on an older Host;
            // sessions/slots (and loaded-only search) keep running independently.
            if(typeof ctx.inject==='function')ctx.inject(['remote','remote.session'],function(remoteCtx){
                remoteCtx.effect(function(){
                    state.remote=remoteCtx.remote;
                    if(isOpen()&&state.scope==='whole'&&state.query)schedulePageIn();
                    return function(){cancelCountEdit(false);clearDiagnostics();cancelNavigation();cancelPageIn();state.remote=null;state.history=null;state.historySnapshot=null;state.hits=[];state.total=0;state.scanQuery=null;if(state.scope==='whole'){state.ranges=[];state.index=-1;paint();if(isOpen())setStatus(L.noService,false);}};
                });
            });
            try { state.projector=createProjector(ui,react,document); } catch(error) { state.projector=null; }
			state.adapter = createHostAdapter(ctx, function () {
				if (isOpen()) syncTarget(null, true);
			});
            function AboutPanel() {
                var copy = react.useState(''), copyStatus = copy[0], setCopyStatus = copy[1];
                var details = react.useRef(null);
                react.useLayoutEffect(function () {
                    var dialog = details.current && details.current.closest('[role="dialog"]');
                    var trigger = state.contentBtn;
                    // Older admitted Hosts export Modal without useModalLayer. Only those
                    // Hosts need the compatibility focus layer; modern Hosts keep ownership.
                    var legacy = typeof ui.useModalLayer !== 'function';
                    function items() { return Array.from(dialog.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),[tabindex="0"]')).filter(function (item) { return !item.closest('[hidden],[inert]'); }); }
                    function topmost() { return dialog && Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"],[role="menu"]')).pop() === dialog; }
                    function focusFirst() { focusWithoutScroll(items()[0] || dialog); }
                    function keydown(event) {
                        if (!topmost() || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
                        if (event.key === 'Escape') {
                            // Old Modal's document listener has no IME/repeat guard.
                            event.stopPropagation();
                            if (event.isComposing || event.keyCode === 229) return;
                            event.preventDefault();
                            if (!event.repeat) closeAbout();
                        } else if (event.key === 'Tab') {
                            var controls = items(), first = controls[0] || dialog, last = controls[controls.length - 1] || dialog;
                            if (!dialog.contains(document.activeElement) || document.activeElement === dialog || document.activeElement === (event.shiftKey ? first : last)) {
                                event.preventDefault(); focusWithoutScroll(event.shiftKey ? last : first);
                            }
                        }
                    }
                    function focusin(event) { if (topmost() && !dialog.contains(event.target)) focusFirst(); }
                    if (legacy && dialog) {
                        if (!dialog.contains(document.activeElement)) focusFirst();
                        window.addEventListener('keydown', keydown, true);
                        window.addEventListener('focusin', focusin, true);
                    }
                    // Modern Modal's child layout effect has already captured the trigger.
                    if (state.bar && state.aboutOwner) state.bar.inert = true;
                    return function () {
                        window.removeEventListener('keydown', keydown, true);
                        window.removeEventListener('focusin', focusin, true);
                        if (state.bar) state.bar.inert = false;
                        if (legacy && state.mounted && isOpen() && trigger && trigger.isConnected) focusWithoutScroll(trigger);
                    };
                }, []);
                function requestClose() {
                    // Older Modal closes on every document Escape. Ignore requests from
                    // behind a newer dialog/menu rather than dismissing two layers at once.
                    var dialog = details.current && details.current.closest('[role="dialog"]');
                    if (dialog && Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"],[role="menu"]')).pop() === dialog) closeAbout();
                }
                async function copyGroup() {
                    if (copyStatus === 'pending') return;
                    var owner = state.aboutOwner, epoch = state.aboutEpoch;
                    setCopyStatus('pending');
                    var copied = false;
                    try { copied = typeof state.writeClipboard === 'function' && await state.writeClipboard('1129212995') === true; } catch (error) {}
                    if (state.mounted && state.aboutOwner === owner && state.aboutEpoch === epoch) setCopyStatus(copied ? 'copied' : 'failed');
                }
                function link(label, href) { return react.createElement('a', { href: href, target: '_blank', rel: 'noopener noreferrer' }, label); }
                var repository = 'https://github.com/Ryuu-64/dsh-find-all';
                return react.createElement(ui.Modal, {
                    open: true, onClose: requestClose, title: 'dsh-find-all · ' + __DSH_FIND_ALL_VERSION__,
                    closeLabel: L.aboutClose, description: L.aboutDescription,
                    className: 'dsh-find-all-about', contentClassName: 'dsh-find-all-about-content'
                }, react.createElement('div', { ref: details, className: 'dsh-find-all-about-details' },
                    react.createElement('p', null, L.aboutAuthor + ': ', link('Ryuu-64', 'https://github.com/Ryuu-64')),
                    react.createElement('section', null,
                        react.createElement('h3', null, L.aboutSupport),
                        react.createElement('div', { className: 'dsh-find-all-about-links' }, link(L.feedbackIssue, repository + '/issues'), link(L.aboutRepository, repository)),
                        react.createElement('p', { className: 'dsh-find-all-about-status' }, L.feedbackPrivacy),
                        react.createElement('div', { className: 'dsh-find-all-about-group' },
                            react.createElement('span', null, L.aboutGroup + ': 1129212995'),
                            react.createElement(ui.Button, { type: 'button', size: 'sm', variant: 'ghost', disabled: copyStatus === 'pending', onClick: copyGroup }, L.aboutCopy)),
                        react.createElement('p', { role: 'status', className: 'dsh-find-all-about-status' }, copyStatus === 'pending' ? L.aboutCopying : copyStatus === 'copied' ? L.aboutCopied : copyStatus === 'failed' ? L.aboutCopyFailed : '')),
                    react.createElement('section', null,
                        react.createElement('h3', null, L.aboutCredits),
                        react.createElement('p', null, L.aboutUpstream),
                        react.createElement('div', { className: 'dsh-find-all-about-links' },
                            link('secyborg/dsh-find-bar', 'https://github.com/secyborg/dsh-find-bar'),
                            link('MIT', repository + '/blob/main/LICENSE'), link(L.aboutNotices, repository + '/blob/main/NOTICE.md')))));
            }
			function SessionFind(props) {
				var anchor = react.useRef(null);
                var about = react.useState(false);
                react.useEffect(function () {
                    var button = anchor.current && anchor.current.querySelector('button[data-find-all-session]');
                    if (!button) return;
                    var owner = { setOpen: about[1] };
                    state.aboutViews.set(button, owner);
                    return function () {
                        state.aboutViews.delete(button);
                        if (state.aboutOwner === owner) closeAbout();
                    };
                }, [props.sessionId]);
				var nodes = typeof props.useChat === 'function' ? props.useChat(function (snapshot) { return snapshot.nodes; }) : null;
				react.useEffect(function () {
					if (!anchor.current || !props.sessionId) return;
					// Older supported Button exports do not forward refs. Always
					// register the real button rather than the sizing-neutral wrapper.
					var button = anchor.current.querySelector("button[data-find-all-session]");
					if (button) return state.adapter.mount(button, props.sessionId, nodes);
				}, [props.sessionId, nodes]);
				return react.createElement("span", { ref: anchor, style: { display: "inline-flex", flex: "none" } },
					react.createElement(ui.Button, {
					type: "button", size: "sm", variant: "ghost", title: L.find, "aria-label": L.find,
					style: { flex: "none", width: 28, padding: 0, color: "var(--dsw-alias-label-secondary)" },
					"data-find-all-session": props.sessionId,
					onClick: function (event) { open(event.currentTarget); }
				}, react.createElement(SearchIcon, { size: 15 })), about[0] ? react.createElement(AboutPanel) : null);
			}
			ctx.slots.inject("conversation.session.header.utilities", function () {
				return ctx.slots.register({ name: "conversation.session.header.utilities", id: "dsh-find-all" }, SessionFind);
			});
			ctx.effect(function () {
                state.mounted = true;
				injectCss();
				var handler = createHandlers({
					matchNumberKey: matchNumberKey,
                    open: open, close: function () { if (!closeContentPanel(true)) close(); }, goTo: goTo, isOpen: isOpen,
					ownsKeys: function (event) {
                        if (state.aboutOwner) return false;
						var path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
						return !path.some(function (node) {
							return node && node.closest && node.closest('dialog[open], [aria-modal="true"], .monaco-editor, .cm-editor, .CodeMirror');
						});
					},
					isBarInput: function (target) { return target === state.input; }
				});
				function focus(event) {
                    if (state.aboutOwner) return;
                    if (state.countEdit && !state.countEditor.contains(event.target)) cancelCountEdit(false);
					var inContent = state.contentPanel && state.contentPanel.contains(event.target);
					if (!inContent && !state.contentBtn?.contains(event.target)) closeContentPanel();
					if (!inContent && (!state.bar || !state.bar.contains(event.target))) syncTarget(event.target);
				}
				function readingFocus(event) {
					// Reader activity may refresh the registered main frame, but cannot
					// select an embedded sidebar or change the search scope.
					if (event.isTrusted && event.target && event.target.closest && event.target.closest('[data-conversation-scroll]')) focus(event);
				}
				function interruptReading(event) {
					if ((!state.restoring && !state.navigationTimer && !state.historyNavigating) || !state.target) return;
					var viewport = readingViewport(state.target);
					if (!viewport || !viewport.scroll.contains(event.target)) return;
					if (event.type === 'keydown' && !/^(ArrowUp|ArrowDown|PageUp|PageDown|Home|End| )$/.test(event.key)) return;
					if (event.target.closest('input, textarea, [contenteditable="true"]')) return;
					cancelReturn(L.returnCancelled); cancelNavigation();
				}
				['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach(function (type) { window.addEventListener(type, interruptReading, true); });
				window.addEventListener("keydown", handler, true);
				window.addEventListener("focusin", focus, true);
				window.addEventListener("pointerdown", focus, true);
				window.addEventListener("wheel", readingFocus, true);
				function blur() { cancelCountEdit(false); finishBarDrag(); }
				window.addEventListener("blur", blur);
				window.addEventListener("resize", scheduleBarPosition);
				window.addEventListener("scroll", scheduleBarPosition, true);
				return function () {
                    state.mounted = false; closeAbout(); state.aboutViews.clear(); clearDiagnostics();
					['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach(function (type) { window.removeEventListener(type, interruptReading, true); });
					window.removeEventListener("keydown", handler, true);
					window.removeEventListener("focusin", focus, true);
					window.removeEventListener("pointerdown", focus, true);
					window.removeEventListener("wheel", readingFocus, true);
					window.removeEventListener("blur", blur);
					window.removeEventListener("resize", scheduleBarPosition);
					window.removeEventListener("scroll", scheduleBarPosition, true);
					close();
					state.query = "";
					if (state.bar) state.bar.remove();
					if (state.contentPanel) state.contentPanel.remove();
					if (state.announcement) state.announcement.remove();
					state.announcement = state.returnBtn = state.dragHandle = state.positionControls = null;
                    state.diagnosticBtn = state.diagnosticFeedback = state.writeClipboard = null;
					var style = document.querySelector('style[data-plugin-css="dsh-find-all/bar.css"]');
					if (style) style.remove();
					state.countEditor = state.countInput = state.countTotal = state.countHint = state.countLive = null;
                    state.bar = state.input = state.count = state.status = state.scopeInputs = state.contentBtn = state.contentPanel = state.contentInputs = null;
					state.adapter.clear();
					state.target = state.ctx = state.remote = state.history = state.historySnapshot = state.projector = null;
				};
			}, "find-all: browser lifecycle");
		}

export { apply, resolveScope, createHostAdapter, findIndices, findMatches, collectRanges, createHandlers, runPageIn };
export const inject = ["sessions", "slots"];
