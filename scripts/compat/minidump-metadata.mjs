// Read only header/exception/module metadata, never memory or stack streams.
// Layouts: Microsoft minidumpapiset.h (pack(4)); CodeView RSDS layout:
// llvm/llvm-project llvm/include/llvm/Object/CVDebugRecord.h.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const hex = value => `0x${value.toString(16)}`;
const basename = value => path.win32.basename(value.replaceAll('/', '\\'));

export function readMinidumpMetadata(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const bytes = fs.fstatSync(fd).size;
    function read(offset, length) {
      assert.ok(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(length) && length > 0 && length <= 1024 * 1024 && offset + length <= bytes, 'minidump metadata range is invalid');
      const buffer = Buffer.alloc(length);
      assert.equal(fs.readSync(fd, buffer, 0, length, offset), length);
      return buffer;
    }
    function string(rva) {
      const length = read(rva, 4).readUInt32LE(0);
      assert.ok(length > 0 && length <= 4096 && length % 2 === 0, 'invalid module-name length');
      return read(rva + 4, length).toString('utf16le');
    }
    const header = read(0, 32);
    assert.equal(header.toString('ascii', 0, 4), 'MDMP');
    assert.equal(header.readUInt32LE(4) & 0xffff, 42899, 'unsupported minidump version');
    const count = header.readUInt32LE(8), directoryRva = header.readUInt32LE(12);
    assert.ok(count > 0 && count <= 4096, 'invalid stream count');
    const directory = read(directoryRva, count * 12);
    const streams = new Map();
    for (let i = 0; i < count; i++) {
      const type = directory.readUInt32LE(i * 12);
      // Explicit whitelist: no memory, register-context, strings, or stack scan.
      if (![4, 6, 7].includes(type)) continue;
      assert.ok(!streams.has(type), 'duplicate metadata stream');
      const size = directory.readUInt32LE(i * 12 + 4), rva = directory.readUInt32LE(i * 12 + 8);
      assert.ok(size > 0 && rva + size <= bytes, 'metadata stream extends outside dump');
      streams.set(type, { size, rva });
    }
    const exception = streams.get(6), modules = streams.get(4), system = streams.get(7);
    assert.ok(exception?.size >= 168 && modules?.size >= 4, 'required exception/module metadata missing');
    const record = read(exception.rva, 32);
    const address = record.readBigUInt64LE(24);
    const result = {
      format: 'MINIDUMP', bytes, capturedUtc: header.readUInt32LE(20) ? new Date(header.readUInt32LE(20) * 1000).toISOString() : null,
      flags: hex(header.readBigUInt64LE(24)),
      exception: { threadId: record.readUInt32LE(0), code: hex(record.readUInt32LE(8)), instructionAddress: hex(address) },
      architecture: system?.size >= 2 ? read(system.rva, 2).readUInt16LE(0) : null,
      faultingModule: null,
      limits: 'Only fixed header/exception/module/CodeView metadata is read; no memory, context registers, environment or call stack is inferred.',
    };
    const moduleCount = read(modules.rva, 4).readUInt32LE(0);
    assert.ok(moduleCount <= 4096 && 4 + moduleCount * 108 <= modules.size, 'invalid module list size');
    for (let i = 0; i < moduleCount; i++) {
      const row = read(modules.rva + 4 + i * 108, 108);
      const base = row.readBigUInt64LE(0), imageBytes = row.readUInt32LE(8);
      if (address < base || address >= base + BigInt(imageBytes)) continue;
      assert.equal(result.faultingModule, null, 'overlapping fault modules');
      const name = basename(string(row.readUInt32LE(20)));
      assert.ok(/^[\w .()+-]{1,180}$/.test(name), 'unsafe module basename');
      const ms = row.readUInt32LE(32), ls = row.readUInt32LE(36);
      const module = {
        name, base: hex(base), imageBytes, offset: hex(address - base),
        fileVersion: row.readUInt32LE(24) === 0xfeef04bd ? `${ms >>> 16}.${ms & 0xffff}.${ls >>> 16}.${ls & 0xffff}` : null,
        imageTimestamp: hex(row.readUInt32LE(16)), codeView: null,
      };
      const cvBytes = row.readUInt32LE(76), cvRva = row.readUInt32LE(80);
      if (cvBytes >= 24 && cvBytes <= 4096) {
        const cv = read(cvRva, cvBytes);
        if (cv.toString('ascii', 0, 4) === 'RSDS') {
          const guid = `${cv.readUInt32LE(4).toString(16).padStart(8, '0')}-${cv.readUInt16LE(8).toString(16).padStart(4, '0')}-${cv.readUInt16LE(10).toString(16).padStart(4, '0')}-${cv.subarray(12, 14).toString('hex')}-${cv.subarray(14, 20).toString('hex')}`.toUpperCase();
          const pdb = basename(cv.subarray(24).toString('utf8').split('\0')[0]);
          assert.ok(/^[\w .+-]{1,160}\.pdb$/i.test(pdb), 'unsafe PDB basename');
          module.codeView = { format: 'RSDS', guid, age: cv.readUInt32LE(20), pdb };
        }
      }
      result.faultingModule = module;
    }
    return result;
  } finally { fs.closeSync(fd); }
}

