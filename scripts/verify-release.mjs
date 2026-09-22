// Release pre-flight: pack the exact artifact that `npm publish` would upload,
// then check the registration id INSIDE that tarball.
//
// Why not just `npm run check`: that reads the checkout. A release can still be
// wrong — a stale `lib/client.js`, a `files` entry that drops the bundle, a
// version that never got bumped — and the only artifact that matters to users is
// the tarball. This is the check that would have caught the 0.1.0 defect before
// it reached the registry.
//
//   node scripts/verify-release.mjs
//
// Exits 0 when the packed artifact is complete and registers under the package
// name; exits 1 with the reason otherwise. Nothing is published.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const check = join(repoRoot, "scripts", "check-client-registration.mjs");
const ok = (message) => console.log(`  ok   ${message}`);
const die = (message) => { console.error(`verify-release: ${message}`); process.exit(1); };

const staging = mkdtempSync(join(tmpdir(), "dsh-find-all-release-"));
try {
	console.log(`verify-release: packing ${pkg.name}@${pkg.version}\n`);
	const packed = execFileSync("npm", ["pack", "--pack-destination", staging, "--silent"], {
		cwd: repoRoot, encoding: "utf8", shell: process.platform === "win32",
	}).trim().split("\n").pop().trim();
	const tarball = join(staging, packed);
	if (!existsSync(tarball)) die(`npm pack produced no tarball (reported ${packed})`);
	ok(`packed ${packed} (${statSync(tarball).size} bytes)`);

	execFileSync("tar", ["-xzf", tarball, "-C", staging], { stdio: "inherit" });
	const root = join(staging, "package");
	const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

	if (manifest.version !== pkg.version) die(`tarball version ${manifest.version} != package.json ${pkg.version}`);
	ok(`version ${manifest.version}`);

	// Files a consumer needs: the bundle the browser fetches, the host half the
	// loader imports, and the patch the profile applies.
	for (const required of ["lib/client.js", "lib/index.js", "cordis.patch.yml"]) {
		if (!existsSync(join(root, ...required.split("/")))) die(`tarball is missing ${required}`);
	}
	ok("carries lib/client.js, lib/index.js, cordis.patch.yml");

	const bundle = join(root, "lib", "client.js");
	const bundleHash = createHash("sha256").update(readFileSync(bundle)).digest("hex");
	const sourceHash = createHash("sha256").update(readFileSync(join(repoRoot, "lib", "client.js"))).digest("hex");
	if (bundleHash !== sourceHash) die(`packed bundle differs from the checked-in one\n  packed ${bundleHash}\n  source ${sourceHash}`);
	ok(`packed bundle is the checked-in bundle (${bundleHash.slice(0, 16)}…)`);

	ok(execFileSync(process.execPath, [check, root], { encoding: "utf8" }).trim());
	console.log(`\nverify-release: ${pkg.name}@${pkg.version} is safe to publish`);
} finally {
	rmSync(staging, { recursive: true, force: true });
}
