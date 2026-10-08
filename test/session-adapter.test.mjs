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
  const plugin = registration.factory(name => {
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return {
      Button: ({size, variant, ...props}) => React.createElement('button', props),
      IconSearchOutlineRegular: ({size}) => React.createElement('svg', {width: size, height: size, 'aria-hidden': true}),
    };
    assert.equal(name, 'react'); return React;
  });
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
      for (let i = 0; i < 60; i++) await Promise.resolve();
    }
    now = end;
    for (let i = 0; i < 60; i++) await Promise.resolve();
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
  return { w, plugin, ctx, Component, faces, requested, timers, mount, open, search, status, count, advance, dispose, finish };
}

test('old and new skeletons bind explicit session ids and exclude sidebar/composer', async () => {
  for (const modern of [false, true]) {
    const h = setup();
    try {
      const view = await h.mount('session-a', modern);
      h.faces.set('session-a', { getSnapshot: () => ({openState: 'open', openError: null, loadingOlder: false, hasMore: false }), loadOlder() {} });
      h.open(view.anchor); h.search('needle'); await h.advance(251);
      assert.equal(h.count(), '1/1');
      assert.deepEqual([...new Set(h.requested)], ['session-a']);
      assert.equal(h.status(), 'Searched currently available history; the host offers no earlier pages, so completeness cannot be confirmed');
      assert.equal(h.w.CSS.highlights.get('dsh-find-all-hit').size, 1);
    } finally { await h.finish(); }
  }
});

test('transitional 0.1.6-alpha.2 content wrapper uses the explicit header session identity', async () => {
  const h = setup();
  try {
    const view = await h.mount('session-a', true);
    view.panel.querySelector('[data-conversation-content]').removeAttribute('data-conversation-session');
    h.faces.set('session-a', { getSnapshot: () => ({openState: 'open', openError: null, loadingOlder: false, hasMore: false }), loadOlder() {} });
    h.open(view.anchor); h.search('needle'); await h.advance(251);
    assert.equal(h.count(), '1/1');
    assert.deepEqual([...new Set(h.requested)], ['session-a']);
    assert.equal(h.status(), 'Searched currently available history; the host offers no earlier pages, so completeness cannot be confirmed');
  } finally { await h.finish(); }
});

test('multiple instances require focus; chosen instance survives focus in the find bar', async () => {
  const h = setup();
  try {
    const a = await h.mount('session-a'), b = await h.mount('session-b', true);
    h.faces.set('session-b', { getSnapshot: () => ({openState: 'open', openError: null, loadingOlder: false, hasMore: false }), loadOlder() {} });
    h.open(); h.search('needle'); await h.advance(251);
    assert.equal(h.count(), '0/0'); assert.equal(h.requested.length, 0);
    assert.match(h.status(), /Select a visible conversation/);
    h.open(b.anchor); h.search('needle'); await h.advance(1200);
    assert.equal(h.count(), '1/1'); assert.deepEqual([...new Set(h.requested)], ['session-b']);
    a.panel.hidden = true;
    b.panel.hidden = true;
    await h.advance(600);
    assert.equal(h.count(), '0/0');
    assert.equal(h.w.CSS.highlights.size, 0);
  } finally { await h.finish(); }
});

test('first body-focused Ctrl+F discovers the sole visible registered conversation without a preparatory click', async () => {
  const h = setup();
  try {
    await h.mount('session-a', true);
    h.faces.set('session-a', { getSnapshot: () => ({openState: 'open', openError: null, loadingOlder: false, hasMore: false }), loadOlder() {} });
    assert.equal(h.w.document.activeElement, h.w.document.body);
    h.open(); h.search('needle'); await h.advance(1200);
    assert.equal(h.count(), '1/1');
    assert.deepEqual([...new Set(h.requested)], ['session-a']);
    assert.equal(h.status(), 'Searched currently available history; the host offers no earlier pages, so completeness cannot be confirmed');
  } finally { await h.finish(); }
});

test('first body shortcut cannot infer A while an unregistered visible B panel also exists', async () => {
  const h = setup();
  try {
    await h.mount('session-a');
    const b = h.w.document.createElement('section');
    b.dataset.phase = 'active';
    b.innerHTML = '<div data-conversation-scroll><div data-chat-flow>unregistered needle</div></div>';
    h.w.document.body.append(b);
    h.open(); h.search('needle'); await h.advance(1200);
    assert.equal(h.count(), '0/0'); assert.deepEqual([...new Set(h.requested)], []);
    b.remove();
    h.open(h.w.document.body); await h.advance(1200);
    assert.equal(h.count(), '0/0'); assert.deepEqual([...new Set(h.requested)], []);
  } finally { await h.finish(); }
});

