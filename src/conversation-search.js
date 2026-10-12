// Explicit, cancellable Host batches. No session activation until a row is opened.
// Document-relative, like official session-log-export, for hosted subpaths.
const ENDPOINT = "api/dsh-find-all/search";
const SCOPE = "ordinary-unarchived";
const PAGE_MATCH_TARGET = 20;
const EMPTY = { items: [], cursor: null, scanned: 0, total: 0, failed: 0, skipped: 0, complete: false };
const zh = typeof navigator !== 'undefined' && /^zh/i.test(navigator.language || '');
const L = zh ? {
  title: '对话全文搜索', close: '关闭对话全文搜索', placeholder: '搜索标题和正文…', titlePlaceholder: '搜索标题…',
  scope: '所有工作区 · 未归档',
  scopeDetails: '搜索当前连接服务中、所有工作区的普通非空未归档对话；不包含子代理对话。',
  help: '搜索说明', shown: n => `${n}个对话`, page: n => `已显示${n}个对话 · 还有未搜索的对话`,
  unavailableShort: '搜索服务暂不可用', stoppedShort: '搜索已停止', partialShort: '搜索结果不完整', noMatchesYet: '暂未找到匹配的对话',
  semantics: '字面子串匹配，不区分大小写；正文含原始 Markdown，不含思考或工具内容。',
  handoff: '打开对话后继续用此关键词查找，不直接跳到摘要原句。原始 Markdown 位置不是页面位置；跨格式的可见短语可能不匹配，会话内查找结果也可能不同。',
  snapshot: '候选列表在开始时固定；新增或修改对话后，在搜索框按 Enter 刷新。',
  emptyQuery: '输入关键词开始搜索。', invalidShort: '请调整搜索关键词', invalid: '关键词最多 500 个字符，不能包含空字符。',
  pending: '正在扫描对话…', unavailable: '完整搜索服务不可用；请检查服务端扩展和连接后重试。已确认的结果保留。',
  stopped: '搜索已停止；保留已确认的结果，扫描尚未完成。', failedList: '会话列表暂不可用，请重试。',
  loading: '正在读取会话列表…', unsupported: '当前宿主暂不支持对话全文搜索。',
  noMatches: '未找到匹配的对话。',
  more: '继续加载结果', titleOnly: '仅标题', progress: (n, total) => `已扫描 ${n} / ${total} 个对话`, partial: (failed, skipped) => `结果不完整：${failed} 个读取失败，${skipped} 个跳过。`, incomplete: '尚有对话未扫描。', retry: '重试', cancel: '停止搜索',
  untitled: '未命名对话',
  order: '自动扫描并逐步显示，直到本页找到至少 20 个匹配对话或扫描完毕；继续加载可查下一页。结果按扫描顺序显示。',
  missing: '该对话已不在可打开的列表中，可能已归档、删除或失去访问权限。',
  opening: '正在打开对话…', openFailed: '未能打开该对话。可以返回结果重试。',
  chatNeeded: '未能接入该对话的聊天正文。请切换到 Chat／聊天视图，再从搜索结果重试。',
  interrupted: '已停止继续查找；可重新打开搜索结果。', back: '返回搜索结果',
} : {
  title: 'Full-text conversation search', close: 'Close full-text conversation search', placeholder: 'Search titles and message text…', titlePlaceholder: 'Search titles…',
  scope: 'All workspaces · Unarchived',
  scopeDetails: 'Searches ordinary, nonempty, unarchived conversations across all workspaces on the connected server. Subagent conversations are excluded.',
  help: 'Search help', shown: n => `${n} conversations`, page: n => `${n} conversations shown · More conversations remain unsearched`,
  unavailableShort: 'Search service unavailable', stoppedShort: 'Search stopped', partialShort: 'Search results are incomplete', noMatchesYet: 'No matching conversations yet',
  semantics: 'Case-insensitive literal substring search. Body text includes raw Markdown, but excludes reasoning and tool content.',
  handoff: 'Open a conversation to continue finding this query, without an exact-message jump. Raw Markdown offsets are not page positions; phrases crossing formatting may not match, and in-conversation find may differ.',
  snapshot: 'Candidates are fixed when the scan starts. Press Enter in the search field to refresh after adding or changing conversations.',
  emptyQuery: 'Enter a query to search.', invalidShort: 'Adjust your search query', invalid: 'Use at most 500 characters, without null characters.',
  pending: 'Scanning conversations…', unavailable: 'Full search service unavailable. Check the server extension and connection, then retry. Confirmed results are kept.',
  stopped: 'Search stopped. Confirmed results are kept; the scan is incomplete.', failedList: 'Conversation list unavailable. Try again.',
  loading: 'Loading conversation list…', unsupported: 'Full-text conversation search is unsupported on this Host.',
  noMatches: 'No matching conversations found.',
  more: 'Load more results', titleOnly: 'Titles only', progress: (n, total) => `${n} / ${total} conversations scanned`, partial: (failed, skipped) => `Incomplete results: ${failed} failed, ${skipped} skipped.`, incomplete: 'Some conversations remain unscanned.', retry: 'Retry', cancel: 'Stop search',
  untitled: 'Untitled conversation',
  order: 'Automatically scans and shows matches until at least 20 more conversations are found or the scan finishes. Load more results for the next page. Results follow scan order.',
  missing: 'This conversation is no longer openable. It may be archived, deleted, or inaccessible.',
  opening: 'Opening conversation…', openFailed: 'Could not open this conversation. Return to the results to retry.',
  chatNeeded: 'The conversation’s chat content is unavailable. Switch to Chat view, then retry from the search results.',
  interrupted: 'Find handoff stopped. You can reopen the search results.', back: 'Back to search results',
};

