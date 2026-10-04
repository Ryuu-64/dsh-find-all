import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshot, key} from './helpers/search-ui.mjs';

import {reader} from './helpers/reading-ui.mjs';

test('return is disabled until a measured result landing, then returns to original paragraph and closes', async () => {
  const h = await reader();
  try {
    h.openReader();
    assert.ok(h.button(), 'named return button exists');
    assert.equal(h.button().disabled, true);
    h.search('needle'); await h.advance(200);
    assert.equal(h.button().disabled, false);
    assert.equal(h.scroll.scrollTop, 1320);
    h.button().click(); await h.advance(0); await h.advance(1000);
    assert.equal(h.scroll.scrollTop, 440);
    assert.equal(h.w.document.querySelector('#dsh-find-all-root').style.display, 'none');
    assert.equal(h.w.CSS.highlights.size, 0);
    assert.equal(h.timers.size, 0);
    h.open(); assert.equal(h.w.document.querySelector('#dsh-find-all-root input').value, 'needle');
  } finally {await h.finish();}
});

test('query, navigation, scope, prepend and repeated Ctrl+F do not replace the origin', async () => {
  const h = await reader();
  try {
    h.openReader(); h.search('needle'); await h.advance(200); key(h, 'Enter');
    h.search('other'); h.w.document.querySelector('.scope').click(); h.open();
    h.v.flow.insertAdjacentHTML('afterbegin', '<div data-chat-anchor-key="duplicate"><p data-y="100">original reading paragraph</p></div>');
    await h.advance(800); h.button().click(); await h.advance(0); await h.advance(1000);
    assert.equal(h.scroll.scrollTop, 440);
  } finally {await h.finish();}
});

test('same semantic node is reconstructed after rerender, while a deleted target cannot use duplicate text', async () => {
  for (const deleted of [false, true]) {
    const h = await reader();
    try {
      h.openReader(); h.search('needle'); await h.advance(200); h.setRows();
      if (deleted) {h.v.flow.firstChild.remove(); h.nodes.delete('origin');}
      h.v.flow.insertAdjacentHTML('afterbegin', '<div data-chat-anchor-key="duplicate"><p data-y="100">original reading paragraph</p></div>');
      h.button().click(); await h.advance(6000);
      if (deleted) {
        assert.notEqual(h.w.document.querySelector('#dsh-find-all-root').style.display, 'none');
        assert.match(h.status(), /Could not return/);
        assert.equal(h.scroll.scrollTop, 1320);
      } else assert.equal(h.scroll.scrollTop, 440);
    } finally {await h.finish();}
  }
});

test('Esc abandons the origin, and the next opening captures the current reading position', async () => {
  const h = await reader();
  try {
    h.openReader(); h.search('needle'); await h.advance(200); key(h, 'Escape');
    assert.equal(h.scroll.scrollTop, 1320); h.open(); h.search('paragraph'); await h.advance(200);
    h.button().click(); await h.advance(0); await h.advance(1000);
    assert.equal(h.scroll.scrollTop, 1320);
  } finally {await h.finish();}
});

test('no result and failed scrolling never enable return', async () => {
  const h = await reader();
  try {
    h.openReader(); h.search('absent'); await h.advance(800); assert.equal(h.button().disabled, true);
    h.w.HTMLElement.prototype.scrollIntoView = () => {};
    h.search('needle'); await h.advance(2000); assert.equal(h.button().disabled, true);
  } finally {await h.finish();}
});

test('a line in the middle of a long paragraph survives changed wrapping', async () => {
  const h = await reader();
  try {
    const p = h.v.flow.firstChild.children[1];
    p.dataset.y = '0'; p.textContent = 'original long reading line '.repeat(40);
    let columns = 10;
    h.w.Range.prototype.getClientRects = function () {
      const owner = this.startContainer.parentElement;
      if (owner !== p) {
        const item = owner.closest('[data-y]');
        if (!item) return [];
        const top = Number(item.dataset.y) - h.scroll.scrollTop;
        return [{top, bottom: top + 20, left: 0, right: 400, width: 400, height: 20}];
      }
      const rects = [];
      for (let line = Math.floor(this.startOffset / columns); line <= Math.floor(Math.max(this.startOffset, this.endOffset - 1) / columns); line++) {
        const top = line * 20 - h.scroll.scrollTop;
        rects.push({top, bottom: top + 20, left: 0, right: 400, width: 400, height: 20});
      }
      return rects;
    };
    h.openReader(); h.search('needle'); await h.advance(200);
    columns = 5;
    h.button().click(); await h.advance(0); await h.advance(1200);
    assert.equal(h.scroll.scrollTop, 880, 'same text offset, not the paragraph or message top');
    assert.equal(h.w.document.querySelector('#dsh-find-all-root').style.display, 'none');
  } finally {await h.finish();}
});

