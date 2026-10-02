import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Remains within the existing Windows job. These are distinct installations and
// synthetic profiles; no workflow/job dispatch, credential, or permission change.
export async function runHistoricalDesktopCases({ artifact, output, currentReport, installation, run, save, now = Date.now }) {
  const versions = ['0.2.0-rc.1', '0.1.7-rc.2'];
  const matrix = { initialVersion: '0.2.0-rc.2', initialStatus: currentReport.status, artifactSha256: currentReport.artifactSha256,
    cases: versions.map(version => ({ version, status: 'not-run', stage: 'pending' })) };
  const root = path.dirname(output);
  const deadline = now() + 12 * 60_000; // Leave room for evidence upload in the existing 25-minute job.
  const command = async (executable, args, log, maximumMs) => {
    const remaining = deadline - now();
    assert.ok(remaining > 0, 'historical Desktop acceptance budget exhausted');
    return run(executable, args, path.join(root, log), Math.min(remaining, maximumMs));
  };
  let previous = path.join(output, 'installer.json');
  try {
    assert.equal(installation?.status, 'passed', 'initial installation ownership must be verified');
    assert.match(currentReport.artifactSha256 || '', /^[a-f0-9]{64}$/, 'the single candidate identity is required');
    for (const item of matrix.cases) {
      const directory = path.join(root, `windows-${item.version}`);
      fs.mkdirSync(directory, { recursive: true });
      item.stage = 'remove-previous-owned-installation';
      assert.equal(await command('pwsh.exe', ['-NoProfile', '-NonInteractive', '-File',
        fileURLToPath(new URL('./uninstall-owned-windows.ps1', import.meta.url)), '-InstallationReport', previous],
      `uninstall-before-${item.version}.log`, 90_000), 0, 'owned uninstall must succeed before the next installation');
      item.stage = 'install-official-version';
      assert.equal(await command('pwsh.exe', ['-NoProfile', '-NonInteractive', '-File',
        fileURLToPath(new URL('./install-windows.ps1', import.meta.url)), '-OutputDirectory', directory, '-Version', item.version],
      `install-${item.version}.log`, 330_000), 0, 'historical signed installer must pass');
      item.stage = 'installed-electron-acceptance';
      item.exitCode = await command(process.execPath, [fileURLToPath(new URL('./windows-smoke.mjs', import.meta.url)),
        artifact, directory, item.version], `acceptance-${item.version}.log`, 360_000);
      const result = JSON.parse(fs.readFileSync(path.join(directory, 'desktop-result.json'), 'utf8'));
      assert.equal(result.version, item.version);
      assert.equal(result.artifactSha256, matrix.artifactSha256, 'every Desktop case must use the same tgz bytes');
      item.status = result.status === 'passed' && item.exitCode === 0 ? 'passed' : 'failed';
      item.stage = result.stage;
      item.report = `windows-${item.version}/desktop-result.json`;
      item.historyEvidence = result.historyEvidence ?? null;
      item.bootstrap = result.bootstrap;
      item.nativeStartupErrorCount = result.nativeStartupErrors?.length ?? null;
      item.unexpectedConsoleCount = result.consoleClassification?.unexpected.length ?? null;
      previous = path.join(directory, 'installer.json');
    }
  } catch (error) {
    matrix.error = error.message;
    const active = matrix.cases.find(item => item.status === 'not-run' && item.stage !== 'pending');
    if (active) active.status = 'failed';
  } finally {
    matrix.status = currentReport.status === 'passed' && matrix.cases.every(item => item.status === 'passed') ? 'passed' : 'failed';
    save(path.join(root, 'desktop-matrix.json'), matrix);
  }
  return matrix;
}
