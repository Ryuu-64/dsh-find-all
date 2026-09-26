// Install the exact fixed artifact into a DSH profile from a local tarball.
//
// Why this exists next to `deploy-profile.mjs`: that one upgrades from the
// registry and therefore needs a published release. This one needs nothing from
// npm — which matters when publishing is blocked on interactive 2FA while the
// registry still carries the defective 0.1.0. Pointing the profile at a built
// tarball also removes the fragility of a hand-patched `node_modules`: a later
// `pnpm install` reinstalls from this tarball instead of resolving the registry.
//
//   node scripts/install-local.mjs [--tarball <path>] [--profile <dir>] [--dry-run]
//
// Default tarball: `npm pack` output beside this repo (`dsh-find-all-<version>.tgz`),
// refreshed automatically when missing or stale.
//
// Steps:
//   1. build the tarball (or take the given one) and check the registration id inside it
//   2. point the profile dependency at `file:<tarball>` (profile manifests backed up)
//   3. `pnpm install` in the profile
//   4. assert the installed bundle is byte-identical to the tarball's and registers
// Failure restores both profile manifests and exits non-zero.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE = "@ryuu-64/dsh-find-all";
const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CHECK = join(REPO_ROOT, "scripts", "check-client-registration.mjs");
const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));

function parseArgs(argv) {
	const valued = new Map([["--tarball", "tarball"], ["--profile", "profile"]]);
	const out = { tarball: undefined, profile: undefined, dryRun: false };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--dry-run") { out.dryRun = true; continue; }
		const key = valued.get(arg);
		if (key === undefined) throw new Error(`unknown argument ${arg}`);
		const value = argv[index + 1];
		if (value === undefined) throw new Error(`${arg} needs a value`);
		out[key] = value;
		index += 1;
	}
	return out;
}

const args = parseArgs(process.argv.slice(2));
const profile = resolve(args.profile ?? join(homedir(), ".dsh", "profiles", "desktop"));
const profileManifestPath = join(profile, "package.json");
const lockfilePath = join(profile, "pnpm-lock.yaml");
const step = (n, message) => console.log(`\n[${n}/4] ${message}`);
const ok = (message) => console.log(`  ok   ${message}`);
const die = (message) => { throw new Error(message); };
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const run = (command, cmdArgs, cwd) => execFileSync(command, cmdArgs, {
	// `.cmd` shims need a shell on Windows; bare executables must not get one,
	// because cmd.exe would re-split this script's own path on its spaces.
	cwd, stdio: "inherit", shell: process.platform === "win32",
});

if (!existsSync(profileManifestPath)) die(`no profile manifest at ${profileManifestPath}`);

const staging = mkdtempSync(join(tmpdir(), "dsh-find-all-local-"));
const previous = { manifest: undefined, lockfile: undefined };

