// Run with the installed, signed Electron executable in its supported Node mode.
// Official rc2 smoke-packaged-runtime.ts and runtime-payload-smoke.mjs resolve
// dependencies from resources/app.asar/dsh in precisely this way. No unpacking,
// runtime replacement, model invocation, or real user profile is involved.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { seedHistory } from './synthetic-history.mjs';

const [runtime, home, workspace, version] = process.argv.slice(2);
assert.equal(process.platform, 'win32');
assert.ok(process.versions.electron, 'use the installed Electron Node runtime');
assert.equal(process.env.ELECTRON_RUN_AS_NODE, '1');
assert.equal(path.resolve(process.env.DSH_HOME), path.join(path.resolve(home), '.dsh'));
const descriptor = JSON.parse(fs.readFileSync(path.join(runtime, 'desktop-runtime.json'), 'utf8'));
assert.equal(descriptor.release.version, version);
assert.equal(process.versions.node, descriptor.release.nodeVersion);
assert.equal(descriptor.platform, process.platform);
assert.equal(descriptor.arch, process.arch);
const runtimeRequire = createRequire(path.join(runtime, 'package.json'));
const sidebarChild = version === '0.2.0-rc.2';
for (const name of ['dsh-session', 'dsh-llm', 'dsh-session-persistence-jsonl', ...(sidebarChild ? ['dsh-subagent'] : [])]) {
  assert.equal(JSON.parse(fs.readFileSync(runtimeRequire.resolve(`@deepseek-ai/${name}/package.json`))).version, version);
}
const sessions = await seedHistory(runtimeRequire, home, workspace, { sidebarChild });
console.log(JSON.stringify({ status: 'passed', version, node: process.versions.node,
  electron: process.versions.electron, runtime: 'installed ASAR dependency tree', sessions }));
