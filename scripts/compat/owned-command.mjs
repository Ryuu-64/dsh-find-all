import { spawn } from 'node:child_process';

// Bounded process ownership for the sequential cases inside one existing job.
export function runOwnedCommand(executable, args, { env, timeoutMs, stop, capture, killGraceMs = 5000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', settled = false, timedOut = false, forceTimer, detachTimer;
    const collect = data => { output += data.toString(); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    const finish = (error, code) => {
      if (settled) return;
      settled = true; clearTimeout(timer); clearTimeout(forceTimer); clearTimeout(detachTimer);
      try { capture(output); } catch (captureError) { error ??= captureError; }
      if (error) reject(error); else resolve(code);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      forceTimer = setTimeout(() => {
        try { child.kill(); } catch (error) { output += `\nOwned process termination error: ${error.message}`; }
        detachTimer = setTimeout(() => {
          child.stdout.destroy(); child.stderr.destroy(); child.unref();
          finish(new Error('Owned command exceeded its deadline and process closure was not confirmed'));
        }, killGraceMs);
      }, killGraceMs);
      void Promise.resolve().then(() => stop(child)).catch(error => { output += `\nOwned process cleanup error: ${error.message}`; });
    }, timeoutMs);
    child.on('error', error => {
      if (timedOut && child.pid) output += `\nOwned process error during cleanup: ${error.message}`;
      else finish(error);
    });
    child.once('close', code => finish(timedOut ? new Error('Owned command exceeded its deadline') : null, code));
  });
}
