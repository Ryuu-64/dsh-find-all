const KIND = 'find-all-conversation-search';
const ID = '@ryuu-64/dsh-find-all/search';

export function installSearchDock(ctx, react, ui, locale, view) {
  let dock = null;
  ctx.inject(['sidebarRight', 'sidebarRightTabs'], host => {
    const sidebar = host.sidebarRight;
    if (typeof sidebar?.mounted?.subscribe !== 'function' || typeof sidebar.mounted.getSnapshot !== 'function' ||
        typeof sidebar.openTab !== 'function' || typeof sidebar.active !== 'function' ||
        typeof sidebar.hide !== 'function' || typeof host.sidebarRightTabs?.register !== 'function') return;

    let active = null, carry = false, frame = 0, ready = false;
    let focusInputFor, focusResult, arriving;
    const h = react.createElement;
    const OpenIcon = ui.IconSearchOutlineRegular || ui.IconSearchOutline16;
    const foreground = () => sidebar.mounted.getSnapshot();

    function reveal(id) {
      if (!ready || !id || foreground() !== id) return false;
      try {
        if (sidebar.active()?.kind !== KIND || !sidebar.isExpanded?.()) sidebar.openTab(KIND);
        return true;
      } catch (_) { return false; }
    }

    function stopFollowing() {
      carry = false;
      arriving = undefined;
      focusResult = undefined;
      cancelAnimationFrame(frame);
      frame = 0;
    }

    function follow() {
      cancelAnimationFrame(frame);
      const sessionId = foreground();
      view.foregroundChanged();
      if (focusResult?.sessionId !== sessionId) focusResult = undefined;
      if (!carry || sessionId === active?.sessionId) return;
      // The host publishes the new foreground before releasing the old seat.
      // Close only the departing Search occurrence while its actions are live.
      active?.close();
      active = null;
      if (!sessionId) return;
      arriving = sessionId;
      let attempts = 0;
      function apply() {
        frame = 0;
        if (!carry || foreground() !== sessionId) return;
        if (!reveal(sessionId) && ++attempts < 24) frame = requestAnimationFrame(apply);
      }
      frame = requestAnimationFrame(apply);
    }

    function Body({ sessionId, useTabInfo }) {
      const info = useTabInfo();
      const visible = info.tab.visible;
      const floating = info.panel.isFloating;
      const navigation = info.tab.navigation.revision;
      const root = react.useRef(null);
      react.useLayoutEffect(() => {
        if (!visible) {
          if (foreground() === sessionId && active?.tabId === info.tab.id) stopFollowing();
          return;
        }
        const continued = arriving === sessionId;
        if (continued) arriving = undefined;
        const occurrence = { sessionId, tabId: info.tab.id, close: info.tab.actions.close,
          element: root.current, fullscreen: info.sidebar.fullscreen && !floating };
        active = occurrence;
        carry = !floating;
        view.activate();
        const shouldFocus = focusInputFor === sessionId || (!continued && navigation > 0 && document.activeElement === document.body);
        if (focusInputFor === sessionId) focusInputFor = undefined;
        if (shouldFocus) view.focusInput(root.current);
        if (focusResult) {
          const intent = focusResult;
          focusResult = undefined;
          if (intent.sessionId === sessionId) view.focusResult(root.current, intent);
        }
        return () => {
          if (active !== occurrence) return;
          if (foreground() === sessionId) { active = null; stopFollowing(); }
        };
      }, [sessionId, info.tab.id, visible, floating, info.sidebar.fullscreen, navigation]);
      return visible ? h('div', { ref: root, className: 'dsh-find-all-dock' }, h(view.Panel, { docked: true })) : null;
    }

    function Title() {
      react.useSyncExternalStore(view.subscribe, view.getRevision);
      return h(react.Fragment, null, OpenIcon ? h(OpenIcon, { size: 14 }) : null, locale('dockTitle'));
    }

    host.effect(() => host.sidebarRightTabs.register({
      id: ID, kind: KIND, title: () => locale('dockTitle'),
      guide: [{ id: 'search', order: 40, commandId: 'dsh-find-all.search-conversations',
        title: () => locale('dockTitle'), description: () => locale('dockDescription'), icon: OpenIcon }],
    }), 'find-all: right-sidebar search type');
    host.slots.inject('sidebar.right.pane.tab', () => host.slots.register({ name: 'sidebar.right.pane.tab', key: ID }, Body));
    host.slots.inject('sidebar.right.pane.tab.title', () => host.slots.register({ name: 'sidebar.right.pane.tab.title', key: ID }, Title));
    host.effect(() => {
      ready = true;
      const stop = sidebar.mounted.subscribe(follow);
      const owner = {
        show() {
          const sessionId = foreground();
          focusInputFor = sessionId;
          if (!reveal(sessionId)) { focusInputFor = undefined; return false; }
          if (active?.sessionId === sessionId) {
            view.focusInput(active.element);
            focusInputFor = undefined;
          }
          return true;
        },
        beforeOpen(sessionId, summary, focus) {
          if (active?.fullscreen) {
            stopFollowing();
            sidebar.hide(active.tabId);
          } else if (focus && sessionId !== foreground()) focusResult = { sessionId, summary };
        },
      };
      dock = owner;
      return () => {
        ready = false;
        stop();
        stopFollowing();
        if (dock === owner) dock = null;
      };
    });
  });
  return () => dock;
}
