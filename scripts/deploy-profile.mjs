// Deploy a published @ryuu-64/dsh-find-all into the DSH desktop profile, and
// prove every link of the chain on the way through.
//
// Why a script instead of three manual steps: the 0.1.0 defect is invisible to
// the package manager (the tarball installs fine — it only fails when the
// browser executes it), so an upgrade that reports success is not evidence that
// the plugin loads. This script refuses to finish until the executed artifact
// registers under the package name.
//
//   node scripts/deploy-profile.mjs [--version 0.1.1] [--tarball <url|path>] [--profile <dir>] [--through <n>]
//
// `--tarball` checks a specific artifact (a local .tgz or a URL) instead of the
// registry's latest, and is only allowed with `--through 2`: a profile upgrade
// must come from the registry, because the rewritten dependency spec has to stay
// resolvable by any later `pnpm install`. Verify a release candidate locally
// before publishing, then deploy it from the registry after publishing.
//
// Steps:
//   1. resolve the target artifact (registry version, or --tarball)
//   2. read that exact tarball and check the registration id inside it
//   3. point the profile dependency at ^<version> (backed up first)
//   4. `pnpm install` in the profile
//   5. re-check the INSTALLED bundle, and that the lockfile pins the new version
// Any failure restores the two backed-up profile manifests and exits non-zero.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE = "@ryuu-64/dsh-find-all";
const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CHECK = join(REPO_ROOT, "scripts", "check-client-registration.mjs");
const LAST_STEP = 5;

/** Parse `--flag value` pairs; unknown flags are a hard error. */
function parseArgs(argv) {
	const valued = new Map([["--version", "version"], ["--tarball", "tarball"], ["--profile", "profile"], ["--through", "through"]]);
	const out = { version: undefined, tarball: undefined, profile: undefined, through: LAST_STEP };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--dry-run") { out.through = 2; continue; }
		const key = valued.get(arg);
		if (key === undefined) throw new Error(`unknown argument ${arg}`);
		const value = argv[index + 1];
		if (value === undefined) throw new Error(`${arg} needs a value`);
		out[key] = key === "through" ? Number(value) : value;
		index += 1;
	}
	if (!Number.isInteger(out.through) || out.through < 1 || out.through > LAST_STEP) {
		throw new Error(`--through must be 1..${LAST_STEP}`);
	}
	if (out.tarball !== undefined && out.version !== undefined) {
		throw new Error("--tarball and --version are mutually exclusive");
	}
	if (out.tarball !== undefined && out.through !== 2) {
		throw new Error(
			"--tarball only verifies an artifact (use --through 2). Upgrading a profile requires a registry release:\n"
			+ "  the rewritten profile dependency must stay resolvable by any later `pnpm install`,\n"
			+ "  and a file: or unpublished version would break the next install.",
		);
	}
	return out;
}

const args = parseArgs(process.argv.slice(2));
const step = (n, message) => console.log(`\n[${n}/${LAST_STEP}] ${message}`);
const ok = (message) => console.log(`  ok   ${message}`);
const die = (message) => { throw new Error(message); };
const at = (n) => n <= args.through;
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

function run(command, cmdArgs, cwd) {
	// `.cmd` shims need a shell on Windows; plain executables must not get one,
	// because cmd.exe would re-split this script's own path on its spaces.
	return execFileSync(command, cmdArgs, { cwd, stdio: "inherit", shell: process.platform === "win32" });
}

function output(command, cmdArgs, cwd) {
	return execFileSync(command, cmdArgs, { cwd, encoding: "utf8", shell: process.platform === "win32" }).trim();
}

/** Run the shared registration check against one installed package root. */
function checkRegistration(packageRoot) {
	const result = execFileSync(process.execPath, [CHECK, packageRoot], { encoding: "utf8" });
	return result.trim();
}

