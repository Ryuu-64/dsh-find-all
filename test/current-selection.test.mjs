import test from 'node:test';
import assert from 'node:assert/strict';
import {setup, key, current} from './helpers/search-ui.mjs';

function page(h, view, query = 'needle') {
  h.open(view.anchor);
  h.w.document.querySelector('.content-filter').click();
  h.w.document.querySelector('input[name="dsh-find-all-root-scope"][value="page"]').click();
  h.search(query); h.scrolls.length = 0;
}
async function rescan(h) { await Promise.resolve(); await h.advance(550); }

test('prepend keeps selected B rather than another identical word in A or C', async () => {
  const h = setup();
  try {
    const v = await h.mount('a'); v.flow.innerHTML = '<p id="A">needle</p><p id="B">needle</p>'; page(h, v); key(h, 'Enter');
    const b = current(h).startContainer; h.scrolls.length = 0;
    v.flow.insertAdjacentHTML('afterbegin', '<p id="C">needle</p>'); await rescan(h);
    assert.equal(h.count(), '3/3'); assert.equal(current(h).startContainer, b); assert.equal(h.scrolls.length, 0);
  } finally { await h.finish(); }
});

test('characterData edits fall back instead of inferring identity from old live Range endpoints', async () => {
  const h = setup();
  try {
    const v = await h.mount('a'); v.flow.innerHTML = '<p>needle</p><p>before needle after</p>'; page(h, v); key(h, 'Enter');
    const b = current(h).startContainer; b.data += ' appended';
    v.flow.insertAdjacentHTML('afterbegin', '<p>needle</p>'); h.scrolls.length = 0; await rescan(h);
    assert.equal(h.count(), '2/3'); assert.notEqual(current(h).startContainer, b); assert.equal(current(h).toString(), 'needle'); assert.equal(h.scrolls.length, 0);
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

test('changed original Text data invalidates endpoint identity before ordinal fallback', async () => {
  const h = setup();
  try {
    const v = await h.mount('a'); v.flow.innerHTML = '<p id="A">needle</p><p id="B">needle</p>';
    page(h, v); key(h, 'Enter'); assert.equal(h.count(), '2/2');
    const selected = current(h).startContainer, a = v.flow.firstChild;
    selected.data = 'needle needle'; v.flow.insertAdjacentHTML('afterbegin', '<p id="C">needle</p>');
    h.scrolls.length = 0; await rescan(h);
    assert.equal(h.count(), '2/4'); assert.ok(a.contains(current(h).startContainer)); assert.equal(h.scrolls.length, 0);
  } finally { await h.finish(); }
});

test('unchanged matched Text still retains identity when a sibling appends new content', async () => {
  const h = setup();
  try {
    const v = await h.mount('a'); v.flow.innerHTML = '<p>needle</p><p id="B"><strong>needle</strong></p>';
    page(h, v); key(h, 'Enter'); const selected = current(h).startContainer;
    v.flow.lastChild.append(h.w.document.createTextNode(' appended'));
    v.flow.insertAdjacentHTML('afterbegin', '<p>needle</p>'); h.scrolls.length = 0; await rescan(h);
    assert.equal(h.count(), '3/3'); assert.equal(current(h).startContainer, selected); assert.equal(h.scrolls.length, 0);
  } finally { await h.finish(); }
});

test('cross-node identity checks immutable intermediate text as well as both endpoints', async () => {
  const h = setup();
  try {
    const v = await h.mount('a'); v.flow.innerHTML = '<p id="A">Hello world</p><p id="B"><span>Hel</span><em>lo </em><strong>world</strong></p>';
    page(h, v, 'Hello world'); key(h, 'Enter'); const a = v.flow.firstChild;
    v.flow.querySelector('em').firstChild.data = 'LO ';
    v.flow.insertAdjacentHTML('afterbegin', '<p>Hello world</p>'); h.scrolls.length = 0; await rescan(h);
    assert.equal(h.count(), '2/3'); assert.ok(a.contains(current(h).startContainer)); assert.equal(h.scrolls.length, 0);
  } finally { await h.finish(); }
});

for (const replacement of ['ed', 'ED']) {
  test(`moved middle node cannot authenticate a new ${replacement} participant at the same endpoints`, async () => {
    const h = setup();
    try {
      const v = await h.mount('a'); v.flow.innerHTML = '<p id="A">needle</p><p id="B"><span>ne</span><em>ed</em><strong>le</strong></p>';
      page(h, v); key(h, 'Enter'); const a = v.flow.firstChild, b = v.flow.lastChild;
      const oldMiddle = b.querySelector('em'); b.append(oldMiddle);
      b.insertBefore(h.w.document.createTextNode(replacement), b.querySelector('strong'));
      v.flow.insertAdjacentHTML('afterbegin', '<p>needle</p>'); h.scrolls.length = 0; await rescan(h);
      assert.equal(oldMiddle.firstChild.isConnected, true); assert.equal(oldMiddle.textContent, 'ed');
      assert.equal(h.count(), '2/3'); assert.ok(a.contains(current(h).startContainer)); assert.equal(h.scrolls.length, 0);
    } finally { await h.finish(); }
  });
}

test('middle node moved outside its original block cannot authenticate its same-value replacement', async () => {
  const h = setup();
  try {
    const v = await h.mount('a'); v.flow.innerHTML = '<p id="A">needle</p><p id="B"><span>ne</span><em>ed</em><strong>le</strong></p><p id="elsewhere">other</p>';
    page(h, v); key(h, 'Enter'); const a = v.flow.firstChild, b = v.flow.querySelector('#B');
    v.flow.querySelector('#elsewhere').append(b.querySelector('em'));
    b.insertBefore(h.w.document.createTextNode('ed'), b.querySelector('strong'));
    b.append(h.w.document.createTextNode(' changed'));
    v.flow.insertAdjacentHTML('afterbegin', '<p>needle</p>'); h.scrolls.length = 0; await rescan(h);
    assert.equal(h.count(), '2/3'); assert.ok(a.contains(current(h).startContainer)); assert.equal(h.scrolls.length, 0);
  } finally { await h.finish(); }
});

for (const changedBlock of [true, false]) {
  test(`equal middle nodes reordered ${changedBlock ? 'with changed block text fall back' : 'within unchanged block text retain via block recovery'}`, async () => {
    const h = setup();
    try {
      const v = await h.mount('a'); v.flow.innerHTML = '<p id="A">needle</p><p id="B"><span>n</span><em>e</em><i>e</i><strong>dle</strong></p>';
      page(h, v); key(h, 'Enter'); const a = v.flow.firstChild, b = v.flow.lastChild;
      b.insertBefore(b.querySelector('i'), b.querySelector('em'));
      if (changedBlock) b.append(h.w.document.createTextNode(' changed'));
      v.flow.insertAdjacentHTML('afterbegin', '<p>needle</p>'); h.scrolls.length = 0; await rescan(h);
      assert.equal(h.count(), changedBlock ? '2/3' : '3/3');
      assert.ok((changedBlock ? a : b).contains(current(h).startContainer)); assert.equal(h.scrolls.length, 0);
    } finally { await h.finish(); }
  });
}
