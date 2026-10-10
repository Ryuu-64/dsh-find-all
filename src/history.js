import { prepareContext, finishContext, projectInboxSplice, createContextClassifier } from "./context.js";

// Durable full-history reader for the official DSH 0.2.0-rc.2 protocol.
// Reference: deepseek-harness 639ed015397290b3745d163aafe02ffee4aa3f84.
// This cache belongs to ONE session + generation. It never owns a query, a DOM
// window, or the model's compacted surface. Only append-origin transcript text
// and the small amount of identity/presentation data needed to find it survive.
// maxMessages bounds messages, not bytes: a single event can still be large.

const TEXT_TYPES = new Set(["text", "reasoning"]);
const BOUNDARIES = new Set(["assistant/message", "tool/call", "tool/result", "llm/retry", "turn/end"]);
// Explicit RC2 non-body vocabulary. Known is not synonymous with searchable:
// other visible body schemas below are reported as coverage gaps, not skipped.
const NON_BODY_EVENTS = new Set([
	"agent-preset/selected", "agent/inbox/spliced", "approval/asked", "approval/decided", "approval/policy",
	"command/run", "compaction/end", "compaction/prune", "compaction/start", "deliverables/presented",
	"feedback/message-delete", "feedback/message-put", "feedback/record", "goal/change", "hook/invoked", "hook/result",
	"image/offload", "llm/retry", "llm/retry-started", "model/selection", "permission/preset", "plan/mode",
	"request/context", "request/header", "sandbox/mode", "schedule/change", "session-log-deepseek/delivery-accepted",
	"session/end-seed", "session/title", "session/title-llm-request", "step/end", "step/start", "subagent/catalog",
	"subagent/descriptor", "subagent/model-selection-policy", "team/member", "team/message/delivered",
	"team/message/queued", "team/task", "todo/write", "tool-workflow/agent-end", "tool-workflow/agent-start",
	"tool-workflow/run-end", "tool-workflow/run-start", "turn/start", "web/deepseek-search-llm-request", "workspace/changes",
]);
const NON_TEXT_BLOCKS = new Set(["image", "file"]);
const CONTEXT_LIFECYCLE = new Set(["agent/inbox/spliced", "turn/start", "step/start", "step/end", "turn/end"]);
const TOOL_META_FIELDS = new Set(["path", "lang", "operation", "shape", "offset", "totalLines", "total", "truncated", "lines", "diffs", "paths", "files", "answer", "sources", "url", "statusCode"]);

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const integer = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum && !Object.is(value, -0);
const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");

function failure(code, message, seq) {
	const error = new Error(message);
	error.code = code;
	if (seq !== undefined) error.seq = seq;
	return error;
}
function errorRecord(error, fallback = "history-error") {
	return {
		code: typeof error?.code === "string" ? error.code : fallback,
		message: typeof error?.message === "string" ? error.message : String(error),
		...(integer(error?.seq) ? { seq: error.seq } : {}),
	};
}
function requireString(value, label, seq) {
	if (typeof value !== "string") throw failure("invalid-content", `${label} must be text`, seq);
	return value;
}
function contentArray(value, seq) {
	if (!Array.isArray(value)) throw failure("invalid-content", "Message content must be an array", seq);
	return value;
}

/** Independently prove one dense, ordered page ending at expectedEnd. */
export function auditHistoryPage(page, expectedEnd) {
	if (!object(page) || !Array.isArray(page.records) || typeof page.hasMore !== "boolean") {
		throw failure("invalid-page", "History page has no records/hasMore contract");
	}
	if (!integer(expectedEnd, -1)) throw failure("invalid-cursor", "Invalid history end cursor");
	if (page.records.length === 0) {
		if (expectedEnd !== -1 || page.hasMore) throw failure("empty-page", "History stopped before its dense prefix was covered");
		return { first: 0, last: -1, count: 0 };
	}
	const first = page.records[0]?.event?.seq;
	if (!integer(first) || first > expectedEnd) throw failure("invalid-page", "History page starts outside its requested range");
	let expected = first;
	for (const record of page.records) {
		const event = record?.event;
		if (record?.type !== "event" || !object(event) || !integer(event.seq) || event.seq !== expected || typeof event.type !== "string") {
			throw failure("history-gap", "History page has a missing, duplicated, or unordered event", integer(event?.seq) ? event.seq : undefined);
		}
		expected += 1;
	}
	if (expected - 1 !== expectedEnd) throw failure("history-gap", "History page does not meet the preceding page or snapshot cursor");
	if (page.hasMore !== (first > 0)) throw failure("history-gap", "History exhaustion disagrees with the zero-based event coverage");
	return { first, last: expected - 1, count: page.records.length };
}

