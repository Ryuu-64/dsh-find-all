import assert from 'node:assert/strict';

// The publisher renames a complete sibling file. Also tolerate a legacy writer
// observed between create/truncate and write: existence is not a ready signal.
export async function awaitDiagnosticReady(read, alive, {
  timeoutMs = 10_000, intervalMs = 100, now = Date.now,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  const deadline = now() + timeoutMs;
  let lastError;
  while (true) {
    try {
      const ready = JSON.parse(read().replace(/^\uFEFF/, ''));
      assert.ok(ready && typeof ready === 'object' && typeof ready.observerRegistered === 'boolean'
        && typeof ready.observedUtc === 'string' && Number.isFinite(Date.parse(ready.observedUtc)),
      'invalid diagnostic readiness schema');
      if (!alive()) throw new Error('Diagnostic collector exited after readiness publication');
      return ready;
    } catch (error) {
      if (!(error instanceof SyntaxError) && error.code !== 'ENOENT') throw error;
      lastError = error;
    }
    if (!alive()) throw new Error('Diagnostic collector exited before valid readiness', { cause: lastError });
    if (now() >= deadline) throw new Error('Diagnostic collector readiness timed out', { cause: lastError });
    await wait(Math.min(intervalMs, deadline - now()));
  }
}

export async function stopDiagnosticCollector({ signalStop, kill, waitClosed, detach }) {
  const errors = [];
  const terminate = () => { try { kill(); } catch (error) { errors.push(error); } };
  try { signalStop(); }
  catch (error) { errors.push(error); terminate(); }
  let exitCode = await waitClosed(30_000);
  if (exitCode === 'timeout') {
    terminate();
    exitCode = await waitClosed(5_000);
    if (exitCode === 'timeout') {
      detach();
      errors.push(new Error('Owned diagnostic collector did not close after termination'));
    }
  }
  if (errors.length) throw new AggregateError(errors, 'Diagnostic collector cleanup reported failures');
  return exitCode;
}

export async function prepareAndStopCollector(prepare, stop) {
  let prepareError, exitCode;
  try { await prepare(); }
  catch (error) { prepareError = error; }
  finally {
    try { exitCode = await stop(); }
    catch (stopError) {
      if (prepareError) throw new AggregateError([prepareError, stopError], 'Diagnostic finalization and cleanup failed');
      throw stopError;
    }
  }
  if (prepareError) throw prepareError;
  return exitCode;
}

// Ownership starts when the process is spawned, not when readiness succeeds.
export async function ownDiagnosticStartup(start, cleanup) {
  try { return await start(); }
  catch (error) {
    try { await cleanup(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Diagnostic startup and cleanup failed'); }
    throw error;
  }
}
