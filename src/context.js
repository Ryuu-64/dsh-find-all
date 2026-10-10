// Pure RC2 ContextBody projection. This is deliberately a field adapter, not a
// Markdown parser or a copy of the Host UI. Source: ui-chat ContextBody and the
// input-message/inbox definitions at deepseek-harness 639ed015.
const MAX_CHARS = 20000;
const MAX_ENTRIES = 200;
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonempty = (value) => typeof value === "string" && value !== "";
const scalar = (value) => typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value) || value === null;
const SCALAR_FIELDS = new Set([
	"form", "name", "summary", "senderSessionId", "baseline", "baselineIdentity", "update", "version",
	"provider", "source", "deliveryId", "ruleId", "sessionId", "parentSessionId", "requestId", "workspaceId",
	"path", "reason", "type", "title", "goalId", "teamId", "agentId", "taskId", "id", "mode", "label",
]);
const ARRAY_FIELDS = {
	changes: new Set(["path", "action", "digest"]),
	entries: new Set(["name", "description", "path"]),
	sections: new Set(["name", "text"]),
	references: new Set(["sessionId", "label", "version", "throughSeq", "retainedMessages", "omittedMessages", "truncated"]),
};
function safeField(value, key) {
	if (SCALAR_FIELDS.has(key) && scalar(value)) return true;
	const keys = ARRAY_FIELDS[key];
	return !!keys && Array.isArray(value) && value.every((item) => record(item) && Object.keys(item).every((name) => keys.has(name) && scalar(item[name])));
}
function contentRuns(content) {
	const runs = [];
	const errors = [];
	let current;
	for (let index = 0; index < content.length; index += 1) {
		const block = content[index];
		if (block?.type !== "text" || typeof block.text !== "string") {
			current = undefined;
			errors.push({ code: "unsupported-context-block", message: `Context contains an unsupported ${String(block?.type)} block` });
			continue;
		}
		if (!current) { current = { text: "", firstContentIndex: index }; runs.push(current); }
		current.text += block.text;
	}
	return { runs, errors };
}
function shapeRows(source, key, valid, nonEmpty = false) {
	const rows = source[key];
	return Array.isArray(rows) && (!nonEmpty || rows.length > 0) && rows.every((row) => record(row) && valid(row)) ? rows : null;
}
function declaredBody(source) {
	switch (source.form) {
		case "snapshot": return shapeRows(source, "sections", (item) => nonempty(item.name) && typeof item.text === "string", true) ? "snapshot" : "opaque";
		case "catalog": return shapeRows(source, "entries", (item) => nonempty(item.name) && typeof item.description === "string") ? "catalog" : "opaque";
		case "instructions": return shapeRows(source, "changes", (item) => nonempty(item.path) && ["set", "replace", "remove"].includes(item.action), true) ? "instructions" : "opaque";
		case "notice": return nonempty(source.summary) ? "notice" : "opaque";
		case "relay": return nonempty(source.senderSessionId) ? "relay" : "opaque";
		case "recall": return shapeRows(source, "references", (item) => nonempty(item.label) && typeof item.retainedMessages === "number" && typeof item.omittedMessages === "number" && typeof item.truncated === "boolean", true) ? "recall" : "opaque";
		default: return "opaque";
	}
}