// Whitelist presentation metadata, never serialize or cache the entire event.
// These values are NOT themselves searchable text. The caller must validate the
// corresponding native renderer's eligibility before projecting any of them.
function toolMeta(meta) {
	if (!object(meta)) return undefined;
	const out = {};
	for (const key of ["path", "lang", "operation", "shape"]) if (typeof meta[key] === "string") out[key] = meta[key];
	for (const key of ["offset", "totalLines", "total"]) if (Number.isSafeInteger(meta[key])) out[key] = meta[key];
	if (typeof meta.truncated === "boolean") out.truncated = meta.truncated;
	if (Array.isArray(meta.lines)) out.lines = meta.lines.map((line) => object(line) ? { number: Number.isSafeInteger(line.number) ? line.number : null, text: typeof line.text === "string" ? line.text : null } : null);
	if (Array.isArray(meta.diffs)) out.diffs = meta.diffs.map((diff) => object(diff) ? { path: typeof diff.path === "string" ? diff.path : null, oldText: diff.oldText === null || typeof diff.oldText === "string" ? diff.oldText : undefined, newText: typeof diff.newText === "string" ? diff.newText : null } : null);
	if (Array.isArray(meta.paths)) out.paths = meta.paths.map((path) => typeof path === "string" ? path : null);
	if (Array.isArray(meta.files)) out.files = meta.files.map((file) => object(file) ? {
		path: typeof file.path === "string" ? file.path : null,
		matches: Array.isArray(file.matches) ? file.matches.map((match) => object(match) ? { lineNumber: Number.isSafeInteger(match.lineNumber) ? match.lineNumber : null, line: typeof match.line === "string" ? match.line : null } : null) : null,
	} : null);
	if (Object.hasOwn(meta, "answer")) out.answer = typeof meta.answer === "string" ? meta.answer : null;
	if (typeof meta.url === "string") out.url = meta.url;
	if (Number.isSafeInteger(meta.statusCode)) out.statusCode = meta.statusCode;
	if (Array.isArray(meta.sources)) out.sources = meta.sources.map((source) => object(source)
		&& typeof source.url === "string"
		&& (source.title === undefined || typeof source.title === "string")
		&& (source.snippet === undefined || typeof source.snippet === "string")
		&& (source.publishedAt === undefined || typeof source.publishedAt === "string") ? {
			url: source.url,
			...(source.title === undefined ? {} : { title: source.title }),
			...(source.snippet === undefined ? {} : { snippet: source.snippet }),
			...(source.publishedAt === undefined ? {} : { publishedAt: source.publishedAt }),
		} : null);
	return Object.keys(out).length ? out : undefined;
}

