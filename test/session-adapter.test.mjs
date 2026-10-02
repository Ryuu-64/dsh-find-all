import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const source = readFileSync(process.env.FIND_ALL_PACKAGE_ROOT ? `${process.env.FIND_ALL_PACKAGE_ROOT}/lib/client.js` : new URL('../lib/client.js', import.meta.url), 'utf8');

function setup() {
  const dom = new JSDOM('<!doctype html><body><aside>outside needle</aside></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  globalThis.window = w;
  globalThis.document = w.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  w.HTMLElement.prototype.getClientRects = function () { return this.isConnected ? [{ width: 100, height: 20 }] : []; };
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.CSS = { highlights: new Map() };
  w.Highlight = class extends Set { constructor(...ranges) { super(ranges); } };
  let registration, Component;
  const cleanups = [], views = [], requested = [];
  let now = 0, serial = 0;
  const timers = new Map();
  w.setTimeout = (fn, delay) => { const id = ++serial; timers.set(id, { fn, at: now + delay }); return id; };
  w.setInterval = (fn, delay) => { const id = ++serial; timers.set(id, { fn, at: now + delay, interval: delay }); return id; };
  w.clearTimeout = w.clearInterval = id => timers.delete(id);
  w.Date.now = () => now;
  w.__ModuleLoader__ = { load(value) { registration = value; } };
  w.eval(source);
  const plugin = registration.factory(name => { assert.equal(name, 'react'); return React; });
  const faces = new Map();
  const ctx = {
    sessions: {
      list: { getSnapshot() { throw new Error('global session selection must never be read'); } },
      binding(id) { requested.push(id); return { session: faces.get(id) }; },
    },
    slots: {
      inject(name, callback) { assert.equal(name, 'conversation.session.header.utilities'); cleanups.push(callback()); },
      register(options, value) { assert.equal(options.name, 'conversation.session.header.utilities'); Component = value; return () => {}; },
    },
    effect(callback) { cleanups.push(callback()); },
  };
  plugin.apply(ctx);
  async function advance(ms) {
    const end = now + ms;
    for (;;) {
      const next = [...timers].filter(([, item]) => item.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at;
      if (next[1].interval) next[1].at += next[1].interval;
      else timers.delete(next[0]);
      next[1].fn();
      for (let i = 0; i < 12; i++) await Promise.resolve();
    }
    now = end;
    for (let i = 0; i < 12; i++) await Promise.resolve();
  }
  async function mount(id, modern = false) {
    const panel = w.document.createElement('section');
    panel.dataset.phase = 'active';
    panel.innerHTML = `<header><div class="utility"></div></header><div ${modern ? `data-conversation-content data-conversation-session="${id}"` : ''}><div data-conversation-scroll><div data-chat-flow><p>${id} needle</p></div><textarea>composer needle</textarea></div></div>`;
    w.document.body.append(panel);
    const root = createRoot(panel.querySelector('.utility'));
    await act(async () => root.render(React.createElement(Component, { sessionId: id })));
    const view = { panel, root, anchor: panel.querySelector('[data-find-all-session]'), flow: panel.querySelector('[data-chat-flow]') };
    views.push(view);
    return view;
  }
  function open(target) { (target || w.document.body).dispatchEvent(new w.KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true })); }
  function search(query) { const input = w.document.querySelector('#dsh-find-all-root input'); input.value = query; input.dispatchEvent(new w.Event('input', { bubbles: true })); }
  function status() { return w.document.querySelector('#dsh-find-all-root .status')?.textContent; }
  function count() { return w.document.querySelector('#dsh-find-all-root .count')?.textContent; }
  async function dispose() { for (const view of views.splice(0)) { await act(async () => view.root.unmount()); view.panel.remove(); } for (const cleanup of cleanups.splice(0).reverse()) cleanup?.(); }
  async function finish() { await dispose(); dom.window.close(); }
  return { w, plugin, ctx, faces, requested, timers, mount, open, search, status, count, advance, dispose, finish };
}

