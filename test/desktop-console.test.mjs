import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDesktopConsole } from '../scripts/compat/desktop-console.mjs';

const endpoint = 'dsh-app://app/plugins/events';
const start = '2026-10-02T06:11:52.981Z';
function fixture() {
  return {
    consoleErrors: ['Failed to load resource: net::ERR_FAILED'],
    consoleEvents: [{ text: 'Failed to load resource: net::ERR_FAILED', utc: '2026-10-02T06:12:55.296Z',
      phase: 'closing', launchUtc: start, pageId: 1, locationRoute: endpoint, exactHmrLocation: true, truncated: false }],
    networkFailures: [{ utc: '2026-10-02T06:12:55.296Z', phase: 'closing', launchUtc: start, pageId: 1,
      route: endpoint, exactHmrUrl: true, resourceType: 'eventsource', error: 'net::ERR_FAILED' }],
    launches: [{ startUtc: start, closingUtc: '2026-10-02T06:12:55.270Z', closedUtc: '2026-10-02T06:12:55.418Z' }],
  };
}
test('only precisely correlated intentional HMR close is expected, with unchanged raw evidence', () => {
  const input = fixture(), before = structuredClone(input), result = classifyDesktopConsole(input);
  assert.equal(result.expectedTeardown.length, 1);
  assert.equal(result.unexpected.length, 0);
  assert.deepEqual(input, before);
  assert.deepEqual(result.expectedTeardown[0].network, input.networkFailures[0]);
});
for (const [name, mutate] of Object.entries({
  'before quit': x => { x.consoleEvents[0].utc = '2026-10-02T06:12:55.269Z'; },
  'running phase': x => { x.consoleEvents[0].phase = 'running'; },
  'after close': x => { x.consoleEvents[0].utc = '2026-10-02T06:12:55.419Z'; },
  'missing network event': x => { x.networkFailures = []; },
  'different page': x => { x.networkFailures[0].pageId = 2; },
  'different launch': x => { x.networkFailures[0].launchUtc = 'other'; },
  'different route': x => { x.networkFailures[0].route = 'dsh-app://app/plugins/module'; },
  'query-bearing URL': x => { x.networkFailures[0].exactHmrUrl = false; },
  'missing console location': x => { delete x.consoleEvents[0].locationRoute; },
  'nonexact console URL': x => { x.consoleEvents[0].exactHmrLocation = false; },
  'script resource': x => { x.networkFailures[0].resourceType = 'script'; },
  '503 response': x => { x.networkFailures[0].status = 503; delete x.networkFailures[0].error; },
  'paired HTTP failure': x => { x.networkFailures.push({ ...x.networkFailures[0], status: 503 }); },
  'different network error': x => { x.networkFailures[0].error = 'net::ERR_ABORTED'; },
  'ambiguous network events': x => { x.networkFailures.push({ ...x.networkFailures[0] }); },
  'missing clean close': x => { delete x.launches[0].closedUtc; },
  'truncated error': x => { x.consoleEvents[0].truncated = true; },
  'uncorrelated late request': x => { x.networkFailures[0].utc = '2026-10-02T06:12:55.410Z'; },
  'module startup fatal': x => { x.consoleErrors[0] = x.consoleEvents[0].text = 'web boot: 64 entries did not activate'; },
})) test(`console tripwire rejects ${name}`, () => {
  const input = fixture(); mutate(input);
  assert.equal(classifyDesktopConsole(input).unexpected.length, 1);
});
test('one request cannot excuse two identical console events', () => {
  const input = fixture(); input.consoleErrors.push(input.consoleErrors[0]); input.consoleEvents.push({ ...input.consoleEvents[0] });
  assert.equal(classifyDesktopConsole(input).unexpected.length, 1);
});
