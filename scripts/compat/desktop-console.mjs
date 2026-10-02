// Exact official rc2 shutdown contract:
// https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/apps/desktop/src/main.ts#L1241-L1257
// https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/client/hmr/src/index.ts#L200-L206
// Backend shutdown destroys the open SSE response before the renderer exits.
// Keep raw evidence in the report. Missing or ambiguous correlation fails closed.
export function classifyDesktopConsole({ consoleErrors, consoleEvents, networkFailures, launches }) {
  const expectedTeardown = [], unexpected = [];
  const used = new Set();
  const endpoint = 'dsh-app://app/plugins/events';
  for (let index = 0; index < consoleErrors.length; index++) {
    const event = consoleEvents[index];
    const launch = launches.find(item => item.startUtc === event?.launchUtc);
    const close = Date.parse(launch?.closingUtc), closed = Date.parse(launch?.closedUtc);
    const inClose = value => value?.phase === 'closing' && Number.isFinite(close) && Number.isFinite(closed)
      && Date.parse(value.utc) >= close && Date.parse(value.utc) <= closed;
    const matches = networkFailures.map((failure, networkIndex) => ({ failure, networkIndex })).filter(({ failure, networkIndex }) =>
      !used.has(networkIndex) && failure.launchUtc === event?.launchUtc && failure.pageId === event?.pageId
      && failure.route === endpoint && failure.exactHmrUrl === true && failure.resourceType === 'eventsource' && failure.error === 'net::ERR_FAILED'
      && inClose(failure) && Math.abs(Date.parse(failure.utc) - Date.parse(event?.utc)) <= 100);
    const failedResponse = networkFailures.some(failure => failure.launchUtc === event?.launchUtc
      && failure.pageId === event?.pageId && failure.route === endpoint && failure.status >= 400);
    if (!failedResponse && event?.text === consoleErrors[index] && !event.truncated && event.pageId !== undefined
      && event.text === 'Failed to load resource: net::ERR_FAILED' && event.locationRoute === endpoint && event.exactHmrLocation === true
      && inClose(event) && matches.length === 1) {
      used.add(matches[0].networkIndex);
      expectedTeardown.push({ consoleIndex: index, event, network: matches[0].failure,
        closingUtc: launch.closingUtc, closedUtc: launch.closedUtc,
        reason: 'Exact HMR EventSource cancellation during intentional application close' });
    } else unexpected.push({ consoleIndex: index, text: consoleErrors[index], event });
  }
  return { expectedTeardown, unexpected };
}
