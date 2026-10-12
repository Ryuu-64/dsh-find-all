// Read-only RC2 transcript search. No FTS, private storage, or persistent index.
import { randomUUID } from 'node:crypto';

export const SEARCH_PATH = '/api/dsh-find-all/search';
const VERSION = 1;
const SCOPES = ['ordinary-unarchived', 'ordinary-including-archived'];
const MAX_SEARCHES = 8, MAX_CANDIDATES = 100000, TTL = 5 * 60 * 1000;
const BATCH_SESSIONS = 8, BATCH_MS = 100, CHUNK = 65536;
const MAX_EVENTS = 200000, MAX_TEXT = 32 * 1024 * 1024;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const abort = signal => signal.throwIfAborted();
const literal = query => new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: {
  'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
} });
class SearchError extends Error { constructor(code, status = 400) { super(code); this.status = status; } }

// Same escaped /giu rule as the existing in-conversation matcher. Original
// UTF-16 offsets survive Unicode simple folding; no SQL or user regex syntax.
export async function firstLiteralMatch(text, query, signal) {
  const matcher = literal(query);
  for (let start = 0; start < text.length; start += CHUNK) {
    abort(signal);
    // An overlap includes any match beginning before the next chunk. Two extra
    // code units protect surrogate boundaries; no normalization is performed.
    let end = Math.min(text.length, start + CHUNK + query.length + 2);
    let from = start;
    if (from > 0 && /[\uDC00-\uDFFF]/u.test(text[from])) from--;
    if (end < text.length && /[\uDC00-\uDFFF]/u.test(text[end])) end++;
    matcher.lastIndex = 0;
    const match = matcher.exec(text.slice(from, end));
    if (match) return { start: from + match.index, end: from + match.index + match[0].length };
    await tick();
  }
  return null;
}
function excerpt(text, range) {
  let start = Math.max(0, range.start - 80), end = Math.min(text.length, range.end + 120);
  if (start && /[\uDC00-\uDFFF]/u.test(text[start])) start--;
  if (end < text.length && /[\uDC00-\uDFFF]/u.test(text[end])) end++;
  const prefix = start ? '…' : '';
  return { snippet: prefix + text.slice(start, end) + (end < text.length ? '…' : ''),
    ranges: [{ start: prefix.length + range.start - start, end: prefix.length + range.end - start }] };
}

// RC2 Chat is an append-origin transcript, NOT the model's current surface:
// compaction hides neither earlier human prompts nor settled assistant text.
// Assistant nodes are per turn:step; a retry clears the preceding settlement.
export async function scanObservation(observation, query, signal) {
  const events = observation.events;
  if (events.length > MAX_EVENTS) return { limited: true };
  const users = [], steps = new Map();
  let textSize = 0;
  for (let i = 0; i < events.length; i++) {
    if (i % 256 === 0) { await tick(); abort(signal); }
    const event = events[i], data = event.data;
    if (!data) continue;
    const key = `${data.turn}:${data.step}`;
    if (event.type === 'step/start' || event.type === 'llm/retry') { steps.delete(key); continue; }
    if (event.surfaceOp !== 'append') continue;
    if (event.type === 'user/message' && data.source?.kind === 'user') users.push(event);
    else if (event.type === 'assistant/message') steps.set(key, event);
  }
  const visible = [...users, ...steps.values()].sort((a, b) => a.seq - b.seq);
  for (const event of visible) {
    abort(signal);
    const message = event.type === 'user/message' ? event.data : event.data.message;
    if (!message || typeof message.id !== 'string' || !Array.isArray(message.content)) throw new SearchError('invalid-transcript');
    // User text is displayed joined; assistant Markdown text blocks remain
    // separate, exactly as the existing full-history reader treats them.
    const blocks = event.type === 'user/message'
      ? [{ text: message.content.filter(part => part?.type === 'text').map(part => part.text).join(''), index: 0 }]
      : message.content.flatMap((part, index) => part?.type === 'text' ? [{ text: part.text, index }] : []);
    for (const block of blocks) {
      if (typeof block.text !== 'string') throw new SearchError('invalid-transcript');
      textSize += block.text.length;
      if (textSize > MAX_TEXT) return { limited: true };
      const range = await firstLiteralMatch(block.text, query, signal);
      if (range) return { ...excerpt(block.text, range), message: {
        messageId: message.id, seq: event.seq, contentIndex: block.index, cursor: observation.cursor,
      } };
    }
  }
  return null;
}

