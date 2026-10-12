// Public Host metadata + ranked search only. No session activation until a row is opened.
const LIMIT = 20;
const EMPTY = { items: [], hasMore: false };
const zh = typeof navigator !== 'undefined' && /^zh/i.test(navigator.language || '');
const L = zh ? {
  title: '搜索对话', close: '关闭搜索对话', placeholder: '搜索对话标题和可用的消息内容…',
  scope: '当前服务 · 所有工作区 · 普通未归档对话',
  help: '搜索说明', shown: n => `显示 ${n} 个对话`,
  semantics: '正文按宿主的词语／短语规则匹配，不等同于会话内的任意子串查找。',
  handoff: '打开对话后继续用此关键词查找，不直接跳到摘要原句。',
  emptyQuery: '输入关键词开始搜索。', invalid: '关键词最多 500 个字符，不能包含空字符。',
  pending: '正在搜索消息内容；已显示找到的标题。', unavailable: '仅搜索对话标题，消息内容搜索不可用。',
  stopped: '消息内容搜索已停止；仅显示标题结果。', failedList: '会话列表暂不可用，请重试。',
  loading: '正在读取会话列表…', unsupported: '当前宿主缺少搜索对话所需的界面或服务。',
  noMatches: '未找到匹配的对话。',
  more: '还有更多候选对话，请缩小关键词。', retry: '重试', cancel: '停止搜索',
  untitled: '未命名对话',
  order: '标题匹配按最近更新排列；其后为宿主排序的正文匹配。',
  missing: '该对话已不在可打开的列表中，可能已归档、删除或失去访问权限。',
  opening: '正在打开对话…', openFailed: '未能打开该对话。可以返回结果重试。',
  chatNeeded: '未能接入该对话的聊天正文。请切换到 Chat／聊天视图，再从搜索结果重试。',
  interrupted: '已停止继续查找；可重新打开搜索结果。', back: '返回搜索结果',
} : {
  title: 'Search conversations', close: 'Close conversation search', placeholder: 'Search conversation titles and available message content…',
  scope: 'Connected server · All workspaces · Ordinary, unarchived conversations',
  help: 'Search help', shown: n => `${n} conversations shown`,
  semantics: 'Message search uses the Host’s word/phrase rules, unlike the substring matching inside a conversation.',
  handoff: 'Open a conversation to find this query there; snippets do not link to an exact message.',
  emptyQuery: 'Enter a query to search.', invalid: 'Use at most 500 characters, without null characters.',
  pending: 'Searching message content; matching titles are already shown.', unavailable: 'Searching titles only. Message content search is unavailable.',
  stopped: 'Message search stopped; showing title matches only.', failedList: 'Conversation list unavailable. Try again.',
  loading: 'Loading conversation list…', unsupported: 'This Host lacks the UI or service capabilities needed for conversation search.',
  noMatches: 'No matching conversations found.',
  more: 'More candidate conversations exist. Refine your query.', retry: 'Retry', cancel: 'Stop search',
  untitled: 'Untitled conversation',
  order: 'Title matches are newest first, followed by the Host’s ranked message matches.',
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

function merge(rows, query, content) {
  const q = query.trim().toLowerCase();
  if (!q) return EMPTY;
  const valid = new Map(rows.map(row => [row.id, row]));
  const local = rows.filter(row => row.title.toLowerCase().includes(q)).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  const results = new Map(local.map(row => [row.id, { ...row, titleMatch: true, bodyMatch: false, snippet: '' }]));
  for (const item of content.items) {
    const row = valid.get(item.sessionId);
    if (!row) continue;
    const existing = results.get(row.id);
    if (existing?.bodyMatch) continue;
    results.set(row.id, { ...(existing || row), titleMatch: !!existing, bodyMatch: true, snippet: item.snippet });
  }
  return { items: [...results.values()].slice(0, LIMIT), hasMore: content.hasMore || results.size > LIMIT };
}

// Search the complete lowercased title, exactly as merge() does. Unicode casing
// can expand a code point (İ → i + combining dot); indices in that string are
// not indices in the displayed title. Contextual sigma changes width by zero.
function highlightedTitle(h, title, query) {
  const needle = query.trim().toLowerCase(), folded = title.toLowerCase();
  if (!needle || !folded.includes(needle)) return title;
  const starts = [], ends = [];
  let original = 0;
  for (const point of title) {
    for (let i = 0; i < point.toLowerCase().length; i++) {
      starts.push(original); ends.push(original + point.length);
    }
    original += point.length;
  }
  if (starts.length !== folded.length) return title;
  const ranges = [];
  for (let at = folded.indexOf(needle); at !== -1; at = folded.indexOf(needle, at + needle.length)) {
    const start = starts[at], end = ends[at + needle.length - 1];
    const previous = ranges[ranges.length - 1];
    if (previous && start <= previous.end) previous.end = Math.max(previous.end, end);
    else ranges.push({ start, end });
  }
  const parts = [];
  let cursor = 0;
  for (const { start, end } of ranges) {
    parts.push(title.slice(cursor, start), h('mark', { key: start, className: 'dsh-find-all-conversations-match' }, title.slice(start, end)));
    cursor = end;
  }
  parts.push(title.slice(cursor));
  return parts;
}

function searchValue(result) {
  const value = result?.ok === true && result.value;
  if (!value || !Array.isArray(value.items) || typeof value.hasMore !== 'boolean' || value.items.length > LIMIT || value.items.some(row => !row || typeof row.sessionId !== 'string' || typeof row.snippet !== 'string')) return null;
  return { items: value.items.map(({ sessionId, snippet }) => ({ sessionId, snippet })), hasMore: value.hasMore };
}

export function installConversationSearch(ctx, react, ui, bridge) {
  const h = react.createElement;
  let services = null, mounted = true, epoch = 0, request = null, timer = 0;
  let open = false, query = '', body = 'idle', content = EMPTY, scroll = 0, notice = '', focusOrigin = null;
  let handoff = null, handoffTimer = 0, handoffStops = [], listStops = [], lastCatalogStatus = '';
  const listeners = new Set();
  let revision = 0;
  const publish = () => { revision++; for (const listener of listeners) listener(); };
  const currentCatalog = () => {
    try { return services ? catalog(ctx.sessions, services.workspaces) : { status: 'unsupported', rows: [] }; }
    catch (_) { return { status: 'failedList', rows: [] }; }
  };
  const cancelRequest = () => { epoch++; clearTimeout(timer); timer = 0; request?.abort(); request = null; };
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
      if (status !== 'ready') { cancelRequest(); content = EMPTY; body = 'idle'; }
      const wasReady = lastCatalogStatus === 'ready'; lastCatalogStatus = status;
      if (!wasReady && status === 'ready') schedule();
      publish();
    };
    listStops = [ctx.sessions.list.subscribe(changed), services.workspaces.list.subscribe(changed)];
    changed();
  }
  function schedule() {
    cancelRequest(); content = EMPTY;
    const q = query.trim();
    body = !q ? 'idle' : q.length > 500 || q.includes('\0') ? 'invalid' : 'pending';
    if (body !== 'pending' || !open || currentCatalog().status !== 'ready') { publish(); return; }
    if (typeof ctx.sessions.search !== 'function') { body = 'unavailable'; publish(); return; }
    const generation = epoch, owner = services;
    timer = setTimeout(async () => {
      timer = 0;
      const controller = new AbortController(); request = controller;
      const alive = () => mounted && open && services === owner && epoch === generation && query.trim() === q && !controller.signal.aborted;
      try {
        const result = await ctx.sessions.search(q, controller.signal);
        if (!alive()) return;
        const value = searchValue(result);
        content = value || EMPTY; body = value ? 'ready' : 'unavailable';
      } catch (_) { if (alive()) { body = 'unavailable'; content = EMPTY; } }
      finally { if (alive()) { request = null; publish(); } }
    }, 250);
    publish();
  }
  function show(seed) {
    if (!mounted) return;
    cancelHandoff(); focusOrigin = document.activeElement; bridge.closeFind();
    if (typeof seed === 'string' && seed !== query) { query = seed; scroll = 0; content = EMPTY; body = 'idle'; }
    open = true; notice = '';
    if (!ui.Modal || !ui.Input) { open = false; notice = L.unsupported; publish(); return; }
    watchLists();
    // A completed result is kept in memory for Back; fresh queries are searched.
    if (body !== 'ready') schedule(); else publish();
  }
  function dismiss() {
    open = false; cancelRequest(); stopLists(); cancelHandoff();
    if (body === 'pending') body = 'stopped';
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
    const results = body === 'invalid' ? EMPTY : merge(data.rows, query, content);
    const status = data.status !== 'ready' ? L[data.status] : body === 'invalid' ? L.invalid : !query.trim() ? L.emptyQuery : body === 'pending' ? L.pending : body === 'unavailable' ? L.unavailable : body === 'stopped' ? L.stopped : '';
    const retryable = data.status === 'failedList' || (data.status === 'ready' && (body === 'unavailable' || body === 'stopped'));
    const pending = data.status === 'ready' && body === 'pending';
    const empty = data.status === 'ready' && query.trim() && body === 'ready' && results.items.length === 0;
    const announcement = notice || status || (empty ? L.noMatches : results.items.length ? L.shown(results.items.length) : '');
    const requestClose = () => {
      const dialog = details.current?.closest('[role="dialog"]');
      if (dialog && Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"],[role="menu"]')).pop() === dialog) dismiss();
    };
    return h(ui.Modal, { open: true, title: L.title, closeLabel: L.close, description: L.scope, onClose: requestClose, className: 'dsh-find-all-conversations', contentClassName: 'dsh-find-all-conversations-content' },
      h('div', { ref: details, className: 'dsh-find-all-conversations-layout' },
        h(ui.Input, { type: 'search', value: query, 'data-modal-autofocus': true, 'aria-label': L.title, placeholder: L.placeholder, onChange: event => change(event.target.value), className: 'dsh-find-all-conversations-input' }),
        h('div', { role: 'status', 'aria-live': 'polite', className: 'dsh-find-all-conversations-status' }, announcement),
        retryable || pending ? h('div', { className: 'dsh-find-all-conversations-actions' },
          retryable ? h(ui.Button, { type: 'button', size: 'sm', variant: 'ghost', onClick: () => {
            notice = ''; schedule();
            const generation = epoch, owner = services;
            if (typeof ctx.sessions.refresh === 'function') Promise.resolve().then(() => ctx.sessions.refresh()).catch(() => { if (mounted && open && epoch === generation && services === owner) { notice = L.failedList; publish(); } });
          } }, L.retry) : null,
          pending ? h(ui.Button, { type: 'button', size: 'sm', variant: 'ghost', onClick: () => { cancelRequest(); content = EMPTY; body = 'stopped'; publish(); } }, L.cancel) : null) : null,
        h('div', { ref: list, onScroll: event => { scroll = event.currentTarget.scrollTop; }, className: 'dsh-find-all-conversations-list' },
          ...results.items.map(row => h('button', { key: row.id, type: 'button', onClick: () => launch(row), className: 'dsh-find-all-conversations-row', 'aria-current': row.selected ? 'true' : undefined },
            h('span', { className: 'dsh-find-all-conversations-title', title: row.title || L.untitled }, row.titleMatch ? highlightedTitle(h, row.title, query) : row.title || L.untitled),
            h('span', { className: 'dsh-find-all-conversations-meta' },
              row.workspace ? h('span', { className: 'dsh-find-all-conversations-info', title: row.workspace }, row.workspace) : null,
              row.snippet ? h('span', { className: 'dsh-find-all-conversations-snippet', title: row.snippet }, row.snippet) : null)))),
        results.hasMore ? h('p', { role: 'status', className: 'dsh-find-all-conversations-status' }, L.more) : null,
        h('div', { className: 'dsh-find-all-conversations-help' },
          h(ui.Button, { type: 'button', size: 'sm', variant: 'ghost', 'aria-expanded': helpOpen, 'aria-controls': helpId, onClick: () => setHelpOpen(value => !value) }, L.help),
          h('div', { id: helpId, hidden: !helpOpen }, h('p', null, L.order), h('p', null, L.semantics), h('p', null, L.handoff)))));
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
      services = owner; content = EMPTY; body = 'idle'; watchLists(); if (open) schedule(); publish();
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