// The compact protocol is expanded logically into block state, without retaining
// a second raw chunk list. block-end wins over deltas; later deltas/re-closes are
// ignored, matching the official BlockAssembler. No usage or provider metadata
// enters searchable text. Tool-call chunks are protocol, not attempt body text.
export function assembleAttemptText(stream, seq) {
	if (!Array.isArray(stream)) throw failure("invalid-stream", "Assistant attempt has no compact stream", seq);
	const partials = new Map();
	const ensure = (index, type) => {
		if (!integer(index)) throw failure("invalid-stream", "Assistant stream block index is invalid", seq);
		if (!partials.has(index)) partials.set(index, { index, type, fragments: [], closed: false });
		return partials.get(index);
	};
	const push = (chunk) => {
		if (!object(chunk) || typeof chunk.type !== "string") throw failure("invalid-stream", "Assistant stream chunk is invalid", seq);
		if (chunk.type === "block-start") {
			requireString(chunk.blockType, "blockType", seq);
			ensure(chunk.index, chunk.blockType);
		} else if (chunk.type === "text-delta" || chunk.type === "reasoning-delta") {
			const partial = ensure(chunk.index, chunk.type === "text-delta" ? "text" : "reasoning");
			const text = requireString(chunk.text, "Assistant delta", seq);
			if (!partial.closed) partial.fragments.push(text);
		} else if (chunk.type === "block-end") {
			if (!object(chunk.block) || typeof chunk.block.type !== "string") throw failure("invalid-stream", "Assistant block end is invalid", seq);
			const partial = ensure(chunk.index, chunk.block.type);
			if (!partial.closed) {
				partial.type = chunk.block.type;
				partial.fragments = TEXT_TYPES.has(chunk.block.type) ? [requireString(chunk.block.text, "Assistant block", seq)] : [];
				partial.closed = true;
			}
		} else if (chunk.type === "tool-call-delta") {
			ensure(chunk.index, "tool-call");
			requireString(chunk.id, "Tool delta id", seq);
			requireString(chunk.argumentsDelta, "Tool delta arguments", seq);
		} else if (chunk.type !== "usage" && chunk.type !== "finish") {
			throw failure("unsupported-stream", `Unsupported assistant stream chunk: ${chunk.type}`, seq);
		}
	};
	for (const record of stream) {
		if (!object(record)) throw failure("invalid-stream", "Assistant stream record is invalid", seq);
		if (record.type === "chunk") {
			if (!Number.isSafeInteger(record.time)) throw failure("invalid-stream", "Assistant stream timestamp is invalid", seq);
			push(record.chunk);
			continue;
		}
		if (!["text-chunks", "reasoning-chunks", "tool-call-chunks"].includes(record.type)) throw failure("unsupported-stream", `Unsupported assistant stream record: ${record.type}`, seq);
		const members = record.type === "tool-call-chunks" ? record.args : record.texts;
		if (!strings(members) || !members.length || !Array.isArray(record.dt) || record.dt.length !== members.length - 1 || !Number.isSafeInteger(record.time0)) {
			throw failure("invalid-stream", "Assistant compact stream run is invalid", seq);
		}
		let time = record.time0;
		for (const delta of record.dt) {
			time += delta;
			if (!Number.isSafeInteger(delta) || !Number.isSafeInteger(time)) throw failure("invalid-stream", "Assistant compact stream timing is invalid", seq);
		}
		if (record.type === "tool-call-chunks") {
			ensure(record.index, "tool-call");
			if (typeof record.id !== "string" || !record.id || (record.name !== undefined && (typeof record.name !== "string" || !record.name))) throw failure("invalid-stream", "Assistant tool stream identity is invalid", seq);
		} else {
			const partial = ensure(record.index, record.type === "text-chunks" ? "text" : "reasoning");
			if (!partial.closed) for (const text of members) partial.fragments.push(text);
		}
	}
	return [...partials.values()].filter((partial) => TEXT_TYPES.has(partial.type)).map((partial) => ({
		type: partial.type, text: partial.fragments.join(""), streamIndex: partial.index,
	}));
}