test('layout growth above the origin returns to the same content at its saved offset', async () => {
  const h = await reader();
  try {
    h.openReader(); h.search('needle'); await h.advance(200);
    for (const p of h.v.flow.firstChild.children) p.dataset.y = Number(p.dataset.y) + 300;
    h.button().click(); await h.advance(0); await h.advance(1200);
    assert.equal(h.scroll.scrollTop, 740);
  } finally {await h.finish();}
});

test('host scroll ownership that pulls back cannot be reported as a successful return', async () => {
  const h = await reader();
  try {
    h.openReader(); h.search('needle'); await h.advance(200);
    h.scroll.scrollTo = () => {};
    h.button().click(); await h.advance(0); await h.advance(1500);
    assert.match(h.status(), /Could not return.*host did not keep/);
    assert.equal(h.button().disabled, false, 'retry retains this origin');
    assert.notEqual(h.w.document.querySelector('#dsh-find-all-root').style.display, 'none');
    h.scroll.scrollTo = ({top}) => {h.scroll.scrollTop = top;};
    h.button().click(); await h.advance(0); await h.advance(1200);
    assert.equal(h.scroll.scrollTop, 440);
  } finally {await h.finish();}
});

test('a loaded row temporarily absent from the DOM waits for rendering without loading history', async () => {
  const h = await reader();
  try {
    let calls = 0;
    h.faces.set('a', {getSnapshot: () => snapshot(), loadOlder() {calls++;}});
    h.openReader(); h.search('needle'); await h.advance(200);
    const row = h.v.flow.firstChild; row.remove(); h.button().click(); await h.advance(0);
    assert.equal(h.button().textContent, 'Returning…'); assert.equal(h.button().disabled, true);
    await h.advance(500); assert.equal(calls, 0);
    h.v.flow.prepend(row); await h.advance(1200);
    assert.equal(calls, 0); assert.equal(h.scroll.scrollTop, 440);
  } finally {await h.finish();}
});

test('missing rendered content gives a bounded failure without claiming deletion', async () => {
  const h = await reader();
  try {
    h.openReader(); h.search('needle'); await h.advance(200);
    h.v.flow.firstChild.remove(); h.button().click(); await h.advance(0); await h.advance(6000);
    assert.match(h.status(), /content is loaded, but the host could not display/);
    assert.equal(h.button().disabled, false);
  } finally {await h.finish();}
});

for (const interrupt of ['wheel', 'query', 'close', 'switch', 'dispose']) {
  test(`pending history return is deduplicated and ${interrupt} prevents late scrolling`, async () => {
    const h = await reader();
    try {
      let calls = 0, resolveLoad;
      const snapshotState = snapshot();
      h.faces.set('a', {getSnapshot: () => snapshotState, loadOlder() {calls++; return new Promise(resolve => {resolveLoad = resolve;});}});
      h.openReader(); h.search('needle'); await h.advance(200);
      const row = h.v.flow.firstChild; row.remove(); h.nodes.delete('origin');
      h.button().click(); await h.advance(0); h.button().click(); await h.advance(0);
      assert.equal(calls, 1);
      const landed = h.scroll.scrollTop;
      if (interrupt === 'wheel') h.scroll.dispatchEvent(new h.w.WheelEvent('wheel', {bubbles: true}));
      if (interrupt === 'query') h.search('other');
      if (interrupt === 'close') key(h, 'Escape');
      if (interrupt === 'switch') {
        const next = await h.mount('b');
        next.anchor.dispatchEvent(new h.w.Event('pointerdown', {bubbles: true}));
      }
      if (interrupt === 'dispose') await h.dispose();
      h.v.flow.prepend(row); h.nodes.set('origin', {key: 'origin', anchorSeq: 10, visibility: 'visible'});
      snapshotState.hasMore = false; resolveLoad(); await h.advance(2000);
      assert.equal(calls, 1); assert.equal(h.scroll.scrollTop, landed);
      if (interrupt === 'close' || interrupt === 'dispose') assert.equal(h.timers.size, 0);
    } finally {await h.finish();}
  });
}

