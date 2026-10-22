import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8');
const start = source.indexOf('function diagnosticCode(code)');
const end = source.indexOf('function diagnosticCount(value)', start);
const diagnosticCode = vm.runInNewContext(`(${source.slice(start, end).trim()})`);

test('modern user projection failures retain safe actionable codes', () => {
  for (const code of ['user-renderer-unavailable', 'user-projection-unavailable', 'user-session-unavailable', 'invalid-user-facts', 'invalid-user-projection', 'unsupported-user-node']) {
    assert.equal(diagnosticCode(code), code);
  }
});

test('arbitrary error text cannot enter tooltip or copied projection codes', () => {
  for (const code of [null, undefined, '', 'SYNTHETIC_FAKE_SECRET_ONLY', 'path /private/fake', { message: 'SYNTHETIC_FAKE_SECRET_ONLY' }]) {
    assert.equal(diagnosticCode(code), 'operation-failed');
  }
});
