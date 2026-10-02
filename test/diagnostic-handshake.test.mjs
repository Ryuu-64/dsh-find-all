import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { awaitDiagnosticReady, ownDiagnosticStartup, stopDiagnosticCollector, prepareAndStopCollector } from '../scripts/compat/diagnostic-handshake.mjs';

const ready = { observerRegistered: true, observedUtc: '2026-10-02T08:29:04Z' };
function clock() {
  let time = 0;
  return { now: () => time, wait: async ms => { time += ms; }, intervalMs: 10, timeoutMs: 30 };
}
test('old exists-then-parse fails on empty publish window; bounded reader waits for complete JSON', async () => {
  assert.throws(() => JSON.parse(''), SyntaxError); // Deterministic old red case.
  const pieces = ['', '{"observerRegistered":', JSON.stringify(ready)];
  assert.deepEqual(await awaitDiagnosticReady(() => pieces.shift(), () => true, clock()), ready);
});
test('late file and BOM-prefixed complete readiness are accepted before deadline', async () => {
  let count = 0;
  assert.deepEqual(await awaitDiagnosticReady(() => {
    if (count++ < 2) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return '\uFEFF' + JSON.stringify(ready);
  }, () => true, clock()), ready);
});
for (const text of ['', '{"observerRegistered":', 'not json']) test(`bounded invalid publication ${JSON.stringify(text)} cleans its collector`, async () => {
  let cleanup = 0;
  await assert.rejects(ownDiagnosticStartup(() => awaitDiagnosticReady(() => text, () => true, clock()), async () => { cleanup++; }),
    error => /timed out/.test(error.message) && error.cause instanceof SyntaxError);
  assert.equal(cleanup, 1);
});
test('collector exit before readiness cleans ownership without waiting out timeout', async () => {
  let cleanup = 0;
  await assert.rejects(ownDiagnosticStartup(() => awaitDiagnosticReady(() => '', () => false, clock()), async () => { cleanup++; }), /exited before/);
  assert.equal(cleanup, 1);
});
test('permanent IO and valid-JSON wrong schema fail loudly and are cleaned', async () => {
  for (const read of [() => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); }, () => '{}', () => 'null']) {
    let cleanup = 0;
    await assert.rejects(ownDiagnosticStartup(() => awaitDiagnosticReady(read, () => true, clock()), async () => { cleanup++; }));
    assert.equal(cleanup, 1);
  }
});
test('cleanup failure preserves both original and cleanup errors', async () => {
  const original = new Error('read failed'), cleanup = new Error('stop failed');
  await assert.rejects(ownDiagnosticStartup(async () => { throw original; }, async () => { throw cleanup; }),
    error => error instanceof AggregateError && error.errors[0] === original && error.errors[1] === cleanup);
});
test('successful startup transfers ownership without stopping its collector', async () => {
  let cleanup = 0;
  assert.deepEqual(await ownDiagnosticStartup(() => awaitDiagnosticReady(() => JSON.stringify(ready), () => true, clock()), async () => { cleanup++; }), ready);
  assert.equal(cleanup, 0);
});
test('already-exited collector cannot transfer readiness ownership', async () => {
  await assert.rejects(awaitDiagnosticReady(() => JSON.stringify(ready), () => false, clock()), /exited after/);
});
test('failed stop-file publication still kills and waits for close, preserving failure', async () => {
  const error = new Error('stop file EACCES'), calls = [];
  await assert.rejects(stopDiagnosticCollector({
    signalStop() { calls.push('signal'); throw error; },
    kill() { calls.push('kill'); },
    async waitClosed() { calls.push('closed'); return null; },
    detach() { assert.fail('closed child must not be detached'); },
  }), e => e instanceof AggregateError && e.errors[0] === error);
  assert.deepEqual(calls, ['signal', 'kill', 'closed']);
});
test('stalled graceful stop escalates only this collector, then waits for close', async () => {
  const calls = [];
  const result = await stopDiagnosticCollector({
    signalStop() { calls.push('signal'); }, kill() { calls.push('kill'); },
    async waitClosed(ms) { calls.push(ms); return ms === 30_000 ? 'timeout' : null; },
    detach() { assert.fail('closed child must not be detached'); },
  });
  assert.equal(result, null); assert.deepEqual(calls, ['signal', 30_000, 'kill', 5000]);
});
test('termination error is not treated as close and unresolved cleanup stays a failure', async () => {
  const error = new Error('terminate denied'), calls = [];
  await assert.rejects(stopDiagnosticCollector({
    signalStop() {}, kill() { calls.push('kill'); throw error; },
    async waitClosed(ms) { calls.push(ms); return 'timeout'; },
    detach() { calls.push('detach'); },
  }), e => e instanceof AggregateError && e.errors[0] === error && /did not close/.test(e.errors[1].message));
  assert.deepEqual(calls, [30_000, 'kill', 5000, 'detach']);
});
test('real file publication can be observed empty; complete late bytes recover', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'find-all-handshake-'));
  const file = path.join(dir, 'ready.json');
  fs.writeFileSync(file, '');
  const child = spawn(process.execPath, ['-e',
    'setTimeout(() => require("node:fs").writeFileSync(process.argv[1], process.argv[2]), 50)', file, JSON.stringify(ready)], { stdio: 'ignore' });
  const closed = once(child, 'close');
  try {
    assert.throws(() => JSON.parse(fs.readFileSync(file, 'utf8')), SyntaxError);
    assert.deepEqual(await awaitDiagnosticReady(() => fs.readFileSync(file, 'utf8'), () => true, { timeoutMs: 2000, intervalMs: 5 }), ready);
    await closed;
  } finally { if (child.exitCode === null) child.kill(); await closed; fs.rmSync(dir, { recursive: true, force: true }); }
});
test('failed real handshake stops a live owned collector instead of leaving its interval running', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const closed = once(child, 'close');
  let cleaned = false;
  try {
    await assert.rejects(ownDiagnosticStartup(
      () => awaitDiagnosticReady(() => '{', () => child.exitCode === null, { timeoutMs: 20, intervalMs: 5 }),
      async () => { child.kill(); await closed; cleaned = true; },
    ), /readiness timed out/);
    assert.equal(cleaned, true);
    assert.ok(child.exitCode !== null || child.signalCode !== null);
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill(); await closed; }
});
test('context rewrite failure still finalizes the live owned collector', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const closed = once(child, 'close');
  const failure = Object.assign(new Error('context rewrite denied'), { code: 'EACCES' });
  let stopped = false;
  try {
    await assert.rejects(prepareAndStopCollector(() => { throw failure; }, async () => {
      child.kill(); await closed; stopped = true; return null;
    }), error => error === failure);
    assert.equal(stopped, true);
    assert.ok(child.exitCode !== null || child.signalCode !== null);
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill(); await closed; }
});
test('finalization preserves context and cleanup errors and stops exactly once', async () => {
  const prepare = new Error('context'), cleanup = new Error('collector'); let calls = 0;
  await assert.rejects(prepareAndStopCollector(() => { throw prepare; }, async () => { calls++; throw cleanup; }),
    error => error instanceof AggregateError && error.errors[0] === prepare && error.errors[1] === cleanup);
  assert.equal(calls, 1);
  assert.equal(await prepareAndStopCollector(() => {}, async () => 0), 0);
});
