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
			let rules, ruleFailure = false;
            try { rules = [...registrations.values()].map(({ createRule }) => createRule()); if(rules.some(rule=>typeof rule!=="function"))ruleFailure=true; } catch { ruleFailure=true; }
			return async (source) => {
				let current = { ...source };
                if(ruleFailure)return {source,blocks:[],errors:[{code:"search-content-rule-failed",message:"Search content rule initialization failed"}]};
				try {
					for (const rule of rules) {
						const patch = await rule(current);
						if (patch === undefined || patch === null) continue;
						if (!object(patch)) throw new TypeError("Search content rule returned an invalid change");
						if(["sessionId","seq","id","kind","contentIndex","messageId","turn","step","stepId"].some(key=>Object.hasOwn(patch,key)&&patch[key]!==source[key]))throw new TypeError("Search content rule changed durable identity");
                        current = { ...current, ...patch };
					}
				} catch (error) {
					return { source: current, blocks: [], errors: [{ code: "search-content-rule-failed", message: "Search content rule failed" }] };
				}
				const projection = await project(current);
				return { ...projection, source: current };
			};
		},
	};
}
