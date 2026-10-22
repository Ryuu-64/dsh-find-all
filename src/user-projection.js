// Modern official user-text projection. The Host's public evaluator owns the
// grammar; this adapter only reads the explicitly supported display fields.
// Reference: official RC2 UserText, PlainUserText, SessionReference,
// FileReference, FolderReference, SkillReference, GoalCommandReference, and
// SecretText. Never run a second token parser or index a renderer's raw fallback.
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");
const integer = (value) => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
const issue = (code, message) => ({ code, message });
// Modern official inline display ignores decorative controls between spans.
// This labels block-mapping semantics, not completeness or renderer identity.
const result = (blocks = [], errors = []) => ({ blocks, mapping: "user", userTextSemantics: "official-inline", errors });
const unavailable = () => result([], [issue("user-projection-unavailable", "Host user-text evaluation is unavailable; user text was not indexed")]);

/** Whitelisted fields of the official inline renderers, never titles or raw. */
function displayText(node, raw) {
	const data = node.data;
	if (!object(data)) return undefined;
	if (node.id === "text") {
		if (typeof data.text !== "string" || data.text !== raw.slice(node.start, node.end)) return undefined;
		// The official renderer uses nullish coalescing, including an empty display.
		return data.display == null ? data.text : typeof data.display === "string" ? data.display : undefined;
	}
	if (["session", "file", "folder"].includes(node.id)) return typeof data.label === "string" ? data.label : undefined;
	if (["skill", "command"].includes(node.id)) return typeof data.name === "string" ? `/${data.name}` : undefined;
	// Never use the original substring, a reveal state, or an alternate field.
	if (node.id === "secret") return typeof data.masked === "string" ? data.masked : undefined;
	return undefined;
}

/**
 * Project evaluated JSON nodes under the supported official renderer contract.
 * Unknown/malformed business nodes leave explicit coverage gaps. A gap breaks
 * inline blocks so text on opposite sides cannot form a fabricated match.
 */
export function projectUserTextNodes(nodes, raw) {
	if (typeof raw !== "string" || !Array.isArray(nodes)) return result([], [issue("invalid-user-projection", "Host user-text evaluation returned an invalid document")]);
	let cursor = 0;
	for (const node of nodes) {
		if (!object(node) || typeof node.id !== "string" || !integer(node.start) || !integer(node.end)
			|| node.start !== cursor || node.end <= node.start || node.end > raw.length) {
			return result([], [issue("invalid-user-projection", "Host user-text evaluation did not cover the original document in order")]);
		}
		cursor = node.end;
	}
	if (cursor !== raw.length) return result([], [issue("invalid-user-projection", "Host user-text evaluation did not cover the original document in order")]);
	const blocks = [], errors = [];
	let text = "";
	const flush = () => {
		if (text !== "") blocks.push({ text, index: blocks.length });
		text = "";
	};
	for (const node of nodes) {
		const display = displayText(node, raw);
		if (display === undefined) {
			flush();
			errors.push(issue("unsupported-user-node", "A user-text display node is unsupported or invalid; its raw fallback was not indexed"));
		} else text += display;
	}
	flush();
	return { ...result(blocks, errors), ...(nodes.some((node) => node.id === "secret") ? { defaultMasked: true } : {}) };
}

// Facts come only from the durable source, not a currently mounted row or a
// different Session. Retain the known facts exactly rather than silently
// replacing malformed supplied values with a plausible empty list.
function sourceFacts(source) {
	const facts = source.userTextFacts === undefined ? {
		...(source.referenceLabels === undefined ? {} : { sessionLabels: source.referenceLabels }),
		...(source.skillNames === undefined ? {} : { skillNames: source.skillNames }),
	} : source.userTextFacts;
	if (!object(facts)) return undefined;
	for (const key of ["sessionLabels", "skillNames"]) if (facts[key] !== undefined && !strings(facts[key])) return undefined;
	for (const key of ["collapseWhitespace", "trimWhitespace"]) if (facts[key] !== undefined && typeof facts[key] !== "boolean") return undefined;
	if (facts.commands !== undefined && (!Array.isArray(facts.commands) || !facts.commands.every((command) => object(command)
		&& integer(command.start) && integer(command.end) && command.end > command.start && typeof command.name === "string"))) return undefined;
	return facts;
}

/**
 * Own one independent public evaluator for one Session/history generation.
 * The optional verifyRenderer checks the active Factory and relevant node
 * Slots. The caller should supply a capability/change guard when available;
 * without one this implements the documented official renderer semantics, not
 * authentication of a custom same-key renderer. Evaluation alone cannot detect
 * missing/custom Slots that render raw text. The guard is synchronous, like the
 * Host's evaluator; an explicit failure fails closed.
 */
export function createUserTextProjector(userText, { sessionId, verifyRenderer } = {}) {
	let evaluate;
	try {
		if (typeof userText?.createEvaluator === "function") evaluate = userText.createEvaluator();
	} catch { /* Report capability loss without copying a potentially private cause. */ }
	return function projectUser(source) {
		if (typeof evaluate !== "function") return unavailable();
		if (!object(source) || typeof source.raw !== "string") return result([], [issue("invalid-user-source", "User source text is unavailable")]);
		if (sessionId !== undefined && source.sessionId !== sessionId) return result([], [issue("user-session-mismatch", "User source belongs to a different Session")]);
		const facts = sourceFacts(source);
		if (facts === undefined) return result([], [issue("invalid-user-facts", "Durable user-text facts are invalid")]);
		let nodes;
		try {
			nodes = evaluate({ text: source.raw, facts });
		} catch {
			return result([], [issue("user-transform-failed", "Host user-text evaluation failed; its raw fallback was not indexed")]);
		}
		try {
			if (verifyRenderer !== undefined && (typeof verifyRenderer !== "function" || verifyRenderer(nodes, source) !== true)) {
				return result([], [issue("user-renderer-unavailable", "Official user-text rendering could not be verified; its raw fallback was not indexed")]);
			}
		} catch {
			return result([], [issue("user-renderer-unavailable", "Official user-text rendering could not be verified; its raw fallback was not indexed")]);
		}
		return projectUserTextNodes(nodes, source.raw);
	};
}
