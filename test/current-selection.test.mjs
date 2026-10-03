import test from 'node:test';
import assert from 'node:assert/strict';
import {setup, snapshot, key, current} from './helpers/search-ui.mjs';

function page(h, view, query = 'needle') {
  h.open(view.anchor); h.w.document.querySelector('.scope').click(); h.search(query); h.scrolls.length = 0;
}
async function rescan(h) { await Promise.resolve(); await h.advance(550); }

for (const number of [1, 3]) {
  test(`body update from zero selects the first of ${number} matches without scrolling`, async () => {
    const h = setup();
    try {
      const v = await h.mount('a'); v.flow.innerHTML = '<p>old</p>'; page(h, v);
      assert.equal(h.count(), '0/0');
      v.flow.firstChild.textContent = 'needle '.repeat(number); await rescan(h);
      assert.equal(h.count(), `1/${number}`); assert.equal(current(h).toString(), 'needle'); assert.equal(h.scrolls.length, 0);
      key(h, 'Enter'); assert.equal(h.scrolls.length, 1);
      v.flow.replaceChildren(); await rescan(h);
      assert.equal(h.count(), '0/0'); assert.equal(current(h), undefined);
    } finally { await h.finish(); }
  });
}

test('paging from zero selects its first match without scrolling', async () => {
  const h = setup();
  try {
    const v = await h.mount('a'); v.flow.innerHTML = '<p>old</p>'; const state = snapshot();
    h.faces.set('a', {getSnapshot: () => state, async loadOlder() {v.flow.insertAdjacentHTML('afterbegin', '<p>needle</p><p>needle</p>'); state.hasMore = false;}});
    h.open(v.anchor); h.search('needle'); h.scrolls.length = 0; await h.advance(600);
    assert.equal(h.count(), '1/2'); assert.equal(current(h).toString(), 'needle'); assert.equal(h.scrolls.length, 0);
  } finally { await h.finish(); }
});

test('prepend keeps selected B rather than another identical word in A or C', async () => {
  const h = setup();
  try {
    const v = await h.mount('a'); v.flow.innerHTML = '<p id="A">needle</p><p id="B">needle</p>'; page(h, v); key(h, 'Enter');
    const b = current(h).startContainer; h.scrolls.length = 0;
    v.flow.insertAdjacentHTML('afterbegin', '<p id="C">needle</p>'); await rescan(h);
    assert.equal(h.count(), '3/3'); assert.equal(current(h).startContainer, b); assert.equal(h.scrolls.length, 0);
  } finally { await h.finish(); }
});

test('immutable endpoints survive characterData mutation that collapses a live Range', async () => {
  const h = setup();
  try {
    const v = await h.mount('a'); v.flow.innerHTML = '<p>needle</p><p>before needle after</p>'; page(h, v); key(h, 'Enter');
    const b = current(h).startContainer; b.data += ' appended';
    v.flow.insertAdjacentHTML('afterbegin', '<p>needle</p>'); h.scrolls.length = 0; await rescan(h);
    assert.equal(h.count(), '3/3'); assert.equal(current(h).startContainer, b); assert.equal(current(h).startOffset, 7); assert.equal(h.scrolls.length, 0);
  } finally { await h.finish(); }
});

test('same paragraph and unchanged original text restore a cross-node match after token replacement', async () => {
  const h = setup();
  try {
    const v = await h.mount('a'); v.flow.innerHTML = '<p>Hello world</p><p id="selected">Hello <strong>world</strong></p>'; page(h, v, 'Hello world'); key(h, 'Enter');
    const selected = v.flow.lastChild, oldText = current(h).startContainer;
    selected.innerHTML = '<em>Hello</em> <a>world</a>'; v.flow.insertAdjacentHTML('afterbegin', '<p>Hello world</p>'); h.scrolls.length = 0; await rescan(h);
    assert.equal(oldText.isConnected, false); assert.equal(h.count(), '3/3'); assert.ok(selected.contains(current(h).startContainer)); assert.equal(current(h).toString(), 'Hello world'); assert.equal(h.scrolls.length, 0);
  } finally { await h.finish(); }
});

