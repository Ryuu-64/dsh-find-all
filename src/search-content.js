export const SEARCH_CONTENT_SERVICE = "ryuu.findAllSearchContent";

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Let optional UI plugins describe the text they actually leave in the chat.
 * Each history read gets fresh rule instances so a rule may safely keep
 * conversation-local state while sources are processed in chronological order.
 */
export function createSearchContentService(onChange) {
	const registrations = new Map();
	const changed = () => { try { onChange?.(); } catch { /* A consumer cannot break registration. */ } };
	return {
		register(owner, createRule) {
			if (typeof owner !== "string" || !owner || typeof createRule !== "function") {
				throw new TypeError("Search content registration needs an owner and a rule factory");
			}
			if (registrations.has(owner)) throw new Error(`Search content rule already registered: ${owner}`);
			const record = { createRule };
			registrations.set(owner, record);
			changed();
			let active = true;
			return () => {
				if (!active) return;
				active = false;
				if (registrations.get(owner) === record) {
					registrations.delete(owner);
					changed();
				}
			};
		},
		createProjector(project) {
			if (typeof project !== "function") throw new TypeError("Search content needs a text projector");
			const rules = [...registrations.values()].map(({ createRule }) => createRule()).filter((rule) => typeof rule === "function");
			return async (source) => {
				let current = { ...source };
				try {
					for (const rule of rules) {
						const patch = await rule(current);
						if (patch === undefined || patch === null) continue;
						if (!object(patch)) throw new TypeError("Search content rule returned an invalid change");
						current = { ...current, ...patch };
					}
				} catch (error) {
					return { source: current, blocks: [], errors: [{ code: "search-content-rule-failed", message: error instanceof Error ? error.message : String(error) }] };
				}
				const projection = await project(current);
				return { ...projection, source: current };
			};
		},
	};
}
