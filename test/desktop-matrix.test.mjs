import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runHistoricalDesktopCases } from '../scripts/compat/desktop-matrix.mjs';
import { runOwnedCommand } from '../scripts/compat/owned-command.mjs';

const digest = 'a'.repeat(64);
async function scenario(change = () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'find-all-matrix-'));
  const calls = [];
  let saved;
  const options = {
    artifact: path.join(root, 'same.tgz'), output: path.join(root, 'windows-0.2.0-rc.2'),
    currentReport: { artifactSha256: digest, status: 'failed' }, installation: { status: 'passed' },
    save(file, result) { saved = { file, result }; },
    async run(executable, args, log, timeout) {
      calls.push({ executable, args, log, timeout });
      if (executable === process.execPath) {
        const [, artifact, directory, version] = args;
        assert.equal(artifact, options.artifact);
        fs.writeFileSync(path.join(directory, 'desktop-result.json'), JSON.stringify({
          version, artifactSha256: digest, status: 'failed', stage: 'complete',
          historyEvidence: { nativeHotUnload: 'passed' }, bootstrap: 'passed',
          nativeStartupErrors: ['baseline'], consoleClassification: { unexpected: ['baseline'] },
        }));
        return 1;
      }
      return 0;
    },
  };
  change(options);
  try { return { matrix: await runHistoricalDesktopCases(options), calls, saved }; }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}
test('historical versions are independently uninstalled/installed and use exactly the same artifact', async () => {
  const { matrix, calls } = await scenario();
  assert.equal(calls.length, 6);
  assert.match(calls[0].args[3], /uninstall-owned-windows/);
  assert.match(calls[1].args[3], /install-windows/);
  assert.equal(calls[1].args.at(-1), '0.2.0-rc.1');
  assert.equal(calls[4].args.at(-1), '0.1.7-rc.2');
  assert.deepEqual(matrix.cases.map(row => row.status), ['failed', 'failed']);
  assert.ok(matrix.cases.every(row => row.historyEvidence.nativeHotUnload === 'passed'));
  assert.equal(matrix.status, 'failed', 'native errors must not be turned into overall passes');
});
test('uninstall refusal blocks any subsequent install, without relaxing ownership guards', async () => {
  const { matrix, calls } = await scenario(options => {
    const run = options.run; options.run = async (...args) => { await run(...args); return 1; };
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(matrix.cases.map(row => row.status), ['failed', 'not-run']);
  assert.match(matrix.error, /uninstall/);
});
test('missing ownership and exhausted time budget execute no commands', async () => {
  for (const change of [options => { options.installation = undefined; }, options => {
    let calls = 0; options.now = () => calls++ ? 13 * 60_000 : 0;
  }]) {
    const { matrix, calls } = await scenario(change);
    assert.equal(calls.length, 0); assert.equal(matrix.status, 'failed');
  }
});
test('child package identity mismatch fails before advancing the matrix', async () => {
  const { matrix, calls } = await scenario(options => {
    const run = options.run;
    options.run = async (executable, args, ...rest) => {
      const code = await run(executable, args, ...rest);
      if (executable === process.execPath) {
        const file = path.join(args[2], 'desktop-result.json');
        const report = JSON.parse(fs.readFileSync(file)); report.artifactSha256 = 'b'.repeat(64);
        fs.writeFileSync(file, JSON.stringify(report));
      }
      return code;
    };
  });
  assert.equal(calls.length, 3); assert.match(matrix.error, /same tgz/);
});
test('owned subprocess captures output and retains nonzero exit', async () => {
  let output;
  assert.equal(await runOwnedCommand(process.execPath, ['-e', 'console.log("synthetic"); process.exitCode=3'], {
    env: process.env, timeoutMs: 2000, stop: child => child.kill(), capture: text => { output = text; },
  }), 3);
  assert.match(output, /synthetic/);
});
test('owned timeout still terminates when its initial cleanup callback fails', async () => {
  let called = 0, output;
  await assert.rejects(runOwnedCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    env: process.env, timeoutMs: 30, killGraceMs: 20,
    stop() { called++; throw new Error('synthetic cleanup failure'); }, capture: text => { output = text; },
  }), /deadline/);
  assert.equal(called, 1); assert.match(output, /synthetic cleanup failure/);
});
