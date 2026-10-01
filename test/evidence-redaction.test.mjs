import test from 'node:test';
import assert from 'node:assert/strict';
import { createRedactor } from '../scripts/compat/evidence.mjs';

test('public CI evidence strips tokens, cookies, URL queries and authentication headers', () => {
  const redact = createRedactor(new Set(['launch-value', 'cookie-value']));
  const raw = 'GET http://127.0.0.1:4195/?token=launch-value\nAuthorization: Bearer other-value\nCookie: cookie-value\nSet-Cookie: another-cookie\nurl https://user:password@example.test/path?access_token=extra#secret\nplain launch-value cookie-value';
  const safe = redact(raw);
  for (const value of ['launch-value', 'cookie-value', 'other-value', 'another-cookie', 'extra', '?', '#secret', 'user:password']) assert.ok(!safe.includes(value), value);
  assert.ok(safe.includes('http://127.0.0.1:4195/'));
  assert.ok(safe.includes('https://example.test/path'));
});