test('old and new skeletons bind explicit session ids and exclude sidebar/composer', async () => {
  for (const modern of [false, true]) {
    const h = setup();
    try {
      const view = await h.mount('session-a', modern);
      h.faces.set('session-a', { getSnapshot: () => ({ hasMore: false }), loadOlder() {} });
      h.open(view.anchor); h.search('needle'); await h.advance(251);
      assert.equal(h.count(), '1/1');
      assert.deepEqual(h.requested, ['session-a']);
      assert.equal(h.status(), 'Whole conversation loaded');
      assert.equal(h.w.CSS.highlights.get('dsh-find-all-hit').size, 1);
    } finally { await h.finish(); }
  }
});

test('transitional 0.1.6-alpha.2 content wrapper uses the explicit header session identity', async () => {
  const h = setup();
  try {
    const view = await h.mount('session-a', true);
    view.panel.querySelector('[data-conversation-content]').removeAttribute('data-conversation-session');
    h.faces.set('session-a', { getSnapshot: () => ({ hasMore: false }), loadOlder() {} });
    h.open(view.anchor); h.search('needle'); await h.advance(251);
    assert.equal(h.count(), '1/1');
    assert.deepEqual(h.requested, ['session-a']);
    assert.equal(h.status(), 'Whole conversation loaded');
  } finally { await h.finish(); }
});

test('multiple instances require focus; chosen instance survives focus in the find bar', async () => {
  const h = setup();
  try {
    const a = await h.mount('session-a'), b = await h.mount('session-b', true);
    h.faces.set('session-b', { getSnapshot: () => ({ hasMore: false }), loadOlder() {} });
    h.open(); h.search('needle'); await h.advance(251);
    assert.equal(h.count(), '0/0'); assert.equal(h.requested.length, 0);
    assert.match(h.status(), /Select a visible conversation/);
    h.open(b.anchor); h.search('needle'); await h.advance(1200);
    assert.equal(h.count(), '1/1'); assert.deepEqual(h.requested, ['session-b']);
    a.panel.hidden = true;
    b.panel.hidden = true;
    await h.advance(600);
    assert.equal(h.count(), '0/0');
    assert.equal(h.w.CSS.highlights.size, 0);
  } finally { await h.finish(); }
});

test('uncertain, replaced, hidden or mismatched DOM fails closed', async () => {
  for (const corrupt of [
    v => v.flow.removeAttribute('data-chat-flow'),
    v => v.panel.querySelector('[data-conversation-content]').setAttribute('data-conversation-session', 'wrong'),
    v => v.flow.appendChild(v.flow.cloneNode(true)),
    v => v.panel.style.visibility = 'hidden',
    v => v.panel.style.opacity = '0',
    v => v.panel.dataset.phase = 'hero',
  ]) {
    const h = setup();
    try {
      const v = await h.mount('session-a', true); corrupt(v);
      h.open(v.anchor); h.search('needle'); await h.advance(300);
      assert.equal(h.count(), '0/0'); assert.equal(h.requested.length, 0);
      assert.equal(h.w.CSS.highlights.size, 0);
    } finally { await h.finish(); }
  }
});

test('paging uses the bound session; rejected history preserves partial results', async () => {
  const h = setup();
  try {
    const v = await h.mount('session-a');
    let calls = 0;
    h.faces.set('session-a', { getSnapshot: () => ({ hasMore: true }), async loadOlder() {
      if (++calls === 2) throw new Error('synthetic failure');
      v.flow.insertAdjacentHTML('afterbegin', '<p>older needle</p>');
    } });
    h.open(v.anchor); h.search('needle'); await h.advance(300);
    assert.equal(calls, 2); assert.equal(h.count(), '1/2');
    assert.match(h.status(), /incomplete; partial results/);
  } finally { await h.finish(); }
});

test('close and lifecycle disposal clear timers, highlights, observers and keyboard listeners', async () => {
  const h = setup();
  const v = await h.mount('session-a');
  h.faces.set('session-a', { getSnapshot: () => ({ hasMore: true }), async loadOlder() {} });
  h.open(v.anchor); h.search('needle'); await h.advance(300);
  assert.ok(h.timers.size > 0);
  h.w.document.activeElement.dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(h.timers.size, 0); assert.equal(h.w.CSS.highlights.size, 0);
  h.open(v.anchor); h.search('needle'); await h.advance(300);
  await h.dispose();
  assert.equal(h.timers.size, 0); assert.equal(h.w.CSS.highlights.size, 0);
  assert.equal(h.w.document.querySelector('#dsh-find-all-root'), null);
  assert.equal(h.w.document.querySelector('[data-plugin-css]'), null);
  h.open(v.anchor);
  assert.equal(h.w.document.querySelector('#dsh-find-all-root'), null);
  h.w.close();
});


