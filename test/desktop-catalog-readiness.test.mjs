import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { CATALOG_URL, observeDesktopCatalog } from '../scripts/compat/desktop-catalog-readiness.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(options = {}) {
  const page = new EventEmitter(), tracker = observeDesktopCatalog(page);
  const request = { url: () => options.url || CATALOG_URL, method: () => options.method || 'GET', resourceType: () => options.type || 'fetch' };
  const response = { request: () => request, status: () => options.status ?? 200, finished: async () => options.finished ?? null, json: async () => options.body ?? { apps: ['explorer'] } };
  return { page, tracker, request, response };
}
test('catalog readiness requires original request response and body completion, not DOM timing', async () => {
  const { page, tracker, request, response } = fixture();
  let finish; response.finished = () => new Promise(resolve => { finish = resolve; });
  assert.equal(tracker.ready(), false);
  page.emit('request', request); page.emit('response', response);
  assert.equal(tracker.ready(), false);
  finish(null); await tick();
  assert.equal(tracker.ready(), true);
  assert.equal(tracker.evidence[0].appCount, 1);
  assert.equal(tracker.evidence[0].status, 200);
  assert.equal(tracker.evidence[0].state, 'complete');
});
test('response observation is sufficient when attachment occurs after request dispatch', async () => {
  const { page, tracker, response } = fixture(); page.emit('response', response); await tick();
  assert.equal(tracker.ready(), true);
});
for (const [name, options] of Object.entries({
  '503': { status: 503 }, 'body error': { finished: new Error('closed') },
  'wrong schema': { body: { apps: [{ id: 'explorer' }] } },
  'missing apps': { body: {} },
})) test(`catalog readiness fails closed on ${name}`, async () => {
  const { page, tracker, response } = fixture(options); page.emit('response', response); await tick();
  assert.throws(() => tracker.ready(), /catalog failed/);
});
test('late request failure cannot be overwritten by successful body processing', async () => {
  const { page, tracker, request, response } = fixture();
  let finish; response.finished = () => new Promise(resolve => { finish = resolve; });
  page.emit('response', response); page.emit('requestfailed', request); finish(null); await tick();
  assert.throws(() => tracker.ready(), /catalog failed/);
});
for (const method of ['finished', 'json']) test(`catalog readiness preserves ${method} rejection`, async () => {
  const { page, tracker, response } = fixture();
  response[method] = async () => { throw new Error('original response failed'); };
  page.emit('response', response); await tick();
  assert.throws(() => tracker.ready(), /catalog failed/);
});
test('new pending catalog request revokes readiness and failure remains a failure', async () => {
  const { page, tracker, request, response } = fixture();
  page.emit('response', response); await tick(); assert.equal(tracker.ready(), true);
  const next = { ...request }; page.emit('request', next); assert.equal(tracker.ready(), false);
  page.emit('requestfailed', next); assert.throws(() => tracker.ready(), /catalog failed/);
});
for (const options of [{ url: CATALOG_URL + '?probe=1' }, { method: 'POST' }, { type: 'eventsource' }])
  test(`lookalike request is not a catalog readiness signal: ${JSON.stringify(options)}`, async () => {
    const { page, tracker, request, response } = fixture(options); page.emit('request', request); page.emit('response', response); await tick();
    assert.equal(tracker.ready(), false); assert.equal(tracker.evidence.length, 0);
  });
