import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { ORIGINAL_CR_PAGE_SHA256, prepareElectronInstrumentation, transformElectronCrPage } from '../scripts/compat/electron-instrumentation.mjs';

const require = createRequire(import.meta.url);
const sourceRoot = path.dirname(require.resolve('playwright-core/package.json'));
const original = await fs.readFile(path.join(sourceRoot, 'lib/server/chromium/crPage.js'), 'utf8');
const transformed = transformElectronCrPage(original);
const turn = () => new Promise(resolve => setImmediate(resolve));

// Execute the actual transformed _initialize method with a protocol mock.
// This proves command ordering and disposal without claiming an Electron run.
function initializationFixture({ browser = 'electron', url = ':', source = transformed.source } = {}) {
  const begin = source.indexOf('  async _initialize(hasUIWindow) {');
  const end = source.indexOf('\n  dispose() {', begin);
  assert.ok(begin > 0 && end > begin);
  const method = source.slice(begin, end).replace('async _initialize(', 'async function(');
  const initialize = vm.runInNewContext(`(${method})`, {
    import_eventsHelper: { eventsHelper: { addEventListener(emitter, name, listener) {
      emitter.on(name, listener); return { emitter, name, listener };
    } } },
  });
  const navigationBegin = source.indexOf('  _onFrameNavigated(framePayload, initial) {');
  const navigationEnd = source.indexOf('\n  _onFrameRequestedNavigation(', navigationBegin);
  const onNavigation = vm.runInNewContext(`(${source.slice(navigationBegin, navigationEnd).replace('_onFrameNavigated(', 'function(')})`);
  const commands = [];
  const client = new EventEmitter();
  client.send = async (method, params) => {
    commands.push({ method, params });
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main', url, loaderId: 'loader' } } };
    return {};
  };
  client._sendMayFail = client.send;
  let currentUrl = url, resolveCommit, rejectCommit;
  const committed = new Promise((resolve, reject) => { resolveCommit = resolve; rejectCommit = reject; });
  committed.catch(() => {});
  const frame = { _id: 'main', url: () => currentUrl };
  const session = {
    _isMainFrame: () => true,
    _client: client, _eventListeners: [], _targetId: 'main',
    _firstNonInitialNavigationCommittedPromise: committed,
    _firstNonInitialNavigationCommittedFulfill: resolveCommit,
    _page: { isStorageStatePage: true, frames: () => [frame], mainFrame: () => frame,
      frameManager: { frameCommittedNewDocumentNavigation(_id, nextUrl) { currentUrl = nextUrl; } } },
    _crPage: {
      utilityWorldName: '__playwright_fixture_world',
      _browserContext: { _browser: { options: { name: browser }, isClank: () => false }, _options: {} },
      _networkManager: { addSession: async () => {} },
    },
    _addBrowserListeners() {},
    _addRendererListeners() {
      client.on('Page.frameNavigated', ({ frame }) => onNavigation.call(this, frame, false));
    },
    _eventBelongsToStaleFrame: () => false,
    _handleFrameTree({ frame }) { onNavigation.call(this, frame, true); },
    _onAttachedToTarget() {}, _onLifecycleEvent() {},
  };
  return { commands, pending: initialize.call(session, false),
    commit: nextUrl => client.emit('Page.frameNavigated', { frame: { id: 'main', url: nextUrl, loaderId: 'next-loader' } }),
    dispose: () => rejectCommit(new Error('target closed before first commit')) };
}

test('source transform is pinned, idempotence fails closed, and logging/resume survive', () => {
  assert.equal(transformed.evidence.originalSha256, ORIGINAL_CR_PAGE_SHA256);
  assert.equal(transformed.evidence.changes, 3);
  assert.notEqual(transformed.evidence.patchedSha256, ORIGINAL_CR_PAGE_SHA256);
  assert.throws(() => transformElectronCrPage(`${original}\n`), /unrecognized Playwright/);
  assert.throws(() => transformElectronCrPage(transformed.source), /unrecognized Playwright/);
  for (const command of ['Log.enable', 'Page.enable', 'Page.getFrameTree', 'Page.addScriptToEvaluateOnNewDocument', 'Runtime.runIfWaitingForDebugger']) {
    assert.equal(transformed.source.split(`"${command}"`).length, original.split(`"${command}"`).length, command);
  }
  assert.ok(transformed.source.includes('promises.push(this._client.send("Runtime.runIfWaitingForDebugger"));\n    promises.push(this._firstNonInitialNavigationCommittedPromise);\n    await Promise.all(promises);'));
  assert.equal(transformed.source.includes('--no-sandbox'), false);
});