try {
	// ------------------------------------------------------------- 1. tarball
	step(1, "resolve the artifact and check the registration id inside it");
	// The tarball is copied INTO the profile and referenced relatively, because
	// that is what keeps the lockfile portable: pnpm stores `file:<basename>`
	// and a tarball inside the profile cannot be swept away by a `git clean` in
	// the repository it was built from.
	const tarballName = `${pkg.name.replace(/^@/, "").replace(/\//, "-")}-${pkg.version}.tgz`;
	let tarball = args.tarball === undefined ? join(profile, tarballName) : resolve(args.tarball);
	if (args.tarball === undefined) {
		const built = join(REPO_ROOT, tarballName);
		const stale = !existsSync(built)
			|| statSync(built).mtimeMs < statSync(join(REPO_ROOT, "lib", "client.js")).mtimeMs;
		if (stale) {
			console.log(`  ..   packing ${pkg.name}@${pkg.version}`);
			execFileSync("npm", ["pack", "--pack-destination", REPO_ROOT, "--silent"], {
				cwd: REPO_ROOT, encoding: "utf8", shell: process.platform === "win32",
			});
		} else {
			ok(`reusing ${basename(built)} (newer than lib/client.js)`);
		}
		copyFileSync(built, tarball);
		ok(`copied into the profile: ${basename(tarball)}`);
	}
	if (!existsSync(tarball)) die(`no tarball at ${tarball}`);
	ok(`tarball ${tarball} (${statSync(tarball).size} bytes)`);

	// Verify what the tarball actually carries, not what the repo says.
	mkdirSync(join(staging, "extract"), { recursive: true });
	execFileSync("tar", ["-xzf", tarball, "-C", join(staging, "extract")], { stdio: "inherit" });
	const artifactRoot = join(staging, "extract", "package");
	const artifactManifest = JSON.parse(readFileSync(join(artifactRoot, "package.json"), "utf8"));
	if (artifactManifest.name !== PACKAGE) die(`tarball carries ${artifactManifest.name}`);
	ok(`artifact is ${PACKAGE}@${artifactManifest.version}`);
	ok(execFileSync(process.execPath, [CHECK, artifactRoot], { encoding: "utf8" }).trim());

	// ------------------------------------------------------------- 2. profile
	step(2, `point ${profile} at a local tarball`);
	const manifest = JSON.parse(readFileSync(profileManifestPath, "utf8"));
	const currentSpec = manifest.dependencies?.[PACKAGE];
	if (currentSpec === undefined) die(`${PACKAGE} is not a dependency of the profile`);
	ok(`dependency is currently ${currentSpec}`);
	// Relative when the tarball sits in the profile (the default), absolute for an
	// --tarball elsewhere. Restating the version keeps the npm flow working later:
	// replacing this one value with `^<version>` is all a registry upgrade needs.
	const inside = tarball.startsWith(profile);
	const nextSpec = inside ? `file:./${basename(tarball)}` : `file:${tarball.replace(/\\/g, "/")}`;
	if (currentSpec !== nextSpec) {
		previous.manifest = readFileSync(profileManifestPath, "utf8");
		previous.lockfile = existsSync(lockfilePath) ? readFileSync(lockfilePath, "utf8") : undefined;
		manifest.dependencies[PACKAGE] = nextSpec;
		writeFileSync(profileManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
		ok(`dependency rewritten to ${nextSpec}`);
	} else {
		ok("dependency already points at this tarball");
	}
	if (args.dryRun) {
		console.log("\ndry run: stopping before pnpm install");
		if (previous.manifest !== undefined) {
			writeFileSync(profileManifestPath, previous.manifest);
			if (previous.lockfile !== undefined) writeFileSync(lockfilePath, previous.lockfile);
			console.log("  restored the profile manifests");
		}
		rmSync(staging, { recursive: true, force: true });
		process.exit(0);
	}

	// ---------------------------------------------------------------- 3. pnpm
	step(3, "pnpm install in the profile");
	run("pnpm", ["install"], profile);

	// ------------------------------------------------------------- 4. verify
	step(4, "verify the installed artifact");
	const installedRoot = join(profile, "node_modules", ...PACKAGE.split("/"));
	if (!existsSync(installedRoot)) die(`install produced no ${installedRoot}`);
	const installedManifest = JSON.parse(readFileSync(join(installedRoot, "package.json"), "utf8"));
	if (installedManifest.version !== artifactManifest.version) {
		die(`installed ${installedManifest.version}, expected ${artifactManifest.version}`);
	}
	ok(`installed version ${installedManifest.version}`);
	ok(execFileSync(process.execPath, [CHECK, installedRoot], { encoding: "utf8" }).trim());

	const artifactHash = sha256(join(artifactRoot, "lib", "client.js"));
	const installedHash = sha256(join(installedRoot, "lib", "client.js"));
	if (artifactHash !== installedHash) {
		die(`installed bundle differs from the tarball\n  tarball   ${artifactHash}\n  installed ${installedHash}`);
	}
	ok(`bundle is byte-identical to the tarball (${installedHash.slice(0, 16)}…)`);

	const lockfile = readFileSync(lockfilePath, "utf8");
	if (!lockfile.includes(basename(tarball))) die("lockfile does not reference the tarball — a later install could drift back to the registry");
	ok("lockfile pins the tarball, so a later `pnpm install` reinstalls it");

	rmSync(staging, { recursive: true, force: true });
	console.log(`\ninstalled ${PACKAGE}@${artifactManifest.version} into ${profile} from a local tarball`);
	console.log("reload the DSH Desktop window (Ctrl+R) to pick it up.");
	console.log("\nto move to the registry once this version is published:");
	console.log(`  node scripts/deploy-profile.mjs        # rewrites the dependency and proves the installed bytes`);
} catch (error) {
	console.error(`\nFAILED: ${error.message}`);
	if (previous.manifest !== undefined) {
		writeFileSync(profileManifestPath, previous.manifest);
		console.error("  restored the profile package.json");
	}
	if (previous.lockfile !== undefined) {
		writeFileSync(lockfilePath, previous.lockfile);
		console.error("  restored the profile pnpm-lock.yaml");
	}
	rmSync(staging, { recursive: true, force: true });
	process.exit(1);
}
