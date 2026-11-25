// Optional Host half. Missing RC2 services leave current-conversation find usable.
import z from '@deepseek-ai/schemastery';
import { createSearchHandler, SEARCH_PATH } from './search-host.js';
export const name = 'dsh-find-all';
export const inject = [];
export const Config = z.object({
  defaultTitleOnly: z.boolean().default(false).volatile(),
  defaultIncludeArchived: z.boolean().default(false).volatile(),
  showSidebarEntry: z.boolean().default(true).volatile(),
});
export function apply(ctx) {
  ctx.inject(['settings'], child => {
    if (typeof child.settings?.configure !== 'function') return;
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
  });
  ctx.inject(['connection', 'sessionQuery', 'workspaceRegistry'], child => {
    if (typeof child.sessionQuery.observeSession !== 'function' || typeof child.sessionQuery.listSessions !== 'function' || typeof child.sessionQuery.readTitleSnapshot !== 'function' || typeof child.connection.fetch?.register !== 'function') return;
    child.effect(() => {
      const handler = createSearchHandler(child);
      const stop = child.connection.fetch.register({ path: SEARCH_PATH, methods: ['POST'], requestBody: 'buffered', fetch: handler.fetch });
      return async () => { handler.dispose(); await stop(); };
    });
  });
}
