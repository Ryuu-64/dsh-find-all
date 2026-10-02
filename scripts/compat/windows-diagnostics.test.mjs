import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readAsarManifest } from './windows-diagnostics.mjs';

function archive(file, change = () => {}) {
  const manifest = Buffer.from(JSON.stringify({ name: '@deepseek-ai/dsh-desktop', version: '0.2.0-rc.2' }));
  const entry = { size: manifest.length, offset: '0' };
  change(entry);
  const text = Buffer.from(JSON.stringify({ files: { 'package.json': entry } }));
  const header = Buffer.alloc(8 + Math.ceil(text.length / 4) * 4);
  header.writeUInt32LE(header.length - 4, 0);
  header.writeInt32LE(text.length, 4);
  text.copy(header, 8);
  const size = Buffer.alloc(8);
  size.writeUInt32LE(4, 0); size.writeUInt32LE(header.length, 4);
  fs.writeFileSync(file, Buffer.concat([size, header, manifest]));
}

test('reads only the packed root manifest using the ASAR pickle offsets', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'find-all-asar-'));
  try {
    const file = path.join(dir, 'app.asar'); archive(file);
    assert.deepEqual(readAsarManifest(file), { name: '@deepseek-ai/dsh-desktop', version: '0.2.0-rc.2' });
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('refuses linked, unpacked, truncated and out-of-bounds root manifests', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'find-all-asar-'));
  try {
    const file = path.join(dir, 'app.asar');
    for (const change of [e => { e.link = '../private'; }, e => { e.unpacked = true; }, e => { e.offset = '-1'; }, e => { e.offset = '999999999'; }]) {
      archive(file, change); assert.throws(() => readAsarManifest(file));
    }
    archive(file); fs.truncateSync(file, 10); assert.throws(() => readAsarManifest(file));
  } finally { fs.rmSync(dir, { recursive: true }); }
});