function extractEntry(event, sessionId, report) {
	const { seq, type } = event;
	// RC2 final Chat flow excludes system prompts. Never extract their body or request configuration.
	if (type === "system/message") return null;
	const data = object(event.data) ? event.data : {};
	const entry = { seq, type, sources: [] };
	const unsupported = (code, message) => report({ code, message, seq });
	const checkParts = (content, allowed) => {
		for (const part of content) if (!allowed.has(part?.type) && !NON_TEXT_BLOCKS.has(part?.type)) {
			unsupported("unsupported-content", `Unsupported ${type} content block: ${String(part?.type)}`);
		}
	};
	const turn = integer(data.turn, 1) ? data.turn : undefined;
	const step = integer(data.step, 1) ? data.step : undefined;
	let invalidIdentity = false;
	if (["assistant/message", "assistant/attempt", "tool/call", "tool/result"].includes(type) && (turn === undefined || step === undefined)) {
		invalidIdentity = true;
		unsupported("invalid-identity", `${type} has no valid turn/step identity`);
	}
	if ((type === "turn/start" || type === "turn/end") && turn === undefined || (type === "step/start" || type === "step/end") && (turn === undefined || step === undefined)) {
		unsupported("invalid-identity", `${type} has no valid lifecycle coordinates`);
	}
	entry.turn = turn;
	entry.step = step;
	const stepId = turn !== undefined && step !== undefined ? `assistant-step${turn}:${step}` : undefined;
	const base = {
		sessionId, seq, eventType: type, turn, step, stepId,
		...(Number.isSafeInteger(event.time) ? { time: event.time } : {}),
		streaming: false, transcriptVisible: true,
	};
	const add = (source) => {
		if (source.raw === "" && !["tool-call", "context"].includes(source.kind) && !(source.kind === "tool-result" && source.firstTextSource)) return;
		entry.sources.push({ ...base, ...source,
			...(invalidIdentity ? { transcriptVisible: false, unavailableReason: "invalid-identity" } : {}),
			id: `${sessionId}:${seq}:${source.kind}:${source.contentIndex}` });
	};
	if (["user/message", "developer/message", "assistant/message", "tool/result"].includes(type)) {
		if (event.surfaceOp !== "append") {
			const op = event.surfaceOp;
			if (!object(op) || Object.keys(op).length !== 3 || op.op !== "replace" || !integer(op.startSeq) || !integer(op.endSeq) || op.startSeq >= seq || op.endSeq >= seq) {
				unsupported("invalid-surface", `${type} has no valid append/replacement marker`);
			}
		}
		if (event.surfaceOp !== "append" && type !== "developer/message") return null;
		const message = type === "user/message" ? data : data.message;
		if (!object(message)) throw failure("invalid-content", "Durable message is invalid", seq);
		const content = contentArray(message.content, seq);
		const messageId = typeof message.id === "string" && message.id ? message.id : undefined;
		if (!messageId) {
			invalidIdentity = true;
			unsupported("invalid-identity", `${type} has no durable message identity`);
		}
		if (type === "user/message" || type === "developer/message") {
			const origin = object(message.source) ? message.source : {};
			const sourceKind = typeof origin.kind === "string" ? origin.kind : "unknown";
			entry.sourceKind = sourceKind;
			entry.referenceLabels = sourceKind === "session-reference" && Array.isArray(origin.references)
				? [...new Set(origin.references.filter((ref) => object(ref) && typeof ref.label === "string" && ref.label).map((ref) => ref.label))] : [];
			entry.skillName = sourceKind === "skill-invocation" && typeof origin.name === "string" ? origin.name : undefined;
			if (type === "user/message" && sourceKind === "user") {
				checkParts(content, new Set(["text"]));
				add({ kind: "user", contentType: "text", messageId, sourceKind, contentIndex: 0,
					raw: content.filter((part) => part?.type === "text").map((part) => requireString(part.text, "User text", seq)).join(""),
					format: "plain", referenceLabels: [], skillNames: [], contentCount: content.length });
			} else {
				entry.contextVisible = content.some((part) => part?.type === "tool-addition" || part?.type === "tool-removal");
				entry.context = prepareContext(content, origin, entry.contextVisible);
				entry.messageId = messageId;
				add({ kind: "context", contentType: "text", messageId, sourceKind, contentIndex: 0,
					raw: "", format: "context", contentCount: content.length });
			}
		} else if (type === "assistant/message") {
			checkParts(content, new Set(["text", "reasoning", "tool-call"]));
			for (let index = 0; index < content.length; index += 1) {
				const part = content[index];
				if (part?.type === "tool-call") {
					// A fixed cut can fall after the message but before tool dispatch.
					// resolveSources removes this copy if the tool/call is also durable.
					const args = requireString(part.arguments, "Assistant tool arguments", seq);
					add({ kind: "tool-call", contentType: "text", messageId, contentIndex: index,
						callId: requireString(part.id, "Assistant tool identity", seq), toolName: requireString(part.name, "Assistant tool name", seq),
						raw: args, callArguments: args, format: "tool", isSubcall: false, inlineAssistant: true,
						transcriptVisible: false, unavailableReason: "tool-call-not-dispatched" });
					continue;
				}
				if (!TEXT_TYPES.has(part?.type)) continue;
				add({ kind: part.type === "reasoning" ? "reasoning" : "assistant", contentType: part.type,
					messageId, contentIndex: index, raw: requireString(part.text, "Assistant text", seq), format: "markdown", interrupted: data.interrupted === true });
			}
		} else {
			const callId = typeof message.source?.callId === "string" ? message.source.callId : message.toolCallId;
			if (typeof callId !== "string" || !callId) throw failure("invalid-content", "Tool result has no call identity", seq);
			const meta = toolMeta(data.meta);
			const hasUnknownToolPresentation = data.meta !== undefined && (!object(data.meta) || Object.keys(data.meta).some((key) => !TOOL_META_FIELDS.has(key)));
			const resultText = content.filter((part) => part?.type === "text").map((part) => requireString(part.text, "Tool result text", seq)).join("\n");
			let sawText = false;
			checkParts(content, TEXT_TYPES);
			for (let index = 0; index < content.length; index += 1) {
				const part = content[index];
				if (!TEXT_TYPES.has(part?.type)) continue;
				const firstTextSource = part.type === "text" && !sawText;
				if (part.type === "text") sawText = true;
				add({ kind: "tool-result", contentType: part.type, messageId, callId, contentIndex: index,
					raw: requireString(part.text, "Tool result text", seq), format: "tool", meta, contentCount: content.length,
					isError: message.isError === true, isSubcall: false, firstTextSource, hasUnknownToolPresentation,
					...(firstTextSource ? { resultText } : {}) });
			}
            // Diff/Search cards can have no text content at all. Keep one
            // explicit presentation carrier so their validated visible metadata
            // is projected; it is never a dump of the underlying event.
            if (!sawText) add({ kind: "tool-result", contentType: "presentation", messageId, callId, contentIndex: content.length + 1,
                raw: "", format: "tool", meta, contentCount: content.length, isError: message.isError === true,
                isSubcall: false, firstTextSource: true, resultText: "", hasUnknownToolPresentation });
			if (message.isError === true && typeof data.error?.reason === "string") add({
				kind: "tool-result", contentType: "error-reason", messageId, callId, contentIndex: content.length,
				raw: data.error.reason, format: "tool", contentCount: content.length, isError: true, isSubcall: false,
			});
		}
	} else if (type === "assistant/attempt") {
		for (const [index, part] of assembleAttemptText(data.stream, seq).entries()) {
			add({ kind: "attempt", contentType: part.type, contentIndex: index, streamIndex: part.streamIndex,
				attemptSeq: seq, raw: part.text, format: "markdown", transcriptVisible: false, unavailableReason: "attempt-not-rendered" });
		}
	} else if (type === "tool/call") {
		const callId = requireString(data.callId, "Tool call identity", seq);
		add({ kind: "tool-call", contentType: "text", callId, contentIndex: 0,
			raw: requireString(data.arguments, "Tool arguments", seq), callArguments: data.arguments,
			toolName: requireString(data.name, "Tool name", seq), format: "tool", isSubcall: false });
	} else if (type === "tool/ptc-dispatch-start" || type === "tool/ptc-dispatch") {
		const callId = requireString(data.subCallId, "PTC call identity", seq);
		const common = { callId, rootCallId: requireString(data.rootCallId, "PTC root identity", seq),
			parentCallId: requireString(data.parentCallId, "PTC parent identity", seq),
			toolName: requireString(data.name, "PTC tool name", seq), format: "tool", isSubcall: true };
		// Only the explicit tool-input field is serialized, never an internal event.
		const args = typeof data.arguments === "string" ? data.arguments : JSON.stringify(data.arguments, null, 2);
		if (typeof args !== "string") throw failure("invalid-content", "PTC arguments are invalid", seq);
		if (type === "tool/ptc-dispatch-start") add({ ...common, kind: "tool-call", contentType: "text", contentIndex: 0, raw: args, callArguments: args });
		else {
			const content = contentArray(data.content, seq);
			const resultText = content.filter((part) => part?.type === "text").map((part) => requireString(part.text, "PTC result text", seq)).join("\n");
			let sawText = false;
			checkParts(content, TEXT_TYPES);
			for (let index = 0; index < content.length; index += 1) {
				const part = content[index];
				if (!TEXT_TYPES.has(part?.type)) continue;
				const firstTextSource = part.type === "text" && !sawText;
				if (part.type === "text") sawText = true;
				add({ ...common, kind: "tool-result", contentType: part.type,
					contentIndex: index, raw: requireString(part.text, "PTC result text", seq),
					callArguments: args, contentCount: content.length, isError: data.isError === true, firstTextSource,
					...(firstTextSource ? { resultText } : {}) });
			}
		}
	} else if (type === "agent/inbox/spliced") {
		entry.inbox = projectInboxSplice(data, seq);
	} else if (type === "command/run") {
		entry.command = { commandId: requireString(data.commandId, "Command identity", seq), name: requireString(data.name, "Command name", seq) };
	} else if (type === "command/done") {
		entry.command = { commandId: requireString(data.commandId, "Command identity", seq), done: true };
	} else if (type === "turn/end") {
		if (data.reason?.kind === "error") unsupported("unsupported-body-event", "Turn error text is not yet projected");
	} else if (type === "compaction/summary") {
		unsupported("unsupported-body-event", `Visible ${type} text is not yet projected`);
	} else if (!NON_BODY_EVENTS.has(type)) {
		unsupported("unsupported-event", `Unrecognized durable event type: ${type}`);
	}
	return entry.sources.length || entry.command || BOUNDARIES.has(type) || CONTEXT_LIFECYCLE.has(type) || type === "user/message" ? entry : null;
}