/** sha256 of an artifact, in-process — no child shell to quote around. */
function sha256(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const profile = resolve(args.profile ?? join(homedir(), ".dsh", "profiles", "desktop"));
const profileManifestPath = join(profile, "package.json");
const lockfilePath = join(profile, "pnpm-lock.yaml");
if (!existsSync(profileManifestPath)) die(`no profile manifest at ${profileManifestPath}`);

// ---------------------------------------------------------------- 1. resolve
step(1, "resolve the target artifact");
let tarballLocation;
if (args.tarball !== undefined) {
	tarballLocation = args.tarball;
	ok(`tarball source ${tarballLocation}`);
} else {
	const wanted = args.version ?? JSON.parse(output("npm", ["view", PACKAGE, "dist-tags", "--json"]))["latest"];
	// Preflight happens before anything is rewritten: the profile dependency gets
	// this exact version, and `npm view` is what proves the registry can resolve it.
	// (A version that resolves but has no tarball is caught by the isRecord check below.)
	const versions = JSON.parse(output("npm", ["view", PACKAGE, "versions", "--json"]));
	if (!Array.isArray(versions) || versions.length === 0) die(`registry lists no published versions of ${PACKAGE}`);
	if (!versions.includes(wanted)) {
		die(
			`${PACKAGE}@${wanted} is not published (registry has: ${versions.join(", ")}).\n`
			+ "  Refusing to point the profile at a version pnpm cannot resolve.\n"
			+ "  Either publish it, or use `npm install`-free local install: `npm run install:local`.",
		);
	}
	const resolved = JSON.parse(output("npm", ["view", `${PACKAGE}@${wanted}`, "version", "dist.tarball", "--json"]));
	tarballLocation = isRecord(resolved) && typeof resolved["dist.tarball"] === "string" ? resolved["dist.tarball"] : undefined;
	if (tarballLocation === undefined) die(`registry returned no tarball for ${PACKAGE}@${wanted}`);
	ok(`registry target ${wanted}`);
	ok(tarballLocation);
}

const staging = mkdtempSync(join(tmpdir(), "dsh-find-all-deploy-"));
const previous = { manifest: undefined, lockfile: undefined };
let target;

try {
	// ------------------------------------------------------- 2. artifact bytes
	step(2, "read that exact tarball and check the registration id inside it");
	const tarballPath = join(staging, "package.tgz");
	if (/^https?:/u.test(tarballLocation)) {
		await download(tarballLocation, tarballPath);
	} else {
		const local = resolve(tarballLocation);
		if (!existsSync(local)) die(`no tarball at ${local}`);
		cpSync(local, tarballPath);
		ok(`local tarball ${basename(local)}`);
	}
	mkdirSync(join(staging, "extract"), { recursive: true });
	output("tar", ["-xzf", tarballPath, "-C", join(staging, "extract")]);
	const publishedRoot = join(staging, "extract", "package");
	const publishedManifest = JSON.parse(readFileSync(join(publishedRoot, "package.json"), "utf8"));
	if (publishedManifest.name !== PACKAGE) die(`tarball carries ${publishedManifest.name}, expected ${PACKAGE}`);
	target = publishedManifest.version;
	ok(`tarball is ${PACKAGE}@${target}`);
	ok(checkRegistration(publishedRoot));

	if (args.through === 2) finish(`stopped after step 2 (--through 2): the artifact is clean`);

	// ------------------------------------------------------------- 3. profile
	// Rewriting the profile manifest is the last reversible step: everything
	// after this point either proves itself or is rolled back below. A
	// prerelease has no meaningful caret range, so it is pinned exactly.
	const nextSpec = /-/u.test(target) ? target : `^${target}`;
	if (at(3)) {
		step(3, `point ${profile} at ${nextSpec}`);
		const manifest = JSON.parse(readFileSync(profileManifestPath, "utf8"));
		const currentSpec = manifest.dependencies?.[PACKAGE];
		if (currentSpec === undefined) die(`${PACKAGE} is not a dependency of the profile`);
		ok(`dependency is currently ${currentSpec}`);
		if (currentSpec !== nextSpec) {
			previous.manifest = readFileSync(profileManifestPath, "utf8");
			previous.lockfile = existsSync(lockfilePath) ? readFileSync(lockfilePath, "utf8") : undefined;
			manifest.dependencies[PACKAGE] = nextSpec;
			writeFileSync(profileManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
			ok(`dependency rewritten to ${nextSpec}`);
		} else {
			ok("dependency already at the target range");
		}
	}

	if (at(3) && args.through === 3) finish(`stopped after step 3 (--through 3)`);

	// ---------------------------------------------------------------- 4. pnpm
	if (at(4)) {
		step(4, "pnpm install in the profile");
		run("pnpm", ["install"], profile);
	}

	if (args.through === 4) finish("stopped after step 4 (--through 4)");

	// ------------------------------------------------------------- 5. verify
	step(5, "verify the installed artifact and the lockfile");
	const installedRoot = join(profile, "node_modules", ...PACKAGE.split("/"));
	if (!existsSync(installedRoot)) die(`install produced no ${installedRoot}`);
	const installedManifest = JSON.parse(readFileSync(join(installedRoot, "package.json"), "utf8"));
	if (installedManifest.version !== target) die(`installed ${installedManifest.version}, expected ${target}`);
	ok(`installed version ${installedManifest.version}`);
	ok(checkRegistration(installedRoot));

	const publishedBundle = join(publishedRoot, "lib", "client.js");
	const installedBundle = join(installedRoot, "lib", "client.js");
	const publishedHash = sha256(publishedBundle);
	const installedHash = sha256(installedBundle);
	if (publishedHash !== installedHash) die(`installed bundle differs from the published one\n  published ${publishedHash}\n  installed ${installedHash}`);
	ok(`bundle is byte-identical to the published artifact (${installedHash.slice(0, 16)}…)`);

	const lockfile = readFileSync(lockfilePath, "utf8");
	if (!lockfile.includes(`'${PACKAGE}@${target}'`)) die(`lockfile does not pin ${PACKAGE}@${target} — a later install could drift back`);
	ok(`lockfile pins '${PACKAGE}@${target}'`);

	if (lockfile.includes(`'${PACKAGE}@0.1.0'`)) {
		ok("note: a stale 0.1.0 entry is still in the lockfile for other importers; harmless, but a clean install drops it");
	}

	finish(`deployed ${PACKAGE}@${target} to ${profile}`);
	console.log("now reload the DSH Desktop window (Ctrl+R) and confirm the \"Failed to load plugins\" banner is gone.");
	if (args.tarball !== undefined) {
		console.log(`\nthis artifact is NOT published yet — publish it before any \`pnpm install\` runs on the profile,`);
		console.log("otherwise the pinned dependency cannot be resolved from the registry.");
	}
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

/** Clean up staging and leave the process with a success status. */
function finish(message) {
	rmSync(staging, { recursive: true, force: true });
	console.log(`\n${message}`);
	process.exit(0);
}

/** Fetch a URL to a file without pulling in a dependency. */
async function download(url, destination) {
	const response = await fetch(url);
	if (!response.ok) die(`GET ${url} -> ${response.status}`);
	writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}
