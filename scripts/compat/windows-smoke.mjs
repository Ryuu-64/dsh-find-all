// Installed Electron acceptance for the exact current release. This does not
// qualify other Desktop releases. Only synthetic profile/history data is used.
// Usage: node scripts/compat/windows-smoke.mjs <candidate.tgz> <evidence-directory>
// First run install-windows.ps1 with that same fresh evidence directory.
//
// Official dsh-v0.2.0-rc.2 sources: apps/desktop/README.md, src/paths.ts,
// src/main.ts, src/runtime-tree.ts, src/welcome-window.ts, src/client/WelcomePage.tsx,
// scripts/electron-builder-config.mjs, plus the supplied official English
// welcome/API-key text snapshots.
// Playwright 1.56.1's Windows Electron launcher adds --inspect=0 and
// --remote-debugging-port=0. It adds no sandbox-disabling flag on Windows.
// A fuse/policy that disallows inspection is a failure, never patched around.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { setFixturePatch, exerciseHistory, exerciseSidebarIsolation } from './synthetic-history.mjs';
import { workspaceControlsVisible } from './desktop-readiness.mjs';
import { classifyDesktopConsole } from './desktop-console.mjs';
import { runOwnedCommand } from './owned-command.mjs';
import { startDiagnostics } from './windows-diagnostics.mjs';
let electron;
import { createRedactor, captureSafePage } from './evidence.mjs';