function resolveSources(entries, report) {
	const calls = new Map();
	const commands = new Map();
	const completedCalls = new Set();
	const bySeq = new Map();
	const sources = [];
	const classifier = createContextClassifier();
	let batchMessages = [];
	let batchSkills = [];
	const flush = () => {
		const names = [...new Set(batchSkills)];
		for (const source of batchMessages) source.skillNames = names;
		batchMessages = [];
		batchSkills = [];
	};
	for (const entry of entries) {
		classifier.accept(entry);
		if (entry.command?.done) {
			const command = commands.get(entry.command.commandId);
			if (command?.name !== "permission") report({ code: "unsupported-body-event", message: "Visible command/done text is not yet projected", seq: entry.seq });
		} else if (entry.command) commands.set(entry.command.commandId, entry.command);
		if (entry.context) {
            const isTrigger = entry.type === "user/message" && classifier.isTurnTrigger(entry.messageId);
            if (isTrigger || entry.contextVisible) {
                const actual = finishContext(entry.context, isTrigger);
                for (const source of entry.sources) Object.assign(source, actual);
            } else entry.sources = []; // Background context is not in the native Chat flow.
            entry.context = undefined;
        }
		for (const source of entry.sources) {
			sources.push(source);
			if (source.kind === "tool-call" && !source.inlineAssistant) calls.set(source.callId, source);
		}
		if (entry.type === "user/message") {
			if (entry.sourceKind === "user") {
				for (const source of entry.sources) { batchMessages.push(source); bySeq.set(source.seq, source); }
			} else {
				if (entry.referenceLabels?.length) {
					const previous = bySeq.get(entry.seq - 1);
					if (previous) previous.referenceLabels = entry.referenceLabels;
				}
				if (entry.skillName) batchSkills.push(entry.skillName);
			}
		} else if (BOUNDARIES.has(entry.type)) flush();
	}
	flush();
	for (const source of sources) {
		if (source.kind !== "tool-result") continue;
		const call = calls.get(source.callId);
		if (!call) {
			source.transcriptVisible = false;
			source.unavailableReason = "tool-call-not-found";
			continue;
		}
		source.toolName = call.toolName;
		source.callArguments = call.callArguments;
		source.callSeq = call.seq;
		completedCalls.add(source.callId);
	}
	for (const source of sources) if (source.kind === "tool-call" && completedCalls.has(source.callId)) {
		source.transcriptVisible = false;
		source.unavailableReason = "superseded-by-result-card";
	}
	return sources.filter((source) => !source.inlineAssistant || !calls.has(source.callId));
}

