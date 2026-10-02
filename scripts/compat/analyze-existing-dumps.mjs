// Only automatically existing dumps for observed test-owned PIDs are eligible.
// No MiniDumpWriteDump, LocalDumps changes, ProcDump, installs, or raw uploads.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readMinidumpMetadata, sanitizeDebuggerReport } from './minidump-metadata.mjs';

function isX64PE(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const dos = Buffer.alloc(64); if (fs.readSync(fd, dos, 0, 64, 0) !== 64 || dos.toString('ascii', 0, 2) !== 'MZ') return false;
    const header = Buffer.alloc(6), offset = dos.readUInt32LE(60);
    if (offset + 6 > fs.fstatSync(fd).size || fs.readSync(fd, header, 0, 6, offset) !== 6) return false;
    return header.readUInt32LE(0) === 0x4550 && header.readUInt16LE(4) === 0x8664;
  } finally { fs.closeSync(fd); }
}

async function cleanStack(tool, dump, context) {
  const cache = path.join(context.runDirectory, 'symbols');
  fs.mkdirSync(cache, { recursive: true });
  const symbolPath = `SRV*${cache}*https://msdl.microsoft.com/download/symbols;SRV*${cache}*https://symbols.electronjs.org`;
  // Documented CDB dump opening and kc clean stack; no parameters/raw-memory
  // commands and no option that permits mismatched symbols.
  const args = ['-y', symbolPath, '-i', path.dirname(context.executable), '-z', dump,
    '-c', '.echo FIND_ALL_CONTEXT_BEGIN; .ecxr; .echo FIND_ALL_STACK_BEGIN; kc; .echo FIND_ALL_STACK_END; q'];
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|^_NT_|^DEBUG|^NODE_OPTIONS$/i.test(key)) delete env[key];
  return await new Promise(resolve => {
    const child = spawn(tool.path, args, { cwd: context.runDirectory, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let raw = '', timedOut = false, capped = false;
    const collect = data => {
      // Keep only transient debugger output in memory, never a raw log artifact.
      if (raw.length + data.length > 2 * 1024 * 1024) { capped = true; child.kill(); return; }
      raw += data.toString();
    };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 120_000);
    child.once('error', () => { clearTimeout(timer); resolve({ status: 'existing-debugger-launch-failed' }); });
    child.once('close', code => {
      clearTimeout(timer);
      const projected = sanitizeDebuggerReport(raw);
      const mismatch = /mismatched|symbols could not be loaded|symbols could not be found|wrong symbols/i.test(raw);
      resolve({ status: timedOut ? 'timeout' : capped ? 'output-limit' : code === 0 ? 'completed' : 'failed', exitCode: code,
        tool: { name: tool.name, version: tool.version, signatureStatus: tool.signatureStatus },
        officialSymbolServers: ['https://msdl.microsoft.com/download/symbols', 'https://symbols.electronjs.org'],
        symbolMatching: 'debugger defaults; no mismatch override; module RSDS identity retained separately',
        symbolWarnings: mismatch, ...projected,
        limitation: 'Only filtered kc module/function lines are retained. No registers, arguments, raw debugger output or dump bytes are saved. A frame list alone is not a root-cause assertion.' });
      raw = '';
    });
  });
}

export async function analyzeExistingDumps(evidence, context) {
  const allowedRoot = path.resolve(context.paths.LOCALAPPDATA, 'CrashDumps');
  const observed = new Set((evidence.processStarts || []).filter(p => p.name.toLowerCase() === 'deepseek harness.exe').map(p => p.pid));
  const tool = (evidence.debuggers || []).find(t => /^cdb(?:x64)?\.exe$/i.test(t.name) && t.signatureStatus === 'Valid' && /Microsoft/i.test(t.publisher || '') && isX64PE(t.path));
  const files = (evidence.inventories || []).flatMap(item => item.files || []);
  const reports = [];
  for (const item of files) {
    const match = path.basename(item.path).match(/^DeepSeek Harness\.exe\.(\d+)\.dmp$/i);
    if (!match || !observed.has(Number(match[1])) || path.resolve(path.dirname(item.path)).toLowerCase() !== allowedRoot.toLowerCase()) continue;
    if (reports.length >= 2) break;
    const stat = fs.lstatSync(item.path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.mtimeMs < Date.parse(context.startUtc)) continue;
    if (path.dirname(fs.realpathSync(item.path)).toLowerCase() !== fs.realpathSync(allowedRoot).toLowerCase()) continue;
    const report = { pid: Number(match[1]), bytes: stat.size, status: 'pending' };
    try {
      report.metadata = readMinidumpMetadata(item.path);
      report.status = 'metadata-read';
      if (tool && report.metadata.architecture === 9) report.stack = await cleanStack(tool, item.path, context);
      else report.stack = { status: 'not-run', reason: tool ? 'dump architecture is not AMD64' : 'no existing signature-verified Microsoft x64 CDB found in the checked locations; no software installed' };
    } catch (error) { report.status = 'metadata-failed'; report.error = error.message; }
    reports.push(report);
  }
  return { source: 'existing automatic dumps for observed owned PIDs only', rawDumpUploaded: false,
    newDumpCreated: false, newSoftwareInstalled: false, reports };
}
