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
//   * A scope toggle in the bar: 「整段 / Whole」 (default) and 「本页 / Page」.
//   * In whole-conversation mode a search pages the older history in through
//     the session service (ctx.sessions.binding(id).session.loadOlder()),
//     re-running the match pass after every page — so the count and the
//     highlight set end up covering the entire session.
//   * Progress is visible ("正在加载更早的历史… 已 3 页"), clickable to stop,
//     capped at MAX_PAGES, and it stops by itself when the history stops
//     growing (which also covers hosts that expose no `hasMore`).
//
// How it works without fighting React (unchanged from the fork):
//   * Matches are collected as DOM Range objects (start/end offsets inside
//     text nodes) via a TreeWalker that also descends into shadow roots.
//   * Highlights use the CSS Custom Highlight API (CSS.highlights + Highlight)
//     which paints ranges WITHOUT mutating the DOM — React keeps full
//     ownership of the tree. Chromium/Electron support this since 105.
//   * When the API is unavailable, the bar degrades to the legacy
//     window.find() calls (no count, still functional).
//
// Keyboard:
//   Cmd/Ctrl+F  open (prefilled with the current selection)
//   Enter       next match      Shift+Enter  previous match
//   Cmd/Ctrl+G / F3  next       +Shift       previous
//   Esc         close and clear highlights