test('initial unbound Hero composer focus does not count as a rejected conversation selection', async () => {
  const h = setup();
  try {
    // Official startup-auto-selection.e2e.ts distinguishes the resident Hero
    // root from the composer's unrelated data-phase attribute.
    const hero = h.w.document.createElement('div');
    hero.dataset.phase = 'hero';
    hero.innerHTML = '<div data-conversation-scroll><textarea data-phase="idle"></textarea></div>';
    h.w.document.body.append(hero);
    hero.querySelector('textarea').focus();
    hero.remove();
    await h.mount('session-a');
    h.faces.set('session-a', { getSnapshot: () => ({openState: 'open', openError: null, loadingOlder: false, hasMore: false }), loadOlder() {} });
    h.open(); h.search('needle'); await h.advance(1200);
    assert.equal(h.count(), '1/1'); assert.deepEqual([...new Set(h.requested)], ['session-a']);
  } finally { await h.finish(); }
});

test('composer data-phase is not confused with the enclosing conversation root', async () => {
  const h = setup();
  try {
    const a = await h.mount('session-a');
    await h.mount('session-b');
    h.faces.set('session-a', { getSnapshot: () => ({openState: 'open', openError: null, loadingOlder: false, hasMore: false }), loadOlder() {} });
    const composer = a.panel.querySelector('textarea');
    composer.dataset.phase = 'claimed';
    composer.focus();
    h.open(composer); h.search('needle'); await h.advance(1200);
    assert.equal(h.count(), '1/1'); assert.deepEqual([...new Set(h.requested)], ['session-a']);
  } finally { await h.finish(); }
});

test('a broken nested active panel remains a boundary and cannot resolve to its outer registered conversation', async () => {
  const h = setup();
  try {
    const a = await h.mount('session-a');
    const b = h.w.document.createElement('section');
    b.dataset.phase = 'active';
    b.innerHTML = '<button>unsupported conversation</button>';
    a.flow.append(b);
    b.querySelector('button').focus();
    h.open(b.querySelector('button')); h.search('needle'); await h.advance(1200);
    assert.equal(h.count(), '0/0'); assert.deepEqual([...new Set(h.requested)], []);
  } finally { await h.finish(); }
});

for (const phase of ['hero', 'settling', 'future-unsupported']) {
  test(`first shortcut rejects another visible registered ${phase} instance`, async () => {
    const h = setup();
    try {
      const a = await h.mount('session-a', true), b = await h.mount('session-b', true);
      b.panel.dataset.phase = phase;
      h.faces.set('session-a', { getSnapshot: () => ({openState: 'open', openError: null, loadingOlder: false, hasMore: false }), loadOlder() {} });
      h.open(); h.search('needle'); await h.advance(1200);
      assert.equal(h.count(), '0/0'); assert.deepEqual([...new Set(h.requested)], []);
      h.open(a.anchor); h.search('needle'); await h.advance(1200);
      assert.equal(h.count(), '1/1'); assert.deepEqual([...new Set(h.requested)], ['session-a']);
    } finally { await h.finish(); }
  });
}

function embeddedConversation(h, phase = 'active') {
  const sidebar = h.w.document.createElement('div');
  sidebar.setAttribute('data-sidebar-chat', '');
  // Exact rc2 SidebarChatTab + embedded ConversationContent attributes; no
  // main data-phase root or session header utility is supplied by that layout.
  sidebar.innerHTML = `<div data-conversation-content data-conversation-session="session-b" data-conversation-region="chat" data-content-phase="${phase}"><div data-conversation-scroll><div data-chat-flow><p>B needle</p></div><textarea data-phase="plain"></textarea></div></div>`;
  h.w.document.body.append(sidebar);
  return sidebar;
}

test('first shortcut accounts for a visible embedded sidebar without a header anchor', async () => {
  const h = setup();
  try {
    await h.mount('session-a', true);
    embeddedConversation(h);
    h.open(); h.search('needle'); await h.advance(1200);
    assert.equal(h.count(), '0/0'); assert.deepEqual([...new Set(h.requested)], []);
  } finally { await h.finish(); }
});

for (const phase of ['active', 'hero', 'settling']) {
  test(`explicit unregistered embedded ${phase} interaction stays rejected after it disappears`, async () => {
    const h = setup();
    try {
      await h.mount('session-a', true);
      const b = embeddedConversation(h, phase);
      b.querySelector('textarea').focus(); b.remove();
      h.open(); h.search('needle'); await h.advance(1200);
      assert.equal(h.count(), '0/0'); assert.deepEqual([...new Set(h.requested)], []);
    } finally { await h.finish(); }
  });
}

