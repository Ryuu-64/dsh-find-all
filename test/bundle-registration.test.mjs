// Regression test: the client bundle must register itself under the package's
// own name.
//
// The host derives the boot-graph row id from the resolved `package.json` name
// (@deepseek-ai/dsh-client-modules, `ClientModuleRegistry.reconcilePackage` ->
// `graphRow(packageName, ...)`), and `ClientModuleSystem.arrive()` throws
//
//   client-modules: bundle <url> loaded without registering "<name>" via
//   __ModuleLoader__.load
//
// when the executed script did not register a factory under exactly that key.
// The fork registered the stale unscoped id `dsh-find-all`, so the plugin was
// listed in the boot graph, its bundle loaded fine, and the row still failed —
// which surfaced in the GUI as "Failed to load plugins".
//
// The expected id is read from package.json and never hardcoded, so renaming or
// re-scoping the package again cannot silently reintroduce the drift.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(dir, "../package.json"), "utf8"));
const source = readFileSync(join(dir, "../lib/client.js"), "utf8");

function registrations() {
	const seen = [];
	new Function("window", source)({ __ModuleLoader__: { load: (entry) => seen.push(entry) } });
	return seen;
}

test("the bundle registers exactly one factory", () => {
	assert.equal(registrations().length, 1);
});

test("the registered id is the package name the host composes the row id from", () => {
	const ids = registrations().map((entry) => entry.id);
	assert.deepEqual(ids, [pkg.name]);
});

test("the registered factory is a function", () => {
	assert.equal(typeof registrations()[0].factory, "function");
});