test('official code content wrapper keeps identity across plain pre to Shiki tree plus prepend', async () => {
  const h = setup();
  try {
    const v = await h.mount('a'); v.flow.innerHTML = '<p>Hello world</p><div class="md-code-block"><div data-code-block-banner>toolbar</div><div data-code-block-content><pre><code>before Hello world\nafter</code></pre></div></div>';
    page(h, v, 'Hello world'); key(h, 'Enter'); const content = v.flow.querySelector('[data-code-block-content]'), old = current(h).startContainer;
    content.innerHTML = '<div><pre><code><span class="line"><span>before Hello</span><span> world</span></span>\n<span class="line">after</span></code></pre></div>';
    v.flow.insertAdjacentHTML('afterbegin', '<p>Hello world</p>'); h.scrolls.length = 0; await rescan(h);
    assert.equal(old.isConnected, false); assert.equal(h.count(), '3/3'); assert.ok(content.contains(current(h).startContainer)); assert.equal(current(h).toString(), 'Hello world'); assert.equal(h.scrolls.length, 0);
  } finally { await h.finish(); }
});

test('deleted selection and replaced block clamp the old index instead of guessing matching text', async () => {
  const h = setup();
  try {
    const v = await h.mount('a'); v.flow.innerHTML = '<p>A needle</p><p>B needle</p><p>C needle</p>'; page(h, v); key(h, 'Enter');
    v.flow.children[1].remove(); await rescan(h);
    assert.equal(h.count(), '2/2'); assert.equal(current(h).startContainer.data, 'C needle');
    v.flow.lastChild.outerHTML = '<p>C needle</p>'; v.flow.insertAdjacentHTML('afterbegin', '<p>first needle</p>'); await rescan(h);
    assert.equal(h.count(), '2/3'); assert.equal(current(h).startContainer.data, 'A needle');
    v.flow.replaceChildren(); await rescan(h); assert.equal(h.count(), '0/0');
  } finally { await h.finish(); }
});

test('changed block text with replaced nodes uses clamped index and no semantic guess', async () => {
  const h = setup();
  try {
    const v = await h.mount('a'); v.flow.innerHTML = '<p>A needle</p><p>B needle</p>'; page(h, v); key(h, 'Enter');
    v.flow.lastChild.innerHTML = '<span>changed B needle</span>'; v.flow.insertAdjacentHTML('afterbegin', '<p>C needle</p>'); await rescan(h);
    assert.equal(h.count(), '2/3'); assert.equal(current(h).startContainer.data, 'A needle');
  } finally { await h.finish(); }
});

test('root, target and query changes choose the first result', async () => {
  const h = setup();
  try {
    const a = await h.mount('a'), b = await h.mount('b'); a.flow.innerHTML = '<p>needle needle other other</p>'; b.flow.innerHTML = '<p>needle needle</p>';
    page(h, a); key(h, 'Enter'); assert.equal(h.count(), '2/2');
    const replacement = a.flow.cloneNode(true); a.flow.replaceWith(replacement); a.flow = replacement; await h.advance(650);
    assert.equal(h.count(), '1/2'); assert.ok(replacement.contains(current(h).startContainer));
    key(h, 'Enter'); h.search('other'); assert.equal(h.count(), '1/2');
    h.search('needle'); key(h, 'Enter'); b.anchor.dispatchEvent(new h.w.Event('pointerdown', {bubbles: true}));
    assert.equal(h.count(), '1/2'); assert.ok(b.flow.contains(current(h).startContainer));
  } finally { await h.finish(); }
});

test('selection pushed beyond the match cap falls back to a valid final index', async () => {
  const h = setup();
  try {
    const v = await h.mount('a'); v.flow.innerHTML = '<p>' + 'needle '.repeat(5000) + '</p>'; page(h, v); key(h, 'Enter', {shiftKey: true});
    assert.equal(h.count(), '5000/5000+'); const previous = current(h).startOffset;
    v.flow.insertAdjacentHTML('afterbegin', '<p>needle</p>'); h.scrolls.length = 0; await rescan(h);
    assert.equal(h.count(), '5000/5000+'); assert.notEqual(current(h).startOffset, previous); assert.equal(current(h).toString(), 'needle'); assert.equal(h.scrolls.length, 0);
  } finally { await h.finish(); }
});

test('unchanged same-paragraph runs separated by br retain the exact original run after rebuild', async () => {
  const h = setup();
  try {
    const v = await h.mount('a'); v.flow.innerHTML = '<p>needle<br>needle</p>'; page(h, v); key(h, 'Enter');
    const p = v.flow.firstChild; p.innerHTML = '<span>needle</span><br><em>needle</em>';
    v.flow.insertAdjacentHTML('afterbegin', '<p>needle</p>'); await rescan(h);
    assert.equal(h.count(), '3/3'); assert.equal(current(h).startContainer.parentElement.tagName, 'EM');
  } finally { await h.finish(); }
});