test('switching session cancels an in-flight request and cannot paint stale results', async () => {
  const h = setup();
  try {
    const a = await h.mount('session-a'), b = await h.mount('session-b', true);
    let finishA, callsA = 0, callsB = 0;
    h.faces.set('session-a', { getSnapshot: () => ({ hasMore: true }), loadOlder() {
      callsA++; return new Promise(resolve => finishA = resolve);
    } });
    h.faces.set('session-b', { getSnapshot: () => ({ hasMore: callsB === 0 }), async loadOlder() {
      callsB++; b.flow.insertAdjacentHTML('afterbegin', '<p>B older needle</p>');
    } });
    h.open(a.anchor); h.search('needle'); await h.advance(300);
    assert.equal(callsA, 1);
    b.anchor.dispatchEvent(new h.w.Event('pointerdown', { bubbles: true }));
    h.open(b.anchor); await h.advance(300);
    a.flow.insertAdjacentHTML('afterbegin', '<p>A stale needle</p>'); finishA();
    await h.advance(1000);
    assert.equal(callsA, 1); assert.equal(callsB, 1); assert.equal(h.count(), '1/2');
    const ranges = [...h.w.CSS.highlights.get('dsh-find-all-hit')];
    assert.ok(ranges.every(range => b.flow.contains(range.startContainer)));
  } finally { await h.finish(); }
});

test('two views of the same session are not confused, and no CSS API never invokes window.find', async () => {
  const h = setup();
  try {
    const a = await h.mount('same'), b = await h.mount('same', true);
    b.flow.insertAdjacentHTML('afterbegin', '<p>another needle</p>');
    h.faces.set('same', { getSnapshot: () => ({ hasMore: false }), loadOlder() {} });
    h.w.CSS = undefined;
    h.w.find = () => { throw new Error('must not search the whole window'); };
    h.open(); h.search('needle'); assert.equal(h.count(), '0/0');
    h.open(b.anchor); h.search('needle'); await h.advance(700);
    assert.equal(h.count(), '1/2');
    h.w.document.activeElement.dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'F3', bubbles: true }));
    assert.equal(h.count(), '2/2');
    assert.notEqual(a.panel, b.panel);
  } finally { await h.finish(); }
});


test('repeated disable and enable does not duplicate shortcuts or leave session subscriptions', async () => {
  const h = setup();
  try {
    let calls = 0;
    h.faces.set('session-a', { getSnapshot: () => ({ hasMore: true }), async loadOlder() { calls++; throw new Error('synthetic'); } });
    for (let cycle = 0; cycle < 3; cycle++) {
      if (cycle) h.plugin.apply(h.ctx);
      const v = await h.mount('session-a');
      h.open(v.anchor); h.search('needle'); await h.advance(300);
      assert.equal(calls, cycle + 1);
      assert.equal(h.w.document.querySelectorAll('#dsh-find-all-root').length, 1);
      await h.dispose();
      assert.equal(h.timers.size, 0);
      assert.equal(h.w.CSS.highlights.size, 0);
      assert.equal(h.w.document.querySelectorAll('[data-find-all-session]').length, 0);
    }
  } finally { h.w.close(); }
});

test('an unsupported focused view never redirects search to another valid view', async () => {
  const h = setup();
  try {
    const unsupported = await h.mount('session-a');
    await h.mount('session-b', true);
    unsupported.flow.removeAttribute('data-chat-flow');
    h.faces.set('session-b', { getSnapshot: () => ({ hasMore: false }), loadOlder() {} });
    for (const target of [unsupported.anchor, unsupported.panel.querySelector('textarea')]) {
      h.open(target); h.search('needle'); await h.advance(1200);
      assert.equal(h.count(), '0/0');
      assert.deepEqual(h.requested, []);
      assert.match(h.status(), /scope unavailable/i);
    }
    const valid = h.w.document.querySelector('[data-find-all-session="session-b"]');
    h.open(valid); h.search('needle'); await h.advance(300);
    assert.equal(h.count(), '1/1');
    assert.deepEqual(h.requested, ['session-b']);
  } finally { await h.finish(); }
});
