// Read-only diagnostic support for this disposable Windows acceptance run.
// ASAR layout: electron/asar src/disk.ts readArchiveHeaderSync/readFileSync and
// src/pickle.ts. Only the fixed root package.json is read; no archive extraction.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function readAsarManifest(archive) {
  const fd = fs.openSync(archive, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    function read(length, offset) {
      assert.ok(Number.isSafeInteger(length) && length > 0 && length <= 32 * 1024 * 1024);
      assert.ok(Number.isSafeInteger(offset) && offset >= 0 && offset + length <= size);
      const buffer = Buffer.alloc(length);
      assert.equal(fs.readSync(fd, buffer, 0, length, offset), length);
      return buffer;
    }
    const prefix = read(8, 0);
    assert.equal(prefix.readUInt32LE(0), 4, 'unexpected ASAR size pickle');
    const headerSize = prefix.readUInt32LE(4);
    const header = read(headerSize, 8);
    const pickleHeaderSize = header.length - header.readUInt32LE(0);
    assert.equal(pickleHeaderSize, 4, 'unexpected ASAR header pickle');
    const jsonSize = header.readInt32LE(pickleHeaderSize);
    assert.ok(jsonSize > 0 && jsonSize <= header.length - pickleHeaderSize - 4);
    const tree = JSON.parse(header.subarray(pickleHeaderSize + 4, pickleHeaderSize + 4 + jsonSize));
    const entry = tree.files?.['package.json'];
    assert.ok(entry && !entry.link && !entry.unpacked, 'root manifest must be a packed regular file');
    assert.ok(entry.size > 0 && entry.size < 1024 * 1024);
    const offset = Number(entry.offset);
    assert.ok(Number.isSafeInteger(offset) && offset >= 0);
    return JSON.parse(read(entry.size, 8 + headerSize + offset));
  } finally { fs.closeSync(fd); }
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function startDiagnostics(installation, appEnv, redact) {
  assert.equal(process.platform, 'win32');
  const manifest = readAsarManifest(path.join(installation.installDirectory, 'resources', 'app.asar'));
  assert.equal(manifest.name, '@deepseek-ai/dsh-desktop');
  assert.equal(manifest.version, '0.2.0-rc.2');
  assert.ok(!manifest.productName || manifest.productName === 'DeepSeek Harness');
  // Electron app.getName prefers the installed manifest's productName, then
  // name; app.getPath(userData) defaults to APPDATA/name. rc2 never overrides it.
  // https://www.electronjs.org/docs/latest/api/app#appgetpathname
  const userData = path.join(appEnv.APPDATA, manifest.productName || manifest.name);
  const prefix = path.resolve(appEnv.APPDATA).toLowerCase() + path.sep;
  assert.ok(path.resolve(userData).toLowerCase().startsWith(prefix));
  const context = {
    startUtc: new Date().toISOString(), nodePid: process.pid,
    executable: installation.executable, runDirectory: installation.runDirectory,
    installedManifest: { name: manifest.name, productName: manifest.productName, version: manifest.version },
    userData, userDataBasis: 'installed ASAR manifest plus documented Electron default; runtime path cross-check when launch succeeds',
    mainDiagnosticFile: appEnv.DSH_DESKTOP_DIAGNOSTIC_FILE,
    runnerPaths: Object.fromEntries(['APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOME', 'TEMP', 'TMP'].map(key => [key, process.env[key] ?? null])),
    paths: Object.fromEntries(['APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOME', 'TEMP', 'TMP', 'DSH_HOME', 'DSH_AGENTS_HOME'].map(key => [key, appEnv[key] ?? null])),
  };
  const contextFile = path.join(installation.runDirectory, 'diagnostic-context.json');
  const readyFile = path.join(installation.runDirectory, 'diagnostic-ready.json');
  const stopFile = path.join(installation.runDirectory, 'diagnostic-stop');
  const resultFile = path.join(installation.runDirectory, 'diagnostic-raw.json');
  fs.writeFileSync(contextFile, JSON.stringify(context));
  const helper = fileURLToPath(new URL('./collect-windows-diagnostics.ps1', import.meta.url));
  const child = spawn('pwsh.exe', ['-NoProfile', '-NonInteractive', '-File', helper,
    '-ContextFile', contextFile, '-ReadyFile', readyFile, '-StopFile', stopFile, '-ResultFile', resultFile],
  { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let helperOutput = '';
  child.stdout.on('data', data => { helperOutput += data; });
  child.stderr.on('data', data => { helperOutput += data; });
  const closed = new Promise(resolve => {
    child.once('error', error => { helperOutput += error.message; resolve(-1); });
    child.once('close', resolve);
  });
  for (let i = 0; i < 100 && !fs.existsSync(readyFile) && child.exitCode === null; i++) await wait(100);
  const ready = fs.existsSync(readyFile) ? JSON.parse(fs.readFileSync(readyFile, 'utf8').replace(/^\uFEFF/, '')) : { error: 'diagnostic helper did not signal readiness' };
  return {
    context, ready,
    async finish(output, observedUserData) {
      if (observedUserData) {
        const resolved = path.resolve(observedUserData).toLowerCase();
        assert.ok(resolved.startsWith(prefix) || resolved.startsWith(path.resolve(installation.runDirectory).toLowerCase() + path.sep));
        context.userData = observedUserData;
        context.userDataBasis = 'observed app.getPath(userData) in the actual installed Electron process';
        fs.writeFileSync(contextFile, JSON.stringify(context));
      }
      fs.writeFileSync(stopFile, new Date().toISOString());
      const exitCode = await Promise.race([closed, wait(30_000).then(() => 'timeout')]);
      if (exitCode === 'timeout') child.kill();
      const summary = { context, ready, exitCode, helperOutput: redact(helperOutput) };
      if (fs.existsSync(resultFile)) {
        const raw = JSON.parse(fs.readFileSync(resultFile, 'utf8').replace(/^\uFEFF/, ''));
        for (const event of raw.events || []) {
          const safe = redact(event.xml);
          const filename = `windows-event-${event.id}-${event.recordId}.xml`;
          fs.writeFileSync(path.join(output, filename), safe);
          event.xmlUnchanged = safe === event.xml;
          event.xmlFile = filename;
          delete event.xml;
        }
        for (const [index, file] of (raw.fatalLogs || []).entries()) {
          const filename = `desktop-fatal-${index}.log`;
          fs.writeFileSync(path.join(output, filename), redact(file.text));
          file.artifact = filename;
          delete file.text;
        }
        summary.evidence = raw;
      }
      fs.writeFileSync(path.join(output, 'windows-diagnostics.json'), JSON.stringify(summary, (_key, value) => typeof value === 'string' ? redact(value) : value, 2));
      return { helperExitCode: exitCode, eventCount: summary.evidence?.events?.length ?? 0,
        fatalLogCount: summary.evidence?.fatalLogs?.length ?? 0, file: 'windows-diagnostics.json' };
    },
  };
}
