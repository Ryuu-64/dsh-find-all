// Observe changes that can stale a fixed durable-history projection. This is
// deliberately not a fingerprint of the live Chat UI: streaming status, usage,
// disclosure state and loading earlier pages are not durable content changes.
const MESSAGE_KINDS = new Set(["user", "steering", "context", "turn-trigger"]);
const sequence = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum && !Object.is(value, -0);

function durable(node) {
	if (typeof node?.key !== "string" || !node.data || typeof node.data !== "object") return undefined;
	const data = node.data;
	if (MESSAGE_KINDS.has(node.kind) && sequence(data.seq)) return { seq: data.seq, value: data };
	if (node.kind === "assistant-step" && data.finalNode && sequence(data.finalNode.seq)) {
		// A settled Assistant's transient wrapper can still change. Its durable
		// final node and displayed blocks, not status/timing/usage chrome, matter.
		return { seq: data.finalNode.seq, value: { finalNode: data.finalNode, blocks: data.blocks } };
	}
	return undefined;
}

/**
 * Capture materialized settled nodes synchronously, BEFORE awaiting the history
 * read. ChatNodeStore values use immutable data references. Signatures stay
 * private in this closure, are never logged or returned, and are recomputed
 * only when a node's data reference changes. Unsupported/running nodes are not
 * serialized at all.
 *
 * A true result is sticky: the caller must begin a new read and new tracker.
 * Reader snapshots use throughSeq, not the remote snapshot's cursor field.
 */
export function createHistoryRevisionTracker(store) {
	const baseline = new Map(), latest = new Map();
	let changed = false;
	function capture(node, description) {
		const previous = latest.get(node.key);
		const signature = previous?.data === node.data
			? previous.signature : JSON.stringify(description.value);
		if (typeof signature !== "string") throw new Error("Durable Chat data could not be compared");
		const record = { data: node.data, kind: node.kind, seq: description.seq, signature };
		latest.set(node.key, record);
		return record;
	}
	try {
		if (typeof store?.values !== "function") changed = true;
		else for (const node of store.values()) {
			const description = durable(node);
			if (description) baseline.set(node.key, capture(node, description));
		}
	} catch { changed = true; }

	return {
		check(currentStore, snapshot) {
			if (changed) return true;
			if (currentStore !== store) return changed = true;
			const throughSeq = snapshot?.throughSeq;
			const hasCut = sequence(throughSeq, -1);
			try {
				for (const node of currentStore.values()) {
					const description = durable(node);
					if (!description) continue;
					if (hasCut && description.seq > throughSeq) return changed = true;
					const old = baseline.get(node.key);
					const current = capture(node, description);
					if (old && (old.kind !== current.kind || old.seq !== current.seq || old.signature !== current.signature)) return changed = true;
					// Ordinary prepend materializes old durable nodes not present at
					// the start. Establish their baseline without invalidating the read.
					if (!old) baseline.set(node.key, current);
				}
			} catch { changed = true; }
			return changed;
		},
	};
}
