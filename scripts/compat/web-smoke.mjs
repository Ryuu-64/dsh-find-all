// Real official Web-host bootstrap acceptance using only a temporary empty profile.
// This does not claim the synthetic-history or Desktop layers have passed.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

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
for (const dir of [discovery, runtime, home]) fs.mkdirSync(dir, { recursive: true });
const manifest = { name: 'find-all-synthetic-acceptance', private: true, type: 'module', dependencies: { '@deepseek-ai/dsh': version } };
const env = { ...process.env, HOME: home, npm_config_ignore_scripts: 'true' };
function npmInstall(dir, filename) {
  const log = fs.openSync(path.join(output, filename), 'w');
  try { execFileSync('npm', ['install', '--ignore-scripts', '--strict-peer-deps', '--no-audit', '--no-fund'], { cwd: dir, env, stdio: ['ignore', log, log], timeout: 600_000 }); }
  finally { fs.closeSync(log); }
}
// Published caret dependencies can silently select another prerelease. Discover
// the official graph, then install in a fresh directory with all DSH pins exact.
fs.writeFileSync(path.join(discovery, 'package.json'), JSON.stringify(manifest));
npmInstall(discovery, 'discovery-install.log');
const lock = JSON.parse(fs.readFileSync(path.join(discovery, 'package-lock.json')));
const names = [...new Set(Object.keys(lock.packages).map(key => key.split('node_modules/').at(-1)).filter(name => name.startsWith('@deepseek-ai/dsh-')))];
manifest.overrides = Object.fromEntries(names.map(name => [name, version]));
fs.writeFileSync(path.join(runtime, 'package.json'), JSON.stringify(manifest));
npmInstall(runtime, 'exact-install.log');
const runtimeRequire = createRequire(path.join(runtime, 'node_modules/@deepseek-ai/dsh/package.json'));
const observed = {};
for (const name of ['dsh', ...names]) {
  const packageName = name.startsWith('@') ? name : `@deepseek-ai/${name}`;
  const file = runtimeRequire.resolve(`${packageName}/package.json`);
  observed[packageName] = JSON.parse(fs.readFileSync(file)).version;
  assert.equal(observed[packageName], version, `version drift: ${packageName}`);
}
fs.writeFileSync(path.join(output, 'host-versions.json'), JSON.stringify(observed, null, 2));
const bin = runtimeRequire.resolve('@deepseek-ai/dsh/package.json').replace(/package.json$/, 'lib/bin.js');
const installLog = fs.openSync(path.join(output, 'plugin-install.log'), 'w');
try {
  execFileSync(process.execPath, [bin, 'plugin', '--profile', 'web', 'add', artifact, '--ignore-scripts'], { cwd: runtime, env, stdio: ['ignore', installLog, installLog], timeout: 300_000 });
} finally { fs.closeSync(installLog); }
assert.equal(hash(), artifactSha256);
let serverLog = '';
const server = spawn(process.execPath, [bin, '--profile', 'web', '--no-open', '--host', '127.0.0.1', '--port', '4195'], { cwd: runtime, env });
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
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url, { waitUntil: 'networkidle' });
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
  report.browserErrors = errors;
  assert.deepEqual(errors, [], 'unhandled browser errors');
} catch (error) {
  report.bootstrap = 'failed';
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