/** Detach only known searchable fields and text runs; never retain source/event. */
export function prepareContext(content, origin, visibleForm = true) {
    if (!visibleForm) {
        const body = contentRuns(content);
        return { form: "hidden", blocks: [], errors: [], runs: body.runs, runErrors: body.errors };
    }
	const source = record(origin) ? origin : {};
	const form = declaredBody(source);
	const body = contentRuns(content);
	// ContextInjectionRow has a separate tool-change renderer, including a
	// non-expandable single-tool row. It takes priority over every declared form.
	if (content.length > 0 && content.every((block) => block?.type === "tool-addition" || block?.type === "tool-removal")) {
		const errors = content.some((block) => !nonempty(block.toolName))
			? [{ code: "invalid-context-tool", message: "Context tool change has no valid tool name" }] : [];
		const blocks = [];
		if (!errors.length) {
			if (content.length === 1) blocks.push({ text: content[0].toolName, marker: "[data-disclosure-row]", itemIndex: 0, part: "tool-name", rendered: true, localized: true });
			else for (const type of ["tool-addition", "tool-removal"]) {
				const names = content.filter((block) => block.type === type).map((block) => block.toolName);
				if (names.length) blocks.push({ text: names.join(", "), marker: "[data-context-injection-body] > div > div", itemIndex: blocks.length, part: "tool-names", rendered: true, localized: true });
			}
		}
		return { form: "tool-changes", blocks, errors, runs: body.runs, runErrors: body.errors };
	}
	const blocks = [];
	const errors = [];
	const add = (text, marker, itemIndex, part, options = {}) => {
		blocks.push({ text, marker, itemIndex, part, rendered: true, ...options });
	};
	if (form === "snapshot") {
		source.sections.forEach((section, index) => {
			add(section.name, "[data-context-sections]", index, "name");
			add(section.text, "[data-context-sections]", index, "text", { visibleChars: Math.min(section.text.length, MAX_CHARS), ...(section.text.length > MAX_CHARS ? { unavailableReason: "context-text-truncated" } : {}) });
		});
	} else if (form === "catalog") {
		source.entries.forEach((entry, index) => {
			const options = index < MAX_ENTRIES ? {} : { rendered: false, unavailableReason: "context-catalog-truncated" };
			add(entry.name, "[data-context-entries]", index, "name", options);
			add(entry.description, "[data-context-entries]", index, "description", options);
		});
		errors.push(...body.errors); // Catalog also renders UnknownBlocks.
	} else {
		if (form === "instructions") {
			const paths = [...new Set(source.changes.map((change) => change.path))];
			paths.forEach((path, index) => add(path, "[data-context-files]", index, "path"));
		} else if (form === "notice") {
			add(source.summary, "[data-context-summary]", 0, "summary");
		} else if (form === "relay") {
			// The native leaf includes a localized prefix. Its owning field identity
			// is known; the mapper must verify the single field value inside it.
			add(source.senderSessionId, "[data-context-relay-sender]", 0, "sender", { localized: true });
		} else if (form === "recall") {
			source.references.forEach((reference, index) => add(reference.label, "[data-context-recalls]", index, "label"));
		}
		blocks.push(...runBlocks(body.runs));
		errors.push(...body.errors);
		if (form === "opaque") {
			let index = 0;
			for (const [key, value] of Object.entries(source)) {
				if (key === "kind") continue;
				add(key, "[data-context-fields]", index, "key");
				if (safeField(value, key)) {
					const text = typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value);
					add(text, "[data-context-fields]", index, "value", { field: key, visibleChars: Math.min(text.length, MAX_CHARS), ...(text.length > MAX_CHARS ? { unavailableReason: "context-text-truncated" } : {}) });
				} else errors.push({ code: "unsupported-context-field", message: `Opaque context field is outside the supported text schema: ${key}` });
				index += 1;
			}
		}
	}
	return { form, blocks, errors, runs: body.runs, runErrors: body.errors };
}
function runBlocks(runs) {
	return runs.filter((run) => run.text !== "").map((run, index) => ({
		text: run.text, marker: "[data-context-text]", itemIndex: index, part: "text", firstContentIndex: run.firstContentIndex,
		rendered: true, visibleChars: Math.min(run.text.length, MAX_CHARS),
		...(run.text.length > MAX_CHARS ? { unavailableReason: "context-text-truncated" } : {}),
	}));
}
/** Resolve the actual renderer only after the entire durable inbox prefix is known. */
export function finishContext(prepared, isTurnTrigger) {
	const blocks = isTurnTrigger ? runBlocks(prepared.runs) : prepared.blocks;
	return {
		contextForm: isTurnTrigger ? "turn-trigger" : prepared.form,
		isTurnTrigger,
		contextBlocks: blocks.map((block, index) => ({ ...block, index })),
		contextErrors: isTurnTrigger ? prepared.runErrors : prepared.errors,
	};
}

/** Only message identities/kinds from inbox splices are retained, never content. */
export function projectInboxSplice(data, seq) {
	if (!record(data) || !["next-turn", "next-step"].includes(data.target) || !Number.isSafeInteger(data.start) || data.start < 0 || !Array.isArray(data.inserted) || (data.removedCount !== undefined && (!Number.isSafeInteger(data.removedCount) || data.removedCount < 0))) {
		throw new Error(`Invalid context inbox splice at seq ${seq}`);
	}
	return {
		target: data.target, start: data.start, removedCount: data.removedCount ?? 0, outcome: data.outcome,
		inserted: data.inserted.map((item) => {
			if (!record(item) || !nonempty(item.id) || !record(item.source) || !nonempty(item.source.kind)) throw new Error(`Invalid context inbox message identity at seq ${seq}`);
			return { id: item.id, human: item.source.kind === "user" };
		}),
	};
}

/** Official next-turn / idle-steer waking classification over a dense log prefix. */
export function createContextClassifier() {
	const inbox = {
		"next-turn": { pending: [], claimed: new Set(), claimSeq: -1, claimedHuman: false },
		"next-step": { pending: [], claimed: new Set(), claimSeq: -1, claimedHuman: false },
	};
	let turnStart;
	let step;
	return {
		accept(entry) {
			if (entry.type === "agent/inbox/spliced") {
				const splice = entry.inbox;
				const current = inbox[splice.target];
				if (splice.start > current.pending.length || splice.removedCount > current.pending.length - splice.start) throw new Error(`Context inbox splice is outside its retained prefix at seq ${entry.seq}`);
				const removed = current.pending.splice(splice.start, splice.removedCount, ...splice.inserted);
				if (splice.removedCount > 0 && splice.outcome !== "canceled") {
					current.claimed = new Set(removed.map((message) => message.id));
					current.claimSeq = entry.seq;
					current.claimedHuman = removed.some((message) => message.human);
				} else for (const message of splice.inserted) current.claimed.delete(message.id);
			} else if (entry.type === "turn/start") {
				turnStart = entry.seq;
				step = undefined;
			} else if (entry.type === "step/start") step = entry.step;
			else if (entry.type === "step/end") step = undefined;
			else if (entry.type === "turn/end") { turnStart = undefined; step = undefined; }
		},
		isTurnTrigger(messageId) {
			const nextTurn = inbox["next-turn"], nextStep = inbox["next-step"];
			const idleSteer = step === 1 && turnStart !== undefined && nextStep.claimSeq > turnStart && nextTurn.claimSeq < turnStart && !nextStep.claimedHuman && nextStep.claimed.has(messageId);
			return nextTurn.claimed.has(messageId) || idleSteer;
		},
	};
}