test('a hidden embedded view does not make the sole visible main conversation ambiguous', async () => {
  const h = setup();
  try {
    await h.mount('session-a', true);
    embeddedConversation(h).hidden = true;
    h.faces.set('session-a', { getSnapshot: () => ({openState: 'open', openError: null, loadingOlder: false, hasMore: false }), loadOlder() {} });
    h.open(); h.search('needle'); await h.advance(1200);
    assert.equal(h.count(), '1/1'); assert.deepEqual([...new Set(h.requested)], ['session-a']);
  } finally { await h.finish(); }
});

test('an unbound Hero beside an already visible session does not reset explicit rejection', async () => {
  const h = setup();
  try {
    await h.mount('session-a', true);
    const hero = h.w.document.createElement('div');
    hero.dataset.phase = 'hero';
    hero.innerHTML = '<div data-conversation-scroll><textarea data-phase="plain"></textarea></div>';
    h.w.document.body.append(hero);
    hero.querySelector('textarea').focus(); hero.remove();
    h.open(); h.search('needle'); await h.advance(1200);
    assert.equal(h.count(), '0/0'); assert.deepEqual([...new Set(h.requested)], []);
  } finally { await h.finish(); }
});

test('a visible registered unsupported panel still blocks discovery when its utility is hidden', async () => {
  const h = setup();
  try {
    await h.mount('session-a', true);
    const b = await h.mount('session-b', true);
    b.panel.dataset.phase = 'future-unsupported';
    b.panel.querySelector('[data-conversation-scroll]').remove();
    b.anchor.hidden = true;
    h.open(); h.search('needle'); await h.advance(1200);
    assert.equal(h.count(), '0/0'); assert.deepEqual([...new Set(h.requested)], []);
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
    h.faces.set('session-a', { getSnapshot: () => ({openState: 'open', openError: null, loadingOlder: false, hasMore: true }), async loadOlder() {
      if (++calls === 2) throw new Error('synthetic failure');
      v.flow.insertAdjacentHTML('afterbegin', '<p>older needle</p>');
    } });
    h.open(v.anchor); h.search('needle'); await h.advance(600);
    assert.equal(calls, 2); assert.equal(h.count(), '2/2');
    assert.match(h.status(), /incomplete; partial results/);
  } finally { await h.finish(); }
});

test('close and lifecycle disposal clear timers, highlights, observers and keyboard listeners', async () => {
  const h = setup();
  const v = await h.mount('session-a');
  h.faces.set('session-a', { getSnapshot: () => ({openState: 'open', openError: null, loadingOlder: false, hasMore: true }), async loadOlder() {} });
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
    h.faces.set('session-a', { getSnapshot: () => ({openState: 'open', openError: null, loadingOlder: false, hasMore: true }), loadOlder() {
      callsA++; return new Promise(resolve => finishA = resolve);
    } });
    h.faces.set('session-b', { getSnapshot: () => ({openState: 'open', openError: null, loadingOlder: false, hasMore: callsB === 0 }), async loadOlder() {
      callsB++; b.flow.insertAdjacentHTML('afterbegin', '<p>B older needle</p>');
    } });
    h.open(a.anchor); h.search('needle'); await h.advance(300);
    assert.equal(callsA, 1);
    b.anchor.dispatchEvent(new h.w.Event('pointerdown', { bubbles: true }));
    h.open(b.anchor); await h.advance(300);
    a.flow.insertAdjacentHTML('afterbegin', '<p>A stale needle</p>'); finishA();
    await h.advance(1000);
    assert.equal(callsA, 1); assert.equal(callsB, 1); assert.equal(h.count(), '2/2');
    const ranges = [...h.w.CSS.highlights.get('dsh-find-all-hit')];
    assert.ok(ranges.every(range => b.flow.contains(range.startContainer)));
  } finally { await h.finish(); }
});