function catalog(sessions, workspaces) {
  const list = sessions?.list?.getSnapshot?.();
  const spaces = workspaces?.list?.getSnapshot?.();
  if (!list || !spaces || !Array.isArray(list.ids) || !list.byId || !Array.isArray(spaces.items) || !Array.isArray(spaces.archivedSessionIds)) return { status: 'unsupported', rows: [] };
  if (spaces.state === 'error') return { status: 'failedList', rows: [] };
  if (list.phase !== 'ready' || spaces.phase !== 'ready' || spaces.state === 'loading') return { status: 'loading', rows: [] };
  const archived = new Set(spaces.archivedSessionIds);
  const names = new Map();
  for (const space of spaces.items) for (const id of space.sessionIds || []) if (!names.has(id)) names.set(id, typeof space.title === 'string' ? space.title : '');
  const rows = [];
  for (const id of list.ids) {
    const row = list.byId[id];
    if (!row || row.id !== id || row.origin === 'subagent' || row.blank || archived.has(id)) continue;
    rows.push({ id, title: typeof row.title === 'string' ? row.title.trim() : '', updatedAt: Number.isFinite(row.updatedAt) ? row.updatedAt : 0, workspace: names.get(id) || '', selected: row.retainedBy?.mainView > 0 });
  }
  return { status: 'ready', rows };
}

function merge(rows, content) {
  const valid = new Map(rows.map(row => [row.id, row]));
  return { ...content, items: content.items.filter(item => valid.has(item.sessionId)).map(item => ({ ...valid.get(item.sessionId), ...item })) };
}

