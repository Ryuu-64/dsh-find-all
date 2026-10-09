// dsh-find-all — client half (v0.1).
//
// Forked from secyborg/dsh-find-bar (MIT, v0.1.0,
// https://github.com/secyborg/dsh-find-bar, snapshot commit
// ce7eb75efe94d768127c5977c649ecd950a9356c): the same find bar, plus the
// one thing it could not do — search the WHOLE conversation instead of only the
// part of it that happens to be rendered. Upstream copyright and licence are
// retained verbatim in LICENSE; see NOTICE.md for the modification list.
//
// Why a plain find bar is not enough in DSH Desktop:
//   * The desktop window is an Electron shell, and Electron ships no
//     find-in-page bar at all (the browser's Cmd+F is Chrome UI, not Blink).
//   * The chat view keeps only a window of the session in the page: the tail
//     page (50 messages) plus 50 more per "load earlier". Everything older is
//     still on disk and invisible to any DOM search.
// So typing a word that lives in the unloaded part of the conversation finds
// nothing, even though the conversation demonstrably contains it.
//
// What this plugin adds:
//   * A scope toggle in the bar: 「包含更早内容 / Include earlier content」 (default) and 「已加载内容 / Loaded content」.
//   * In whole-conversation mode a search pages the older history in through
//     the session service (ctx.sessions.binding(id).session.loadOlder()),
//     re-running the match pass after every page — so the count and the
//     highlight set cover the history the host currently makes available.
//   * Progress is visible ("正在加载更早的历史… 已 3 页"), clickable to stop,
//     capped at MAX_PAGES, and it stops by itself when the history stops
//     growing. Host termination does not establish historical completeness.
//
// How it works without fighting React (unchanged from the fork):
//   * Matches are collected as DOM Range objects (start/end offsets inside
//     text nodes) from block-local text snapshots, including shadow roots.
//   * Highlights use the CSS Custom Highlight API (CSS.highlights + Highlight)
//     which paints ranges WITHOUT mutating the DOM — React keeps full
//     ownership of the tree. Chromium/Electron support this since 105.
//   * Without CSS Highlights, navigation still scrolls only scoped ranges.
//     Browser-wide window.find() is deliberately never used.
//
// Keyboard:
//   Cmd/Ctrl+F  open (prefilled with the current selection)
//   Enter       next match      Shift+Enter  previous match
//   Cmd/Ctrl+G / F3  next       +Shift       previous
//   Esc         close and clear highlights