/**
 * project(source) owns renderer-aware visible text and structural blocks. It
 * returns {blocks:[{text,...}],errors:[]}; raw is never used as a silent fallback.
 * start() is idempotent, returns its final snapshot, and never throws RPC errors.
 * cancel() requests transport abort/unsubscribe and invalidates all old returns;
 * an RPC which ignores AbortSignal may continue remotely, but cannot publish.
 */
export function createHistoryReader({ remote, sessionId, generation = 0, onUpdate, project, maxMessages = 50 }) {
	if (typeof sessionId !== "string" || !sessionId) throw new TypeError("History reader needs a sessionId");
	if (typeof project !== "function") throw new TypeError("History reader needs a renderer-aware project function");
	if (!integer(maxMessages, 1)) throw new TypeError("maxMessages must be a positive integer");
	const address = { kind: "session", sessionId };
	const controller = new AbortController();
	const followController = new AbortController();
	let state = { sessionId, generation, documents: [], throughSeq: null, pages: 0, eventsRead: 0,
		readComplete: false, coverageComplete: false, projectionComplete: false, errors: [], status: "idle", revision: 0 };
	let running;
	let iterator;
	let closing;
	let stopped = false;
	let releaseCancel;
	const cancelled = new Promise((resolve) => { releaseCancel = resolve; });
	const assertCurrent = () => { if (stopped) throw failure("cancelled", "History read cancelled"); };
	const pending = (promise) => Promise.race([Promise.resolve(promise), cancelled.then(() => { throw failure("cancelled", "History read cancelled"); })]);
	const publish = (changes) => {
		if (stopped) return;
		state = { ...state, ...changes, revision: state.revision + 1 };
		try { onUpdate?.(state); } catch { /* Consumer rendering cannot corrupt the reader. */ }
	};
	const closeFollow = () => {
		if (closing) return closing;
		followController.abort();
		try { closing = Promise.resolve(iterator?.return?.()).then(() => undefined); }
		catch (error) { closing = Promise.reject(error); }
		// cancel() cannot await a transport which ignores abort; prevent orphan rejection.
		closing.catch(() => {});
		return closing;
	};
	const run = async () => {
		const pageEntries = [];
		const coverageErrors = [];
		try {
			assertCurrent();
			publish({ status: "reading" });
			assertCurrent();
			if (typeof remote?.session?.follow !== "function" || typeof remote?.session?.page !== "function") throw failure("unsupported-host", "Host has no durable session follow/page API");
			const stream = remote.session.follow({ address, maxMessages }, followController.signal);
			iterator = stream?.[Symbol.asyncIterator]?.();
			if (!iterator) throw failure("unsupported-host", "Host follow API is not an async stream");
			let opening = await pending(iterator.next());
			assertCurrent();
			let snapshot = opening?.value;
			if (opening.done || snapshot?.type !== "snapshot") throw failure("invalid-snapshot", "Session follow ended without its opening snapshot");
			if (snapshot.header?.id !== sessionId) throw failure("wrong-session", "History snapshot belongs to a different session");
			const throughSeq = snapshot.cursor;
			if (!integer(throughSeq, -1) || throughSeq >= Number.MAX_SAFE_INTEGER) throw failure("invalid-cursor", "Session snapshot cursor is invalid");
			await pending(closeFollow());
			assertCurrent();
			const sessionCwd = typeof snapshot.header.cwd === "string" ? snapshot.header.cwd : undefined;
			publish({ throughSeq, ...(sessionCwd === undefined ? {} : { sessionCwd }) });
			let page = { records: snapshot.records, hasMore: snapshot.hasMore };
			snapshot = undefined;
			opening = undefined;
			let expectedEnd = throughSeq;
			let eventsRead = 0;
			let pages = 0;
			while (true) {
				assertCurrent();
				const proof = auditHistoryPage(page, expectedEnd);
				const entries = [];
				for (let index = 0; index < page.records.length; index += 1) {
					assertCurrent();
					const entry = extractEntry(page.records[index].event, sessionId, (issue) => coverageErrors.push(issue));
					if (entry) entries.push(entry);
					if ((index + 1) % 64 === 0) await tick();
				}
				pageEntries.push(entries);
				eventsRead += proof.count;
				pages += 1;
				publish({ pages, eventsRead, errors: coverageErrors.slice() });
				assertCurrent();
				if (!page.hasMore) {
					if (proof.first !== 0 || eventsRead !== throughSeq + 1) throw failure("history-gap", "Complete history does not cover every event from zero through the snapshot");
					break;
				}
				expectedEnd = proof.first - 1;
				const beforeSeq = proof.first;
				page = undefined; // release the large wire page before asking for another
				const result = await pending(remote.session.page({ address, throughSeq, beforeSeq, maxMessages }, controller.signal));
				assertCurrent();
				if (result?.ok !== true) throw failure(typeof result?.error?.code === "string" ? result.error.code : "page-rpc-failed", typeof result?.error?.message === "string" ? result.error.message : "History page RPC failed");
				page = result.value;
			}
			assertCurrent();
			page = undefined;
			publish({ readComplete: true, coverageComplete: true, status: "projecting" });
			const entries = pageEntries.reverse().flat();
			pageEntries.length = 0;
			const sources = resolveSources(entries, (issue) => coverageErrors.push(issue));
			entries.length = 0;
			const documents = [];
			const errors = coverageErrors;
			for (let index = 0; index < sources.length; index += 1) {
				assertCurrent();
				const source = sources[index];
				if (sessionCwd !== undefined) source.sessionCwd = sessionCwd;
				const projection = await pending(project(source));
				assertCurrent();
				if (!object(projection) || !Array.isArray(projection.blocks) || projection.blocks.some((block) => !object(block) || typeof block.text !== "string")) throw failure("invalid-projection", "Text projection returned invalid blocks", source.seq);
				const localErrors = [...(source.contextErrors ?? []), ...(Array.isArray(projection.errors) ? projection.errors : [])];
				const seenErrors = new Set();
				for (const error of localErrors) {
					const issue = errorRecord(error, "projection-incomplete");
					const key = issue.code + "\0" + issue.message;
					if (!seenErrors.has(key)) errors.push({ ...issue, seq: source.seq });
					seenErrors.add(key);
				}
				documents.push({ ...source, blocks: projection.blocks,
					...(typeof projection.mapping === "string" ? { mapping: projection.mapping } : {}),
					...(typeof projection.rootClass === "string" ? { rootClass: projection.rootClass } : {}),
					...(typeof projection.cardKind === "string" ? { cardKind: projection.cardKind } : {}),
				});
				sources[index] = undefined;
				if ((index + 1) % 32 === 0) {
					publish({ documents: documents.slice(), errors: errors.slice() });
					await tick();
				}
			}
			assertCurrent();
			publish({ documents, errors, projectionComplete: errors.length === 0, status: errors.length ? "partial" : "complete" });
		} catch (error) {
			if (!stopped) publish({ projectionComplete: false, errors: [...state.errors, errorRecord(error)], status: "error" });
		} finally {
			pageEntries.length = 0;
			closeFollow();
		}
		return state;
	};
	return {
		start() { if (!running) running = run(); return running; },
		cancel() {
			if (stopped || ["complete", "partial", "error"].includes(state.status)) return;
			stopped = true;
			controller.abort();
			closeFollow();
			releaseCancel();
			state = { ...state, status: "cancelled", projectionComplete: false, revision: state.revision + 1 };
			try { onUpdate?.(state); } catch { /* Nothing may restart a cancelled reader. */ }
		},
		snapshot() { return state; },
	};
}