window.__ModuleLoader__.load({
	id: "dsh-find-all",
	factory: () => {
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

		var ZH = typeof navigator !== "undefined" && /^zh/i.test(navigator.language || "");
		var L = ZH ? {
			placeholder: "查找整段会话…",
			prev: "上一个匹配",
			next: "下一个匹配",
			close: "关闭查找",
			cap: "已达匹配上限，仅显示前 {n} 条",
			scopeWhole: "整段",
			scopePage: "本页",
			scopeToPage: "搜索范围：整段会话。点击改为只搜当前页面",
			scopeToWhole: "搜索范围：仅当前页面。点击改为搜索整段会话",
			loading: "正在加载更早的历史… 已 {n} 页",
			allLoaded: "整段会话已就绪",
			capped: "已到加载上限（{n} 页），停止加载",
			stalled: "没有更早的历史了",
			stopTip: "点击停止加载",
			noService: "取不到会话接口，只能搜当前页面"
		} : {
			placeholder: "Find in conversation…",
			prev: "Previous match",
			next: "Next match",
			close: "Close find",
			cap: "Match limit reached, showing first {n}",
			scopeWhole: "Whole",
			scopePage: "Page",
			scopeToPage: "Scope: the whole conversation. Click to search only the rendered page",
			scopeToWhole: "Scope: the rendered page only. Click to search the whole conversation",
			loading: "Loading earlier history… {n} pages",
			allLoaded: "Whole conversation loaded",
			capped: "Page cap reached ({n}), stopped loading",
			stalled: "No earlier history",
			stopTip: "Click to stop loading",
			noService: "Session service unavailable — rendered page only"
		};

		//#region pure helpers (exported for tests)

		// All non-overlapping case-insensitive start indices of `query` in
		// `text`; empty array for an empty query or no hits.
		function findIndices(text, query) {
			if (!query) return [];
			var haystack = String(text).toLowerCase();
			var needle = String(query).toLowerCase();
			var out = [];
			var i = haystack.indexOf(needle);
			while (i !== -1) {
				out.push(i);
				if (out.length >= MAX_MATCHES) break;
				i = haystack.indexOf(needle, i + needle.length);
			}
			return out;
		}

		// Keyboard routing, isolated so tests can drive it with spies.
		function createHandlers(ops) {
			return function onKeydown(event) {
				var meta = event.metaKey || event.ctrlKey;
				var key = event.key;
				if (meta && (key === "f" || key === "F")) {
					event.preventDefault();
					event.stopPropagation();
					ops.open();
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

		/**
		 * Page older history in until the conversation stops growing.
		 *
		 * Every dependency is injected, so the loop is testable without a DOM or
		 * a host: the caller supplies how to read `hasMore`, how to load a page,
		 * how to measure the rendered history, and how to wait for that measure
		 * to change.
		 *
		 * @param opts - { maxPages, isCancelled, hasMore, loadOlder, signature,
		 *   waitChange, onProgress }.
		 *   `hasMore` returns true/false/null (null = the host cannot say, so the
		 *   pager keeps going until a page changes nothing).
		 * @returns { pages, reason } where reason is one of done | cancelled |
		 *   capped | stalled | error.
		 */
		async function runPageIn(opts) {
			var pages = 0;
			var reason = "done";
			for (;;) {
				if (opts.isCancelled()) { reason = "cancelled"; break; }
				if (opts.hasMore() === false) { reason = "done"; break; }
				if (pages >= opts.maxPages) { reason = "capped"; break; }
				var before = opts.signature();
				try {
					await opts.loadOlder();
				} catch (error) {
					reason = "error";
					break;
				}
				if (opts.isCancelled()) { reason = "cancelled"; break; }
				if (!(await opts.waitChange(before))) { reason = "stalled"; break; }
				pages += 1;
				if (opts.onProgress) opts.onProgress(pages);
			}
			return { pages: pages, reason: reason };
		}
		//#endregion

		function cssText() {
			return "" +
				"#" + BAR_ID + "{position:fixed;top:46px;right:16px;z-index:2147483000;align-items:center;gap:6px;padding:6px 8px;display:flex;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;box-shadow:var(--dsw-shadow-lv2)}" +
				"#" + BAR_ID + " input{width:210px;height:28px;color:var(--dsw-alias-label-primary);font:13px/1 var(--dsw-font-family);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;outline:none;padding:0 8px}" +
				"#" + BAR_ID + " input:focus-visible{border-color:var(--dsw-alias-state-business-primary)}" +
				"#" + BAR_ID + " .count{min-width:52px;color:var(--dsw-alias-label-tertiary);font:12px/1 var(--dsw-font-family);font-variant-numeric:tabular-nums;text-align:center}" +
				"#" + BAR_ID + " .status{max-width:260px;color:var(--dsw-alias-label-tertiary);font:12px/1.2 var(--dsw-font-family);text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
				"#" + BAR_ID + " .status[data-busy]{cursor:pointer;color:var(--dsw-alias-state-business-primary)}" +
				"#" + BAR_ID + " .scope{width:auto;padding:0 9px;color:var(--dsw-alias-label-secondary);font:12px/1 var(--dsw-font-family);background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:999px}" +
				"#" + BAR_ID + " .scope[data-whole]{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-state-business-primary)}" +
				"#" + BAR_ID + " button{height:26px;min-width:26px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:6px;align-items:center;justify-content:center;display:inline-flex}" +
				"#" + BAR_ID + " button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}" +
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

		// Collect text nodes under `root`, descending into shadow roots and
		// skipping the find bar itself plus invisible metadata tags.
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

		function collectRanges(query) {
			var ranges = [];
			if (!query || typeof document === "undefined" || document.body === null) return ranges;
			var nodes = collectTextNodes(document.body, []);
			for (var i = 0; i < nodes.length && ranges.length < MAX_MATCHES; i++) {
				var node = nodes[i];
				var indices = findIndices(node.data, query);
				for (var j = 0; j < indices.length && ranges.length < MAX_MATCHES; j++) {
					var range = document.createRange();
					range.setStart(node, indices[j]);
					range.setEnd(node, indices[j] + query.length);
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
			var el = range.startContainer.parentElement;
			if (el && el.scrollIntoView) {
				try { el.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (error) {}
			}
		}

		/** Cheap proxy for "how much history is rendered" — used to notice a page landing. */
		function domSignature() {
			if (typeof document === "undefined" || document.body === null) return 0;
			return collectTextNodes(document.body, []).length;
		}

		/** Resolve once the rendered history differs from `before`, or the page times out. */
		function waitForChange(before) {
			return new Promise(function (resolve) {
				var started = Date.now();
				(function poll() {
					if (domSignature() !== before) { resolve(true); return; }
					if (Date.now() - started >= PAGE_SETTLE_MS) { resolve(false); return; }
					setTimeout(poll, PAGE_POLL_MS);
				})();
			});
		}

		//#region session bridge
		//
		// The `sessions` client service is provided by
		// @deepseek-ai/dsh-api-session-controller; the per-session face it binds
		// exposes loadOlder() plus a snapshot carrying hasMore/loadingOlder.
		// Everything here is defensive: a host that changes shape must degrade to
		// page-only search, never break the bar.

		function resolveFace(ctx) {
			try {
				var sessions = ctx && ctx.sessions;
				if (!sessions || !sessions.list || typeof sessions.list.getSnapshot !== "function") return null;
				var id = sessions.list.getSnapshot().current;
				if (!id) return null;
				if (typeof sessions.binding !== "function") return null;
				var binding = sessions.binding(id);
				var face = binding && binding.session ? binding.session : null;
				if (!face || typeof face.loadOlder !== "function") return null;
				return { id: id, face: face };
			} catch (error) {
				return null;
			}
		}

		function faceHasMore(face) {
			try {
				if (typeof face.getSnapshot !== "function") return null;
				var snapshot = face.getSnapshot();
				return snapshot && typeof snapshot.hasMore === "boolean" ? snapshot.hasMore : null;
			} catch (error) {
				return null;
			}
		}
		//#endregion

		//#region bar UI + state

		var state = {
			ctx: null,
			bar: null,
			input: null,
			count: null,
			status: null,
			scopeBtn: null,
			query: "",
			ranges: [],
			index: -1,
			capped: false,
			observer: null,
			debounce: 0,
			scope: "whole",
			paging: false,
			pageTimer: 0,
			pageToken: 0,
			pages: 0,
			sessionId: null,
			sessionTimer: 0
		};

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
			else state.count.textContent = (state.index + 1) + "/" + n + (state.capped ? "+" : "");
		}

		function setStatus(text, busy) {
			if (!state.status) return;
			state.status.textContent = text || "";
			if (busy) state.status.setAttribute("data-busy", "1");
			else state.status.removeAttribute("data-busy");
			updateCount();
		}

		function updateScopeButton() {
			if (!state.scopeBtn) return;
			var whole = state.scope === "whole";
			state.scopeBtn.textContent = whole ? L.scopeWhole : L.scopePage;
			state.scopeBtn.title = whole ? L.scopeToPage : L.scopeToWhole;
			if (whole) state.scopeBtn.setAttribute("data-whole", "1");
			else state.scopeBtn.removeAttribute("data-whole");
		}

		function runSearch(keepIndex) {
			state.ranges = collectRanges(state.query);
			state.capped = state.ranges.length >= MAX_MATCHES;
			if (!keepIndex || state.index >= state.ranges.length) state.index = state.ranges.length > 0 ? 0 : -1;
			paint();
			updateCount();
			if (state.index >= 0 && !highlightsSupported()) legacyFind(state.query, false);
		}

		function goTo(delta) {
			var n = state.ranges.length;
			if (n === 0) return;
			if (highlightsSupported()) {
				state.index = ((state.index + delta) % n + n) % n;
				paint();
				updateCount();
				scrollToRange(state.ranges[state.index]);
			} else {
				legacyFind(state.query, delta < 0);
			}
		}

		function legacyFind(query, backwards) {
			if (typeof window.find === "function") {
				try { window.find(query, false, backwards, true); } catch (error) {}
			}
		}

		function scheduleRescan() {
			// While a page-in is running the pager rescans itself after every page;
			// rescanning on each mutation as well would walk the whole DOM per row.
			if (state.paging) return;
			clearTimeout(state.debounce);
			state.debounce = setTimeout(function () {
				if (state.bar) runSearch(true);
			}, 250);
		}

		function startObserver() {
			if (state.observer || typeof MutationObserver === "undefined") return;
			state.observer = new MutationObserver(scheduleRescan);
			state.observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
		}

		function stopObserver() {
			if (state.observer) { state.observer.disconnect(); state.observer = null; }
			clearTimeout(state.debounce);
		}
		//#endregion

		//#region paging the older history in

		function cancelPageIn() {
			state.pageToken += 1;
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
			var token = ++state.pageToken;
			var resolved = resolveFace(state.ctx);
			if (!resolved) {
				setStatus(L.noService, false);
				return;
			}
			state.sessionId = resolved.id;
			if (faceHasMore(resolved.face) === false) {
				setStatus(L.allLoaded, false);
				return;
			}
			state.paging = true;
			state.pages = 0;
			setStatus(L.loading.replace("{n}", "0"), true);
			runPageIn({
				maxPages: MAX_PAGES,
				isCancelled: function () { return token !== state.pageToken || !isOpen(); },
				hasMore: function () { return faceHasMore(resolved.face); },
				loadOlder: function () { return Promise.resolve(resolved.face.loadOlder()); },
				signature: domSignature,
				waitChange: waitForChange,
				onProgress: function (pages) {
					if (token !== state.pageToken) return;
					state.pages = pages;
					setStatus(L.loading.replace("{n}", String(pages)), true);
					runSearch(true);
				}
			}).then(function (result) {
				if (token !== state.pageToken) return;
				state.paging = false;
				state.pages = result.pages;
				if (result.reason === "capped") setStatus(L.capped.replace("{n}", String(result.pages)), false);
				else if (result.reason === "stalled" || result.reason === "error") setStatus(L.stalled, false);
				else setStatus(result.pages > 0 ? L.allLoaded : "", false);
				runSearch(true);
			});
		}

		/** Drop everything paged for the previous session when the user switches. */
		function watchSession() {
			clearInterval(state.sessionTimer);
			state.sessionTimer = setInterval(function () {
				if (!isOpen()) return;
				var resolved = resolveFace(state.ctx);
				var id = resolved ? resolved.id : null;
				if (id === state.sessionId) return;
				state.sessionId = id;
				cancelPageIn();
				setStatus("", false);
				runSearch(false);
				if (state.scope === "whole" && state.query) schedulePageIn();
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
			state.query = input.value;
			cancelPageIn();
			setStatus("", false);
			runSearch(false);
			if (state.ranges.length > 0 && highlightsSupported()) scrollToRange(state.ranges[state.index]);
			if (state.scope === "whole" && state.query) schedulePageIn();
		}

		function toggleScope() {
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
			count.setAttribute("aria-live", "polite");

			var status = document.createElement("span");
			status.className = "status";
			status.title = L.stopTip;
			status.addEventListener("click", function () {
				if (!state.paging) return;
				cancelPageIn();
				setStatus(L.stalled, false);
			});

			bar.appendChild(input);
			bar.appendChild(scopeBtn);
			bar.appendChild(count);
			bar.appendChild(button(L.prev, "m18 15-6-6-6 6", function () { goTo(-1); }));
			bar.appendChild(button(L.next, "m6 9 6 6 6-6", function () { goTo(1); }));
			bar.appendChild(status);
			bar.appendChild(button(L.close, "M18 6 6 18M6 6l12 12", close));

			state.bar = bar;
			state.input = input;
			state.count = count;
			state.status = status;
			state.scopeBtn = scopeBtn;
			updateScopeButton();
			document.body.appendChild(bar);
		}

		function open() {
			if (typeof document === "undefined" || document.body === null) return;
			if (!state.bar) buildBar();
			state.bar.style.display = "flex";
			var selection = "";
			try { selection = String(window.getSelection()).trim(); } catch (error) {}
			if (selection && selection.length <= 200 && selection !== state.query) {
				state.input.value = selection;
				state.query = selection;
			}
			state.input.focus();
			state.input.select();
			runSearch(false);
			startObserver();
			watchSession();
			if (state.scope === "whole" && state.query) schedulePageIn();
		}

		function close() {
			cancelPageIn();
			stopWatchingSession();
			if (state.bar) state.bar.style.display = "none";
			state.query = "";
			state.ranges = [];
			state.index = -1;
			setStatus("", false);
			paint(); // clears registered highlights
			updateCount();
			stopObserver();
		}

		function isOpen() {
			return !!state.bar && state.bar.style.display !== "none";
		}

		function apply(ctx) {
			state.ctx = ctx;
			injectCss();
			var ops = {
				open: open,
				close: close,
				goTo: goTo,
				isOpen: isOpen,
				isBarInput: function (target) { return target === state.input; }
			};
			window.addEventListener("keydown", createHandlers(ops), true);
		}

		exports.apply = apply;
		exports.inject = ["sessions"];
		exports.findIndices = findIndices;         // for tests
		exports.createHandlers = createHandlers;   // for tests
		exports.runPageIn = runPageIn;             // for tests
		return module.exports;
	}
});