const [artifactArg, outputArg, requestedVersion] = process.argv.slice(2);
assert.ok(artifactArg && outputArg, 'usage: windows-smoke.mjs <candidate.tgz> <evidence-directory>');
const artifact = path.resolve(artifactArg);
const output = path.resolve(outputArg);
fs.mkdirSync(output, { recursive: true });
const resultPath = path.join(output, 'desktop-result.json');
assert.ok(!fs.existsSync(resultPath), 'use a fresh Desktop evidence directory');
const targets = JSON.parse(fs.readFileSync(new URL('./desktop-targets.json', import.meta.url), 'utf8'));
const version = requestedVersion || '0.2.0-rc.2';
assert.ok(Object.hasOwn(targets, version), 'only exact researched Desktop versions are allowed');
const target = targets[version];
const packageName = '@ryuu-64/dsh-find-all';
const secrets = new Set();
const basicRedact = createRedactor(secrets);
function redact(value) {
  return basicRedact(value)
    .replace(/wss?:\/\/[^\s<>"']+/gi, '[redacted debugger endpoint]')
    .replace(/\b(?:sk-|dsh_)[A-Za-z0-9_.-]{12,}/g, '[redacted credential]')
    .replace(/((?:["']?)(?:token|api[_ -]?key|credential|authorization|cookie|password|secret)(?:["']?)\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi, '$1[redacted]');
}
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const report = {
  schemaVersion: 1, target: 'windows-x64-installed-electron', version,
  sourceTag: `dsh-v${version}`, status: 'pending', stage: 'preflight',
  bootstrap: 'not-run', emptySessionFind: 'not-run', syntheticHistory: 'not-run',
  desktopReleaseMatrix: 'not-run', browserErrors: [], consoleErrors: [], consoleEvents: [], networkFailures: [],
  testedScope: [],
  intendedScope: [
    'valid signed official rc2 installer and installed executable',
    'real packaged Electron identity and sandboxed renderer preferences',
    'fresh Desktop profile initialized through keyless welcome',
    'same candidate tgz installed using the official bundled Desktop CLI with --ignore-scripts',
    'actual loaded plugin CSS and Ctrl+F empty-session bar, Page scope 0/0, Esc cleanup, repeated open/close',
    'actual synthetic history search, paging, A/B/A switching and native hot unload/re-enable',
    'main/sidebar instance isolation in the installed Electron renderer',
    'clean application shutdown before plugin installation and after testing',
  ],
  excludedScope: ['other Desktop versions', 'physical OS keyboard input'],
};
function setStage(stage) {
  report.stage = stage;
  console.log(`[desktop-stage] ${new Date().toISOString()} ${stage}`);
}
const heartbeat = setInterval(() => console.log(`[desktop-progress] ${new Date().toISOString()} ${report.stage}`), 15_000);
heartbeat.unref();
let app, page, env, installation, diagnostics, playwrightLog;
let appOutput = '';
const chromiumLogs = [];
const children = new Set();
const observedPages = new WeakSet();
let observedPageCount = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function stopOwnedProcessTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  await new Promise(resolve => {
    // Windows child.kill() kills only cmd.exe/pwsh.exe, leaving its Electron
    // children alive. Limit cleanup to the exact process tree we created.
    const cleanup = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => { cleanup.kill(); resolve(); }, 10_000);
    const done = () => { clearTimeout(timer); resolve(); };
    cleanup.once('error', done);
    cleanup.once('close', done);
  });
}
// A failed instrumented launch is not proof that the installed application
// cannot start normally. Collect one bounded, non-interactive baseline only;
// it does not satisfy any UI acceptance gate and changes no security setting.
async function diagnoseNormalLaunch({ mode = 'normal-same-environment-and-profile', environment = env, useUserDataDir = true } = {}) {
  const file = path.join(installation.runDirectory, `electron-${mode}.log`);
  chromiumLogs.push(file);
  report.launches ??= [];
  const launchRecord = { mode, startUtc: new Date().toISOString() };
  report.launches.push(launchRecord);
  const args = ['--lang=en-US', '--enable-logging=file', `--log-file=${file}`];
  if (useUserDataDir) args.push(`--user-data-dir=${installation.testUserData}`);
  const child = spawn(installation.executable, args, {
    cwd: installation.runDirectory, env: environment, stdio: ['ignore', 'pipe', 'pipe'],
  });
  launchRecord.pid = child.pid;
  children.add(child);
  let text = '';
  child.stdout.on('data', data => { text += data.toString(); });
  child.stderr.on('data', data => { text += data.toString(); });
  let timer;
  try {
    launchRecord.outcome = await Promise.race([
      new Promise(resolve => {
        child.once('error', error => resolve({ outcome: 'launch-error', error: redact(error.message) }));
        child.once('exit', (code, signal) => resolve({ outcome: 'exited', code, signal }));
      }),
      new Promise(resolve => { timer = setTimeout(() => resolve({ outcome: 'still-running-after-15s', uiAcceptance: 'not-tested' }), 15_000); }),
    ]);
  } finally {
    clearTimeout(timer);
    await stopOwnedProcessTree(child);
    children.delete(child);
    writeSafe(`desktop-${mode}.log`, text);
  }
  return launchRecord.outcome;
}
async function until(check, message, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  do {
    const result = await check();
    if (result) return result;
    await sleep(200);
  } while (Date.now() < deadline);
  throw new Error(message);
}
function writeSafe(name, value) { fs.writeFileSync(path.join(output, name), redact(value)); }
function attachPage(candidate) {
  if (observedPages.has(candidate)) return;
  observedPages.add(candidate);
  const pageId = ++observedPageCount;
  const launchRecord = report.launches.at(-1);
  candidate.setDefaultTimeout(30_000);
  candidate.on('pageerror', error => report.browserErrors.push(redact(error.message)));
  candidate.on('console', message => {
    if (message.type() !== 'error') return;
    const text = redact(message.text());
    const location = message.location();
    report.consoleErrors.push(text.slice(0, 4000));
    report.consoleEvents.push({ utc: new Date().toISOString(), phase: launchRecord.phase,
      launchUtc: launchRecord.startUtc, pageId, locationRoute: route(location.url), exactHmrLocation: location.url === 'dsh-app://app/plugins/events', stage: report.stage, text: text.slice(0, 4000), truncated: text.length > 4000 });
  });
  function route(value) {
    if (!value) return undefined;
    let url;
    try { url = new URL(value); } catch { return undefined; }
    return redact(`${url.protocol}//${url.hostname}${url.port ? ':' + url.port : ''}${url.pathname}`).slice(0, 2000);
  }
  candidate.on('requestfailed', request => {
    if (report.networkFailures.length < 100) report.networkFailures.push({ utc: new Date().toISOString(),
      phase: launchRecord.phase, launchUtc: launchRecord.startUtc, pageId, route: route(request.url()),
      exactHmrUrl: request.url() === 'dsh-app://app/plugins/events', resourceType: request.resourceType(), error: redact(request.failure()?.errorText || '') });
  });
  candidate.on('response', response => {
    if (response.status() >= 400 && report.networkFailures.length < 100) report.networkFailures.push({ utc: new Date().toISOString(),
      phase: launchRecord.phase, launchUtc: launchRecord.startUtc, pageId, route: route(response.url()), status: response.status() });
  });
  // Do not dismiss/accept unknown dialogs, permissions, or agreements.
  candidate.on('dialog', dialog => {
    report.browserErrors.push(`Unexpected ${dialog.type()} dialog; review required (not accepted)`);
  });
}
async function loadPlaywright() {
  if (!electron) {
    // Capture launch output before launch() can throw. Playwright 1.56.1's
    // lib/server/utils/debugLogger.js routes DEBUG_FILE outside public artifacts.
    playwrightLog = path.join(installation.runDirectory, 'playwright-early.log');
    process.env.DEBUG = 'pw:browser';
    process.env.DEBUG_FILE = playwrightLog;
    ({ _electron: electron } = await import('playwright'));
  }
}
async function launch() {
  // Electron documents file logging for Windows child-process diagnostics:
  // https://www.electronjs.org/docs/latest/api/command-line-switches#--enable-loggingfile
  const chromiumLog = path.join(installation.runDirectory, `electron-${chromiumLogs.length + 1}.log`);
  chromiumLogs.push(chromiumLog);
  await loadPlaywright();
  report.launches ??= [];
  report.launches.push({ mode: 'instrumented', startUtc: new Date().toISOString(), phase: 'running' });
  app = await electron.launch({
    executablePath: installation.executable, cwd: installation.runDirectory,
    env, args: ['--lang=en-US', `--user-data-dir=${installation.testUserData}`, '--enable-logging=file', `--log-file=${chromiumLog}`], timeout: 120_000,
  });
  report.launches.at(-1).launcherPid = app.process().pid;
  app.process().stdout?.on('data', data => { appOutput += data.toString(); });
  app.process().stderr?.on('data', data => { appOutput += data.toString(); });
  app.on('window', attachPage);
  for (const candidate of app.windows()) attachPage(candidate);
  const identity = await app.evaluate(({ app }) => ({
      name: app.name, version: app.getVersion(), packaged: app.isPackaged,
      platform: process.platform, arch: process.arch, electron: process.versions.electron,
      node: process.versions.node,
      executable: process.execPath, userData: app.getPath('userData'),
      dshHome: process.env.DSH_HOME,
  }));
  report.appIdentity = identity;
  const resources = await app.evaluate(({ app }) => {
    // A serialized Playwright evaluation has no dynamic-import callback.
    // Node's documented getBuiltinModule works without import/require scope.
    // https://nodejs.org/api/process.html#processgetbuiltinmoduleid
    if (typeof process.getBuiltinModule !== 'function') throw new Error('Installed Electron Node lacks getBuiltinModule; resource identity remains unverified');
    const { readFileSync } = process.getBuiltinModule('fs');
    const { join } = process.getBuiltinModule('path');
    const manifest = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8'));
    // runtime-tree.ts defines this descriptor at the immutable dsh tree root.
    const runtime = JSON.parse(readFileSync(join(app.getAppPath(), 'dsh', 'desktop-runtime.json'), 'utf8'));
    return {
      packageName: manifest.name, runtimeRoot: join(app.getAppPath(), 'dsh'),
      runtimeDescriptor: {
        schemaVersion: runtime.schemaVersion, version: runtime.release.version,
        platform: runtime.platform, arch: runtime.arch,
        nodeVersion: runtime.release.nodeVersion, pnpmVersion: runtime.release.pnpmVersion,
      },
    };
  });
  Object.assign(identity, resources);
  assert.equal(identity.version, version);
  assert.equal(identity.packaged, true, 'must test the installed release, not a development Electron wrapper');
  assert.equal(identity.platform, 'win32');
  assert.equal(identity.arch, 'x64');
  assert.equal(identity.packageName, '@deepseek-ai/dsh-desktop');
  assert.equal(identity.runtimeDescriptor.schemaVersion, 1);
  assert.equal(identity.runtimeDescriptor.version, version, 'bundled runtime must match the Desktop release');
  assert.equal(identity.runtimeDescriptor.platform, 'win32');
  assert.equal(identity.runtimeDescriptor.arch, 'x64');
  assert.equal(path.resolve(identity.executable).toLowerCase(), installation.executable.toLowerCase());
  assert.equal(identity.dshHome, env.DSH_HOME);
  assert.equal(path.resolve(identity.userData).toLowerCase(), path.resolve(installation.testUserData).toLowerCase(), 'documented user-data-dir must isolate the Electron profile');
  report.appIdentity = identity;
  if (!report.testedScope.includes('installed Electron identity')) report.testedScope.push('installed Electron identity');
  return app;
}
async function keylessWelcome() {
  const welcome = await until(async () => {
    for (const candidate of app.windows()) {
      if (await candidate.getByRole('button', { name: 'Add API Key', exact: true }).isVisible()) return candidate;
    }
    return null;
  }, 'Expected rc2 keyless Welcome was not reached; review any update, agreement, permission, or startup blocker', 120_000);
  page = welcome;
  assert.equal(await welcome.getByRole('checkbox').count(), 0, 'unexpected welcome consent control');
  await welcome.getByRole('button', { name: 'Add API Key', exact: true }).click();
  const skip = welcome.getByRole('button', { name: 'Set up later', exact: true });
  await skip.waitFor();
  assert.equal(await welcome.locator('input[type="password"]').inputValue(), '', 'no API credential is supplied');
  assert.equal(await welcome.getByRole('checkbox').count(), 0, 'unexpected API-key agreement control');
  await skip.click();
  page = await until(async () => {
    for (const candidate of app.windows()) {
      if (candidate.url().startsWith('dsh-app://app/')) {
        const window = await app.browserWindow(candidate);
        if (await window.evaluate(window => window.isVisible())) return candidate;
      }
    }
    return null;
  }, 'Packaged workspace did not open after the explicit keyless choice');
  await page.waitForLoadState('domcontentloaded');
  const window = await app.browserWindow(page);
  const security = await window.evaluate(window => {
    const preferences = window.webContents.getLastWebPreferences();
    return { sandbox: preferences.sandbox, contextIsolation: preferences.contextIsolation,
      nodeIntegration: preferences.nodeIntegration, webSecurity: preferences.webSecurity };
  });
  assert.deepEqual(security, { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true });
  report.rendererSecurity = security;
  if (!report.testedScope.includes('keyless welcome and renderer security')) report.testedScope.push('keyless welcome and renderer security');
}
async function finishKnownOnboarding({ pluginExpected = true } = {}) {
  // Only the exact non-binding notice already inspected in the official Web
  // fixture is eligible. Never click a generic Continue/Accept in another modal.
  const notice = page.getByText(/^(Internal Testing Notice|Preview Notice)$/);
  const configureLater = page.getByRole('button', { name: 'Configure later', exact: true });
  let readySince;
  await until(async () => {
    if (await notice.isVisible()) {
      readySince = undefined;
      assert.equal(await page.getByRole('checkbox').count(), 0, 'unexpected consent control');
      const dialogs = page.getByRole('dialog');
      const body = await (await dialogs.count() === 1 ? dialogs : page.locator('body')).innerText();
      assert.doesNotMatch(body, /terms of (?:use|service)|license agreement|\bI agree\b|隐私协议|用户协议/i, 'unreviewed legal agreement');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await notice.waitFor({ state: 'hidden' });
      return false;
    }
    if (await configureLater.isVisible()) {
      readySince = undefined;
      await configureLater.click();
      await configureLater.waitFor({ state: 'hidden' });
      return false;
    }
    // SidebarRoot renders both the expanded brand shortcut and the ordinary
    // New session control with this exact aria-label (official rc2 lines 244–276).
    // This is a readiness read, not an action choosing one of those buttons.
    if (!await workspaceControlsVisible(page)) { readySince = undefined; return false; }
    if (pluginExpected && !await page.locator('style[data-plugin-css="dsh-find-all/bar.css"]').count()) return false;
    // CSS can load before a React first-run dialog mounts. Require a short
    // stable interval and reset it after each recognized prompt.
    readySince ??= Date.now();
    return Date.now() - readySince >= 2000;
  }, 'Workspace onboarding or plugin loading did not finish; no unknown prompts were accepted');
}
async function quit() {
  if (!app) return;
  const closing = app;
  const launchRecord = report.launches.at(-1);
  launchRecord.phase = 'closing';
  launchRecord.closingUtc = new Date().toISOString();
  let timer;
  try {
    await Promise.race([
      closing.close(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Desktop did not quit cleanly; plugin installation is not safe')), 30_000); }),
    ]);
    app = undefined;
    page = undefined;
    launchRecord.phase = 'closed';
    launchRecord.closedUtc = new Date().toISOString();
  } finally { clearTimeout(timer); }
}
async function runCli(args, logName) {
  // Windows .cmd files need cmd.exe. PowerShell's call operator preserves each
  // path as one argument, avoiding shell interpolation of the tgz name.
  const quote = value => `'${String(value).replaceAll("'", "''")}'`;
  const command = `& ${quote(installation.bundledCli)} ${args.map(quote).join(' ')}; exit $LASTEXITCODE`;
  await new Promise((resolve, reject) => {
    const child = spawn('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      cwd: installation.runDirectory, env, windowsHide: true,
    });
    children.add(child);
    let text = '';
    const collect = data => { text += data.toString(); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    const timer = setTimeout(() => {
      void stopOwnedProcessTree(child).finally(() => reject(new Error('Official bundled CLI timed out; do not reopen or mutate the profile')));
    }, 300_000);
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer); children.delete(child); writeSafe(logName, text);
      if (code === 0) resolve();
      else reject(new Error(`Official bundled CLI failed (${code}); see ${logName}`));
    });
  });
}
try {
  assert.equal(process.platform, 'win32', 'real Windows is required; no emulation or sandbox fallback');
  assert.equal(process.arch, 'x64');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted', 'only a disposable hosted runner is authorized');
  assert.ok(process.env.USERPROFILE && process.env.RUNNER_TEMP);
  assert.ok(artifact.endsWith('.tgz') && fs.statSync(artifact).isFile(), 'supply the same candidate tgz as Web acceptance');
  report.runner = { osRelease: os.release(), imageOS: process.env.ImageOS, imageVersion: process.env.ImageVersion };
  report.artifactSha256 = hash(artifact);
  installation = JSON.parse(fs.readFileSync(path.join(output, 'installer.json'), 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(installation.status, 'passed', 'installer verification must pass before launch');
  assert.equal(installation.version, version);
  assert.equal(installation.sourceUrl, target.url);
  assert.equal(installation.installerBytes, target.bytes);
  assert.equal(installation.signature.status, 'Valid');
  assert.equal(installation.appSignature.status, 'Valid');
  const runnerTemp = path.resolve(process.env.RUNNER_TEMP).toLowerCase() + path.sep;
  assert.ok(path.resolve(installation.runDirectory).toLowerCase().startsWith(runnerTemp));
  assert.equal(installation.executable, path.join(installation.installDirectory, 'DeepSeek Harness.exe'));
  assert.equal(installation.bundledCli, path.join(installation.installDirectory, 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'));
  assert.equal(hash(installation.installer), installation.installerSha256, 'installer changed after verification');
  assert.equal(hash(installation.executable), installation.executableSha256, 'installed executable changed after verification');
  report.installer = { sha256: installation.installerSha256, bytes: installation.installerBytes,
    fileVersion: installation.fileVersion, productVersion: installation.productVersion,
    signature: installation.signature, appSignature: installation.appSignature };
  report.testedScope.push('verified installer and installed executable evidence; unchanged SHA256');
  const home = path.join(installation.runDirectory, 'synthetic-home');
  assert.ok(!fs.existsSync(home), 'the smoke requires a new empty synthetic home');
  fs.mkdirSync(home);
  env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(?:DSH_|ELECTRON_|NODE_OPTIONS$|DEBUG(?:_FILE)?$|PWDEBUG$|NPM_CONFIG_|npm_config_)/i.test(key) || /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key)) delete env[key];
  }
  Object.assign(env, {
    HOME: home, DSH_HOME: path.join(home, '.dsh'),
    DSH_AGENTS_HOME: path.join(home, '.agents'),
    // Official rc2 apps/cli/reference/README.zh.md documents this OTel opt-out;
    // packages/bundle/base/cordis.patch.yml reads it, and Desktop's official
    // tests/welcome-flow.e2e.ts uses DISABLED for its temporary-home fixture.
    // This is not a claim that unrelated product analytics are disabled.
    DSH_TELEMETRY_MODE: 'DISABLED',
    // Official rc2 main.ts writes startup errors here before the fatal dialog.
    DSH_DESKTOP_DIAGNOSTIC_FILE: path.join(installation.runDirectory, 'official-main-diagnostic.log'),
    npm_config_ignore_scripts: 'true', npm_config_userconfig: path.join(home, '.npmrc'),
    npm_config_registry: 'https://registry.npmjs.org', npm_config_cache: path.join(home, 'npm-cache'),
  });
  fs.writeFileSync(path.join(home, '.npmrc'), 'ignore-scripts=true\nregistry=https://registry.npmjs.org/\n');
  installation.testUserData = path.join(installation.runDirectory, 'electron-user-data');
  report.isolation = 'real disposable-runner USERPROFILE retained; fresh DSH_HOME and explicit user-data-dir; no inherited model credentials';
  setStage('readiness-dom-regression');
  // Preserve DEBUG_FILE initialization before the fixture first loads Playwright.
  await loadPlaywright();
  const { verifyDesktopReadinessFixture } = await import('./desktop-readiness-fixture.mjs');
  report.readinessFixture = await verifyDesktopReadinessFixture();
  setStage('prepare-startup-diagnostics');
  diagnostics = await startDiagnostics(installation, env, redact);
  // Controlled reproduction of the user report: same executable, DSH_HOME,
  // HOME, cwd and default native appData path; only USERPROFILE changes.
  // Both profiles belong to this new hosted runner, never a user's desktop.
  const comparisonEnv = { ...env, DSH_HOME: path.join(home, 'comparison-dsh'), DSH_AGENTS_HOME: path.join(home, 'comparison-agents') };
  if (version === '0.2.0-rc.2') {
    report.profileEnvironmentComparison = {
      changedVariable: 'USERPROFILE', userDataOverride: false,
      temporary: await diagnoseNormalLaunch({ mode: 'temporary-userprofile', environment: { ...comparisonEnv, USERPROFILE: home }, useUserDataDir: false }),
      original: await diagnoseNormalLaunch({ mode: 'original-userprofile', environment: comparisonEnv, useUserDataDir: false }),
      limitation: 'Process survival is a startup diagnostic, not Desktop UI acceptance; the actual smoke below uses its own explicit user-data-dir.',
    };
  } else report.profileEnvironmentComparison = { status: 'not-repeated', reason: 'the deliberate temporary-USERPROFILE crash control was already established on rc2; this case preserves the real runner USERPROFILE' };
  report.diagnosticCollector = diagnostics.ready;
  setStage('initialize-desktop-profile');
  await launch();
  await keylessWelcome();
  // DOMContentLoaded is earlier than client-module activation. Finish the
  // actual shell/onboarding before deliberately closing its backend to install.
  await finishKnownOnboarding({ pluginExpected: false });
  assert.ok(fs.existsSync(path.join(env.DSH_HOME, 'profiles', 'desktop', 'package.json')), 'Desktop must initialize its own profile');
  await quit();
  report.profileInitialization = 'passed';
  report.testedScope.push('fresh Desktop profile initialization and clean exit');
  setStage('install-plugin-with-bundled-cli');
  await runCli(['plugin', '--profile', 'desktop', 'add', artifact, '--ignore-scripts'], 'desktop-plugin-install.log');
  assert.equal(hash(artifact), report.artifactSha256, 'the shared candidate changed during installation');
  const profile = path.join(env.DSH_HOME, 'profiles', 'desktop');
  const plugin = JSON.parse(fs.readFileSync(path.join(profile, 'node_modules', '@ryuu-64', 'dsh-find-all', 'package.json'), 'utf8'));
  assert.equal(plugin.name, packageName);
  report.installedPlugin = { name: plugin.name, version: plugin.version };
  report.testedScope.push('same candidate tgz installed through bundled Desktop CLI with --ignore-scripts');
  setStage('reopen-installed-plugin');
  await launch();
  await keylessWelcome(); // The official skip choice applies to this launch only.
  await finishKnownOnboarding();
  assert.equal(await page.locator('style[data-plugin-css="dsh-find-all/bar.css"]').count(), 1);
  report.bootstrap = 'passed';
  report.testedScope.push('actual plugin CSS loaded after packaged application restart');
  setStage('empty-session-find');
  const bar = page.locator('#dsh-find-all-root');
  for (let cycle = 1; cycle <= 2; cycle++) {
    await page.bringToFront();
    await page.keyboard.press('Control+f');
    await bar.waitFor({ state: 'visible' });
    assert.equal(await bar.count(), 1, 'repeated shortcut must not duplicate the bar');
    if (cycle === 1) await bar.locator('.scope').click();
    await bar.locator('input').fill('FIND_ALL_EMPTY_DESKTOP_NEEDLE');
    await until(async () => (await bar.locator('.count').innerText()) === '0/0', 'empty synthetic profile should report 0/0');
    report.initialSessionViews = await page.locator('[data-find-all-session]').count();
    assert.equal(report.initialSessionViews, 0, 'this bounded fixture must remain session-free');
    assert.ok((await bar.locator('.status').innerText()).length > 0, 'empty session should explain why search is unavailable');
    if (cycle === 1) report.findScreenshot = await captureSafePage(page, path.join(output, 'desktop-empty-session-find'), secrets, redact);
    await page.keyboard.press('Escape');
    await bar.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => CSS.highlights?.has('dsh-find-all-hit') || CSS.highlights?.has('dsh-find-all-cur') || false), false);
  }
  report.emptySessionFind = 'passed';
  report.testedScope.push('two Ctrl+F/Esc cycles, empty-session Page scope 0/0, no highlight residue');
  await quit();
  setStage('seed-synthetic-desktop-history');
  const workspace = path.join(home, 'synthetic-workspace');
  const queryPath = path.join(home, 'desktop-query.sqlite');
  const seedScript = fileURLToPath(new URL('./desktop-seed-history.mjs', import.meta.url));
  const seedOutput = await new Promise((resolve, reject) => {
    const child = spawn(installation.executable, [seedScript, report.appIdentity.runtimeRoot, home, workspace, version], {
      cwd: installation.runDirectory, env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.add(child);
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data.toString(); });
    child.stderr.on('data', data => { stderr += data.toString(); });
    const timer = setTimeout(() => { void stopOwnedProcessTree(child); reject(new Error('Installed-runtime history seeding timed out')); }, 60_000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      writeSafe('desktop-seed.log', stdout + '\n' + stderr);
      if (code === 0) resolve(stdout); else reject(new Error(`Installed-runtime history seeding failed (${code}); see desktop-seed.log`));
    });
  });
  report.seededHistory = JSON.parse(seedOutput.trim().split('\n').at(-1));
  assert.equal(report.seededHistory.status, 'passed');
  setFixturePatch(home, queryPath, false, 'desktop');
  setStage('desktop-history-and-lifecycle');
  await launch();
  await keylessWelcome();
  await finishKnownOnboarding();
  const capture = name => captureSafePage(page, path.join(output, `desktop-${name}`), secrets, redact);
  report.historyEvidence = await exerciseHistory(page, home, queryPath, capture, version, 'desktop');
  report.syntheticHistory = 'passed';
  report.sidebarIsolation = target.sidebar
    ? await exerciseSidebarIsolation(page, home, queryPath, capture, 'desktop')
    : { status: 'not-run', reason: 'additional embedded-sidebar fixture is scoped to the researched current rc2 layout' };
  report.testedScope.push('installed Electron: first body Ctrl+F, 80-match paging, A/B/A, F3/Shift+F3, two native unload/re-enable cycles');
  if (target.sidebar) report.testedScope.push('real embedded sidebar isolation');
  await quit();
  report.cleanShutdown = 'passed';
  assert.deepEqual(report.browserErrors, [], 'unhandled browser errors');
  // Preserve all raw errors; only the documented, exactly correlated intentional
  // shutdown of the HMR EventSource can be classified as expected teardown.
  report.consoleClassification = classifyDesktopConsole(report);
  assert.deepEqual(report.consoleClassification.unexpected, [], 'unexpected browser console errors');
  report.status = 'passed';
  setStage('complete');
} catch (error) {
  report.status = 'failed';
  report.error = redact(error instanceof Error ? error.message : error);
  report.errorStack = error instanceof Error ? redact(error.stack || '') : undefined;
  if (report.stage === 'initialize-desktop-profile' && !app && installation && env) {
    try { report.normalLaunchDiagnostic = await diagnoseNormalLaunch(); }
    catch (diagnosticError) { report.normalLaunchDiagnostic = { error: redact(diagnosticError.message) }; }
  }
  if (page && !page.isClosed()) {
    try { report.failureScreenshot = await captureSafePage(page, path.join(output, 'desktop-failure'), secrets, redact); }
    catch { report.failureScreenshot = 'unavailable'; }
  }
  process.exitCode = 1;
} finally {
  try { await quit(); }
  catch (error) {
    report.status = 'failed'; report.shutdownError = redact(error.message); process.exitCode = 1;
    // Stop only this test's owned process, never any unrelated installed app.
    await stopOwnedProcessTree(app?.process());
  }
  for (const child of children) await stopOwnedProcessTree(child);
  if (diagnostics) {
    try { report.diagnostics = await diagnostics.finish(output, report.appIdentity?.userData); }
    catch (error) {
      report.diagnostics = { error: redact(error.message), stack: redact(error.stack || '') };
      report.status = 'failed'; process.exitCode = 1;
    }
  }
  writeSafe('desktop-process.log', appOutput);
  if (playwrightLog && fs.existsSync(playwrightLog)) writeSafe('playwright-early.log', fs.readFileSync(playwrightLog, 'utf8'));
  report.nativeStartupErrors = [];
  for (const file of chromiumLogs) {
    if (!fs.existsSync(file)) continue;
    const contents = fs.readFileSync(file, 'utf8');
    writeSafe(path.basename(file), contents);
    // Electron can emit bootstrap failures before Playwright has a Page to
    // subscribe to. Keep the known raw failure visible and failing separately.
    for (const [index, line] of contents.split('\n').entries()) {
      if (/sandboxed_renderer\.bundle\.js script failed to run|Cannot destructure property 'preloadScripts'/.test(line)) {
        report.nativeStartupErrors.push({ file: path.basename(file), line: index + 1, text: redact(line) });
      }
    }
  }
  if (report.nativeStartupErrors.length) {
    report.status = 'failed'; process.exitCode = 1;
    report.nativeStartupErrorGate = 'failed: Electron bootstrap error; root cause not established';
  }
  clearInterval(heartbeat);
  const json = JSON.stringify(report, (_key, value) => typeof value === 'string' ? redact(value) : value, 2);
  fs.writeFileSync(resultPath, json);
  console.log(json);
}

// The workflow invokes the current version once. Explicit version arguments are
// child cases and never recurse. Every failure remains a failure while later
// independently installed versions can still provide useful acceptance evidence.
if (!requestedVersion) {
  const { runHistoricalDesktopCases } = await import('./desktop-matrix.mjs');
  const matrix = await runHistoricalDesktopCases({
    artifact, output, currentReport: report, installation,
    save(file, value) { fs.writeFileSync(file, JSON.stringify(value, (_key, item) => typeof item === 'string' ? redact(item) : item, 2)); },
    async run(executable, args, log, timeoutMs) {
      console.log(`[desktop-matrix] ${new Date().toISOString()} ${path.basename(log)}`);
      const childEnv = { ...process.env };
      delete childEnv.DEBUG; delete childEnv.DEBUG_FILE; delete childEnv.PWDEBUG;
      return runOwnedCommand(executable, args, {
        env: childEnv, timeoutMs, stop: stopOwnedProcessTree,
        capture: text => writeSafe(path.relative(output, log), text),
      });
    },
  });
  if (matrix.status !== 'passed') process.exitCode = 1;
  console.log(JSON.stringify(matrix));
}