test('two views of the same session are not confused, and no CSS API never invokes window.find', async () => {
  const h = setup();
  try {
    const a = await h.mount('same'), b = await h.mount('same', true);
    b.flow.insertAdjacentHTML('afterbegin', '<p>another needle</p>');
    h.faces.set('same', { getSnapshot: () => ({openState: 'open', openError: null, loadingOlder: false, hasMore: false }), loadOlder() {} });
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
    h.faces.set('session-a', { getSnapshot: () => ({openState: 'open', openError: null, loadingOlder: false, hasMore: true }), async loadOlder() { calls++; throw new Error('synthetic'); } });
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
    h.faces.set('session-b', { getSnapshot: () => ({openState: 'open', openError: null, loadingOlder: false, hasMore: false }), loadOlder() {} });
    for (const target of [unsupported.anchor, unsupported.panel.querySelector('textarea')]) {
      h.open(target); h.search('needle'); await h.advance(1200);
      assert.equal(h.count(), '0/0');
      assert.deepEqual([...new Set(h.requested)], []);
      assert.match(h.status(), /scope unavailable/i);
    }
    const valid = h.w.document.querySelector('[data-find-all-session="session-b"]');
    h.open(valid); h.search('needle'); await h.advance(300);
    assert.equal(h.count(), '1/1');
    assert.deepEqual([...new Set(h.requested)], ['session-b']);
  } finally { await h.finish(); }
});


test('focused unregistered conversation must not fall back to sole other registered session', async () => {
  const h = setup();
  try {
    const a = await h.mount('session-a', true);
    h.faces.set('session-a', { getSnapshot: () => ({openState: 'open', openError: null, loadingOlder: false, hasMore: false}), loadOlder() {} });
    const b = h.w.document.createElement('section');
    b.dataset.phase = 'active';
    b.innerHTML = '<header></header><div data-conversation-content data-conversation-session="session-b"><div data-conversation-scroll><div data-chat-flow><p>B other text</p></div><textarea></textarea></div></div>';
    h.w.document.body.append(b);
    const focus = b.querySelector('textarea');
    focus.focus();
    h.open(focus); h.search('needle'); await h.advance(1200);
    assert.equal(h.count(), '0/0');
    assert.deepEqual([...new Set(h.requested)], []);
  } finally { await h.finish(); }
});
test('click in a second non-focusable conversation remains selected through polling', async () => {
  const h = setup();
  try {
    const a = await h.mount('session-a', true), b = await h.mount('session-b', true);
    b.flow.append(h.w.document.createTextNode(' needle'));
    h.faces.set('session-a', { getSnapshot: () => ({openState: 'open', openError: null, loadingOlder: false, hasMore: false}), loadOlder() {} });
    h.faces.set('session-b', { getSnapshot: () => ({openState: 'open', openError: null, loadingOlder: false, hasMore: false}), loadOlder() {} });
    h.open(a.anchor); h.search('needle'); await h.advance(300);
    const p = b.flow.querySelector('p');
    p.dispatchEvent(new h.w.Event('pointerdown', {bubbles:true}));
    h.w.document.activeElement.blur();
    await h.advance(1200);
    assert.equal(h.count(), '1/2');
  } finally { await h.finish(); }
});

function addUnregistered(h, id = 'session-b') {
  const panel = h.w.document.createElement('section');
  panel.dataset.phase = 'active';
  panel.innerHTML = `<header></header><div data-conversation-content data-conversation-session="${id}"><div data-conversation-scroll><div data-chat-flow><p>${id} other text</p></div><textarea></textarea></div></div>`;
  h.w.document.body.append(panel);
  return panel;
}
function clickText(h, el) {
  el.dispatchEvent(new h.w.Event('pointerdown', {bubbles:true}));
  h.w.document.activeElement.blur();
}
function idleFaces(h, ...ids) { for (const id of ids) h.faces.set(id, {getSnapshot: () => ({openState: 'open', openError: null, loadingOlder: false, hasMore:false}), loadOlder() {}}); }
function observation(h) {return {count:h.count(), requested:h.requested, status:h.status(), focus:h.w.document.activeElement.tagName};}

test('P1 rejected unregistered message click stays rejected after passive polls', async () => {
  const h=setup();
  try {
    const a=await h.mount('session-a',true), b=addUnregistered(h);
    idleFaces(h,'session-a');
    h.open(a.anchor);h.search('needle');await h.advance(300);
    h.requested.length=0;
    clickText(h,b.querySelector('p'));
    assert.equal(h.count(),'0/0');
    await h.advance(1200);
    assert.equal(h.count(),'0/0');assert.deepEqual(h.requested,[]);
  } finally {await h.finish();}
});

test('P2 explicit registered message click survives repeated Ctrl+F on body', async () => {
  const h=setup();
  try {
    const a=await h.mount('session-a',true), b=await h.mount('session-b',true);
    idleFaces(h,'session-a','session-b');
    b.flow.append(h.w.document.createTextNode(' needle'));
    h.open(a.anchor);h.search('needle');await h.advance(300);
    clickText(h,b.flow.querySelector('p'));await h.advance(1200);
    assert.equal(h.count(),'1/2');
    h.open(h.w.document.body);await h.advance(1200);
    assert.equal(h.count(),'1/2');
  } finally {await h.finish();}
});