// CDB's kc command emits module/function names without parameters. Only exact
// lines between our markers are eligible; all registers/raw debugger output die
// in memory and are never returned or saved to an artifact.
export function sanitizeCleanStack(text) {
  const lines = text.split(/\r?\n/);
  const begin = lines.findIndex(line => line.trim() === 'FIND_ALL_STACK_BEGIN');
  const end = lines.findIndex((line, index) => index > begin && line.trim() === 'FIND_ALL_STACK_END');
  if (begin < 0 || end < 0) return [];
  return lines.slice(begin + 1, end).flatMap(line => {
    const match = line.match(/^\s*(?:[0-9a-f]{1,3}\s+)?([\w.-]+![\w?$@<>:.,~+`-]{1,240}|[\w.-]+\+0x[0-9a-f]+)\s*$/i);
    return match ? [match[1]] : [];
  }).slice(0, 64);
}

export function sanitizeDebuggerReport(text) {
  const begin = text.indexOf('\nFIND_ALL_CONTEXT_BEGIN');
  const end = text.indexOf('\nFIND_ALL_STACK_BEGIN', begin);
  if (begin < 0 || end < 0) return { contextInstructionAddress: null, frames: [] };
  const context = text.slice(begin, end);
  const match = context.match(/\brip=([0-9a-f`]{8,})\b/i);
  if (!match) return { contextInstructionAddress: null, frames: [] };
  return { contextInstructionAddress: `0x${BigInt('0x' + match[1].replaceAll('`', '')).toString(16)}`, frames: sanitizeCleanStack(text) };
}

// The documented plain k command includes addresses and optional source lines,
// but no function arguments. Discard address columns and the full source path.
export function sanitizeSourceStack(text) {
  if (!sanitizeDebuggerReport(text).contextInstructionAddress) return [];
  const lines = text.split(/\r?\n/);
  const begin = lines.findIndex(line => line.trim() === 'FIND_ALL_SOURCE_STACK_BEGIN');
  const end = lines.findIndex((line, index) => index > begin && line.trim() === 'FIND_ALL_SOURCE_STACK_END');
  if (begin < 0 || end < 0) return [];
  return lines.slice(begin + 1, end).flatMap(line => {
    const match = line.match(/^\s*(?:[0-9a-f]{1,3}\s+)?(?:[0-9a-f`]{8,17}\s+[0-9a-f`]{8,17}|\(Inline Function\)\s+[-`]{8,17})\s+([\w.-]+![\w?$@<>:.,~+`-]{1,240}|[\w.-]+\+0x[0-9a-f]+)(?:\s+\[([^\]\r\n]{1,1024})\s+@\s+(\d{1,7})\])?\s*$/i);
    if (!match) return [];
    const frame = { symbol: match[1] };
    if (match[2]) {
      const file = basename(match[2].trim());
      if (/^[\w.+-]{1,160}\.(?:cc|cpp|c|h|hpp|asm)$/i.test(file)) frame.source = { file, line: Number(match[3]) };
    }
    return [frame];
  }).slice(0, 32);
}