test('cancelled host request remains deduplicated across a return retry', async () => {
  const h = await reader();
  try {
    let calls = 0, resolveLoad;
    h.faces.set('a', {getSnapshot: () => snapshot(), loadOlder() {calls++; return new Promise(resolve => {resolveLoad = resolve;});}});
    h.openReader(); h.search('needle'); await h.advance(200);
    const row = h.v.flow.firstChild; row.remove(); h.nodes.delete('origin');
    h.button().click(); await h.advance(0);
    h.scroll.dispatchEvent(new h.w.WheelEvent('wheel', {bubbles: true}));
    h.button().click(); await h.advance(1000); assert.equal(calls, 1);
    h.v.flow.prepend(row); h.nodes.set('origin', {key: 'origin', anchorSeq: 10}); resolveLoad();
    await h.advance(1500); assert.equal(calls, 1); assert.equal(h.scroll.scrollTop, 440);
  } finally {await h.finish();}
});

test('history no-progress and request rejection are bounded, visible and retryable', async () => {
  for (const rejected of [false, true]) {
    const h = await reader();
    try {
      let calls = 0;
      h.faces.set('a', {getSnapshot: () => snapshot(), async loadOlder() {calls++; if (rejected) throw new Error('network');}});
      h.openReader(); h.search('needle'); await h.advance(200);
      h.v.flow.firstChild.remove(); h.nodes.delete('origin');
      h.button().click(); await h.advance(0); await h.advance(6000);
      assert.equal(calls, 1); assert.match(h.status(), rejected ? /Loading the original content failed/ : /No progress/);
      assert.equal(h.button().disabled, false);
    } finally {await h.finish();}
  }
});

test('focus returns without a scroll or composer draft edit and success remains announced after close', async () => {
  const h = await reader();
  try {
    const draft = h.v.panel.querySelector('textarea'); draft.value = 'unfinished draft'; draft.focus();
    h.openReader(); h.search('needle'); await h.advance(200);
    h.button().focus(); h.button().click(); await h.advance(0); await h.advance(1200);
    assert.equal(h.w.document.activeElement, draft); assert.equal(draft.value, 'unfinished draft');
    assert.equal(h.scroll.scrollTop, 440);
    assert.ok([...h.w.document.querySelectorAll('[role="status"]')].some(node => node.textContent === 'Returned to reading position'));
    key(h, 'f', {ctrlKey: true}); assert.equal(h.button().disabled, true);
  } finally {await h.finish();}
});

test('a missing older origin stops at the page cap and does not loop indefinitely', async () => {
  const h = await reader();
  try {
    let calls = 0;
    h.faces.set('a', {getSnapshot: () => snapshot(), async loadOlder() {
      calls++; h.nodes.set(`old-${calls}`, {key: `old-${calls}`, anchorSeq: 1000 - calls});
    }});
    h.nodes.set('hit', {key: 'hit', anchorSeq: 2000});
    h.openReader(); h.search('needle'); await h.advance(200);
    h.v.flow.firstChild.remove(); h.nodes.delete('origin');
    h.button().click(); await h.advance(0); await h.advance(60000);
    assert.equal(calls, 400); assert.match(h.status(), /History page limit reached/);
    assert.equal(h.button().disabled, false);
    await h.advance(6000); assert.equal(calls, 400);
  } finally {await h.finish();}
});

test('ambiguous stable-part DOM identity cannot substitute either row', async () => {
  const h = await reader();
  try {
    h.openReader(); h.search('needle'); await h.advance(200);
    h.v.flow.prepend(h.v.flow.firstChild.cloneNode(true));
    h.button().click(); await h.advance(0); await h.advance(6000);
    assert.match(h.status(), /Could not return/); assert.equal(h.scroll.scrollTop, 1320);
  } finally {await h.finish();}
});

test('host busy state is awaited without a concurrent history request', async () => {
  const h = await reader();
  try {
    let calls = 0;
    h.faces.set('a', {getSnapshot: () => snapshot({loadingOlder: true}), loadOlder() {calls++;}});
    h.openReader(); h.search('needle'); await h.advance(200);
    h.v.flow.firstChild.remove(); h.nodes.delete('origin');
    h.button().click(); await h.advance(0); await h.advance(6000);
    assert.equal(calls, 0); assert.match(h.status(), /No progress/);
    assert.equal(h.button().disabled, false);
  } finally {await h.finish();}
});