function literalMatcher(query) {
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
}
function literalRanges(text, query) {
  const needle = query.trim(), ranges = [];
  if (needle) for (const match of text.matchAll(literalMatcher(needle))) ranges.push({ start: match.index, end: match.index + match[0].length });
  return ranges;
}
function highlightedText(h, text, ranges) {
  const parts = [];
  let cursor = 0;
  for (const { start, end } of ranges) {
    parts.push(text.slice(cursor, start), h('mark', { key: start, className: 'dsh-find-all-conversations-match' }, text.slice(start, end)));
    cursor = end;
  }
  parts.push(text.slice(cursor));
  return parts;
}
function searchValue(value, requestId, query) {
  if (!value || value.version !== 1 || value.requestId !== requestId || !Array.isArray(value.items) ||
      !(value.cursor === null || (typeof value.cursor === 'string' && value.cursor.length > 0)) ||
      typeof value.complete !== 'boolean' || value.complete !== (value.cursor === null) ||
      ['scanned', 'total', 'failed', 'skipped'].some(key => !Number.isSafeInteger(value[key]) || value[key] < 0) || value.scanned > value.total || (value.complete && value.scanned !== value.total)) return null;
  const items = [];
  for (const row of value.items) {
    if (!row || typeof row.sessionId !== 'string' || typeof row.titleMatch !== 'boolean' || typeof row.bodyMatch !== 'boolean' ||
        !(row.titleMatch || row.bodyMatch) || (row.title !== undefined && typeof row.title !== 'string') || typeof row.snippet !== 'string' || !Array.isArray(row.ranges)) return null;
    let last = 0;
    for (const range of row.ranges) {
      if (!range || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < last || range.end <= range.start ||
          range.end > row.snippet.length || !literalRanges(row.snippet.slice(range.start, range.end), query).some(match => match.start === 0 && match.end === range.end - range.start)) return null;
      last = range.end;
    }
    items.push({ sessionId: row.sessionId, ...(row.title !== undefined ? { title: row.title } : {}), titleMatch: row.titleMatch, bodyMatch: row.bodyMatch, snippet: row.snippet, ranges: row.ranges });
  }
  return { items, cursor: value.cursor, scanned: value.scanned, total: value.total, failed: value.failed, skipped: value.skipped, complete: value.complete };
}

