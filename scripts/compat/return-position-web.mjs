// Issue 15: exact RC2 Web-host geometry and native-input acceptance.
// Synthetic Session history and the official test-only LLM replay provider are the only fixtures.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { seedReturnHistory, writeReturnOverlay, exerciseReturnPosition } from './return-position-fixture.mjs';
import { createRedactor, captureSafePage } from './evidence.mjs';
import { npmCommand } from './npm-command.mjs';
const secrets = new Set();
const redact = createRedactor(secrets);

const [version, artifactArg, outputArg] = process.argv.slice(2);
const versions = ['0.2.0-rc.2'];
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
const queryPath = path.join(run, 'content-index.sqlite');
for (const dir of [discovery, runtime, home]) fs.mkdirSync(dir, { recursive: true });
const manifest = { name: 'find-all-return-position-acceptance', private: true, type: 'module', dependencies: { '@deepseek-ai/dsh': version, '@deepseek-ai/dsh-llm-replay': version } };
const env = { ...process.env };
// Never inherit a developer's DSH home, skill roots, or model credentials.
// The fixture's Node/npm children need only public-registry access.
for (const name of Object.keys(env)) {
  if (name.startsWith('DSH_') || /(?:KEY|TOKEN|SECRET|PASSWORD)/i.test(name)) delete env[name];
}
Object.assign(env, {
  HOME: home,
  DSH_HOME: path.join(home, '.dsh'),
  DSH_AGENTS_HOME: path.join(home, '.agents'),
  DSH_BUNDLED_SKILL_DIR: path.join(home, '.bundled-skills'),
  npm_config_ignore_scripts: 'true',
  npm_config_cache: path.join(process.env.RUNNER_TEMP || '/tmp', 'find-all-registry-cache'),
  npm_config_registry: 'https://registry.npmjs.org',
  npm_config_userconfig: path.join(home, '.npmrc'),
});
function npmInstall(dir, filename) {
  const log = fs.openSync(path.join(output, filename), 'w');
  const npm = npmCommand(['install', '--ignore-scripts', '--strict-peer-deps', '--no-audit', '--no-fund']);
  try { execFileSync(npm.command, npm.args, { cwd: dir, env, stdio: ['ignore', log, log], timeout: 600_000 }); }
  finally { fs.closeSync(log); }
}
// Resolve the target's official dependency graph from metadata, without first
// installing a drifting caret graph or relaxing its peers. Exact non-DSH peer
// pins (e.g. Cordis Loader) are preserved as declared by the target packages.
const seen = new Set(['@deepseek-ai/dsh', '@deepseek-ai/dsh-llm-replay']);
let queue = [...seen];
// Each pin comes from vendor/*/package.json at that exact official release tag.
const vendorVersions = JSON.parse(fs.readFileSync(new URL('./vendor-versions.json', import.meta.url)))[version];
assert.ok(vendorVersions, 'vendor baseline must be researched for this target');
const overrides = { ...vendorVersions };
const manifests = {};
while (queue.length) {
  const batch = queue.splice(0, 12);
  const records = await Promise.all(batch.map(name => new Promise((resolve, reject) => {
    const npm = npmCommand(['view', `${name}@${version}`, '--json']);
    const child = spawn(npm.command, npm.args, { env });
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
    if (!Object.hasOwn(manifest.dependencies, name)) overrides[name] = version;
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
const exactLockText = fs.readFileSync(path.join(runtime, 'package-lock.json'), 'utf8');
fs.writeFileSync(path.join(output, 'runtime-lock.json'), exactLockText);
const exactLock = JSON.parse(exactLockText);
const observed = {};
for (const location of Object.keys(exactLock.packages)) {
  const packageName = location.split('node_modules/').at(-1);
  const isDsh = packageName === '@deepseek-ai/dsh' || packageName.startsWith('@deepseek-ai/dsh-');
  if (!isDsh && !vendorVersions[packageName]) continue;
  const file = path.join(runtime, location, 'package.json');
  if (!fs.existsSync(file)) continue; // npm may record an uninstalled optional platform package.
  observed[location] = JSON.parse(fs.readFileSync(file)).version;
  assert.equal(observed[location], isDsh ? version : vendorVersions[packageName], `version drift: ${location}`);
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
const seeds = await seedReturnHistory(runtimeRequire, home, workspace);
const overlay = writeReturnOverlay(runtimeRequire, home, queryPath, run);
let serverLog = '';
const server = spawn(process.execPath, [bin, '--profile', 'web', '--patch', overlay, '--no-open', '--host', '127.0.0.1', '--port', '4196'], { cwd: workspace, env });
server.stdout.on('data', data => serverLog += data);
server.stderr.on('data', data => serverLog += data);
const report = { version, artifactSha256, seeds, bootstrap: 'pending', returnPosition: 'not-run', desktop: 'not-run' };
let browser, page;
try {
  let url;
  for (let second = 0; second < 180; second++) {
    url = serverLog.match(/http:\/\/127\.0\.0\.1:4196\/\?token=[^\s]+/)?.[0];
    if (url) break;
    assert.equal(server.exitCode, null, 'host exited before startup');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok(url, 'host did not supply its temporary local URL');
  secrets.add(new URL(url).searchParams.get('token'));
  for (let second = 0; second < 60; second++) {
    assert.equal(server.exitCode, null, 'host exited after startup');
    try {
      const response = await fetch(new URL('/', url), { redirect: 'manual' });
      if ([200, 401].includes(response.status)) break;
    } catch {}
    if (second === 59) throw new Error('host did not become HTTP-ready');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  browser = await chromium.launch({ headless: true, ...(process.env.FIND_ALL_CHROMIUM ? { executablePath: process.env.FIND_ALL_CHROMIUM } : {}) });
  page = await browser.newPage({ viewport: { width: 1400, height: 900 }, locale: 'en-US', reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__returnInputEvidence = [];
    for (const type of ['pointerdown', 'keydown', 'click']) document.addEventListener(type, event => {
      if (!event.target?.closest?.('[data-find-all-return]')) return;
      window.__returnInputEvidence.push({ type, key: event.key ?? null, trusted: event.isTrusted,
        insideScrollport: !!event.target.closest('[data-conversation-scroll]') });
    }, true);
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.locator('style[data-plugin-css="dsh-find-all/bar.css"]').waitFor({ state: 'attached', timeout: 30_000 });
  const notice = page.getByText(/^(Internal Testing Notice|Preview Notice)$/);
  await notice.waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await notice.waitFor({ state: 'hidden' });
  const configureLater = page.getByRole('button', { name: 'Configure later', exact: true });
  if (await configureLater.isVisible()) {
    await configureLater.click();
    await configureLater.waitFor({ state: 'hidden' });
  }
  await page.addLocatorHandler(configureLater, async () => { await configureLater.click(); });
  report.bootstrap = 'passed';
  const capture = name => captureSafePage(page, path.join(output, name), secrets, redact);
  report.cases = await exerciseReturnPosition(page, capture);
  report.inputEvidence = await page.evaluate(() => window.__returnInputEvidence);
  report.browserErrors = errors.map(redact);
  assert.deepEqual(errors, [], 'unhandled browser errors');
  report.returnPosition = report.cases.every(item => item.result === 'passed') ? 'passed' : 'failed';
  assert.equal(report.returnPosition, 'passed', 'one or more real-host return scenarios failed; inspect cases');
} catch (error) {
  report.error = redact(error);
  if (report.bootstrap !== 'passed') report.bootstrap = 'failed';
  else report.returnPosition = 'failed';
  if (page) {
    try { report.failureScreenshot = await captureSafePage(page, path.join(output, 'failure-page'), secrets, redact); } catch {}
    try { report.inputEvidence = await page.evaluate(() => window.__returnInputEvidence); } catch {}
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await new Promise(resolve => setTimeout(resolve, 500));
  if (server.exitCode === null) server.kill('SIGKILL');
  fs.writeFileSync(path.join(output, 'server.log'), redact(serverLog));
  const safeReport = JSON.stringify(report, (_key, value) => typeof value === 'string' ? redact(value) : value, 2);
  fs.writeFileSync(path.join(output, 'result.json'), safeReport);
  console.log(safeReport);
}
