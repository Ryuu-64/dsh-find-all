// Pre-flight check for the one invariant that breaks the plugin on load:
// the client bundle must register under the PACKAGE NAME.
//
// Why this exists (the 0.1.0 defect): the host composes the boot-graph row id
// from the package name resolved out of package.json
// (`@deepseek-ai/dsh-client-modules`, `ClientModuleRegistry.reconcilePackage`),
// and `ClientModuleSystem.arrive()` rejects the row when the executed bundle did
// not register a factory under exactly that key:
//
//   client-modules: bundle <url> loaded without registering "<name>" via
//   __ModuleLoader__.load
//
// The fork shipped `id: "dsh-find-all"` (the unscoped name) while the package is
// `@ryuu-64/dsh-find-all`, so the GUI reported "Failed to load plugins" for a
// bundle that had in fact loaded fine.
//
// `package.json` is the single source of truth: the expected id is read from it
// and never spelled out here, so re-scoping or renaming the package again cannot
// reintroduce the drift silently.
//
//   node scripts/check-client-registration.mjs [package-root]
//
// The optional argument checks an arbitrary copy of the package — the registry
// tarball, or an installed profile — instead of this checkout. Without it the
// check would always measure the source tree, which is exactly how a defective
// published tarball can pass a check that was supposed to inspect it.
//
// Exits 0 when the invariant holds, 1 with a `file:line` diagnostic when it does not.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(process.argv[2] ?? dirname(dirname(fileURLToPath(import.meta.url))));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const expected = pkg.name;

/** Resolve `exports["./client"]` the same way the host scan does. */
function clientEntry(pkg) {
	const entry = pkg.exports?.["./client"];
	const resolved = typeof entry === "string" ? entry : entry?.default;
	if (typeof resolved !== "string") {
		throw new Error(`${pkg.name} declares no exports["./client"] bundle`);
	}
	return join(root, resolved.replace(/^\.\//, "").replace(/\//g, "/"));
}

function fail(message) {
	console.error(`check-client-registration: ${message}`);
	process.exit(1);
}

const clientPath = clientEntry(pkg);
const source = readFileSync(clientPath, "utf8");
const relative = clientPath.slice(root.length + 1);

// The bundle runs as a classic script and materializes its factory lazily, so a
// stub loader is enough to observe the handoff without a DOM.
const registrations = [];
try {
	new Function("window", source)({ __ModuleLoader__: { load: (entry) => registrations.push(entry) } });
} catch (error) {
	fail(`${relative} threw while registering: ${error.message}`);
}

if (registrations.length !== 1) {
	fail(`${relative} must register exactly one factory, registered ${registrations.length}`);
}

const [registration] = registrations;
if (registration.id !== expected) {
	// Point at the literal so the fix is one edit away.
	const lines = source.split("\n");
	const at = lines.findIndex((line) => /id:\s*["']/.test(line));
	const where = at === -1 ? relative : `${relative}:${at + 1}`;
	fail(
		`${where} registers "${registration.id}" but the package name is "${expected}".\n`
		+ `  The host composes the boot-graph row id from the package name, so this bundle\n`
		+ `  loads and then fails with: bundle ... loaded without registering "${expected}".\n`
		+ `  Fix: id: ${JSON.stringify(expected)}`,
	);
}

if (typeof registration.factory !== "function") {
	fail(`${relative} registered a non-function factory`);
}

console.log(`check-client-registration: ok — ${relative} registers "${expected}"`);