export function installConversationSearch(ctx, react, ui, bridge) {
  const h = react.createElement;
  let services = null, mounted = true, epoch = 0, request = null, timer = 0;
  let scanId = null, mode = 'title-body';
  let open = false, query = '', body = 'idle', content = EMPTY, scroll = 0, notice = '', focusOrigin = null;
  let handoff = null, handoffTimer = 0, handoffStops = [], listStops = [], lastCatalogStatus = '';
  const listeners = new Set();
  let revision = 0;
  const publish = () => { revision++; for (const listener of listeners) listener(); };
  const currentCatalog = () => {
    try { return services ? catalog(ctx.sessions, services.workspaces) : { status: 'unsupported', rows: [] }; }
    catch (_) { return { status: 'failedList', rows: [] }; }
  };
  const cancelRequest = () => {
    epoch++; clearTimeout(timer); timer = 0; request?.abort(); request = null;
    const id = scanId; scanId = null;
    if (id) {
      content = { ...content, cursor: null };
      try { Promise.resolve(fetch(ENDPOINT, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 1, action: 'cancel', requestId: id }), keepalive: true })).catch(() => {}); } catch (_) {}
    }
  };
  function cancelHandoff(message = '') {
    if (!handoff) return;
    handoff = null; clearTimeout(handoffTimer); handoffTimer = 0;
    for (const stop of handoffStops) stop(); handoffStops = [];
    notice = message; publish();
  }
  function stopLists() { for (const stop of listStops) stop(); listStops = []; }
  function watchLists() {
    stopLists();
    if (!services || !open) return;
    const changed = () => {
      const status = currentCatalog().status;
      if (status !== 'ready' && (scanId || body === 'pending')) {
        const unfinished = body === 'pending' || !content.complete;
        cancelRequest(); if (unfinished) body = 'stopped';
      }
      const wasReady = lastCatalogStatus === 'ready'; lastCatalogStatus = status;
      if (!wasReady && status === 'ready' && body === 'idle') schedule();
      publish();
    };
    listStops = [ctx.sessions.list.subscribe(changed), services.workspaces.list.subscribe(changed)];
    changed();
  }
  function schedule() {
    cancelRequest(); content = EMPTY;
    const q = query.trim();
    body = !q ? 'idle' : q.length > 500 || q.includes('\0') ? 'invalid' : 'pending';
    if (body !== 'pending' || !open) { publish(); return; }
    if (currentCatalog().status !== 'ready') { body = 'idle'; publish(); return; }
    timer = setTimeout(() => { timer = 0; scanBatch(false); }, 250);
    publish();
  }
  async function scanBatch(next) {
    if (!mounted || !open || request || currentCatalog().status !== 'ready') return;
    const q = query.trim(), searchMode = mode, owner = services, generation = epoch;
    if (next && (!scanId || !content.cursor)) return;
    const controller = new AbortController(); request = controller;
    const alive = () => mounted && open && services === owner && epoch === generation && request === controller && query.trim() === q && mode === searchMode && !controller.signal.aborted;
    const target = content.items.length + PAGE_MATCH_TARGET;
    body = 'pending'; publish();
    if (!alive()) return;
    try {
      const id = next ? scanId : crypto.randomUUID(); scanId = id;
      const rows = currentCatalog().rows, seenCursors = new Set();
      if (content.cursor) seenCursors.add(content.cursor);
      let continuation = next;
      while (alive()) {
        const previousScanned = content.scanned, previousTotal = content.total;
        const payload = { version: 1, action: continuation ? 'next' : 'start', requestId: id, query: q, mode: searchMode, scope: SCOPE,
          ...(continuation ? { cursor: content.cursor } : { sessionIds: rows.map(row => row.id), catalog: rows.map(row => ({ id: row.id, title: row.title })) }) };
        const response = await fetch(ENDPOINT, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal });
        if (!alive()) return;
        if (!response.ok) throw new Error('Search unavailable');
        const raw = await response.json();
        if (!alive()) return;
        const value = searchValue(raw, id, q);
        if (!value || (continuation && value.total !== previousTotal) ||
            (value.scanned <= previousScanned && !(value.complete && value.total === 0 && !continuation)) ||
            (value.cursor !== null && seenCursors.has(value.cursor))) throw new Error('Invalid or non-progressing search response');
        if (value.cursor) seenCursors.add(value.cursor);
        const accumulated = new Map(content.items.map(item => [item.sessionId, item]));
        for (const item of value.items) accumulated.set(item.sessionId, item);
        content = { ...value, items: [...accumulated.values()] };
        const pageDone = value.complete || accumulated.size >= target;
        body = pageDone ? 'ready' : 'pending';
        publish();
        if (!alive() || pageDone) return;
        continuation = true;
      }
    } catch (_) {
      if (alive()) { cancelRequest(); body = 'unavailable'; publish(); }
    } finally {
      // An aborted page must never release the controller owned by a newer page.
      if (alive()) { request = null; publish(); }
    }
  }
  function show(seed) {
    if (!mounted) return;
    cancelHandoff(); focusOrigin = document.activeElement; bridge.closeFind();
    if (typeof seed === 'string' && seed !== query) { query = seed; scroll = 0; content = EMPTY; body = 'idle'; }
    open = true; notice = '';
    if (!ui.Modal || !ui.Input) { open = false; notice = L.unsupported; publish(); return; }
    watchLists();
    // Back preserves completed or stopped results. A changed query starts a fresh scan.
    if (body === 'idle' || body === 'pending') schedule(); else publish();
  }
  function dismiss() {
    const unfinished = body === 'pending' || (!content.complete && !!scanId);
    open = false; cancelRequest(); stopLists(); cancelHandoff();
    if (unfinished) body = 'stopped';
    publish();
  }
  function change(value) {
    query = value; scroll = 0; notice = ''; cancelHandoff(); schedule();
  }
  function launch(row) {
    const available = currentCatalog();
    if (!services || available.status !== 'ready' || !available.rows.some(item => item.id === row.id)) { notice = L.missing; publish(); return; }
    const owner = services, q = query.trim();
    dismiss(); bridge.closeFind(); notice = L.opening;
    const task = { id: row.id, query: q, owner, started: Date.now() };
    handoff = task;
    try {
      owner.uiWorkspace.openSession(row.id);

    } catch (_) { cancelHandoff(L.openFailed); return; }
    function stillSelected() {
      try {
        const row = ctx.sessions.list.getSnapshot().byId[task.id];
        return row?.retainedBy?.mainView > 0 && owner.layout.panelInfo.getSnapshot().activePanelId === null;
      } catch (_) { return false; }
    }
    const navigationChanged = () => { if (handoff === task && !stillSelected()) cancelHandoff(L.interrupted); };
    handoffStops = [ctx.sessions.list.subscribe(navigationChanged), owner.layout.panelInfo.subscribe(navigationChanged)];
    publish();
    const attempt = () => {
      handoffTimer = 0;
      if (!mounted || handoff !== task || services !== owner) return;
      if (!stillSelected()) { cancelHandoff(L.interrupted); return; }
      const current = currentCatalog();
      if (current.status !== 'ready' || !current.rows.some(item => item.id === task.id)) { cancelHandoff(L.missing); return; }
      if (bridge.openFind(task.id, task.query)) { cancelHandoff(); return; }
      if (Date.now() - task.started > 10000) { cancelHandoff(L.chatNeeded); return; }
      handoffTimer = setTimeout(attempt, 100);
    };
    // Let the Host Modal unmount/restore focus before focusing the find input.
    handoffTimer = setTimeout(attempt, 0);
  }
  function Panel() {
    const details = react.useRef(null), list = react.useRef(null);
    const [helpOpen, setHelpOpen] = react.useState(false);
    const helpId = react.useId();
    react.useLayoutEffect(() => {
      if (list.current) list.current.scrollTop = scroll;
      const dialog = details.current?.closest('[role="dialog"]');
      const trigger = focusOrigin;
      const legacy = typeof ui.useModalLayer !== 'function';
      const topmost = () => dialog && Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"],[role="menu"]')).pop() === dialog;
      const items = () => Array.from(dialog.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),[tabindex="0"]')).filter(item => !item.closest('[hidden],[inert]'));
      const focusFirst = () => (items()[0] || dialog)?.focus({ preventScroll: true });
      function keydown(event) {
        if (!topmost() || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.key === 'Escape') {
          event.stopPropagation();
          if (event.isComposing || event.keyCode === 229) return;
          event.preventDefault(); if (!event.repeat) dismiss();
        } else if (event.key === 'Tab') {
          const controls = items(), first = controls[0] || dialog, last = controls[controls.length - 1] || dialog;
          if (!dialog.contains(document.activeElement) || document.activeElement === dialog || document.activeElement === (event.shiftKey ? first : last)) {
            event.preventDefault(); (event.shiftKey ? last : first)?.focus({ preventScroll: true });
          }
        }
      }
      const focusin = event => { if (topmost() && !dialog.contains(event.target)) focusFirst(); };
      if (legacy && dialog) { focusFirst(); window.addEventListener('keydown', keydown, true); window.addEventListener('focusin', focusin, true); }
      return () => {
        window.removeEventListener('keydown', keydown, true); window.removeEventListener('focusin', focusin, true);
        if (legacy && mounted && trigger?.isConnected) trigger.focus({ preventScroll: true });
      };
    }, []);
    const data = currentCatalog();
    const results = body === 'invalid' ? EMPTY : merge(data.rows, content);
    const status = data.status !== 'ready' ? L[data.status] : body === 'invalid' ? L.invalid : !query.trim() ? L.emptyQuery : body === 'pending' ? L.pending : body === 'unavailable' ? L.unavailable : body === 'stopped' ? L.stopped : '';
    const retryable = data.status === 'failedList' || (data.status === 'ready' && (body === 'unavailable' || body === 'stopped' || (body === 'ready' && content.complete && (content.failed > 0 || content.skipped > 0))));
    const pending = data.status === 'ready' && body === 'pending';
    const empty = data.status === 'ready' && query.trim() && body === 'ready' && content.complete && !content.failed && !content.skipped && results.items.length === 0;
    const progress = content.scanned > 0 || content.total > 0 ? L.progress(content.scanned, content.total) : '';
    const partial = content.failed || content.skipped ? L.partial(content.failed, content.skipped) : '';
    const count = L.shown(results.items.length);
    const ready = data.status === 'ready' && body === 'ready';
    let announcement = '';
    if (notice) announcement = notice;
    else if (data.status === 'ready' && body === 'invalid') announcement = L.invalid;
    else if (pending) announcement = [progress || L.pending, partial].filter(Boolean).join(' · ');
    else if (ready && content.complete && !partial) announcement = count;
    else if (ready && content.cursor) announcement = [L.page(results.items.length), partial].filter(Boolean).join(' · ');
    else if (ready || body === 'stopped' || body === 'unavailable') announcement = [status || count, progress, partial].filter(Boolean).join(' · ');
    else if (data.status !== 'ready') announcement = status;
    const emptyStatus = body === 'invalid' && data.status === 'ready' ? L.invalidShort : empty ? L.noMatches : body === 'unavailable' && data.status === 'ready' ? L.unavailableShort : body === 'stopped' && data.status === 'ready' ? L.stoppedShort : status || (partial ? L.partialShort : ready && content.cursor ? L.noMatchesYet : '');
    const requestClose = () => {
      const dialog = details.current?.closest('[role="dialog"]');
      if (dialog && Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"],[role="menu"]')).pop() === dialog) dismiss();
    };
    const setTitleOnly = checked => { mode = checked ? 'title' : 'title-body'; scroll = 0; notice = ''; cancelHandoff(); schedule(); };
    const actions = retryable || pending || content.cursor ? h('div', { className: 'dsh-find-all-conversations-actions' },
      retryable ? h(ui.Button, { type: 'button', size: 'sm', variant: 'ghost', onClick: () => {
        notice = ''; schedule();
        const generation = epoch, owner = services;
        if (typeof ctx.sessions.refresh === 'function') Promise.resolve().then(() => ctx.sessions.refresh()).catch(() => { if (mounted && open && epoch === generation && services === owner) { notice = L.failedList; publish(); } });
      } }, L.retry) : null,
      pending || content.cursor ? h(ui.Button, { type: 'button', size: 'sm', variant: 'ghost', onClick: () => { cancelRequest(); body = 'stopped'; publish(); } }, L.cancel) : null,
      !pending && content.cursor ? h(ui.Button, { type: 'button', size: 'sm', variant: 'ghost', onClick: () => scanBatch(true) }, L.more) : null) : null;
    return h(ui.Modal, { open: true, headless: true, title: L.title, onClose: requestClose, className: 'dsh-find-all-conversations' },
      h('div', { ref: details, className: 'dsh-find-all-conversations-layout' },
        h('div', { className: 'dsh-find-all-conversations-header' },
          h(ui.Input, { type: 'search', value: query, 'data-modal-autofocus': true, 'aria-label': L.title, placeholder: mode === 'title' ? L.titlePlaceholder : L.placeholder,
            icon: ui.IconSearchOutlineRegular ? h(ui.IconSearchOutlineRegular, { size: 16 }) : undefined,
            onChange: event => change(event.target.value), onKeyDown: event => {
              if (event.key !== 'Enter' || event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229 || event.repeat) return;
              event.preventDefault(); notice = ''; cancelHandoff(); schedule();
            }, className: 'dsh-find-all-conversations-input' }),
          h(ui.Button, { type: 'button', size: 'sm', variant: 'ghost', 'aria-label': L.close, title: L.close, onClick: requestClose, className: 'dsh-find-all-conversations-close' },
            ui.IconCloseOutlineRegular ? h(ui.IconCloseOutlineRegular, { size: 14 }) : '×')),
        h('div', { className: 'dsh-find-all-conversations-toolbar' },
          h('span', { className: 'dsh-find-all-conversations-scope' }, L.scope),
          ui.Checkbox ? h(ui.Checkbox, { checked: mode === 'title', onChange: setTitleOnly, label: L.titleOnly, className: 'dsh-find-all-conversations-title-only' }) :
            h('label', { className: 'dsh-find-all-conversations-title-only dsh-find-all-conversations-title-only-fallback' }, h('input', { type: 'checkbox', checked: mode === 'title', onChange: event => setTitleOnly(event.target.checked) }), ' ', L.titleOnly)),
        h('div', { ref: list, onScroll: event => { scroll = event.currentTarget.scrollTop; }, className: 'dsh-find-all-conversations-list' },
          !results.items.length && emptyStatus ? h('div', { className: 'dsh-find-all-conversations-empty' }, emptyStatus) : null,
          ...results.items.map(row => h('button', { key: row.id, type: 'button', onClick: () => launch(row), className: 'dsh-find-all-conversations-row', 'aria-current': row.selected ? 'true' : undefined },
            h('span', { className: 'dsh-find-all-conversations-title', title: row.title || L.untitled }, row.titleMatch ? highlightedText(h, row.title, literalRanges(row.title, query)) : row.title || L.untitled),
            h('span', { className: 'dsh-find-all-conversations-meta' },
              row.workspace ? h('span', { className: 'dsh-find-all-conversations-info', title: row.workspace }, row.workspace) : null,
              row.snippet ? h('span', { className: 'dsh-find-all-conversations-snippet', title: row.snippet }, highlightedText(h, row.snippet, row.ranges)) : null)))),
        h('div', { className: 'dsh-find-all-conversations-footer' },
          h('div', { className: 'dsh-find-all-conversations-status-actions' },
            h('div', { role: 'status', 'aria-live': 'polite', className: 'dsh-find-all-conversations-status' }, announcement), actions),
          h(ui.Button, { type: 'button', size: 'sm', variant: 'ghost', 'aria-expanded': helpOpen, 'aria-controls': helpId, onClick: () => setHelpOpen(value => !value), className: 'dsh-find-all-conversations-help' }, L.help)),
        h('div', { id: helpId, hidden: !helpOpen, className: 'dsh-find-all-conversations-help-content' },
          h('p', null, L.scopeDetails), h('p', null, L.order), h('p', null, L.snapshot), h('p', null, L.semantics), h('p', null, L.handoff))));
  }
  function Entry(props) {
    react.useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => revision);
    const Icon = ui.IconSearchOutlineRegular || ui.IconSearchOutline16;
    return h(react.Fragment, null,
      h(ui.Button, { type: 'button', size: 'sm', variant: 'ghost', title: notice || L.title, 'aria-label': L.title, onClick: () => show(), style: { width: '100%', justifyContent: props.wide ? 'flex-start' : 'center', gap: 8 } }, Icon ? h(Icon, { size: 16 }) : null, props.wide ? L.title : null),
      notice && !open ? h('div', { role: 'status', style: { fontSize: 12, padding: 8, overflowWrap: 'anywhere' } }, notice) : null,
      open && ui.Modal ? h(Panel) : null);
  }
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'dsh-find-all-search', order: 10 }, Entry));
  if (typeof ctx.inject === 'function') ctx.inject(['uiWorkspace', 'workspaces', 'layout'], child => {
    child.effect(() => {
      if (typeof child.uiWorkspace?.openSession !== 'function' || typeof child.layout?.panelInfo?.subscribe !== 'function' || typeof child.layout?.panelInfo?.getSnapshot !== 'function' || typeof child.workspaces?.list?.subscribe !== 'function' || typeof ctx.sessions?.list?.subscribe !== 'function') return;
      const owner = { uiWorkspace: child.uiWorkspace, workspaces: child.workspaces, layout: child.layout };
      cancelRequest(); services = owner; content = EMPTY; body = 'idle'; watchLists(); if (open) schedule(); publish();
      return () => { if (services !== owner) return; services = null; cancelRequest(); stopLists(); cancelHandoff(L.interrupted); content = EMPTY; body = 'idle'; publish(); };
    });
  });
  if (typeof ctx.on === 'function') ctx.on('connection/reset', () => {
    cancelRequest(); cancelHandoff(L.interrupted); content = EMPTY; body = 'idle';
    if (open) { watchLists(); schedule(); } else publish();
  });
  ctx.effect(() => {
    function interrupt(event) { if (handoff && event.isTrusted) cancelHandoff(L.interrupted); }
    window.addEventListener('pointerdown', interrupt, true); window.addEventListener('keydown', interrupt, true);
    return () => {
      mounted = false; open = false; cancelRequest(); stopLists(); cancelHandoff(); content = EMPTY; query = ''; listeners.clear();
      window.removeEventListener('pointerdown', interrupt, true); window.removeEventListener('keydown', interrupt, true);
    };
  });
  return { open: show, label: () => query ? L.back : L.title, isOpen: () => open, cancelHandoff };
}
