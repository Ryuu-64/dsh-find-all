// Bounded installed Electron acceptance. This deliberately does NOT seed history
// or qualify the six-release Desktop matrix. Only synthetic empty-profile data.
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
import { _electron as electron } from 'playwright';
import { createRedactor, captureSafePage } from './evidence.mjs';

const [artifactArg, outputArg] = process.argv.slice(2);
assert.ok(artifactArg && outputArg, 'usage: windows-smoke.mjs <candidate.tgz> <evidence-directory>');
const artifact = path.resolve(artifactArg);
const output = path.resolve(outputArg);
fs.mkdirSync(output, { recursive: true });
const resultPath = path.join(output, 'desktop-result.json');
assert.ok(!fs.existsSync(resultPath), 'use a fresh Desktop evidence directory');
const version = '0.2.0-rc.2';
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
  sourceTag: 'dsh-v0.2.0-rc.2', status: 'pending', stage: 'preflight',
  bootstrap: 'not-run', emptySessionFind: 'not-run', syntheticHistory: 'not-run',
  desktopReleaseMatrix: 'not-run', browserErrors: [], consoleErrors: [],
  testedScope: [],
  intendedScope: [
    'valid signed official rc2 installer and installed executable',
    'real packaged Electron identity and sandboxed renderer preferences',
    'fresh Desktop profile initialized through keyless welcome',
    'same candidate tgz installed using the official bundled Desktop CLI with --ignore-scripts',
    'actual loaded plugin CSS and Ctrl+F empty-session bar, Page scope 0/0, Esc cleanup, repeated open/close',
    'clean application shutdown before plugin installation and after testing',
  ],
  excludedScope: ['conversation search', 'history paging', 'session switching', 'plugin hot lifecycle', 'other Desktop versions', 'physical OS keyboard input'],
};
let app, page, env, installation;
let appOutput = '';
const children = new Set();
const observedPages = new WeakSet();
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
  candidate.setDefaultTimeout(30_000);
  candidate.on('pageerror', error => report.browserErrors.push(redact(error.message)));
  candidate.on('console', message => {
    if (message.type() === 'error') report.consoleErrors.push(redact(message.text()));
  });
  // Do not dismiss/accept unknown dialogs, permissions, or agreements.
  candidate.on('dialog', dialog => {
    report.browserErrors.push(`Unexpected ${dialog.type()} dialog; review required (not accepted)`);
  });
}
async function launch() {
  app = await electron.launch({
    executablePath: installation.executable, cwd: installation.runDirectory,
    env, args: ['--lang=en-US'], timeout: 120_000,
  });
  app.process().stdout?.on('data', data => { appOutput += data.toString(); });
  app.process().stderr?.on('data', data => { appOutput += data.toString(); });
  app.on('window', attachPage);
  for (const candidate of app.windows()) attachPage(candidate);
  const identity = await app.evaluate(async ({ app }) => {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const manifest = JSON.parse(await readFile(join(app.getAppPath(), 'package.json'), 'utf8'));
    // runtime-tree.ts defines this descriptor at the immutable dsh tree root.
    // Read the release binding rather than infer it from a project manifest.
    const runtime = JSON.parse(await readFile(join(app.getAppPath(), 'dsh', 'desktop-runtime.json'), 'utf8'));
    return {
      name: app.name, version: app.getVersion(), packaged: app.isPackaged,
      platform: process.platform, arch: process.arch, electron: process.versions.electron,
      executable: process.execPath, userData: app.getPath('userData'),
      dshHome: process.env.DSH_HOME, packageName: manifest.name,
      runtimeDescriptor: {
        schemaVersion: runtime.schemaVersion, version: runtime.release.version,
        platform: runtime.platform, arch: runtime.arch,
        nodeVersion: runtime.release.nodeVersion, pnpmVersion: runtime.release.pnpmVersion,
      },
    };
  });
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
  // Electron userData stays in the disposable hosted-runner profile. Do not use
  // undocumented packaged overrides or inject an app.setPath startup shim.
  const runnerProfile = path.resolve(process.env.USERPROFILE).toLowerCase() + path.sep;
  const temporaryProfile = path.resolve(installation.runDirectory).toLowerCase() + path.sep;
  const actualUserData = path.resolve(identity.userData).toLowerCase();
  assert.ok(actualUserData.startsWith(runnerProfile) || actualUserData.startsWith(temporaryProfile), 'Electron userData escaped the disposable runner profile');
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
async function finishKnownOnboarding() {
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
    if (!await page.locator('style[data-plugin-css="dsh-find-all/bar.css"]').count()) return false;
    // CSS can load before a React first-run dialog mounts. Require a short
    // stable interval and reset it after each recognized prompt.
    readySince ??= Date.now();
    return Date.now() - readySince >= 2000;
  }, 'Workspace onboarding or plugin loading did not finish; no unknown prompts were accepted');
}
async function quit() {
  if (!app) return;
  const closing = app;
  let timer;
  try {
    await Promise.race([
      closing.close(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Desktop did not quit cleanly; plugin installation is not safe')), 30_000); }),
    ]);
    app = undefined;
    page = undefined;
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
  report.artifactSha256 = hash(artifact);
  installation = JSON.parse(fs.readFileSync(path.join(output, 'installer.json'), 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(installation.status, 'passed', 'installer verification must pass before launch');
  assert.equal(installation.version, version);
  assert.equal(installation.sourceUrl, 'https://download.deepseek.com/desktop/dsh-latest-windows-x64.exe');
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
    if (/^(?:DSH_|ELECTRON_|NODE_OPTIONS$|DEBUG$|PWDEBUG$|NPM_CONFIG_|npm_config_)/i.test(key) || /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key)) delete env[key];
  }
  Object.assign(env, {
    HOME: home, USERPROFILE: home, DSH_HOME: path.join(home, '.dsh'),
    DSH_AGENTS_HOME: path.join(home, '.agents'),
    // Official rc2 apps/cli/reference/README.zh.md documents this OTel opt-out;
    // packages/bundle/base/cordis.patch.yml reads it, and Desktop's official
    // tests/welcome-flow.e2e.ts uses DISABLED for its temporary-home fixture.
    // This is not a claim that unrelated product analytics are disabled.
    DSH_TELEMETRY_MODE: 'DISABLED',
    npm_config_ignore_scripts: 'true', npm_config_userconfig: path.join(home, '.npmrc'),
    npm_config_registry: 'https://registry.npmjs.org', npm_config_cache: path.join(home, 'npm-cache'),
  });
  fs.writeFileSync(path.join(home, '.npmrc'), 'ignore-scripts=true\nregistry=https://registry.npmjs.org/\n');
  report.isolation = 'fresh temporary DSH_HOME; Electron userData in disposable GitHub-hosted runner profile; no inherited model credentials';
  report.stage = 'initialize-desktop-profile';
  await launch();
  await keylessWelcome();
  assert.ok(fs.existsSync(path.join(env.DSH_HOME, 'profiles', 'desktop', 'package.json')), 'Desktop must initialize its own profile');
  await quit();
  report.profileInitialization = 'passed';
  report.testedScope.push('fresh Desktop profile initialization and clean exit');
  report.stage = 'install-plugin-with-bundled-cli';
  await runCli(['plugin', '--profile', 'desktop', 'add', artifact, '--ignore-scripts'], 'desktop-plugin-install.log');
  assert.equal(hash(artifact), report.artifactSha256, 'the shared candidate changed during installation');
  const profile = path.join(env.DSH_HOME, 'profiles', 'desktop');
  const plugin = JSON.parse(fs.readFileSync(path.join(profile, 'node_modules', '@ryuu-64', 'dsh-find-all', 'package.json'), 'utf8'));
  assert.equal(plugin.name, packageName);
  report.installedPlugin = { name: plugin.name, version: plugin.version };
  report.testedScope.push('same candidate tgz installed through bundled Desktop CLI with --ignore-scripts');
  report.stage = 'reopen-installed-plugin';
  await launch();
  await keylessWelcome(); // The official skip choice applies to this launch only.
  await finishKnownOnboarding();
  assert.equal(await page.locator('style[data-plugin-css="dsh-find-all/bar.css"]').count(), 1);
  report.bootstrap = 'passed';
  report.testedScope.push('actual plugin CSS loaded after packaged application restart');
  report.stage = 'empty-session-find';
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
  report.cleanShutdown = 'passed';
  assert.deepEqual(report.browserErrors, [], 'unhandled browser errors');
  // Console errors remain explicit evidence even if a product background network
  // request is responsible. Do not silently filter them or imply a clean pass.
  assert.deepEqual(report.consoleErrors, [], 'browser console errors');
  report.status = 'passed';
  report.stage = 'complete';
} catch (error) {
  report.status = 'failed';
  report.error = redact(error instanceof Error ? error.message : error);
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
  writeSafe('desktop-process.log', appOutput);
  const json = JSON.stringify(report, (_key, value) => typeof value === 'string' ? redact(value) : value, 2);
  fs.writeFileSync(resultPath, json);
  console.log(json);
}
