// Unit tests for dsh-find-all client logic.
//
// The client bundle is loaded the way the app loads it (through
// window.__ModuleLoader__), then driven with spies: the matcher, the keyboard
// router and the page-in loop are all pure enough to test without a DOM.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));

function loadClient() {
	const src = readFileSync(join(dir, "../lib/client.js"), "utf8");
	globalThis.window = { addEventListener() {} };
	Object.defineProperty(globalThis, "navigator", { value: { language: "zh-CN" }, configurable: true });
	let entry = null;
	globalThis.window.__ModuleLoader__ = { load(e) { entry = e; } };
	(0, eval)(src);
	return entry.factory();
}

const mod = loadClient();

test("the bundle registers itself under its own id", () => {
	assert.equal(globalThis.window.__ModuleLoader__ === undefined, false);
	assert.equal(typeof mod.apply, "function");
});

test("it injects the sessions service and nothing else", () => {
	assert.deepEqual(mod.inject, ["sessions"]);
});

//#region matcher

test("latin matching is case-insensitive and non-overlapping", () => {
	assert.deepEqual(mod.findIndices("Hello hello HELLO", "hello"), [0, 6, 12]);
});

test("chinese matching works", () => {
	assert.deepEqual(mod.findIndices("字体太大字体太小", "字体"), [0, 4]);
});

test("overlapping query advances by match length", () => {
	assert.deepEqual(mod.findIndices("aaaa", "aa"), [0, 2]);
});

test("empty query and no-match both return []", () => {
	assert.deepEqual(mod.findIndices("abc", ""), []);
	assert.deepEqual(mod.findIndices("abc", "xyz"), []);
});

test("match at end of text is found", () => {
	assert.deepEqual(mod.findIndices("say hi", "hi"), [4]);
});

//#endregion

//#region keyboard router

function fakeEvent(patch) {
	return Object.assign({
		preventDefault() {},
		stopPropagation() {},
		isComposing: false,
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		target: null
	}, patch);
}

function keyRig() {
	const calls = { open: 0, close: 0, next: 0, prev: 0 };
	let open = false;
	const onKeydown = mod.createHandlers({
		open: () => { calls.open++; open = true; },
		close: () => { calls.close++; open = false; },
		goTo: (d) => { d < 0 ? calls.prev++ : calls.next++; },
		isOpen: () => open,
		isBarInput: (t) => t === "the-input"
	});
	return { calls, onKeydown, setOpen: (v) => { open = v; } };
}

test("Ctrl+F and Cmd+F open the bar", () => {
	const rig = keyRig();
	rig.onKeydown(fakeEvent({ ctrlKey: true, key: "f" }));
	rig.onKeydown(fakeEvent({ metaKey: true, key: "f" }));
	assert.equal(rig.calls.open, 2);
});

test("navigation keys are ignored while the bar is closed", () => {
	const rig = keyRig();
	rig.onKeydown(fakeEvent({ key: "Enter" }));
	rig.onKeydown(fakeEvent({ key: "F3" }));
	assert.equal(rig.calls.next + rig.calls.prev, 0);
});

test("Enter and Shift+Enter move between matches inside the bar input", () => {
	const rig = keyRig();
	rig.setOpen(true);
	rig.onKeydown(fakeEvent({ key: "Enter", target: "the-input" }));
	rig.onKeydown(fakeEvent({ key: "Enter", shiftKey: true, target: "the-input" }));
	assert.equal(rig.calls.next, 1);
	assert.equal(rig.calls.prev, 1);
});

test("Enter outside the bar input is left alone", () => {
	const rig = keyRig();
	rig.setOpen(true);
	rig.onKeydown(fakeEvent({ key: "Enter", target: "composer" }));
	assert.equal(rig.calls.next, 0);
});

test("Cmd+Shift+G, F3 and IME composition behave", () => {
	const rig = keyRig();
	rig.setOpen(true);
	rig.onKeydown(fakeEvent({ metaKey: true, key: "g", shiftKey: true }));
	rig.onKeydown(fakeEvent({ key: "F3" }));
	rig.onKeydown(fakeEvent({ key: "Enter", isComposing: true, target: "the-input" }));
	assert.equal(rig.calls.prev, 1);
	assert.equal(rig.calls.next, 1);
});

test("Esc closes the bar", () => {
	const rig = keyRig();
	rig.setOpen(true);
	rig.onKeydown(fakeEvent({ key: "Escape" }));
	assert.equal(rig.calls.close, 1);
});

//#endregion

//#region page-in loop

function pagerDeps(overrides) {
	const calls = { loads: 0, progress: [], waits: 0 };
	const base = {
		maxPages: 10,
		isCancelled: () => false,
		hasMore: () => true,
		loadOlder: async () => { calls.loads++; },
		signature: () => calls.loads,
		waitChange: async () => { calls.waits++; return true; },
		onProgress: (n) => calls.progress.push(n)
	};
	return { calls, deps: Object.assign(base, overrides || {}) };
}

test("a host that reports no older history loads nothing", async () => {
	const { calls, deps } = pagerDeps({ hasMore: () => false });
	const result = await mod.runPageIn(deps);
	assert.deepEqual(result, { pages: 0, reason: "done" });
	assert.equal(calls.loads, 0);
});

test("it keeps paging until the host says the history is complete", async () => {
	let available = 3;
	const { calls, deps } = pagerDeps({
		hasMore: () => available > 0,
		loadOlder: async () => { calls.loads++; available--; }
	});
	const result = await mod.runPageIn(deps);
	assert.deepEqual(result, { pages: 3, reason: "done" });
	assert.deepEqual(calls.progress, [1, 2, 3]);
});

test("an unknown hasMore keeps going and stops when a page changes nothing", async () => {
	let attempt = 0;
	const { deps } = pagerDeps({
		hasMore: () => null,
		waitChange: async () => { attempt++; return attempt <= 2; }
	});
	const result = await mod.runPageIn(deps);
	assert.deepEqual(result, { pages: 2, reason: "stalled" });
});

test("the page cap stops a runaway history", async () => {
	const { deps } = pagerDeps({ maxPages: 4 });
	const result = await mod.runPageIn(deps);
	assert.deepEqual(result, { pages: 4, reason: "capped" });
});

test("cancellation stops before the next page is requested", async () => {
	let cancelled = false;
	const { calls, deps } = pagerDeps({
		isCancelled: () => cancelled,
		onProgress: () => { cancelled = true; }
	});
	const result = await mod.runPageIn(deps);
	assert.equal(result.reason, "cancelled");
	assert.equal(calls.loads, 1);
});

test("a failing load reports error instead of throwing", async () => {
	const { deps } = pagerDeps({
		loadOlder: async () => { throw new Error("gateway down"); }
	});
	const result = await mod.runPageIn(deps);
	assert.deepEqual(result, { pages: 0, reason: "error" });
});

//#endregion
