import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readMinidumpMetadata, sanitizeCleanStack, sanitizeDebuggerReport } from './minidump-metadata.mjs';

function fixture(file) {
  const out = Buffer.alloc(1024);
  out.write('MDMP'); out.writeUInt32LE(42899, 4); out.writeUInt32LE(4, 8); out.writeUInt32LE(32, 12); out.writeUInt32LE(1700000000, 20);
  const entries = [[7, 56, 80], [6, 168, 136], [4, 112, 304], [9, 100, 800]];
  entries.forEach(([type, size, rva], i) => { out.writeUInt32LE(type, 32 + i * 12); out.writeUInt32LE(size, 36 + i * 12); out.writeUInt32LE(rva, 40 + i * 12); });
  out.writeUInt16LE(9, 80);
  out.writeUInt32LE(17, 136); out.writeUInt32LE(0x80000003, 144); out.writeBigUInt64LE(0x140001234n, 160);
  out.writeUInt32LE(1, 304);
  const mod = 308;
  out.writeBigUInt64LE(0x140000000n, mod); out.writeUInt32LE(0x10000, mod + 8); out.writeUInt32LE(0x12345678, mod + 16); out.writeUInt32LE(416, mod + 20);
  out.writeUInt32LE(0xfeef04bd, mod + 24); out.writeUInt32LE(2, mod + 32); out.writeUInt32LE(2, mod + 36);
  const name = Buffer.from('C:\\private-build\\DeepSeek Harness.exe', 'utf16le'); out.writeUInt32LE(name.length, 416); name.copy(out, 420);
  const cv = 600, pdb = Buffer.from('C:\\private-build\\electron.pdb\0');
  out.writeUInt32LE(24 + pdb.length, mod + 76); out.writeUInt32LE(cv, mod + 80);
  out.write('RSDS', cv); out.writeUInt32LE(0x11223344, cv + 4); out.writeUInt16LE(0x5566, cv + 8); out.writeUInt16LE(0x7788, cv + 10);
  Buffer.from('99aabbccddeeff00', 'hex').copy(out, cv + 12); out.writeUInt32LE(1, cv + 20); pdb.copy(out, cv + 24);
  out.write('SECRET_FROM_MEMORY_MUST_NEVER_APPEAR', 800);
  fs.writeFileSync(file, out); return out;
}

test('reads exact exception/module metadata without copying paths or memory streams', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'find-all-dump-test-'));
  try {
    const file = path.join(dir, 'synthetic.dmp'); fixture(file);
    const data = readMinidumpMetadata(file);
    assert.equal(data.exception.code, '0x80000003'); assert.equal(data.exception.threadId, 17);
    assert.equal(data.faultingModule.offset, '0x1234'); assert.equal(data.faultingModule.fileVersion, '0.2.0.2');
    assert.equal(data.faultingModule.name, 'DeepSeek Harness.exe');
    assert.deepEqual(data.faultingModule.codeView, { format: 'RSDS', guid: '11223344-5566-7788-99AA-BBCCDDEEFF00', age: 1, pdb: 'electron.pdb' });
    assert.doesNotMatch(JSON.stringify(data), /private-build|SECRET_FROM_MEMORY/);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('rejects truncated metadata and invalid module counts, and does not guess an unmapped IP', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'find-all-dump-test-'));
  try {
    const file = path.join(dir, 'synthetic.dmp');
    let out = fixture(file); out.writeUInt32LE(500000, 304); fs.writeFileSync(file, out); assert.throws(() => readMinidumpMetadata(file));
    fixture(file); fs.truncateSync(file, 150); assert.throws(() => readMinidumpMetadata(file));
    out = fixture(file); out.writeBigUInt64LE(0x999999999n, 160); fs.writeFileSync(file, out); assert.equal(readMinidumpMetadata(file).faultingModule, null);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('clean-stack sanitizer rejects registers, parameters, raw memory and outside-marker text', () => {
  const text = 'password=private\nrip=0000 rax=secret\nFIND_ALL_STACK_BEGIN\n00 electron!base::CheckError::Fail+0x12\n01 ntdll!RtlUserThreadStart+0x21\n02 electron!fn(password=secret)\n00000000 secret-memory\nFIND_ALL_STACK_END\nelectron!untrustedOutsideMarker';
  assert.deepEqual(sanitizeCleanStack(text), ['electron!base::CheckError::Fail+0x12', 'ntdll!RtlUserThreadStart+0x21']);
});

test('does not label a default-thread stack as exception context when ecxr failed', () => {
  const stack = '\nFIND_ALL_STACK_BEGIN\n00 electron!fault+0x1\nFIND_ALL_STACK_END';
  assert.deepEqual(sanitizeDebuggerReport('\nFIND_ALL_CONTEXT_BEGIN\nUnable to get context' + stack), { contextInstructionAddress: null, frames: [] });
  const value = sanitizeDebuggerReport('\nFIND_ALL_CONTEXT_BEGIN\nrax=private rsp=private rip=00000001`40001234\n' + stack);
  assert.deepEqual(value, { contextInstructionAddress: '0x140001234', frames: ['electron!fault+0x1'] });
  assert.doesNotMatch(JSON.stringify(value), /private|rax|rsp/);
});
