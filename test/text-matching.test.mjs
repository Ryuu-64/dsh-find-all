// Isolated DOM/logic regression coverage for #3 and #4. CSS Highlight and layout
// are test doubles; this does not claim DSH Desktop/Electron/provider E2E.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const source = readFileSync(process.env.FIND_ALL_PACKAGE_ROOT ? `${process.env.FIND_ALL_PACKAGE_ROOT}/lib/client.js` : new URL('../lib/client.js', import.meta.url), 'utf8');

function fixture(html = '') {
  const dom = new JSDOM('<!doctype html><body><main></main></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  let entry;
  w.__ModuleLoader__ = { load(value) { entry = value; } };
  w.eval(source);
  const plugin = entry.factory(name => { assert.equal(name, 'react'); return React; });
  const root = w.document.querySelector('main');
  root.innerHTML = html;
  return { dom, w, root, plugin, ranges: query => Array.from(plugin.collectRanges(query, root)) };
}

function offsets(plugin, text, query) {
  return Array.from(plugin.findMatches(text, query), ({ start, end }) => [start, end]);
}

test('Unicode matching returns original UTF-16 positions without lowercasing expansion', () => {
  const h = fixture();
  try {
    assert.deepEqual(Array.from(h.plugin.findIndices('İx', 'x')), [1]);
    assert.deepEqual(offsets(h.plugin, 'İx', 'x'), [[1, 2]]);
    assert.deepEqual(offsets(h.plugin, '😀X𐐀x', 'x'), [[2, 3], [5, 6]]);
    assert.deepEqual(offsets(h.plugin, '😀𐐀𐐨x', '𐐨'), [[2, 4], [4, 6]]);
  } finally { h.dom.window.close(); }
});

test('matching uses simple folding with no locale, normalization or full-fold expansion', () => {
  const h = fixture();
  try {
    for (const [text, query, expected] of [
      ['ſsS', 's', [[0, 1], [1, 2], [2, 3]]],
      ['ẞß', 'ß', [[0, 1], [1, 2]]],
      ['Σσς', 'σ', [[0, 1], [1, 2], [2, 3]]],
      ['İ', 'i', []], ['ı', 'i', []], ['ß', 'ss', []],
      ['i\u0307', 'İ', []], ['İ', 'i\u0307', []],
      ['e\u0301', 'é', []], ['é', 'e\u0301', []], ['é', 'e', []],
      ['e\u0301', 'e', [[0, 1]]], // no automatic grapheme expansion
    ]) assert.deepEqual(offsets(h.plugin, text, query), expected, `${JSON.stringify(text)} / ${JSON.stringify(query)}`);
  } finally { h.dom.window.close(); }
});

test('all regexp punctuation stays literal without relying on RegExp.escape', () => {
  const h = fixture();
  try {
    h.w.RegExp.escape = undefined;
    const punctuation = '.*+?^${}()|[]\\-/';
    for (const query of [punctuation, ...punctuation, '\\1', '(?:x)', '[a-z]', 'a.b', 'a-b', '\n']) {
      assert.deepEqual(offsets(h.plugin, `z${query}z`, query), [[1, 1 + query.length]], JSON.stringify(query));
    }
    assert.deepEqual(offsets(h.plugin, 'axb a.b', 'a.b'), [[4, 7]]);
    assert.deepEqual(offsets(h.plugin, 'Hello 字体 HELLO 字体', 'hello'), [[0, 5], [9, 14]]);
    assert.deepEqual(offsets(h.plugin, 'Hello 字体 HELLO 字体', '字体'), [[6, 8], [15, 17]]);
    assert.deepEqual(offsets(h.plugin, 'aaaa', 'aa'), [[0, 2], [2, 4]]);
    assert.deepEqual(offsets(h.plugin, 'abc', ''), []);
    assert.deepEqual(offsets(h.plugin, 'abc', 'z'), []);
    assert.equal(offsets(h.plugin, 'x'.repeat(5001), 'x').length, 5000);
  } finally { h.dom.window.close(); }
});

test('one phrase maps across inline elements, whitespace nodes and three Text nodes', () => {
  const h = fixture();
  try {
    for (const html of [
      '<p>Hello <strong>world</strong></p>',
      '<p><strong>Hello</strong> <a href="#">world</a></p>',
      '<p><a href="#">Hello</a> <code>world</code></p>',
      '<div>Hello <em>world</em></div>', // host user bodies are not always p
      '<pre><code><span>Hello</span><span> </span><span>world</span></code></pre>',
    ]) {
      h.root.innerHTML = html;
      const before = h.root.innerHTML;
      const ranges = h.ranges('Hello world');
      assert.equal(ranges.length, 1, html);
      assert.equal(ranges[0].toString(), 'Hello world');
      assert.notEqual(ranges[0].startContainer, ranges[0].endContainer);
      assert.equal(ranges[0].startOffset, 0);
      assert.equal(ranges[0].endOffset, 5);
      assert.equal(h.root.innerHTML, before, 'search must not wrap or rewrite the body');
    }
  } finally { h.dom.window.close(); }
});

test('node junctions use the following start node and preceding end node', () => {
  const h = fixture('<p><span>ab</span><strong>cd</strong><em>ef</em></p>');
  try {
    const [a, b, c] = [...h.root.querySelector('p').children].map(el => el.firstChild);
    let [range] = h.ranges('cd');
    assert.equal(range.startContainer, b); assert.equal(range.startOffset, 0);
    assert.equal(range.endContainer, b); assert.equal(range.endOffset, 2);
    [range] = h.ranges('bcde');
    assert.equal(range.startContainer, a); assert.equal(range.startOffset, 1);
    assert.equal(range.endContainer, c); assert.equal(range.endOffset, 1);
    assert.equal(range.toString(), 'bcde');
    h.root.querySelector('p').insertBefore(h.w.document.createTextNode(''), b.parentNode);
    assert.equal(h.ranges('abcdef')[0].toString(), 'abcdef');
  } finally { h.dom.window.close(); }
});

test('UTF-16 offsets map to correct nodes after İ, emoji and non-BMP letters', () => {
  const h = fixture('<p><span>İ</span><strong>x</strong></p><p>😀<em>X</em>𐐀x</p>');
  try {
    const ranges = h.ranges('x');
    assert.deepEqual(ranges.map(r => r.toString()), ['x', 'X', 'x']);
    assert.deepEqual(ranges.map(r => [r.startOffset, r.endOffset]), [[0, 1], [0, 1], [2, 3]]);
    const [cross] = h.ranges('İx');
    assert.equal(cross.startContainer.data, 'İ'); assert.equal(cross.startOffset, 0);
    assert.equal(cross.endContainer.data, 'x'); assert.equal(cross.endOffset, 1);
    assert.equal(cross.toString(), 'İx');
  } finally { h.dom.window.close(); }
});

test('original whitespace and code newlines are neither trimmed nor collapsed', () => {
  const h = fixture('<p><strong>Hello</strong> <a>world</a></p><pre><code><span>foo</span>\n<span>bar</span></code></pre>');
  try {
    assert.equal(h.ranges('Hello world').length, 1);
    assert.equal(h.ranges('Helloworld').length, 0);
    assert.equal(h.ranges('foo\nbar')[0].toString(), 'foo\nbar');
    assert.equal(h.ranges('foobar').length, 0);
    assert.equal(h.ranges('foo bar').length, 0);
    h.root.innerHTML = '<p><span> a </span> \t<span> b </span></p>';
    assert.equal(h.ranges(' a  \t b ')[0].toString(), ' a  \t b ');
    assert.equal(h.ranges('a b').length, 0);
  } finally { h.dom.window.close(); }
});

test('phrases cannot cross independent structural blocks, messages or code toolbars', () => {
  const h = fixture();
  try {
    for (const html of [
      '<p>Hello </p><p>world</p>',
      '<h2>Hello </h2><p>world</p>',
      '<ul><li>Hello </li><li>world</li></ul>',
      '<table><tbody><tr><td>Hello </td><td>world</td></tr></tbody></table>',
      '<article><span>Hello </span></article><article>world</article>',
      '<div data-chat-node="a">Hello </div><div data-chat-node="b">world</div>',
      '<div data-code-block-banner>Hello </div><div data-code-block-content><pre><code>world</code></pre></div>',
      '<pre><code>Hello </code></pre><div data-code-block-banner>world</div>',
    ]) {
      h.root.innerHTML = html;
      assert.equal(h.ranges('Hello world').length, 0, html);
      assert.equal(h.ranges('Hello').length, 1, 'individual blocks remain searchable');
    }
  } finally { h.dom.window.close(); }
});

test('entering and leaving nested blocks prevents outer text from joining around them', () => {
  const h = fixture('<div>outer <div>inner</div>end</div>');
  try {
    for (const query of ['outer inner', 'innerend', 'outer end']) assert.equal(h.ranges(query).length, 0, query);
    assert.equal(h.ranges('inner').length, 1);
    assert.equal(h.ranges('outer ').length, 1);
    assert.equal(h.ranges('end').length, 1);
  } finally { h.dom.window.close(); }
});

test('br and existing excluded subtrees form boundaries instead of gluing text', () => {
  const h = fixture();
  try {
    for (const middle of ['<br>', '<script>hidden</script>', '<style>hidden</style>', '<noscript><b>hidden</b></noscript>', '<span id="dsh-find-all-root"><b>hidden</b></span>']) {
      h.root.innerHTML = `<p>foo${middle}bar</p>`;
      assert.equal(h.ranges('foobar').length, 0, middle);
      assert.equal(h.ranges('hidden').length, 0, middle);
      assert.equal(h.ranges('foo').length, 1);
      assert.equal(h.ranges('bar').length, 1);
    }
  } finally { h.dom.window.close(); }
});

test('each shadow root is searchable independently without cross-root phrases or Ranges', () => {
  const h = fixture('<p>outer<span id="host"></span>end</p><div>needle</div>');
  try {
    const shadow = h.root.querySelector('#host').attachShadow({ mode: 'open' });
    shadow.innerHTML = 'needle <strong>inside</strong><span id="nested"></span>';
    const nested = shadow.querySelector('#nested').attachShadow({ mode: 'open' });
    nested.innerHTML = '<span>needle</span>';
    assert.equal(h.ranges('needle inside')[0].toString(), 'needle inside');
    for (const query of ['outerend', 'outerneedle', 'insideend', 'insideneedle']) assert.equal(h.ranges(query).length, 0, query);
    const ranges = h.ranges('needle');
    assert.equal(ranges.length, 3);
    assert.equal(new Set(ranges.map(r => r.startContainer.getRootNode())).size, 3);
    for (const range of ranges) assert.equal(range.startContainer.getRootNode(), range.endContainer.getRootNode());
  } finally { h.dom.window.close(); }
});

test('the 5000 Range limit is global across text blocks', () => {
  const h = fixture(`<p>${'x'.repeat(4999)}</p><p><span>x</span><strong>x</strong>x</p>`);
  try {
    const ranges = h.ranges('x');
    assert.equal(ranges.length, 5000);
    assert.equal(ranges.at(-1).startContainer, h.root.querySelector('span').firstChild);
    assert.equal(h.ranges('').length, 0);
  } finally { h.dom.window.close(); }
});

async function mountedFixture(html) {
  const h = fixture();
  const { w } = h;
  globalThis.window = w;
  globalThis.document = w.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let Component, viewRoot, now = 0, serial = 0, scrolls = 0;
  const cleanups = [], timers = new Map(), errors = [];
  w.addEventListener('error', event => { errors.push(event.error); event.preventDefault(); });
  w.HTMLElement.prototype.getClientRects = function () { return this.isConnected ? [{ width: 100, height: 20 }] : []; };
  w.HTMLElement.prototype.scrollIntoView = () => { scrolls++; };
  w.CSS = { highlights: new Map() };
  w.Highlight = class extends Set { constructor(...ranges) { super(ranges); } };
  w.setTimeout = (fn, delay) => { const id = ++serial; timers.set(id, { fn, at: now + delay }); return id; };
  w.setInterval = (fn, delay) => { const id = ++serial; timers.set(id, { fn, at: now + delay, interval: delay }); return id; };
  w.clearTimeout = w.clearInterval = id => timers.delete(id);
  w.Date.now = () => now;
  h.plugin.apply({
    sessions: { binding(id) { assert.equal(id, 'session-a'); return { session: { getSnapshot: () => ({ hasMore: false }), loadOlder() {} } }; } },
    slots: {
      inject(name, callback) { assert.equal(name, 'conversation.session.header.utilities'); cleanups.push(callback()); },
      register(options, value) { Component = value; return () => {}; },
    },
    effect(callback) { cleanups.push(callback()); },
  });
  h.root.innerHTML = '<section data-phase="active"><header></header><div data-conversation-scroll><div data-chat-flow></div></div></section>';
  const flow = h.root.querySelector('[data-chat-flow]');
  flow.innerHTML = html;
  viewRoot = createRoot(h.root.querySelector('header'));
  await act(async () => viewRoot.render(React.createElement(Component, { sessionId: 'session-a' })));
  h.root.querySelector('[data-find-all-session]').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
  async function advance(ms) {
    for (let i = 0; i < 12; i++) await Promise.resolve(); // deliver the real MutationObserver
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
  }
  return {
    ...h, flow, advance, errors,
    search(query) { const input = w.document.querySelector('#dsh-find-all-root input'); input.value = query; input.dispatchEvent(new w.Event('input', { bubbles: true })); },
    navigate(shiftKey = false) { w.document.querySelector('#dsh-find-all-root input').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', shiftKey, bubbles: true })); },
    count: () => w.document.querySelector('#dsh-find-all-root .count').textContent,
    hits: () => [...(w.CSS.highlights.get('dsh-find-all-hit') || [])],
    current: () => [...(w.CSS.highlights.get('dsh-find-all-cur') || [])],
    scrolls: () => scrolls,
    async finish() { await act(async () => viewRoot.unmount()); for (const cleanup of cleanups.reverse()) cleanup?.(); h.dom.window.close(); },
  };
}

test('bar counts and navigates each cross-node phrase as one whole hit', async () => {
  const h = await mountedFixture('<p>Hello <strong>world</strong></p><p><a>Hello</a> <code>world</code></p>');
  try {
    h.search('Hello world'); await h.advance(251);
    assert.equal(h.count(), '1/2');
    assert.deepEqual(h.hits().map(r => r.toString()), ['Hello world', 'Hello world']);
    assert.equal(h.current()[0], h.hits()[0]);
    const before = h.scrolls();
    h.navigate();
    assert.equal(h.count(), '2/2'); assert.equal(h.current()[0], h.hits()[1]);
    h.navigate(true);
    assert.equal(h.count(), '1/2'); assert.equal(h.current()[0], h.hits()[0]);
    assert.equal(h.scrolls(), before + 2);
    assert.deepEqual(h.errors, []);
  } finally { await h.finish(); }
});

test('bar handles İ without an offset error and highlights only original x characters', async () => {
  const h = await mountedFixture('<p>İx</p><p><span>İ</span><em>x</em></p>');
  try {
    h.search('x'); await h.advance(251);
    assert.deepEqual(h.errors, []);
    assert.equal(h.count(), '1/2');
    assert.deepEqual(h.hits().map(r => r.toString()), ['x', 'x']);
    assert.deepEqual(h.hits().map(r => [r.startOffset, r.endOffset]), [[1, 2], [0, 1]]);
  } finally { await h.finish(); }
});

test('existing observer rescans plain code after a highlighted span-tree replacement', async () => {
  const h = await mountedFixture('<div data-code-block-banner>copy</div><div data-code-block-content><pre><code>Hello world\nnext line</code></pre></div>');
  try {
    h.search('Hello world'); await h.advance(251);
    assert.equal(h.count(), '1/1');
    assert.equal(h.hits()[0].toString(), 'Hello world');
    const oldNode = h.hits()[0].startContainer;
    const before = h.scrolls();
    h.flow.querySelector('[data-code-block-content]').innerHTML = '<div><pre><code><span class="line"><span>Hello </span><span>world</span></span>\n<span class="line"><span>next</span><span> line</span></span></code></pre></div>';
    await h.advance(251);
    assert.equal(oldNode.isConnected, false);
    assert.equal(h.count(), '1/1');
    assert.equal(h.hits()[0].toString(), 'Hello world');
    assert.notEqual(h.hits()[0].startContainer, oldNode);
    assert.notEqual(h.hits()[0].startContainer, h.hits()[0].endContainer);
    assert.equal(h.scrolls(), before, 'background rescan must not add scrolling');
    assert.deepEqual(h.errors, []);
  } finally { await h.finish(); }
});
