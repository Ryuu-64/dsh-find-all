import assert from 'node:assert/strict';

// Official rc2 ui-open-in-app starts its finite catalog request at activation,
// independently of shell rendering. Native resolution includes registry reads:
// https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/client/ui-open-in-app/src/client/controller.ts
// https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/host/open-in-app/src/index.ts
// Observe the original request. Never synthesize a probe or excuse failures.
export const CATALOG_URL = 'dsh-app://app/open-in-app/apps';
export function observeDesktopCatalog(page) {
  const records = new Map();
  const evidence = [];
  const matches = request => request.url() === CATALOG_URL && request.method() === 'GET' && request.resourceType() === 'fetch';
  const entry = request => {
    if (!records.has(request)) {
      const record = { route: CATALOG_URL, state: 'pending', observedUtc: new Date().toISOString() };
      records.set(request, record); evidence.push(record);
    }
    return records.get(request);
  };
  page.on('request', request => { if (matches(request)) entry(request); });
  page.on('requestfailed', request => {
    if (!matches(request)) return;
    const record = entry(request);
    record.state = 'failed'; record.error = 'original catalog request failed';
  });
  page.on('response', response => {
    const request = response.request();
    if (!matches(request)) return;
    const record = entry(request);
    record.status = response.status();
    void (async () => {
      try {
        assert.equal(response.status(), 200, 'original catalog request must return HTTP 200');
        const bodyError = await response.finished();
        assert.equal(bodyError, null, 'original catalog response body must complete');
        const body = await response.json();
        assert.ok(body && Array.isArray(body.apps) && body.apps.every(app => typeof app === 'string'), 'invalid native app catalog response');
        assert.notEqual(record.state, 'failed', 'catalog request failed during body completion');
        record.state = 'complete'; record.completedUtc = new Date().toISOString(); record.appCount = body.apps.length;
      } catch {
        record.state = 'failed'; record.error = 'original catalog response did not complete successfully with the documented schema';
      }
    })();
  });
  return {
    evidence,
    ready() {
      assert.ok(!evidence.some(record => record.state === 'failed'), 'native app catalog failed; preserve the original request and console evidence');
      return evidence.length > 0 && evidence.every(record => record.state === 'complete');
    },
  };
}
