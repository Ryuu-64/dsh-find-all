// QA-only compatibility adapter for the pinned Playwright 1.56.1 runtime.
// Electron 44.0.0 can bootstrap its sandbox bundle on an uncommitted empty
// document when a debugger creates a context before startupData arrives:
// https://github.com/electron/electron/issues/54149
// https://github.com/electron/electron/blob/v44.4.4/shell/renderer/electron_sandboxed_renderer_client.cc#L129-L139
// Never change the installed application, its preload, security preferences,
// candidate package, or shared node_modules. Native startup errors remain fatal.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
export const PLAYWRIGHT_VERSION = '1.56.1';
export const ORIGINAL_CR_PAGE_SHA256 = '79a25e4eac0d0fa97dcc6eae4edce83436bcdb4bb1322731f65610adaa8e150f';
const ORIGINAL_ELECTRON_SHA256 = '4b51d9fa9e32f9b89cf7b18e57b899b6b67237fc7f40e353f5deea632e05b185';
const pageFile = 'lib/server/chromium/crPage.js';
const electronFile = 'lib/server/electron/electron.js';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length - 1, 1, 'pinned Playwright transform must have exactly one source match');
  return source.replace(before, after);
}

export function transformElectronCrPage(source) {
  assert.equal(hash(source), ORIGINAL_CR_PAGE_SHA256, 'unrecognized Playwright crPage.js; no instrumentation change applied');
  let patched = replaceOnce(source,
    '    let lifecycleEventsEnabled;',
    '    const deferInitialElectronContext = this._isMainFrame() && this._crPage._browserContext._browser.options.name === "electron";\n    let lifecycleEventsEnabled;');
  const originalWorlds = `        const localFrames = this._isMainFrame() ? this._page.frames() : [this._page.frameManager.frame(this._targetId)];
        for (const frame of localFrames) {
          this._client._sendMayFail("Page.createIsolatedWorld", {
            frameId: frame._id,
            grantUniveralAccess: true,
            worldName: this._crPage.utilityWorldName
          });
        }
        const isInitialEmptyPage = this._isMainFrame() && this._page.mainFrame().url() === ":";`;
  const deferredWorlds = `        const isInitialEmptyPage = this._isMainFrame() && this._page.mainFrame().url() === ":";
        const localFrames = this._isMainFrame() ? this._page.frames() : [this._page.frameManager.frame(this._targetId)];
        // The registered new-document utility world will run after commit.
        // Do not force a context into Electron's initial empty document.
        if (!deferInitialElectronContext || !isInitialEmptyPage) {
          for (const frame of localFrames) {
            this._client._sendMayFail("Page.createIsolatedWorld", {
              frameId: frame._id,
              grantUniveralAccess: true,
              worldName: this._crPage.utilityWorldName
            });
          }
        }`;
  patched = replaceOnce(patched, originalWorlds, deferredWorlds);
  patched = replaceOnce(patched,
    '      this._client.send("Runtime.enable", {}),',
    `      deferInitialElectronContext
        ? this._firstNonInitialNavigationCommittedPromise.then(() => this._client.send("Runtime.enable", {}))
        : this._client.send("Runtime.enable", {}),`);
  // Deliberately preserve eager Runtime.runIfWaitingForDebugger. Waiting for
  // commit before resuming the target would deadlock. The existing promise is
  // fulfilled by Page.frameNavigated, or by an already-committed frame snapshot;
  // disposal rejects it. No elapsed-time assumption is involved.
  return { source: patched, evidence: {
    changes: 3, originalSha256: ORIGINAL_CR_PAGE_SHA256, patchedSha256: hash(patched),
    scope: 'Electron main-frame initialization only',
    readiness: 'existing Playwright firstNonInitialNavigationCommitted promise; initial URL sentinel :',
    resumeBeforeCommit: true, initialWorld: 'registered for the next committed document',
  } };
}

async function fileHashes(root, relative = '') {
  const result = {};
  const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    assert.ok(!entry.isSymbolicLink(), 'QA runtime must not share files through symlinks');
    if (entry.isDirectory()) Object.assign(result, await fileHashes(root, name));
    else {
      assert.ok(entry.isFile(), 'unexpected special file in Playwright runtime');
      result[name] = hash(await fs.readFile(path.join(root, name)));
    }
  }
  return result;
}

export async function prepareElectronInstrumentation(runtimeDirectory) {
  assert.ok(typeof runtimeDirectory === 'string' && path.isAbsolute(runtimeDirectory), 'an absolute fresh QA runtime directory is required');
  const sourceRoot = path.dirname(require.resolve('playwright-core/package.json'));
  const sourceRelative = path.relative(sourceRoot, runtimeDirectory);
  assert.ok(sourceRelative && (sourceRelative.startsWith(`..${path.sep}`) || path.isAbsolute(sourceRelative)), 'QA copy must be outside the installed Playwright runtime');
  const manifest = JSON.parse(await fs.readFile(path.join(sourceRoot, 'package.json'), 'utf8'));
  assert.equal(manifest.version, PLAYWRIGHT_VERSION, 'only pinned Playwright 1.56.1 has been reviewed');
  const before = await fileHashes(sourceRoot);
  assert.equal(before[electronFile], ORIGINAL_ELECTRON_SHA256, 'unrecognized Playwright Electron launcher');
  const transformed = transformElectronCrPage(await fs.readFile(path.join(sourceRoot, pageFile), 'utf8'));
  // mkdir is exclusive: an existing directory must never be overwritten.
  await fs.mkdir(runtimeDirectory);
  for (const name of await fs.readdir(sourceRoot)) {
    await fs.cp(path.join(sourceRoot, name), path.join(runtimeDirectory, name), { recursive: true, force: false, errorOnExist: true });
  }
  await fs.writeFile(path.join(runtimeDirectory, pageFile), transformed.source);
  const after = await fileHashes(runtimeDirectory);
  assert.deepEqual(after, { ...before, [pageFile]: transformed.evidence.patchedSha256 }, 'only copied crPage.js may differ');
  assert.deepEqual(await fileHashes(sourceRoot), before, 'shared Playwright installation must remain unchanged');
  const runtime = await import(pathToFileURL(path.join(runtimeDirectory, 'index.mjs')).href);
  assert.equal(typeof runtime._electron?.launch, 'function', 'copied Electron launcher unavailable');
  assert.equal(typeof runtime.chromium?.launch, 'function', 'copied Chromium launcher unavailable');
  return { _electron: runtime._electron, chromium: runtime.chromium, evidence: {
    schemaVersion: 1, playwrightVersion: PLAYWRIGHT_VERSION, runtimeDirectory,
    ...transformed.evidence,
    originalElectronSha256: ORIGINAL_ELECTRON_SHA256,
    sourceTreeSha256: hash(JSON.stringify(before)), copiedTreeSha256: hash(JSON.stringify(after)),
    copiedFiles: Object.keys(before).length, otherRuntimeFilesUnchanged: true, sharedRuntimeUnchanged: true,
    nativeLogGate: 'unchanged; every sandbox bootstrap error remains a failure',
    sources: [
      'https://github.com/electron/electron/issues/54149',
      'https://github.com/electron/electron/blob/v44.0.0/shell/renderer/electron_sandboxed_renderer_client.cc',
      'https://github.com/electron/electron/blob/v44.4.4/shell/renderer/electron_sandboxed_renderer_client.cc',
      'https://github.com/microsoft/playwright/blob/v1.56.1/packages/playwright-core/src/server/chromium/crPage.ts#L439-L522',
    ],
  } };
}
