import test from 'node:test';
import assert from 'node:assert/strict';
import React, {act} from 'react';
import {reader} from './helpers/reading-ui.mjs';
import {setup, snapshot, key} from './helpers/search-ui.mjs';

// These geometry fixtures exercise restoration decisions, not real-host acceptance.
const rect = (top, height = 20) => ({top, bottom: top + height, left: 0, right: 400, width: 400, height});
const bar = h => h.w.document.querySelector('#dsh-find-all-root');

function assertClosedAndClean(h) {
  assert.equal(bar(h).style.display, 'none');
  assert.equal(h.w.CSS.highlights.size, 0);
  assert.equal(h.timers.size, 0);
}

test('a long paragraph scrolled inside a process group captures and restores its visible line', async () => {
  const h = await reader();
  try {
    const row = h.v.flow.firstChild;
    const group = h.w.document.createElement('div');
    group.dataset.chatGroupKey = 'group-a'; group.dataset.chatAnchorKey = 'group:group-a';
    const body = h.w.document.createElement('div');
    body.dataset.stepProcessBody = ''; body.style.overflowY = 'auto';
    const content = h.w.document.createElement('div');
    content.dataset.stepProcessContent = ''; content.dataset.chatFlow = '';
    row.replaceWith(group); group.append(body); body.append(content); content.append(row);
    row.innerHTML = '<p data-y="540">' + 'long reading content '.repeat(100) + '</p>';
    const p = row.firstChild;
    let innerTop = 300;
    Object.defineProperties(body, {
      scrollTop: {get: () => innerTop, set: value => {innerTop = value;}},
      clientHeight: {get: () => 100}, scrollHeight: {get: () => 5000},
    });
    body.getBoundingClientRect = () => rect(540 - h.scroll.scrollTop, 100);
    const originalRects = h.w.Range.prototype.getClientRects;
    h.w.Range.prototype.getClientRects = function () {
      if (this.startContainer.parentElement !== p) return originalRects.call(this);
      const rects = [];
      for (let line = Math.floor(this.startOffset / 10); line <= Math.floor(Math.max(this.startOffset, this.endOffset - 1) / 10); line++) {
        rects.push(rect(540 - h.scroll.scrollTop - innerTop + line * 20));
      }
      return rects;
    };
    h.openReader(); h.search('needle'); await h.advance(200);
    assert.equal(h.button().disabled, false, 'capture uses the inner clip edge rather than the outer viewport edge');
    body.scrollTop = 650;
    h.button().click(); await h.advance(0); await h.advance(1400);
    assert.equal(body.scrollTop, 300, 'restore the original line within its process group');
    assert.equal(h.scroll.scrollTop, 440, 'restore the group within the outer viewport');
  } finally {await h.finish();}
});

test('initial body Ctrl+F recognizes an official nested process flow as part of its single conversation', async () => {
  const h = setup();
  try {
    const view = await h.mount('a', true);
    view.flow.insertAdjacentHTML('beforeend', '<div data-chat-group-key="group-a"><div data-step-process-body><div data-step-process-content data-chat-flow><p>process text</p></div></div></div>');
    h.open(); h.search('needle');
    assert.equal(h.count(), '1/1');
    assert.doesNotMatch(h.status(), /Select a visible conversation|scope unavailable/i);
    key(h, 'Escape');
    assertClosedAndClean(h);
  } finally {await h.finish();}
});

test('a replaced session face ends return progress and ignores the old history completion', async () => {
  const h = await reader();
  let resolveLoad;
  try {
    let calls = 0;
    h.faces.set('a', {
      getSnapshot: () => snapshot(),
      loadOlder() {calls++; return new Promise(resolve => {resolveLoad = resolve;});},
    });
    h.openReader(); h.search('needle'); await h.advance(200);
    const row = h.v.flow.firstChild; row.remove(); h.nodes.delete('origin');
    h.button().click(); await h.advance(0);
    assert.equal(calls, 1);
    const landed = h.scroll.scrollTop;
    h.faces.set('a', {getSnapshot: () => snapshot({hasMore: false}), loadOlder() {assert.fail('replacement must not receive the old return');}});
    await h.advance(6000);
    assert.match(h.status(), /Could not return/);
    assert.equal(h.button().textContent, 'Return to reading position');
    assert.equal(h.button().hidden, true, 'an invalid origin cannot be retried against the replacement face');
    assert.notEqual(bar(h).style.display, 'none');
    h.v.flow.prepend(row); h.nodes.set('origin', {key: 'origin', anchorSeq: 10});
    resolveLoad(); await h.advance(1500);
    assert.equal(calls, 1); assert.equal(h.scroll.scrollTop, landed);
    key(h, 'Escape');
    assertClosedAndClean(h);
  } finally {resolveLoad?.(); await h.finish();}
});