/** Leases last one batch. State holds IDs, titles, query and one bounded replay page for at most five minutes. */
export function createSearchHandler(ctx) {
  const searches = new Map();
  const drop = (id, state) => {
    if (searches.get(id) !== state) return;
    searches.delete(id); clearTimeout(state.timer); state.controller.abort();
  };
  function touch(id, state) {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => drop(id, state), TTL); state.timer.unref?.();
  }
  const archived = () => new Set(ctx.workspaceRegistry.archivedSessionIds);
  const allowed = (header, archive, scope) => header && typeof header.cwd === 'string' && header.origin !== 'subagent' && (scope === 'ordinary-including-archived' || !archive.has(header.id));
  async function page(id, state, signal) {
    const items = [], started = Date.now();
    const records = await ctx.sessionQuery.listSessions(signal);
    const current = new Map(records.map(record => [record.header.id, record.header]));
    let processed = 0;
    while (state.offset < state.candidates.length && processed < BATCH_SESSIONS && (!processed || Date.now() - started < BATCH_MS)) {
      abort(signal);
      const row = state.candidates[state.offset];
      let item = null, observation;
      let title = row.title, titleMatch = literal(state.query).test(title);
      try {
        if (!allowed(current.get(row.id), archived(), state.scope)) { state.skipped++; }
        else {
          let match = null;
          if (state.mode === 'title-body') {
            observation = await ctx.sessionQuery.observeSession(row.id, { signal, projectionMode: 'none' });
            abort(signal);
            if (observation.header.id !== row.id || !allowed(observation.header, archived(), state.scope)) state.skipped++;
            else {
              const savedTitle = observation.events.findLast(event => event.type === 'session/title')?.data?.title;
              if (typeof savedTitle === 'string') title = savedTitle;
              titleMatch = literal(state.query).test(title);
              match = await scanObservation(observation, state.query, signal);
              if (match?.limited) { state.skipped++; match = null; }
              if (titleMatch || match) item = { sessionId: row.id, title, titleMatch, bodyMatch: !!match,
                snippet: match?.snippet || '', ranges: match?.ranges || [], ...(match?.message ? { message: match.message } : {}) };
            }
          } else {
            // Native cold list metadata may have no cached title. A public
            // title read is required for correctness, even in title-only mode.
            const saved = await ctx.sessionQuery.readTitleSnapshot(row.id, signal);
            abort(signal);
            if (saved.session.id !== row.id || !allowed(saved.session, archived(), state.scope)) state.skipped++;
            else {
              if (typeof saved.title?.title === 'string') title = saved.title.title;
              titleMatch = literal(state.query).test(title);
              if (titleMatch) item = { sessionId: row.id, title, titleMatch: true, bodyMatch: false, snippet: '', ranges: [] };
            }
          }
          // Archive state can change while cold I/O or chunk scanning yields.
          if (item && allowed(current.get(row.id), archived(), state.scope)) items.push(item);
          else if (item) state.skipped++;
        }
      } catch (error) {
        abort(signal); state.failed++;
        if (titleMatch && allowed(current.get(row.id), archived(), state.scope)) items.push({ sessionId: row.id, title, titleMatch: true, bodyMatch: false, snippet: '', ranges: [] });
      } finally { observation?.[Symbol.dispose](); }
      state.offset++; processed++;
      await tick();
    }
    abort(signal);
    // Recheck immediately before sending snippets; an earlier listing is not
    // sufficient when a session is deleted or archived during a cold read.
    const fresh = new Map((await ctx.sessionQuery.listSessions(signal)).map(record => [record.header.id, record.header]));
    const archive = archived();
    const visibleItems = items.filter(item => allowed(fresh.get(item.sessionId), archive, state.scope)).map(item => ({ ...item, archived: archive.has(item.sessionId) }));
    state.skipped += items.length - visibleItems.length;
    abort(signal);
    const complete = state.offset === state.candidates.length;
    return { version: VERSION, requestId: id, scope: state.scope, items: visibleItems, cursor: complete ? null : randomUUID(),
      scanned: state.offset, total: state.candidates.length, failed: state.failed, skipped: state.skipped, complete };
  }
  async function handle(request) {
    let state, id, requestAbort;
    try {
      if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
      const raw = await request.text();
      if (raw.length > 16 * 1024 * 1024) throw new SearchError('request-too-large', 413);
      let input;
      try { input = JSON.parse(raw); } catch { throw new SearchError('invalid-request'); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new SearchError('invalid-request');
      id = input.requestId;
      if (input.version !== VERSION || typeof id !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/u.test(id)) throw new SearchError('invalid-request');
      state = searches.get(id);
      if (input.action === 'cancel') { if (state) drop(id, state); return json({ version: VERSION, cancelled: true }); }
      if (!['start', 'next'].includes(input.action) || typeof input.query !== 'string' || !input.query.trim() || input.query !== input.query.trim() || input.query.length > 500 || input.query.includes('\0') || !['title', 'title-body'].includes(input.mode) || !SCOPES.includes(input.scope)) throw new SearchError('invalid-request');
      if (input.action === 'start') {
        if (state) throw new SearchError('search-already-exists', 409);
        if (searches.size >= MAX_SEARCHES) throw new SearchError('too-many-searches', 429);
        if (!Array.isArray(input.sessionIds) || !Array.isArray(input.catalog) || input.sessionIds.length > MAX_CANDIDATES || input.catalog.length !== input.sessionIds.length) throw new SearchError('invalid-catalog');
        const titles = new Map();
        for (const row of input.catalog) {
          if (!row || typeof row.id !== 'string' || row.id.length > 200 || typeof row.title !== 'string' || row.title.length > 10000 || titles.has(row.id)) throw new SearchError('invalid-catalog');
          titles.set(row.id, row.title);
        }
        if (new Set(input.sessionIds).size !== input.sessionIds.length || input.sessionIds.some(sid => typeof sid !== 'string' || !titles.has(sid))) throw new SearchError('invalid-catalog');
        state = { query: input.query, mode: input.mode, scope: input.scope, candidates: input.sessionIds.map(sid => ({ id: sid, title: titles.get(sid) })), offset: 0, failed: 0, skipped: 0, controller: new AbortController(), busy: false, cursor: null, previousCursor: null, response: null, timer: null };
        searches.set(id, state); touch(id, state);
      } else {
        if (!state) throw new SearchError('search-expired', 410);
        if (state.query !== input.query || state.mode !== input.mode || state.scope !== input.scope || typeof input.cursor !== 'string') throw new SearchError('cursor-mismatch', 409);
        if (state.busy) throw new SearchError('search-busy', 409);
        // A retried previous page is replayed, not consumed again.
        if (input.cursor === state.previousCursor && state.response) {
          state.busy = true;
          try {
            const replaySignal = AbortSignal.any([request.signal, state.controller.signal]);
            const current = new Map((await ctx.sessionQuery.listSessions(replaySignal)).map(record => [record.header.id, record.header]));
            const archive = archived();
            if (state.response.items.some(item => !allowed(current.get(item.sessionId), archive, state.scope))) {
              drop(id, state); throw new SearchError('search-stale', 410);
            }
            abort(replaySignal); touch(id, state);
            return json({ ...state.response, items: state.response.items.map(item => ({ ...item, archived: archive.has(item.sessionId) })) });
          } finally { state.busy = false; }
        }
        if (input.cursor !== state.cursor || state.cursor === null) throw new SearchError('cursor-mismatch', 409);
      }
      state.busy = true;
      requestAbort = () => drop(id, state);
      request.signal.addEventListener('abort', requestAbort, { once: true });
      if (request.signal.aborted) requestAbort();
      const result = await page(id, state, state.controller.signal);
      state.previousCursor = input.action === 'next' ? input.cursor : null;
      state.cursor = result.cursor; state.response = result; state.busy = false; touch(id, state);
      return json(result);
    } catch (error) {
      // Invalid requests must never cancel a different live request/generation.
      if (requestAbort && state) drop(id, state);
      return json({ error: error instanceof SearchError ? error.message : request.signal.aborted ? 'cancelled' : 'search-failed' }, error instanceof SearchError ? error.status : request.signal.aborted ? 499 : 503);
    } finally { if (requestAbort) request.signal.removeEventListener('abort', requestAbort); }
  }
  return { fetch: handle, dispose() { for (const [id, state] of searches) drop(id, state); } };
}
