// Real official Web-host bootstrap acceptance using only a temporary empty profile.
// This does not claim the synthetic-history or Desktop layers have passed.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { seedHistory, setFixturePatch, exerciseHistory } from './synthetic-history.mjs';

const [version, artifactArg, outputArg] = process.argv.slice(2);
const versions = ['0.1.5-rc.2', '0.1.5-rc.3', '0.1.6-alpha.2', '0.1.7-rc.2', '0.2.0-rc.1', '0.2.0-rc.2'];
assert.ok(versions.includes(version), 'use an explicit acceptance target');
const artifact = path.resolve(artifactArg);
const output = path.resolve(outputArg);
fs.mkdirSync(output, { recursive: true });
const hash = () => createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
const artifactSha256 = hash();
const run = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || '/tmp', 'find-all-web-'));
const discovery = path.join(run, 'discovery');
const runtime = path.join(run, 'runtime');
const home = path.join(run, 'home');
const workspace = path.join(run, 'workspace');
const full = process.env.FIND_ALL_FULL_ACCEPTANCE === '1';
const queryPath = path.join(run, 'content-index.sqlite');
for (const dir of [discovery, runtime, home]) fs.mkdirSync(dir, { recursive: true });
const manifest = { name: 'find-all-synthetic-acceptance', private: true, type: 'module', dependencies: { '@deepseek-ai/dsh': version } };
const env = { ...process.env, HOME: home, npm_config_ignore_scripts: 'true' };
function npmInstall(dir, filename) {
  const log = fs.openSync(path.join(output, filename), 'w');
  try { execFileSync('npm', ['install', '--ignore-scripts', '--strict-peer-deps', '--no-audit', '--no-fund'], { cwd: dir, env, stdio: ['ignore', log, log], timeout: 600_000 }); }
  finally { fs.closeSync(log); }
}
// Resolve the target's official dependency graph from metadata, without first
// installing a drifting caret graph or relaxing its peers. Exact non-DSH peer
// pins (e.g. Cordis Loader) are preserved as declared by the target packages.
const seen = new Set(['@deepseek-ai/dsh']);
let queue = ['@deepseek-ai/dsh'];
const overrides = {};
const manifests = {};
while (queue.length) {
  const batch = queue.splice(0, 12);
  const records = await Promise.all(batch.map(name => new Promise((resolve, reject) => {
    const child = spawn('npm', ['view', `${name}@${version}`, '--json'], { env });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => stdout += data);
    child.stderr.on('data', data => stderr += data);
    child.on('error', reject);
    child.on('exit', code => {
      if (code !== 0) reject(new Error(`metadata ${name}@${version}: ${stderr}`));
      else { try { resolve([name, JSON.parse(stdout)]); } catch (error) { reject(error); } }
    });
  })));
  for (const [name, record] of records) {
    assert.equal(record.version, version, `registry target ${name}`);
    manifests[name] = { version: record.version, dependencies: record.dependencies, peerDependencies: record.peerDependencies };
    if (name !== '@deepseek-ai/dsh') overrides[name] = version;
    for (const dependency of Object.keys({ ...record.dependencies, ...record.optionalDependencies, ...record.peerDependencies })) {
      if (dependency.startsWith('@deepseek-ai/dsh-') && !seen.has(dependency)) { seen.add(dependency); queue.push(dependency); }
    }
    for (const [dependency, range] of Object.entries(record.peerDependencies || {})) {
      if (dependency.startsWith('@deepseek-ai/') && !dependency.startsWith('@deepseek-ai/dsh') && /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(range)) {
        if (overrides[dependency]) assert.equal(overrides[dependency], range, `conflicting official peer pins: ${dependency}`);
        overrides[dependency] = range;
      }
    }
  }
}
manifest.overrides = overrides;
fs.writeFileSync(path.join(output, 'target-manifests.json'), JSON.stringify(manifests, null, 2));
fs.writeFileSync(path.join(runtime, 'package.json'), JSON.stringify(manifest));
npmInstall(runtime, 'exact-install.log');
const runtimeRequire = createRequire(path.join(runtime, 'node_modules/@deepseek-ai/dsh/package.json'));
const exactLock = JSON.parse(fs.readFileSync(path.join(runtime, 'package-lock.json')));
const observed = {};
for (const location of Object.keys(exactLock.packages)) {
  const packageName = location.split('node_modules/').at(-1);
  if (packageName !== '@deepseek-ai/dsh' && !packageName.startsWith('@deepseek-ai/dsh-')) continue;
  const file = path.join(runtime, location, 'package.json');
  if (!fs.existsSync(file)) continue; // npm may record an uninstalled optional platform package.
  observed[location] = JSON.parse(fs.readFileSync(file)).version;
  assert.equal(observed[location], version, `version drift: ${location}`);
}
for (const name of ['dsh-client-ui-chat', 'dsh-client-ui-conversation', 'dsh-api-session-controller', 'dsh-client-ui-renderer', 'dsh-client-ui-session', 'dsh-app-boot']) {
  const file = runtimeRequire.resolve(`@deepseek-ai/${name}/package.json`);
  assert.equal(JSON.parse(fs.readFileSync(file)).version, version, `required host package ${name}`);
}
fs.writeFileSync(path.join(output, 'host-versions.json'), JSON.stringify(observed, null, 2));
const bin = runtimeRequire.resolve('@deepseek-ai/dsh/package.json').replace(/package.json$/, 'lib/bin.js');
const installLog = fs.openSync(path.join(output, 'plugin-install.log'), 'w');
try {
  execFileSync(process.execPath, [bin, 'plugin', '--profile', 'web', 'add', artifact, '--ignore-scripts'], { cwd: runtime, env, stdio: ['ignore', installLog, installLog], timeout: 300_000 });
} finally { fs.closeSync(installLog); }
assert.equal(hash(), artifactSha256);
let seeded;
if (full) {
  seeded = await seedHistory(runtimeRequire, home, workspace);
  setFixturePatch(home, queryPath);
}
let serverLog = '';
const server = spawn(process.execPath, [bin, '--profile', 'web', '--no-open', '--host', '127.0.0.1', '--port', '4195'], { cwd: full ? workspace : runtime, env });
server.stdout.on('data', data => serverLog += data);
server.stderr.on('data', data => serverLog += data);
let browser;
const report = { version, artifactSha256, bootstrap: 'pending', syntheticHistory: 'not-run', desktop: 'not-run' };
try {
  let url;
  for (let elapsed = 0; elapsed < 180; elapsed++) {
    url = serverLog.match(/http:\/\/127\.0\.0\.1:4195\/\?token=[^\s]+/)?.[0];
    if (url) break;
    assert.equal(server.exitCode, null, 'host exited before startup');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok(url, 'host startup did not provide its temporary local URL');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, locale: 'en-US' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.locator('style[data-plugin-css="dsh-find-all/bar.css"]').waitFor({ state: 'attached', timeout: 30_000 });
  await page.keyboard.press('Control+f');
  const bar = page.locator('#dsh-find-all-root');
  await bar.waitFor({ state: 'visible', timeout: 30_000 });
  await bar.locator('input').fill('FIND_ALL_EMPTY_PROFILE_NEEDLE');
  await page.waitForTimeout(400);
  assert.equal(await bar.locator('.count').innerText(), '0/0');
  assert.ok((await bar.locator('.status').innerText()).length > 0, 'empty session must explain why find is unavailable');
  await page.screenshot({ path: path.join(output, 'empty-session-find.png') });
  await page.keyboard.press('Escape');
  await bar.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => CSS.highlights?.has('dsh-find-all-hit') || false), false);
  report.bootstrap = 'passed';
  if (full) {
    report.seeds = seeded;
    report.historyEvidence = await exerciseHistory(page, home, queryPath, output);
    report.syntheticHistory = 'passed';
  }
  report.browserErrors = errors;
  assert.deepEqual(errors, [], 'unhandled browser errors');
} catch (error) {
  if (report.bootstrap !== 'passed') report.bootstrap = 'failed';
  else if (full) report.syntheticHistory = 'failed';
  report.error = String(error).replace(/token=[^\s]+/g, 'token=[redacted]');
  throw error;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await new Promise(resolve => setTimeout(resolve, 500));
  if (server.exitCode === null) server.kill('SIGKILL');
  fs.writeFileSync(path.join(output, 'server.log'), serverLog.replace(/token=[^\s]+/g, 'token=[redacted]'));
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