test('deleting the original of two identical paragraphs in the same node cannot retarget the surviving copy', async () => {
  const h = await reader();
  try {
    const row = h.v.flow.firstChild;
    const paragraph = Array.from({length: 250}, (_, i) => String(i).padStart(4, '0')).join(' ');
    row.innerHTML = '<p data-y="200">' + paragraph + '</p><p data-y="700">separator</p><p data-y="850">' + paragraph + '</p>';
    const first = row.firstChild, second = row.lastChild;
    const originalRects = h.w.Range.prototype.getClientRects;
    h.w.Range.prototype.getClientRects = function () {
      const owner = this.startContainer.parentElement;
      if (owner !== first && owner !== second) return originalRects.call(this);
      const rects = [];
      for (let line = Math.floor(this.startOffset / 10); line <= Math.floor(Math.max(this.startOffset, this.endOffset - 1) / 10); line++) {
        rects.push(rect(Number(owner.dataset.y) - h.scroll.scrollTop + line * 20));
      }
      return rects;
    };
    h.openReader(); h.search('needle'); await h.advance(200);
    first.remove();
    const landed = h.scroll.scrollTop;
    h.button().click(); await h.advance(0); await h.advance(6000);
    assert.match(h.status(), /Could not return/);
    assert.notEqual(bar(h).style.display, 'none');
    assert.equal(h.scroll.scrollTop, landed, 'do not scroll to the surviving same-node duplicate');
    assert.equal(h.button().disabled, false, 'uncertain restoration retains a retryable origin');
    row.prepend(first);
    h.button().click(); await h.advance(0); await h.advance(1400);
    assert.equal(h.scroll.scrollTop, 440);
  } finally {await h.finish();}
});

test('unchanged layout preserves the negative offset of a partially visible first reading line', async () => {
  const h = await reader();
  try {
    h.scroll.scrollTop = 470;
    const paragraph = h.v.flow.firstChild.children[1];
    assert.equal(paragraph.getBoundingClientRect().top, -10);
    h.openReader(); h.search('needle'); await h.advance(200);
    h.button().click(); await h.advance(0); await h.advance(1400);
    assert.equal(h.scroll.scrollTop, 470);
    assert.equal(paragraph.getBoundingClientRect().top, -10, 'the visible line must not be shifted down to the viewport edge');
  } finally {await h.finish();}
});


test('sidebar focus and dismissal preserve the main reading origin', async () => {
  const h = await reader();
  try {
    h.openReader(); h.search('needle'); await h.advance(200);
    assert.equal(h.button().disabled, false);
    const sidebar = h.w.document.createElement('aside');
    sidebar.innerHTML = '<div data-sidebar-chat><div data-conversation-content data-conversation-session="child" data-content-phase="active"><div data-conversation-scroll><div data-chat-flow>child needle</div><textarea></textarea></div></div></div>';
    h.w.document.body.append(sidebar);
    sidebar.querySelector('textarea').focus();
    h.open(sidebar.querySelector('textarea')); await h.advance(700);
    assert.equal(h.button().disabled, false, 'the original main reading point survives sidebar focus and repeated find');
    sidebar.remove();
    h.button().click(); await h.advance(1400);
    assert.equal(h.scroll.scrollTop, 440);
    assert.ok(h.requested.every(id => id === 'a'));
  } finally {await h.finish();}
});

test('same-session Node-store replacement cancels pending return and discards its origin', async () => {
  const h = await reader();
  let finishLoad;
  try {
    h.faces.set('a', {getSnapshot: () => snapshot(), loadOlder() {return new Promise(resolve => {finishLoad = resolve;});}});
    h.openReader(); h.search('needle'); await h.advance(200);
    const row = h.v.flow.firstChild; row.remove(); h.nodes.delete('origin');
    h.button().click(); await h.advance(0);
    assert.equal(typeof finishLoad, 'function');
    const landed = h.scroll.scrollTop;
    const replacement = new Map(h.nodes);
    await act(async () => h.v.root.render(React.createElement(h.Component, {
      sessionId: 'a', useChat: select => select({nodes: replacement}),
    })));
    h.v.flow.prepend(row); replacement.set('origin', {key: 'origin', anchorSeq: 10});
    finishLoad(); await h.advance(2000);
    assert.equal(h.scroll.scrollTop, landed, 'old async return cannot scroll the replacement reading instance');
    assert.equal(h.button().hidden, true, 'old origin cannot be retried on the replacement store');
    assert.notEqual(bar(h).style.display, 'none');
    key(h, 'Escape'); assertClosedAndClean(h);
  } finally {finishLoad?.(); await h.finish();}
});