test('P1 detach selected anchor never picks the sole other registered view', async () => {
  const h=setup();
  try {
    const a=await h.mount('session-a',true), b=await h.mount('session-b',true);
    idleFaces(h,'session-a','session-b');
    b.flow.append(h.w.document.createTextNode(' needle'));
    h.open(a.anchor);h.search('needle');await h.advance(300);
    clickText(h,a.flow.querySelector('p'));
    h.requested.length=0;
    await act(async () => a.root.render(null));
    await h.advance(1200);
    assert.equal(h.count(),'0/0');assert.deepEqual(h.requested,[]);
  } finally {await h.finish();}
});

test('removed selected panel and in-flight request stay cancelled', async () => {
  const h=setup();
  try {
    const a=await h.mount('session-a',true), b=await h.mount('session-b',true);
    let finish, calls=0;
    h.faces.set('session-a',{getSnapshot:()=>({openState: 'open', openError: null, loadingOlder: false, hasMore:true}),loadOlder(){calls++;return new Promise(r=>finish=r);}});
    idleFaces(h,'session-b');
    h.open(a.anchor);h.search('needle');await h.advance(300);
    clickText(h,a.flow.querySelector('p'));
    a.panel.remove();await h.advance(1200);
    finish();await h.advance(1200);
    assert.equal(h.count(),'0/0');assert.equal(calls,1);assert.deepEqual([...new Set(h.requested)],['session-a']);
  } finally {await h.finish();}
});

test('replaced flow revalidates same explicit view and ignores old pending data',async()=>{
  const h=setup();
  try {
    const a=await h.mount('session-a',true),b=await h.mount('session-b',true);
    idleFaces(h,'session-a','session-b');
    h.open(a.anchor);h.search('needle');await h.advance(300);
    clickText(h,a.flow.querySelector('p'));
    const old=a.flow,newFlow=old.cloneNode(true);newFlow.append(h.w.document.createTextNode(' needle'));
    old.replaceWith(newFlow);a.flow=newFlow;await h.advance(1200);
    assert.equal(h.count(),'1/2');
    old.append(h.w.document.createTextNode(' needle needle'));await h.advance(1200);
    assert.equal(h.count(),'1/2');
    assert.ok([...h.w.CSS.highlights.get('dsh-find-all-hit')].every(r=>newFlow.contains(r.startContainer)));
  } finally {await h.finish();}
});

test('same anchor rebound to a new session does not page the old session again',async()=>{
  const h=setup();
  try {
    const a=await h.mount('session-a',true), b=await h.mount('session-b',true);
    let finish,calls=0;
    h.faces.set('session-a',{getSnapshot:()=>({openState: 'open', openError: null, loadingOlder: false, hasMore:true}),loadOlder(){calls++;return new Promise(r=>finish=r);}});
    idleFaces(h,'session-c','session-b');
    h.open(a.anchor);h.search('needle');await h.advance(300);
    a.panel.querySelector('[data-conversation-content]').setAttribute('data-conversation-session','session-c');
    a.flow.textContent='session-c needle needle';
    await act(async()=>a.root.render(React.createElement(h.Component,{sessionId:'session-c'})));
    finish();await h.advance(1200);
    assert.equal(calls,1);
    assert.ok(!h.requested.includes('session-b'));
    assert.equal(h.count(),'0/0');
    const anchor=a.panel.querySelector('[data-find-all-session]');
    h.open(anchor);await h.advance(300);assert.equal(h.count(),'1/2');
    assert.equal(h.requested.at(-1),'session-c');
  }finally{await h.finish();}
});

test('closed-bar interactions establish or reject the next shortcut context', async () => {
  const h = setup();
  try {
    await h.mount('session-a', true);
    const b = await h.mount('session-b', true);
    idleFaces(h, 'session-a', 'session-b');
    b.flow.append(h.w.document.createTextNode(' needle'));
    clickText(h, b.flow.querySelector('p'));
    h.open(h.w.document.body); h.search('needle'); await h.advance(1200);
    assert.equal(h.count(), '1/2'); assert.deepEqual([...new Set(h.requested)], ['session-b']);
    h.w.document.activeElement.dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const unsupported = addUnregistered(h, 'session-c');
    clickText(h, unsupported.querySelector('p'));
    h.open(h.w.document.body); h.search('needle'); await h.advance(1200);
    assert.equal(h.count(), '0/0'); assert.deepEqual([...new Set(h.requested)], ['session-b']);
  } finally { await h.finish(); }
});
