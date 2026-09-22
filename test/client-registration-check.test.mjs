// Regression test for the registration check ITSELF.
//
// The check reads the package it is pointed at. If it silently fell back to the
// source checkout, a defective published tarball would be reported as clean —
// which is what happened once while this fix was being verified: the registry's
// 0.1.0 (still carrying `id: "dsh-find-all"`) was reported "ok".
//
// These tests therefore run the check against a COPY whose registration id has
// been mutated, and assert it is rejected with a file:line diagnostic.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const check = join(repoRoot, "scripts", "check-client-registration.mjs");

/** Copy the package into a scratch root, optionally rewriting the bundle. */
function copyPackage(mutate) {
	const scratch = mkdtempSync(join(tmpdir(), "dsh-find-all-check-"));
	cpSync(join(repoRoot, "package.json"), join(scratch, "package.json"));
	cpSync(join(repoRoot, "lib"), join(scratch, "lib"), { recursive: true });
	if (mutate !== undefined) {
		const bundle = join(scratch, "lib", "client.js");
		const source = readFileSync(bundle, "utf8");
		writeFileSync(bundle, mutate(source));
	}
	return scratch;
}

function runCheck(root) {
	return spawnSync(process.execPath, [check, root], { encoding: "utf8" });
}

test("a copy of the package passes", () => {
	const scratch = copyPackage();
	try {
		const result = runCheck(scratch);
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /ok — .*registers "@ryuu-64\/dsh-find-all"/);
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
});

test("a copy with the 0.1.0 unscoped id is rejected, with the line number", () => {
	const scratch = copyPackage((source) => source.replace('id: "@ryuu-64/dsh-find-all"', 'id: "dsh-find-all"'));
	try {
		const result = runCheck(scratch);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /lib[\\/]client\.js:45 registers "dsh-find-all"/);
		assert.match(result.stderr, /package name is "@ryuu-64\/dsh-find-all"/);
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
});

test("the check never falls back to the source checkout", () => {
	// The scratch copy is defective while the checkout is fixed: reporting "ok"
	// here would prove the argument is being ignored.
	const scratch = copyPackage((source) => source.replace('id: "@ryuu-64/dsh-find-all"', 'id: "not-the-package-name"'));
	try {
		const result = runCheck(scratch);
		assert.equal(result.status, 1, "the check reported on the checkout instead of the argument");
		assert.match(result.stderr, /not-the-package-name/);
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
});

test("a bundle that registers nothing is rejected", () => {
	const scratch = copyPackage((source) => source.replace("window.__ModuleLoader__.load({", "void ({"));
	try {
		const result = runCheck(scratch);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /must register exactly one factory/);
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
});
