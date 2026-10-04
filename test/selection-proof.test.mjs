import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { captureInitialSelection, assertRetainedSelection, assertCompleteFixtureRanges, assertSelectedFixtureToken } from '../scripts/compat/selection-proof.mjs';

function fixture(first = 56) {
  const dom = new JSDOM('<div data-chat-flow></div>');
  const previousDocument = globalThis.document, previousCss = globalThis.CSS;
  globalThis.document = dom.window.document;
  globalThis.CSS = { highlights: new Map() };
  const flow = document.querySelector('[data-chat-flow]');
  const query = 'FIND_ALL_A_USER_';
  const nodes = new Map();
  function add(index, before = null) {
    const p = document.createElement('p');
    p.textContent = `FIND_ALL_A_USER_${String(index).padStart(3, '0')} synthetic user`;
    flow.insertBefore(p, before);
    nodes.set(index, p.firstChild);
  }
  for (let index = first; index <= 80; index++) add(index);
  function range(index, length = query.length) {
    const result = document.createRange();
    result.setStart(nodes.get(index), 0); result.setEnd(nodes.get(index), length);
    return result;
  }
  function publish(current) {
    CSS.highlights.set('dsh-find-all-hit', new Set([...flow.children].map(p => {
      const result = document.createRange(); result.setStart(p.firstChild, 0); result.setEnd(p.firstChild, query.length); return result;
    })));
    CSS.highlights.set('dsh-find-all-cur', new Set([range(current)]));
  }
  publish(first);
  return { flow, query, nodes, add, range, publish, finish() {
    globalThis.document = previousDocument; globalThis.CSS = previousCss; dom.window.close();
  } };
}

test('selection proof accepts exact node retention across prepend and ordered 80-match identity', () => {
  const f = fixture();
  try {
    const saved = captureInitialSelection({ label: 'A', query: f.query });
    const original = f.flow.firstChild;
    for (let index = 1; index < 56; index++) f.add(index, original);
    f.publish(56);
    assert.equal(assertCompleteFixtureRanges({ label: 'A', query: f.query }), 80);
    assert.equal(assertRetainedSelection(saved), 56);
    f.publish(57);
    assert.equal(assertSelectedFixtureToken({ label: 'A', query: f.query, marker: 57, total: 80 }), 57);
    f.publish(56);
    assert.equal(assertRetainedSelection(saved), 56);
  } finally { f.finish(); }
});

test('selection proof rejects a reset to first hit and a replacement with identical text', () => {
  const f = fixture(1);
  try {
    const saved = captureInitialSelection({ label: 'A', query: f.query });
    f.publish(2);
    assert.throws(() => assertRetainedSelection(saved), /exact expected hit|exact original Text/);
    f.nodes.get(1).parentElement.textContent = saved.text;
    f.nodes.set(1, f.flow.firstChild.firstChild); f.publish(1);
    assert.throws(() => assertRetainedSelection(saved), /exact expected hit|exact original Text/);
  } finally { f.finish(); }
});

test('selection proof rejects offset changes, wrong order and incorrect navigation identity', () => {
  const f = fixture(1);
  try {
    const saved = captureInitialSelection({ label: 'A', query: f.query });
    CSS.highlights.set('dsh-find-all-cur', new Set([f.range(1, f.query.length - 1)]));
    assert.throws(() => assertRetainedSelection(saved), /exact expected hit|exact original Text/);
    f.publish(1);
    assert.throws(() => assertSelectedFixtureToken({ label: 'A', query: f.query, marker: 2, total: 80 }), /exact expected hit|exact fixture token/);
    CSS.highlights.set('dsh-find-all-hit', new Set([...CSS.highlights.get('dsh-find-all-hit')].reverse()));
    assert.throws(() => assertCompleteFixtureRanges({ label: 'A', query: f.query }), /identity, order, scope and offsets/);
  } finally { f.finish(); }
});

test('first-match proof rejects missing current selection and accepts only the unique 001 token', () => {
  const f = fixture(1);
  try {
    const query = 'FIND_ALL_A_USER_001';
    CSS.highlights.set('dsh-find-all-hit', new Set([f.range(1, query.length)]));
    CSS.highlights.set('dsh-find-all-cur', new Set());
    assert.throws(() => assertSelectedFixtureToken({ label: 'A', query, marker: 1, total: 1 }), /one current/);
    CSS.highlights.set('dsh-find-all-cur', new Set([f.range(1, query.length)]));
    assert.equal(assertSelectedFixtureToken({ label: 'A', query, marker: 1, total: 1 }), 1);
    CSS.highlights.set('dsh-find-all-cur', new Set([f.range(2, query.length)]));
    assert.throws(() => assertSelectedFixtureToken({ label: 'A', query, marker: 1, total: 1 }), /exact expected hit|exact fixture token/);
  } finally { f.finish(); }
});

test('current highlight cannot be an independent same-text clone outside the hit set', () => {
  const f = fixture(1);
  try {
    const duplicate = document.createElement('p'); duplicate.textContent = f.nodes.get(1).data;
    f.flow.append(duplicate);
    const wrong = document.createRange(); wrong.setStart(duplicate.firstChild, 0); wrong.setEnd(duplicate.firstChild, f.query.length);
    CSS.highlights.set('dsh-find-all-cur', new Set([wrong]));
    assert.throws(() => assertSelectedFixtureToken({ label: 'A', query: f.query, marker: 1, total: 80 }), /exact expected hit/);
  } finally { f.finish(); }
});

test('a still-connected original hit moved out of the active flow is rejected', () => {
  const f = fixture(1);
  try {
    const saved = captureInitialSelection({ label: 'A', query: f.query });
    document.body.append(saved.node.parentElement);
    assert.equal(saved.node.isConnected, true);
    const outside = document.createRange(); outside.setStart(saved.node, saved.start); outside.setEnd(saved.node, saved.end);
    const hits = [...CSS.highlights.get('dsh-find-all-hit')]; hits[0] = outside;
    CSS.highlights.set('dsh-find-all-hit', new Set(hits));
    CSS.highlights.set('dsh-find-all-cur', new Set([outside]));
    assert.throws(() => assertRetainedSelection(saved), /active flow/);
    assert.throws(() => assertSelectedFixtureToken({ label: 'A', query: f.query, marker: 1, total: 80 }), /active flow/);
  } finally { f.finish(); }
});