test('unmodified Playwright reproduces both precommit context-creating commands', async () => {
  const fixture = initializationFixture({ source: original });
  await turn();
  assert.ok(fixture.commands.some(command => command.method === 'Runtime.enable'));
  assert.ok(fixture.commands.some(command => command.method === 'Page.createIsolatedWorld'));
  fixture.commit('dsh-app://app/');
  await fixture.pending;
});

test('initial Electron document resumes before commit and cannot create either early context', async () => {
  const fixture = initializationFixture();
  await turn();
  const methods = () => fixture.commands.map(command => command.method);
  assert.ok(methods().includes('Runtime.runIfWaitingForDebugger'), 'resume is eager, so the navigation can commit');
  assert.ok(methods().includes('Log.enable'), 'startup diagnostics remain enabled');
  assert.ok(methods().includes('Page.addScriptToEvaluateOnNewDocument'), 'utility world is registered for real navigation');
  assert.equal(methods().includes('Runtime.enable'), false);
  assert.equal(methods().includes('Page.createIsolatedWorld'), false);
  await turn();
  assert.equal(methods().includes('Runtime.enable'), false, 'elapsed time never releases the gate');
  fixture.commit('dsh-app://app/');
  await fixture.pending;
  assert.equal(methods().filter(method => method === 'Runtime.enable').length, 1);
  assert.equal(methods().includes('Page.createIsolatedWorld'), false, 'initial world is not created retroactively');
  assert.ok(methods().indexOf('Runtime.runIfWaitingForDebugger') < methods().indexOf('Runtime.enable'));
});

for (const url of ['dsh-app://app/', 'file:///C:/installed/welcome.html', 'about:blank']) {
  test(`already committed Electron snapshot ${url} initializes without waiting for another navigation`, async () => {
    const fixture = initializationFixture({ url });
    await fixture.pending;
    assert.equal(fixture.commands.filter(command => command.method === 'Runtime.enable').length, 1);
    assert.equal(fixture.commands.filter(command => command.method === 'Page.createIsolatedWorld').length, 1);
  });
}

test('regular Chromium retains original early initialization behavior', async () => {
  const fixture = initializationFixture({ browser: 'chromium' });
  await turn();
  assert.ok(fixture.commands.some(command => command.method === 'Runtime.enable'));
  assert.ok(fixture.commands.some(command => command.method === 'Page.createIsolatedWorld'));
  fixture.commit('https://fixture.invalid/');
  await fixture.pending;
});

test('closing before first commit rejects initialization without enabling Runtime', async () => {
  const fixture = initializationFixture();
  await turn();
  const rejection = assert.rejects(fixture.pending, /target closed before first commit/);
  fixture.dispose();
  await rejection;
  assert.equal(fixture.commands.some(command => command.method === 'Runtime.enable'), false);
});

test('copied runtime loads its Electron API and changes only copied crPage.js', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'find-all-electron-instrumentation-'));
  try {
    const runtimeDirectory = path.join(temporary, 'playwright-core');
    const { _electron, chromium, evidence } = await prepareElectronInstrumentation(runtimeDirectory);
    assert.equal(typeof _electron.launch, 'function');
    assert.equal(typeof chromium.launch, 'function');
    assert.equal(evidence.playwrightVersion, '1.56.1');
    assert.ok(evidence.copiedFiles > 100);
    assert.equal(evidence.sharedRuntimeUnchanged, true);
    assert.equal(evidence.otherRuntimeFilesUnchanged, true);
    assert.equal(await fs.readFile(path.join(runtimeDirectory, 'lib/server/chromium/crPage.js'), 'utf8'), transformed.source);
    assert.equal(await fs.readFile(path.join(sourceRoot, 'lib/server/chromium/crPage.js'), 'utf8'), original);
    await assert.rejects(prepareElectronInstrumentation(runtimeDirectory), /EEXIST/);
    await assert.rejects(prepareElectronInstrumentation(sourceRoot), /outside the installed/);
    await assert.rejects(prepareElectronInstrumentation('relative-copy'), /absolute fresh/);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});
