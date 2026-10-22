import { createUserTextProjector } from "./user-projection.js";

const NODE_SLOT = "conversation.user.text.node";
const FACTORIES = ["conversation.user.text", "conversation.chat.user.content"];
const NODE_IDS = new Set(["text", "session", "file", "folder", "skill", "command", "secret"]);
const partial = (code, message) => ({ blocks: [], mapping: "user", errors: [{ code, message }] });
const service = (ctx, name) => typeof ctx?.get === "function" ? ctx.get(name) : ctx?.[name];
const disposeSafely = (dispose) => {
	try {
		// Cordis synchronous effects return a callable disposer whose completion
		// is a Promise. Cleanup remains best-effort without unhandled rejection.
		const completion = dispose?.();
		if (typeof completion?.catch === "function") completion.catch(() => {});
	} catch { /* Complete remaining cleanup. */ }
};

function effectiveEntries(slots) {
	const entries = slots?.entriesOfSlot?.(NODE_SLOT);
	if (!Array.isArray(entries)) return undefined;
	const byKey = new Map();
	for (const entry of entries) {
		const key = entry?.options?.key;
		if (typeof key !== "string" || byKey.has(key)) return undefined;
		byKey.set(key, entry);
	}
	return byKey;
}

function factoriesAvailable(slots) {
	return FACTORIES.every((name) => {
		const trees = slots?.snapshot?.(`factory:${name}`);
		if (!Array.isArray(trees) || trees.length !== 1) return false;
		const factory = trees[0];
		if (factory?.type !== "factory" || factory.name !== name || factory.scope !== "session") return false;
		return name !== "conversation.user.text" || Array.isArray(factory.children) && factory.children.some((child) =>
			child?.type === "slot" && child.name === NODE_SLOT && child.kind === "keyed" && child.scope === "session");
	});
}

/**
 * Bind modern user projection to retained Session generations and public Slot
 * capabilities. Winning entries at the first usable projection are a change
 * baseline, NOT proof of
 * renderer identity: an already-installed same-key custom renderer cannot be
 * distinguished through this public API. No private Factory/service fields are
 * inspected, and an unretained Session never borrows a different Session.
 */
export function createUserProjectionBinding(ctx, onChange) {
	let slots, baseline, observedEntries, factoryChanged = false, disposed = false;
	let offSlots, offErrors;
	const sessions = new Map(), registries = new Map();
	const failedNodes = new Set();
	const changed = () => { if (!disposed) { try { onChange?.(); } catch { /* A consumer cannot break Host publication. */ } } };
	try {
		slots = service(ctx, "slots");
	} catch { /* Missing/invalid public inspection is a reported capability gap. */ }
	const refreshEntries = () => {
		let current;
		try { current = effectiveEntries(slots); } catch { return undefined; }
		if (!current) return undefined;
		// A notification is not proof of recovery. Clear an observed crash only
		// after the effective winner really changes back to the original entry.
		for (const id of failedNodes) if (baseline?.has(id) && current.get(id) === baseline.get(id)
			&& observedEntries && observedEntries.get(id) !== current.get(id)) failedNodes.delete(id);
		observedEntries = current;
		return current;
	};
	const isFactory = (key) => FACTORIES.some((name) => key === `factory:${name}`);
	try {
		offSlots = ctx?.on?.("slots/changed", (key) => {
			if (disposed || key !== NODE_SLOT && !isFactory(key)) return;
			// The plugin can activate before Conversation/Chat finish their
			// initial registrations. Only an established baseline can change.
			if (isFactory(key)) { if (baseline) factoryChanged = true; }
			else refreshEntries();
			changed();
		});
		offErrors = slots?.onEntryError?.((key, registration) => {
			if (disposed || key !== NODE_SLOT && !isFactory(key)) return;
			if (isFactory(key)) factoryChanged = true;
			else {
				// Public onEntryError reports the Slot key and the exact crashed
				// registration, even when that entry was not abdicated. The latter
				// case would otherwise still pass an entry-identity check.
				refreshEntries();
				const id = registration?.options?.key;
				if (typeof id === "string" && id) failedNodes.add(id);
				else for (const known of NODE_IDS) failedNodes.add(known);
			}
			changed();
		});
	} catch { /* Projection still checks whether the required event watch exists. */ }

	function verifyRenderer(nodes) {
		if (disposed || typeof offSlots !== "function" || factoryChanged || !Array.isArray(nodes)) return false;
		try {
			if (!factoriesAvailable(slots)) return false;
			const current = refreshEntries();
			if (!current || !nodes.every((node) => NODE_IDS.has(node?.id) && current.has(node.id))) return false;
			// Defer capture until a retained Session has an evaluator and the
			// requested nodes plus both public Factory schemas are usable. An
			// early failed attempt must not freeze an incomplete startup graph.
			// Once captured, neither later registrations nor Factory events can
			// silently establish a new baseline. Errors observed before capture
			// also remain failures; initialization is not proof of recovery.
			if (!baseline) baseline = current;
			return nodes.every((node) => !failedNodes.has(node.id) && baseline.has(node.id) && current.get(node.id) === baseline.get(node.id));
		} catch { return false; }
	}

	function release(record) {
		if (record.released) return;
		record.released = true;
		if (sessions.get(record.id) === record) sessions.delete(record.id);
		const watch = registries.get(record.registry);
		watch?.records.delete(record);
		if (watch?.records.size === 0) {
			registries.delete(record.registry);
			disposeSafely(watch.dispose);
		}
		disposeSafely(record.disposeScope);
	}

	function bind(id, scope, registry) {
		const record = { id, scope, registry, released: false, project: undefined, disposeScope: undefined };
		let watch = registries.get(registry);
		if (!watch) {
			watch = { records: new Set(), dispose: undefined };
			watch.dispose = registry.subscribe(() => { if (registries.get(registry) === watch) { refreshEntries(); changed(); } });
			if (typeof watch.dispose !== "function") throw new Error("Registry revision observation is unavailable");
			registries.set(registry, watch);
		}
		watch.records.add(record);
		sessions.set(id, record);
		try {
			record.project = createUserTextProjector(registry, { sessionId: id, verifyRenderer });
			if (typeof scope.effect === "function") record.disposeScope = scope.effect(() => () => {
				if (record.released) return;
				release(record);
				changed();
			}, "find-all: user projection generation");
			return record;
		} catch (error) { release(record); throw error; }
	}

	return {
		project(source) {
			if (disposed) return partial("user-projection-disposed", "User-text projection has been disposed");
			const id = source?.sessionId;
			let scope, registry;
			try {
				if (typeof id === "string" && id) scope = service(ctx, "sessions")?.scope?.(id);
				if (scope) registry = service(scope, "uiConversation")?.userText;
			} catch { /* No root or another Session fallback. */ }
			let record = sessions.get(id);
			if (record && (record.scope !== scope || record.registry !== registry)) { release(record); record = undefined; }
			if (!scope) return partial("user-session-unavailable", "The user message's retained Session is unavailable; user text was not indexed");
			if (typeof registry?.createEvaluator !== "function" || typeof registry?.subscribe !== "function") {
				return partial("user-projection-unavailable", "The Session's public user-text evaluator is unavailable; user text was not indexed");
			}
			try { return (record ?? bind(id, scope, registry)).project(source); }
			catch { return partial("user-projection-unavailable", "The Session's user-text projection could not be bound; user text was not indexed"); }
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			disposeSafely(offSlots);
			disposeSafely(offErrors);
			for (const record of [...sessions.values()]) release(record);
		},
	};
}
