import test from 'node:test';
import assert from 'node:assert/strict';
import {setup, snapshot, key, current} from './helpers/search-ui.mjs';

function input(h) { return h.w.document.querySelector('#dsh-find-all-root input'); }
function select(h, element) { const r = h.w.document.createRange(); r.selectNodeContents(element); h.w.getSelection().removeAllRanges(); h.w.getSelection().addRange(r); }
function idle(h, id) { h.faces.set(id, {getSnapshot: () => snapshot({hasMore: false}), loadOlder() {assert.fail('terminal host');}}); }

test('two Escape/reopen cycles restore the same query and Enter immediately navigates', async () => {
  const h = setup();
  try {
    const v = await h.mount('a'); v.flow.innerHTML = '<p>A needle</p><p>B needle</p>'; idle(h, 'a');
    h.open(v.anchor); h.search('needle'); await h.advance(600);
    for (let cycle = 0; cycle < 2; cycle++) {
      key(h, 'Escape'); h.w.getSelection().removeAllRanges();
      assert.equal(h.w.CSS.highlights.size, 0); assert.equal(h.timers.size, 0);
      h.open(); await h.advance(600);
      assert.equal(input(h).value, 'needle'); assert.equal(h.count(), '1/2'); assert.equal(current(h).toString(), 'needle');
      key(h, 'Enter'); assert.equal(h.count(), '2/2'); assert.equal(current(h).startContainer.parentElement.textContent, 'B needle');
    }
  } finally { await h.finish(); }
});

test('new trimmed selection wins while empty and oversized selections retain the query', async () => {
  const h = setup();
  try {
    const v = await h.mount('a'); v.flow.innerHTML = '<p>needle</p><p>  newer  </p><p>  </p><p>' + 'x'.repeat(201) + '</p>'; idle(h, 'a');
    h.open(v.anchor); h.search('needle'); key(h, 'Escape');
    select(h, v.flow.children[1]); h.open(v.anchor);
    assert.equal(input(h).value, 'newer'); assert.equal(h.count(), '1/1');
    for (const p of [v.flow.children[2], v.flow.children[3]]) {
      key(h, 'Escape'); select(h, p); h.open(v.anchor);
      assert.equal(input(h).value, 'newer'); assert.equal(h.count(), '1/1');
    }
  } finally { await h.finish(); }
});

test('clearing input before delayed paging remains empty across close/reopen', async () => {
  const h = setup();
  try {
    const v = await h.mount('a'); let calls = 0;
    h.faces.set('a', {getSnapshot: () => snapshot(), loadOlder() {calls++;}});
    h.open(v.anchor); h.search('needle'); h.search(''); key(h, 'Escape'); h.open(); await h.advance(1000);
    assert.equal(input(h).value, ''); assert.equal(h.count(), ''); assert.equal(h.w.CSS.highlights.size, 0); assert.equal(calls, 0);
  } finally { await h.finish(); }
});

test('close ends observation and pending query effects; reopen searches the current body', async () => {
  const h = setup();
  try {
    const v = await h.mount('a'); let calls = 0, finish; const state = snapshot();
    h.faces.set('a', {getSnapshot: () => state, loadOlder() {calls++; return new Promise(resolve => finish = resolve);}});
    h.open(v.anchor); h.search('needle'); await h.advance(300); key(h, 'Escape');
    v.flow.innerHTML = '<p>needle needle</p>'; state.hasMore = false; finish(); await h.advance(600);
    assert.equal(h.timers.size, 0); assert.equal(h.w.CSS.highlights.size, 0); assert.equal(calls, 1);
    h.open(); await h.advance(600);
    assert.equal(input(h).value, 'needle'); assert.equal(h.count(), '1/2'); assert.equal(calls, 1);
  } finally { await h.finish(); }
});

test('switching conversation searches the same query with new ranges and first selection', async () => {
  const h = setup();
  try {
    const a = await h.mount('a'), b = await h.mount('b'); idle(h, 'a'); idle(h, 'b');
    a.flow.innerHTML = '<p>needle needle</p>';
    h.open(a.anchor); h.search('needle'); key(h, 'Enter'); assert.equal(h.count(), '2/2');
    b.anchor.dispatchEvent(new h.w.Event('pointerdown', {bubbles: true})); await h.advance(600);
    assert.equal(input(h).value, 'needle'); assert.equal(h.count(), '1/1'); assert.ok(b.flow.contains(current(h).startContainer));
  } finally { await h.finish(); }
});

test('dispose/reapply and new plugin instances start with no retained query or web storage', async () => {
  for (const reapply of [true, false]) {
    let h = setup();
    try {
      const v = await h.mount('a'); idle(h, 'a'); h.open(v.anchor); h.search('needle');
      if (reapply) { await h.dispose(); h.plugin.apply(h.ctx); }
      else { await h.finish(); h = setup(); }
      const next = await h.mount('a'); idle(h, 'a'); h.open(next.anchor); await h.advance(600);
      assert.equal(input(h).value, ''); assert.equal(h.count(), ''); assert.equal(h.w.CSS.highlights.size, 0);
      // This opaque-origin jsdom throws for local/sessionStorage access, so
      // successful lifecycle execution also rejects accidental storage use.
    } finally { await h.finish(); }
  }
});