window.__ModuleLoader__.load({
	id: "@ryuu-64/dsh-find-all",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		var BAR_ID = "dsh-find-all-root";
		var HL_ALL = "dsh-find-all-hit";
		var HL_CUR = "dsh-find-all-cur";
		var MAX_MATCHES = 5000;
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
			cap: "仅显示前 {n} 处匹配",
			resultCount: "{n} 个结果",
			scopeWhole: "包含更早内容",
			scopePage: "已加载内容",
			scopeToPage: "搜索当前会话中已加载的内容，并继续加载更早内容。点击改为仅搜索已加载内容",
			scopeToWhole: "仅搜索当前会话中已加载的内容，不再加载更早内容。点击改为包含更早内容",
			loading: "正在加载更早的历史… 已 {n} 页",
			available: "已搜索当前可用历史；宿主未提供更早页，无法确认历史完整性",
			capped: "搜索未完成：已到更早内容的加载上限（{n} 页），已保留找到的结果",
			stopTip: "点击停止加载",
			noService: "搜索未完成：会话接口不可用，已保留找到的结果",
			noTarget: "当前主会话没有可搜索的聊天正文",
			noRoot: "当前会话的搜索范围不可用",
			incomplete: "搜索未完成，已保留找到的结果",
			find: "查找会话",
			returnPosition: "返回搜索前位置", returning: "正在返回…", returned: "已返回搜索前位置",
			returnAvailable: "已跳到匹配；可返回搜索前位置",
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
			cap: "Showing only the first {n} matches",
			resultCount: "{n} results",
			scopeWhole: "Include earlier content",
			scopePage: "Loaded content",
			scopeToPage: "Search loaded content in this conversation and load earlier content. Click to search loaded content only",
			scopeToWhole: "Search only content already loaded in this conversation, without loading more. Click to include earlier content",
			loading: "Loading earlier history… {n} pages",
			available: "Searched currently available history; the host offers no earlier pages, so completeness cannot be confirmed",
			capped: "History search incomplete: loading limit reached ({n} pages); partial results retained",
			stopTip: "Click to stop loading",
			noService: "History search incomplete: session service unavailable; partial results retained",
			noTarget: "No searchable chat content in the main conversation",
			noRoot: "Search scope unavailable for this conversation",
			incomplete: "History search incomplete; partial results retained",
			find: "Find in conversation",
			returnPosition: "Return to reading position", returning: "Returning…", returned: "Returned to reading position",
			returnAvailable: "Moved to a match; return to the reading position is available",
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
				"#" + BAR_ID + "{position:fixed;top:46px;right:16px;z-index:2147483000;isolation:isolate;box-sizing:border-box;align-items:stretch;gap:4px;padding:6px 8px;display:flex;flex-direction:column;width:min(760px,calc(100vw - 32px));max-width:calc(100vw - 32px);background:transparent;--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);border:0;border-radius:var(--dsw-radius-md,8px);box-shadow:var(--dsw-elevation-panel,var(--dsw-shadow-lv2))}" +
				"#" + BAR_ID + ":before{content:\"\";position:absolute;inset:0;z-index:-1;pointer-events:none;border-radius:inherit;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2));-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter,blur(40px) saturate(150%));backdrop-filter:var(--dsw-menu-backdrop-filter,blur(40px) saturate(150%))}" +
				"#" + BAR_ID + " .controls{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0}" +
				"#" + BAR_ID + " input{flex:1 1 210px;min-width:120px;width:auto;height:28px;color:var(--dsw-alias-label-primary);font:13px/1 var(--dsw-font-family);background:var(--dsw-alias-bg-base);border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm,6px);outline:none;padding:0 8px}" +
				"#" + BAR_ID + " input:focus-visible{border-color:var(--dsw-alias-state-business-primary)}" +
				"#" + BAR_ID + " .count{min-width:52px;color:var(--dsw-alias-label-tertiary);font:12px/1 var(--dsw-font-family);font-variant-numeric:tabular-nums;text-align:center}" +
				"#" + BAR_ID + " .status{width:100%;min-height:15px;color:var(--dsw-alias-label-tertiary);font:12px/1.25 var(--dsw-font-family);text-align:left;white-space:normal;overflow-wrap:anywhere}" +
				"#" + BAR_ID + " .status[data-busy]{cursor:pointer;color:var(--dsw-alias-state-business-primary)}" +
				"#" + BAR_ID + " .scope{width:auto;padding:0 9px;color:var(--dsw-alias-label-secondary);font:12px/1 var(--dsw-font-family);background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:999px}" +
				"#" + BAR_ID + " .scope[data-whole]{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-state-business-primary)}" +
				"#" + BAR_ID + " button{height:26px;min-width:26px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:6px;align-items:center;justify-content:center;display:inline-flex}" +
				"#" + BAR_ID + " button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}" +
				"#" + BAR_ID + " button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}" +
				"#" + BAR_ID + " button:disabled{opacity:.5;cursor:default}" +
				"#" + BAR_ID + " [data-find-all-return][hidden]{display:none}" +
				"#" + BAR_ID + " [data-find-all-return]{padding:0 8px;white-space:nowrap}" +
				"#" + BAR_ID + " svg{pointer-events:none}" +
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

		// Join inline Text nodes only within one structural block and DOM root.
		// These snapshots live for one scan. Preserve every original code unit,
		// including whitespace-only nodes and code newlines; never trim or pad.
		function collectTextBlocks(root) {
			var blocks = [];
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
						segments.push({ node: node, start: text.length, end: text.length + node.data.length });
						text += node.data;
					}
					return;
				}
				if (node.nodeType !== 1 && node.nodeType !== 11) return;
				if (SKIP_TAGS[node.tagName] || node.id === BAR_ID || node.tagName === "BR") {
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

		function collectRanges(query, root) {
			var ranges = [];
			if (!query || !root || typeof document === "undefined") return ranges;
			var blocks = collectTextBlocks(root);
			for (var i = 0; i < blocks.length && ranges.length < MAX_MATCHES; i++) {
				var block = blocks[i];
				var matches = findMatches(block.text, query);
				var start = 0, end = 0;
				for (var j = 0; j < matches.length && ranges.length < MAX_MATCHES; j++) {
					var match = matches[j];
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

		function scrollToRange(range) {
			var viewport = readingViewport(state.target);
			if (viewport && rangeRect(range, viewport)) return;
			var el = range.startContainer.parentElement;
			if (el && el.scrollIntoView) {
				try { el.scrollIntoView({ block: "center", behavior: "instant" }); } catch (error) {}
			}
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

		function clippedViewport(element, viewport) {
			var top = viewport.top, bottom = viewport.bottom, left = viewport.left, right = viewport.right;
			for (var parent = element; parent && parent !== viewport.scroll; parent = parent.parentElement) {
				var style = window.getComputedStyle(parent);
				var clipsY = /^(auto|scroll|hidden|clip)$/.test(style.overflowY), clipsX = /^(auto|scroll|hidden|clip)$/.test(style.overflowX);
				if (!clipsX && !clipsY) continue;
				var box = parent.getBoundingClientRect();
				if (clipsY) { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom); }
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
			state.returnBtn.textContent = state.restoring ? L.returning : L.returnPosition;
			state.returnBtn.setAttribute('aria-label', state.returnBtn.textContent);
			state.returnBtn.title = state.returnBtn.textContent;
		}

		function cancelNavigation() {
			clearTimeout(state.navigationTimer);
			state.navigationTimer = 0;
			state.navigationToken += 1;
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
			if (target && state.adapter.valid(target) && hostNavigationReady(target, face)) {
				var row = range.startContainer.parentElement.closest('[data-chat-turn]');
				activateLoadedTurn(target, state.adapter.nodes(target), row && row.getAttribute('data-chat-turn'));
				if (state.target !== target || !state.adapter.valid(target) || state.adapter.face(target) !== face) return;
			}
			scrollToRange(range);
			var origin = state.origin, token = state.navigationToken, started = Date.now();
			function check() {
				state.navigationTimer = 0;
				if (token !== state.navigationToken || !originValid(origin)) return;
				var viewport = readingViewport(origin.target);
				var current = state.ranges[state.index];
				if (viewport && current && origin.target.root.contains(current.startContainer) && rangeRect(current, viewport)) {
					var firstNavigation = !origin.navigated;
					origin.navigated = true;
					updateReturnButton();
					if (firstNavigation) {
						if (state.jumpStatus !== null) {
							var priorStatus = state.jumpStatus;
							setStatus(priorStatus, false);
						} else setStatus(L.returnAvailable, false);
						if (state.announcement) state.announcement.textContent = L.returnAvailable;
					}
					return;
				}
				if (Date.now() - started < 1500) state.navigationTimer = setTimeout(check, 100);
			}
			check();
		}

		function revealReadingRow(origin, row, activated) {
			// rc2 retains folded process rows with hidden=until-found. Use its
			// actual disclosure controls; never edit React's hidden attributes.
			if (!row || visible(row)) return;
			var turn = row.getAttribute('data-chat-turn');
			var buttons = origin.target.root.querySelectorAll('button[data-turn-process][aria-expanded="false"]');
			for (var i = 0; i < buttons.length; i++) {
				var owner = buttons[i].closest('[data-chat-turn]');
				if (owner && owner.getAttribute('data-chat-turn') === turn && !buttons[i].disabled && visible(buttons[i]) && !activated.has(buttons[i])) { activated.add(buttons[i]); buttons[i].click(); }
			}
			var group = row.closest('[data-chat-group-key]');
			var button = group && group.querySelector('button[data-process-activity][aria-expanded="false"]');
			if (button && !button.disabled && visible(button) && !activated.has(button)) { activated.add(button); button.click(); }
		}

		function returnFailure(reason) {
			return L.returnFailed + ' ' + (L['return_' + reason] || L.return_unavailable);
		}

		async function returnToOrigin() {
			var origin = state.origin;
			if (state.restoring || !originValid(origin) || !origin.navigated) return;
			cancelPageIn(); cancelNavigation();
			var task = { origin: origin };
			state.restoring = task;
			setStatus(L.returning, false); updateReturnButton();
			function cancelled() { return state.restoring !== task || !originValid(origin); }
			function finishFailure(reason) {
				if (cancelled()) return;
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
					if (row && !visible(row)) revealReadingRow(origin, row, activated);
					var range = locateReading(origin, row);
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
				setStatus(L.returned, false);
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
			adapter: null,
			target: null,
			settleTimer: 0,
			settleCancel: null,
			bar: null,
			input: null,
			count: null,
			status: null,
			scopeBtn: null,
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
			positionObserver: null
		};

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
			if (!isOpen() || !state.target || !state.bar) return;
			var header = barAnchor(state.target);
			if (!header || !header.isConnected || !state.target.panel.isConnected) return;
			var headerRect = header.getBoundingClientRect();
			var panelRect = state.target.panel.getBoundingClientRect();
			var viewportWidth = document.documentElement.clientWidth || window.innerWidth;
			var inset = 16;
			var panelLeft = Math.max(0, panelRect.left);
			var panelRight = Math.min(viewportWidth, panelRect.right);
			var availableWidth = Math.max(0, Math.min(viewportWidth - inset * 2, panelRight - panelLeft - inset * 2));
			state.bar.style.top = Math.ceil(headerRect.bottom + 4) + "px";
			state.bar.style.right = Math.max(inset, Math.ceil(viewportWidth - panelRight + inset)) + "px";
			if (availableWidth > 0) state.bar.style.width = Math.min(760, Math.floor(availableWidth)) + "px";
		}

		function stopBarPositioning() {
			if (state.positionObserver) { state.positionObserver.disconnect(); state.positionObserver = null; }
		}

		function startBarPositioning() {
			stopBarPositioning();
			positionBar();
			var header = barAnchor(state.target);
			if (!header || typeof ResizeObserver === "undefined") return;
			state.positionObserver = new ResizeObserver(positionBar);
			state.positionObserver.observe(header);
			if (state.target.panel !== header) state.positionObserver.observe(state.target.panel);
		}

		function paint() {
			if (!highlightsSupported()) return;
			CSS.highlights.delete(HL_ALL);
			CSS.highlights.delete(HL_CUR);
			if (state.ranges.length > 0) {
				CSS.highlights.set(HL_ALL, makeHighlight(state.ranges));
				if (state.index >= 0 && state.index < state.ranges.length) {
					CSS.highlights.set(HL_CUR, makeHighlight([state.ranges[state.index]]));
				}
			}
		}

		function updateCount() {
			if (!state.count) return;
			var n = state.ranges.length;
			if (!state.query) state.count.textContent = "";
			else if (n === 0) state.count.textContent = state.paging ? "…" : "0/0";
			else if (state.index < 0) state.count.textContent = L.resultCount.replace("{n}", String(n) + (state.capped ? "+" : ""));
			else state.count.textContent = (state.index + 1) + "/" + n + (state.capped ? "+" : "");
			var cap = state.query && n > 0 && state.capped ? L.cap.replace("{n}", String(MAX_MATCHES)) : "";
			state.count.title = cap;
			if (cap) state.count.setAttribute("aria-label", state.count.textContent + "; " + cap);
			else state.count.removeAttribute("aria-label");
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
			setStatus(L.jumpHint.replace("{n}", String(state.ranges.length)) + (base ? " " + base : ""), false);
			state.jumpStatus = base || "";
		}

		function updateScopeButton() {
			if (!state.scopeBtn) return;
			var whole = state.scope === "whole";
			state.scopeBtn.textContent = whole ? L.scopeWhole : L.scopePage;
			state.scopeBtn.title = whole ? L.scopeToPage : L.scopeToWhole;
			if (whole) state.scopeBtn.setAttribute("data-whole", "1");
			else state.scopeBtn.removeAttribute("data-whole");
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
			var valid = state.adapter && state.adapter.valid(state.target);
			state.ranges = valid ? collectRanges(state.query, state.target.root) : [];
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
			cancelReturn(L.returnCancelled);
			if (!state.adapter || !state.adapter.valid(state.target)) { runSearch(false); return; }
			var n = state.ranges.length;
			if (n === 0) return;
			state.index = state.index < 0 ? (delta < 0 ? n - 1 : 0) : ((state.index + delta) % n + n) % n;
			rememberSelection();
			paint();
			updateCount();
			navigateToRange(state.ranges[state.index]);
		}

		function scheduleRescan() {
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

		function cancelPageIn() {
			state.pageToken += 1;
			if (state.settleCancel) state.settleCancel();
			clearTimeout(state.settleTimer);
			clearTimeout(state.pageTimer);
			state.pageTimer = 0;
			state.paging = false;
		}

		function schedulePageIn() {
			clearTimeout(state.pageTimer);
			state.pageTimer = setTimeout(function () {
				state.pageTimer = 0;
				startPageIn();
			}, 250);
		}

		function startPageIn() {
			if (state.scope !== "whole" || !state.query || !isOpen()) return;
			cancelPageIn();
			var token = state.pageToken;
			var target = state.target;
			if (!state.adapter || !state.adapter.valid(target)) {
				setStatus(unavailableStatus(), false);
				return;
			}
			var face = state.adapter.face(target);
			if (!face) {
				setStatus(L.noService, false);
				return;
			}
			state.sessionId = target.id;
			function isCancelled() {
				return token !== state.pageToken || !isOpen() || state.target !== target || !state.adapter || state.adapter.face(target) !== face;
			}
			function waitReady(failFast) {
				return waitForPage(function () {
					var status = facePageState(face);
					if (status && status.reason) return status;
					if (pendingLoads.has(face) || !status) return failFast ? { reason: "stalled" } : null;
					return status;
				}, isCancelled);
			}
			state.paging = true;
			state.pages = 0;
			setStatus(L.loading.replace("{n}", "0"), true);
			runPageIn({
				maxPages: MAX_PAGES,
				isCancelled: isCancelled,
				waitReady: waitReady,
				loadOlder: function () { return loadPage(face, isCancelled); },
				signature: function () { return domSignature(target.root); },
				waitChange: function (before) {
					return waitForPage(function () {
						var status = facePageState(face);
						return domSignature(target.root) !== before || !status || status.reason || status.hasMore === false ? {} : null;
					}, isCancelled);
				},
				onProgress: function (pages) {
					if (isCancelled()) return;
					state.pages = pages;
					setStatus(L.loading.replace("{n}", String(pages)), true);
					runSearch(true);
				}
			}).then(function (result) {
				if (isCancelled()) {
					// Face replacement cancels this task even if the DOM target survived.
					if (token === state.pageToken) { state.paging = false; setStatus(L.incomplete, false); }
					return;
				}
				var terminal = facePageState(face);
				if (result.reason === "done" && (!terminal || terminal.reason || terminal.hasMore !== false || pendingLoads.has(face))) result.reason = "stalled";
				state.paging = false;
				state.pages = result.pages;
				runSearch(true);
				if (!state.adapter || !state.adapter.valid(target)) return;
				var message = result.reason === "capped" ? L.capped.replace("{n}", String(result.pages)) :
					result.reason !== "done" ? L.incomplete : L.available;
				if (state.ranges.length > 0 && originValid(state.origin) && !state.origin.navigated) setJumpStatus(message);
				else setStatus(message, false);
			});
		}

		function syncTarget(target, passive) {
			if (!state.adapter) return;
			var selected = passive ? state.adapter.refresh(state.target) : state.adapter.select(target || document.activeElement, state.target);
			if (selected && state.target && selected.id === state.target.id && selected.anchor === state.target.anchor && selected.root === state.target.root && selected.panel === state.target.panel && selected.registration === state.target.registration) {
				if (state.origin && !originValid(state.origin)) { discardOrigin(); setStatus(returnFailure('unavailable'), false); }
				positionBar();
				return;
			}
			if (!selected && !state.target) {
				if (isOpen()) runSearch(false);
				return;
			}
			discardOrigin();
			cancelPageIn();
			stopObserver();
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
			cancelReturn(L.returnCancelled); cancelNavigation();
			state.query = input.value;
			cancelPageIn();
			setStatus("", false);
			runSearch(false);
			if (state.ranges.length > 0 && highlightsSupported()) navigateToRange(state.ranges[state.index]);
			if (state.scope === "whole" && state.query) schedulePageIn();
		}

		function toggleScope() {
			cancelReturn(L.returnCancelled);
			state.scope = state.scope === "whole" ? "page" : "whole";
			updateScopeButton();
			if (state.scope === "page") {
				cancelPageIn();
				setStatus("", false);
				runSearch(true);
				return;
			}
			if (state.query) schedulePageIn();
		}

		function buildBar() {
			var bar = document.createElement("div");
			bar.id = BAR_ID;
			bar.setAttribute("role", "search");
			var controls = document.createElement("div");
			controls.className = "controls";

			var input = document.createElement("input");
			input.type = "text";
			input.placeholder = L.placeholder;
			input.setAttribute("aria-label", L.placeholder);
			input.addEventListener("input", function () { onQueryInput(input); });

			var scopeBtn = document.createElement("button");
			scopeBtn.type = "button";
			scopeBtn.className = "scope";
			scopeBtn.addEventListener("click", toggleScope);

			var count = document.createElement("span");
			count.className = "count";
			count.setAttribute("role", "status");
			count.setAttribute("aria-live", "polite");
			count.setAttribute("aria-atomic", "true");

			var status = document.createElement("span");
			status.className = "status";
			status.setAttribute("role", "status");
			status.setAttribute("aria-live", "polite");
			status.setAttribute("aria-atomic", "true");
			status.title = L.stopTip;
			status.addEventListener("click", function () {
				if (!state.paging) return;
				cancelPageIn();
				setStatus(L.incomplete, false);
			});

			controls.appendChild(input);
			controls.appendChild(scopeBtn);
			controls.appendChild(count);
			controls.appendChild(button(L.prev, "m18 15-6-6-6 6", function () { goTo(-1); }));
			controls.appendChild(button(L.next, "m6 9 6 6 6-6", function () { goTo(1); }));
			var returnBtn = document.createElement('button');
			returnBtn.type = 'button'; returnBtn.setAttribute('data-find-all-return', '');
			returnBtn.hidden = true;
			returnBtn.addEventListener('click', returnToOrigin);
			state.returnBtn = returnBtn;
			controls.appendChild(returnBtn);
			controls.appendChild(button(L.close, "M18 6 6 18M6 6l12 12", close));
			bar.appendChild(controls);
			bar.appendChild(status);

			state.bar = bar;
			state.input = input;
			state.count = count;
			state.status = status;
			state.scopeBtn = scopeBtn;
			updateScopeButton();
			document.body.appendChild(bar);
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
			discardOrigin();
			cancelPageIn();
			stopWatchingSession();
			stopBarPositioning();
			if (state.bar) state.bar.style.display = "none";
			state.ranges = [];
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
			var SearchIcon = ui.IconSearchOutlineRegular || ui.IconSearchOutline16;
			state.ctx = ctx;
			state.adapter = createHostAdapter(ctx, function () {
				if (isOpen()) syncTarget(null, true);
			});
			function SessionFind(props) {
				var anchor = react.useRef(null);
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
				}, react.createElement(SearchIcon, { size: 15 })));
			}
			ctx.slots.inject("conversation.session.header.utilities", function () {
				return ctx.slots.register({ name: "conversation.session.header.utilities", id: "dsh-find-all" }, SessionFind);
			});
			ctx.effect(function () {
				injectCss();
				var handler = createHandlers({
					open: open, close: close, goTo: goTo, isOpen: isOpen,
					ownsKeys: function (event) {
						var path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
						return !path.some(function (node) {
							return node && node.closest && node.closest('dialog[open], [aria-modal="true"], .monaco-editor, .cm-editor, .CodeMirror');
						});
					},
					isBarInput: function (target) { return target === state.input; }
				});
				function focus(event) {
					if (!state.bar || !state.bar.contains(event.target)) syncTarget(event.target);
				}
				function readingFocus(event) {
					// Reader activity may refresh the registered main frame, but cannot
					// select an embedded sidebar or change the search scope.
					if (event.isTrusted && event.target && event.target.closest && event.target.closest('[data-conversation-scroll]')) focus(event);
				}
				function interruptReading(event) {
					if (!state.restoring || !state.target) return;
					var viewport = readingViewport(state.target);
					if (!viewport || !viewport.scroll.contains(event.target)) return;
					if (event.type === 'keydown' && !/^(ArrowUp|ArrowDown|PageUp|PageDown|Home|End| )$/.test(event.key)) return;
					if (event.target.closest('input, textarea, [contenteditable="true"]')) return;
					cancelReturn(L.returnCancelled);
				}
				['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach(function (type) { window.addEventListener(type, interruptReading, true); });
				window.addEventListener("keydown", handler, true);
				window.addEventListener("focusin", focus, true);
				window.addEventListener("pointerdown", focus, true);
				window.addEventListener("wheel", readingFocus, true);
				window.addEventListener("resize", positionBar);
				return function () {
					['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach(function (type) { window.removeEventListener(type, interruptReading, true); });
					window.removeEventListener("keydown", handler, true);
					window.removeEventListener("focusin", focus, true);
					window.removeEventListener("pointerdown", focus, true);
					window.removeEventListener("wheel", readingFocus, true);
					window.removeEventListener("resize", positionBar);
					close();
					state.query = "";
					if (state.bar) state.bar.remove();
					if (state.announcement) state.announcement.remove();
					state.announcement = state.returnBtn = null;
					var style = document.querySelector('style[data-plugin-css="dsh-find-all/bar.css"]');
					if (style) style.remove();
					state.bar = state.input = state.count = state.status = state.scopeBtn = null;
					state.adapter.clear();
					state.target = state.ctx = null;
				};
			}, "find-all: browser lifecycle");
		}

		exports.apply = apply;
		exports.inject = ["sessions", "slots"];
		exports.resolveScope = resolveScope;
		exports.createHostAdapter = createHostAdapter;
		exports.findIndices = findIndices;         // for tests
		exports.findMatches = findMatches;         // for tests
		exports.collectRanges = collectRanges;     // for tests
		exports.createHandlers = createHandlers;   // for tests
		exports.runPageIn = runPageIn;             // for tests
		return module.exports;
	}
});
