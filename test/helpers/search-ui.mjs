import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const source = readFileSync(process.env.FIND_ALL_PACKAGE_ROOT ? `${process.env.FIND_ALL_PACKAGE_ROOT}/lib/client.js` : new URL('../../lib/client.js', import.meta.url), 'utf8');

export function setup() {
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
  const cleanups = [], views = [], requested = [], scrolls = [];
  w.HTMLElement.prototype.scrollIntoView = function () { scrolls.push(this); };
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
  async function mount(id, modern = false, props = {}) {
    const panel = w.document.createElement('section');
    panel.dataset.phase = 'active';
    panel.innerHTML = `<header><div class="utility"></div></header><div ${modern ? `data-conversation-content data-conversation-session="${id}"` : ''}><div data-conversation-scroll><div data-chat-flow><p>${id} needle</p></div><textarea>composer needle</textarea></div></div>`;
    w.document.body.append(panel);
    const root = createRoot(panel.querySelector('.utility'));
    await act(async () => root.render(React.createElement(Component, { sessionId: id, ...props })));
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
  return { w, plugin, ctx, Component, faces, requested, timers, scrolls, mount, open, search, status, count, advance, dispose, finish };
}


export function snapshot(patch = {}) { return {openState: 'open', openError: null, loadingOlder: false, hasMore: true, ...patch}; }
export function key(h, key, extra = {}) { h.w.document.activeElement.dispatchEvent(new h.w.KeyboardEvent('keydown', {key, bubbles: true, ...extra})); }
export function current(h) { return [...(h.w.CSS.highlights.get('dsh-find-all-cur') || [])][0]; }
