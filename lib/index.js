// Optional Host half. Missing RC2 services leave current-conversation find usable.
import { createSearchHandler, SEARCH_PATH } from './search-host.js';
export const name = 'dsh-find-all';
export const inject = [];
export function apply(ctx) {
  ctx.inject(['connection', 'sessionQuery', 'workspaceRegistry'], child => {
    if (typeof child.sessionQuery.observeSession !== 'function' || typeof child.sessionQuery.listSessions !== 'function' || typeof child.sessionQuery.readTitleSnapshot !== 'function' || typeof child.connection.fetch?.register !== 'function') return;
    child.effect(() => {
      const handler = createSearchHandler(child);
      const stop = child.connection.fetch.register({ path: SEARCH_PATH, methods: ['POST'], requestBody: 'buffered', fetch: handler.fetch });
      return async () => { handler.dispose(); await stop(); };
    });
  });
}
