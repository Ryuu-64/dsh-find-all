import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const source = readFileSync(process.env.FIND_ALL_PACKAGE_ROOT
  ? `${process.env.FIND_ALL_PACKAGE_ROOT}/lib/client.js`
  : new URL('../lib/client.js', import.meta.url), 'utf8');

// Exercise the shipped plugin through its registered session-header component.
// MutationObserver and timers are real jsdom/browser APIs; only layout,
// scrolling and CSS Highlight rendering are substitutes, as in session-adapter.
// This is isolated DOM regression coverage, not Desktop CPU/compatibility QA.
function setup() {
  const dom = new JSDOM('<!doctype html><body><aside>sidebar needle</aside></body>', {
    runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window;
  const globals = new Map(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT']
    .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  globalThis.window = w;
  globalThis.document = w.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const scans = [], scrolls = [], views = [], cleanups = [], bound = [];
  const faces = new Map();
  let rangeBuilds = 0;
  const createRange = w.document.createRange.bind(w.document);
  w.document.createRange = () => { rangeBuilds++; return createRange(); };
  // Range creation also detects rescans if matching later stops using a
  // TreeWalker. Navigation reuses the existing Range objects.
  const work = () => ({ textWalkers: scans.length, rangeBuilds });
  const walk = w.document.createTreeWalker.bind(w.document);
  w.document.createTreeWalker = (root, ...args) => {
    // jsdom's selector engine also walks elements/documents internally. Count
    // text-search walkers, not fixture queries or adapter visibility selectors.
    if (args[0] & w.NodeFilter.SHOW_TEXT) scans.push(root);
    return walk(root, ...args);
  };
  w.HTMLElement.prototype.getClientRects = function () {
    return this.isConnected ? [{ width: 100, height: 20 }] : [];
  };
  w.HTMLElement.prototype.scrollIntoView = function () { scrolls.push(this); };
  w.CSS = { highlights: new Map() };
  w.Highlight = class extends Set { constructor(...ranges) { super(ranges); } };
  let registration, Component;
  w.__ModuleLoader__ = { load(value) { registration = value; } };
  w.eval(source);
  const plugin = registration.factory(name => {
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return {
      Button: ({size, variant, ...props}) => React.createElement('button', props),
      IconSearchOutlineRegular: ({size}) => React.createElement('svg', {width: size, height: size, 'aria-hidden': true}),
    };
    assert.equal(name, 'react'); return React;
  });
  plugin.apply({
    sessions: {
      list: { getSnapshot() { assert.fail('must not read global session selection'); } },
      binding(id) {
        bound.push(id);
        if (!faces.has(id)) faces.set(id, {
          getSnapshot: () => ({ openState: 'open', openError: null, loadingOlder: false, hasMore: false }),
          loadOlder() { assert.fail('the fixture has no older pages'); },
        });
        return { session: faces.get(id) };
      },
    },
    slots: {
      inject(name, callback) { assert.equal(name, 'conversation.session.header.utilities'); cleanups.push(callback()); },
      register(options, value) { assert.equal(options.name, 'conversation.session.header.utilities'); Component = value; return () => {}; },
    },
    effect(callback) { cleanups.push(callback()); },
  });

  async function mount(id, html = '<p>other</p>') {
    const panel = w.document.createElement('section');
    panel.dataset.phase = 'active';
    panel.innerHTML = `<header><div class="utility"></div></header><div data-conversation-content data-conversation-session="${id}"><div data-conversation-scroll><div data-chat-flow>${html}</div><textarea></textarea></div></div>`;
    w.document.body.append(panel);
    const root = createRoot(panel.querySelector('.utility'));
    await act(async () => root.render(React.createElement(Component, { sessionId: id })));
    const view = { panel, root, anchor: panel.querySelector('[data-find-all-session]'), flow: panel.querySelector('[data-chat-flow]') };
    views.push(view);
    return view;
  }
  const bar = selector => w.document.querySelector(`#dsh-find-all-root ${selector}`);
  const count = () => bar('.count').textContent;
  const hits = () => [...(w.CSS.highlights.get('dsh-find-all-hit') || [])];
  function open(view) {
    view.anchor.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
  }
  function search(query) {
    bar('input').value = query;
    bar('input').dispatchEvent(new w.Event('input', { bubbles: true }));
  }
  function assertHits(flow, total) {
    assert.equal(hits().length, total);
    for (const range of hits()) {
      assert.ok(flow.contains(range.startContainer) && flow.contains(range.endContainer));
      assert.equal(range.toString(), 'needle');
    }
  }
  function assertCurrent(flow, index) {
    const current = [...w.CSS.highlights.get('dsh-find-all-cur')];
    assert.deepEqual(current, [hits()[index]]);
    assert.equal(count(), `${index + 1}/${hits().length}`);
    assertHits(flow, hits().length);
    assert.equal(scrolls.at(-1), current[0].startContainer.parentElement);
    assert.ok(flow.contains(scrolls.at(-1)));
  }
  async function finish() {
    for (const cleanup of cleanups.reverse()) cleanup?.();
    for (const view of views) await act(async () => view.root.unmount());
    w.close();
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
  return { w, mount, bar, count, hits, scans, work, scrolls, bound, open, search, assertHits, assertCurrent, finish };
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 2500;
  while (!predicate() && Date.now() < deadline) await delay(10);
  assert.ok(predicate(), message);
}

test('body observer is idle for 1.1 seconds but responds to childList and characterData', async () => {
  const h = setup();
  try {
    const view = await h.mount('session-a', '<p>needle</p>');
    h.open(view); h.search('needle');
    await delay(800); // Includes the initial whole-scope status update and a target poll.
    assert.equal(h.count(), '1/1'); h.assertHits(view.flow, 1);
    const stableWork = h.work();
    assert.ok(stableWork.rangeBuilds > 0);
    // Navigation rewrites the bar count/highlights, not conversation content.
    h.bar('[aria-label="Next match"]').click();
    await delay(1100);
    assert.deepEqual(h.work(), stableWork, 'bar updates and idle polls must not rescan');

    const added = h.w.document.createTextNode(' needle');
    view.flow.append(added); // childList, without replacing an existing text node
    await waitFor(() => h.count() === '1/2', 'appended text must update the count');
    h.assertHits(view.flow, 2);
    assert.ok(h.work().rangeBuilds > stableWork.rangeBuilds);
    const afterAppend = h.work();
    added.data = ' other'; // characterData, without any childList mutation
    await waitFor(() => h.count() === '1/1', 'edited characters must update the count');
    h.assertHits(view.flow, 1);
    assert.ok(h.work().rangeBuilds > afterAppend.rangeBuilds);
    assert.ok(h.scans.every(root => root === view.flow));

    view.flow.append(h.w.document.createTextNode(' needle'));
    await delay(0); // Deliver the real MutationObserver callback before close.
    h.bar('[aria-label="Close find"]').click();
    const closedWork = h.work();
    view.flow.append(h.w.document.createTextNode(' needle'));
    await delay(350);
    assert.deepEqual(h.work(), closedWork, 'close cancels queued work and disconnects observation');
    assert.equal(h.w.CSS.highlights.size, 0);
  } finally { await h.finish(); }
});

for (const scope of ['whole', 'page']) {
  test(`${scope} excludes sidebar-only matches and keeps counts, highlights and navigation in the body`, async () => {
    const h = setup();
    try {
      const view = await h.mount('session-a');
      h.open(view);
      if (scope === 'page') h.bar('.scope').click();
      h.search('needle');
      await delay(350);
      assert.equal(h.bar('.scope').hasAttribute('data-whole'), scope === 'whole');
      assert.equal(h.count(), '0/0'); h.assertHits(view.flow, 0);
      assert.equal(h.w.CSS.highlights.size, 0);
      assert.equal(h.scrolls.length, 0);
      if (scope === 'whole') {
        assert.ok(h.bound.length > 0);
        assert.ok(h.bound.every(id => id === 'session-a'));
      } else assert.deepEqual(h.bound, []);

      // Additional distractors outside the selected body must also stay excluded.
      const other = await h.mount('session-b', '<p>needle</p>');
      const hidden = await h.mount('session-old', '<p>needle</p>');
      hidden.panel.hidden = true;
      view.panel.querySelector('textarea').textContent = 'composer needle';
      const menu = h.w.document.createElement('menu');
      menu.innerHTML = '<button>menu needle</button><input value="needle">';
      h.w.document.body.append(menu);
      view.flow.innerHTML = '<p>first needle</p><p>second needle</p>';
      await waitFor(() => h.hits().length === 2, 'body additions must become searchable');
      assert.equal(h.count(), '2 results'); h.assertHits(view.flow, 2);
      // Selection after a zero-result update is a separate issue; a new input
      // event establishes the first result before checking both navigation paths.
      h.search('needle');
      h.bar('[aria-label="Next match"]').click(); h.assertCurrent(view.flow, 1);
      h.bar('[aria-label="Previous match"]').click(); h.assertCurrent(view.flow, 0);
      h.bar('[aria-label="Previous match"]').click(); h.assertCurrent(view.flow, 1);

      h.bar('.scope').click();
      await delay(350);
      assert.equal(h.bar('.scope').hasAttribute('data-whole'), scope !== 'whole');
      assert.equal(h.count(), '2/2'); h.assertHits(view.flow, 2);
      h.bar('[aria-label="Next match"]').click(); h.assertCurrent(view.flow, 0);
      assert.ok(h.scans.every(root => root === view.flow));
      assert.ok(h.bound.length > 0);
      assert.ok(h.bound.every(id => id === 'session-a'));
      assert.ok(!h.hits().some(range => other.flow.contains(range.startContainer)));
    } finally { await h.finish(); }
  });
}

test('switching session and replacing its body detach old observers and fail closed without a body', async () => {
  const h = setup();
  try {
    const a = await h.mount('session-a', '<p>needle</p>');
    const b = await h.mount('session-b', '<p>needle needle</p>');
    h.open(a); h.search('needle');
    await delay(350);
    a.flow.append(h.w.document.createTextNode(' needle'));
    await delay(0); // Queue A's debounced rescan before explicitly selecting B.
    b.anchor.dispatchEvent(new h.w.Event('pointerdown', { bubbles: true }));
    assert.equal(h.count(), '1/2'); h.assertHits(b.flow, 2);
    const switchedWork = h.work();
    a.flow.append(h.w.document.createTextNode(' needle'));
    await waitFor(() => h.bar('.status').textContent.startsWith('Searched currently available history;'), 'B must finish its one required terminal rescan');
    assert.deepEqual(h.work(), { ...switchedWork, rangeBuilds: switchedWork.rangeBuilds + 2 }, 'only B terminal rescan may run; queued/new A mutations must not add work');
    assert.equal(h.count(), '1/2'); h.assertHits(b.flow, 2);
    const settledSwitchWork = h.work();
    a.flow.append(h.w.document.createTextNode(' needle'));
    await delay(350);
    assert.deepEqual(h.work(), settledSwitchWork, 'old A mutations must not rescan settled B');

    const old = b.flow;
    const replacement = h.w.document.createElement('div');
    replacement.dataset.chatFlow = '';
    replacement.innerHTML = '<p>needle</p>';
    old.replaceWith(replacement);
    await waitFor(() => h.count() === '1/1', 'target polling must bind the replacement body');
    h.assertHits(replacement, 1);
    const replacedWork = h.work();
    old.append(h.w.document.createTextNode(' needle needle'));
    await waitFor(() => h.bar('.status').textContent.startsWith('Searched currently available history;'), 'the replacement body must finish its one terminal rescan');
    assert.deepEqual(h.work(), { ...replacedWork, rangeBuilds: replacedWork.rangeBuilds + 1 }, 'only the replacement terminal rescan may run');
    assert.equal(h.count(), '1/1'); h.assertHits(replacement, 1);
    const settledReplacementWork = h.work();
    old.append(h.w.document.createTextNode(' needle needle'));
    await delay(350);
    assert.deepEqual(h.work(), settledReplacementWork, 'detached body mutations must not schedule scans');
    replacement.append(h.w.document.createTextNode(' needle'));
    await waitFor(() => h.count() === '1/2', 'the replacement body must still be observed');
    h.assertHits(replacement, 2);

    replacement.remove();
    await waitFor(() => h.count() === '0/0', 'missing body must clear results');
    assert.match(h.bar('.status').textContent, /scope unavailable/i);
    assert.equal(h.w.CSS.highlights.size, 0);
    assert.ok(h.scans.slice(switchedWork.textWalkers).every(root => root === replacement));
    assert.ok(h.bound.every(id => id === 'session-a' || id === 'session-b'));
  } finally { await h.finish(); }
});
